import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

// SKORPIO: cartella root fissa, non la ricerchiamo — usiamo direttamente l'ID
const SKORPIO_CLIP_ROOT = Deno.env.get('SKORPIO_CLIP_ROOT_FOLDER_ID') || '1LH4K5CJD1NuKEAOyZLC7iYrEzQkqgogY';

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

// ── Ottieni un access_token valido, rinnovando se scaduto ─────────────────────
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
  if (data.error) throw new Error(`Refresh token fallito: ${data.error_description || data.error}`);

  const newExpiry = nowMs + data.expires_in * 1000;
  await supabase.from('team').update({
    google_drive_access_token: data.access_token,
    google_drive_token_expiry: newExpiry,
  }).eq('id', teamId);

  return data.access_token;
}

// ── Cerca cartella per nome dentro un parent ──────────────────────────────────
async function findFolder(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  return data.files?.length > 0 ? data.files[0].id : null;
}

// ── Crea una cartella ─────────────────────────────────────────────────────────
async function createFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive create error [${res.status}]: ${JSON.stringify(data)}`);
  return data.id;
}

// ── Trova o crea cartella ─────────────────────────────────────────────────────
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
    const { contenuto_id, titolo, cliente_nome, tipo, id_display, team_id } = await req.json();

    if (!contenuto_id || !titolo) {
      return new Response(JSON.stringify({ error: 'contenuto_id e titolo sono obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!team_id) {
      return new Response(JSON.stringify({ error: 'team_id è obbligatorio per autenticarsi con Google Drive' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getValidAccessToken(team_id);

    // ── Struttura: SKORPIO_Clip/{NomeCliente}/{CLP_ID}_{titolo-slug}/
    const clienteFolderName = cliente_nome || 'Senza cliente';
    const clpFolderName = id_display
      ? `${id_display}_${slugify(titolo)}`
      : slugify(titolo);

    // 1. Cartella cliente dentro la root SKORPIO_Clip
    const clienteId = await findOrCreateFolder(accessToken, clienteFolderName, SKORPIO_CLIP_ROOT);

    // 2. Cartella CLP
    const clpId = await findOrCreateFolder(accessToken, clpFolderName, clienteId);

    // 3. Sottocartelle clip/ e file_esportato/
    const clipFolderId    = await findOrCreateFolder(accessToken, 'clip', clpId);
    const exportFolderId  = await findOrCreateFolder(accessToken, 'file_esportato', clpId);

    const clpFolderUrl = `https://drive.google.com/drive/folders/${clpId}`;

    // Aggiorna DB: link_drive + drive_clip_folder_id + drive_export_folder_id
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase
      .from('contenuti')
      .update({
        link_drive: clpFolderUrl,
        drive_clip_folder_id: clipFolderId,
        drive_export_folder_id: exportFolderId,
      })
      .eq('id', contenuto_id);

    const fullPath = `SKORPIO_Clip/${clienteFolderName}/${clpFolderName}`;
    console.log(`✅ Cartella Drive creata: ${fullPath} → ${clpFolderUrl}`);
    console.log(`   📁 clip/ → ${clipFolderId}`);
    console.log(`   📁 file_esportato/ → ${exportFolderId}`);

    return new Response(JSON.stringify({
      success: true,
      folder_id:         clpId,
      folder_url:        clpFolderUrl,
      folder_path:       fullPath,
      clip_folder_id:    clipFolderId,
      export_folder_id:  exportFolderId,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Errore create-drive-folder:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
