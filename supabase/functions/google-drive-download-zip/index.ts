// ─── google-drive-download-zip ──────────────────────────────────────────────
// Receives a list of fileIds, downloads each from Google Drive, zips them,
// and streams the ZIP back to the browser.
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

async function getValidAccessToken(teamId: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: member, error } = await supabase
    .from('team')
    .select('google_drive_access_token, google_drive_refresh_token, google_drive_token_expiry, google_drive_connected')
    .eq('id', teamId)
    .single();

  if (error || !member) throw new Error('Membro team non trovato');
  if (!member.google_drive_connected) throw new Error('Google Drive non connesso');
  if (!member.google_drive_refresh_token) throw new Error('Refresh token mancante');

  const nowMs = Date.now();
  const expiryMs = member.google_drive_token_expiry ?? 0;

  if (member.google_drive_access_token && expiryMs - nowMs > 3 * 60 * 1000) {
    return member.google_drive_access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: member.google_drive_refresh_token,
      grant_type: 'refresh_token',
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

// ─── Minimal ZIP creation helpers (no external deps) ────────────────────────
// We build a ZIP file manually using the "stored" method (no compression)
// which is simple and fast for already-compressed video files.

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function writeUint32LE(view: DataView, offset: number, val: number) {
  view.setUint32(offset, val, true);
}
function writeUint16LE(view: DataView, offset: number, val: number) {
  view.setUint16(offset, val, true);
}

interface ZipEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  // Calculate total size
  let totalSize = 0;
  for (const e of entries) {
    totalSize += 30 + e.name.length + e.data.length; // local file header + data
  }
  const centralDirStart = totalSize;
  for (const e of entries) {
    totalSize += 46 + e.name.length; // central directory entry
  }
  const centralDirSize = totalSize - centralDirStart;
  totalSize += 22; // end of central directory

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  const now = new Date();
  const { time, date } = dosDateTime(now);

  let offset = 0;

  // Write local file headers + data
  for (const e of entries) {
    e.offset = offset;
    // Local file header signature
    writeUint32LE(view, offset, 0x04034B50); offset += 4;
    writeUint16LE(view, offset, 20); offset += 2; // version needed
    writeUint16LE(view, offset, 0); offset += 2;  // flags
    writeUint16LE(view, offset, 0); offset += 2;  // compression: stored
    writeUint16LE(view, offset, time); offset += 2;
    writeUint16LE(view, offset, date); offset += 2;
    writeUint32LE(view, offset, e.crc); offset += 4;
    writeUint32LE(view, offset, e.data.length); offset += 4; // compressed
    writeUint32LE(view, offset, e.data.length); offset += 4; // uncompressed
    writeUint16LE(view, offset, e.name.length); offset += 2;
    writeUint16LE(view, offset, 0); offset += 2; // extra field length
    buf.set(e.name, offset); offset += e.name.length;
    buf.set(e.data, offset); offset += e.data.length;
  }

  // Central directory
  for (const e of entries) {
    writeUint32LE(view, offset, 0x02014B50); offset += 4;
    writeUint16LE(view, offset, 20); offset += 2; // version made by
    writeUint16LE(view, offset, 20); offset += 2; // version needed
    writeUint16LE(view, offset, 0); offset += 2;  // flags
    writeUint16LE(view, offset, 0); offset += 2;  // compression
    writeUint16LE(view, offset, time); offset += 2;
    writeUint16LE(view, offset, date); offset += 2;
    writeUint32LE(view, offset, e.crc); offset += 4;
    writeUint32LE(view, offset, e.data.length); offset += 4;
    writeUint32LE(view, offset, e.data.length); offset += 4;
    writeUint16LE(view, offset, e.name.length); offset += 2;
    writeUint16LE(view, offset, 0); offset += 2; // extra
    writeUint16LE(view, offset, 0); offset += 2; // comment
    writeUint16LE(view, offset, 0); offset += 2; // disk start
    writeUint16LE(view, offset, 0); offset += 2; // internal attrs
    writeUint32LE(view, offset, 0); offset += 4;  // external attrs
    writeUint32LE(view, offset, e.offset); offset += 4; // local header offset
    buf.set(e.name, offset); offset += e.name.length;
  }

  // End of central directory
  writeUint32LE(view, offset, 0x06054B50); offset += 4;
  writeUint16LE(view, offset, 0); offset += 2; // disk number
  writeUint16LE(view, offset, 0); offset += 2; // central dir disk
  writeUint16LE(view, offset, entries.length); offset += 2;
  writeUint16LE(view, offset, entries.length); offset += 2;
  writeUint32LE(view, offset, centralDirSize); offset += 4;
  writeUint32LE(view, offset, centralDirStart); offset += 4;
  writeUint16LE(view, offset, 0); offset += 2; // comment length

  return buf;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { teamId, files, zipName } = body as {
      teamId: string;
      files: { fileId: string; fileName: string }[];
      zipName?: string;
    };

    if (!teamId || !files || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({ error: 'teamId e files[] obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getValidAccessToken(teamId);
    const encoder = new TextEncoder();
    const entries: ZipEntry[] = [];

    // Download each file and add to ZIP
    const usedNames = new Set<string>();
    for (const f of files) {
      try {
        const dlRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${f.fileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!dlRes.ok) {
          console.warn(`[zip] Skip file ${f.fileId}: ${dlRes.status}`);
          continue;
        }
        const data = new Uint8Array(await dlRes.arrayBuffer());
        
        // Deduplicate file names
        let name = f.fileName || f.fileId;
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let counter = 2;
          while (usedNames.has(`${base}_${counter}${ext}`)) counter++;
          name = `${base}_${counter}${ext}`;
        }
        usedNames.add(name);

        entries.push({
          name: encoder.encode(name),
          data,
          crc: crc32(data),
          offset: 0,
        });
      } catch (err) {
        console.warn(`[zip] Error downloading ${f.fileId}:`, err);
      }
    }

    if (entries.length === 0) {
      return new Response(JSON.stringify({ error: 'Nessun file scaricato con successo' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const zipData = buildZip(entries);
    const finalName = zipName || 'download.zip';
    const encodedName = encodeURIComponent(finalName);

    return new Response(zipData, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${finalName}"; filename*=UTF-8''${encodedName}`,
        'Content-Length': String(zipData.length),
      },
    });

  } catch (err) {
    console.error('[google-drive-download-zip]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
