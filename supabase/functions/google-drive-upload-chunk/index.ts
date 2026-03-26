// ─── google-drive-upload-chunk ───────────────────────────────────────────────
// Proxy per caricare un singolo chunk su Google Drive tramite sessione resumable.
// Il browser non parla MAI direttamente con googleapis.com — tutto passa qui.
// Chunk max: 4 MB (sotto il limite body della edge function Supabase ~6 MB).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upload-url, x-content-range, x-content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Leggi i parametri dagli header
    const uploadUrl    = req.headers.get('x-upload-url');
    const contentRange = req.headers.get('x-content-range');
    const mimeType     = req.headers.get('x-content-type') || 'video/mp4';

    if (!uploadUrl || !contentRange) {
      return new Response(
        JSON.stringify({ error: 'Header mancanti: x-upload-url, x-content-range' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Leggi il body (il chunk binario)
    const chunkBody = await req.arrayBuffer();

    if (chunkBody.byteLength === 0) {
      return new Response(
        JSON.stringify({ error: 'Chunk vuoto' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Inoltra il chunk a Google Drive
    const driveRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': contentRange,
        'Content-Type': mimeType,
        'Content-Length': String(chunkBody.byteLength),
      },
      body: chunkBody,
    });

    // 308 = upload incompleto, continua
    if (driveRes.status === 308) {
      const range = driveRes.headers.get('Range');
      return new Response(
        JSON.stringify({ status: 308, range: range || null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 200 / 201 = upload completato, ritorna fileId
    if (driveRes.status === 200 || driveRes.status === 201) {
      const data = await driveRes.json();
      return new Response(
        JSON.stringify({ status: driveRes.status, fileId: data.id, file: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Errore da Google
    const errBody = await driveRes.text().catch(() => '');
    console.error(`[upload-chunk] Google error ${driveRes.status}:`, errBody.slice(0, 500));
    return new Response(
      JSON.stringify({ error: `Google Drive error ${driveRes.status}`, detail: errBody.slice(0, 200) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-upload-chunk]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
