// ─── google-drive-upload-init ────────────────────────────────────────────────
// Usa Google Service Account per creare una sessione di upload resumable su Drive.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Service Account JWT ───────────────────────────────────────────────────────

function base64url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlStr(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64url(bytes);
}

async function getServiceAccountToken(): Promise<string> {
  const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato');

  const sa = JSON.parse(saJson);
  const scope = 'https://www.googleapis.com/auth/drive';
  const now = Math.floor(Date.now() / 1000);

  const header = base64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlStr(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const signingInput = `${header}.${payload}`;

  // Import private key
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Errore token SA: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ── Drive helpers ─────────────────────────────────────────────────────────────

async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const q = parentId
    ? `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error(`Impossibile creare cartella "${name}": ${JSON.stringify(created)}`);
  return created.id;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, mimeType, fileSize, clientName } = await req.json();

    if (!fileName || !mimeType || !fileSize || !clientName) {
      return new Response(JSON.stringify({ error: 'Parametri mancanti: fileName, mimeType, fileSize, clientName' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getServiceAccountToken();

    // Cartella root configurata (opzionale)
    const rootFolderEnv = Deno.env.get('GOOGLE_DRIVE_PARENT_FOLDER_ID') || undefined;

    // SKORPIO_Clip root
    const rootFolderId = await findOrCreateFolder(accessToken, 'SKORPIO_Clip', rootFolderEnv);

    // Sottocartella cliente
    const clientFolderId = await findOrCreateFolder(accessToken, clientName, rootFolderId);

    // Sessione resumable
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
      const body = await initRes.text();
      return new Response(JSON.stringify({ error: `Impossibile creare sessione upload: ${body}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ uploadUrl, folderId: clientFolderId, rootFolderId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    console.error('[google-drive-upload-init]', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Errore sconosciuto' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
