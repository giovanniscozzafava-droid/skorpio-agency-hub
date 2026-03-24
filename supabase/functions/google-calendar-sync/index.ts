import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) return null;
  return data;
}

async function getValidToken(supabase: any, teamMember: any): Promise<string | null> {
  const now = Date.now();
  // Se il token scade tra meno di 5 minuti, refresha
  if (teamMember.google_calendar_token_expiry && now < teamMember.google_calendar_token_expiry - 300000) {
    return teamMember.google_calendar_access_token;
  }
  // Refresh
  if (!teamMember.google_calendar_refresh_token) return null;
  const refreshed = await refreshAccessToken(teamMember.google_calendar_refresh_token);
  if (!refreshed) return null;
  const newExpiry = now + (refreshed.expires_in * 1000);
  await supabase.from('team').update({
    google_calendar_access_token: refreshed.access_token,
    google_calendar_token_expiry: newExpiry,
  }).eq('id', teamMember.id);
  return refreshed.access_token;
}

function buildGoogleEvent(ev: any): any {
  const dateStr = ev.data; // YYYY-MM-DD
  const startTime = ev.ora ? `${dateStr}T${ev.ora}:00` : null;
  const endTime = ev.ora_fine ? `${dateStr}T${ev.ora_fine}:00` : null;

  const summary = ev.descrizione || ev.titolo || 'Evento';
  const description = [
    ev.cliente_nome ? `Cliente: ${ev.cliente_nome}` : '',
    ev.canale ? `Canale: ${ev.canale}` : '',
    ev.id_contenuto_display ? `ID: ${ev.id_contenuto_display}` : '',
    ev.persona ? `Assegnato a: ${ev.persona}` : '',
  ].filter(Boolean).join('\n');

  if (startTime) {
    return {
      summary,
      description,
      start: { dateTime: startTime, timeZone: 'Europe/Rome' },
      end: { dateTime: endTime || new Date(new Date(startTime).getTime() + 3600000).toISOString(), timeZone: 'Europe/Rome' },
      extendedProperties: { private: { skorpio_id: ev.id } },
    };
  } else {
    return {
      summary,
      description,
      start: { date: dateStr },
      end: { date: dateStr },
      extendedProperties: { private: { skorpio_id: ev.id } },
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { team_id, event_id, action } = body;
    // action: 'upsert' | 'delete' | 'sync_month'

    // Carica il team member
    const { data: member, error: memberErr } = await supabase
      .from('team')
      .select('*')
      .eq('id', team_id)
      .single();

    if (memberErr || !member) {
      return new Response(JSON.stringify({ error: 'Team member not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!member.google_calendar_connected || !member.google_calendar_refresh_token) {
      return new Response(JSON.stringify({ error: 'Google Calendar not connected' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getValidToken(supabase, member);
    if (!accessToken) {
      // Segna come disconnesso
      await supabase.from('team').update({ google_calendar_connected: false }).eq('id', team_id);
      return new Response(JSON.stringify({ error: 'Failed to refresh token, please reconnect' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const calendarId = member.google_calendar_id || 'primary';
    const gcalBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // ── Upsert single event ────────────────────────────────────────────────
    if (action === 'upsert' && event_id) {
      const { data: ev } = await supabase.from('calendario').select('*').eq('id', event_id).single();
      if (!ev) return new Response(JSON.stringify({ error: 'Event not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const googleEvent = buildGoogleEvent(ev);

      // Cerca se esiste già per skorpio_id
      const searchRes = await fetch(
        `${gcalBase}?privateExtendedProperty=skorpio_id%3D${ev.id}&maxResults=1`,
        { headers: authHeader }
      );
      const searchData = await searchRes.json();
      const existing = searchData.items?.[0];

      if (existing) {
        // Update
        await fetch(`${gcalBase}/${existing.id}`, {
          method: 'PUT',
          headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify(googleEvent),
        });
      } else {
        // Insert
        await fetch(gcalBase, {
          method: 'POST',
          headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify(googleEvent),
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── Sync month (bulk) ──────────────────────────────────────────────────
    if (action === 'sync_month') {
      const { year, month, nome_utente, ruolo } = body;
      const isAdmin = ruolo === 'Admin';

      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endDate = new Date(year, month + 1, 0);
      const endDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

      // Carica gli eventi del mese visibili a questo utente
      let query = supabase.from('calendario').select('*').gte('data', startDate).lte('data', endDateStr);

      if (!isAdmin) {
        // Utente normale: i propri appuntamenti/task + tutte le pubblicazioni
        query = supabase.from('calendario').select('*')
          .gte('data', startDate).lte('data', endDateStr)
          .or(`tipo.eq.pubblicazione,and(persona.eq.${nome_utente})`);
      }

      const { data: events } = await query;
      if (!events || events.length === 0) {
        return new Response(JSON.stringify({ success: true, synced: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let synced = 0;
      for (const ev of events) {
        const googleEvent = buildGoogleEvent(ev);
        const searchRes = await fetch(
          `${gcalBase}?privateExtendedProperty=skorpio_id%3D${ev.id}&maxResults=1`,
          { headers: authHeader }
        );
        const searchData = await searchRes.json();
        const existing = searchData.items?.[0];

        if (existing) {
          await fetch(`${gcalBase}/${existing.id}`, {
            method: 'PUT',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(googleEvent),
          });
        } else {
          await fetch(gcalBase, {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(googleEvent),
          });
        }
        synced++;
      }

      return new Response(JSON.stringify({ success: true, synced }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
