// ─── google-drive-upload-init ────────────────────────────────────────────────
// Usa OAuth2 dell'utente (access_token / refresh_token) per creare una sessione
// di upload resumable su Google Drive, sotto SKORPIO_Clip/{clientName}/
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;

// ── Ottieni un access_token valido, rinnovando se scaduto ─────────────────────
async function getValidAccessToken(teamId: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: member, error } = await supabase
    .from('team')
    .select('google_drive_access_token, google_drive_refresh_token, google_drive_token_expiry, google_drive_connected')
    .eq('id', teamId)
    .single();

  if (error || !member) throw new Error('Membro team non trovato');
  if (!member.google_drive_connected) throw new Error('Google Drive non connesso per questo utente');
  if (!member.google_drive_refresh_token) throw new Error('Refresh token mancante — riconnetti Google Drive');

  const nowMs = Date.now();
  const expiryMs = member.google_drive_token_expiry ?? 0;

  // Rinnova se scade entro 3 minuti
  if (member.google_drive_access_token && expiryMs - nowMs > 3 * 60 * 1000) {
    return member.google_drive_access_token;
  }

  // Refresh
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
async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const q = parentId
    ? `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error(`Impossibile creare cartella "${name}": ${JSON.stringify(created)}`);
  return created.id;
}

// ── Trova o crea cartella root in My Drive ────────────────────────────────────
async function findOrCreateRootFolder(accessToken: string, name: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error(`Impossibile creare cartella root "${name}": ${JSON.stringify(created)}`);
  return created.id;
}


// ── Handler principale ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { fileName, mimeType, fileSize, clientName, teamId } = await req.json();

    if (!fileName || !mimeType || !fileSize || !clientName || !teamId) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: fileName, mimeType, fileSize, clientName, teamId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await getValidAccessToken(teamId);

    // Struttura: Fuyue Agency / {clientName} / {subfolder}
    const rootId   = await findOrCreateRootFolder(accessToken, 'Fuyue Agency');
    const clientId = await findOrCreateFolder(accessToken, clientName, rootId);


    // Sessione upload resumable
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization:            `Bearer ${accessToken}`,
          'Content-Type':           'application/json',
          'X-Upload-Content-Type':  mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          name:     fileName,
          parents:  [clientId],
          mimeType,
        }),
      }
    );

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      const body = await initRes.text();
      return new Response(
        JSON.stringify({ error: `Impossibile creare sessione upload: ${body}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Salva folder ID per evitare ricreazioni future
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase.from('team').update({ google_drive_folder_id: rootId }).eq('id', teamId);

    return new Response(
      JSON.stringify({ uploadUrl, folderId: clientId, rootFolderId: rootId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-upload-init]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
