
-- Tabella backup counts per snapshot dati
CREATE TABLE IF NOT EXISTS public._backup_counts (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  tabella TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  note TEXT
);

-- Tabella log cambi fase per debug e audit
CREATE TABLE IF NOT EXISTS public._fase_change_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contenuto_id UUID NOT NULL,
  old_fase TEXT,
  new_fase TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT,
  task_created_id UUID,
  drive_folder_created BOOLEAN DEFAULT false,
  reel_incremented BOOLEAN DEFAULT false,
  cleanup_created BOOLEAN DEFAULT false,
  calendar_updated BOOLEAN DEFAULT false,
  errors TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS open per entrambe (stesso pattern del resto del progetto)
ALTER TABLE public._backup_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_backup_counts" ON public._backup_counts FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public._fase_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_fase_change_log" ON public._fase_change_log FOR ALL TO public USING (true) WITH CHECK (true);

-- Enable realtime for contenuti and log_riprese
ALTER PUBLICATION supabase_realtime ADD TABLE public.contenuti;
ALTER PUBLICATION supabase_realtime ADD TABLE public.log_riprese;
