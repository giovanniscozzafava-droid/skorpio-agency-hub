// Le due funzioni di _shared/squadra.ts che servono alla mail rossa, copiate
// identiche: squadra.ts si porta dietro agenti, fonti e Ads (~300 kB) e
// consegne non ne usa altro. Se cambia chiamaClaude in squadra.ts, va
// cambiata anche qui.

// deno-lint-ignore no-explicit-any
type Riga = Record<string, any>;

const MODELLO = "claude-opus-5";

export type EsitoClaude =
  | { ok: true; content: Riga[]; stop_reason: string; usage: Riga }
  | { ok: false; errore: string; stato?: number };

export async function chiamaClaude(opzioni: {
  system: string;
  messages: Riga[];
  tools?: Riga[];
  tool_choice?: Riga;
  max_tokens?: number;
  modello?: string;
}): Promise<EsitoClaude> {
  const chiave = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!chiave) return { ok: false, errore: "Manca la chiave del modello (ANTHROPIC_API_KEY): fallo sistemare al Tecnico." };
  const corpo: Riga = {
    model: opzioni.modello ?? MODELLO,
    max_tokens: opzioni.max_tokens ?? 1200,
    system: opzioni.system,
    messages: opzioni.messages,
  };
  if (opzioni.tools?.length) corpo.tools = opzioni.tools;
  if (opzioni.tool_choice) corpo.tool_choice = opzioni.tool_choice;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, errore: t.slice(0, 300), stato: r.status };
  }
  const d = await r.json();
  return { ok: true, content: d?.content ?? [], stop_reason: d?.stop_reason ?? "", usage: d?.usage ?? {} };
}

export function testoDi(content: Riga[]): string {
  return content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
}
