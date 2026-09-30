-- Quando il pianificatore riordina il lavoro di una persona (una consegna
-- anticipata, un lavoro nuovo che non entrava), anche i lavori che hanno
-- cambiato orario vanno comunicati: prima partiva il messaggio solo per quello
-- toccato. (Prova in produzione del 30/09/2026: Roxy anticipato, KALEA spostato
-- a domani senza avviso.) Il chiamante esclude il task che avvisa già lui.
CREATE OR REPLACE FUNCTION public.consegne_riordina(p_team uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_nome text;
  k record;
  r jsonb;
  v_tutti jsonb := '[]'::jsonb;
  v_non jsonb := '[]'::jsonb;
  v_prima jsonb;
  v_dopo text;
BEGIN
  SELECT nome INTO v_nome FROM public.team WHERE id = p_team;
  SELECT COALESCE(jsonb_object_agg(t.id::text, t.firma), '{}'::jsonb) INTO v_prima FROM (
    SELECT k2.id, string_agg(c.inizio_ts::text || '/' || c.fine_ts::text, ',' ORDER BY c.inizio_ts) firma
      FROM public.task k2 LEFT JOIN public.calendario c ON c.blocco_task_id = k2.id AND c.fine_ts > now()
     WHERE lower(k2.assegnato_a) = lower(v_nome) AND k2.pianificato AND k2.stato NOT IN ('Fatto', 'Archiviato')
     GROUP BY k2.id) t;
  DELETE FROM public.calendario c USING public.task k2
   WHERE c.blocco_task_id = k2.id AND NOT c.blocco_fisso AND c.inizio_ts >= now()
     AND lower(k2.assegnato_a) = lower(v_nome) AND k2.pianificato AND k2.stato NOT IN ('Fatto', 'Archiviato');
  FOR k IN SELECT id FROM public.task
            WHERE lower(assegnato_a) = lower(v_nome) AND pianificato AND stato NOT IN ('Fatto', 'Archiviato') AND scadenza IS NOT NULL
            ORDER BY public.consegne_limite(p_team, scadenza, consegna_ora), created_at LOOP
    r := public.consegne_pianifica_task(k.id);
    v_tutti := v_tutti || r;
    IF (r->>'mancano')::numeric > 0 THEN v_non := v_non || r; END IF;
    SELECT string_agg(c.inizio_ts::text || '/' || c.fine_ts::text, ',' ORDER BY c.inizio_ts) INTO v_dopo
      FROM public.calendario c WHERE c.blocco_task_id = k.id AND c.fine_ts > now();
    IF v_prima ? k.id::text AND (v_prima->>k.id::text) IS DISTINCT FROM v_dopo
       AND k.id::text IS DISTINCT FROM current_setting('consegne.avvisa_gia', true) THEN
      PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', k.id, 'motivo', 'spostato', 'riordino', true));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_non) = 0, 'lavori', v_tutti, 'non_entrano', v_non);
END;
$$;
REVOKE ALL ON FUNCTION public.consegne_riordina(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_riordina(uuid) TO service_role;

-- Il task di cui si sposta la consegna lo avvisa già chi lo sposta: il
-- riordino non manda un secondo messaggio per lo stesso. Il trigger di
-- registrazione scatta prima del riordino (ordine alfabetico dei trigger).
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
    PERFORM set_config('consegne.avvisa_gia', NEW.id::text, true);
    PERFORM public.alberto_registra_azione(NEW.assegnato_da, 'eseguito',
      format('Spostata la consegna di %s («%s») a %s%s.', NEW.id_display, left(NEW.descrizione, 120),
             to_char(NEW.scadenza, 'YYYY-MM-DD'), COALESCE(' entro le ' || to_char(NEW.consegna_ora, 'HH24:MI'), '')),
      jsonb_build_object('rpc', 'consegne_sposta', 'task', NEW.id_display, 'task_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
