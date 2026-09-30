-- ============================================================================
-- La catena giusta (Giovanni, 30/09/2026): Alberto dà i compiti a Elisa,
-- Elisa li dispensa ad Alessandro e Luca.
-- ============================================================================
-- consegne_assegna resta l'unica porta per il lavoro, ma adesso smista:
--   - Elisa (motore.config.consegne_smistatore) assegna direttamente: il
--     pianificatore mette le ore nel calendario del ragazzo;
--   - chiunque altro (Giovanni) che chiede lavoro per un'altra persona non lo
--     assegna: Alberto fa la prova (orario, ore libere) senza lasciare
--     traccia, avvisa subito chi chiede se è fuori orario o non entra, e crea
--     per Elisa un task «Da smistare» con la proposta pronta;
--   - Elisa lo smista (consegne_smista): così com'è, o cambiando persona, ore
--     o data. Da lì parte il pianificatore, con Elisa come chi assegna.
-- Il vecchio corpo di consegne_assegna diventa consegne_assegna_diretto.
-- ============================================================================

ALTER TABLE public.task ADD COLUMN IF NOT EXISTS proposta jsonb;
COMMENT ON COLUMN public.task.proposta IS 'Task «Da smistare»: il lavoro proposto (per, cosa, ore, entro, entro_ora, cliente, inizio, fine, conferma, da, verifica).';

INSERT INTO motore.config (chiave, valore)
SELECT 'consegne_smistatore', 'Elisa'
WHERE NOT EXISTS (SELECT 1 FROM motore.config WHERE chiave = 'consegne_smistatore');

ALTER FUNCTION public.consegne_assegna(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text)
  RENAME TO consegne_assegna_diretto;
REVOKE ALL ON FUNCTION public.consegne_assegna_diretto(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_assegna_diretto(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) TO service_role;

/** Il lavoro passato a Elisa: prova senza lasciare traccia, poi task «Da smistare». */
CREATE OR REPLACE FUNCTION public.consegne_proponi(
  p_per text, p_cosa text, p_ore numeric, p_entro date, p_entro_ora time, p_cliente text,
  p_inizio timestamptz, p_fine timestamptz, p_da text, p_conferma boolean, p_tipo text, p_priorita text, p_smistatore text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.team%ROWTYPE;
  v jsonb := NULL;
  v_id uuid; v_display text; v_quando text; v_verifica text; v_fine timestamptz;
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
BEGIN
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_per, '')));
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo «%s» nel team.', p_per)); END IF;
  IF COALESCE(btrim(p_cosa), '') = '' THEN RETURN jsonb_build_object('ok', false, 'errore', 'Serve cosa va fatto.'); END IF;
  IF p_inizio IS NULL AND p_entro IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', 'Serve il giorno di consegna (o l''orario preciso).'); END IF;

  -- La prova: come se la assegnasse Elisa adesso, poi tutto annullato.
  IF p_inizio IS NOT NULL OR COALESCE(p_ore, 0) > 0 THEN
    BEGIN
      PERFORM set_config('consegne.smista', '1', true);
      v := public.consegne_assegna_diretto(p_per, p_cosa, p_ore, p_entro, p_entro_ora, p_cliente, p_inizio, p_fine,
                                           p_smistatore, COALESCE(p_conferma, false), p_tipo, p_priorita);
      RAISE EXCEPTION USING ERRCODE = 'CN002', MESSAGE = 'solo prova';
    EXCEPTION WHEN SQLSTATE 'CN002' THEN NULL;
    END;
    PERFORM set_config('consegne.smista', '', true);
    IF v ? 'errore' THEN RETURN v; END IF;
    IF COALESCE((v->>'serve_conferma')::boolean, false) AND NOT COALESCE(p_conferma, false) THEN
      RETURN v || jsonb_build_object('nota', format('Se chi chiede conferma, lo passo a %s con il suo ok (conferma=true).', p_smistatore));
    END IF;
  END IF;

  v_fine := COALESCE(p_fine, p_inizio + make_interval(mins => round(COALESCE(p_ore, 1) * 60)::int));
  v_quando := CASE WHEN p_inizio IS NOT NULL
    THEN format('%s %s-%s', to_char(p_inizio AT TIME ZONE 'Europe/Rome', 'DD/MM'), to_char(p_inizio AT TIME ZONE 'Europe/Rome', 'HH24:MI'), to_char(v_fine AT TIME ZONE 'Europe/Rome', 'HH24:MI'))
    ELSE format('%sconsegna %s%s', COALESCE(replace(p_ore::text, '.', ',') || ' ore, ', 'ore da stimare, '), to_char(p_entro, 'DD/MM'), COALESCE(' entro le ' || to_char(p_entro_ora, 'HH24:MI'), '')) END;
  v_verifica := CASE
    WHEN v IS NULL THEN 'ore da stimare: la prova la fa Elisa quando smista'
    WHEN COALESCE((v->>'ok')::boolean, false) THEN 'entra: ' || COALESCE((SELECT string_agg(format('%s %s-%s', to_char((b->>'data')::date, 'DD/MM'), b->>'ora', b->>'ora_fine'), ', ') FROM jsonb_array_elements(v->'blocchi') b), '')
    WHEN COALESCE((v->>'non_entra')::boolean, false) THEN 'NON entra: ' || COALESCE(v->>'motivo', '')
    WHEN COALESCE((v->>'serve_conferma')::boolean, false) THEN 'confermato da ' || p_da || ': ' || COALESCE(v->>'motivo', '')
    ELSE COALESCE(v->>'motivo', '') END;

  v_display := public.generate_display_id('TSK', 'task_seq');
  INSERT INTO public.task (id_display, tipo, descrizione, cliente_nome, priorita, stato, assegnato_a, assegnato_da, scadenza, note, proposta)
  VALUES (COALESCE(v_display, 'TSK' || extract(epoch FROM now())::bigint), 'Da smistare',
          left(format('Da dare a %s: %s%s (%s)', t.nome, btrim(p_cosa), COALESCE(' · ' || NULLIF(btrim(p_cliente), ''), ''), v_quando), 300),
          COALESCE(left(p_cliente, 80), ''), '🔴 Alta', 'Da fare', p_smistatore, p_da, v_oggi,
          format('Chiesto da %s tramite Alberto. Verifica del pianificatore: %s', p_da, v_verifica),
          jsonb_build_object('per', t.nome, 'cosa', btrim(p_cosa), 'ore', p_ore, 'entro', p_entro, 'entro_ora', to_char(p_entro_ora, 'HH24:MI'),
                             'cliente', p_cliente, 'inizio', p_inizio, 'fine', p_fine, 'conferma', COALESCE(p_conferma, false),
                             'tipo', p_tipo, 'priorita', p_priorita, 'da', p_da, 'verifica', v))
  RETURNING id, id_display INTO v_id, v_display;

  PERFORM public.alberto_registra_azione(p_da, 'eseguito',
    format('Passato a %s da smistare (%s): %s per %s, %s.', p_smistatore, v_display, btrim(p_cosa), t.nome, v_quando),
    jsonb_build_object('rpc', 'consegne_proponi', 'task', v_display, 'task_id', v_id));
  PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'smistamento', 'task_id', v_id));

  RETURN jsonb_build_object('ok', true, 'smistamento', true, 'a', p_smistatore,
    'task', jsonb_build_object('id_display', v_display, 'descrizione', format('Da dare a %s: %s (%s)', t.nome, btrim(p_cosa), v_quando)),
    'verifica', v_verifica, 'prova', v,
    'nota', format('Non è ancora in calendario: lo mette %s quando lo smista. %s riceve subito il compito su WhatsApp.', p_smistatore, p_smistatore));
END;
$$;

/** La porta unica: Elisa assegna, gli altri passano da Elisa. */
CREATE OR REPLACE FUNCTION public.consegne_assegna(
  p_per text, p_cosa text, p_ore numeric DEFAULT NULL, p_entro date DEFAULT NULL, p_entro_ora time DEFAULT NULL,
  p_cliente text DEFAULT NULL, p_inizio timestamptz DEFAULT NULL, p_fine timestamptz DEFAULT NULL,
  p_richiedente text DEFAULT NULL, p_conferma boolean DEFAULT false, p_tipo text DEFAULT NULL, p_priorita text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rq public.team%ROWTYPE;
  s public.team%ROWTYPE;
BEGIN
  rq := public.consegne_richiedente(p_richiedente);
  SELECT * INTO s FROM public.team
   WHERE lower(nome) = lower(COALESCE((SELECT NULLIF(btrim(valore), '') FROM motore.config WHERE chiave = 'consegne_smistatore'), ''));
  IF rq.id IS NOT NULL AND s.id IS NOT NULL AND rq.id <> s.id
     AND lower(btrim(COALESCE(p_per, ''))) NOT IN (lower(rq.nome), lower(s.nome)) THEN
    IF rq.ruolo <> 'Admin' THEN
      RETURN jsonb_build_object('ok', false, 'errore', format('%s può mettere lavoro solo a se stesso: ad altri lo assegna %s.', rq.nome, s.nome));
    END IF;
    RETURN public.consegne_proponi(p_per, p_cosa, p_ore, p_entro, p_entro_ora, p_cliente, p_inizio, p_fine,
                                   rq.nome, p_conferma, p_tipo, p_priorita, s.nome);
  END IF;
  RETURN public.consegne_assegna_diretto(p_per, p_cosa, p_ore, p_entro, p_entro_ora, p_cliente, p_inizio, p_fine,
                                         p_richiedente, p_conferma, p_tipo, p_priorita);
END;
$$;

/**
 * Elisa smista un compito passato da Giovanni: così com'è, o con un'altra
 * persona, altre ore, altra consegna. Se entra, il task «Da smistare» va in
 * Fatto e il lavoro vero parte (task del ragazzo + blocchi + messaggi).
 * `p_task`: codice TSK del compito; vuoto = l'unico aperto.
 */
CREATE OR REPLACE FUNCTION public.consegne_smista(p_task text DEFAULT NULL, p_per text DEFAULT NULL, p_ore numeric DEFAULT NULL,
  p_entro date DEFAULT NULL, p_entro_ora time DEFAULT NULL, p_conferma boolean DEFAULT NULL, p_richiedente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rq public.team%ROWTYPE;
  s public.team%ROWTYPE;
  k public.task%ROWTYPE;
  pr jsonb; v jsonb; v_n int;
BEGIN
  rq := public.consegne_richiedente(p_richiedente);
  SELECT * INTO s FROM public.team
   WHERE lower(nome) = lower(COALESCE((SELECT NULLIF(btrim(valore), '') FROM motore.config WHERE chiave = 'consegne_smistatore'), 'Elisa'));
  IF rq.id IS NULL OR (rq.id <> s.id AND rq.ruolo <> 'Admin') THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('I compiti li smista %s.', s.nome));
  END IF;
  IF COALESCE(btrim(p_task), '') <> '' THEN
    SELECT * INTO k FROM public.task WHERE (upper(id_display) = upper(btrim(p_task)) OR id::text = btrim(p_task)) AND proposta IS NOT NULL;
  ELSE
    SELECT count(*) INTO v_n FROM public.task WHERE proposta IS NOT NULL AND stato = 'Da fare';
    IF v_n = 1 THEN SELECT * INTO k FROM public.task WHERE proposta IS NOT NULL AND stato = 'Da fare'; END IF;
  END IF;
  IF k.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Dimmi quale compito smistare.',
      'da_smistare', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', id_display, 'descrizione', descrizione) ORDER BY created_at), '[]'::jsonb)
                        FROM public.task WHERE proposta IS NOT NULL AND stato = 'Da fare'));
  END IF;
  IF k.stato <> 'Da fare' THEN RETURN jsonb_build_object('ok', false, 'errore', format('%s è già %s.', k.id_display, lower(k.stato))); END IF;
  pr := k.proposta;

  PERFORM set_config('consegne.smista', '1', true);
  v := public.consegne_assegna_diretto(
         COALESCE(NULLIF(btrim(p_per), ''), pr->>'per'), pr->>'cosa',
         COALESCE(p_ore, (pr->>'ore')::numeric), COALESCE(p_entro, (pr->>'entro')::date), COALESCE(p_entro_ora, (pr->>'entro_ora')::time),
         pr->>'cliente',
         CASE WHEN p_entro IS NULL THEN (pr->>'inizio')::timestamptz END,
         CASE WHEN p_entro IS NULL THEN (pr->>'fine')::timestamptz END,
         s.nome, COALESCE(p_conferma, (pr->>'conferma')::boolean, false), pr->>'tipo', pr->>'priorita');
  PERFORM set_config('consegne.smista', '', true);

  IF COALESCE((v->>'ok')::boolean, false) THEN
    UPDATE public.task SET stato = 'Fatto', updated_at = now(),
           note = note || E'\n' || format('Smistato da %s: %s a %s.', rq.nome, v->'task'->>'id_display', v->'task'->>'per')
     WHERE id = k.id;
    RETURN v || jsonb_build_object('smistato', k.id_display);
  END IF;
  RETURN v || jsonb_build_object('smistamento', k.id_display, 'nota', 'Il compito resta da smistare.');
END;
$$;

REVOKE ALL ON FUNCTION public.consegne_proponi(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_proponi(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.consegne_assegna(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consegne_assegna(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.consegne_smista(text, text, numeric, date, time, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consegne_smista(text, text, numeric, date, time, boolean, text) TO authenticated, service_role;

-- La giornata mostra anche i compiti da smistare (a Elisa).
CREATE OR REPLACE FUNCTION public.consegne_giornata(p_membro text, p_giorno date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.team%ROWTYPE;
  v_g date := COALESCE(p_giorno, (now() AT TIME ZONE 'Europe/Rome')::date);
BEGIN
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_membro, '')));
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo «%s» nel team.', p_membro)); END IF;
  RETURN jsonb_build_object('ok', true, 'persona', t.nome, 'giorno', v_g,
    'orario', public.consegne_orario_testo(t.id, v_g),
    'ore_timbrate', public.consegne_ore_timbrate(t.nome, v_g),
    'agenda', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI'), 'tipo', c.tipo,
                  'titolo', btrim(regexp_replace(c.descrizione, '\s*\[TASK:[^\]]+\]', '', 'g')), 'cliente', NULLIF(c.cliente_nome, ''),
                  'task', (SELECT k.id_display FROM public.task k WHERE k.id = c.blocco_task_id)) ORDER BY c.inizio_ts), '[]'::jsonb)
                 FROM public.calendario c
                WHERE c.data = v_g AND c.ora IS NOT NULL AND c.tipo <> 'pubblicazione'
                  AND lower(COALESCE(c.stato, '')) NOT IN ('saltato', 'annullato', 'cancellato')
                  AND NOT EXISTS (SELECT 1 FROM public.task k WHERE k.id = c.task_id AND k.pianificato)
                  AND (EXISTS (SELECT 1 FROM public.calendario_persone cp WHERE cp.calendario_id = c.id AND cp.team_id = t.id)
                       OR lower(t.nome) IN (SELECT lower(btrim(x)) FROM unnest(string_to_array(COALESCE(c.persona, ''), ',')) x))),
    'assenze', (SELECT COALESCE(jsonb_agg(c.descrizione), '[]'::jsonb) FROM public.calendario c
                 WHERE c.data = v_g AND c.tipo = 'indisponibilita' AND lower(COALESCE(c.persona, '')) = lower(t.nome)),
    'consegne', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', k.id_display, 'cosa', k.descrizione, 'cliente', NULLIF(k.cliente_nome, ''),
                   'ora', to_char(COALESCE(k.consegna_ora, k.ora), 'HH24:MI'), 'pianificato', k.pianificato) ORDER BY k.consegna_ora NULLS LAST), '[]'::jsonb)
                   FROM public.task k WHERE lower(k.assegnato_a) = lower(t.nome) AND k.scadenza = v_g AND k.stato NOT IN ('Fatto', 'Archiviato')
                    AND k.proposta IS NULL),
    'da_smistare', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id_display', k.id_display, 'descrizione', k.descrizione, 'da', k.assegnato_da, 'verifica', k.note) ORDER BY k.created_at), '[]'::jsonb)
                   FROM public.task k WHERE lower(k.assegnato_a) = lower(t.nome) AND k.proposta IS NOT NULL AND k.stato = 'Da fare'));
END;
$$;

