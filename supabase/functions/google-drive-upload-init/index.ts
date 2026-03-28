// ─── google-drive-upload-init ────────────────────────────────────────────────
// Inizializza una sessione resumable upload su Google Drive e ritorna l'URI al
// frontend. Accetta un folderId già noto (clip/ o file_esportato/) così il
// frontend può caricare direttamente senza passare per Supabase Storage.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const ROOT_FOLDER_ID       = Deno.env.get('SKORPIO_CLIP_ROOT_FOLDER_ID') || '';

// ── Ottieni access_token valido, rinnovando se scaduto ────────────────────────
async function getValidAccessToken(teamId: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

// ── Cerca cartella per nome dentro un parent ──────────────────────────────────
async function findFolder(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  return data.files?.length > 0 ? data.files[0].id : null;
}

// ── Imposta permessi "anyone with link = writer" ─────────────────────────────
async function shareAnyone(accessToken: string, fileId: string): Promise<void> {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'anyone' }),
    });
  } catch (e) {
    console.warn(`⚠️ Impossibile impostare permessi su ${fileId}:`, e);
  }
}

// ── Crea cartella ─────────────────────────────────────────────────────────────
async function createFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Drive create folder [${res.status}]: ${JSON.stringify(d)}`);
  await shareAnyone(accessToken, d.id);
  return d.id;
}

async function findOrCreate(accessToken: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(accessToken, name, parentId);
  return existing || await createFolder(accessToken, name, parentId);
}

// ── Handler principale ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      fileName, mimeType, fileSize,
      teamId,
      // Destination: either pass folderId directly OR clientName + zone + contenutoId for auto-resolve
      folderId,
      clientName, zone, contenutoId, idDisplay, titolo,
    } = await req.json();

    if (!fileName || !mimeType || !fileSize || !teamId) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: fileName, mimeType, fileSize, teamId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await getValidAccessToken(teamId);
    const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Risolvi la cartella di destinazione
    let targetFolderId = folderId as string | undefined;

    if (!targetFolderId && clientName && zone && contenutoId) {
      // Auto-risolvi: cerca drive_clip_folder_id / drive_export_folder_id nel CLP
      const { data: clp } = await supabase
        .from('contenuti')
        .select('drive_clip_folder_id, drive_export_folder_id, link_drive')
        .eq('id', contenutoId)
        .single();

      if (zone === 'clip' && clp?.drive_clip_folder_id) {
        targetFolderId = clp.drive_clip_folder_id;
      } else if (zone === 'file_esportato' && clp?.drive_export_folder_id) {
        targetFolderId = clp.drive_export_folder_id;
      }

      // Se non esistono le cartelle, creale
      if (!targetFolderId) {
        const rootId   = ROOT_FOLDER_ID;
        const clientId = await findOrCreate(accessToken, clientName, rootId);
        const slug     = (titolo || idDisplay || 'clip').toLowerCase()
          .replace(/[àáâ]/g,'a').replace(/[èéê]/g,'e').replace(/[ìí]/g,'i')
          .replace(/[òó]/g,'o').replace(/[ùú]/g,'u')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const clpFolderName = `${idDisplay || 'CLP'}_${slug}`;
        const clpId    = await findOrCreate(accessToken, clpFolderName, clientId);
        const clipId   = await findOrCreate(accessToken, 'clip', clpId);
        const expId    = await findOrCreate(accessToken, 'file_esportato', clpId);
        const link     = `https://drive.google.com/drive/folders/${clpId}`;

        await supabase.from('contenuti').update({
          drive_clip_folder_id:   clipId,
          drive_export_folder_id: expId,
          link_drive:             link,
        }).eq('id', contenutoId);

        targetFolderId = zone === 'clip' ? clipId : expId;
      }
    }

    if (!targetFolderId) {
      return new Response(
        JSON.stringify({ error: 'Impossibile determinare la cartella di destinazione. Passa folderId o clientName+zone+contenutoId.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Inizializza sessione resumable upload Google Drive
    // L'header Origin è necessario affinché Google includa i CORS headers corretti
    // nell'URI di sessione, così il browser può leggere le risposte ai chunk PUT.
    const initRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization:             `Bearer ${accessToken}`,
          'Content-Type':            'application/json',
          'X-Upload-Content-Type':   mimeType,
          'X-Upload-Content-Length': String(fileSize),
          'Origin':                  'https://skorpio-agency-hub.vercel.app',
        },
        body: JSON.stringify({
          name:    fileName,
          parents: [targetFolderId],
          mimeType,
        }),
      }
    );

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      const body = await initRes.text();
      return new Response(
        JSON.stringify({ error: `Impossibile creare sessione resumable: ${body}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ uploadUrl, folderId: targetFolderId }),
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
