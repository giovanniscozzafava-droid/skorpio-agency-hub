-- ============================================================================
-- Recupero dei messaggi WhatsApp persi (2/10/2026) e guardie sui task.
--
-- I 26 messaggi arrivati dal 28/09 non sono mai entrati in coda (numero senza
-- «+»). Alberto li rilegge, prepara un elenco numerato di cosa creerebbe e lo
-- manda a Giovanni: niente viene creato finché lui non scrive «sì 1 2 4».
-- Il lavoro da confermare da un altro (es. Alessandro per Sinopoli) resta
-- «in_conferma» finché quella persona non risponde «sì».
-- ============================================================================

CREATE OR REPLACE FUNCTION public.alberto_membro_corrente()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT nome FROM public.team WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.alberto_e_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team WHERE auth_user_id = auth.uid() AND ruolo = 'Admin');
$$;

CREATE TABLE IF NOT EXISTS public.alberto_recupero (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lotto         text NOT NULL,
  n             int  NOT NULL,
  per           text NOT NULL DEFAULT 'Giovanni',            -- a chi è stato mandato l'elenco (chi deve dire sì)
  tipo          text NOT NULL CHECK (tipo IN ('lavoro', 'lavoro_kanban', 'sposta_scadenza', 'risposta', 'domanda', 'evento_fatto')),
  mittente      text,                                        -- chi aveva scritto il messaggio
  messaggio_id  uuid,                                        -- riga whatsapp_messaggi originale (senza FK: evita blocchi sulla tabella dei messaggi)
  descrizione   text NOT NULL,                               -- la riga dell'elenco
  dati          jsonb NOT NULL DEFAULT '{}'::jsonb,
  conferma_da   text,                                        -- chi deve confermare dopo il sì (es. Alessandro)
  stato         text NOT NULL DEFAULT 'proposta' CHECK (stato IN ('proposta', 'in_conferma', 'eseguita', 'scartata', 'errore')),
  risultato     jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  chiusa_alle   timestamptz,
  UNIQUE (lotto, n)
);
ALTER TABLE public.alberto_recupero ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alberto_recupero_admin ON public.alberto_recupero;
CREATE POLICY alberto_recupero_admin ON public.alberto_recupero FOR SELECT TO authenticated USING (public.alberto_e_admin());

-- «sì 1 2 4» / «sì tutti»: esegue solo le proposte indicate, nell'ordine giusto (prima gli impegni, poi i lavori).
CREATE OR REPLACE FUNCTION public.alberto_recupero_esegui(p_membro text, p_arg text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_lotto text;
  v_nums  int[];
  k       record;
  r       jsonb;
  righe   text[] := '{}';
  v_task  uuid; v_disp text; v_cli uuid; v_clin text; v_blocco uuid; v_per uuid;
  v_inizio timestamptz; v_fine timestamptz; v_giorno date;
BEGIN
  SELECT max(lotto) INTO v_lotto FROM public.alberto_recupero WHERE stato = 'proposta' AND lower(per) = lower(p_membro);
  IF v_lotto IS NULL THEN RETURN 'Non ho proposte da confermare.'; END IF;
  IF p_arg IS NOT NULL AND p_arg !~* '^tutt' THEN
    SELECT array_agg(DISTINCT x::int) INTO v_nums FROM unnest(regexp_split_to_array(btrim(regexp_replace(p_arg, '[^0-9]+', ' ', 'g')), ' ')) x WHERE x <> '';
  END IF;

  FOR k IN SELECT * FROM public.alberto_recupero
            WHERE lotto = v_lotto AND stato = 'proposta' AND lower(per) = lower(p_membro) AND (v_nums IS NULL OR n = ANY (v_nums))
            ORDER BY CASE tipo WHEN 'evento_fatto' THEN 1 WHEN 'sposta_scadenza' THEN 2 WHEN 'lavoro_kanban' THEN 3 WHEN 'lavoro' THEN 4 ELSE 5 END, n LOOP
    BEGIN
      IF k.tipo = 'lavoro' THEN
        r := public.consegne_assegna(p_per => k.dati->>'per', p_cosa => k.dati->>'cosa', p_ore => (k.dati->>'ore')::numeric,
               p_entro => (k.dati->>'entro')::date, p_entro_ora => NULLIF(k.dati->>'entro_ora', '')::time,
               p_cliente => NULLIF(k.dati->>'cliente', ''), p_richiedente => p_membro, p_tipo => NULLIF(k.dati->>'tipo_task', ''));
        IF COALESCE((r->>'ok')::boolean, false) THEN
          UPDATE public.alberto_recupero SET stato = 'eseguita', risultato = r, chiusa_alle = now() WHERE id = k.id;
          righe := righe || format('%s. Fatto: %s, %s — in agenda %s, consegna %s. [%s]%s', k.n, r->'task'->>'per', r->'task'->>'cosa',
                     COALESCE(NULLIF(public.consegne_blocchi_testo((r->'task'->>'id')::uuid), ''), '—'),
                     public.consegne_giorno_parole((r->'task'->>'scadenza')::date), r->'task'->>'id_display',
                     CASE WHEN (r->>'da_vidimare')::boolean THEN ' Da vidimare per Elisa.' ELSE '' END);
        ELSE
          UPDATE public.alberto_recupero SET stato = 'errore', risultato = r, chiusa_alle = now() WHERE id = k.id;
          righe := righe || format('%s. NON fatto: %s', k.n, COALESCE(r->>'motivo', r->>'errore', 'errore'));
        END IF;

      ELSIF k.tipo = 'lavoro_kanban' THEN
        SELECT id, nome INTO v_cli, v_clin FROM public.clienti WHERE k.dati->>'cliente' IS NOT NULL AND lower(nome) LIKE '%' || lower(k.dati->>'cliente') || '%' ORDER BY length(nome) LIMIT 1;
        v_disp := public.generate_display_id('TSK', 'task_seq');
        INSERT INTO public.task (id_display, tipo, descrizione, cliente_id, cliente_nome, priorita, stato, assegnato_a, assegnato_da, note)
        VALUES (COALESCE(v_disp, 'TSK' || extract(epoch FROM now())::bigint), COALESCE(k.dati->>'tipo_task', 'Lavoro'), left(k.dati->>'cosa', 300), v_cli, COALESCE(v_clin, ''),
                '🟡 Media', 'Da fare', k.dati->>'per', p_membro, COALESCE(k.dati->>'note', '') || ' Assegnato da ' || p_membro || ' tramite Alberto (recupero messaggio).')
        RETURNING id INTO v_task;
        UPDATE public.alberto_recupero SET stato = 'eseguita', risultato = jsonb_build_object('task_id', v_task, 'id_display', v_disp), chiusa_alle = now() WHERE id = k.id;
        righe := righe || format('%s. Fatto: %s per %s, nel Kanban senza scadenza. [%s]', k.n, k.dati->>'cosa', k.dati->>'per', v_disp);

      ELSIF k.tipo = 'sposta_scadenza' THEN
        UPDATE public.task SET scadenza = (k.dati->>'a')::date WHERE id_display = ANY (ARRAY(SELECT jsonb_array_elements_text(k.dati->'task'))) AND stato NOT IN ('Fatto', 'Archiviato');
        UPDATE public.alberto_recupero SET stato = 'eseguita', risultato = jsonb_build_object('task', k.dati->'task', 'a', k.dati->>'a'), chiusa_alle = now() WHERE id = k.id;
        righe := righe || format('%s. Fatto: spostate a %s: %s.', k.n, public.consegne_giorno_parole((k.dati->>'a')::date), (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(k.dati->'task') x));

      ELSIF k.tipo IN ('risposta', 'domanda') THEN
        PERFORM motore.chiama('consegne', jsonb_build_object('azione', 'alberto_scrivi', 'membro', k.dati->>'a', 'testo', k.dati->>'testo', 'da', p_membro));
        UPDATE public.alberto_recupero SET stato = 'eseguita', risultato = jsonb_build_object('inviato_a', k.dati->>'a'), chiusa_alle = now() WHERE id = k.id;
        righe := righe || format('%s. Fatto: scritto a %s.', k.n, k.dati->>'a');

      ELSIF k.tipo = 'evento_fatto' THEN
        -- L'impegno entra subito in calendario (così il pianificatore lo rispetta); «Fatto» solo quando la persona conferma.
        v_giorno := (k.dati->>'data')::date;
        v_inizio := public.cal_ts(v_giorno, (k.dati->>'ora')::time);
        v_fine   := public.cal_ts(v_giorno, (k.dati->>'ora_fine')::time);
        SELECT id, nome INTO v_cli, v_clin FROM public.clienti WHERE lower(nome) LIKE '%' || lower(k.dati->>'cliente') || '%' ORDER BY length(nome) LIMIT 1;
        SELECT id INTO v_per FROM public.team WHERE lower(nome) = lower(k.dati->>'per');
        v_disp := public.generate_display_id('TSK', 'task_seq');
        PERFORM set_config('consegne.in_corso', '1', true);
        INSERT INTO public.task (id_display, tipo, descrizione, cliente_id, cliente_nome, priorita, stato, assegnato_a, assegnato_da, scadenza, note,
                                 ore_stimate, consegna_ora, pianificato)
        VALUES (COALESCE(v_disp, 'TSK' || extract(epoch FROM now())::bigint), 'Riprese', left(k.dati->>'cosa', 300), v_cli, COALESCE(v_clin, ''), '🟡 Media', 'Da fare',
                k.dati->>'per', p_membro, v_giorno, 'Impegno comunicato da ' || p_membro || ' su WhatsApp (messaggio del ' || COALESCE(k.dati->>'detto_il', '') || '). In attesa di conferma di ' || (k.dati->>'per') || '.',
                round(extract(epoch FROM v_fine - v_inizio) / 3600.0, 2), (k.dati->>'ora_fine')::time, true)
        RETURNING id INTO v_task;
        INSERT INTO public.calendario (tipo, origine, stato, descrizione, data, ora, ora_fine, tutto_il_giorno, persona, cliente_id, cliente_nome, blocco_task_id, blocco_fisso, note, ospiti)
        VALUES ('lavoro', 'manuale', 'Pianificato', left(k.dati->>'cosa', 120), v_giorno, (k.dati->>'ora')::time, (k.dati->>'ora_fine')::time, false, k.dati->>'per',
                v_cli, COALESCE(v_clin, ''), v_task, true, 'Impegno comunicato da ' || p_membro || ' (task ' || COALESCE(v_disp, '') || ').', '{}')
        RETURNING id INTO v_blocco;
        IF v_per IS NOT NULL THEN INSERT INTO public.calendario_persone (calendario_id, team_id) VALUES (v_blocco, v_per) ON CONFLICT DO NOTHING; END IF;
        PERFORM set_config('consegne.in_corso', '', true);
        UPDATE public.alberto_recupero SET stato = 'in_conferma', conferma_da = k.dati->>'per',
               risultato = jsonb_build_object('task_id', v_task, 'id_display', v_disp, 'calendario_id', v_blocco) WHERE id = k.id;
        PERFORM motore.chiama('consegne', jsonb_build_object('azione', 'alberto_scrivi', 'membro', k.dati->>'per', 'da', 'Alberto',
          'testo', format('%s, %s mi ha scritto che %s dalle %s alle %s eri da %s a fare %s. È andata così? Rispondi «sì» e lo segno come fatto, «no» e lo tolgo dal calendario.',
                          k.dati->>'per', p_membro, CASE WHEN v_giorno = (now() AT TIME ZONE 'Europe/Rome')::date THEN 'oggi' ELSE to_char(v_giorno, 'DD/MM') END,
                          to_char((k.dati->>'ora')::time, 'HH24:MI'), to_char((k.dati->>'ora_fine')::time, 'HH24:MI'), COALESCE(v_clin, k.dati->>'cliente'), COALESCE(k.dati->>'attivita', 'il lavoro'))));
        righe := righe || format('%s. Messo in calendario (%s %s-%s, [%s]) e chiesto a %s di confermare: lo segno «fatto» solo se dice sì.', k.n, public.consegne_giorno_parole(v_giorno),
                   to_char((k.dati->>'ora')::time, 'HH24:MI'), to_char((k.dati->>'ora_fine')::time, 'HH24:MI'), v_disp, k.dati->>'per');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('consegne.in_corso', '', true);
      UPDATE public.alberto_recupero SET stato = 'errore', risultato = jsonb_build_object('errore', SQLERRM), chiusa_alle = now() WHERE id = k.id;
      righe := righe || format('%s. NON fatto: %s', k.n, SQLERRM);
    END;
  END LOOP;

  IF cardinality(righe) = 0 THEN RETURN 'Nessuna proposta con quei numeri.'; END IF;
  RETURN array_to_string(righe, E'\n');
END;
$$;

-- «no» / «no 3 5»: scarta.
CREATE OR REPLACE FUNCTION public.alberto_recupero_scarta(p_membro text, p_arg text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_lotto text; v_nums int[]; v_n int;
BEGIN
  SELECT max(lotto) INTO v_lotto FROM public.alberto_recupero WHERE stato = 'proposta' AND lower(per) = lower(p_membro);
  IF v_lotto IS NULL THEN RETURN 'Non ho proposte da scartare.'; END IF;
  IF p_arg IS NOT NULL THEN
    SELECT array_agg(DISTINCT x::int) INTO v_nums FROM unnest(regexp_split_to_array(btrim(regexp_replace(p_arg, '[^0-9]+', ' ', 'g')), ' ')) x WHERE x <> '';
  END IF;
  UPDATE public.alberto_recupero SET stato = 'scartata', chiusa_alle = now()
   WHERE lotto = v_lotto AND stato = 'proposta' AND lower(per) = lower(p_membro) AND (v_nums IS NULL OR n = ANY (v_nums));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN format('Scartate %s proposte.%s', v_n, CASE WHEN EXISTS (SELECT 1 FROM public.alberto_recupero WHERE lotto = v_lotto AND stato = 'proposta' AND lower(per) = lower(p_membro))
                                                   THEN ' Restano ancora delle proposte: «sì 1 2» per confermare.' ELSE '' END);
END;
$$;

-- La persona risponde «sì» / «no» all'impegno: sì → task Fatto e blocco Completato; no → tolto dal calendario.
CREATE OR REPLACE FUNCTION public.alberto_recupero_conferma(p_membro text, p_si boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE k record; righe text[] := '{}';
BEGIN
  FOR k IN SELECT * FROM public.alberto_recupero WHERE stato = 'in_conferma' AND lower(conferma_da) = lower(p_membro) ORDER BY created_at LOOP
    PERFORM set_config('consegne.in_corso', '1', true);
    IF p_si THEN
      UPDATE public.calendario SET stato = 'Completato' WHERE id = (k.risultato->>'calendario_id')::uuid;
      UPDATE public.task SET stato = 'Fatto' WHERE id = (k.risultato->>'task_id')::uuid;
      UPDATE public.alberto_recupero SET stato = 'eseguita', chiusa_alle = now() WHERE id = k.id;
      righe := righe || format('Segnato come fatto: %s (%s %s-%s).', k.dati->>'cosa', public.consegne_giorno_parole((k.dati->>'data')::date), left(k.dati->>'ora', 5), left(k.dati->>'ora_fine', 5));
    ELSE
      UPDATE public.calendario SET stato = 'Annullato' WHERE id = (k.risultato->>'calendario_id')::uuid;
      UPDATE public.task SET stato = 'Archiviato' WHERE id = (k.risultato->>'task_id')::uuid;
      UPDATE public.alberto_recupero SET stato = 'scartata', chiusa_alle = now() WHERE id = k.id;
      righe := righe || format('Tolto dal calendario: %s.', k.dati->>'cosa');
    END IF;
    PERFORM set_config('consegne.in_corso', '', true);
  END LOOP;
  RETURN COALESCE(array_to_string(righe, E'\n'), 'Non c''è niente da confermare.');
END;
$$;

REVOKE ALL ON FUNCTION public.alberto_recupero_esegui(text, text), public.alberto_recupero_scarta(text, text), public.alberto_recupero_conferma(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alberto_recupero_esegui(text, text), public.alberto_recupero_scarta(text, text), public.alberto_recupero_conferma(text, boolean) TO service_role;

-- consegne_comando: «sì 1 2 4», «sì tutti», «no», e il «sì» di chi deve confermare.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.consegne_comando(text,text)'::regprocedure);
  n := replace(d, $a$  tl := lower(t);
$a$, $b$  tl := lower(t);

  IF EXISTS (SELECT 1 FROM public.alberto_recupero WHERE stato = 'in_conferma' AND lower(conferma_da) = lower(p_mittente)) THEN
    IF tl ~ '^(s[ìi]|confermo|certo|esatto|ok)[ .!]*$' THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', public.alberto_recupero_conferma(p_mittente, true));
    ELSIF tl ~ '^no[ .!]*$' THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', public.alberto_recupero_conferma(p_mittente, false));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.alberto_recupero WHERE stato = 'proposta' AND lower(per) = lower(p_mittente)) THEN
    m := regexp_match(tl, '^(?:s[ìi]|vai)[ ,]+(tutt[ei]|[0-9][0-9 ,e]*)[ .!]*$');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', public.alberto_recupero_esegui(p_mittente, m[1]));
    END IF;
    IF tl ~ '^(s[ìi]|vai)[ .!]*$' THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', 'Quali? Scrivi «sì 1 2 4» per quelle che vuoi, «sì tutti» per tutte, «no» per scartarle.');
    END IF;
    m := regexp_match(tl, '^no(?:[ ,]+([0-9][0-9 ,e]*))?[ .!]*$');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', public.alberto_recupero_scarta(p_mittente, m[1]));
    END IF;
  END IF;
$b$);
  IF n = d THEN RAISE EXCEPTION 'consegne_comando non modificato'; END IF;
  EXECUTE n;
END $$;
