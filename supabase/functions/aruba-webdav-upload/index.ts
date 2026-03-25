import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const WEBDAV_URL = Deno.env.get('ARUBA_WEBDAV_URL');
    const WEBDAV_USER = Deno.env.get('ARUBA_WEBDAV_USERNAME');
    const WEBDAV_PASS = Deno.env.get('ARUBA_WEBDAV_PASSWORD');

    if (!WEBDAV_URL) throw new Error('ARUBA_WEBDAV_URL non configurata');
    if (!WEBDAV_USER) throw new Error('ARUBA_WEBDAV_USERNAME non configurata');
    if (!WEBDAV_PASS) throw new Error('ARUBA_WEBDAV_PASSWORD non configurata');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const percorso = (formData.get('percorso') as string) || ''; // es: "ClienteNome/Reel/Titolo"
    const contenutoId = (formData.get('contenuto_id') as string) || '';
    const nomeFile = (formData.get('nome_file') as string) || file?.name || 'file';

    if (!file) {
      return new Response(JSON.stringify({ success: false, error: 'Nessun file allegato' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalizza base URL
    const baseUrl = WEBDAV_URL.replace(/\/$/, '');
    const auth = btoa(`${WEBDAV_USER}:${WEBDAV_PASS}`);
    const authHeader = `Basic ${auth}`;

    // Crea cartelle intermedie con MKCOL ricorsivo
    if (percorso) {
      const parti = percorso.split('/').filter(Boolean);
      let percorsoAccumulato = '';
      for (const parte of parti) {
        percorsoAccumulato += `/${encodeURIComponent(parte)}`;
        const mkcolRes = await fetch(`${baseUrl}${percorsoAccumulato}`, {
          method: 'MKCOL',
          headers: { Authorization: authHeader },
        });
        // 201 = creata, 405 = già esiste — entrambi ok
        if (mkcolRes.status !== 201 && mkcolRes.status !== 405) {
          console.log(`MKCOL ${percorsoAccumulato}: ${mkcolRes.status}`);
        }
      }
    }

    // Upload del file con PUT
    const nomeFileEncoded = encodeURIComponent(nomeFile);
    const filePath = percorso
      ? `/${percorso.split('/').map(p => encodeURIComponent(p)).join('/')}/${nomeFileEncoded}`
      : `/${nomeFileEncoded}`;

    const fileBuffer = await file.arrayBuffer();

    const uploadRes = await fetch(`${baseUrl}${filePath}`, {
      method: 'PUT',
      headers: {
        Authorization: authHeader,
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Length': fileBuffer.byteLength.toString(),
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok && uploadRes.status !== 201 && uploadRes.status !== 204) {
      const errText = await uploadRes.text();
      throw new Error(`Upload fallito [${uploadRes.status}]: ${errText}`);
    }

    // URL pubblico del file (WebDAV serve anche come HTTP)
    const fileUrl = `${baseUrl}${filePath}`;

    return new Response(
      JSON.stringify({
        success: true,
        url: fileUrl,
        nome_file: nomeFile,
        percorso: percorso,
        contenuto_id: contenutoId,
        dimensione_bytes: fileBuffer.byteLength,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('Aruba WebDAV Upload error:', msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
