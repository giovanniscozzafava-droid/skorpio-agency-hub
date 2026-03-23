import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Build a signed JWT for Google Service Account OAuth2
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const derBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    derBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// Cerca una cartella per nome dentro un parent, restituisce l'id se trovata
async function findFolder(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  return data.files?.length > 0 ? data.files[0].id : null;
}

// Crea una cartella
async function createFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive create error [${res.status}]: ${JSON.stringify(data)}`);
  return data.id;
}

// Trova o crea una cartella
async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(accessToken, name, parentId);
  if (existing) return existing;
  return await createFolder(accessToken, name, parentId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contenuto_id, titolo, cliente_nome, id_display } = await req.json();

    if (!contenuto_id || !titolo) {
      return new Response(JSON.stringify({ error: 'contenuto_id e titolo sono obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    const parentFolderId = Deno.env.get('GOOGLE_DRIVE_PARENT_FOLDER_ID');

    if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato');
    if (!parentFolderId) throw new Error('GOOGLE_DRIVE_PARENT_FOLDER_ID non configurato');

    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    // Step 1: trova o crea la cartella cliente (es. "Gisko")
    const clienteFolderName = cliente_nome || 'Senza cliente';
    const clienteFolderId = await findOrCreateFolder(accessToken, clienteFolderName, parentFolderId);

    // Step 2: crea la sottocartella col titolo del reel (es. "Provoleee") dentro la cartella cliente
    const reelFolderId = await createFolder(accessToken, titolo, clienteFolderId);
    const reelFolderUrl = `https://drive.google.com/drive/folders/${reelFolderId}`;

    // Aggiorna link_drive nel DB
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const updateRes = await fetch(`${supabaseUrl}/rest/v1/contenuti?id=eq.${contenuto_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ link_drive: reelFolderUrl }),
    });

    if (!updateRes.ok) {
      const updateErr = await updateRes.text();
      throw new Error(`DB update failed: ${updateErr}`);
    }

    console.log(`✅ Cartella Drive creata: ${clienteFolderName}/${titolo} → ${reelFolderUrl}`);

    return new Response(JSON.stringify({
      success: true,
      folder_id: reelFolderId,
      folder_url: reelFolderUrl,
      folder_name: `${clienteFolderName}/${titolo}`,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Errore create-drive-folder:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
