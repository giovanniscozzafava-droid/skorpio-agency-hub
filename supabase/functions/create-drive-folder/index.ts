import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;

// Mappa tipo contenuto → sottocartella cliente
function getSubfolderForTipo(tipo: string | null): string {
  const t = (tipo || '').toLowerCase();
  if (t === 'grafica' || t === 'grafiche' || t === 'foto' || t === 'carosello' || t === 'post') {
    return '🖼️ Grafiche';
  }
  if (t === 'adv' || t === 'advertising' || t === 'sponsorizzato') {
    return '📣 ADV';
  }
  return '📹 Contenuti';
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

  // Usa token corrente se scade tra più di 3 minuti
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

// ── Trova o crea cartella root (senza parent) ─────────────────────────────────
async function findOrCreateRootFolder(accessToken: string, name: string): Promise<string> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  if (data.files?.length > 0) return data.files[0].id;
  return await createFolder(accessToken, name);
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

    // Struttura: SKORPIO_Clip / {clientName} / {subfolder} / {titolo}
    const clienteFolderName = cliente_nome || 'Senza cliente';
    const subfolderName     = getSubfolderForTipo(tipo);

    const rootId       = await findOrCreateRootFolder(accessToken, 'SKORPIO_Clip');
    const clienteId    = await findOrCreateFolder(accessToken, clienteFolderName, rootId);
    const subFolderId  = await findOrCreateFolder(accessToken, subfolderName, clienteId);
    const contentFolderId = await createFolder(accessToken, titolo, subFolderId);

    const contentFolderUrl = `https://drive.google.com/drive/folders/${contentFolderId}`;

    // Aggiorna link_drive nel DB
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase
      .from('contenuti')
      .update({ link_drive: contentFolderUrl })
      .eq('id', contenuto_id);

    const fullPath = `SKORPIO_Clip/${clienteFolderName}/${subfolderName}/${titolo}`;
    console.log(`✅ Cartella Drive creata: ${fullPath} → ${contentFolderUrl}`);

    return new Response(JSON.stringify({
      success: true,
      folder_id:   contentFolderId,
      folder_url:  contentFolderUrl,
      folder_path: fullPath,
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
