// ============================================================================
// SKORPIO — Edge Function: alberto-webhook
// ============================================================================
// Riceve whatsapp.message.received da Kapso (numero di Alberto) e lo salva in
// whatsapp_messaggi. Se il mittente è abilitato ai comandi (team_whatsapp.comandi_alberto)
// il testo entra in alberto_coda: lo prende il Banco sul Mac se il suo battito è
// fresco (< 60 s), altrimenti risponde subito l'API (riserva). Il watchdog pg_cron
// copre il caso in cui il Banco sparisca a metà.
// Prima della coda, i comandi di lavoro a sintassi fissa («lavoro Luca: …»,
// «vidima», «sposta TSK… a …», «dai TSK… a …», «da vidimare») li esegue
// direttamente il database (consegne_comando), senza modello.
//
// Auth: firma HMAC-SHA256(KAPSO_WEBHOOK_SECRET, raw body) in
// X-Webhook-Signature, verificata sui byte grezzi prima del parse JSON.
// verify_jwt = false in config.toml: Kapso non manda un JWT Supabase.
// ============================================================================

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lavoraCodaConApi } from "../_shared/albertoApi.ts";
import { inviaTestoKapso, svegliaBanco } from "../_shared/albertoInvio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("KAPSO_WEBHOOK_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diverso = 0;
  for (let i = 0; i < a.length; i += 1) diverso |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diverso === 0;
}

async function gestisci(body: any): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const numero: string = body.conversation.phone_number ?? "";
  const testo: string = body.message?.text?.body ?? body.message?.kapso?.content ?? "";
  const messageId: string = body.message?.id ?? "";

  if (messageId) {
    const { data: gia } = await supabase
      .from("whatsapp_messaggi").select("id").eq("kapso_message_id", messageId).eq("direzione", "entrata").limit(1);
    if (gia && gia.length > 0) return;
  }

  const { data: contatto } = await supabase
    .from("team_whatsapp")
    .select("membro, comandi_alberto")
    .eq("numero", numero)
    .maybeSingle();
  const membro = contatto?.membro ?? null;
  const comanda = Boolean(contatto?.comandi_alberto) && testo.trim().length > 0;

  const { data: msg } = await supabase.from("whatsapp_messaggi").insert({
    membro,
    numero,
    direzione: "entrata",
    testo,
    kapso_message_id: messageId || null,
    stato: "ricevuto",
  }).select("id").single();

  // Comandi a sintassi fissa (timbratura, lavoro, vidima…) per chiunque sia nel
  // team: i permessi li controllano le funzioni del database.
  if (membro && testo.trim()) {
    const { data: comando, error: erroreComando } = await supabase.rpc("consegne_comando", { p_mittente: membro, p_testo: testo });
    if (erroreComando) console.error("[alberto-webhook] consegne_comando", erroreComando.message);
    if (comando?.gestito && comando.risposta) {
      const r = await inviaTestoKapso(numero, comando.risposta);
      await supabase.from("whatsapp_messaggi").insert({
        membro, numero, direzione: "uscita", testo: comando.risposta,
        kapso_message_id: r.messageId ?? null, stato: r.ok ? "inviato" : "fallito",
      });
      return;
    }
  }

  if (!comanda) {
    await supabase.from("notifiche").insert({
      destinatario: "Giovanni",
      tipo: "whatsapp_ricevuto",
      titolo: membro ? `WhatsApp da ${membro}` : `WhatsApp da ${numero}`,
      messaggio: testo || "(messaggio senza testo)",
    });
    return;
  }

  await supabase.from("alberto_coda").insert({ messaggio_id: msg?.id ?? null, mittente: membro, testo });

  const { data: vivo } = await supabase.rpc("alberto_banco_vivo", { p_secondi: 60 });
  if (vivo) {
    await svegliaBanco(SUPABASE_URL, SERVICE_KEY);
  } else {
    await lavoraCodaConApi(supabase, 0, 1);
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, errore: "Metodo non consentito" }, 405);

  const raw = await req.text();
  const firmaRicevuta = req.headers.get("x-webhook-signature") ?? "";
  if (!WEBHOOK_SECRET || !firmaRicevuta) {
    return json({ ok: false, errore: "Firma mancante" }, 401);
  }
  const firmaAttesa = await hmacHex(WEBHOOK_SECRET, raw);
  if (!uguali(firmaAttesa, firmaRicevuta)) {
    console.warn("[alberto-webhook] Firma non valida");
    return json({ ok: false, errore: "Firma non valida" }, 401);
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, errore: "JSON non valido" }, 400);
  }

  const evento = body?.event ?? "whatsapp.message.received";
  if (evento !== "whatsapp.message.received" || !body?.message || !body?.conversation) {
    return json({ ok: true, ignorato: evento });
  }

  // 200 subito: il lavoro vero continua dopo la risposta a Kapso.
  const lavoro = gestisci(body).catch((e) => console.error("[alberto-webhook]", e));
  // @ts-ignore EdgeRuntime esiste nel runtime Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(lavoro);
  else await lavoro;
  return json({ ok: true });
});
