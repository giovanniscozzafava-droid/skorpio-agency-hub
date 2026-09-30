-- ============================================================================
-- Il funnel di Giovanni (30/09/2026, seconda indicazione): Alberto prende i
-- compiti da Giovanni (glieli chiede la sera su WhatsApp, lui li aggiorna
-- quando vuole), li distribuisce subito su calendario e Kanban, ed Elisa
-- vidima, sposta, riassegna. I ragazzi ricevono il lavoro quando Elisa vidima.
--
-- Sostituisce il passaggio «Da smistare» (consegne_proponi creava un task per
-- Elisa e niente calendario): ora il lavoro vero nasce subito, con
-- task.vidimato = false. consegne_smista resta per i compiti già passati.
-- ============================================================================

ALTER TABLE public.task ADD COLUMN IF NOT EXISTS vidimato boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.task.vidimato IS 'false = lavoro messo da Alberto su richiesta di Giovanni, in attesa che Elisa lo vidimi: è in calendario e Kanban, ma il ragazzo non è ancora stato avvisato.';

/** Il lavoro chiesto da Giovanni per un ragazzo: subito in calendario e Kanban, da vidimare. */
CREATE OR REPLACE FUNCTION public.consegne_proponi(
  p_per text, p_cosa text, p_ore numeric, p_entro date, p_entro_ora time, p_cliente text,
  p_inizio timestamptz, p_fine timestamptz, p_da text, p_conferma boolean, p_tipo text, p_priorita text, p_smistatore text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v jsonb;
  v_id uuid;
BEGIN
  IF p_inizio IS NULL AND COALESCE(p_ore, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Servono le ore stimate (o l''orario preciso) per metterlo in calendario. Quante ore stimi?');
  END IF;
  PERFORM set_config('consegne.da_vidimare', '1', true);
  v := public.consegne_assegna_diretto(p_per, p_cosa, p_ore, p_entro, p_entro_ora, p_cliente, p_inizio, p_fine,
                                       p_da, COALESCE(p_conferma, false), p_tipo, p_priorita);
  PERFORM set_config('consegne.da_vidimare', '', true);
  IF NOT COALESCE((v->>'ok')::boolean, false) THEN RETURN v; END IF;
  v_id := (v->'task'->>'id')::uuid;
  UPDATE public.task SET vidimato = false,
         note = COALESCE(note, '') || E'\n' || format('Da vidimare: %s lo passa ai ragazzi quando lo vidima.', p_smistatore)
   WHERE id = v_id;
  PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'da_vidimare', 'task_id', v_id));
  RETURN v || jsonb_build_object('da_vidimare', true, 'vidima', p_smistatore,
    'nota', format('È già in calendario e nel Kanban. %s lo vidima e allora parte il messaggio a %s.', p_smistatore, p_per));
END;
$$;

/**
 * Elisa vidima: un lavoro (codice TSK o pezzo di descrizione) o «tutti».
 * Il ragazzo riceve WhatsApp ed email con il lavoro e la sua giornata.
 */
CREATE OR REPLACE FUNCTION public.consegne_vidima(p_task text DEFAULT 'tutti', p_richiedente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rq public.team%ROWTYPE;
  k record;
  v_fatti jsonb := '[]'::jsonb;
  v_q text := btrim(COALESCE(p_task, 'tutti'));
BEGIN
  rq := public.consegne_richiedente(p_richiedente);
  IF rq.id IS NULL OR (rq.ruolo <> 'Admin'
      AND lower(rq.nome) <> lower(COALESCE((SELECT valore FROM motore.config WHERE chiave = 'consegne_smistatore'), 'Elisa'))) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'I lavori li vidima Elisa.');
  END IF;
  FOR k IN SELECT id, id_display, descrizione, assegnato_a FROM public.task
            WHERE NOT vidimato AND stato NOT IN ('Fatto', 'Archiviato')
              AND (lower(v_q) IN ('tutti', 'tutto', '') OR upper(id_display) = upper(v_q) OR descrizione ILIKE '%' || v_q || '%')
            ORDER BY scadenza, created_at LOOP
    UPDATE public.task SET vidimato = true,
           note = COALESCE(note, '') || E'\n' || format('Vidimato da %s il %s.', rq.nome, to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM HH24:MI'))
     WHERE id = k.id;
    PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', k.id, 'motivo', 'nuovo'));
    v_fatti := v_fatti || jsonb_build_object('id_display', k.id_display, 'cosa', k.descrizione, 'per', k.assegnato_a);
  END LOOP;
  IF jsonb_array_length(v_fatti) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Non c''è niente da vidimare con quel nome.', 'da_vidimare',
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', id_display, 'cosa', descrizione, 'per', assegnato_a, 'scadenza', scadenza)), '[]'::jsonb)
         FROM public.task WHERE NOT vidimato AND stato NOT IN ('Fatto', 'Archiviato')));
  END IF;
  RETURN jsonb_build_object('ok', true, 'vidimati', v_fatti, 'nota', 'I ragazzi ricevono adesso WhatsApp ed email.');
END;
$$;

/** Elisa (o Giovanni) passa un lavoro a un'altra persona: blocchi rifatti nel suo calendario. */
CREATE OR REPLACE FUNCTION public.consegne_riassegna(p_task text, p_per text, p_richiedente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rq public.team%ROWTYPE;
  t public.team%ROWTYPE;
  k public.task%ROWTYPE;
  v_prima text;
BEGIN
  rq := public.consegne_richiedente(p_richiedente);
  IF rq.id IS NULL OR rq.ruolo <> 'Admin' THEN RETURN jsonb_build_object('ok', false, 'errore', 'Riassegnano Elisa o Giovanni.'); END IF;
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_per, '')));
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo «%s» nel team.', p_per)); END IF;
  SELECT * INTO k FROM public.task WHERE pianificato AND stato NOT IN ('Fatto', 'Archiviato')
     AND (upper(id_display) = upper(btrim(p_task)) OR descrizione ILIKE '%' || btrim(p_task) || '%') ORDER BY created_at DESC LIMIT 1;
  IF k.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo un lavoro aperto «%s».', p_task)); END IF;
  v_prima := k.assegnato_a;
  UPDATE public.task SET assegnato_a = t.nome, updated_at = now() WHERE id = k.id;
  RETURN jsonb_build_object('ok', true, 'task', k.id_display, 'da', v_prima, 'a', t.nome, 'vidimato', k.vidimato,
    'blocchi', (SELECT COALESCE(jsonb_agg(jsonb_build_object('data', c.data, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI')) ORDER BY c.inizio_ts), '[]'::jsonb)
                  FROM public.calendario c WHERE c.blocco_task_id = k.id AND c.fine_ts > now()));
END;
$$;

REVOKE ALL ON FUNCTION public.consegne_vidima(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consegne_vidima(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.consegne_riassegna(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consegne_riassegna(text, text, text) TO authenticated, service_role;

-- Task chiuso: i blocchi futuri spariscono, quello in corso si chiude adesso
-- (Completato se il lavoro è Fatto, Annullato se è archiviato).
CREATE OR REPLACE FUNCTION public.consegne_task_dopo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r jsonb;
  v_team uuid;
  v_fisso public.calendario%ROWTYPE;
  v_adesso timestamptz := public.consegne_quarto_su(now());
BEGIN
  IF NOT NEW.pianificato OR COALESCE(current_setting('consegne.in_corso', true), '') = '1' THEN RETURN NEW; END IF;

  IF NEW.stato IN ('Fatto', 'Archiviato') AND OLD.stato IS DISTINCT FROM NEW.stato THEN
    DELETE FROM public.calendario WHERE blocco_task_id = NEW.id AND inizio_ts >= now();
    UPDATE public.calendario
       SET ora_fine = (LEAST(fine_ts, v_adesso) AT TIME ZONE 'Europe/Rome')::time,
           stato = CASE WHEN NEW.stato = 'Fatto' THEN 'Completato' ELSE 'Annullato' END
     WHERE blocco_task_id = NEW.id AND inizio_ts < now() AND fine_ts > now();
    UPDATE public.calendario SET stato = 'Completato' WHERE blocco_task_id = NEW.id AND stato = 'Pianificato';
    RETURN NEW;
  END IF;

  IF NEW.stato NOT IN ('Fatto', 'Archiviato') AND (
       OLD.stato IN ('Fatto', 'Archiviato')
       OR NEW.scadenza IS DISTINCT FROM OLD.scadenza OR NEW.consegna_ora IS DISTINCT FROM OLD.consegna_ora
       OR NEW.ore_stimate IS DISTINCT FROM OLD.ore_stimate OR NEW.assegnato_a IS DISTINCT FROM OLD.assegnato_a) THEN
    PERFORM set_config('consegne.in_corso', '1', true);
    SELECT * INTO v_fisso FROM public.calendario WHERE blocco_task_id = NEW.id AND blocco_fisso ORDER BY inizio_ts DESC LIMIT 1;
    IF NEW.assegnato_a IS DISTINCT FROM OLD.assegnato_a THEN
      DELETE FROM public.calendario WHERE blocco_task_id = NEW.id AND inizio_ts >= now();
      IF v_fisso.id IS NOT NULL AND v_fisso.inizio_ts < now() THEN v_fisso := NULL; END IF;
    END IF;
    IF v_fisso.id IS NOT NULL AND NEW.assegnato_a IS NOT DISTINCT FROM OLD.assegnato_a THEN
      IF NEW.scadenza IS NOT NULL AND NEW.scadenza IS DISTINCT FROM OLD.scadenza THEN
        UPDATE public.calendario SET data = NEW.scadenza WHERE id = v_fisso.id;
      END IF;
    ELSIF v_fisso.id IS NOT NULL THEN
      -- Lavoro a orario fisso passato a un'altra persona: stesso orario, nuovo nome.
      INSERT INTO public.calendario (tipo, origine, stato, descrizione, data, ora, ora_fine, tutto_il_giorno, persona,
                                     cliente_id, cliente_nome, blocco_task_id, blocco_fisso, note, ospiti)
      VALUES ('lavoro', 'manuale', 'Pianificato', v_fisso.descrizione, v_fisso.data, v_fisso.ora, v_fisso.ora_fine, false, NEW.assegnato_a,
              v_fisso.cliente_id, v_fisso.cliente_nome, NEW.id, true, v_fisso.note, '{}');
      INSERT INTO public.calendario_persone (calendario_id, team_id)
        SELECT c.id, t.id FROM public.calendario c, public.team t
         WHERE c.blocco_task_id = NEW.id AND c.blocco_fisso AND lower(c.persona) = lower(t.nome) AND lower(t.nome) = lower(NEW.assegnato_a)
        ON CONFLICT DO NOTHING;
    ELSE
      r := public.consegne_pianifica_task(NEW.id);
      IF (r->>'mancano')::numeric > 0 THEN
        SELECT id INTO v_team FROM public.team WHERE lower(nome) = lower(NEW.assegnato_a);
        r := public.consegne_riordina(v_team);
        IF NOT (r->>'ok')::boolean THEN
          PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'non_entra', 'persona', NEW.assegnato_a, 'task_id', NEW.id,
            'cosa', NEW.descrizione, 'ore', NEW.ore_stimate, 'entro', NEW.scadenza, 'entro_ora', to_char(NEW.consegna_ora, 'HH24:MI'),
            'non_entrano', r->'non_entrano', 'dal_kanban', true));
        END IF;
      END IF;
    END IF;
    PERFORM set_config('consegne.in_corso', '', true);
    PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', NEW.id,
      'motivo', CASE WHEN NEW.assegnato_a IS DISTINCT FROM OLD.assegnato_a THEN 'nuovo' ELSE 'spostato' END,
      'prima', to_char(OLD.scadenza, 'YYYY-MM-DD') || COALESCE(' ' || to_char(OLD.consegna_ora, 'HH24:MI'), '')));
  END IF;
  RETURN NEW;
END;
$$;

-- La giornata: ogni voce dice se è da vidimare; per Elisa l'elenco di quelli in attesa.
CREATE OR REPLACE FUNCTION public.consegne_giornata(p_membro text, p_giorno date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.team%ROWTYPE;
  v_g date := COALESCE(p_giorno, (now() AT TIME ZONE 'Europe/Rome')::date);
  v_smistatore text := COALESCE((SELECT valore FROM motore.config WHERE chiave = 'consegne_smistatore'), 'Elisa');
BEGIN
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_membro, '')));
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo «%s» nel team.', p_membro)); END IF;
  RETURN jsonb_build_object('ok', true, 'persona', t.nome, 'giorno', v_g,
    'orario', public.consegne_orario_testo(t.id, v_g),
    'ore_timbrate', public.consegne_ore_timbrate(t.nome, v_g),
    'ore_libere', public.consegne_ore_libere(t.id, public.cal_ts(v_g + 1, '00:00'))
                  - CASE WHEN v_g > (now() AT TIME ZONE 'Europe/Rome')::date
                         THEN public.consegne_ore_libere(t.id, public.cal_ts(v_g, '00:00')) ELSE 0 END,
    'agenda', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI'), 'tipo', c.tipo,
                  'titolo', btrim(regexp_replace(c.descrizione, '\s*\[TASK:[^\]]+\]', '', 'g')), 'cliente', NULLIF(c.cliente_nome, ''),
                  'task', k.id_display, 'da_vidimare', COALESCE(NOT k.vidimato, false)) ORDER BY c.inizio_ts), '[]'::jsonb)
                 FROM public.calendario c LEFT JOIN public.task k ON k.id = c.blocco_task_id
                WHERE c.data = v_g AND c.ora IS NOT NULL AND c.tipo <> 'pubblicazione'
                  AND lower(COALESCE(c.stato, '')) NOT IN ('saltato', 'annullato', 'cancellato')
                  AND NOT EXISTS (SELECT 1 FROM public.task k2 WHERE k2.id = c.task_id AND k2.pianificato)
                  AND (EXISTS (SELECT 1 FROM public.calendario_persone cp WHERE cp.calendario_id = c.id AND cp.team_id = t.id)
                       OR lower(t.nome) IN (SELECT lower(btrim(x)) FROM unnest(string_to_array(COALESCE(c.persona, ''), ',')) x))),
    'assenze', (SELECT COALESCE(jsonb_agg(c.descrizione), '[]'::jsonb) FROM public.calendario c
                 WHERE c.data = v_g AND c.tipo = 'indisponibilita' AND lower(COALESCE(c.persona, '')) = lower(t.nome)),
    'consegne', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', k.id_display, 'cosa', k.descrizione, 'cliente', NULLIF(k.cliente_nome, ''),
                   'ora', to_char(COALESCE(k.consegna_ora, k.ora), 'HH24:MI'), 'pianificato', k.pianificato) ORDER BY k.consegna_ora NULLS LAST), '[]'::jsonb)
                   FROM public.task k WHERE lower(k.assegnato_a) = lower(t.nome) AND k.scadenza = v_g AND k.stato NOT IN ('Fatto', 'Archiviato')
                    AND k.proposta IS NULL AND k.vidimato),
    'da_smistare', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', k.id_display, 'descrizione', k.descrizione, 'da', k.assegnato_da, 'verifica', k.note) ORDER BY k.created_at), '[]'::jsonb)
                   FROM public.task k WHERE lower(k.assegnato_a) = lower(t.nome) AND k.proposta IS NOT NULL AND k.stato = 'Da fare'),
    'da_vidimare', CASE WHEN lower(t.nome) = lower(v_smistatore) OR t.ruolo = 'Admin' THEN
                   (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', k.id_display, 'cosa', k.descrizione, 'per', k.assegnato_a,
                      'da', k.assegnato_da, 'scadenza', k.scadenza, 'consegna_ora', to_char(k.consegna_ora, 'HH24:MI'),
                      'blocchi', (SELECT COALESCE(jsonb_agg(jsonb_build_object('data', c.data, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI')) ORDER BY c.inizio_ts), '[]'::jsonb)
                                    FROM public.calendario c WHERE c.blocco_task_id = k.id AND c.fine_ts > now())) ORDER BY k.scadenza), '[]'::jsonb)
                      FROM public.task k WHERE NOT k.vidimato AND k.stato NOT IN ('Fatto', 'Archiviato'))
                   ELSE '[]'::jsonb END);
END;
$$;

-- Il blocco KALEA di oggi era in corso quando KALEA è stata archiviata: chiuso adesso, Annullato.
UPDATE public.calendario c SET ora_fine = (public.consegne_quarto_su(now()) AT TIME ZONE 'Europe/Rome')::time, stato = 'Annullato'
  FROM public.task k
 WHERE c.blocco_task_id = k.id AND k.stato = 'Archiviato' AND c.stato = 'Completato' AND c.fine_ts > now();

-- Finché Elisa non vidima, il ragazzo non riceve niente: né il lavoro nuovo né gli spostamenti.
CREATE OR REPLACE FUNCTION public.consegne_avvisa(p_corpo jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_corpo->>'azione' = 'avvisa_lavoro' AND (
       COALESCE(current_setting('consegne.da_vidimare', true), '') = '1'
       OR EXISTS (SELECT 1 FROM public.task WHERE id = (p_corpo->>'task_id')::uuid AND NOT vidimato)) THEN
    RETURN;
  END IF;
  PERFORM public.alberto_whatsapp_chiama('consegne', p_corpo);
END;
$$;

ALTER TABLE public.consegne_invii DROP CONSTRAINT IF EXISTS consegne_invii_tipo_check;
ALTER TABLE public.consegne_invii ADD CONSTRAINT consegne_invii_tipo_check CHECK (tipo = ANY (ARRAY[
  'settimana', 'rossa', 'giornata', 'sera', 'promemoria_timbra', 'timbratura_avvio',
  'lavoro_nuovo', 'lavoro_spostato', 'smistamento', 'da_vidimare', 'chiedi_compiti']));
