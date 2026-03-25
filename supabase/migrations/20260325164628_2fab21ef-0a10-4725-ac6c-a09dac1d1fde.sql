
-- Bucket temporaneo per upload video prima del trasferimento su Google Drive
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'temp-uploads',
  'temp-uploads',
  false,
  16106127360,
  ARRAY[
    'video/mp4','video/quicktime','video/x-msvideo','video/x-matroska',
    'video/mxf','video/mpeg','video/webm','video/x-m4v',
    'audio/mpeg','audio/wav','audio/x-wav','application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload to temp-uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'temp-uploads');

CREATE POLICY "Authenticated users can read their temp uploads"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'temp-uploads');

CREATE POLICY "Authenticated users can delete their temp uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'temp-uploads');
