// ─── google-drive-delete ─────────────────────────────────────────────────────
// Usa OAuth2 dell'utente per eliminare un file da Google Drive.
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

  const nowMs    = Date.now();
  const expiryMs = member.google_drive_token_expiry ?? 0;

  if (member.google_drive_access_token && expiryMs - nowMs > 3 * 60 * 1000) {
    return member.google_drive_access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: member.google_drive_refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Refresh fallito: ${data.error_description || data.error}`);

  await supabase.from('team').update({
    google_drive_access_token: data.access_token,
    google_drive_token_expiry: nowMs + data.expires_in * 1000,
  }).eq('id', teamId);

  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { fileId, teamId } = await req.json();

    if (!fileId || !teamId) {
      return new Response(
        JSON.stringify({ error: 'fileId e teamId sono obbligatori' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await getValidAccessToken(teamId);

    const deleteRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (deleteRes.status === 204 || deleteRes.status === 200) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await deleteRes.text();
    return new Response(
      JSON.stringify({ error: `Drive API error ${deleteRes.status}: ${body}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore';
    console.error('[google-drive-delete]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
