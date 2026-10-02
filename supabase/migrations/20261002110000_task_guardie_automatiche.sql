-- ============================================================================
-- Due bug dell'app chiusi nel database (2/10/2026), così valgono per qualunque
-- versione dell'app aperta sui computer del team.
--
-- 1. Task «Cleanup» creati dal sistema anche con l'interruttore
--    feature_flags.auto_cleanup_task spento (spento il 27/09): l'app ne creava
--    lo stesso (TSK4050, 4051, 4054 il 1/10) perché non tutti i suoi percorsi
--    (checkAutoPubblica, faseService, completaTaskEAvanzaFase) leggono il flag.
-- 2. «Alert Quota» creato più volte (4 in 6 minuti il 30/09): l'app cercava
--    l'id_display del cliente dentro una descrizione che contiene il nome,
--    quindi il controllo non trovava mai l'alert già creato e ne apriva uno a
--    ogni apertura della pagina Clienti. Ora: un alert per mese e cliente,
--    anche se Elisa l'ha già chiuso.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.task_guardie_automatiche()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_attivo boolean;
  v_mese   text;
  v_resto  text;
  m        text[];
  v_nuovi  text[] := '{}';
  v_tutti  int := 0;
BEGIN
  IF NEW.tipo = 'Cleanup' AND COALESCE(NEW.assegnato_da, '') ILIKE '%Sistema%' THEN
    SELECT attivo INTO v_attivo FROM public.feature_flags WHERE id = 'auto_cleanup_task';
    IF COALESCE(v_attivo, true) = false THEN RETURN NULL; END IF;
  END IF;

  IF NEW.tipo = 'Alert Quota' THEN
    v_mese := COALESCE((regexp_match(NEW.descrizione, '\((\d{4}-\d{2})\)'))[1], to_char(COALESCE(NEW.scadenza, current_date), 'YYYY-MM'));
    PERFORM pg_advisory_xact_lock(hashtext('alert_quota:' || v_mese));
    v_resto := substring(NEW.descrizione from position(': ' in NEW.descrizione) + 2);
    FOR m IN SELECT regexp_matches(v_resto, '(?:^|, )(.+?) (\d+/\d+)(?=, |$)', 'g') LOOP
      v_tutti := v_tutti + 1;
      IF NOT EXISTS (
        SELECT 1 FROM public.task e
         WHERE e.tipo = 'Alert Quota' AND e.descrizione LIKE '%(' || v_mese || ')%'
           AND position(', ' || m[1] || ' ' in ', ' || substring(e.descrizione from position(': ' in e.descrizione) + 2)) > 0
      ) THEN
        v_nuovi := v_nuovi || (m[1] || ' ' || m[2]);
      END IF;
    END LOOP;
    IF v_tutti = 0 THEN
      IF EXISTS (SELECT 1 FROM public.task e WHERE e.tipo = 'Alert Quota' AND e.descrizione = NEW.descrizione) THEN RETURN NULL; END IF;
    ELSIF cardinality(v_nuovi) = 0 THEN
      RETURN NULL;
    ELSIF cardinality(v_nuovi) < v_tutti THEN
      NEW.descrizione := '⚠️ Quota Reel insufficiente (' || v_mese || '): ' || array_to_string(v_nuovi, ', ');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_task_guardie_automatiche ON public.task;
CREATE TRIGGER a_task_guardie_automatiche BEFORE INSERT ON public.task
  FOR EACH ROW EXECUTE FUNCTION public.task_guardie_automatiche();
