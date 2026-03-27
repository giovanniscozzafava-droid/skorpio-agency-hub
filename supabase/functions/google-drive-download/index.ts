// ─── google-drive-download ──────────────────────────────────────────────────
// Proxy download: il frontend chiama con fileId + teamId, la edge function
// scarica il file da Google Drive usando il token OAuth e lo restituisce come stream.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

  // If requested member doesn't have Drive connected, fallback to any member who does
  let activeMember = member;
  if (!member?.google_drive_connected || !member?.google_drive_refresh_token) {
    const { data: fallback } = await supabase
      .from('team')
      .select('id, google_drive_access_token, google_drive_refresh_token, google_drive_token_expiry, google_drive_connected')
      .eq('google_drive_connected', true)
      .not('google_drive_refresh_token', 'is', null)
      .limit(1)
      .single();
    if (!fallback) throw new Error('Nessun membro del team ha Google Drive connesso');
    activeMember = fallback;
    teamId = fallback.id;
  }

  if (!activeMember) throw new Error('Membro team non trovato');
  if (!activeMember.google_drive_refresh_token) throw new Error('Refresh token mancante');

  const nowMs = Date.now();
  const expiryMs = activeMember.google_drive_token_expiry ?? 0;

  if (activeMember.google_drive_access_token && expiryMs - nowMs > 3 * 60 * 1000) {
    return activeMember.google_drive_access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: activeMember.google_drive_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Refresh fallito: ${data.error_description || data.error}`);

  const newExpiry = nowMs + data.expires_in * 1000;
  await supabase.from('team').update({
    google_drive_access_token: data.access_token,
    google_drive_token_expiry: newExpiry,
  }).eq('id', teamId);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const fileId = url.searchParams.get('fileId') || (await req.json().catch(() => ({}))).fileId;
    const teamId = url.searchParams.get('teamId') || (await req.json().catch(() => ({}))).teamId;

    if (!fileId || !teamId) {
      return new Response(JSON.stringify({ error: 'fileId e teamId obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getValidAccessToken(teamId);

    // Get file metadata first
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!metaRes.ok) {
      const err = await metaRes.text();
      return new Response(JSON.stringify({ error: `File non trovato: ${err}` }), {
        status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const meta = await metaRes.json();

    // Download file content
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!dlRes.ok) {
      const err = await dlRes.text();
      return new Response(JSON.stringify({ error: `Download fallito: ${err}` }), {
        status: dlRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Stream the file back to the browser
    const fileName = encodeURIComponent(meta.name || 'download');
    return new Response(dlRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': meta.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${meta.name || 'file'}"; filename*=UTF-8''${fileName}`,
        ...(meta.size ? { 'Content-Length': String(meta.size) } : {}),
      },
    });

  } catch (err) {
    console.error('[google-drive-download]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
