-- ============================================================================
-- Più Banchi (30/09/2026). Il Banco di Sant'Elia (id 'banco', versione 1.0.0,
-- strumenti vecchi) resta acceso e non si può aggiornare da remoto; sul Mac
-- dello studio parte un secondo Banco aggiornato (id 'banco-studio', 1.1.0).
-- Regola: prende la coda il Banco aggiornato; un Banco vecchio la prende solo
-- se nessun Banco aggiornato è vivo (riserva). Ogni Banco usa il proprio id
-- sia nel battito (banco_stato.id) sia in alberto_coda_prendi(p_da).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.alberto_banco_versione_ok(p_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(NULLIF((SELECT valore FROM motore.config WHERE chiave = 'alberto_banco_versione_minima'), '') IS NULL, false)
      OR COALESCE((SELECT string_to_array(regexp_replace(versione, '[^0-9.]', '', 'g'), '.')::int[] FROM public.banco_stato WHERE id = p_id), '{0}')
         >= string_to_array((SELECT valore FROM motore.config WHERE chiave = 'alberto_banco_versione_minima'), '.')::int[];
$$;

/** C'è almeno un Banco aggiornato con il battito fresco? */
CREATE OR REPLACE FUNCTION public.alberto_banco_aggiornato_vivo(p_secondi integer DEFAULT 60)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banco_stato
                  WHERE id LIKE 'banco%' AND ultimo_battito > now() - make_interval(secs => p_secondi)
                    AND public.alberto_banco_versione_ok(id));
$$;

-- Compatibilità: il Banco di Sant'Elia (id 'banco').
CREATE OR REPLACE FUNCTION public.alberto_banco_aggiornato()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.alberto_banco_versione_ok('banco');
$$;

/** Il webhook sveglia i Banchi se almeno uno è vivo (aggiornato, o vecchio come riserva). */
CREATE OR REPLACE FUNCTION public.alberto_banco_vivo(p_secondi integer DEFAULT 60)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banco_stato WHERE id LIKE 'banco%' AND ultimo_battito > now() - make_interval(secs => p_secondi));
$$;

CREATE OR REPLACE FUNCTION public.alberto_coda_prendi(p_da text, p_max integer DEFAULT 1, p_eta_min_secondi integer DEFAULT 0)
RETURNS SETOF public.alberto_coda LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.alberto_coda c
     SET stato = 'preso', preso_da = p_da, preso_alle = now(), tentativi = c.tentativi + 1
   WHERE c.id IN (
     SELECT id FROM public.alberto_coda
      WHERE stato = 'in_attesa'
        AND creato_alle <= now() - make_interval(secs => GREATEST(p_eta_min_secondi, 0))
        AND (p_da NOT LIKE 'banco%'
             OR public.alberto_banco_versione_ok(p_da)
             OR NOT public.alberto_banco_aggiornato_vivo(60))
      ORDER BY creato_alle
      LIMIT GREATEST(p_max, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
$$;

REVOKE ALL ON FUNCTION public.alberto_banco_versione_ok(text) FROM anon;
REVOKE ALL ON FUNCTION public.alberto_banco_aggiornato_vivo(integer) FROM anon;

-- Da adesso conta la versione: 1.1.0 = strumenti del lavoro (vidima, riassegna…).
UPDATE motore.config SET valore = '1.1.0' WHERE chiave = 'alberto_banco_versione_minima';
