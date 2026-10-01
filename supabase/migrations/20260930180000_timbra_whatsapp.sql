-- ============================================================================
-- Timbratura su WhatsApp (1/10/2026). La carta su Kapso non paga i template
-- Meta: i messaggi gratuiti sono solo le risposte entro 24 ore da un messaggio
-- della persona. Se i ragazzi scrivono «entrata» e «uscita» ad Alberto:
--   - la presenza si registra come dal pulsante Entrata/Uscita di Skorpio;
--   - Alberto risponde gratis con la giornata;
--   - l'«uscita» della sera tiene aperta la finestra per la lista delle 8:30.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consegne_agenda_testo(p_membro text, p_giorno date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  g jsonb := public.consegne_giornata(p_membro, p_giorno);
  vede_tutto boolean := lower(p_membro) = lower(COALESCE((SELECT valore FROM motore.config WHERE chiave = 'consegne_smistatore'), 'Elisa'));
  r text;
BEGIN
  SELECT string_agg(COALESCE(a->>'ora', '') || COALESCE('-' || (a->>'ora_fine'), '') || ' ' || (a->>'titolo')
                    || COALESCE(' (' || (a->>'cliente') || ')', ''), E'\n')
    INTO r FROM jsonb_array_elements(g->'agenda') a
   WHERE vede_tutto OR NOT COALESCE((a->>'da_vidimare')::boolean, false);
  RETURN COALESCE(r, 'In agenda non hai niente di fissato.');
END;
$$;

CREATE OR REPLACE FUNCTION public.consegne_timbra(p_persona text, p_tipo text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.team%ROWTYPE;
  p public.presenze%ROWTYPE;
  oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
BEGIN
  SELECT * INTO t FROM public.team WHERE lower(nome) = lower(btrim(COALESCE(p_persona, '')));
  IF t.id IS NULL THEN RETURN 'Non ti trovo nel team.'; END IF;
  SELECT * INTO p FROM public.presenze
   WHERE lower(persona) = lower(t.nome) AND tipo = 'entrata' AND fine IS NULL AND inizio > now() - interval '16 hours'
   ORDER BY inizio DESC LIMIT 1;

  IF p_tipo = 'entrata' THEN
    IF p.id IS NOT NULL THEN
      RETURN format('Hai già timbrato l''entrata alle %s. Quando finisci scrivi «uscita».', to_char(p.inizio AT TIME ZONE 'Europe/Rome', 'HH24:MI'));
    END IF;
    INSERT INTO public.presenze (persona, tipo, inizio, creato_da, note)
    VALUES (t.nome, 'entrata', now(), t.nome, 'Timbrata su WhatsApp');
    RETURN format('Entrata registrata alle %s. Oggi:', to_char(now() AT TIME ZONE 'Europe/Rome', 'HH24:MI'))
           || E'\n' || public.consegne_agenda_testo(t.nome, oggi)
           || E'\nQuando finisci scrivi «uscita».';
  END IF;

  IF p.id IS NULL THEN
    RETURN 'Non trovo un''entrata aperta. Scrivi «entrata» quando inizi (o timbra da Skorpio → Persone).';
  END IF;
  UPDATE public.presenze SET fine = now(), tipo = 'turno' WHERE id = p.id RETURNING * INTO p;
  RETURN format('Uscita registrata alle %s: oggi %s ore. Domattina alle 8:30 ti arriva qui la giornata.',
                to_char(p.fine AT TIME ZONE 'Europe/Rome', 'HH24:MI'), replace(to_char(COALESCE(p.ore, 0), 'FM990.00'), '.', ','));
END;
$$;

REVOKE ALL ON FUNCTION public.consegne_timbra(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consegne_timbra(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.consegne_agenda_testo(text, date) FROM PUBLIC, anon;

-- consegne_comando: «entrata» / «uscita» prima di tutto il resto.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.consegne_comando(text,text)'::regprocedure);
  n := replace(d, $a$  tl := lower(t);
$a$, $b$  tl := lower(t);

  IF tl ~ '^(timbra )?(entrata|sono entrat[oa]|sono arrivat[oa])[ .!]*$' THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', public.consegne_timbra(p_mittente, 'entrata'));
  END IF;
  IF tl ~ '^(timbra )?(uscita|esco|sono uscit[oa])[ .!]*$' THEN
    RETURN jsonb_build_object('gestito', true, 'risposta', public.consegne_timbra(p_mittente, 'uscita'));
  END IF;
$b$);
  IF n = d THEN RAISE EXCEPTION 'consegne_comando non modificato'; END IF;
  EXECUTE n;
END $$;

-- Ora che scrivono anche i ragazzi: «sposta» da WhatsApp solo per Giovanni ed Elisa.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.consegne_comando(text,text)'::regprocedure);
  n := replace(d, $a$  m := regexp_match(t, '^sposta (TSK\d+) (?:a|al|per|entro) (.+)$', 'i');
  IF m IS NOT NULL THEN
$a$, $b$  m := regexp_match(t, '^sposta (TSK\d+) (?:a|al|per|entro) (.+)$', 'i');
  IF m IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.team WHERE lower(nome) = lower(p_mittente) AND ruolo = 'Admin') THEN
      RETURN jsonb_build_object('gestito', true, 'risposta', 'Le consegne le spostano Giovanni o Elisa: chiedi a Elisa.');
    END IF;
$b$);
  IF n = d THEN RAISE EXCEPTION 'sposta non modificato'; END IF;
  EXECUTE n;
END $$;
