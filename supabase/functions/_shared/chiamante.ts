// Chi sta chiamando questa edge function, davvero.
//
// ─── Perché esiste ──────────────────────────────────────────────────────────
// Le funzioni che mandano email fuori da Skorpio controllavano così:
//
//     const hasJwtBearer = authHdr.toLowerCase().startsWith("bearer ");
//     if (!hasInternalSecret && !hasJwtBearer) return 401;
//
// Cioè: guardavano che l'intestazione *cominciasse* con «bearer », senza mai
// verificare il token. E siccome in `config.toml` quelle funzioni hanno
// `verify_jwt = false`, non lo verificava nemmeno Supabase prima di loro.
//
// Risultato, misurato il 16 settembre 2026 con un token inventato e un corpo
// vuoto: `vendite-invia-email` ha risposto «prospect_id obbligatorio», cioè
// era già dentro. Con un prospect_id vero avrebbe mandato una email a un
// cliente, da commerciale@fuyue.it, firmata Giovanni Scozzafava. Senza
// chiave, senza permesso, da qualunque punto di internet.
//
// ─── Cosa fa adesso ─────────────────────────────────────────────────────────
// Due strade, e nessuna delle due si accontenta della forma:
//   1. `x-internal-secret` uguale a INTERNAL_FUNCTION_SECRET — per i lavori
//      automatici (cron, altre funzioni);
//   2. un JWT **verificato** con Supabase: deve corrispondere a un utente
//      vero *e presente nella tabella team*. La chiave pubblicabile non
//      basta, perché non è una persona; un utente qualunque nemmeno.
//
// La chiave anonima che sta in `.env` e nel bundle del sito non apre più
// niente: è pubblica per definizione, e non doveva mai essere una password.

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface Chiamante {
  ok: boolean;
  come?: "segreto" | "utente";
  utente?: string;
  /** id della riga team di chi chiama (solo per come === "utente") */
  teamId?: string;
  ruolo?: string;
  motivo?: string;
}

/**
 * Autorizza la chiamata, o dice di no con un motivo.
 *
 * Va usata da ogni funzione che manda qualcosa fuori (email, SMS, webhook
 * verso terzi). Per le funzioni pubbliche per progetto — le landing di
 * iscrizione, i pixel di tracciamento, l'opt-in — non serve e non va messa:
 * quelle devono restare aperte, ed è una scelta, non una dimenticanza.
 */
export async function chiChiama(req: Request): Promise<Chiamante> {
  const segretoAtteso = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
  const segretoRicevuto = req.headers.get("x-internal-secret") ?? "";

  // Confronto a lunghezza nota: un segreto sbagliato non deve dire *quanto*
  // era sbagliato attraverso il tempo di risposta.
  if (segretoAtteso && segretoRicevuto && uguali(segretoAtteso, segretoRicevuto)) {
    return { ok: true, come: "segreto" };
  }

  const intestazione = req.headers.get("authorization") ?? "";
  if (!intestazione.toLowerCase().startsWith("bearer ")) {
    return { ok: false, motivo: "Serve un'autorizzazione." };
  }
  const token = intestazione.slice(7).trim();
  if (!token) return { ok: false, motivo: "Serve un'autorizzazione." };

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const chiaveServizio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !chiaveServizio) {
    // Senza modo di verificare non si tira a indovinare: si chiude.
    return { ok: false, motivo: "Verifica non disponibile." };
  }

  try {
    const supabase = createClient(url, chiaveServizio);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, motivo: "Autorizzazione non valida." };
    }
    // Un utente registrato non basta: le iscrizioni a Supabase sono aperte,
    // quindi chiunque può averne uno. Deve stare nella squadra.
    const { data: membro } = await supabase
      .from("team")
      .select("id, ruolo")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (!membro) return { ok: false, motivo: "Utente non autorizzato." };
    return {
      ok: true,
      come: "utente",
      utente: data.user.email ?? data.user.id,
      teamId: membro.id,
      ruolo: membro.ruolo ?? undefined,
    };
  } catch (_e) {
    return { ok: false, motivo: "Autorizzazione non verificabile." };
  }
}

/**
 * È la chiave di servizio? Quella dell'ambiente si confronta; quella della
 * CLI (`sb_secret_…`) non è uguale ma apre le stesse porte: si riconosce
 * provando a leggere una tabella che nessun altro può leggere, come fa
 * calendario-invito. Serve al cron (motore.chiama) e agli script.
 */
export async function eChiaveDiServizio(token: string): Promise<boolean> {
  const attesa = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!token) return false;
  if (attesa && uguali(attesa, token)) return true;
  if (!token.startsWith("eyJ") && !token.startsWith("sb_secret_")) return false;
  try {
    const c = createClient(Deno.env.get("SUPABASE_URL") ?? "", token, { auth: { persistSession: false } });
    const { error } = await c.from("fic_oauth_states").select("state", { head: true, count: "exact" });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Come chiChiama, ma accetta anche la chiave di servizio come bearer: è quella
 * che i job SQL (motore.chiama, finanza.chiama, marketing_advisor.chiama) mandano.
 * Non è una chiave pubblica: sta solo nel Vault e nei secret delle funzioni.
 */
export async function chiChiamaOServizio(req: Request): Promise<Chiamante> {
  const chi = await chiChiama(req);
  if (chi.ok) return chi;
  const token = (req.headers.get("authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (token && (await eChiaveDiServizio(token))) return { ok: true, come: "segreto" };
  return chi;
}

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diverso = 0;
  for (let i = 0; i < a.length; i += 1) diverso |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diverso === 0;
}
