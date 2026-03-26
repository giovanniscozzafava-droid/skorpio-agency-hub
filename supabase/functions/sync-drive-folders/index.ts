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
const SKORPIO_CLIP_ROOT    = Deno.env.get('SKORPIO_CLIP_ROOT_FOLDER_ID') || '1LH4K5CJD1NuKEAOyZLC7iYrEzQkqgogY';

// Fasi che indicano un CLP già terminato (skip cartelle)
const FASI_SKIP = new Set(['Pubblicato', 'Usata']);

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

/** Pausa ms millisecondi */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Ottieni un access_token valido per Google Drive */
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

/** Cerca una cartella per nome dentro un parent */
async function findFolder(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = encodeURIComponent(`name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive search error: ${JSON.stringify(data)}`);
  return data.files?.length > 0 ? data.files[0].id : null;
}

/** Imposta permessi "anyone with link = writer" */
async function shareAnyone(accessToken: string, fileId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'anyone' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Crea una cartella su Google Drive */
async function createFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive create error [${res.status}]: ${JSON.stringify(data)}`);
  await shareAnyone(accessToken, data.id);
  return data.id;
}

/** Elenca tutti i file/cartelle dentro un folder (ricorsivo) */
async function listAllFiles(accessToken: string, folderId: string): Promise<string[]> {
  const ids: string[] = [folderId];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,mimeType)&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) break;
    for (const f of (data.files || [])) {
      ids.push(f.id);
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        const subIds = await listAllFiles(accessToken, f.id);
        ids.push(...subIds.filter(id => id !== f.id));
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

type LogEntry = { icon: string; label: string; detail: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const encoder = new TextEncoder();
  const { team_id } = await req.json().catch(() => ({}));

  if (!team_id) {
    return new Response(JSON.stringify({ error: 'team_id obbligatorio' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Streaming SSE ──────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      };

      try {
        const accessToken = await getValidAccessToken(team_id);
        const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // ────────────────── FASE 1: CLIENTI ──────────────────────────────────
        send({ type: 'section', text: '--- 📁 Fase 1: Cartelle Clienti ---' });

        const { data: clienti, error: errClienti } = await supabase
          .from('clienti')
          .select('id, nome, stato, link_drive')
          .eq('stato', 'Attivo');

        if (errClienti) throw new Error(`Errore lettura clienti: ${errClienti.message}`);

        let clientiCreati = 0;
        let clientiEsistenti = 0;
        // cache: nome → folder_id  (per usarla nella fase CLP)
        const clienteFolderCache: Record<string, string> = {};

        for (const cliente of (clienti || [])) {
          try {
            const { id: folderId, existed } = await findOrCreate(accessToken, cliente.nome, SKORPIO_CLIP_ROOT);
            clienteFolderCache[cliente.nome] = folderId;

            if (existed) {
              clientiEsistenti++;
              send({ type: 'log', icon: '✅', label: cliente.nome, detail: 'cartella esistente' });
            } else {
              clientiCreati++;
              send({ type: 'log', icon: '🆕', label: cliente.nome, detail: 'cartella creata' });
            }

            // Aggiorna link_drive nel DB se mancante
            if (!cliente.link_drive) {
              await supabase.from('clienti').update({
                link_drive: `https://drive.google.com/drive/folders/${folderId}`,
              }).eq('id', cliente.id);
            }
          } catch (e) {
            send({ type: 'log', icon: '❌', label: cliente.nome, detail: String(e) });
          }

          // Rate limiting: max ~5 op/s (3 chiamate per cartella cliente)
          await sleep(200);
        }

        send({
          type: 'section_done',
          text: `✅ Clienti: ${clientiCreati} create, ${clientiEsistenti} già esistenti`,
        });

        // ────────────────── FASE 2: CLP IN PRODUZIONE ─────────────────────────
        await sleep(300);
        send({ type: 'section', text: '--- 🎬 Fase 2: Cartelle CLP in produzione ---' });

        const { data: clp, error: errClp } = await supabase
          .from('contenuti')
          .select('id, id_display, titolo, cliente_nome, cliente_id, fase, link_drive, drive_clip_folder_id, drive_export_folder_id');

        if (errClp) throw new Error(`Errore lettura CLP: ${errClp.message}`);

        let clpCreati = 0;
        let clpSkipped = 0;
        let clpEsistenti = 0;

        for (const contenuto of (clp || [])) {
          const fase = contenuto.fase || '';

          if (FASI_SKIP.has(fase)) {
            clpSkipped++;
            send({ type: 'log', icon: '⏭️', label: `${contenuto.id_display} — ${contenuto.titolo}`, detail: `SKIP (${fase})` });
            continue;
          }

          // Se ha già entrambe le sottocartelle, salta
          if (contenuto.drive_clip_folder_id && contenuto.drive_export_folder_id) {
            clpEsistenti++;
            send({ type: 'log', icon: '✅', label: `${contenuto.id_display} — ${contenuto.titolo}`, detail: 'cartelle già presenti' });
            continue;
          }

          try {
            const clienteNome = contenuto.cliente_nome || 'Senza cliente';

            // Trova/crea cartella cliente
            let clienteParentId = clienteFolderCache[clienteNome];
            if (!clienteParentId) {
              const res = await findOrCreate(accessToken, clienteNome, SKORPIO_CLIP_ROOT);
              clienteParentId = res.id;
              clienteFolderCache[clienteNome] = clienteParentId;
              await sleep(200);
            }

            const clpFolderName = contenuto.id_display
              ? `${contenuto.id_display}_${slugify(contenuto.titolo)}`
              : slugify(contenuto.titolo);

            // Cartella CLP principale
            const { id: clpId, existed: clpExisted } = await findOrCreate(accessToken, clpFolderName, clienteParentId);
            await sleep(200);

            // Sotto-cartelle
            const { id: clipFolderId } = await findOrCreate(accessToken, 'clip', clpId);
            await sleep(200);
            const { id: exportFolderId } = await findOrCreate(accessToken, 'file_esportato', clpId);
            await sleep(200);

            // Salva nel DB
            await supabase.from('contenuti').update({
              link_drive:           `https://drive.google.com/drive/folders/${clpId}`,
              drive_clip_folder_id: clipFolderId,
              drive_export_folder_id: exportFolderId,
            }).eq('id', contenuto.id);

            clpCreati++;
            send({
              type: 'log',
              icon: clpExisted ? '🔄' : '🆕',
              label: `${contenuto.id_display} — ${contenuto.titolo} (${clienteNome})`,
              detail: clpExisted ? 'struttura aggiornata' : 'cartelle create',
            });
          } catch (e) {
            send({ type: 'log', icon: '❌', label: `${contenuto.id_display} — ${contenuto.titolo}`, detail: String(e) });
          }
        }

        send({
          type: 'section_done',
          text: `✅ CLP: ${clpCreati} create/aggiornate, ${clpEsistenti} già OK, ${clpSkipped} saltate`,
        });

        send({ type: 'done', clientiCreati, clientiEsistenti, clpCreati, clpEsistenti, clpSkipped });

      } catch (err) {
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
