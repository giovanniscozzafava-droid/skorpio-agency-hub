-- Kapso manda i numeri senza «+» (393…), team_whatsapp li ha con il «+» (+393…):
-- i messaggi in entrata risultavano senza membro e la finestra gratuita delle 24
-- ore non si trovava. Il trigger riconosce il membro dalle cifre e salva il
-- numero nel formato della rubrica. (Applicata in produzione il 1/10/2026.)
CREATE OR REPLACE FUNCTION public.whatsapp_membro_da_numero(p_numero text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT membro FROM public.team_whatsapp
   WHERE regexp_replace(numero, '\D', '', 'g') = regexp_replace(COALESCE(p_numero, ''), '\D', '', 'g')
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_messaggi_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.team_whatsapp%ROWTYPE;
BEGIN
  IF NEW.numero IS NOT NULL THEN
    SELECT * INTO c FROM public.team_whatsapp
     WHERE regexp_replace(numero, '\D', '', 'g') = regexp_replace(NEW.numero, '\D', '', 'g') LIMIT 1;
    IF c.membro IS NOT NULL THEN
      NEW.membro := COALESCE(NEW.membro, c.membro);
      NEW.numero := c.numero;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_messaggi_membro ON public.whatsapp_messaggi;
CREATE TRIGGER whatsapp_messaggi_membro BEFORE INSERT ON public.whatsapp_messaggi
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_messaggi_membro();

UPDATE public.whatsapp_messaggi m SET membro = COALESCE(m.membro, c.membro), numero = c.numero
  FROM public.team_whatsapp c
 WHERE m.created_at > now() - interval '7 days' AND (m.numero <> c.numero OR m.membro IS NULL)
   AND regexp_replace(c.numero, '\D', '', 'g') = regexp_replace(m.numero, '\D', '', 'g');
