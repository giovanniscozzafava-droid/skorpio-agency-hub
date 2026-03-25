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
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return new Response(JSON.stringify({ used: 0, total: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get Drive quota
    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const aboutData = await aboutRes.json();
    const used = parseInt(aboutData?.storageQuota?.usageInDrive || '0');
    const total = parseInt(aboutData?.storageQuota?.limit || '0');

    // Get files in SKORPIO_Clip folder grouped by client
    const folderRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name='SKORPIO_Clip' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const folderData = await folderRes.json();
    const rootFolder = folderData?.files?.[0];

    const byClient: Record<string, { used: number; fileCount: number }> = {};

    if (rootFolder) {
      // Get client subfolders
      const subRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${rootFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const subData = await subRes.json();

      for (const folder of (subData?.files || [])) {
        // Get files in each client folder
        const filesRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder.id}' in parents and trashed=false`)}&fields=files(id,size)&pageSize=1000`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const filesData = await filesRes.json();
        const files = filesData?.files || [];
        const clientUsed = files.reduce((sum: number, f: { size?: string }) => sum + parseInt(f.size || '0'), 0);
        byClient[folder.name] = { used: clientUsed, fileCount: files.length };
      }
    }

    return new Response(JSON.stringify({ used, total, byClient }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: unknown) {
    console.error('[google-drive-usage]', err);
    return new Response(JSON.stringify({ used: 0, total: 0 }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
