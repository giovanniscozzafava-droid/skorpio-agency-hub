// Alberto di riserva: Claude API dentro l'edge function, stessi strumenti (le RPC) e stesso prompt del Banco.

// @ts-ignore modulo JS condiviso col demone del Banco
import { MODELLO_API, promptAlberto, STRUMENTI, eseguiStrumento, formattaContesto, scegliContesto } from "./albertoWhatsapp.mjs";
import { rispondiECHiudi, type RigaCoda } from "./albertoInvio.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAX_GIRI = 6;

export function rpcServizio(supabase: any) {
  return async (nome: string, params: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(nome, params);
    if (error) throw new Error(error.message);
    return data;
  };
}

export async function contestoPer(supabase: any, mittente: string): Promise<string> {
  const { data } = await supabase
    .from("whatsapp_messaggi")
    .select("direzione, membro, testo, stato, azione, created_at")
    .eq("membro", mittente)
    .order("created_at", { ascending: false })
    .limit(40);
  return formattaContesto(scegliContesto(data ?? [], 10));
}

async function chiamaClaude(system: string, messages: any[]): Promise<any> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODELLO_API, max_tokens: 1024, system, tools: STRUMENTI, messages }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message ?? `Anthropic HTTP ${resp.status}`);
  return data;
}

/** Lavora una riga già presa con preso_da = 'api'. Non lancia mai. */
export async function elaboraConApi(supabase: any, riga: RigaCoda): Promise<{ ok: boolean; errore?: string }> {
  try {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY mancante");
    const rpc = rpcServizio(supabase);
    const system = promptAlberto({ mittente: riga.mittente });
    const contesto = await contestoPer(supabase, riga.mittente);
    const messages: any[] = [{
      role: "user",
      content: `Conversazione recente con ${riga.mittente} (dal più vecchio):\n${contesto}\n\nRispondi all'ultimo messaggio di ${riga.mittente}. Scrivi solo il testo del messaggio WhatsApp.`,
    }];

    let testoFinale = "";
    for (let giro = 0; giro < MAX_GIRI; giro++) {
      const r = await chiamaClaude(system, messages);
      const blocchi: any[] = r.content ?? [];
      const usi = blocchi.filter((b) => b.type === "tool_use");
      if (usi.length === 0 || r.stop_reason !== "tool_use") {
        testoFinale = blocchi.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        break;
      }
      messages.push({ role: "assistant", content: blocchi });
      const risultati = [];
      for (const u of usi) {
        const esito = await eseguiStrumento(rpc, riga.mittente, u.name, u.input ?? {});
        risultati.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(esito) });
      }
      messages.push({ role: "user", content: risultati });
    }
    if (!testoFinale) throw new Error("Nessuna risposta dal modello");
    const inviata = await rispondiECHiudi(supabase, riga, testoFinale, "api");
    return inviata.ok || inviata.scartato ? { ok: true } : { ok: false, errore: inviata.errore };
  } catch (e) {
    const errore = e instanceof Error ? e.message : String(e);
    console.error("[alberto-api]", errore);
    await rispondiECHiudi(supabase, riga, "Adesso non riesco a rispondere. Riprova tra un minuto.", "api");
    await supabase.from("alberto_coda").update({ errore }).eq("id", riga.id);
    return { ok: false, errore };
  }
}

/** Prende fino a `max` righe in attesa da almeno `etaMin` secondi (claim atomico) e le lavora. */
export async function lavoraCodaConApi(supabase: any, etaMin: number, max = 3): Promise<number> {
  const { data, error } = await supabase.rpc("alberto_coda_prendi", { p_da: "api", p_max: max, p_eta_min_secondi: etaMin });
  if (error) throw new Error(error.message);
  const righe: RigaCoda[] = data ?? [];
  for (const r of righe) await elaboraConApi(supabase, r);
  return righe.length;
}
