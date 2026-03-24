CREATE TABLE public.notifiche (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  destinatario TEXT NOT NULL,
  tipo TEXT NOT NULL,
  titolo TEXT NOT NULL,
  messaggio TEXT NOT NULL,
  task_id UUID NULL,
  task_id_display TEXT NULL,
  letto BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifiche ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_notifiche"
  ON public.notifiche FOR ALL TO public
  USING (true) WITH CHECK (true);

CREATE INDEX idx_notifiche_destinatario ON public.notifiche(destinatario);
CREATE INDEX idx_notifiche_letto ON public.notifiche(letto);
CREATE INDEX idx_notifiche_created_at ON public.notifiche(created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifiche;

CREATE OR REPLACE FUNCTION public.notify_task_assegnato()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.notifiche (destinatario, tipo, titolo, messaggio, task_id, task_id_display)
    VALUES (
      NEW.assegnato_a, 'task_assegnato', '📋 Nuovo task assegnato',
      CASE WHEN NEW.assegnato_da IS NOT NULL AND NEW.assegnato_da != ''
        THEN NEW.assegnato_da || ' ti ha assegnato: ' || NEW.descrizione
        ELSE 'Nuovo task: ' || NEW.descrizione END,
      NEW.id, NEW.id_display
    );
  END IF;

  IF (TG_OP = 'UPDATE' AND OLD.stato IS DISTINCT FROM NEW.stato) THEN
    IF NEW.assegnato_da IS NOT NULL AND NEW.assegnato_da != '' AND NEW.assegnato_da != NEW.assegnato_a THEN
      INSERT INTO public.notifiche (destinatario, tipo, titolo, messaggio, task_id, task_id_display)
      VALUES (
        NEW.assegnato_da, 'task_stato', '🔄 Task aggiornato',
        NEW.assegnato_a || ' ha spostato "' || NEW.descrizione || '" → ' || NEW.stato,
        NEW.id, NEW.id_display
      );
    END IF;
  END IF;

  IF (TG_OP = 'UPDATE' AND OLD.assegnato_a IS DISTINCT FROM NEW.assegnato_a) THEN
    INSERT INTO public.notifiche (destinatario, tipo, titolo, messaggio, task_id, task_id_display)
    VALUES (
      NEW.assegnato_a, 'task_assegnato', '📋 Task riassegnato a te',
      COALESCE(NEW.assegnato_da, 'Qualcuno') || ' ti ha riassegnato: ' || NEW.descrizione,
      NEW.id, NEW.id_display
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_task
  AFTER INSERT OR UPDATE ON public.task
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assegnato();