// ─────────────────────────────────────────────────────────────────────────────
// _shared/emailProvider.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// Astrazione provider email: Brevo (default) o AWS SES (via SMTP denomailer).
//
// Lo switch avviene tramite env var `EMAIL_PROVIDER`:
//   - non settato o 'brevo' → usa Brevo API (comportamento storico)
//   - 'ses'                 → usa AWS SES via SMTP (denomailer)
//
// Secret richiesti:
//   - Per Brevo: BREVO_API_KEY
//   - Per SES:   AWS_SES_SMTP_HOST, AWS_SES_SMTP_PORT,
//                AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD
//
// Il payload è unificato (compatibile con la struttura Brevo storica) per
// minimizzare le modifiche a chi importa questo modulo.
//
// I `tags` Brevo non sono supportati da SES via SMTP standard (servono
// configuration sets / message tags via SES API): vengono semplicemente
// ignorati quando il provider è SES. Per analytics SES si userà il
// configuration set + SNS bounce/complaint handler in una fase successiva.
//
// ─────────────────────────────────────────────────────────────────────────────

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

// ─── Tipi pubblici ──────────────────────────────────────────────────────────
export interface EmailPayload {
  sender: { name: string; email: string };
  to: Array<{ email: string; name: string }>;
  subject: string;
  htmlContent: string;
  replyTo?: { email: string };
  /** In copia visibile al destinatario. Usato per «Giovanni sempre in copia» sulle email ai clienti (ordine del 21/09/2026). */
  cc?: Array<{ email: string; name?: string }>;
  headers?: Record<string, string>;
  tags?: string[]; // ignorato da SES (non supportato via SMTP standard)
  /** Allegati (contenuto in base64). Usati per gli inviti .ics del calendario. */
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}

export interface EmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export type EmailProvider = 'brevo' | 'ses' | 'resend';

// ─── Selettore provider ─────────────────────────────────────────────────────
export function getProvider(): EmailProvider {
  const raw = (Deno.env.get('EMAIL_PROVIDER') ?? 'brevo').toLowerCase();
  if (raw === 'ses') return 'ses';
  if (raw === 'resend') return 'resend';
  return 'brevo';
}

/**
 * Mapping tenant → provider di default. Permette al chiamante (es.
 * send-cold-outreach) di scegliere il provider corretto in base alla lista.
 */
export function getProviderForTenant(tenant: string | null | undefined): EmailProvider {
  switch ((tenant ?? 'skorpio').toLowerCase()) {
    case 'planfully': return 'resend';
    case 'skorpio':
    default:          return getProvider(); // skorpio rispetta env EMAIL_PROVIDER
  }
}

/**
 * Invia una singola email tramite il provider configurato.
 * Restituisce sempre `{ok: false, error}` in caso di errore (non solleva).
 *
 * @param payload  contenuto email
 * @param override (opzionale) forza un provider specifico, bypassando l'env
 */
export async function inviaEmail(
  payload: EmailPayload,
  override?: EmailProvider,
): Promise<EmailResult> {
  const provider = override ?? getProvider();
  if (provider === 'ses') return inviaSes(payload);
  if (provider === 'resend') return inviaResend(payload);
  return inviaBrevo(payload);
}

// ─── Brevo (HTTP API) ───────────────────────────────────────────────────────
async function inviaBrevo(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) {
    return { ok: false, error: 'BREVO_API_KEY non configurata' };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      // Brevo chiama gli allegati "attachment", con name/content: li traduco.
      body: JSON.stringify({
        ...payload,
        attachments: undefined,
        ...(payload.attachments?.length
          ? { attachment: payload.attachments.map((a) => ({ name: a.filename, content: a.content })) }
          : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || data?.code || `HTTP ${res.status}`,
      };
    }

    return { ok: true, messageId: data?.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── AWS SES (SMTP via denomailer) ──────────────────────────────────────────
//
// Crea un SMTPClient nuovo per ogni invio: denomailer su edge function ha
// problemi noti con il riuso connessioni keep-alive (timeout e socket
// chiusi tra una send e l'altra). Il costo di reconnessione è ~150-300ms
// che è in linea con il delay tra mail già presente nel loop di
// send-newsletter (DELAY_MS_BETWEEN_EMAILS = 150ms).
//
async function inviaSes(payload: EmailPayload): Promise<EmailResult> {
  const host = Deno.env.get('AWS_SES_SMTP_HOST') ?? 'email-smtp.eu-west-1.amazonaws.com';
  // 465 (TLS implicito) e basta: con 587 lo STARTTLS di denomailer fa
  // crashare l'isolate della edge function (503 muto, nessun catch possibile).
  // Verificato il 2026-09-09 con una sonda: 587 → worker morto, 465 → SMTP ok.
  const portEnv = parseInt(Deno.env.get('AWS_SES_SMTP_PORT') ?? '465', 10);
  const port = portEnv === 587 ? 465 : portEnv;
  const username = Deno.env.get('AWS_SES_SMTP_USERNAME') ?? '';
  const password = Deno.env.get('AWS_SES_SMTP_PASSWORD') ?? '';

  if (!username || !password) {
    return { ok: false, error: 'AWS_SES_SMTP_USERNAME/PASSWORD non configurati' };
  }

  // Port 465 → TLS implicito. Altri port (587, 2587) → STARTTLS.
  const tlsImplicit = port === 465;

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      tls: tlsImplicit,
      auth: { username, password },
    },
  });

  try {
    // denomailer codifica da solo nomi e Subject non-ASCII in Q-encoding,
    // ma lo fa male (spazi nudi e a-capo dentro l'encoded-word: Gmail mostra
    // "=?utf-8?Q?..." grezzo). Quindi: nomi traslitterati in ASCII e Subject
    // già codificato in base64 RFC 2047 (vedi subjectRfc2047).
    const fromAddr = formatAddress({ ...payload.sender, name: asciiName(payload.sender.name) });
    const toAddrs = payload.to.map((a) => formatAddress({ ...a, name: asciiName(a.name) }));
    const replyToAddr = payload.replyTo?.email;

    const ccAddrs = payload.cc?.map((a) => formatAddress({ ...a, name: asciiName(a.name) }));

    await client.send({
      from: fromAddr,
      to: toAddrs,
      subject: subjectRfc2047(payload.subject),
      html: payload.htmlContent,
      ...(replyToAddr ? { replyTo: replyToAddr } : {}),
      ...(payload.headers ? { headers: payload.headers } : {}),
      ...(ccAddrs?.length ? { cc: ccAddrs } : {}),
    });

    // denomailer non espone il MessageId restituito dal server SMTP SES.
    // Il MessageId reale è nell'header `Message-ID` del 250 OK di SES e
    // sarà recuperato via webhook SNS bounce/complaint nella fase 2.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // Chiudi la connessione SMTP per evitare leak di socket
    try {
      await client.close();
    } catch {
      // best-effort: ignoriamo errori di close
    }
  }
}

// ─── Resend (HTTP API) ──────────────────────────────────────────────────────
//
// Provider usato dal tenant 'planfully'. Sender autorizzato:
// "Sara De Luca <redazione@planfully.it>". Il dominio planfully.it è verificato
// in Resend (DKIM selector resend._domainkey già pubblicato in DNS).
//
// Secret richiesti:
//   - RESEND_API_KEY_PLANFULLY  (per tenant planfully)
//   - oppure RESEND_API_KEY     (fallback generico)
//
async function inviaResend(payload: EmailPayload): Promise<EmailResult> {
  const apiKey =
    Deno.env.get('RESEND_API_KEY_PLANFULLY') ??
    Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY_PLANFULLY/RESEND_API_KEY non configurata' };
  }

  // Adatta payload Brevo-like → schema Resend
  const fromAddr = formatAddress(payload.sender);
  const toAddrs = payload.to.map(formatAddress);
  const body = {
    from: fromAddr,
    to: toAddrs,
    reply_to: payload.replyTo?.email,
    subject: payload.subject,
    html: payload.htmlContent,
    headers: payload.headers,
    ...(payload.cc?.length ? { cc: payload.cc.map(formatAddress) } : {}),
    tags: (payload.tags ?? []).map((t) => ({ name: 'tag', value: t })),
    ...(payload.attachments?.length
      ? {
        attachments: payload.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          ...(a.contentType ? { content_type: a.contentType } : {}),
        })),
      }
      : {}),
  };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || data?.name || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────────
// Nome visualizzato senza accenti né caratteri fuori ASCII ("Società" → "Societa"):
// denomailer fa trim() e poi Q-encoding sui nomi, quindi non si può passargli
// un encoded-word già pronto senza che lo avvolga di nuovo.
function asciiName(name?: string): string | undefined {
  if (!name) return name;
  // deno-lint-ignore no-control-regex
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').trim();
  return s.length > 0 ? s : undefined;
}

// Subject RFC 2047 in base64 (encoded-word ≤ 75 caratteri, senza spazi
// dentro, senza a-capo). Lo spazio iniziale evita che denomailer lo
// riconosca come "=?..." e lo avvolga una seconda volta; nell'header è
// semplice folding whitespace, i client lo ignorano.
function subjectRfc2047(subject: string): string {
  // deno-lint-ignore no-control-regex
  if (!/[^\x20-\x7e]/.test(subject)) return subject;
  const enc = new TextEncoder();
  const words: string[] = [];
  let chunk = '';
  for (const ch of subject) {
    if (enc.encode(chunk + ch).length > 42) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
  return ' ' + words.map((w) => `=?utf-8?B?${b64(w)}?=`).join(' ');
}

function formatAddress(a: { name?: string; email: string }): string {
  if (a.name && a.name.trim().length > 0) {
    // Encode caratteri speciali nel display name secondo RFC 5322
    const safeName = a.name.replace(/"/g, '\\"');
    return `"${safeName}" <${a.email}>`;
  }
  return a.email;
}
