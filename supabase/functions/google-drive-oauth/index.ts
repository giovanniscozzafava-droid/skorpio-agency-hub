// ─── google-drive-oauth ───────────────────────────────────────────────────────
// OAuth2 flow per Google Drive (drive.file scope).
// Riutilizza le stesse credenziali OAuth di Google Calendar.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const url      = new URL(req.url);
  const action   = url.searchParams.get('action');

  try {
    // ── 1. Genera URL autorizzazione ─────────────────────────────────────────
    if (action === 'get_url') {
      const { redirect_uri } = await req.json();

      const params = new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        redirect_uri,
        response_type: 'code',
        scope:         'https://www.googleapis.com/auth/drive.file',
        access_type:   'offline',
        prompt:        'consent',
      });

      return new Response(
        JSON.stringify({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 2. Scambia code per tokens ──────────────────────────────────────────
    if (action === 'exchange') {
      const { code, redirect_uri, team_id } = await req.json();

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type:    'authorization_code',
        }),
      });

      const tokens = await tokenRes.json();
      if (tokens.error) {
        return new Response(JSON.stringify({ error: tokens.error_description }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const expiry = Date.now() + (tokens.expires_in * 1000);

      await supabase.from('team').update({
        google_drive_access_token:  tokens.access_token,
        google_drive_refresh_token: tokens.refresh_token ?? null,
        google_drive_token_expiry:  expiry,
        google_drive_connected:     true,
      }).eq('id', team_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Refresh token ────────────────────────────────────────────────────
    if (action === 'refresh') {
      const { team_id } = await req.json();

      const { data: member, error: fetchErr } = await supabase
        .from('team')
        .select('google_drive_refresh_token')
        .eq('id', team_id)
        .single();

      if (fetchErr || !member?.google_drive_refresh_token) {
        return new Response(JSON.stringify({ error: 'Refresh token non trovato' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: member.google_drive_refresh_token,
          grant_type:    'refresh_token',
        }),
      });

      const refreshed = await refreshRes.json();
      if (refreshed.error) {
        return new Response(JSON.stringify({ error: refreshed.error_description }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const newExpiry = Date.now() + (refreshed.expires_in * 1000);

      await supabase.from('team').update({
        google_drive_access_token: refreshed.access_token,
        google_drive_token_expiry: newExpiry,
      }).eq('id', team_id);

      return new Response(JSON.stringify({ access_token: refreshed.access_token, expiry: newExpiry }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Disconnect ───────────────────────────────────────────────────────
    if (action === 'disconnect') {
      const { team_id } = await req.json();

      await supabase.from('team').update({
        google_drive_access_token:  null,
        google_drive_refresh_token: null,
        google_drive_token_expiry:  null,
        google_drive_connected:     false,
        google_drive_folder_id:     null,
      }).eq('id', team_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Azione sconosciuta' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
    console.error('[google-drive-oauth]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
