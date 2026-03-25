
-- Add Drive folder IDs per CLP (clip/ and file_esportato/ subfolders)
ALTER TABLE public.contenuti
  ADD COLUMN IF NOT EXISTS drive_clip_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_export_folder_id TEXT;

-- Add exported file fields to log_riprese (separate from the raw clip files)
-- Note: existing file_id/file_url/etc fields will track the PRIMARY file (raw/clip)
-- exported_* fields track the final exported video
ALTER TABLE public.log_riprese
  ADD COLUMN IF NOT EXISTS exported_file_id TEXT,
  ADD COLUMN IF NOT EXISTS exported_file_url TEXT,
  ADD COLUMN IF NOT EXISTS exported_file_name TEXT,
  ADD COLUMN IF NOT EXISTS exported_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS exported_file_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS exported_file_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_files_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_files_size BIGINT DEFAULT 0;
