export const prerender = false;
import type { APIRoute } from 'astro';

/**
 * Iscrizione newsletter "Il pack della settimana" via Resend (Audiences).
 * Env (Vercel): RESEND_API_KEY, RESEND_AUDIENCE_ID. Senza chiavi risponde 503 con messaggio chiaro.
 */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const audienceId = import.meta.env.RESEND_AUDIENCE_ID;
  let email = '', src = 'web';
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) { const b = await request.json(); email = String(b.email || ''); src = String(b.src || 'web'); }
    else { const f = await request.formData(); email = String(f.get('email') || ''); src = String(f.get('src') || 'web'); }
  } catch { return json(400, { ok: false, error: 'richiesta non valida' }); }
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(400, { ok: false, error: 'email non valida' });
  if (!apiKey || !audienceId) return json(503, { ok: false, error: 'newsletter non ancora attiva' });
  const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, unsubscribed: false, first_name: '', last_name: src.slice(0, 20) }),
  });
  if (!res.ok && res.status !== 409) return json(502, { ok: false, error: 'iscrizione non riuscita, riprova' });
  return json(200, { ok: true });
};
