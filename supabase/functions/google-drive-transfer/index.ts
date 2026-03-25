// ─── google-drive-transfer ────────────────────────────────────────────────────
// Legge un file da Supabase Storage (temp-uploads) e lo carica su Google Drive
// nella cartella corretta (clip/ o file_esportato/) server-side.
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
const SKORPIO_CLIP_ROOT    = Deno.env.get('SKORPIO_CLIP_ROOT_FOLDER_ID') || '1LH4K5CJD1NuKEAOyZLC7iYrEzQkqgogY';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

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

// ── Drive helpers ─────────────────────────────────────────────────────────────
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

/**
 * Ottieni o crea la struttura cartelle per un CLP:
 * SKORPIO_Clip/{NomeCliente}/{CLP_ID}_{slug}/clip/   oppure   .../file_esportato/
 * Se i folder IDs sono già in DB, li usa direttamente (più veloce).
 */
async function getTargetFolderId(
  token: string,
  supabase: ReturnType<typeof createClient>,
  zone: 'clip' | 'file_esportato',
  contenutoId: string | null,
  clienteName: string,
  idDisplay: string,
  titolo: string
): Promise<{ folderId: string; clipFolderId: string; exportFolderId: string }> {
  // Leggi i folder IDs già salvati (se esistono)
  let clipFolderId = '';
  let exportFolderId = '';

  if (contenutoId) {
    const { data: cnt } = await supabase
      .from('contenuti')
      .select('drive_clip_folder_id, drive_export_folder_id')
      .eq('id', contenutoId)
      .single();

    if (cnt?.drive_clip_folder_id && cnt?.drive_export_folder_id) {
      clipFolderId   = cnt.drive_clip_folder_id;
      exportFolderId = cnt.drive_export_folder_id;
      return {
        folderId: zone === 'clip' ? clipFolderId : exportFolderId,
        clipFolderId,
        exportFolderId,
      };
    }
  }

  // Crea struttura completa
  const clpFolderName  = idDisplay ? `${idDisplay}_${slugify(titolo)}` : slugify(titolo);
  const clienteId      = await findOrCreateFolder(token, clienteName || 'Senza cliente', SKORPIO_CLIP_ROOT);
  const clpId          = await findOrCreateFolder(token, clpFolderName, clienteId);
  clipFolderId         = await findOrCreateFolder(token, 'clip', clpId);
  exportFolderId       = await findOrCreateFolder(token, 'file_esportato', clpId);

  // Salva i folder IDs in DB
  if (contenutoId) {
    await supabase
      .from('contenuti')
      .update({
        drive_clip_folder_id:   clipFolderId,
        drive_export_folder_id: exportFolderId,
        link_drive: `https://drive.google.com/drive/folders/${clpId}`,
      })
      .eq('id', contenutoId);
  }

  return {
    folderId: zone === 'clip' ? clipFolderId : exportFolderId,
    clipFolderId,
    exportFolderId,
  };
}

// ── Handler principale ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      storagePath,
      fileName,
      mimeType,
      fileSize,
      clientName,
      teamId,
      zone = 'clip',       // 'clip' | 'file_esportato'
      contenutoId = null,  // uuid del contenuto (per recuperare folder IDs)
      idDisplay = '',
      titolo = '',
    } = await req.json();

    if (!storagePath || !fileName || !mimeType || !fileSize || !clientName || !teamId) {
      return new Response(
        JSON.stringify({ error: 'Parametri mancanti: storagePath, fileName, mimeType, fileSize, clientName, teamId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const accessToken = await getValidAccessToken(supabase, teamId);

    // ── Ottieni la cartella di destinazione corretta
    const { folderId, clipFolderId, exportFolderId } = await getTargetFolderId(
      accessToken,
      supabase,
      zone as 'clip' | 'file_esportato',
      contenutoId,
      clientName,
      idDisplay,
      titolo
    );

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
        body: JSON.stringify({ name: fileName, parents: [folderId], mimeType }),
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

    // ── Elimina il file temporaneo da Supabase Storage
    await supabase.storage.from('temp-uploads').remove([storagePath]);

    console.log(`[google-drive-transfer] ✅ "${fileName}" → Drive zone=${zone} ID: ${fileId}`);

    return new Response(
      JSON.stringify({
        fileId,
        fileUrl,
        fileName,
        folderId,
        clipFolderId,
        exportFolderId,
        zone,
      }),
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
