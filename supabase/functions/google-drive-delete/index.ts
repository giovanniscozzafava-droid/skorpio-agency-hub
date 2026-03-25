import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

async function getAccessToken(): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/team?google_calendar_connected=eq.true&select=id,google_calendar_access_token,google_calendar_refresh_token,google_calendar_token_expiry&limit=1`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  const now = Date.now();

  if (row.google_calendar_access_token && row.google_calendar_token_expiry && (row.google_calendar_token_expiry - 300000) > now) {
    return row.google_calendar_access_token;
  }

  if (!row.google_calendar_refresh_token) return null;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: row.google_calendar_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return null;

  await fetch(`${SUPABASE_URL}/rest/v1/team?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      google_calendar_access_token: tokenData.access_token,
      google_calendar_token_expiry: now + (tokenData.expires_in * 1000),
    }),
  });

  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId } = await req.json();

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'fileId mancante' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Token Google Drive non disponibile' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const deleteRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (deleteRes.status === 204 || deleteRes.status === 200) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await deleteRes.text();
    return new Response(JSON.stringify({ error: `Drive API error ${deleteRes.status}: ${body}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: unknown) {
    console.error('[google-drive-delete]', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Errore' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
