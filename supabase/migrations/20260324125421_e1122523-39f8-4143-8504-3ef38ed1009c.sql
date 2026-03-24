
-- Aggiunge colonne per Google Calendar OAuth tokens nella tabella team
ALTER TABLE public.team
  ADD COLUMN IF NOT EXISTS google_calendar_access_token  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_token_expiry  BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_connected     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS google_calendar_id            TEXT DEFAULT NULL;
