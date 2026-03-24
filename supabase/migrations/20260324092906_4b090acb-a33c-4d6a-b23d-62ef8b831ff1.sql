
-- Prima aggiorna i dati, poi ricrea il constraint
ALTER TABLE public.contenuti DROP CONSTRAINT IF EXISTS contenuti_fase_check;

UPDATE public.contenuti SET fase = 'Revisionato' WHERE fase = 'Revisione';

ALTER TABLE public.contenuti ADD CONSTRAINT contenuti_fase_check 
  CHECK (fase IN ('Idea','Script','Girato','Pre montato','Montato','Revisionato','Programmato','Pubblicato','Scartata'));

UPDATE public.task
SET tipo = 'Programmazione',
    descrizione = REPLACE(descrizione, '📱 Programma/pubblica', '📅 Programma')
WHERE tipo = 'Pubblicazione' AND stato NOT IN ('Completato','Archiviato');
