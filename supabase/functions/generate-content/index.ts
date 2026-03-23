import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clienteId, clienteNome, periodo, formati, toni, quantita, brandRules } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY non configurata");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Carica brand rules se non fornite
    let br = brandRules;
    if (!br && clienteId) {
      const { data } = await supabase
        .from("brand_rules")
        .select("*")
        .eq("cliente_id", clienteId)
        .maybeSingle();
      br = data;
    }

    // Carica eventi marketing del periodo
    const now = new Date();
    const year = now.getFullYear();
    const { data: marketingEvents } = await supabase
      .from("marketing_calendar")
      .select("*")
      .gte("data", `${year}-01-01`)
      .lte("data", `${year}-12-31`);

    const eventiRilevanti = (marketingEvents || [])
      .filter((e: any) => {
        if (!periodo) return true;
        const periodoLower = periodo.toLowerCase();
        return e.titolo.toLowerCase().includes(periodoLower) ||
          e.data.includes(periodo) ||
          periodoLower.includes(e.data.slice(5, 7)); // match mese
      })
      .slice(0, 10)
      .map((e: any) => `• ${e.data}: ${e.titolo}`)
      .join("\n");

    const brandRulesText = br ? `
IDENTITÀ BRAND: ${br.identita || ""}
NOME BRAND: ${br.nome_brand || clienteNome}
TONI DI VOCE: ${br.toni_voce || ""}
FORMATI PREFERITI: ${br.formati_preferiti || ""}
SERVIZI PRINCIPALI: ${br.servizi_principali || ""}
PUBBLICO TARGET: ${br.pubblico_target || ""}
DIFFERENZIATORI: ${br.differenziatori || ""}
COMPETITOR: ${br.competitor || ""}
STILE VISIVO: ${br.stile_visivo || ""}
HASHTAG FISSI: ${br.hashtag_fissi || ""}
DA FARE: ${br.do_list || ""}
DA EVITARE: ${br.dont_list || ""}
TERRITORIO: ${br.territorio || ""}
PERSONAGGI: ${br.personaggi || ""}
NOTE AGGIUNTIVE: ${br.note || ""}
`.trim() : `Cliente: ${clienteNome}`;

    const systemPrompt = `Sei un esperto creativo di social media marketing italiano specializzato nel settore beauty/estetica. 
Conosci perfettamente il mercato italiano e sai creare contenuti virali, autentici e coinvolgenti.
Devi generare contenuti pronti per la produzione, con hook forti, script dettagliati e CTA efficaci.
Usa un linguaggio naturale italiano, mai tradotto dall'inglese.
Rispondi SOLO con JSON valido, nessun testo aggiuntivo prima o dopo.`;

    const userPrompt = `Genera esattamente ${quantita} contenuti social per il cliente "${clienteNome}".

BRAND RULES:
${brandRulesText}

PERIODO/TEMA: ${periodo || "Contenuto evergreen"}

FORMATI RICHIESTI: ${formati.join(", ")}
TONI RICHIESTI: ${toni.join(", ")}

EVENTI MARKETING RILEVANTI:
${eventiRilevanti || "Nessun evento specifico"}

ISTRUZIONI:
- Distribuisci i ${quantita} contenuti tra i formati: ${formati.join(", ")}
- Usa i toni: ${toni.join(", ")} (varia tra i contenuti)
- Gli hook devono essere POTENTI e fermare lo scroll
- Gli script devono essere dettagliati e pronti per la produzione (300-500 caratteri)
- I hashtag devono includere quelli fissi del brand + hashtag specifici del contenuto
- Le CTA devono essere specifiche e orientate alla conversione

Rispondi con questo JSON esatto:
{
  "contenuti": [
    {
      "titolo": "Titolo breve e descrittivo del contenuto",
      "formato": "uno dei formati richiesti",
      "tono": "uno dei toni richiesti",
      "hook": "Hook potente per fermare lo scroll (max 2 righe)",
      "script": "Script completo e dettagliato pronto per la produzione",
      "cta": "Call to action specifica",
      "hashtag": ["hashtag1", "hashtag2", "hashtag3"],
      "note_produzione": "Suggerimenti pratici per le riprese/produzione"
    }
  ]
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit superato. Riprova tra qualche minuto." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Crediti AI esauriti. Aggiungi fondi nelle impostazioni workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error ${aiResponse.status}: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";
    const tokensInput = aiData.usage?.prompt_tokens || 0;
    const tokensOutput = aiData.usage?.completion_tokens || 0;

    let parsed: any = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // tenta estrazione JSON
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    const contenuti = parsed.contenuti || [];

    // Stima costo: Gemini 2.5 Flash ~ €0.000075/1k input, €0.0003/1k output
    const costoEuro = (tokensInput / 1000) * 0.000075 + (tokensOutput / 1000) * 0.0003;

    // Log su creative_log
    const { data: logData } = await supabase
      .from("creative_log")
      .insert({
        cliente_nome: clienteNome,
        parametri: { formati, toni, periodo, quantita },
        risultati: contenuti,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        costo_euro: costoEuro,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        ok: true,
        contenuti,
        tokens: { input: tokensInput, output: tokensOutput, costo: costoEuro },
        logId: logData?.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("generate-content error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Errore sconosciuto" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
