// ─── google-drive-upload-confirm ─────────────────────────────────────────────
// Chiamata dal frontend dopo che l'upload chunked è completato.
// Salva i metadati del file (fileId, fileUrl, fileName, fileSize, ecc.)
// nel record log_riprese corrispondente e imposta i permessi di condivisione.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

async function getValidAccessToken(teamId: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: member, error } = await supabase
    .from('team')
    .select('google_drive_access_token, google_drive_refresh_token, google_drive_token_expiry, google_drive_connected')
    .eq('id', teamId)
    .single();
  if (error || !member) throw new Error('Membro team non trovato');
  if (!member.google_drive_refresh_token) throw new Error('Refresh token mancante');
  const nowMs = Date.now();
  if (member.google_drive_access_token && (member.google_drive_token_expiry ?? 0) - nowMs > 180000) {
    return member.google_drive_access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: member.google_drive_refresh_token, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Refresh fallito: ${data.error}`);
  await supabase.from('team').update({
    google_drive_access_token: data.access_token,
    google_drive_token_expiry: nowMs + data.expires_in * 1000,
  }).eq('id', teamId);
  return data.access_token;
}

async function shareAnyone(accessToken: string, fileId: string): Promise<void> {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'anyone' }),
    });
  } catch (e) {
    console.warn(`⚠️ Permessi non impostati su ${fileId}:`, e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      clipId,       // UUID della riga in log_riprese
      zone,         // 'clip' | 'file_esportato'
      fileId,       // Google Drive file ID
      fileName,
      fileSize,
      mimeType,
      rawFilesCount,  // per zona clip: conteggio aggiornato
      rawFilesSize,   // per zona clip: dimensione totale aggiornata
    } = await req.json();

    if (!clipId || !zone || !fileId || !fileName) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: clipId, zone, fileId, fileName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const fileUrl  = `https://drive.google.com/file/d/${fileId}/view`;
    const now      = new Date().toISOString();

    let patch: Record<string, unknown>;

    if (zone === 'clip') {
      patch = {
        file_id:          fileId,
        file_url:         fileUrl,
        file_name:        fileName,
        file_size:        fileSize ?? null,
        file_mime_type:   mimeType ?? null,
        file_uploaded_at: now,
        file_deleted_at:  null,
        raw_files_count:  rawFilesCount ?? 1,
        raw_files_size:   rawFilesSize  ?? fileSize ?? 0,
        updated_at:       now,
      };
    } else {
      patch = {
        exported_file_id:          fileId,
        exported_file_url:         fileUrl,
        exported_file_name:        fileName,
        exported_file_size:        fileSize ?? null,
        exported_file_mime_type:   mimeType ?? null,
        exported_file_uploaded_at: now,
        updated_at:                now,
      };
    }

    const { error } = await supabase
      .from('log_riprese')
      .update(patch)
      .eq('id', clipId);

    if (error) throw new Error(`DB update failed: ${error.message}`);

    return new Response(
      JSON.stringify({ ok: true, fileUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-upload-confirm]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
