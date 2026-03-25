
ALTER TABLE public.team
  ADD COLUMN IF NOT EXISTS google_drive_access_token  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_drive_refresh_token text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_drive_token_expiry  bigint  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_drive_connected     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_drive_folder_id     text    DEFAULT NULL;
