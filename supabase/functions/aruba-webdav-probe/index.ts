import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const WEBDAV_URL = Deno.env.get('ARUBA_WEBDAV_URL');
    const WEBDAV_USER = Deno.env.get('ARUBA_WEBDAV_USERNAME');
    const WEBDAV_PASS = Deno.env.get('ARUBA_WEBDAV_PASSWORD');

    if (!WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASS) {
      return new Response(JSON.stringify({ error: 'Secrets mancanti' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const baseUrl = WEBDAV_URL.replace(/\/$/, '');
    const auth = btoa(`${WEBDAV_USER}:${WEBDAV_PASS}`);
    const authHeader = `Basic ${auth}`;

    const results: Record<string, { status: number; body: string; headers: Record<string,string> }> = {};

    // Test 1: PROPFIND su root URL (come fornita)
    const paths = [
      baseUrl,
      baseUrl + '/',
      baseUrl + '/dav',
      baseUrl + '/webdav',
      baseUrl + '/remote.php/dav/files/' + encodeURIComponent(WEBDAV_USER),
      baseUrl + '/remote.php/webdav',
    ];

    for (const path of paths) {
      try {
        const r = await fetch(path, {
          method: 'PROPFIND',
          headers: {
            Authorization: authHeader,
            Depth: '0',
            'Content-Type': 'application/xml',
          },
          body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
        });
        const body = await r.text();
        results[path.replace(baseUrl, '(base)')] = {
          status: r.status,
          body: body.substring(0, 200),
          headers: Object.fromEntries(r.headers.entries()),
        };
      } catch (e: unknown) {
        results[path.replace(baseUrl, '(base)')] = {
          status: 0,
          body: e instanceof Error ? e.message : 'errore',
          headers: {},
        };
      }
    }

    return new Response(JSON.stringify({ results, baseUrl_masking: '(base) = ' + baseUrl }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'errore' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
