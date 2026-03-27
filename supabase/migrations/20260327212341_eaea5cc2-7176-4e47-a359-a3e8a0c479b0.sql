
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS ricorrenza_tipo TEXT;
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS ricorrenza_intervallo INTEGER;
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS ricorrenza_giorni TEXT[];
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS ricorrenza_fine DATE;
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS ricorrenza_parent_id UUID REFERENCES public.calendario(id) ON DELETE CASCADE;

ALTER PUBLICATION supabase_realtime ADD TABLE public.calendario;
