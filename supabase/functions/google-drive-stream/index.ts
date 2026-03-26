// ─── google-drive-stream ────────────────────────────────────────────────────
// Proxy streaming for video preview with Range header support (HTML5 video seek).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
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
  const expiryMs = member.google_drive_token_expiry ?? 0;

  if (member.google_drive_access_token && expiryMs - nowMs > 3 * 60 * 1000) {
    return member.google_drive_access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: member.google_drive_refresh_token,
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
    const fileId = url.searchParams.get('fileId');
    const teamId = url.searchParams.get('teamId');

    if (!fileId || !teamId) {
      return new Response(JSON.stringify({ error: 'fileId e teamId obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getValidAccessToken(teamId);

    // Get file metadata for size and mimeType
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
    const fileSize = parseInt(meta.size || '0', 10);
    const mimeType = meta.mimeType || 'video/mp4';
    const rangeHeader = req.headers.get('Range');

    if (rangeHeader && fileSize > 0) {
      // Parse Range header: bytes=start-end
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new Response('Invalid Range', { status: 416, headers: corsHeaders });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);

      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Range: `bytes=${start}-${end}`,
          },
        }
      );

      if (!dlRes.ok && dlRes.status !== 206) {
        const err = await dlRes.text();
        return new Response(JSON.stringify({ error: `Stream fallito: ${err}` }), {
          status: dlRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(dlRes.body, {
        status: 206,
        headers: {
          ...corsHeaders,
          'Content-Type': mimeType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    // No Range header — return full file
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!dlRes.ok) {
      const err = await dlRes.text();
      return new Response(JSON.stringify({ error: `Stream fallito: ${err}` }), {
        status: dlRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(dlRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        ...(fileSize ? { 'Content-Length': String(fileSize) } : {}),
      },
    });

  } catch (err) {
    console.error('[google-drive-stream]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
