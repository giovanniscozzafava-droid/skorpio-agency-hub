// Invio delle risposte di Alberto su WhatsApp (Kapso) e chiusura della coda.
// Usato da alberto-api (riserva) e alberto-banco (il Banco sul Mac non ha la chiave Kapso).

const KAPSO_API_KEY = Deno.env.get("KAPSO_API_KEY") ?? "";
const KAPSO_PHONE_NUMBER_ID = Deno.env.get("KAPSO_PHONE_NUMBER_ID") ?? "";
const KAPSO_PROXY_BASE = "https://api.kapso.ai/meta/whatsapp/v23.0";

export interface RigaCoda {
  id: string;
  mittente: string;
  testo: string;
  messaggio_id?: string | null;
  tentativi?: number;
}

export async function inviaTestoKapso(numero: string, testo: string): Promise<{ ok: boolean; messageId?: string; errore?: string }> {
  try {
    const resp = await fetch(`${KAPSO_PROXY_BASE}/${KAPSO_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": KAPSO_API_KEY },
      body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "text", text: { body: testo.slice(0, 4000) } }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, errore: data?.error?.message ?? `HTTP ${resp.status}` };
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Chiude la riga in coda (solo se è ancora "preso" da `chi`) e poi invia la risposta.
 * La chiusura viene prima dell'invio: se Banco e API arrivano insieme, uno solo risponde.
 * La sigla [B]/[A] la vede solo Giovanni.
 */
export async function rispondiECHiudi(
  supabase: any,
  riga: RigaCoda,
  testo: string,
  chi: "banco" | "api",
): Promise<{ ok: boolean; scartato?: boolean; errore?: string }> {
  const { data: chiusa } = await supabase
    .from("alberto_coda")
    .update({ stato: "fatto", errore: null })
    .eq("id", riga.id)
    .eq("stato", "preso")
    .eq("preso_da", chi)
    .select("id");
  if (!chiusa || chiusa.length === 0) return { ok: false, scartato: true };

  const { data: contatto } = await supabase
    .from("team_whatsapp")
    .select("numero")
    .eq("membro", riga.mittente)
    .maybeSingle();
  const numero: string = contatto?.numero ?? "";
  if (!numero) {
    await supabase.from("alberto_coda").update({ stato: "errore", errore: "Numero WhatsApp mancante." }).eq("id", riga.id);
    return { ok: false, errore: "Numero WhatsApp mancante." };
  }

  const sigla = riga.mittente === "Giovanni" ? (chi === "banco" ? "[B] " : "[A] ") : "";
  const finale = `${sigla}${testo.trim()}`;
  const r = await inviaTestoKapso(numero, finale);
  await supabase.from("whatsapp_messaggi").insert({
    membro: riga.mittente,
    numero,
    direzione: "uscita",
    testo: finale,
    kapso_message_id: r.messageId ?? null,
    stato: r.ok ? "inviato" : "fallito",
  });
  if (!r.ok) {
    await supabase.from("alberto_coda").update({ stato: "errore", errore: r.errore ?? "Invio fallito" }).eq("id", riga.id);
    return { ok: false, errore: r.errore };
  }
  return { ok: true };
}

export async function svegliaBanco(supabaseUrl: string, chiave: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: chiave, Authorization: `Bearer ${chiave}` },
      body: JSON.stringify({ messages: [{ topic: "alberto-coda", event: "nuovo", payload: {}, private: false }] }),
    });
  } catch (_e) { /* il Banco ha comunque il polling di ripiego */ }
}
