-- ============================================================================
-- Alberto capisce gli ordini scritti in italiano senza modello, e la pagina WhatsApp (2/10/2026).
--
-- Finché il cervello (Banco/API) non risponde, le frasi di tutti i giorni le
-- capisce il database con regole esatte; tutto il resto va al cervello.
--   «Luca deve montare il reel di Roxy entro venerdì»  → chiede UNA cosa se manca (ore, poi scadenza)
--   «3 ore» / «entro martedì alle 17:30»               → risposta alla domanda (30 minuti)
--   «spostalo a lunedì»                                → l'ultimo lavoro messo da chi scrive nelle ultime 6 ore
-- Chi può dare lavoro lo decide consegne_assegna (Giovanni → da vidimare, Elisa → diretto).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.alberto_pendenti (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membro  text NOT NULL,
  tipo    text NOT NULL DEFAULT 'ordine',
  dati    jsonb NOT NULL DEFAULT '{}'::jsonb,
  creato  timestamptz NOT NULL DEFAULT now(),
  chiuso  boolean NOT NULL DEFAULT false
);
ALTER TABLE public.alberto_pendenti ENABLE ROW LEVEL SECURITY;   -- nessuna policy: lo usa solo il server

CREATE OR REPLACE FUNCTION public.consegne_ordine_libero(p_mittente text, p_testo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t  text := btrim(regexp_replace(COALESCE(p_testo, ''), '\s+', ' ', 'g'));
  tl text := lower(btrim(regexp_replace(COALESCE(p_testo, ''), '\s+', ' ', 'g')));
  m  text[]; mm text[];
  pend public.alberto_pendenti%ROWTYPE;
  v_per text; v_resto text; v_cosa text; v_ore numeric; v_giorno date; v_ora time; v_ultimo text; v_manca text;
  GIORNI constant text := 'oggi|dopodomani|domani|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|\d{1,2}/\d{1,2}(?:/\d{2,4})?';
BEGIN
  -- A. risposta a una domanda in sospeso (ore o scadenza), entro 30 minuti
  SELECT * INTO pend FROM public.alberto_pendenti
   WHERE lower(membro) = lower(p_mittente) AND NOT chiuso AND creato > now() - interval '30 minutes' ORDER BY creato DESC LIMIT 1;
  IF pend.id IS NOT NULL THEN
    v_per := pend.dati->>'per'; v_cosa := pend.dati->>'cosa';
    v_ore := NULLIF(pend.dati->>'ore', '')::numeric; v_giorno := NULLIF(pend.dati->>'giorno', '')::date; v_ora := NULLIF(pend.dati->>'ora', '')::time;
    IF pend.dati->>'manca' = 'ore' THEN
      mm := regexp_match(tl, '^(?:circa |sono )?(\d+(?:[.,]\d+)?)\s*(?:h|ore|ora)?[ .!]*$');
      IF mm IS NOT NULL THEN v_ore := replace(mm[1], ',', '.')::numeric; END IF;
    ELSE
      v_giorno := public.consegne_leggi_giorno(tl);
      mm := regexp_match(tl, '(?:entro|alle|per)\s+le\s+(\d{1,2})(?:[:.](\d{2}))?');
      IF mm IS NOT NULL THEN v_ora := make_time(mm[1]::int, COALESCE(mm[2], '0')::int, 0); END IF;
    END IF;
    IF (pend.dati->>'manca' = 'ore' AND v_ore IS NOT NULL AND v_ore > 0) OR (pend.dati->>'manca' = 'entro' AND v_giorno IS NOT NULL) THEN
      IF v_ore IS NULL THEN v_manca := 'ore'; ELSIF v_giorno IS NULL THEN v_manca := 'entro'; END IF;
      IF v_manca IS NOT NULL THEN
        UPDATE public.alberto_pendenti SET dati = jsonb_build_object('per', v_per, 'cosa', v_cosa, 'ore', v_ore, 'giorno', v_giorno, 'ora', v_ora, 'manca', v_manca) WHERE id = pend.id;
        RETURN jsonb_build_object('gestito', true, 'risposta', CASE v_manca WHEN 'ore' THEN 'Quante ore servono? Rispondimi solo con le ore (es. «3 ore»).'
                                  ELSE 'Per quando va consegnato? (es. «venerdì» oppure «domani entro le 17:30»)' END);
      END IF;
      UPDATE public.alberto_pendenti SET chiuso = true WHERE id = pend.id;
      RETURN public.consegne_comando(p_mittente, format('lavoro %s: %s, %s ore, entro %s%s', v_per, v_cosa, trim(trailing '.' FROM to_char(v_ore, 'FM990.99')),
                                      to_char(v_giorno, 'DD/MM/YYYY'), CASE WHEN v_ora IS NOT NULL THEN ' ' || to_char(v_ora, 'HH24:MI') ELSE '' END));
    END IF;
  END IF;

  -- B. un ordine in italiano: «Luca deve montare il reel di Roxy entro venerdì»
  m := regexp_match(t, '^(luca|alessandro|elisa|giovanni)\s+(?:deve|dovrebbe|dovr[àa]|può|puo|puoi)\s+(.{3,})$', 'i');
  IF m IS NOT NULL THEN
    v_per := initcap(m[1]); v_resto := m[2];
    -- due ordini nella stessa frase («Alessandro deve …, Luca deve …»): non indovino, li legge il cervello
    IF v_resto ~* '(^|[,;.]|\se\s)\s*(luca|alessandro|elisa|giovanni)\s+(deve|dovrebbe|dovr[àa]|può|puo|puoi)\M' THEN
      RETURN jsonb_build_object('gestito', false);
    END IF;
    mm := regexp_match(v_resto, '(\d+(?:[.,]\d+)?)\s*(?:h|ore|ora)\M', 'i');
    IF mm IS NOT NULL THEN
      v_ore := replace(mm[1], ',', '.')::numeric;
      v_resto := regexp_replace(v_resto, '\s*,?\s*(?:di\s+)?\d+(?:[.,]\d+)?\s*(?:h|ore|ora)\M', '', 'i');
    END IF;
    mm := regexp_match(v_resto, '(?:entro|per|alle)\s+le\s+(\d{1,2})(?:[:.](\d{2}))?', 'i');
    IF mm IS NOT NULL THEN
      v_ora := make_time(mm[1]::int, COALESCE(mm[2], '0')::int, 0);
      v_resto := regexp_replace(v_resto, '\s*,?\s*(?:entro|per|alle)\s+le\s+\d{1,2}(?:[:.]\d{2})?', '', 'i');
    END IF;
    v_giorno := public.consegne_leggi_giorno(v_resto);
    IF v_giorno IS NOT NULL THEN
      v_resto := regexp_replace(v_resto, '\s*,?\s*(?:entro il|entro|per il|per)?\s*(?:' || GIORNI || ')\M', '', 'ig');
    END IF;
    v_cosa := btrim(regexp_replace(replace(v_resto, ',', ' '), '\s+', ' ', 'g'), ' .;:');
    IF length(v_cosa) < 3 THEN RETURN jsonb_build_object('gestito', false); END IF;
    v_cosa := upper(left(v_cosa, 1)) || substr(v_cosa, 2);
    UPDATE public.alberto_pendenti SET chiuso = true WHERE lower(membro) = lower(p_mittente) AND NOT chiuso;
    IF v_ore IS NULL OR v_giorno IS NULL THEN
      v_manca := CASE WHEN v_ore IS NULL THEN 'ore' ELSE 'entro' END;
      INSERT INTO public.alberto_pendenti (membro, dati)
        VALUES (p_mittente, jsonb_build_object('per', v_per, 'cosa', v_cosa, 'ore', v_ore, 'giorno', v_giorno, 'ora', v_ora, 'manca', v_manca));
      RETURN jsonb_build_object('gestito', true, 'risposta', format('Ho capito: %s deve «%s». %s', v_per, v_cosa,
        CASE v_manca WHEN 'ore' THEN 'Quante ore servono? Rispondimi solo con le ore (es. «3 ore»).'
                     ELSE 'Per quando va consegnato? (es. «venerdì» oppure «domani entro le 17:30»)' END));
    END IF;
    RETURN public.consegne_comando(p_mittente, format('lavoro %s: %s, %s ore, entro %s%s', v_per, v_cosa, trim(trailing '.' FROM to_char(v_ore, 'FM990.99')),
                                    to_char(v_giorno, 'DD/MM/YYYY'), CASE WHEN v_ora IS NOT NULL THEN ' ' || to_char(v_ora, 'HH24:MI') ELSE '' END));
  END IF;

  -- C. «spostalo a lunedì»: l'ultimo lavoro messo da chi scrive nelle ultime 6 ore
  m := regexp_match(tl, '^(?:sposta(?:lo|la|li|le)?|rimanda(?:lo|la|li|le)?)\s+(?:(?:a|al|per|entro)\s+)?(.+)$');
  IF m IS NOT NULL AND tl !~ '^sposta\s+tsk' THEN
    SELECT id_display INTO v_ultimo FROM public.task
     WHERE lower(assegnato_da) = lower(p_mittente) AND COALESCE(note, '') LIKE '%tramite Alberto%'
       AND stato NOT IN ('Fatto', 'Archiviato') AND created_at > now() - interval '6 hours'
     ORDER BY created_at DESC LIMIT 1;
    IF v_ultimo IS NOT NULL AND public.consegne_leggi_giorno(m[1]) IS NOT NULL THEN
      RETURN public.consegne_comando(p_mittente, 'sposta ' || v_ultimo || ' a ' || m[1]);
    END IF;
  END IF;

  RETURN jsonb_build_object('gestito', false);
END;
$$;

-- Aggancio in consegne_comando: dove un messaggio non corrisponde a nessun comando fisso.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.consegne_comando(text,text)'::regprocedure);
  IF d LIKE '%consegne_ordine_libero%' THEN RETURN; END IF;
  n := replace(d, $a$  IF m IS NULL THEN RETURN jsonb_build_object('gestito', false); END IF;
  v_per := m[1]; v_resto := m[2];$a$, $b$  IF m IS NULL THEN RETURN public.consegne_ordine_libero(p_mittente, p_testo); END IF;
  v_per := m[1]; v_resto := m[2];$b$);
  IF n = d THEN RAISE EXCEPTION 'punto di aggancio non trovato'; END IF;
  EXECUTE n;
END $$;

-- ─── Privacy: Elisa e Giovanni vedono tutto, gli altri solo i propri messaggi ───
-- (la vecchia policy «tutti vedono tutto» è resa inattiva: DROP POLICY si bloccava sulla tabella con il realtime)
CREATE POLICY whatsapp_messaggi_lettura ON public.whatsapp_messaggi FOR SELECT TO authenticated
  USING (public.alberto_e_admin() OR lower(COALESCE(membro, '')) = lower(COALESCE(public.alberto_membro_corrente(), '#')));
CREATE POLICY whatsapp_messaggi_scrittura_admin ON public.whatsapp_messaggi FOR ALL TO authenticated
  USING (public.alberto_e_admin()) WITH CHECK (public.alberto_e_admin());
ALTER POLICY whatsapp_messaggi_autenticati ON public.whatsapp_messaggi USING (false) WITH CHECK (false);
ALTER POLICY alberto_coda_lettura ON public.alberto_coda USING (public.alberto_e_admin());

-- ─── Pagina WhatsApp dentro Alberto ───
CREATE OR REPLACE FUNCTION public.alberto_whatsapp_conversazioni()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(c ORDER BY c->>'ultimo_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
             'membro', t.nome,
             'ultimo_at', max(m.created_at),
             'ultimo_testo', (array_agg(left(m.testo, 140) ORDER BY m.created_at DESC))[1],
             'non_risposti', count(*) FILTER (WHERE m.direzione = 'entrata' AND m.stato IN ('ricevuto', 'letto')),
             'messaggi', count(*)) AS c
      FROM public.team t
      JOIN public.whatsapp_messaggi m ON lower(m.membro) = lower(t.nome) AND m.direzione IN ('entrata', 'uscita')
     WHERE public.alberto_e_admin() OR lower(t.nome) = lower(COALESCE(public.alberto_membro_corrente(), '#'))
     GROUP BY t.nome) s;
$$;

CREATE OR REPLACE FUNCTION public.alberto_whatsapp_rispondi(p_membro text, p_testo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.alberto_e_admin() THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Rispondono a mano solo Elisa e Giovanni.');
  END IF;
  IF COALESCE(btrim(p_testo), '') = '' THEN RETURN jsonb_build_object('ok', false, 'errore', 'Il messaggio è vuoto.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_whatsapp WHERE lower(membro) = lower(btrim(p_membro)) AND attivo) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa persona non ha un numero WhatsApp attivo.');
  END IF;
  PERFORM motore.chiama('consegne', jsonb_build_object('azione', 'alberto_scrivi', 'membro', btrim(p_membro), 'testo', btrim(p_testo),
                                                        'da', public.alberto_membro_corrente()));
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.alberto_whatsapp_conversazioni(), public.alberto_whatsapp_rispondi(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alberto_whatsapp_conversazioni(), public.alberto_whatsapp_rispondi(text, text) TO authenticated, service_role;
