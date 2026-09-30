-- ============================================================================
-- Comandi di lavoro su WhatsApp senza modello (30/09/2026).
-- Il Banco sul Mac ha ancora gli strumenti vecchi e l'API di riserva è senza
-- credito: i comandi del lavoro li riconosce e li esegue il server, con una
-- sintassi fissa, prima che il messaggio arrivi ad Alberto. Tutto il resto
-- (appuntamenti, domande) continua ad andare al Banco come prima.
--
--   lavoro Luca: montaggio reel Roxy, 3 ore, entro venerdì 17:30
--   lavoro Luca: riprese Roxy, giovedì 15-18            (orario preciso)
--   ... aggiungi «confermo» per metterlo fuori orario o sopra un impegno
--   vidima | vidima tutto | vidima TSK4040
--   sposta TSK4040 a lunedì 12:00
--   dai TSK4040 a Alessandro
--   da vidimare                                          (l'elenco)
-- ============================================================================

/** «oggi», «domani», «venerdì», «2/10», «2 ottobre» → data (ora di Roma). NULL se non c'è. */
CREATE OR REPLACE FUNCTION public.consegne_leggi_giorno(p text)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  t text := lower(COALESCE(p, ''));
  oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  m text[];
  giorni text[] := ARRAY['lunedi','martedi','mercoledi','giovedi','venerdi','sabato','domenica'];
  mesi text[] := ARRAY['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  i int;
  d date;
BEGIN
  t := translate(t, 'ìèéàòù', 'ieeaou');
  IF t ~ '\mdopodomani\M' THEN RETURN oggi + 2; END IF;
  IF t ~ '\mdomani\M' THEN RETURN oggi + 1; END IF;
  IF t ~ '\moggi\M' THEN RETURN oggi; END IF;
  m := regexp_match(t, '\m(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\M');
  IF m IS NOT NULL THEN
    d := make_date(COALESCE(CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END, extract(year FROM oggi)::int), m[2]::int, m[1]::int);
    IF m[3] IS NULL AND d < oggi THEN d := d + interval '1 year'; END IF;
    RETURN d;
  END IF;
  FOR i IN 1..12 LOOP
    m := regexp_match(t, '\m(\d{1,2})\s+' || mesi[i] || '\M');
    IF m IS NOT NULL THEN
      d := make_date(extract(year FROM oggi)::int, i, m[1]::int);
      IF d < oggi THEN d := d + interval '1 year'; END IF;
      RETURN d;
    END IF;
  END LOOP;
  FOR i IN 1..7 LOOP
    IF t ~ ('\m' || giorni[i] || '\M') THEN
      RETURN oggi + ((i - extract(isodow FROM oggi)::int + 7) % 7);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.consegne_giorno_parole(p date)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p - (now() AT TIME ZONE 'Europe/Rome')::date
           WHEN 0 THEN 'oggi' WHEN 1 THEN 'domani'
           ELSE (ARRAY['lun','mar','mer','gio','ven','sab','dom'])[extract(isodow FROM p)::int] || ' ' || extract(day FROM p) || '/' || extract(month FROM p)
         END;
$$;

CREATE OR REPLACE FUNCTION public.consegne_blocchi_testo(p_task uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(string_agg(public.consegne_giorno_parole(c.data) || ' ' || to_char(c.ora, 'HH24:MI') || '-' || to_char(c.ora_fine, 'HH24:MI'), ', ' ORDER BY c.inizio_ts), '')
    FROM public.calendario c WHERE c.blocco_task_id = p_task AND c.fine_ts > now();
$$;

CREATE OR REPLACE FUNCTION public.consegne_comando(p_mittente text, p_testo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t text := btrim(regexp_replace(COALESCE(p_testo, ''), '\s+', ' ', 'g'));
  tl text;
  m text[];
  r jsonb;
  v_per text; v_resto text; v_cosa text; v_ore numeric; v_giorno date; v_ora time;
  v_inizio timestamptz; v_fine timestamptz; v_cliente text; v_conferma boolean;
  v_id uuid; v_righe text[] := '{}';
  x jsonb;
  AIUTO constant text := E'Per darmi un lavoro scrivi così:\nlavoro Luca: montaggio reel Roxy, 3 ore, entro venerdì 17:30\noppure con l''orario: lavoro Luca: riprese Roxy, giovedì 15-18';
BEGIN
  tl := lower(t);

  -- «da vidimare»: l'elenco
  IF tl ~ '^(cosa c.e )?da vidimare\??$' THEN
    SELECT array_agg(format('%s: %s — %s, consegna %s%s [%s]', k.assegnato_a, k.descrizione, NULLIF(public.consegne_blocchi_testo(k.id), ''),
             public.consegne_giorno_parole(k.scadenza), COALESCE(' entro le ' || to_char(k.consegna_ora, 'HH24:MI'), ''), k.id_display) ORDER BY k.scadenza)
      INTO v_righe FROM public.task k WHERE NOT k.vidimato AND k.stato NOT IN ('Fatto', 'Archiviato');
    RETURN jsonb_build_object('gestito', true, 'risposta',
      CASE WHEN v_righe IS NULL THEN 'Non c''è niente da vidimare.'
           ELSE 'Da vidimare:' || E'\n' || array_to_string(v_righe, E'\n') || E'\nScrivi «vidima tutto» o «vidima TSK…».' END);
  END IF;

  -- vidima
  m := regexp_match(tl, '^(?:ok,? )?vidima(?:mi)?(?: (.+))?$');
  IF m IS NOT NULL THEN
    r := public.consegne_vidima(COALESCE(NULLIF(btrim(m[1], ' .!'), ''), 'tutti'), p_mittente);
    IF COALESCE((r->>'ok')::boolean, false) THEN
      SELECT array_agg(format('%s a %s [%s]', e->>'cosa', e->>'per', e->>'id_display')) INTO v_righe FROM jsonb_array_elements(r->'vidimati') e;
      RETURN jsonb_build_object('gestito', true, 'risposta', 'Vidimato, parte adesso il messaggio ai ragazzi: ' || array_to_string(v_righe, '; ') || '.');
    END IF;
    RETURN jsonb_build_object('gestito', true, 'risposta', r->>'errore');
  END IF;

  -- dai / passa / riassegna TSK… a Nome
  m := regexp_match(t, '^(?:dai|passa|riassegna) (TSK\d+) (?:a|ad) (\S+)', 'i');
  IF m IS NOT NULL THEN
    r := public.consegne_riassegna(m[1], m[2], p_mittente);
    IF COALESCE((r->>'ok')::boolean, false) THEN
      SELECT id INTO v_id FROM public.task WHERE id_display = upper(m[1]);
      RETURN jsonb_build_object('gestito', true, 'risposta', format('Fatto: %s passa da %s a %s%s.%s', r->>'task', r->>'da', r->>'a',
        COALESCE(', in agenda ' || NULLIF(public.consegne_blocchi_testo(v_id), ''), ''),
        CASE WHEN (r->>'vidimato')::boolean THEN ' ' || (r->>'a') || ' riceve il messaggio adesso.' ELSE ' È ancora da vidimare.' END));
    END IF;
    RETURN jsonb_build_object('gestito', true, 'risposta', r->>'errore');
  END IF;

  -- sposta TSK… a <giorno> [ora]
  m := regexp_match(t, '^sposta (TSK\d+) (?:a|al|per|entro) (.+)$', 'i');
  IF m IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.task WHERE id_display = upper(m[1]) AND stato NOT IN ('Fatto', 'Archiviato')) THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', format('Non trovo un lavoro aperto %s.', upper(m[1])));
    END IF;
    v_giorno := public.consegne_leggi_giorno(m[2]);
    IF v_giorno IS NULL THEN RETURN jsonb_build_object('gestito', true, 'risposta', 'A che giorno? Es.: sposta ' || upper(m[1]) || ' a venerdì 12:00'); END IF;
    m := m || regexp_match(m[2], '\m(\d{1,2})[:.](\d{2})\M');
    v_ora := CASE WHEN m[3] IS NOT NULL THEN make_time(m[3]::int, m[4]::int, 0) END;
    r := public.consegne_sposta(m[1], v_giorno, v_ora, NULL, p_mittente);
    IF COALESCE((r->>'ok')::boolean, false) THEN
      SELECT id INTO v_id FROM public.task WHERE id_display = upper(m[1]);
      RETURN jsonb_build_object('gestito', true, 'risposta', format('Spostato: %s, consegna %s%s. In agenda: %s.', r->'task'->>'cosa',
        public.consegne_giorno_parole(v_giorno), COALESCE(' entro le ' || to_char(v_ora, 'HH24:MI'), ''), COALESCE(NULLIF(public.consegne_blocchi_testo(v_id), ''), 'nessun blocco')));
    END IF;
    RETURN jsonb_build_object('gestito', true, 'risposta', COALESCE(r->>'motivo', r->>'errore', 'Non riesco a spostarlo.'));
  END IF;

  -- lavoro <Nome>: cosa, N ore, entro <giorno> [HH:MM] | <giorno> HH-HH
  m := regexp_match(t, '^(?:lavoro|compito) (?:per |a )?([^\s:,]+)\s*[:,-]?\s*(.*)$', 'i');
  IF m IS NULL THEN RETURN jsonb_build_object('gestito', false); END IF;
  v_per := m[1]; v_resto := m[2];
  IF NOT EXISTS (SELECT 1 FROM public.team WHERE lower(nome) = lower(v_per)) THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', format('Non trovo «%s» nel team. ', v_per) || AIUTO);
  END IF;
  v_conferma := v_resto ~* '\mconfermo\M';
  v_resto := regexp_replace(v_resto, '\s*,?\s*\mconfermo\M', '', 'gi');
  v_cosa := btrim(split_part(v_resto, ',', 1));
  IF v_cosa = '' THEN RETURN jsonb_build_object('gestito', true, 'risposta', 'Cosa va fatto? ' || AIUTO); END IF;
  m := regexp_match(v_resto, '\m(\d+(?:[.,]\d+)?) ?(?:h|ore|ora)\M', 'i');
  v_ore := CASE WHEN m IS NOT NULL THEN replace(m[1], ',', '.')::numeric END;
  v_giorno := public.consegne_leggi_giorno(substr(v_resto, length(v_cosa) + 1));
  -- orario preciso «15-18», «dalle 15 alle 18», «15:30-18»
  m := regexp_match(substr(v_resto, length(v_cosa) + 1), '\mdalle (\d{1,2})(?:[:.](\d{2}))? alle (\d{1,2})(?:[:.](\d{2}))?\M', 'i');
  IF m IS NULL THEN
    m := regexp_match(substr(v_resto, length(v_cosa) + 1), '(?<![/\d])(\d{1,2})(?:[:.](\d{2}))? ?- ?(\d{1,2})(?:[:.](\d{2}))?\M');
  END IF;
  IF m IS NOT NULL AND v_giorno IS NOT NULL AND m[1]::int < 24 AND m[3]::int < 24 AND m[3]::int > m[1]::int THEN
    v_inizio := public.cal_ts(v_giorno, make_time(m[1]::int, COALESCE(m[2], '0')::int, 0));
    v_fine := public.cal_ts(v_giorno, make_time(m[3]::int, COALESCE(m[4], '0')::int, 0));
  ELSE
    m := regexp_match(substr(v_resto, length(v_cosa) + 1), '\m(\d{1,2})[:.](\d{2})\M');
    IF m IS NULL THEN
      m := regexp_match(substr(v_resto, length(v_cosa) + 1), '(?:entro le|alle) (\d{1,2})\M', 'i');
      IF m IS NOT NULL THEN m := m || ARRAY['00']; END IF;
    END IF;
    v_ora := CASE WHEN m IS NOT NULL AND m[1] IS NOT NULL AND m[1]::int < 24 THEN make_time(m[1]::int, m[2]::int, 0) END;
  END IF;
  IF v_inizio IS NULL AND v_giorno IS NULL THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', format('Per quando va consegnato «%s»? ', v_cosa) || AIUTO);
  END IF;
  IF v_inizio IS NULL AND v_ore IS NULL THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', format('Quante ore servono per «%s»? Riscrivilo con le ore, es.: lavoro %s: %s, 3 ore, entro %s', v_cosa, initcap(v_per), v_cosa, public.consegne_giorno_parole(v_giorno)));
  END IF;
  SELECT c.nome INTO v_cliente FROM public.clienti c
   WHERE COALESCE(c.stato, '') <> 'Chiuso' AND length(c.nome) >= 3
     AND (lower(v_cosa) LIKE '%' || lower(c.nome) || '%' OR (length(split_part(c.nome, ' ', 1)) >= 4 AND lower(v_cosa) ~ ('\m' || lower(split_part(c.nome, ' ', 1)) || '\M')))
   ORDER BY (lower(v_cosa) LIKE '%' || lower(c.nome) || '%') DESC, length(c.nome) DESC LIMIT 1;

  r := public.consegne_assegna(p_per => v_per, p_cosa => v_cosa, p_ore => v_ore, p_entro => v_giorno, p_entro_ora => v_ora,
         p_cliente => v_cliente, p_inizio => v_inizio, p_fine => v_fine, p_richiedente => p_mittente, p_conferma => v_conferma);

  IF COALESCE((r->>'ok')::boolean, false) THEN
    v_id := (r->'task'->>'id')::uuid;
    RETURN jsonb_build_object('gestito', true, 'risposta', format('%s: %s, %s%s, in agenda %s, consegna %s%s. %s',
      CASE WHEN (r->>'da_vidimare')::boolean THEN 'Messo, da vidimare per ' || (r->>'vidima') ELSE 'Messo' END,
      r->'task'->>'per', r->'task'->>'cosa', COALESCE(' (' || NULLIF(r->'task'->>'cliente', '') || ')', ''),
      COALESCE(NULLIF(public.consegne_blocchi_testo(v_id), ''), '—'),
      public.consegne_giorno_parole((r->'task'->>'scadenza')::date), COALESCE(' entro le ' || NULLIF(r->'task'->>'consegna_ora', ''), ''),
      r->'task'->>'id_display')
      || COALESCE(E'\n' || NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(r->'avvisi')), ' '), ''), ''));
  END IF;
  IF COALESCE((r->>'serve_conferma')::boolean, false) THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', replace(r->>'motivo', '(serve un sì)', '') || E'\nSe va bene così, riscrivi lo stesso messaggio aggiungendo «confermo».');
  END IF;
  IF COALESCE((r->>'non_entra')::boolean, false) THEN
    x := r->'proposte';
    RETURN jsonb_build_object('gestito', true, 'risposta', (r->>'motivo') || ' Non ho messo niente.'
      || COALESCE(E'\nSi può spostare la consegna a ' || public.consegne_giorno_parole((x->>'prima_data_possibile')::date) || '.', '')
      || COALESCE(E'\nOre libere: ' || (SELECT string_agg((a->>'persona') || ' ' || (a->>'ore_libere'), ', ') FROM jsonb_array_elements(x->'altri_con_ore') a) || '.', ''));
  END IF;
  RETURN jsonb_build_object('gestito', true, 'risposta', COALESCE(r->>'errore', 'Non sono riuscito a metterlo.') || E'\n' || AIUTO);
END;
$$;

REVOKE ALL ON FUNCTION public.consegne_comando(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_comando(text, text) TO service_role;
