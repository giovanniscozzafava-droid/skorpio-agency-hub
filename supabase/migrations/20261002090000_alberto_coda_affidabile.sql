-- ============================================================================
-- Alberto su WhatsApp non perde più messaggi (2/10/2026).
--
-- Cause trovate sul database:
--  1. Dal 28/09 al 2/10 mattina nessun messaggio reale è entrato in coda: il
--     webhook cercava il numero con il «+» (+393…), Kapso lo manda senza (393…).
--     Corretto il 1/10 (webhook v9); i 26 messaggi persi si recuperano a mano.
--  2. Con la coda funzionante, il Banco ha fallito («claude uscito con 1»), la
--     riga è andata in «errore» dopo 3 tentativi e nessuno l'ha più ripresa;
--     l'API di riserva, senza credito, rispondeva «Riprova tra un minuto» e
--     chiudeva la riga come fatta.
--  3. Il vincolo di alberto_coda.preso_da ammetteva solo 'banco' e 'api': un
--     secondo Banco (banco-studio) sarebbe stato respinto dal database.
--
-- Regole nuove: una riga si riprova ogni minuto per 30 minuti; chi ha scritto
-- riceve una conferma dopo 1 minuto; dopo 30 minuti si avvisa Giovanni.
-- ============================================================================

ALTER TABLE public.alberto_coda DROP CONSTRAINT IF EXISTS alberto_coda_preso_da_check;
ALTER TABLE public.alberto_coda ADD CONSTRAINT alberto_coda_preso_da_check
  CHECK (preso_da IS NULL OR preso_da ~ '^(banco(-[a-z0-9]+)?|api)$');

ALTER TABLE public.whatsapp_messaggi DROP CONSTRAINT IF EXISTS whatsapp_messaggi_stato_check;
ALTER TABLE public.whatsapp_messaggi ADD CONSTRAINT whatsapp_messaggi_stato_check
  CHECK (stato = ANY (ARRAY['inviato','consegnato','letto','fallito','ricevuto','eseguito','proposto','rifiutato','risposto']));

ALTER TABLE public.alberto_coda
  ADD COLUMN IF NOT EXISTS riprova_dopo  timestamptz,
  ADD COLUMN IF NOT EXISTS ack_alle      timestamptz,
  ADD COLUMN IF NOT EXISTS avvisato_alle timestamptz;

-- Chi prende la coda: un Banco vecchio solo se nessun Banco aggiornato è vivo; mai prima di riprova_dopo.
CREATE OR REPLACE FUNCTION public.alberto_coda_prendi(p_da text, p_max integer DEFAULT 1, p_eta_min_secondi integer DEFAULT 0)
RETURNS SETOF public.alberto_coda LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.alberto_coda c
     SET stato = 'preso', preso_da = p_da, preso_alle = now(), tentativi = c.tentativi + 1
   WHERE c.id IN (
     SELECT id FROM public.alberto_coda
      WHERE stato = 'in_attesa'
        AND creato_alle <= now() - make_interval(secs => GREATEST(p_eta_min_secondi, 0))
        AND (riprova_dopo IS NULL OR riprova_dopo <= now())
        AND (p_da NOT LIKE 'banco%'
             OR public.alberto_banco_versione_ok(p_da)
             OR NOT public.alberto_banco_aggiornato_vivo(60))
      ORDER BY creato_alle
      LIMIT GREATEST(p_max, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
$$;

-- Un fallimento non chiude più la riga: torna in coda fra un minuto, per 30 minuti dal messaggio.
CREATE OR REPLACE FUNCTION public.alberto_coda_chiudi(p_id uuid, p_ok boolean, p_errore text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.alberto_coda c
     SET stato = CASE WHEN p_ok THEN 'fatto'
                      WHEN c.creato_alle > now() - interval '30 minutes' THEN 'in_attesa'
                      ELSE 'errore' END,
         errore = p_errore,
         riprova_dopo = CASE WHEN NOT p_ok AND c.creato_alle > now() - interval '30 minutes'
                             THEN now() + interval '60 seconds' END
   WHERE c.id = p_id AND c.stato = 'preso';
$$;

CREATE OR REPLACE FUNCTION public.alberto_watchdog()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_attesa INT;
  v_anon   TEXT;
  v_segr   TEXT;
BEGIN
  -- Presa da più di 60 s e mai chiusa (Banco spento a metà): torna in coda, finché ha meno di 30 minuti.
  UPDATE public.alberto_coda
     SET stato = CASE WHEN creato_alle > now() - interval '30 minutes' THEN 'in_attesa' ELSE 'errore' END,
         errore = CASE WHEN creato_alle > now() - interval '30 minutes' THEN errore ELSE 'Nessuna risposta in 30 minuti.' END,
         riprova_dopo = NULL
   WHERE stato = 'preso' AND preso_alle < now() - interval '60 seconds';

  SELECT count(*) INTO v_attesa FROM public.alberto_coda
   WHERE stato = 'in_attesa' AND creato_alle < now() - interval '60 seconds'
     AND (riprova_dopo IS NULL OR riprova_dopo <= now());
  IF v_attesa = 0 THEN RETURN 0; END IF;

  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;
  SELECT decrypted_secret INTO v_segr FROM vault.decrypted_secrets WHERE name = 'INTERNAL_FUNCTION_SECRET' LIMIT 1;
  IF v_anon IS NULL OR v_segr IS NULL THEN
    RAISE WARNING 'alberto_watchdog: manca anon_key o INTERNAL_FUNCTION_SECRET nel Vault';
    RETURN 0;
  END IF;

  PERFORM net.http_post(
    url := 'https://wkhusguhmkxzzavpsqwz.supabase.co/functions/v1/alberto-api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon,
                                  'Authorization', 'Bearer ' || v_anon, 'x-internal-secret', v_segr),
    body := jsonb_build_object('eta_min_secondi', 60),
    timeout_milliseconds := 120000);
  RETURN v_attesa;
END;
$$;

-- Cosa ha fatto Alberto per un messaggio: task, eventi e azioni dal momento in cui l'ha preso.
CREATE OR REPLACE FUNCTION public.alberto_azione_riassunto(p_mittente text, p_dal timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'task', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'id_display', t.id_display, 'cosa', t.descrizione,
                                                         'per', t.assegnato_a, 'scadenza', t.scadenza) ORDER BY t.created_at)
                        FROM public.task t
                       WHERE t.created_at >= p_dal AND lower(t.assegnato_da) = lower(p_mittente)
                         AND COALESCE(t.note, '') LIKE '%tramite Alberto%'), '[]'::jsonb),
    'eventi', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'titolo', c.descrizione, 'data', c.data,
                                                           'ora', to_char(c.ora, 'HH24:MI')) ORDER BY c.created_at)
                          FROM public.calendario c
                         WHERE c.created_at >= p_dal AND c.tipo = 'appuntamento'
                           AND COALESCE(c.note, '') LIKE '%Inserito da Alberto%'), '[]'::jsonb),
    'azioni', COALESCE((SELECT jsonb_agg(jsonb_build_object('testo', left(a.testo, 160), 'rpc', a.azione->>'rpc',
                                                           'task_id', a.azione->>'task_id') ORDER BY a.created_at)
                          FROM public.whatsapp_messaggi a
                         WHERE a.direzione = 'azione' AND lower(COALESCE(a.membro, '')) = lower(p_mittente)
                           AND a.created_at >= p_dal), '[]'::jsonb));
$$;

-- La riga del messaggio segue la coda: ricevuto → letto (preso) → risposto (fatto, con cosa ha creato).
CREATE OR REPLACE FUNCTION public.alberto_coda_sync_messaggio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.messaggio_id IS NULL OR NEW.stato IS NOT DISTINCT FROM OLD.stato THEN RETURN NEW; END IF;
  IF NEW.stato = 'preso' THEN
    UPDATE public.whatsapp_messaggi SET stato = 'letto' WHERE id = NEW.messaggio_id AND stato = 'ricevuto';
  ELSIF NEW.stato = 'fatto' THEN
    UPDATE public.whatsapp_messaggi
       SET stato = 'risposto',
           azione = COALESCE(azione, '{}'::jsonb) || public.alberto_azione_riassunto(NEW.mittente, COALESCE(NEW.preso_alle, NEW.creato_alle))
     WHERE id = NEW.messaggio_id;
  ELSIF NEW.stato = 'errore' THEN
    UPDATE public.whatsapp_messaggi
       SET azione = COALESCE(azione, '{}'::jsonb) || jsonb_build_object('errore', COALESCE(NEW.errore, 'non elaborato'))
     WHERE id = NEW.messaggio_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS alberto_coda_sync_messaggio ON public.alberto_coda;
CREATE TRIGGER alberto_coda_sync_messaggio AFTER UPDATE OF stato ON public.alberto_coda
  FOR EACH ROW EXECUTE FUNCTION public.alberto_coda_sync_messaggio();

-- I comandi a sintassi fissa, con la riga del messaggio aggiornata (risposto + cosa è stato toccato).
CREATE OR REPLACE FUNCTION public.consegne_comando_log(p_mittente text, p_testo text, p_messaggio_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r jsonb;
  v_az jsonb;
BEGIN
  r := public.consegne_comando(p_mittente, p_testo);
  IF COALESCE((r->>'gestito')::boolean, false) THEN
    v_az := jsonb_build_object('comando', true,
      'task', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'id_display', t.id_display, 'cosa', t.descrizione, 'per', t.assegnato_a))
                          FROM public.task t WHERE t.created_at = now() OR t.updated_at = now()), '[]'::jsonb));
    IF p_messaggio_id IS NOT NULL THEN
      UPDATE public.whatsapp_messaggi SET stato = 'risposto', azione = v_az WHERE id = p_messaggio_id;
    END IF;
    r := r || jsonb_build_object('azione', v_az);
  END IF;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.consegne_comando_log(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_comando_log(text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.alberto_azione_riassunto(text, timestamptz) FROM PUBLIC, anon;

-- Ripescaggio automatico solo da adesso: i messaggi persi fino a oggi si recuperano con l'elenco da confermare.
INSERT INTO motore.config (chiave, valore) VALUES ('alberto_ripesca_dal', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chiave) DO NOTHING;

-- I due messaggi falliti stamattina (un «Ok» e la domanda di Elisa) non devono generare un avviso: li copre l'elenco di recupero.
UPDATE public.alberto_coda SET avvisato_alle = now() WHERE stato = 'errore' AND avvisato_alle IS NULL;

SELECT cron.schedule('alberto-ritardi', '* * * * *',
  $$SELECT motore.chiama('consegne', '{"azione":"alberto_ritardi","da":"cron"}'::jsonb);$$);
