ALTER TABLE public.contenuti DROP CONSTRAINT IF EXISTS contenuti_fase_check;

ALTER TABLE public.contenuti
ADD CONSTRAINT contenuti_fase_check
CHECK (
  fase = ANY (
    ARRAY[
      'Idea'::text,
      'Script'::text,
      'Girato'::text,
      'Pre montato'::text,
      'Montato'::text,
      'Uploadato'::text,
      'Revisionato'::text,
      'Programmato'::text,
      'Pubblicato'::text,
      'Scartata'::text
    ]
  )
);