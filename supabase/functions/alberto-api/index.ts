// Alberto di riserva. Lo sveglia il watchdog pg_cron (ogni 30 s) quando un messaggio
// resta in coda da più di 60 secondi senza che il Banco l'abbia preso.
// Auth: solo x-internal-secret (verify_jwt = false in config.toml).

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chiChiama } from "../_shared/chiamante.ts";
import { lavoraCodaConApi } from "../_shared/albertoApi.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, errore: "Metodo non consentito" }, 405);
  const chi = await chiChiama(req);
  if (!chi.ok || chi.come !== "segreto") return json({ ok: false, errore: "Non autorizzato" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const etaMin = Number.isFinite(body?.eta_min_secondi) ? Number(body.eta_min_secondi) : 60;
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const lavorati = await lavoraCodaConApi(supabase, etaMin);
    return json({ ok: true, lavorati });
  } catch (e) {
    console.error("[alberto-api]", e);
    return json({ ok: false, errore: e instanceof Error ? e.message : String(e) }, 500);
  }
});
