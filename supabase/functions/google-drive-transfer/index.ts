// ─── google-drive-transfer ────────────────────────────────────────────────────
// Legge un file da Supabase Storage (temp-uploads) e lo carica su Google Drive
// tramite upload resumable server-side, poi elimina il file temporaneo.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

// ── Token refresh ─────────────────────────────────────────────────────────────
async function getValidAccessToken(supabase: ReturnType<typeof createClient>, teamId: string): Promise<string> {
  const { data: member, error } = await supabase
    .from('team')
    .select('google_drive_access_token, google_drive_refresh_token, google_drive_token_expiry, google_drive_connected')
    .eq('id', teamId)
    .single();

  if (error || !member) throw new Error('Membro team non trovato');
  if (!member.google_drive_connected) throw new Error('Google Drive non connesso — connettilo in Impostazioni → Integrazioni');
  if (!member.google_drive_refresh_token) throw new Error('Refresh token mancante — riconnetti Google Drive');

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

  const newExpiry = nowMs + data.expires_in * 1000;
  await supabase.from('team').update({
    google_drive_access_token: data.access_token,
    google_drive_token_expiry: newExpiry,
  }).eq('id', teamId);

  return data.access_token;
}

// ── Trova o crea cartella Drive ───────────────────────────────────────────────
async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  return data.files?.length > 0 ? data.files[0].id : null;
}

async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Drive create folder error [${res.status}]: ${JSON.stringify(d)}`);
  return d.id;
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

async function findOrCreateRootFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  if (data.files?.length > 0) return data.files[0].id;
  return createFolder(token, name);
}

// ── Handler principale ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { storagePath, fileName, mimeType, fileSize, clientName, teamId } = await req.json();

    if (!storagePath || !fileName || !mimeType || !fileSize || !clientName || !teamId) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: storagePath, fileName, mimeType, fileSize, clientName, teamId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const accessToken = await getValidAccessToken(supabase, teamId);

    // ── Struttura cartelle Drive: Fuyue Agency / {clientName} / 📹 Contenuti
    const rootId    = await findOrCreateRootFolder(accessToken, 'Fuyue Agency');
    const clientId  = await findOrCreateFolder(accessToken, clientName, rootId);
    const contentId = await findOrCreateFolder(accessToken, '📹 Contenuti', clientId);

    // ── Inizia sessione upload resumable su Drive
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization:             `Bearer ${accessToken}`,
          'Content-Type':            'application/json',
          'X-Upload-Content-Type':   mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({ name: fileName, parents: [contentId], mimeType }),
      }
    );

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      const body = await initRes.text();
      throw new Error(`Impossibile creare sessione upload Drive: ${body}`);
    }

    // ── Scarica il file da Supabase Storage
    const { data: storageData, error: storageError } = await supabase
      .storage
      .from('temp-uploads')
      .download(storagePath);

    if (storageError || !storageData) {
      throw new Error(`Impossibile scaricare da Storage: ${storageError?.message}`);
    }

    // ── Carica su Drive in un unico request (server-side, nessun CORS)
    // Per file molto grandi (>5GB), potremmo fare chunked — ma edge function
    // ha timeout di 150s, quindi gestiamo fino a ~4GB su connessione veloce server-server
    const fileBuffer = await storageData.arrayBuffer();

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type':   mimeType,
        'Content-Length': String(fileSize),
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new Error(`Upload su Drive fallito (${uploadRes.status}): ${body}`);
    }

    const driveFile = await uploadRes.json();
    const fileId  = driveFile.id;
    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

    // ── Aggiorna folder id nel team
    await supabase.from('team').update({ google_drive_folder_id: rootId }).eq('id', teamId);

    // ── Elimina il file temporaneo da Supabase Storage
    await supabase.storage.from('temp-uploads').remove([storagePath]);

    console.log(`[google-drive-transfer] ✅ Trasferito "${fileName}" → Drive ID: ${fileId}`);

    return new Response(
      JSON.stringify({ fileId, fileUrl, fileName, folderId: contentId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-transfer]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
