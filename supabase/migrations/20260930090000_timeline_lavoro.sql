-- ============================================================================
-- Timeline del lavoro giornaliero (Giovanni, 30/09/2026)
-- ============================================================================
-- Elisa e Giovanni danno le scadenze → Alberto riempie le ore libere di ogni
-- ragazzo entro la scadenza → ognuno riceve la lista del giorno con gli orari
-- → a fine giornata consegna.
--
-- Il pianificatore è UNO e sta qui, nel database, perché lo usano tutti:
-- l'edge function consegne, Alberto (chat, WhatsApp, Banco sul Mac: tutti
-- passano dalle RPC) e il trigger che rimette in fila i blocchi quando una
-- scadenza si sposta dal Kanban.
--
-- Ore libere di un giorno = orari_lavoro della persona
--   − impegni in calendario (appuntamenti, riprese, blocchi di altri lavori)
--   − assenze (ferie/permessi/malattia: sono righe «indisponibilita»)
--   − ore già timbrate oggi (presenze entrata/turno).
-- Il lavoro si mette nei buchi veri, dal primo libero, fino alla scadenza
-- meno un margine (motore.config.consegne_margine_min, 30 minuti).
--
-- Task e blocchi restano legati da calendario.blocco_task_id (non task_id:
-- quello è il marcatore di scadenza di sync_task_to_calendario, e spostarlo
-- sposterebbe la scadenza). Scadenza spostata → blocchi rifatti. Task in
-- Fatto → blocchi futuri tolti, passati segnati Completato.
-- ============================================================================

ALTER TABLE public.task
  ADD COLUMN IF NOT EXISTS ore_stimate numeric,
  ADD COLUMN IF NOT EXISTS consegna_ora time,
  ADD COLUMN IF NOT EXISTS pianificato boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task.pianificato IS 'Il task ha blocchi di lavoro messi in agenda dal pianificatore (calendario.blocco_task_id).';
COMMENT ON COLUMN public.task.consegna_ora IS 'Ora di consegna del giorno di scadenza (ora di Roma). Vuota = fine dell''orario di lavoro.';

ALTER TABLE public.calendario
  ADD COLUMN IF NOT EXISTS blocco_task_id uuid REFERENCES public.task(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS blocco_fisso boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.calendario.blocco_task_id IS 'Blocco di lavoro del pianificatore: il task a cui appartiene.';
COMMENT ON COLUMN public.calendario.blocco_fisso IS 'Blocco a orario deciso da chi assegna (non si ripianifica da solo).';

CREATE INDEX IF NOT EXISTS calendario_blocco_task_idx ON public.calendario (blocco_task_id) WHERE blocco_task_id IS NOT NULL;

INSERT INTO motore.config (chiave, valore)
SELECT 'consegne_margine_min', '30'
WHERE NOT EXISTS (SELECT 1 FROM motore.config WHERE chiave = 'consegne_margine_min');

-- ─── Mattoni ────────────────────────────────────────────────────────────────

/** Il prossimo quarto d'ora (o l'istante stesso se è già un quarto d'ora). */
CREATE OR REPLACE FUNCTION public.consegne_quarto_su(p timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT to_timestamp(ceil(extract(epoch FROM p) / 900) * 900);
$$;

CREATE OR REPLACE FUNCTION public.consegne_quarto_giu(p timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT to_timestamp(floor(extract(epoch FROM p) / 900) * 900);
$$;

/** Le ore di lavoro di una persona fra due giorni (ora di Roma), festivi esclusi. */
CREATE OR REPLACE FUNCTION public.consegne_orario(p_team uuid, p_da date, p_a date)
RETURNS tstzmultirange LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(range_agg(tstzrange(public.cal_ts(g::date, (f->>0)::time), public.cal_ts(g::date, (f->>1)::time))), '{}'::tstzmultirange)
    FROM public.team t
   CROSS JOIN generate_series(p_da, p_a, interval '1 day') g
   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.orari_lavoro -> (extract(isodow FROM g)::int)::text, '[]'::jsonb)) f
   WHERE t.id = p_team AND NOT public.hr_festivo(g::date)
     AND (f->>1)::time > (f->>0)::time;
$$;

/** «09:00-13:30» per un giorno, in parole. */
CREATE OR REPLACE FUNCTION public.consegne_orario_testo(p_team uuid, p_giorno date)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(string_agg(to_char(lower(r) AT TIME ZONE 'Europe/Rome', 'HH24:MI') || '-' || to_char(upper(r) AT TIME ZONE 'Europe/Rome', 'HH24:MI'), ', ' ORDER BY lower(r)), 'non lavora')
    FROM unnest(public.consegne_orario(p_team, p_giorno, p_giorno)) r;
$$;

/**
 * Gli impegni di una persona fra due istanti. Contano appuntamenti, riprese,
 * blocchi di lavoro e assenze; non contano le pubblicazioni, gli eventi di
 * tutto il giorno che non sono assenze, i marcatori di scadenza dei task del
 * pianificatore e i blocchi dei task in `p_escludi`.
 * `p_solo_fissi`: i blocchi non fissi del pianificatore non contano (servono
 * a capire se un orario deciso a mano si scontra con qualcosa di vero).
 */
CREATE OR REPLACE FUNCTION public.consegne_occupato(p_team uuid, p_da timestamptz, p_a timestamptz, p_escludi uuid[] DEFAULT '{}', p_solo_fissi boolean DEFAULT false)
RETURNS tstzmultirange LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(range_agg(tstzrange(c.inizio_ts, c.fine_ts)), '{}'::tstzmultirange)
    FROM public.calendario c
    JOIN public.team t ON t.id = p_team
   WHERE c.inizio_ts < p_a AND c.fine_ts > p_da AND c.fine_ts > c.inizio_ts
     AND c.tipo <> 'pubblicazione'
     AND lower(COALESCE(c.stato, '')) NOT IN ('saltato', 'annullato', 'cancellato')
     AND NOT (c.task_id IS NOT NULL AND lower(COALESCE(c.stato, '')) = 'completato')
     AND (NOT COALESCE(c.tutto_il_giorno, false) OR c.tipo = 'indisponibilita')
     AND (c.blocco_task_id IS NULL OR NOT (c.blocco_task_id = ANY (COALESCE(p_escludi, '{}'))))
     AND (NOT p_solo_fissi OR c.blocco_task_id IS NULL OR c.blocco_fisso)
     AND NOT EXISTS (SELECT 1 FROM public.task k WHERE k.id = c.task_id AND k.pianificato)
     AND (EXISTS (SELECT 1 FROM public.calendario_persone cp WHERE cp.calendario_id = c.id AND cp.team_id = p_team)
          OR lower(t.nome) IN (SELECT lower(btrim(x)) FROM unnest(string_to_array(COALESCE(c.persona, ''), ',')) x));
$$;

/** Le ore già timbrate oggi (entrata aperta = fino ad adesso). */
CREATE OR REPLACE FUNCTION public.consegne_ore_timbrate(p_nome text, p_giorno date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(round(sum(extract(epoch FROM (
           LEAST(COALESCE(p.fine, now()), public.cal_ts(p_giorno + 1, '00:00'))
           - GREATEST(p.inizio, public.cal_ts(p_giorno, '00:00')))) / 3600.0)::numeric, 2), 0)
    FROM public.presenze p
   WHERE lower(p.persona) = lower(p_nome) AND p.tipo IN ('entrata', 'turno')
     AND p.inizio < public.cal_ts(p_giorno + 1, '00:00')
     AND COALESCE(p.fine, now()) > public.cal_ts(p_giorno, '00:00');
$$;

/** I buchi liberi veri di una persona fra due istanti. */
CREATE OR REPLACE FUNCTION public.consegne_liberi(p_team uuid, p_da timestamptz, p_a timestamptz, p_escludi uuid[] DEFAULT '{}')
RETURNS TABLE (inizio timestamptz, fine timestamptz) LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH m AS (
    SELECT (public.consegne_orario(p_team, (p_da AT TIME ZONE 'Europe/Rome')::date, (p_a AT TIME ZONE 'Europe/Rome')::date)
            * tstzmultirange(tstzrange(p_da, p_a)))
           - public.consegne_occupato(p_team, p_da, p_a, p_escludi) AS r
    WHERE p_a > p_da
  )
  SELECT lower(x), upper(x) FROM m, unnest(m.r) x ORDER BY 1;
$$;

/**
 * Dove mettere `p_ore` di lavoro fra `p_da` e `p_entro`: i primi buchi liberi,
 * a quarti d'ora, niente spezzoni sotto la mezz'ora (salvo l'ultimo pezzo).
 * Oggi al massimo: ore di lavoro del giorno − ore già timbrate − impegni
 * ancora da fare. Restituisce i blocchi; se non bastano, ne restituisce meno.
 */
CREATE OR REPLACE FUNCTION public.consegne_piazza(p_team uuid, p_ore numeric, p_da timestamptz, p_entro timestamptz, p_escludi uuid[] DEFAULT '{}')
RETURNS TABLE (inizio timestamptz, fine timestamptz) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_resto interval := make_interval(mins => (ceil(GREATEST(p_ore, 0) * 60 / 15) * 15)::int);
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_nome text;
  v_tetto interval;
  v_cap_giorno numeric;
  v_impegni numeric;
  b record;
  s timestamptz; e timestamptz; pezzo interval;
BEGIN
  SELECT nome INTO v_nome FROM public.team WHERE id = p_team;
  -- Il tetto di oggi.
  SELECT COALESCE(sum(extract(epoch FROM upper(r) - lower(r))) / 3600.0, 0) INTO v_cap_giorno
    FROM unnest(public.consegne_orario(p_team, v_oggi, v_oggi)) r;
  SELECT COALESCE(sum(extract(epoch FROM upper(r) - lower(r))) / 3600.0, 0) INTO v_impegni
    FROM unnest(public.consegne_orario(p_team, v_oggi, v_oggi) * tstzmultirange(tstzrange(now(), public.cal_ts(v_oggi + 1, '00:00')))
                * public.consegne_occupato(p_team, now(), public.cal_ts(v_oggi + 1, '00:00'), p_escludi)) r;
  v_tetto := make_interval(mins => GREATEST(0, floor((v_cap_giorno - public.consegne_ore_timbrate(v_nome, v_oggi) - v_impegni) * 60 / 15) * 15)::int);

  FOR b IN SELECT * FROM public.consegne_liberi(p_team, p_da, p_entro, p_escludi) LOOP
    EXIT WHEN v_resto <= interval '0';
    s := public.consegne_quarto_su(b.inizio);
    e := public.consegne_quarto_giu(b.fine);
    CONTINUE WHEN e <= s;
    pezzo := LEAST(e - s, v_resto);
    IF (s AT TIME ZONE 'Europe/Rome')::date = v_oggi THEN
      pezzo := LEAST(pezzo, v_tetto);
    END IF;
    CONTINUE WHEN pezzo <= interval '0';
    CONTINUE WHEN pezzo < interval '30 minutes' AND pezzo < v_resto;
    IF (s AT TIME ZONE 'Europe/Rome')::date = v_oggi THEN v_tetto := v_tetto - pezzo; END IF;
    inizio := s; fine := s + pezzo;
    RETURN NEXT;
    v_resto := v_resto - pezzo;
  END LOOP;
END;
$$;

/** L'istante entro cui il lavoro dev'essere finito (consegna meno il margine). */
CREATE OR REPLACE FUNCTION public.consegne_limite(p_team uuid, p_giorno date, p_ora time)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(public.cal_ts(p_giorno, p_ora),
                  upper(public.consegne_orario(p_team, p_giorno, p_giorno)),
                  public.cal_ts(p_giorno, '19:00'))
         - make_interval(mins => COALESCE((SELECT NULLIF(valore, '')::int FROM motore.config WHERE chiave = 'consegne_margine_min'), 30));
$$;

-- ─── Il pianificatore ───────────────────────────────────────────────────────

/**
 * Rimette in agenda le ore che mancano a un task del pianificatore: toglie i
 * suoi blocchi futuri non fissi e li rifà nei buchi liberi fino alla consegna.
 * Le ore dei blocchi già passati (o in corso) e di quelli fissi contano come
 * già coperte.
 */
CREATE OR REPLACE FUNCTION public.consegne_pianifica_task(p_task uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  k public.task%ROWTYPE;
  t public.team%ROWTYPE;
  v_coperte numeric;
  v_serve numeric;
  v_messe numeric := 0;
  v_entro timestamptz;
  v_id uuid;
  r record;
  v_blocchi jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO k FROM public.task WHERE id = p_task;
  IF k.id IS NULL OR NOT k.pianificato THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Task non del pianificatore.');
  END IF;
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(k.assegnato_a);
  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('Il task %s non è assegnato a una persona del team.', k.id_display));
  END IF;

  DELETE FROM public.calendario WHERE blocco_task_id = k.id AND NOT blocco_fisso AND inizio_ts >= now();
  IF k.stato IN ('Fatto', 'Archiviato') OR k.scadenza IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'task_id', k.id, 'id_display', k.id_display, 'messe', 0, 'mancano', 0, 'blocchi', '[]'::jsonb);
  END IF;

  SELECT COALESCE(sum(extract(epoch FROM fine_ts - inizio_ts)) / 3600.0, 0) INTO v_coperte
    FROM public.calendario WHERE blocco_task_id = k.id;
  v_serve := GREATEST(0, COALESCE(k.ore_stimate, 0) - v_coperte);
  v_entro := public.consegne_limite(t.id, k.scadenza, k.consegna_ora);

  IF v_serve > 0 THEN
    FOR r IN SELECT * FROM public.consegne_piazza(t.id, v_serve, public.consegne_quarto_su(now()), v_entro, ARRAY[k.id]) LOOP
      INSERT INTO public.calendario (tipo, origine, stato, descrizione, data, ora, ora_fine, tutto_il_giorno,
                                     persona, cliente_id, cliente_nome, blocco_task_id, note, ospiti)
      VALUES ('lavoro', 'manuale', 'Pianificato', left(k.descrizione, 120),
              (r.inizio AT TIME ZONE 'Europe/Rome')::date, (r.inizio AT TIME ZONE 'Europe/Rome')::time, (r.fine AT TIME ZONE 'Europe/Rome')::time, false,
              t.nome, k.cliente_id, COALESCE(k.cliente_nome, ''), k.id,
              format('Blocco di lavoro del task %s, consegna %s%s. Messo in agenda da Alberto.', k.id_display,
                     to_char(k.scadenza, 'DD/MM'), COALESCE(' entro le ' || to_char(k.consegna_ora, 'HH24:MI'), '')),
              '{}')
      RETURNING id INTO v_id;
      INSERT INTO public.calendario_persone (calendario_id, team_id) VALUES (v_id, t.id) ON CONFLICT DO NOTHING;
      v_messe := v_messe + extract(epoch FROM r.fine - r.inizio) / 3600.0;
    END LOOP;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI'), 'fisso', c.blocco_fisso) ORDER BY c.inizio_ts), '[]'::jsonb)
    INTO v_blocchi FROM public.calendario c WHERE c.blocco_task_id = k.id AND c.fine_ts > now();

  RETURN jsonb_build_object('ok', v_messe >= v_serve - 0.01, 'task_id', k.id, 'id_display', k.id_display, 'persona', t.nome,
                            'ore', k.ore_stimate, 'messe', round(v_messe, 2), 'mancano', round(GREATEST(0, v_serve - v_messe), 2),
                            'blocchi', v_blocchi);
END;
$$;

/**
 * Riordina tutto il lavoro aperto di una persona per scadenza (la più vicina
 * prima): toglie i blocchi futuri non fissi e li rimette in fila. Dice quali
 * lavori non entrano. Chi la chiama decide se tenere il risultato.
 */
CREATE OR REPLACE FUNCTION public.consegne_riordina(p_team uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_nome text;
  k record;
  r jsonb;
  v_tutti jsonb := '[]'::jsonb;
  v_non jsonb := '[]'::jsonb;
BEGIN
  SELECT nome INTO v_nome FROM public.team WHERE id = p_team;
  DELETE FROM public.calendario c USING public.task k2
   WHERE c.blocco_task_id = k2.id AND NOT c.blocco_fisso AND c.inizio_ts >= now()
     AND lower(k2.assegnato_a) = lower(v_nome) AND k2.pianificato AND k2.stato NOT IN ('Fatto', 'Archiviato');
  FOR k IN SELECT id FROM public.task
            WHERE lower(assegnato_a) = lower(v_nome) AND pianificato AND stato NOT IN ('Fatto', 'Archiviato') AND scadenza IS NOT NULL
            ORDER BY public.consegne_limite(p_team, scadenza, consegna_ora), created_at LOOP
    r := public.consegne_pianifica_task(k.id);
    v_tutti := v_tutti || r;
    IF (r->>'mancano')::numeric > 0 THEN v_non := v_non || r; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_non) = 0, 'lavori', v_tutti, 'non_entrano', v_non);
END;
$$;

/** Ore libere di una persona da adesso a un limite (per le proposte). */
CREATE OR REPLACE FUNCTION public.consegne_ore_libere(p_team uuid, p_entro timestamptz)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(round(sum(extract(epoch FROM fine - inizio)) / 3600.0, 2), 0)
    FROM public.consegne_piazza(p_team, 999, public.consegne_quarto_su(now()), p_entro, '{}');
$$;

/** Quando non entra: la prima data che regge e chi altro ha le ore. */
CREATE OR REPLACE FUNCTION public.consegne_proposte(p_team uuid, p_ore numeric, p_entro date, p_entro_ora time)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_nome text;
  v_d date;
  v_prima date;
  v_altri jsonb := '[]'::jsonb;
  p record;
  v_libere numeric;
BEGIN
  SELECT nome INTO v_nome FROM public.team WHERE id = p_team;
  v_d := p_entro;
  FOR i IN 1..20 LOOP
    v_d := v_d + 1;
    CONTINUE WHEN extract(isodow FROM v_d) > 5;
    IF public.consegne_ore_libere(p_team, public.consegne_limite(p_team, v_d, p_entro_ora)) >= p_ore THEN v_prima := v_d; EXIT; END IF;
  END LOOP;
  FOR p IN SELECT id, nome FROM public.team WHERE id <> p_team AND mansione = 'produzione' ORDER BY nome LOOP
    v_libere := public.consegne_ore_libere(p.id, public.consegne_limite(p.id, p_entro, p_entro_ora));
    IF v_libere >= p_ore THEN v_altri := v_altri || jsonb_build_object('persona', p.nome, 'ore_libere', v_libere); END IF;
  END LOOP;
  RETURN jsonb_build_object('prima_data_possibile', v_prima, 'altri_con_ore', v_altri);
END;
$$;

/** Chiama l'edge function consegne in differita (pg_net, dopo il commit). */
CREATE OR REPLACE FUNCTION public.consegne_avvisa(p_corpo jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.alberto_whatsapp_chiama('consegne', p_corpo);
END;
$$;

/** Chi chiama: se è un utente vero, conta lui e non il parametro. */
CREATE OR REPLACE FUNCTION public.consegne_richiedente(p_dichiarato text)
RETURNS public.team LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.team%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO r FROM public.team WHERE auth_user_id = auth.uid();
  ELSIF COALESCE(btrim(p_dichiarato), '') <> '' THEN
    SELECT * INTO r FROM public.team WHERE lower(nome) = lower(btrim(p_dichiarato));
  END IF;
  RETURN r;
END;
$$;

-- ─── Le RPC per Alberto ─────────────────────────────────────────────────────

/**
 * Assegna un lavoro. Due modi:
 *   - con orario (p_inizio/p_fine): il blocco va lì. Fuori orario di lavoro o
 *     sopra un altro impegno vero → non lo mette, chiede conferma
 *     (serve_conferma), e lo mette solo con p_conferma = true.
 *   - con ore e scadenza: le ore vanno nei buchi liberi da adesso alla
 *     consegna. Prima senza toccare il resto; se non entra, riordinando tutto
 *     il lavoro della persona per scadenza; se non entra neanche così, NON
 *     crea niente e risponde con cosa non entra e le proposte (altra data,
 *     altra persona), e avvisa Giovanni ed Elisa.
 * Crea il task nel Kanban (con scadenza) e i blocchi in calendario, legati.
 */
CREATE OR REPLACE FUNCTION public.consegne_assegna(
  p_per text, p_cosa text, p_ore numeric DEFAULT NULL, p_entro date DEFAULT NULL, p_entro_ora time DEFAULT NULL,
  p_cliente text DEFAULT NULL, p_inizio timestamptz DEFAULT NULL, p_fine timestamptz DEFAULT NULL,
  p_richiedente text DEFAULT NULL, p_conferma boolean DEFAULT false, p_tipo text DEFAULT NULL, p_priorita text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.team%ROWTYPE;
  rq public.team%ROWTYPE;
  v_cli_id uuid; v_cli_nome text;
  v_id uuid; v_display text;
  v_fine timestamptz; v_giorno date; v_blocco tstzrange; v_blocco_id uuid;
  v_ris jsonb; v_non jsonb := '[]'::jsonb; v_modo text; v_avvisi text[] := '{}';
  v_conflitti jsonb; v_prop jsonb; v_libere numeric; v_limite timestamptz;
  v_toccati uuid[]; v_tid uuid; r jsonb;
  v_prio text := CASE lower(COALESCE(p_priorita, '')) WHEN 'alta' THEN '🔴 Alta' WHEN 'bassa' THEN '🟢 Bassa' ELSE '🟡 Media' END;
  v_tipo text := left(COALESCE(NULLIF(btrim(p_tipo), ''), 'Lavoro'), 40);
BEGIN
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_per, '')));
  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo «%s» nel team.', p_per));
  END IF;
  rq := public.consegne_richiedente(p_richiedente);
  IF rq.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Non so chi sta assegnando il lavoro.');
  END IF;
  IF rq.ruolo <> 'Admin' AND rq.id <> t.id THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('%s può mettere lavoro solo a se stesso: ad altri lo assegnano Giovanni o Elisa.', rq.nome));
  END IF;
  IF COALESCE(btrim(p_cosa), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Serve cosa va fatto.');
  END IF;
  IF COALESCE(btrim(p_cliente), '') <> '' THEN
    SELECT id, nome INTO v_cli_id, v_cli_nome FROM public.clienti
     WHERE lower(nome) = lower(btrim(p_cliente)) OR lower(nome) LIKE '%' || lower(btrim(p_cliente)) || '%'
     ORDER BY (lower(nome) = lower(btrim(p_cliente))) DESC, length(nome) LIMIT 1;
  END IF;

  PERFORM set_config('consegne.in_corso', '1', true);

  -- ── Con orario deciso ────────────────────────────────────────────────────
  IF p_inizio IS NOT NULL THEN
    v_fine := COALESCE(p_fine, p_inizio + make_interval(mins => round(COALESCE(p_ore, 1) * 60)::int));
    IF v_fine <= p_inizio THEN RETURN jsonb_build_object('ok', false, 'errore', 'La fine deve essere dopo l''inizio.'); END IF;
    v_giorno := (p_inizio AT TIME ZONE 'Europe/Rome')::date;
    IF (v_fine AT TIME ZONE 'Europe/Rome')::date <> v_giorno THEN
      RETURN jsonb_build_object('ok', false, 'errore', 'Il blocco deve finire lo stesso giorno in cui inizia.');
    END IF;
    IF v_fine <= now() THEN RETURN jsonb_build_object('ok', false, 'errore', 'Quell''orario è già passato.'); END IF;
    v_blocco := tstzrange(p_inizio, v_fine);

    IF NOT p_conferma THEN
      IF NOT (public.consegne_orario(t.id, v_giorno, v_giorno) @> v_blocco) THEN
        RETURN jsonb_build_object('ok', false, 'serve_conferma', true, 'fuori_orario', true,
          'motivo', format('%s il %s lavora %s: %s-%s è fuori dal suo orario. Lo metto lo stesso? (serve un sì)',
                           t.nome, to_char(v_giorno, 'DD/MM'), public.consegne_orario_testo(t.id, v_giorno),
                           to_char(p_inizio AT TIME ZONE 'Europe/Rome', 'HH24:MI'), to_char(v_fine AT TIME ZONE 'Europe/Rome', 'HH24:MI')));
      END IF;
      IF NOT isempty(public.consegne_occupato(t.id, p_inizio, v_fine, '{}', true)) THEN
        SELECT jsonb_agg(jsonb_build_object('titolo', c.descrizione, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI')))
          INTO v_conflitti FROM public.calendario c
         WHERE c.inizio_ts < v_fine AND c.fine_ts > p_inizio AND c.tipo <> 'pubblicazione' AND NOT COALESCE(c.tutto_il_giorno, false)
           AND (c.blocco_task_id IS NULL OR c.blocco_fisso)
           AND (EXISTS (SELECT 1 FROM public.calendario_persone cp WHERE cp.calendario_id = c.id AND cp.team_id = t.id) OR lower(COALESCE(c.persona, '')) = lower(t.nome));
        RETURN jsonb_build_object('ok', false, 'serve_conferma', true, 'conflitti', COALESCE(v_conflitti, '[]'::jsonb),
          'motivo', format('%s ha già un impegno in quell''orario. Lo metto lo stesso? (serve un sì)', t.nome));
      END IF;
    END IF;

    v_display := public.generate_display_id('TSK', 'task_seq');
    INSERT INTO public.task (id_display, tipo, descrizione, cliente_id, cliente_nome, priorita, stato, assegnato_a, assegnato_da,
                             scadenza, ora, note, ore_stimate, consegna_ora, pianificato)
    VALUES (COALESCE(v_display, 'TSK' || extract(epoch FROM now())::bigint), v_tipo, left(btrim(p_cosa), 300), v_cli_id,
            COALESCE(v_cli_nome, left(COALESCE(p_cliente, ''), 80)), v_prio, 'Da fare', t.nome, rq.nome,
            v_giorno, NULL, format('Assegnato da %s tramite Alberto.', rq.nome),
            round(extract(epoch FROM v_fine - p_inizio) / 3600.0, 2), (v_fine AT TIME ZONE 'Europe/Rome')::time, true)
    RETURNING id, id_display INTO v_id, v_display;

    INSERT INTO public.calendario (tipo, origine, stato, descrizione, data, ora, ora_fine, tutto_il_giorno, persona,
                                   cliente_id, cliente_nome, blocco_task_id, blocco_fisso, note, ospiti)
    VALUES ('lavoro', 'manuale', 'Pianificato', left(btrim(p_cosa), 120), v_giorno,
            (p_inizio AT TIME ZONE 'Europe/Rome')::time, (v_fine AT TIME ZONE 'Europe/Rome')::time, false, t.nome,
            v_cli_id, COALESCE(v_cli_nome, ''), v_id, true,
            format('Orario deciso da %s (task %s). Messo in agenda da Alberto.', rq.nome, v_display), '{}')
    RETURNING id INTO v_blocco_id;
    INSERT INTO public.calendario_persone (calendario_id, team_id) VALUES (v_blocco_id, t.id) ON CONFLICT DO NOTHING;
    IF NOT (public.consegne_orario(t.id, v_giorno, v_giorno) @> v_blocco) THEN
      v_avvisi := v_avvisi || format('Fuori orario di %s (%s), confermato da %s.', t.nome, public.consegne_orario_testo(t.id, v_giorno), rq.nome);
    END IF;

    -- I blocchi flessibili che finiscono sotto il nuovo si rimettono in fila.
    SELECT array_agg(DISTINCT c.blocco_task_id) INTO v_toccati FROM public.calendario c
     WHERE c.blocco_task_id IS NOT NULL AND c.blocco_task_id <> v_id AND NOT c.blocco_fisso
       AND c.inizio_ts < v_fine AND c.fine_ts > p_inizio AND lower(COALESCE(c.persona, '')) = lower(t.nome);
    IF v_toccati IS NOT NULL THEN
      FOREACH v_tid IN ARRAY v_toccati LOOP
        r := public.consegne_pianifica_task(v_tid);
        IF (r->>'mancano')::numeric > 0 THEN
          r := public.consegne_riordina(t.id);
          IF NOT (r->>'ok')::boolean THEN
            v_avvisi := v_avvisi || (SELECT array_agg(format('%s non entra più prima della consegna: mancano %s ore.', x->>'id_display', x->>'mancano')) FROM jsonb_array_elements(r->'non_entrano') x);
          END IF;
          EXIT;
        END IF;
      END LOOP;
      v_modo := 'spostati altri lavori';
    END IF;
    v_modo := COALESCE(v_modo, 'orario fisso');

  -- ── Con ore e scadenza ───────────────────────────────────────────────────
  ELSE
    IF COALESCE(p_ore, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'errore', 'Servono le ore stimate del lavoro (es. 3).'); END IF;
    IF p_entro IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', 'Serve il giorno di consegna.'); END IF;
    v_limite := public.consegne_limite(t.id, p_entro, p_entro_ora);
    IF v_limite <= now() THEN
      RETURN jsonb_build_object('ok', false, 'errore', format('La consegna %s%s è già passata (o troppo vicina per lavorarci).', to_char(p_entro, 'DD/MM'), COALESCE(' alle ' || to_char(p_entro_ora, 'HH24:MI'), '')));
    END IF;

    v_display := public.generate_display_id('TSK', 'task_seq');
    -- 1) Nei buchi che ci sono, senza toccare il resto.
    BEGIN
      INSERT INTO public.task (id_display, tipo, descrizione, cliente_id, cliente_nome, priorita, stato, assegnato_a, assegnato_da,
                               scadenza, ora, note, ore_stimate, consegna_ora, pianificato)
      VALUES (COALESCE(v_display, 'TSK' || extract(epoch FROM now())::bigint), v_tipo, left(btrim(p_cosa), 300), v_cli_id,
              COALESCE(v_cli_nome, left(COALESCE(p_cliente, ''), 80)), v_prio, 'Da fare', t.nome, rq.nome,
              p_entro, NULL, format('Assegnato da %s tramite Alberto.', rq.nome), p_ore, p_entro_ora, true)
      RETURNING id, id_display INTO v_id, v_display;
      v_ris := public.consegne_pianifica_task(v_id);
      IF (v_ris->>'mancano')::numeric > 0 THEN RAISE EXCEPTION USING ERRCODE = 'CN001', MESSAGE = 'non entra'; END IF;
      v_modo := 'nei buchi liberi';
    EXCEPTION WHEN SQLSTATE 'CN001' THEN
      v_id := NULL;
    END;
    -- 2) Riordinando per scadenza tutto il lavoro della persona.
    IF v_id IS NULL THEN
      BEGIN
        INSERT INTO public.task (id_display, tipo, descrizione, cliente_id, cliente_nome, priorita, stato, assegnato_a, assegnato_da,
                                 scadenza, ora, note, ore_stimate, consegna_ora, pianificato)
        VALUES (COALESCE(v_display, 'TSK' || extract(epoch FROM now())::bigint), v_tipo, left(btrim(p_cosa), 300), v_cli_id,
                COALESCE(v_cli_nome, left(COALESCE(p_cliente, ''), 80)), v_prio, 'Da fare', t.nome, rq.nome,
                p_entro, NULL, format('Assegnato da %s tramite Alberto.', rq.nome), p_ore, p_entro_ora, true)
        RETURNING id, id_display INTO v_id, v_display;
        r := public.consegne_riordina(t.id);
        IF NOT (r->>'ok')::boolean THEN
          v_non := r->'non_entrano';
          RAISE EXCEPTION USING ERRCODE = 'CN001', MESSAGE = 'non entra';
        END IF;
        v_modo := 'riordinando il lavoro per scadenza';
      EXCEPTION WHEN SQLSTATE 'CN001' THEN
        v_id := NULL;
      END;
    END IF;
    -- 3) Non entra: non si forza.
    IF v_id IS NULL THEN
      v_libere := public.consegne_ore_libere(t.id, v_limite);
      v_prop := public.consegne_proposte(t.id, p_ore, p_entro, p_entro_ora);
      PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'non_entra', 'richiedente', rq.nome, 'persona', t.nome,
        'cosa', left(btrim(p_cosa), 200), 'ore', p_ore, 'entro', p_entro, 'entro_ora', to_char(p_entro_ora, 'HH24:MI'),
        'ore_libere', v_libere, 'proposte', v_prop, 'non_entrano', v_non));
      RETURN jsonb_build_object('ok', false, 'non_entra', true,
        'motivo', format('Non entra: %s ore per %s entro %s%s, ma %s ha %s ore libere prima della consegna (margine di %s minuti compreso), con il lavoro che ha già.',
                         p_ore, t.nome, to_char(p_entro, 'DD/MM'), COALESCE(' alle ' || to_char(p_entro_ora, 'HH24:MI'), ''), t.nome, v_libere,
                         COALESCE((SELECT valore FROM motore.config WHERE chiave = 'consegne_margine_min'), '30')),
        'ore_libere', v_libere, 'proposte', v_prop, 'non_entrano', v_non,
        'nota', 'Non ho creato niente. Proponi di spostare la consegna o di passare il lavoro a un altro.');
    END IF;
  END IF;

  PERFORM set_config('consegne.in_corso', '', true);
  PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', v_id, 'motivo', 'nuovo'));

  RETURN jsonb_build_object('ok', true, 'modo', v_modo, 'avvisi', to_jsonb(v_avvisi),
    'task', (SELECT jsonb_build_object('id', k.id, 'id_display', k.id_display, 'per', k.assegnato_a, 'cosa', k.descrizione,
                                       'cliente', k.cliente_nome, 'scadenza', k.scadenza, 'consegna_ora', to_char(k.consegna_ora, 'HH24:MI'), 'ore', k.ore_stimate)
               FROM public.task k WHERE k.id = v_id),
    'blocchi', (SELECT COALESCE(jsonb_agg(jsonb_build_object('data', c.data, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI')) ORDER BY c.inizio_ts), '[]'::jsonb)
                  FROM public.calendario c WHERE c.blocco_task_id = v_id));
END;
$$;

/**
 * Sposta la consegna di un lavoro (task del pianificatore): nuova data e/o
 * ora, e/o nuove ore stimate. I blocchi si rifanno insieme. Se alla nuova
 * data non entra, non sposta niente e lo dice.
 * `p_task`: codice TSK…, id, o un pezzo della descrizione (se è uno solo).
 */
CREATE OR REPLACE FUNCTION public.consegne_sposta(p_task text, p_entro date DEFAULT NULL, p_entro_ora time DEFAULT NULL,
                                                  p_ore numeric DEFAULT NULL, p_richiedente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  k public.task%ROWTYPE;
  rq public.team%ROWTYPE;
  t public.team%ROWTYPE;
  v_n int;
  r jsonb;
  v_non jsonb := '[]'::jsonb;
  v_ok boolean := false;
  v_vecchia date; v_vecchia_ora time;
  v_fisso public.calendario%ROWTYPE;
  v_ini timestamptz; v_fin timestamptz;
BEGIN
  rq := public.consegne_richiedente(p_richiedente);
  IF rq.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'errore', 'Non so chi sta spostando la consegna.'); END IF;

  SELECT * INTO k FROM public.task WHERE upper(id_display) = upper(btrim(p_task)) OR id::text = btrim(p_task) LIMIT 1;
  IF k.id IS NULL THEN
    SELECT count(*) INTO v_n FROM public.task WHERE pianificato AND stato NOT IN ('Fatto', 'Archiviato') AND descrizione ILIKE '%' || btrim(p_task) || '%';
    IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'errore', format('Non trovo un lavoro aperto «%s».', p_task)); END IF;
    IF v_n > 1 THEN
      RETURN jsonb_build_object('ok', false, 'errore', 'Ce n''è più di uno, dimmi quale.',
        'candidati', (SELECT jsonb_agg(jsonb_build_object('id_display', id_display, 'cosa', descrizione, 'per', assegnato_a, 'scadenza', scadenza))
                        FROM public.task WHERE pianificato AND stato NOT IN ('Fatto', 'Archiviato') AND descrizione ILIKE '%' || btrim(p_task) || '%'));
    END IF;
    SELECT * INTO k FROM public.task WHERE pianificato AND stato NOT IN ('Fatto', 'Archiviato') AND descrizione ILIKE '%' || btrim(p_task) || '%';
  END IF;
  IF NOT k.pianificato THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('%s non ha blocchi in agenda: sposta la scadenza dal Kanban.', k.id_display));
  END IF;
  IF rq.ruolo <> 'Admin' AND lower(rq.nome) <> lower(k.assegnato_a) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Le consegne degli altri le spostano Giovanni o Elisa.');
  END IF;
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(k.assegnato_a);
  v_vecchia := k.scadenza; v_vecchia_ora := k.consegna_ora;

  PERFORM set_config('consegne.in_corso', '1', true);
  SELECT * INTO v_fisso FROM public.calendario WHERE blocco_task_id = k.id AND blocco_fisso ORDER BY inizio_ts DESC LIMIT 1;

  BEGIN
    UPDATE public.task SET scadenza = COALESCE(p_entro, scadenza),
                           consegna_ora = CASE WHEN p_entro_ora IS NOT NULL THEN p_entro_ora ELSE consegna_ora END,
                           ore_stimate = COALESCE(p_ore, ore_stimate), updated_at = now()
     WHERE id = k.id RETURNING * INTO k;
    IF v_fisso.id IS NOT NULL THEN
      -- Lavoro a orario fisso: stesso orario, giorno nuovo.
      v_ini := public.cal_ts(k.scadenza, v_fisso.ora);
      v_fin := public.cal_ts(k.scadenza, v_fisso.ora_fine);
      IF v_fin <= now() THEN RAISE EXCEPTION USING ERRCODE = 'CN001', MESSAGE = 'passato'; END IF;
      UPDATE public.calendario SET data = k.scadenza WHERE id = v_fisso.id;
      v_ok := true;
    ELSE
      r := public.consegne_pianifica_task(k.id);
      IF (r->>'mancano')::numeric > 0 THEN
        r := public.consegne_riordina(t.id);
        IF NOT (r->>'ok')::boolean THEN v_non := r->'non_entrano'; RAISE EXCEPTION USING ERRCODE = 'CN001', MESSAGE = 'non entra'; END IF;
      END IF;
      v_ok := true;
    END IF;
  EXCEPTION WHEN SQLSTATE 'CN001' THEN
    v_ok := false;
  END;
  PERFORM set_config('consegne.in_corso', '', true);

  IF NOT v_ok THEN
    SELECT * INTO k FROM public.task WHERE id = k.id;
    RETURN jsonb_build_object('ok', false, 'non_entra', true,
      'motivo', format('Spostando %s al %s non entra: %s ha %s ore libere prima di quella consegna. Ho lasciato tutto com''era (consegna %s).',
                       k.id_display, to_char(COALESCE(p_entro, k.scadenza), 'DD/MM'), t.nome,
                       public.consegne_ore_libere(t.id, public.consegne_limite(t.id, COALESCE(p_entro, k.scadenza), COALESCE(p_entro_ora, k.consegna_ora))),
                       to_char(k.scadenza, 'DD/MM')),
      'non_entrano', v_non,
      'proposte', public.consegne_proposte(t.id, COALESCE(p_ore, k.ore_stimate), COALESCE(p_entro, k.scadenza), COALESCE(p_entro_ora, k.consegna_ora)));
  END IF;

  PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', k.id, 'motivo', 'spostato',
                                                    'prima', to_char(v_vecchia, 'YYYY-MM-DD') || COALESCE(' ' || to_char(v_vecchia_ora, 'HH24:MI'), ''), 'da', rq.nome));
  RETURN jsonb_build_object('ok', true,
    'task', jsonb_build_object('id_display', k.id_display, 'cosa', k.descrizione, 'per', k.assegnato_a, 'scadenza', k.scadenza,
                               'consegna_ora', to_char(k.consegna_ora, 'HH24:MI'), 'ore', k.ore_stimate, 'prima', v_vecchia),
    'blocchi', (SELECT COALESCE(jsonb_agg(jsonb_build_object('data', c.data, 'ora', to_char(c.ora, 'HH24:MI'), 'ora_fine', to_char(c.ora_fine, 'HH24:MI')) ORDER BY c.inizio_ts), '[]'::jsonb)
                  FROM public.calendario c WHERE c.blocco_task_id = k.id AND c.fine_ts > now()));
END;
$$;

/** La giornata di una persona (per Alberto e per i messaggi): blocchi, impegni, consegne. */
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
                   FROM public.task k WHERE lower(k.assegnato_a) = lower(t.nome) AND k.scadenza = v_g AND k.stato NOT IN ('Fatto', 'Archiviato')));
END;
$$;

-- ─── Il legame task ↔ blocchi ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consegne_task_dopo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r jsonb;
  v_team uuid;
  v_fisso public.calendario%ROWTYPE;
BEGIN
  IF NOT NEW.pianificato OR COALESCE(current_setting('consegne.in_corso', true), '') = '1' THEN RETURN NEW; END IF;

  -- In Fatto (o archiviato): il lavoro è consegnato, via i blocchi futuri.
  IF NEW.stato IN ('Fatto', 'Archiviato') AND OLD.stato IS DISTINCT FROM NEW.stato THEN
    DELETE FROM public.calendario WHERE blocco_task_id = NEW.id AND inizio_ts > now();
    UPDATE public.calendario SET stato = 'Completato' WHERE blocco_task_id = NEW.id AND stato = 'Pianificato';
    RETURN NEW;
  END IF;

  IF NEW.stato NOT IN ('Fatto', 'Archiviato') AND (
       OLD.stato IN ('Fatto', 'Archiviato')
       OR NEW.scadenza IS DISTINCT FROM OLD.scadenza OR NEW.consegna_ora IS DISTINCT FROM OLD.consegna_ora
       OR NEW.ore_stimate IS DISTINCT FROM OLD.ore_stimate OR NEW.assegnato_a IS DISTINCT FROM OLD.assegnato_a) THEN
    PERFORM set_config('consegne.in_corso', '1', true);
    IF NEW.assegnato_a IS DISTINCT FROM OLD.assegnato_a THEN
      DELETE FROM public.calendario WHERE blocco_task_id = NEW.id AND inizio_ts >= now();
    END IF;
    SELECT * INTO v_fisso FROM public.calendario WHERE blocco_task_id = NEW.id AND blocco_fisso ORDER BY inizio_ts DESC LIMIT 1;
    IF v_fisso.id IS NOT NULL THEN
      IF NEW.scadenza IS NOT NULL AND NEW.scadenza IS DISTINCT FROM OLD.scadenza THEN
        UPDATE public.calendario SET data = NEW.scadenza WHERE id = v_fisso.id;
      END IF;
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
    PERFORM public.consegne_avvisa(jsonb_build_object('azione', 'avvisa_lavoro', 'task_id', NEW.id, 'motivo', 'spostato',
                                   'prima', to_char(OLD.scadenza, 'YYYY-MM-DD') || COALESCE(' ' || to_char(OLD.consegna_ora, 'HH24:MI'), '')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consegne_task_dopo ON public.task;
CREATE TRIGGER consegne_task_dopo AFTER UPDATE ON public.task
  FOR EACH ROW EXECUTE FUNCTION public.consegne_task_dopo();

-- ─── Permessi ───────────────────────────────────────────────────────────────
-- Le RPC scrivono per conto di chi chiama: niente anonimi.
REVOKE ALL ON FUNCTION public.consegne_assegna(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consegne_sposta(text, date, time, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consegne_giornata(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consegne_pianifica_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consegne_riordina(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consegne_proposte(uuid, numeric, date, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consegne_avvisa(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consegne_richiedente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_assegna(text, text, numeric, date, time, text, timestamptz, timestamptz, text, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consegne_sposta(text, date, time, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consegne_giornata(text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consegne_pianifica_task(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consegne_riordina(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consegne_proposte(uuid, numeric, date, time) TO service_role;
