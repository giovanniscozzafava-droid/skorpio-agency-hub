// ============================================================================
// SKORPIO — Edge Function: consegne
// ============================================================================
// Il piano «Consegne» (docs/direzione/piano-consegne.md, ordine di Giovanni
// del 22-23/09/2026): un progetto aperto senza ore in agenda non esiste, e
// una settimana finisce con le consegne chiuse o con la mail rossa.
//
// Azioni (body JSON, campo `azione`):
//   apri         { nome, ore?, entro, cliente?, responsabile?, descrizione?, origine? }
//                → crea il progetto e lo pianifica a slot nel calendario di chi
//                  lo fa (default Giovanni), con gli inviti .ics.
//   pianifica    { progetto_id, ore? }  → aggiunge slot fino a coprire le ore.
//   ripianifica  {}  → slot passati: «Fatto» se il progetto è stato toccato quel
//                  giorno, altrimenti «Saltato» e rimesso in agenda; avvisa in chat.
//   settimana    {}  → lunedì: a ogni persona le sue consegne della settimana
//                  (email + chat), a Giovanni anche i suoi slot.
//   verifica     {}  → venerdì: chi ha task scaduti riceve la mail rossa, con la
//                  voce di Giovanni, automatica; copia in chat sede.
//   tocco        { progetto_id | nome }  → segna che ci si è lavorato adesso.
//   consegnato   { progetto_id | nome }  → chiude il progetto, annulla gli slot futuri.
//   lista        {}  → i progetti aperti con il prossimo slot.
//
// La timeline del lavoro giornaliero (30/09/2026, giornata.ts): giornata,
// avvisa_lavoro, non_entra, sera, promemoria_timbra, timbratura_avvio,
// prova_whatsapp, smistamento (Giovanni → Alberto → Elisa → ragazzi). Il pianificatore è uno solo e sta nel database
// (consegne_piazza / consegne_assegna / consegne_pianifica_task): anche gli
// slot dei progetti qui sotto passano da lì.
//
// Auth: chiave di servizio (cron via motore.chiama, script), x-internal-secret,
//       o JWT di un utente vero (Alberto per conto di Giovanni). verify_jwt=false.
// ============================================================================

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chiChiama, eChiaveDiServizio } from "../_shared/chiamante.ts";
import { inviaEmail } from "../_shared/emailProvider.ts";
import { chiamaClaude, testoDi } from "./claude.ts";
import {
  azioneAlbertoRitardi, azioneAlbertoScrivi, azioneAvvisaLavoro, azioneChiediCompiti, azioneDaVidimare, azioneGiornata, azioneNonEntra, azioneSmistamento, azioneProvaWhatsapp, azionePromemoriaTimbra, azioneSera, azioneTimbraturaAvvio,
} from "./giornata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("PREVENTIVI_FROM_EMAIL") || "no-reply@fuyue.it";
const APP_URL = Deno.env.get("APP_URL") || "https://skorpio-v3-redesign.vercel.app";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Riga = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Sb = any;

// ─── Date a Roma ─────────────────────────────────────────────────────────────

const giornoRoma = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const oraRoma = (d: Date): string =>
  new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
function aggiungiGiorni(giorno: string, n: number): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const giornoSettimana = (giorno: string): number => new Date(`${giorno}T12:00:00Z`).getUTCDay();
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const inParole = (giorno: string): string => {
  const [a, m, g] = giorno.split("-");
  return `${GIORNI[giornoSettimana(giorno)]} ${Number(g)}/${Number(m)}${a !== giornoRoma(new Date()).slice(0, 4) ? `/${a}` : ""}`;
};
/** Il lunedì della settimana di `giorno`. */
function lunediDi(giorno: string): string {
  const ds = giornoSettimana(giorno);
  return aggiungiGiorni(giorno, ds === 0 ? -6 : 1 - ds);
}
/** Settimana ISO «AAAA-Www». */
function settimanaIso(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  const giovedi = new Date(d);
  giovedi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const primo = new Date(Date.UTC(giovedi.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((giovedi.getTime() - primo.getTime()) / 86_400_000 - 3 + ((primo.getUTCDay() + 6) % 7)) / 7);
  return `${giovedi.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
}
const taglia = (t: unknown, max = 200): string => {
  const s = String(t ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const escHtml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ─── Contesto ────────────────────────────────────────────────────────────────

interface Persona { id: string; nome: string; email: string | null; ruolo: string; inviti: boolean }

interface Ctx {
  sb: Sb;
  motore: () => Sb;
  oggi: string;
  team: Persona[];
  config: Record<string, string>;
  emailProprieta: string;
  sede: string | null;
  righe: string[]; // cosa è stato fatto, per la risposta
}

async function contesto(sb: Sb): Promise<Ctx> {
  const motore = () => sb.schema("motore");
  const [{ data: team }, { data: cfg }, { data: sede }] = await Promise.all([
    sb.from("team").select("id, nome, email, ruolo, inviti_calendario").order("nome"),
    motore().from("config").select("chiave, valore"),
    motore().from("canali").select("id").eq("slug", "sede").maybeSingle(),
  ]);
  const config: Record<string, string> = {};
  for (const c of (cfg ?? []) as Riga[]) config[String(c.chiave)] = String(c.valore ?? "");
  return {
    sb, motore, oggi: giornoRoma(new Date()),
    team: ((team ?? []) as Riga[]).map((t) => ({ id: String(t.id), nome: String(t.nome), email: t.email ? String(t.email) : null, ruolo: String(t.ruolo ?? "Team"), inviti: t.inviti_calendario !== false })),
    config,
    emailProprieta: (config.email_proprieta ?? "").toLowerCase(),
    sede: sede?.id ? String(sede.id) : null,
    righe: [],
  };
}

const giovanniDi = (ctx: Ctx): Persona | undefined =>
  ctx.team.find((p) => (p.email ?? "").toLowerCase() === ctx.emailProprieta) ?? ctx.team.find((p) => p.nome === "Giovanni");

function trovaPersona(ctx: Ctx, nome: unknown): Persona | undefined {
  const n = String(nome ?? "").trim().toLowerCase();
  if (!n) return undefined;
  return ctx.team.find((p) => p.nome.toLowerCase() === n) ?? ctx.team.find((p) => p.nome.toLowerCase().startsWith(n));
}

/** Le persone vere con un capo: quelle che ricevono consegne e mail rossa. */
async function sottoposti(ctx: Ctx): Promise<Persona[]> {
  const { data } = await ctx.motore().from("banco_config").select("persona").not("capo", "is", null);
  const nomi = new Set(((data ?? []) as Riga[]).map((r) => String(r.persona)));
  return ctx.team.filter((p) => nomi.has(p.nome) && p.email && !p.email.includes("+prova") && p.email.toLowerCase() !== ctx.emailProprieta);
}

async function inSede(ctx: Ctx, testo: string): Promise<void> {
  if (!ctx.sede) return;
  await ctx.motore().rpc("invia_messaggio", { p_canale: ctx.sede, p_testo: testo, p_autore: "ceo" });
}

async function inChatAlberto(ctx: Ctx, persona: Persona, testo: string): Promise<void> {
  await ctx.sb.from("chat_alberto").insert({ team_id: persona.id, autore: "alberto", testo });
}

async function trovaCliente(ctx: Ctx, nome: unknown): Promise<{ id: string; nome: string } | null> {
  const n = String(nome ?? "").trim();
  if (!n) return null;
  const { data } = await ctx.sb.from("clienti").select("id, nome").ilike("nome", `%${n}%`).limit(1).maybeSingle();
  return data ? { id: String(data.id), nome: String(data.nome) } : null;
}

async function trovaProgetto(ctx: Ctx, input: Riga): Promise<Riga | null> {
  const id = String(input.progetto_id ?? "").trim();
  if (id) {
    const { data } = await ctx.sb.from("progetti").select("*").eq("id", id).maybeSingle();
    if (data) return data;
  }
  const nome = String(input.nome ?? input.progetto ?? "").trim();
  if (!nome) return null;
  const { data: perCodice } = await ctx.sb.from("progetti").select("*").eq("id_display", nome.toUpperCase()).maybeSingle();
  if (perCodice) return perCodice;
  const { data } = await ctx.sb.from("progetti").select("*").ilike("nome", `%${nome}%`).in("stato", ["aperto", "in_corso", "parcheggiato"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

// ─── Gli slot di lavoro ──────────────────────────────────────────────────────

interface Blocco { giorno: string; inizio: number; fine: number }

/**
 * I blocchi liberi di una persona fino a `entro`: li trova il pianificatore
 * del database (consegne_piazza), lo stesso dei lavori assegnati da Alberto:
 * orari_lavoro della persona, impegni, assenze e ore già timbrate.
 */
async function blocchiLiberi(ctx: Ctx, persona: Persona, entro: string, oreServono: number): Promise<{ scelti: Blocco[]; oreCoperte: number; slotOre: number }> {
  const slotOre = Math.max(0.5, Math.min(8, Number(ctx.config.lavoro_slot_ore) || 2));
  const { data: limite } = await ctx.sb.rpc("consegne_limite", { p_team: persona.id, p_giorno: entro, p_ora: null });
  const { data, error } = await ctx.sb.rpc("consegne_piazza", {
    p_team: persona.id, p_ore: oreServono, p_da: new Date(Date.now() + 60 * 60_000).toISOString(), p_entro: limite, p_escludi: [],
  });
  if (error) throw new Error(`Pianificatore: ${error.message}`);
  const scelti: Blocco[] = ((data ?? []) as Riga[]).map((b) => ({ giorno: giornoRoma(new Date(b.inizio)), inizio: Date.parse(b.inizio), fine: Date.parse(b.fine) }));
  const oreCoperte = scelti.reduce((t, b) => t + (b.fine - b.inizio) / 3600_000, 0);
  return { scelti, oreCoperte, slotOre };
}

async function invita(calendarioId: string): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/calendario-invito`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ calendario_id: calendarioId, azione: "invita" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Mette in calendario gli slot per coprire `ore` del progetto. */
async function pianifica(ctx: Ctx, progetto: Riga, ore: number): Promise<{ slot: number; oreCoperte: number; mancano: number; primo: string | null }> {
  const persona = trovaPersona(ctx, progetto.responsabile) ?? giovanniDi(ctx);
  if (!persona) throw new Error("Non trovo il responsabile del progetto nel team.");
  const entro = String(progetto.consegna_entro);
  const { scelti, oreCoperte } = await blocchiLiberi(ctx, persona, entro, ore);
  let fatti = 0;
  let oreMesse = 0;
  let primo: string | null = null;
  for (const b of scelti) {
    const inizio = new Date(b.inizio);
    const fine = new Date(b.fine);
    const { data: ev, error } = await ctx.sb.from("calendario").insert({
      tipo: "lavoro", origine: "manuale", stato: "Pianificato",
      descrizione: `Lavoro: ${taglia(progetto.nome, 90)}`,
      data: b.giorno, ora: oraRoma(inizio), ora_fine: oraRoma(fine),
      inizio_ts: inizio.toISOString(), fine_ts: fine.toISOString(), tutto_il_giorno: false,
      persona: persona.nome,
      cliente_id: progetto.cliente_id ?? null, cliente_nome: progetto.cliente_nome ?? "",
      progetto_id: progetto.id,
      note: `Slot di lavoro sul progetto ${progetto.id_display ?? ""} «${progetto.nome}» (consegna entro ${entro}). Messo in agenda da Alberto.`,
      ospiti: [],
    }).select("id").single();
    if (error || !ev) continue;
    await ctx.sb.from("calendario_persone").insert({ calendario_id: ev.id, team_id: persona.id });
    if (persona.inviti && persona.email) await invita(String(ev.id));
    fatti += 1;
    oreMesse += (b.fine - b.inizio) / 3600_000;
    if (!primo) primo = `${inParole(b.giorno)} alle ${oraRoma(inizio)}`;
  }
  const orePianificate = Number(progetto.ore_pianificate ?? 0) + oreMesse;
  await ctx.sb.from("progetti").update({ ore_pianificate: orePianificate }).eq("id", progetto.id);
  const mancano = Math.max(0, Math.round((ore - oreMesse) * 100) / 100);
  return { slot: fatti, oreCoperte: Math.min(oreCoperte, oreMesse), mancano, primo };
}

// ─── Azioni ──────────────────────────────────────────────────────────────────

async function azioneApri(ctx: Ctx, input: Riga): Promise<Riga> {
  const nome = taglia(input.nome, 120);
  if (!nome) return { ok: false, errore: "Serve il nome del progetto." };
  const entro = /^\d{4}-\d{2}-\d{2}$/.test(String(input.entro ?? "")) ? String(input.entro) : null;
  if (!entro) return { ok: false, errore: "Serve la data di consegna (entro, AAAA-MM-GG)." };
  if (entro < ctx.oggi) return { ok: false, errore: `La consegna ${entro} è nel passato: oggi è ${ctx.oggi}.` };
  const ore = Math.max(1, Math.min(200, Number(input.ore) || 4));
  const responsabile = trovaPersona(ctx, input.responsabile) ?? giovanniDi(ctx);
  if (!responsabile) return { ok: false, errore: "Non trovo il responsabile nel team." };
  const cliente = await trovaCliente(ctx, input.cliente);
  const origine = ["skorpio", "code", "alberto", "kanban"].includes(String(input.origine)) ? String(input.origine) : "skorpio";

  const { data: esiste } = await ctx.sb.from("progetti").select("id, id_display, nome").ilike("nome", nome).in("stato", ["aperto", "in_corso"]).maybeSingle();
  if (esiste) return { ok: false, errore: `Il progetto «${esiste.nome}» (${esiste.id_display}) è già aperto: usa tocco o pianifica.`, progetto: esiste };

  const { data: progetto, error } = await ctx.sb.from("progetti").insert({
    nome, descrizione: taglia(input.descrizione, 1000) || null,
    cliente_id: cliente?.id ?? null, cliente_nome: cliente?.nome ?? (taglia(input.cliente, 80) || null),
    responsabile: responsabile.nome, ore_stimate: ore, consegna_entro: entro, origine,
    creato_da: taglia(input.creato_da, 40) || origine, ultimo_tocco: new Date().toISOString(),
  }).select("*").single();
  if (error || !progetto) return { ok: false, errore: `Progetto non creato: ${error?.message ?? "errore"}` };

  const piano = await pianifica(ctx, progetto, ore);
  const riga = `Progetto ${progetto.id_display} «${nome}» aperto per ${responsabile.nome}: ${ore} ore entro ${inParole(entro)}, ${piano.slot} slot in agenda${piano.primo ? `, il primo ${piano.primo}` : ""}${piano.mancano ? `; restano ${piano.mancano} ore senza posto prima della consegna` : ""}.`;
  await inSede(ctx, riga + (piano.mancano ? " Sposta la consegna o libera l'agenda." : ""));
  return { ok: true, progetto, ...piano, testo: riga };
}

async function azionePianifica(ctx: Ctx, input: Riga): Promise<Riga> {
  const progetto = await trovaProgetto(ctx, input);
  if (!progetto) return { ok: false, errore: "Non trovo il progetto." };
  const ore = Number(input.ore) || Math.max(0, Number(progetto.ore_stimate) - Number(progetto.ore_pianificate ?? 0));
  if (ore <= 0) return { ok: true, testo: `«${progetto.nome}» ha già tutte le ore in agenda.`, slot: 0 };
  const piano = await pianifica(ctx, progetto, ore);
  return { ok: true, testo: `${piano.slot} slot in agenda per «${progetto.nome}»${piano.mancano ? `, restano ${piano.mancano} ore senza posto` : ""}.`, ...piano };
}

async function azioneRipianifica(ctx: Ctx): Promise<Riga> {
  const adesso = new Date().toISOString();
  const { data: aperti } = await ctx.sb.from("progetti").select("*").in("stato", ["aperto", "in_corso"]);
  const avvisi: string[] = [];
  let saltati = 0, fatti = 0;
  for (const p of (aperti ?? []) as Riga[]) {
    const { data: slot } = await ctx.sb.from("calendario").select("id, data, ora, inizio_ts, fine_ts")
      .eq("progetto_id", p.id).eq("tipo", "lavoro").eq("stato", "Pianificato").lt("fine_ts", adesso).order("data");
    if (!slot?.length) continue;
    const { data: tocchi } = await ctx.sb.from("task").select("updated_at").eq("progetto_id", p.id).gte("updated_at", `${slot[0].data}T00:00:00`);
    const giorniToccati = new Set<string>();
    if (p.ultimo_tocco) giorniToccati.add(giornoRoma(new Date(p.ultimo_tocco)));
    for (const t of (tocchi ?? []) as Riga[]) giorniToccati.add(giornoRoma(new Date(t.updated_at)));
    let oreDaRimettere = 0;
    for (const s of slot as Riga[]) {
      const slotOre = Math.max(0.25, (Date.parse(s.fine_ts) - Date.parse(s.inizio_ts)) / 3600_000 || 2);
      if (giorniToccati.has(String(s.data))) {
        await ctx.sb.from("calendario").update({ stato: "Fatto" }).eq("id", s.id);
        fatti += 1;
        await ctx.sb.from("progetti").update({ ore_fatte: Number(p.ore_fatte ?? 0) + slotOre }).eq("id", p.id);
        p.ore_fatte = Number(p.ore_fatte ?? 0) + slotOre;
      } else {
        await ctx.sb.from("calendario").update({ stato: "Saltato" }).eq("id", s.id);
        saltati += 1;
        oreDaRimettere += slotOre;
      }
    }
    if (oreDaRimettere > 0) {
      p.ore_pianificate = Number(p.ore_pianificate ?? 0) - oreDaRimettere;
      await ctx.sb.from("progetti").update({ ore_pianificate: p.ore_pianificate }).eq("id", p.id);
      if (String(p.consegna_entro) >= ctx.oggi) {
        const piano = await pianifica(ctx, p, oreDaRimettere);
        avvisi.push(`«${p.nome}»: ${oreDaRimettere} ore saltate${piano.primo ? `, rimesse ${piano.primo}` : ", e non c'è più posto prima della consegna"}${piano.mancano ? ` (${piano.mancano} ore ancora scoperte)` : ""}.`);
      } else {
        avvisi.push(`«${p.nome}»: consegna ${inParole(String(p.consegna_entro))} passata con ${oreDaRimettere} ore saltate. Decidi: nuova data o parcheggiato.`);
      }
    }
  }
  const scaduti = ((aperti ?? []) as Riga[]).filter((p) => String(p.consegna_entro) < ctx.oggi);
  for (const p of scaduti) {
    if (!avvisi.some((a) => a.includes(`«${p.nome}»`))) avvisi.push(`«${p.nome}» doveva essere consegnato ${inParole(String(p.consegna_entro))} e non è chiuso.`);
  }
  if (avvisi.length) await inSede(ctx, `Giovanni, sui progetti:\n- ${avvisi.join("\n- ")}`);
  return { ok: true, saltati, fatti, avvisi };
}

interface Consegna { id: string; id_display: string; tipo: string; descrizione: string; cliente_nome: string; scadenza: string; fascia: string; giorni_ritardo: number; progetto_nome: string | null }

async function consegneDi(ctx: Ctx, persona: Persona): Promise<Consegna[]> {
  const { data } = await ctx.sb.from("v_consegne_settimana").select("*").eq("assegnato_a", persona.nome).order("scadenza");
  return ((data ?? []) as Riga[]).map((r) => ({
    id: String(r.id), id_display: String(r.id_display ?? ""), tipo: String(r.tipo ?? ""), descrizione: String(r.descrizione ?? ""),
    cliente_nome: String(r.cliente_nome ?? ""), scadenza: String(r.scadenza), fascia: String(r.fascia), giorni_ritardo: Number(r.giorni_ritardo ?? 0),
    progetto_nome: r.progetto_nome ? String(r.progetto_nome) : null,
  }));
}

const rigaTask = (t: Consegna, conRitardo = false) =>
  `- ${t.id_display} ${t.tipo}${t.descrizione ? `: ${taglia(t.descrizione, 90)}` : ""}${t.cliente_nome ? ` [${t.cliente_nome}]` : ""}${t.progetto_nome ? ` (progetto ${t.progetto_nome})` : ""} — ${conRitardo && t.giorni_ritardo > 0 ? `scaduto da ${t.giorni_ritardo} giorni (${inParole(t.scadenza)})` : inParole(t.scadenza)}`;

async function azioneSettimana(ctx: Ctx, input: Riga = {}): Promise<Riga> {
  const soloProva = input.prova === true;
  const anteprime: Riga[] = [];
  const settimana = settimanaIso(ctx.oggi);
  const lunedi = lunediDi(ctx.oggi);
  const domenica = aggiungiGiorni(lunedi, 6);
  const persone = await sottoposti(ctx);
  const giovanni = giovanniDi(ctx);
  const esiti: string[] = [];

  for (const persona of persone) {
    const tutte = await consegneDi(ctx, persona);
    const scaduti = tutte.filter((t) => t.fascia === "scaduto");
    const inSettimana = tutte.filter((t) => t.fascia !== "scaduto");
    const { data: gia } = await ctx.sb.from("consegne_invii").select("id").eq("settimana", settimana).eq("persona", persona.nome).eq("tipo", "settimana").maybeSingle();
    if (gia && !soloProva) { esiti.push(`${persona.nome}: già mandata`); continue; }
    const righe: string[] = [`Ciao ${persona.nome},`, ""];
    if (!tutte.length) {
      righe.push(`per questa settimana (${inParole(lunedi)} - ${inParole(domenica)}) in Skorpio non hai task con scadenza. Se stai lavorando a qualcosa, dagli una scadenza nel kanban: senza, non è una consegna.`);
    } else {
      righe.push(`queste sono le tue consegne della settimana (${inParole(lunedi)} - ${inParole(domenica)}), prese da Skorpio.`);
      if (scaduti.length) {
        righe.push("", `Prima di tutto, ${scaduti.length === 1 ? "un task già scaduto" : `${scaduti.length} task già scaduti`}:`);
        for (const t of scaduti) righe.push(rigaTask(t, true));
      }
      if (inSettimana.length) {
        righe.push("", `In scadenza in settimana:`);
        for (const t of inSettimana) righe.push(rigaTask(t));
      }
      righe.push("", "Ogni task chiuso lo sposti su Skorpio in Fatto: il conto si fa da lì, non a voce. Se una data non regge, cambiala in Skorpio entro mercoledì e scrivimi una riga con il motivo.", "", "Venerdì sera guardo cosa è rimasto aperto.");
    }
    righe.push("", "Grazie,", "Giovanni");
    const testo = righe.join("\n");
    const oggetto = tutte.length
      ? `Le tue consegne della settimana: ${scaduti.length ? `${scaduti.length} scadut${scaduti.length === 1 ? "o" : "i"}, ` : ""}${inSettimana.length} in settimana`
      : "Questa settimana in Skorpio non hai consegne";
    if (soloProva) { anteprime.push({ persona: persona.nome, oggetto, testo }); esiti.push(`${persona.nome}: ${scaduti.length} scaduti, ${inSettimana.length} in settimana`); continue; }
    const r = await inviaEmail({
      sender: { name: "Giovanni Scozzafava", email: ctx.config.mittente_email || FROM_EMAIL },
      to: [{ email: persona.email!, name: persona.nome }],
      subject: oggetto,
      htmlContent: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;color:#1a1a1a;line-height:1.55;font-size:15px">${escHtml(testo).replace(/\n/g, "<br>")}<p style="margin-top:20px;font-size:12px;color:#94a3b8">Le consegne stanno in Skorpio: ${APP_URL}</p></div>`,
      replyTo: ctx.emailProprieta ? { email: ctx.emailProprieta } : undefined,
    }, "resend");
    await ctx.sb.from("consegne_invii").insert({
      settimana, persona: persona.nome, tipo: "settimana", email: persona.email,
      task_ids: tutte.map((t) => t.id), oggetto, testo, esito: r.ok ? "inviata" : `errore: ${taglia(r.error, 200)}`,
    });
    await inChatAlberto(ctx, persona, tutte.length
      ? `Le tue consegne di questa settimana: ${scaduti.length} già scadute, ${inSettimana.length} in settimana. Te le ho mandate anche per email. Chiudile nel kanban man mano.`
      : "Questa settimana non hai task con scadenza in Skorpio: se lavori a qualcosa, dagli una scadenza nel kanban.");
    esiti.push(`${persona.nome}: ${scaduti.length} scaduti, ${inSettimana.length} in settimana${r.ok ? "" : " (email non partita)"}`);
  }

  // Giovanni: le sue consegne e i suoi slot, in chat sede.
  if (giovanni && !soloProva) {
    const mie = await consegneDi(ctx, giovanni);
    const { data: slot } = await ctx.sb.from("calendario").select("data, ora, descrizione, progetto_id").eq("tipo", "lavoro").eq("stato", "Pianificato")
      .gte("data", lunedi).lte("data", domenica).eq("persona", giovanni.nome).order("data").order("ora");
    const { data: progetti } = await ctx.sb.from("progetti").select("nome, consegna_entro, ore_stimate, ore_pianificate, ore_fatte").in("stato", ["aperto", "in_corso"]).order("consegna_entro");
    const righe = [
      `Buon lunedì Giovanni. La settimana ${inParole(lunedi)} - ${inParole(domenica)}:`,
      `- Le persone: ${esiti.join("; ") || "nessuna consegna da mandare"}.`,
      `- I tuoi task: ${mie.filter((t) => t.fascia === "scaduto").length} scaduti, ${mie.filter((t) => t.fascia !== "scaduto").length} in settimana.`,
      `- I tuoi slot di lavoro: ${(slot ?? []).length ? (slot as Riga[]).map((s) => `${inParole(String(s.data))} ${String(s.ora).slice(0, 5)} ${String(s.descrizione).replace(/^Lavoro: /, "")}`).join("; ") : "nessuno in agenda"}.`,
      `- Progetti aperti: ${(progetti ?? []).length ? (progetti as Riga[]).map((p) => `${p.nome} (entro ${inParole(String(p.consegna_entro))}, ${p.ore_fatte}/${p.ore_stimate} ore fatte)`).join("; ") : "nessuno"}.`,
    ];
    await inSede(ctx, righe.join("\n"));
  }
  return { ok: true, settimana, esiti, anteprime };
}

/** La mail rossa: Claude con la voce di Giovanni; se non risponde, il modello fisso. */
async function mailRossa(ctx: Ctx, persona: Persona, scaduti: Consegna[]): Promise<{ oggetto: string; testo: string }> {
  const elenco = scaduti.map((t) => rigaTask(t, true)).join("\n");
  const fisso = {
    oggetto: `${scaduti.length === 1 ? "Un task" : `${scaduti.length} task`} che dovevi chiudere questa settimana e non hai chiuso`,
    testo: [
      `${persona.nome},`, "",
      `avevi ${scaduti.length === 1 ? "un task" : `${scaduti.length} task`} da chiudere entro oggi in Skorpio. ${scaduti.length === 1 ? "È ancora aperto" : "Sono ancora aperti"}.`, "",
      elenco, "",
      "Lunedì mattina li voglio chiusi, o con una data nuova scritta in Skorpio, non a voce. Se c'è un motivo vero, lo scrivi rispondendo a questa mail, oggi.", "",
      "Giovanni",
    ].join("\n"),
  };
  const voce = String(ctx.config.voce_giovanni ?? "").trim();
  if (!voce) return fisso;
  const esito = await chiamaClaude({
    system: `Scrivi una email in italiano a nome di Giovanni Scozzafava, titolare di Fuyue Digital Agency (Catanzaro), a una persona del suo team che non ha chiuso i task della settimana. Devi scrivere ESATTAMENTE come scrive lui: la guida sotto è legge. Nessuna frase da assistente, nessuna gentilezza di maniera, nessuna emoji, nessun markdown, nessun grassetto. Usa solo i fatti che ti do: codici, clienti, giorni di ritardo. Non inventare task, numeri o motivi. Massimo 18 righe. Rispondi con la prima riga «Oggetto: …» e poi, dopo una riga vuota, il corpo della mail, firmato «Giovanni».\n\n# La voce di Giovanni\n${voce}`,
    messages: [{ role: "user", content: `Oggi è ${inParole(ctx.oggi)}, venerdì. Destinatario: ${persona.nome}.\nTask che dovevano essere chiusi entro oggi (alcuni scaduti già da settimane) e sono ancora aperti in Skorpio (${scaduti.length}):\n${elenco}` }],
    max_tokens: 2500,
  });
  if (!esito.ok || esito.stop_reason === "max_tokens") return fisso;
  const testo = testoDi(esito.content);
  const m = testo.match(/^Oggetto:\s*(.+)$/m);
  const corpo = testo.replace(/^Oggetto:.*\n+/m, "").trim();
  if (!m || corpo.length < 80) return fisso;
  return { oggetto: taglia(m[1], 140), testo: corpo };
}

async function azioneVerifica(ctx: Ctx, input: Riga): Promise<Riga> {
  const settimana = settimanaIso(ctx.oggi);
  const persone = await sottoposti(ctx);
  const esiti: string[] = [];
  const soloProva = input.prova === true;
  for (const persona of persone) {
    const tutte = await consegneDi(ctx, persona);
    // Il venerdì «scaduto» è tutto ciò che aveva scadenza entro oggi.
    const nonChiusi = tutte.filter((t) => t.scadenza <= ctx.oggi);
    if (!nonChiusi.length) { esiti.push(`${persona.nome}: tutto chiuso`); continue; }
    const { data: gia } = await ctx.sb.from("consegne_invii").select("id").eq("settimana", settimana).eq("persona", persona.nome).eq("tipo", "rossa").maybeSingle();
    if (gia && !soloProva) { esiti.push(`${persona.nome}: mail rossa già mandata`); continue; }
    const mail = await mailRossa(ctx, persona, nonChiusi.map((t) => ({ ...t, giorni_ritardo: Math.max(0, Math.round((Date.parse(ctx.oggi) - Date.parse(t.scadenza)) / 86_400_000)) })));
    if (soloProva) { esiti.push(`${persona.nome}: ${nonChiusi.length} non chiusi`); (input.anteprime ??= []).push({ persona: persona.nome, ...mail }); continue; }
    const r = await inviaEmail({
      sender: { name: "Giovanni Scozzafava", email: ctx.config.mittente_email || FROM_EMAIL },
      to: [{ email: persona.email!, name: persona.nome }],
      cc: ctx.emailProprieta ? [{ email: ctx.emailProprieta, name: "Giovanni Scozzafava" }] : undefined,
      subject: mail.oggetto,
      htmlContent: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;color:#1a1a1a;line-height:1.55;font-size:15px">${escHtml(mail.testo).replace(/\n/g, "<br>")}</div>`,
      replyTo: ctx.emailProprieta ? { email: ctx.emailProprieta } : undefined,
    }, "resend");
    await ctx.sb.from("consegne_invii").insert({
      settimana, persona: persona.nome, tipo: "rossa", email: persona.email,
      task_ids: nonChiusi.map((t) => t.id), oggetto: mail.oggetto, testo: mail.testo, esito: r.ok ? "inviata" : `errore: ${taglia(r.error, 200)}`,
    });
    esiti.push(`${persona.nome}: mail rossa ${r.ok ? "mandata" : "NON partita"} per ${nonChiusi.length} task (${nonChiusi.map((t) => t.id_display).join(", ")})`);
  }
  if (!soloProva) {
    const giovanni = giovanniDi(ctx);
    const mie = giovanni ? (await consegneDi(ctx, giovanni)).filter((t) => t.scadenza <= ctx.oggi) : [];
    const { data: progettiScaduti } = await ctx.sb.from("progetti").select("nome, consegna_entro").in("stato", ["aperto", "in_corso"]).lte("consegna_entro", ctx.oggi);
    const righe = [`Venerdì, il conto della settimana:`, ...esiti.map((e) => `- ${e}`)];
    if (mie.length) righe.push(`- Tu, Giovanni: ${mie.length} task non chiusi (${mie.map((t) => t.id_display).join(", ")}). Vale anche per te.`);
    if (progettiScaduti?.length) righe.push(`- Progetti con la consegna passata: ${(progettiScaduti as Riga[]).map((p) => `${p.nome} (${inParole(String(p.consegna_entro))})`).join(", ")}.`);
    await inSede(ctx, righe.join("\n"));
  }
  return { ok: true, settimana, esiti, anteprime: input.anteprime ?? [] };
}

async function azioneTocco(ctx: Ctx, input: Riga): Promise<Riga> {
  const progetto = await trovaProgetto(ctx, input);
  if (!progetto) return { ok: false, errore: "Non trovo il progetto." };
  const campi: Riga = { ultimo_tocco: new Date().toISOString() };
  if (progetto.stato === "aperto") campi.stato = "in_corso";
  if (input.nota) campi.note = `${progetto.note ? `${progetto.note}\n` : ""}${ctx.oggi}: ${taglia(input.nota, 300)}`;
  await ctx.sb.from("progetti").update(campi).eq("id", progetto.id);
  return { ok: true, testo: `Segnato: oggi hai lavorato a «${progetto.nome}».`, progetto: { ...progetto, ...campi } };
}

async function azioneConsegnato(ctx: Ctx, input: Riga): Promise<Riga> {
  const progetto = await trovaProgetto(ctx, input);
  if (!progetto) return { ok: false, errore: "Non trovo il progetto." };
  const stato = input.stato === "parcheggiato" ? "parcheggiato" : "consegnato";
  await ctx.sb.from("progetti").update({ stato, ultimo_tocco: new Date().toISOString() }).eq("id", progetto.id);
  const { data: futuri } = await ctx.sb.from("calendario").select("id").eq("progetto_id", progetto.id).eq("tipo", "lavoro").eq("stato", "Pianificato").gte("data", ctx.oggi);
  for (const s of (futuri ?? []) as Riga[]) {
    await fetch(`${SUPABASE_URL}/functions/v1/calendario-invito`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ calendario_id: s.id, azione: "annulla" }),
    }).catch(() => null);
    await ctx.sb.from("calendario").delete().eq("id", s.id);
  }
  const riga = stato === "consegnato"
    ? `Progetto «${progetto.nome}» consegnato. ${(futuri ?? []).length} slot futuri tolti dall'agenda.`
    : `Progetto «${progetto.nome}» parcheggiato: ${(futuri ?? []).length} slot tolti dall'agenda. Quando riparte, riaprilo.`;
  await inSede(ctx, riga);
  return { ok: true, testo: riga };
}

async function azioneLista(ctx: Ctx): Promise<Riga> {
  const { data: progetti } = await ctx.sb.from("progetti").select("*").in("stato", ["aperto", "in_corso", "parcheggiato"]).order("consegna_entro");
  const out: Riga[] = [];
  for (const p of (progetti ?? []) as Riga[]) {
    const { data: prossimo } = await ctx.sb.from("calendario").select("data, ora").eq("progetto_id", p.id).eq("tipo", "lavoro").eq("stato", "Pianificato")
      .gte("data", ctx.oggi).order("data").order("ora").limit(1).maybeSingle();
    const { count: saltati } = await ctx.sb.from("calendario").select("id", { count: "exact", head: true }).eq("progetto_id", p.id).eq("stato", "Saltato");
    out.push({ ...p, prossimo_slot: prossimo ? `${prossimo.data} ${String(prossimo.ora).slice(0, 5)}` : null, slot_saltati: saltati ?? 0 });
  }
  return { ok: true, progetti: out };
}

// ─── Serve ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, errore: "Metodo non consentito" }, 405);

  const portatore = (req.headers.get("authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!(await eChiaveDiServizio(portatore))) {
    const chi = await chiChiama(req);
    if (!chi.ok) return json({ ok: false, errore: chi.motivo ?? "Non autorizzato" }, 401);
  }

  try {
    const input = (await req.json().catch(() => ({}))) as Riga;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const ctx = await contesto(sb);
    const azione = String(input.azione ?? "");
    const dalCron = input.da === "cron" && ["ripianifica", "settimana", "verifica", "giornata", "sera", "promemoria_timbra", "timbratura_avvio", "chiedi_compiti", "alberto_ritardi"].includes(azione);
    const inDifferita = ["avvisa_lavoro", "non_entra", "smistamento", "da_vidimare", "alberto_scrivi"].includes(azione) && input.attendi !== true;
    if (dalCron) {
      // pg_net chiude la connessione dopo 20 secondi: si risponde subito e si
      // lavora dopo, come squadra-lavora. L'esito sta in consegne_invii e in chat.
      const lavoro = (async () => {
        try {
          if (azione === "ripianifica") await azioneRipianifica(ctx);
          else if (azione === "settimana") await azioneSettimana(ctx, input);
          else if (azione === "verifica") await azioneVerifica(ctx, input);
          else if (azione === "giornata") await azioneGiornata(sb, input);
          else if (azione === "sera") await azioneSera(sb, input);
          else if (azione === "promemoria_timbra") await azionePromemoriaTimbra(sb, input);
          else if (azione === "chiedi_compiti") await azioneChiediCompiti(sb, input);
          else if (azione === "alberto_ritardi") await azioneAlbertoRitardi(sb, input);
          else await azioneTimbraturaAvvio(sb, input);
        } catch (e) {
          console.error("[consegne cron]", azione, e);
          await inSede(ctx, `Il giro «${azione}» delle consegne non è andato: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      // @ts-ignore EdgeRuntime esiste nel runtime delle edge function
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(lavoro); else await lavoro;
      return json({ ok: true, avviata: azione }, 202);
    }
    if (inDifferita) {
      // Chiamate dal database (pg_net, 20 secondi): si risponde subito, i
      // messaggi partono dopo. L'esito resta in whatsapp_messaggi e consegne_invii.
      const lavoro = (azione === "avvisa_lavoro" ? azioneAvvisaLavoro(sb, input) : azione === "smistamento" ? azioneSmistamento(sb, input) : azione === "da_vidimare" ? azioneDaVidimare(sb, input) : azione === "alberto_scrivi" ? azioneAlbertoScrivi(sb, input) : azioneNonEntra(sb, input))
        .catch((e) => console.error("[consegne]", azione, e));
      // @ts-ignore EdgeRuntime esiste nel runtime delle edge function
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(lavoro); else await lavoro;
      return json({ ok: true, avviata: azione }, 202);
    }
    let esito: Riga;
    switch (azione) {
      case "apri": esito = await azioneApri(ctx, input); break;
      case "pianifica": esito = await azionePianifica(ctx, input); break;
      case "ripianifica": esito = await azioneRipianifica(ctx); break;
      case "settimana": esito = await azioneSettimana(ctx, input); break;
      case "verifica": esito = await azioneVerifica(ctx, input); break;
      case "tocco": esito = await azioneTocco(ctx, input); break;
      case "consegnato": esito = await azioneConsegnato(ctx, input); break;
      case "lista": esito = await azioneLista(ctx); break;
      case "giornata": esito = await azioneGiornata(sb, input); break;
      case "avvisa_lavoro": esito = await azioneAvvisaLavoro(sb, input); break;
      case "non_entra": esito = await azioneNonEntra(sb, input); break;
      case "smistamento": esito = await azioneSmistamento(sb, input); break;
      case "sera": esito = await azioneSera(sb, input); break;
      case "promemoria_timbra": esito = await azionePromemoriaTimbra(sb, input); break;
      case "timbratura_avvio": esito = await azioneTimbraturaAvvio(sb, input); break;
      case "da_vidimare": esito = await azioneDaVidimare(sb, input); break;
      case "chiedi_compiti": esito = await azioneChiediCompiti(sb, input); break;
      case "alberto_ritardi": esito = await azioneAlbertoRitardi(sb, input); break;
      case "alberto_scrivi": esito = await azioneAlbertoScrivi(sb, input); break;
      case "prova_whatsapp": esito = await azioneProvaWhatsapp(sb, input); break;
      default: esito = { ok: false, errore: `Azione sconosciuta: «${azione}». Azioni: apri, pianifica, ripianifica, settimana, verifica, tocco, consegnato, lista, giornata, avvisa_lavoro, smistamento, non_entra, sera, promemoria_timbra, timbratura_avvio, da_vidimare, chiedi_compiti, alberto_ritardi, alberto_scrivi, prova_whatsapp.` };
    }
    return json(esito, esito.ok ? 200 : 400);
  } catch (e) {
    console.error("[consegne]", e);
    return json({ ok: false, errore: e instanceof Error ? e.message : String(e) }, 500);
  }
});
