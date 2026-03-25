// ─── google-drive-list-files ──────────────────────────────────────────────────
// Elenca i file in una cartella Drive (usato per il task Cleanup)
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
  if (!member.google_drive_connected) throw new Error('Google Drive non connesso');
  if (!member.google_drive_refresh_token) throw new Error('Refresh token mancante');

  const nowMs = Date.now();
  if (member.google_drive_access_token && (member.google_drive_token_expiry ?? 0) - nowMs > 3 * 60 * 1000) {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { folderId, teamId } = await req.json();
    if (!folderId || !teamId) {
      return new Response(JSON.stringify({ error: 'folderId e teamId sono richiesti' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getValidAccessToken(teamId);
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType)&pageSize=100&spaces=drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Drive list error: ${JSON.stringify(data)}`);

    const files = (data.files || []) as Array<{ id: string; name: string; size: string; mimeType: string }>;
    const totalSize = files.reduce((sum, f) => sum + parseInt(f.size || '0', 10), 0);

    return new Response(JSON.stringify({ files, count: files.length, totalSize }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
