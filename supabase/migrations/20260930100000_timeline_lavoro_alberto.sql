-- ============================================================================
-- Timeline del lavoro: Alberto su WhatsApp (30/09/2026)
-- ============================================================================
-- 1. Ogni lavoro assegnato o spostato resta scritto nella conversazione di chi
--    l'ha chiesto (whatsapp_messaggi, direzione «azione»), come gli
--    appuntamenti: se un messaggio viene rielaborato (Banco caduto, poi API),
--    Alberto vede che è già fatto e non lo rifà.
-- 2. Il Banco sul Mac prende i messaggi solo se la sua versione conosce gli
--    strumenti del lavoro (motore.config.alberto_banco_versione_minima). Un
--    Banco vecchio risponderebbe «da WhatsApp gestisco solo appuntamenti»:
--    finché non è aggiornato risponde l'API di riserva. Per tornare subito al
--    Banco: UPDATE motore.config SET valore = '' WHERE chiave = 'alberto_banco_versione_minima';
-- 3. Elisa comanda Alberto da WhatsApp (è lei che dà la lista del giorno).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consegne_registra_azione()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT NEW.pianificato THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.alberto_registra_azione(NEW.assegnato_da, 'eseguito',
      format('Assegnato %s a %s: «%s», consegna %s%s.', NEW.id_display, NEW.assegnato_a, left(NEW.descrizione, 120),
             to_char(NEW.scadenza, 'YYYY-MM-DD'), COALESCE(' entro le ' || to_char(NEW.consegna_ora, 'HH24:MI'), '')),
      jsonb_build_object('rpc', 'consegne_assegna', 'task', NEW.id_display, 'task_id', NEW.id));
  ELSIF NEW.scadenza IS DISTINCT FROM OLD.scadenza OR NEW.consegna_ora IS DISTINCT FROM OLD.consegna_ora THEN
    PERFORM public.alberto_registra_azione(NEW.assegnato_da, 'eseguito',
      format('Spostata la consegna di %s («%s») a %s%s.', NEW.id_display, left(NEW.descrizione, 120),
             to_char(NEW.scadenza, 'YYYY-MM-DD'), COALESCE(' entro le ' || to_char(NEW.consegna_ora, 'HH24:MI'), '')),
      jsonb_build_object('rpc', 'consegne_sposta', 'task', NEW.id_display, 'task_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consegne_registra_azione ON public.task;
CREATE TRIGGER consegne_registra_azione AFTER INSERT OR UPDATE OF scadenza, consegna_ora ON public.task
  FOR EACH ROW EXECUTE FUNCTION public.consegne_registra_azione();

-- Vuoto = il Banco prende tutto (stato attuale). Messo a '1.1.0' il 30/09 e
-- tolto un'ora dopo: l'API di riserva non ha credito Anthropic, e senza Banco
-- Alberto su WhatsApp restava muto. Si alza quando il Banco sul Mac ha il nuovo
-- albertoWhatsapp.mjs e dichiara versione 1.1.0 in banco_stato.
INSERT INTO motore.config (chiave, valore)
SELECT 'alberto_banco_versione_minima', ''
WHERE NOT EXISTS (SELECT 1 FROM motore.config WHERE chiave = 'alberto_banco_versione_minima');

/** Il Banco ha la versione che serve? «1.0.0» < «1.1.0»; minimo vuoto = sempre sì. */
CREATE OR REPLACE FUNCTION public.alberto_banco_aggiornato()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(NULLIF((SELECT valore FROM motore.config WHERE chiave = 'alberto_banco_versione_minima'), '') IS NULL, false)
      OR COALESCE((SELECT string_to_array(regexp_replace(versione, '[^0-9.]', '', 'g'), '.')::int[] FROM public.banco_stato WHERE id = 'banco'), '{0}')
         >= string_to_array((SELECT valore FROM motore.config WHERE chiave = 'alberto_banco_versione_minima'), '.')::int[];
$$;

CREATE OR REPLACE FUNCTION public.alberto_banco_vivo(p_secondi integer DEFAULT 60)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT ultimo_battito > now() - make_interval(secs => p_secondi) FROM public.banco_stato WHERE id = 'banco'), false)
     AND public.alberto_banco_aggiornato();
$$;

CREATE OR REPLACE FUNCTION public.alberto_coda_prendi(p_da text, p_max integer DEFAULT 1, p_eta_min_secondi integer DEFAULT 0)
RETURNS SETOF alberto_coda LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.alberto_coda c
     SET stato = 'preso', preso_da = p_da, preso_alle = now(), tentativi = c.tentativi + 1
   WHERE c.id IN (
     SELECT id FROM public.alberto_coda
      WHERE stato = 'in_attesa'
        AND creato_alle <= now() - make_interval(secs => GREATEST(p_eta_min_secondi, 0))
        AND (p_da <> 'banco' OR public.alberto_banco_aggiornato())
      ORDER BY creato_alle
      LIMIT GREATEST(p_max, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
$$;

UPDATE public.team_whatsapp SET comandi_alberto = true, updated_at = now() WHERE membro = 'Elisa' AND NOT comandi_alberto;
