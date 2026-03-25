import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const ROOT_FOLDER_NAME = 'SKORPIO_Clip';

async function getAccessToken(teamMemberId: string): Promise<string | null> {
  // Fetch token from team table
  const res = await fetch(`${SUPABASE_URL}/rest/v1/team?id=eq.${teamMemberId}&select=google_calendar_access_token,google_calendar_refresh_token,google_calendar_token_expiry`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  const now = Date.now();
  
  // If token is still valid (with 5min buffer), return it
  if (row.google_calendar_access_token && row.google_calendar_token_expiry && (row.google_calendar_token_expiry - 300000) > now) {
    return row.google_calendar_access_token;
  }

  // Refresh the token
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

  const newExpiry = now + (tokenData.expires_in * 1000);

  // Save refreshed token
  await fetch(`${SUPABASE_URL}/rest/v1/team?id=eq.${teamMemberId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      google_calendar_access_token: tokenData.access_token,
      google_calendar_token_expiry: newExpiry,
    }),
  });

  return tokenData.access_token;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  const created = await createRes.json();
  return created.id;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, mimeType, fileSize, clientName, teamMemberId } = await req.json();

    if (!fileName || !mimeType || !fileSize || !clientName) {
      return new Response(JSON.stringify({ error: 'Parametri mancanti' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get first connected team member with Google Drive if no teamMemberId
    let memberId = teamMemberId;
    if (!memberId) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/team?google_calendar_connected=eq.true&select=id&limit=1`, {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY!,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      const rows = await res.json();
      if (rows && rows.length > 0) memberId = rows[0].id;
    }

    if (!memberId) {
      return new Response(JSON.stringify({ error: 'Nessun account Google Drive connesso' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getAccessToken(memberId);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Token Google Drive non disponibile' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find/create SKORPIO_Clip root folder
    const rootFolderId = await findOrCreateFolder(accessToken, ROOT_FOLDER_NAME);
    
    // Find/create client subfolder
    const clientFolderId = await findOrCreateFolder(accessToken, clientName, rootFolderId);

    // Create resumable upload session
    const initRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name: fileName,
          parents: [clientFolderId],
          mimeType,
        }),
      }
    );

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      return new Response(JSON.stringify({ error: 'Impossibile creare sessione di upload' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ uploadUrl, folderId: clientFolderId, rootFolderId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: unknown) {
    console.error('[google-drive-upload-init]', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Errore' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
