BEGIN;

ALTER TABLE public.task DROP CONSTRAINT IF EXISTS task_id_display_key;
DROP INDEX IF EXISTS public.task_id_display_key;

CREATE UNIQUE INDEX IF NOT EXISTS task_id_display_active_key
  ON public.task (id_display)
  WHERE stato IS DISTINCT FROM 'Completato'
    AND stato IS DISTINCT FROM 'Archiviato';

COMMIT;
