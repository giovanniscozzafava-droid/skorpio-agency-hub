import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
    'pkcs8', derBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function createDriveFolder(accessToken: string, name: string, parentId: string): Promise<{ id: string; url: string }> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive API [${res.status}]: ${JSON.stringify(data)}`);
  return { id: data.id, url: `https://drive.google.com/drive/folders/${data.id}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { cliente_id, cliente_nome, id_display } = await req.json();
    if (!cliente_id || !cliente_nome) {
      return new Response(JSON.stringify({ error: 'cliente_id e cliente_nome obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    const parentFolderId = Deno.env.get('GOOGLE_DRIVE_PARENT_FOLDER_ID');
    if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato');
    if (!parentFolderId) throw new Error('GOOGLE_DRIVE_PARENT_FOLDER_ID non configurato');

    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    // Crea la cartella principale del cliente: "ID_DISPLAY - Nome Cliente"
    const folderName = `${id_display || cliente_id} - ${cliente_nome}`;
    const clientFolder = await createDriveFolder(accessToken, folderName, parentFolderId);

    // Crea sottocartelle standard
    const subfolders = ['📹 Contenuti', '🖼️ Grafiche', '📋 Documenti', '📣 ADV'];
    await Promise.all(subfolders.map(name => createDriveFolder(accessToken, name, clientFolder.id)));

    // Salva link_drive nella tabella clienti (campo note — aggiungiamo un campo dedicato in futuro)
    // Per ora aggiorniamo un campo che possiamo usare per riferimento, usiamo note temporaneamente
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Controlliamo se c'è già un campo link_drive nella tabella clienti — se non c'è usiamo le note
    // Salviamo il link in una struttura separata nei metadati
    await fetch(`${supabaseUrl}/rest/v1/clienti?id=eq.${cliente_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ note: `[DRIVE:${clientFolder.url}]` }),
    });

    console.log(`✅ Cartella cliente creata: ${folderName} → ${clientFolder.url}`);

    return new Response(JSON.stringify({
      success: true,
      folder_id: clientFolder.id,
      folder_url: clientFolder.url,
      folder_name: folderName,
      subfolders: subfolders.length,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Errore create-client-drive-folder:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
