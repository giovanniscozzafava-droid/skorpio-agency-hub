// ============================================================================
// La timeline del lavoro giornaliero (Giovanni, 30/09/2026): i messaggi.
// ============================================================================
// Il pianificatore sta nel database (consegne_assegna, consegne_sposta,
// consegne_pianifica_task: migrazione 20260930090000_timeline_lavoro.sql).
// Qui c'è solo chi parla con le persone:
//   giornata          lun-ven 8:30, a ognuno la lista del giorno con gli orari
//                     (WhatsApp + email, stesso testo), a Elisa anche gli scaduti
//   avvisa_lavoro     subito, a chi riceve un lavoro nuovo o spostato
//   da_vidimare       subito, a Elisa: Alberto ha messo in calendario un lavoro
//                     chiesto da Giovanni; il ragazzo lo riceve quando Elisa vidima
//   smistamento       (vecchio passaggio) un compito da smistare, a Elisa
//   chiedi_compiti    lun-ven 18:30, a Giovanni: i lavori per il prossimo giorno
//   non_entra         a Giovanni ed Elisa, quando un lavoro non entra
//   sera              lun-ven 18:00, lavori con consegna oggi non in Fatto
//   promemoria_timbra lun-ven 9:15, a chi non ha timbrato l'Entrata
//   timbratura_avvio  1/10/2026 8:30, «da oggi si timbra»
//   prova_whatsapp    un messaggio di prova a un membro (verifica del canale)
// Ora di Roma ovunque. I cron girano due volte (estate/inverno) e il campo
// `alle` fa partire solo quello che cade all'ora giusta di Roma.
// ============================================================================

import { inviaEmail } from "../_shared/emailProvider.ts";

// deno-lint-ignore no-explicit-any
type Riga = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Sb = any;

const KAPSO_API_KEY = Deno.env.get("KAPSO_API_KEY") ?? "";
const KAPSO_PHONE_NUMBER_ID = Deno.env.get("KAPSO_PHONE_NUMBER_ID") ?? "";
const KAPSO_PROXY_BASE = "https://api.kapso.ai/meta/whatsapp/v23.0";
const APP_URL = Deno.env.get("APP_URL") || "https://skorpio-v3-redesign.vercel.app";
const FROM_EMAIL = Deno.env.get("PREVENTIVI_FROM_EMAIL") || "no-reply@fuyue.it";
const TEMPLATE = "lavoro_di_oggi";

export const LINK_CALENDARIO = `${APP_URL}/?tab=calendario`;
export const LINK_PERSONE = `${APP_URL} (menu Persone → Entrata)`;

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const giornoRoma = (d = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const oraRomaHHMM = (d = new Date()): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const giornoSett = (g: string): number => new Date(`${g}T12:00:00Z`).getUTCDay();
function inParole(g: string, oggi = giornoRoma()): string {
  if (g === oggi) return "oggi";
  const domani = new Date(`${oggi}T12:00:00Z`); domani.setUTCDate(domani.getUTCDate() + 1);
  if (g === domani.toISOString().slice(0, 10)) return "domani";
  const [, m, d] = g.split("-");
  return `${GIORNI[giornoSett(g)]} ${Number(d)}/${Number(m)}`;
}
const hhmm = (t: unknown): string => String(t ?? "").slice(0, 5);
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** true se adesso a Roma è entro 20 minuti dopo `alle` («08:30»). Senza `alle`: sempre. */
export function allOraGiusta(alle: unknown): boolean {
  const a = String(alle ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(a)) return true;
  const [h, m] = a.split(":").map(Number);
  const [hh, mm] = oraRomaHHMM().split(":").map(Number);
  const diff = (hh * 60 + mm) - (h * 60 + m);
  return diff >= -2 && diff <= 20;
}
export const feriale = (g = giornoRoma()): boolean => { const d = giornoSett(g); return d >= 1 && d <= 5; };

// ─── Canali ──────────────────────────────────────────────────────────────────

interface Contatto { nome: string; email: string | null; numero: string | null; mansione: string; ruolo: string; id: string }

export async function contatti(sb: Sb): Promise<Contatto[]> {
  const [{ data: team }, { data: wa }] = await Promise.all([
    sb.from("team").select("id, nome, email, mansione, ruolo").order("nome"),
    sb.from("team_whatsapp").select("membro, numero, attivo"),
  ]);
  return ((team ?? []) as Riga[]).map((t) => {
    const w = ((wa ?? []) as Riga[]).find((x) => x.attivo && String(x.membro).toLowerCase() === String(t.nome).toLowerCase());
    return { id: String(t.id), nome: String(t.nome), email: t.email ? String(t.email) : null, numero: w?.numero ? String(w.numero) : null, mansione: String(t.mansione ?? ""), ruolo: String(t.ruolo ?? "") };
  });
}

async function kapso(corpo: Riga): Promise<{ ok: boolean; messageId?: string; errore?: string }> {
  try {
    const resp = await fetch(`${KAPSO_PROXY_BASE}/${KAPSO_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": KAPSO_API_KEY },
      body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
    });
    const grezzo = await resp.text();
    // deno-lint-ignore no-explicit-any
    let data: any = {};
    try { data = JSON.parse(grezzo); } catch { /* risposta non JSON */ }
    if (!resp.ok) {
      // Il motivo completo (es. 402 di Kapso o di Meta) resta in whatsapp_messaggi.errore.
      const dettaglio = data?.error?.message ?? data?.message ?? data?.error ?? grezzo;
      return { ok: false, errore: `HTTP ${resp.status}: ${typeof dettaglio === "string" ? dettaglio : JSON.stringify(dettaglio)}`.slice(0, 500) };
    }
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Un WhatsApp a una persona. Se ha scritto ad Alberto nelle ultime 24 ore il
 * testo va libero (con gli a capo); altrimenti Meta vuole il template
 * approvato «lavoro_di_oggi» (nome + testo su una riga). Tutto finisce in
 * whatsapp_messaggi con l'esito.
 */
export async function inviaWhatsapp(sb: Sb, c: Contatto, testo: string): Promise<{ ok: boolean; errore?: string; id?: string }> {
  if (!c.numero) return { ok: false, errore: "nessun numero WhatsApp" };
  const { data: ultimo } = await sb.from("whatsapp_messaggi").select("created_at").eq("numero", c.numero).eq("direzione", "entrata")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const inFinestra = !!ultimo && Date.now() - Date.parse(ultimo.created_at) < 23 * 3600_000;
  let esito = inFinestra ? await kapso({ to: c.numero, type: "text", text: { body: testo.slice(0, 4000) } }) : { ok: false as const, errore: "fuori finestra" };
  let template: string | null = null;
  if (!esito.ok) {
    template = TEMPLATE;
    // Meta rifiuta (#132018) parametri con a capo o spazi ripetuti.
    const corpo = testo.replace(/^Buongiorno [^,]+,\s*/i, "").replace(/\s*\n+\s*/g, " • ").replace(/ {2,}/g, " ").trim().slice(0, 1000);
    esito = await kapso({ to: c.numero, type: "template", template: { name: TEMPLATE, language: { code: "it" }, components: [{ type: "body", parameters: [{ type: "text", text: c.nome }, { type: "text", text: corpo }] }] } });
  }
  const { data: riga } = await sb.from("whatsapp_messaggi").insert({
    membro: c.nome, numero: c.numero, direzione: "uscita", testo, template_nome: template,
    kapso_message_id: esito.messageId ?? null, stato: esito.ok ? "inviato" : "fallito", errore: esito.ok ? null : (esito.errore ?? null),
  }).select("id").single();
  return { ok: esito.ok, errore: esito.errore, id: riga?.id };
}

export async function inviaMail(sb: Sb, c: Contatto, oggetto: string, testo: string): Promise<{ ok: boolean; errore?: string }> {
  if (!c.email) return { ok: false, errore: "nessuna email" };
  const { data: cfg } = await sb.schema("motore").from("config").select("valore").eq("chiave", "mittente_email").maybeSingle();
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;color:#1a1a1a;line-height:1.6;font-size:15px">${esc(testo).replace(/\n/g, "<br>")}<p style="margin-top:18px;font-size:12px;color:#94a3b8">Alberto, Skorpio · Fuyue Digital Agency</p></div>`;
  const r = await inviaEmail({
    sender: { name: "Alberto · Skorpio", email: cfg?.valore || FROM_EMAIL },
    to: [{ email: c.email, name: c.nome }], subject: oggetto, htmlContent: html,
  }, "resend");
  return { ok: r.ok, errore: r.error };
}

async function inChat(sb: Sb, c: Contatto, testo: string, autore = "alberto"): Promise<void> {
  await sb.from("chat_alberto").insert({ team_id: c.id, autore, testo });
}

/** WhatsApp + email + chat, stesso testo. Ritorna una riga di esito. */
async function aTutti(sb: Sb, c: Contatto, oggetto: string, testo: string, chat = true): Promise<string> {
  const [w, m] = await Promise.all([inviaWhatsapp(sb, c, testo), inviaMail(sb, c, oggetto, testo)]);
  if (chat) await inChat(sb, c, testo);
  return `${c.nome}: WhatsApp ${w.ok ? "ok" : `no (${w.errore})`}, email ${m.ok ? "ok" : `no (${m.errore})`}`;
}

async function giaFatto(sb: Sb, chiave: string, persona: string, tipo: string): Promise<boolean> {
  const { data } = await sb.from("consegne_invii").select("id").eq("settimana", chiave).eq("persona", persona).eq("tipo", tipo).limit(1);
  return !!data?.length;
}
async function segna(sb: Sb, chiave: string, c: Contatto, tipo: string, oggetto: string, testo: string, esito: string): Promise<void> {
  await sb.from("consegne_invii").insert({ settimana: chiave, persona: c.nome, tipo, email: c.email, oggetto, testo, esito: esito.slice(0, 300) });
}

// ─── La giornata di una persona ──────────────────────────────────────────────

export async function testoGiornata(sb: Sb, c: Contatto, giorno: string, apertura = true): Promise<{ testo: string; vuota: boolean }> {
  const { data: g, error } = await sb.rpc("consegne_giornata", { p_membro: c.nome, p_giorno: giorno });
  if (error) throw new Error(error.message);
  const agenda: Riga[] = g?.agenda ?? [];
  const consegne: Riga[] = g?.consegne ?? [];
  const assenze: string[] = g?.assenze ?? [];
  const daSmistare: Riga[] = g?.da_smistare ?? [];
  const daVidimare: Riga[] = g?.da_vidimare ?? [];
  const righe: string[] = [];
  if (apertura) righe.push(`Buongiorno ${c.nome}, ${inParole(giorno)}:`);
  // Il lavoro non ancora vidimato da Elisa il ragazzo non lo vede.
  for (const a of agenda.filter((x) => !x.da_vidimare)) {
    const titolo = String(a.titolo ?? "").trim();
    righe.push(`${hhmm(a.ora)}${a.ora_fine ? `-${hhmm(a.ora_fine)}` : ""} ${titolo}${a.cliente && !titolo.toLowerCase().includes(String(a.cliente).toLowerCase()) ? ` (${a.cliente})` : ""}`);
  }
  for (const s of assenze) righe.push(`Assenza: ${s}`);
  const senzaBlocchi = consegne.filter((k) => !agenda.some((a) => a.task === k.id_display));
  if (senzaBlocchi.length) {
    righe.push(`Da consegnare ${inParole(giorno)}: ${senzaBlocchi.map((k) => `${k.cosa}${k.cliente ? ` (${k.cliente})` : ""}`).join("; ")}`);
  }
  if (consegne.length) {
    const ore = consegne.map((k) => k.ora).filter(Boolean).sort();
    const ultima = ore.length ? ore[ore.length - 1] : String(g?.orario ?? "").split("-").pop();
    righe.push(ultima && /^\d{2}:\d{2}$/.test(String(ultima)) ? `Entro le ${ultima} consegna tutto.` : "Entro fine giornata consegna tutto.");
  }
  if (daSmistare.length) {
    righe.push(`Da smistare ai ragazzi (${daSmistare.length}): ${daSmistare.map((d) => `${d.descrizione} [${d.id_display}]`).join("; ")}`);
  }
  if (daVidimare.length) {
    righe.push(`Da vidimare (${daVidimare.length}): ${daVidimare.map((d) => `${d.per}: ${d.cosa}, consegna ${inParole(String(d.scadenza), giorno)}${d.consegna_ora ? ` entro le ${d.consegna_ora}` : ""} [${d.id_display}]`).join("; ")}`);
  }
  const vuota = !agenda.some((x) => !x.da_vidimare) && !consegne.length && !assenze.length && !daSmistare.length && !daVidimare.length;
  if (vuota) righe.push("In agenda non hai niente di fissato. Se ti arriva lavoro nuovo te lo scrivo subito.");
  return { testo: righe.join("\n"), vuota };
}

export async function azioneGiornata(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  const prova = input.prova === true;
  if (!prova && !allOraGiusta(input.alle)) return { ok: true, saltato: `non è l'ora (${oraRomaHHMM()} a Roma)` };
  if (!prova && !feriale(oggi)) return { ok: true, saltato: "sabato o domenica" };
  const tutti = await contatti(sb);
  const soloPer = input.persona ? String(input.persona).toLowerCase() : null;
  const esiti: string[] = [];
  const settegiorniFa = new Date(Date.parse(`${oggi}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  for (const c of tutti) {
    if (soloPer && c.nome.toLowerCase() !== soloPer) continue;
    if (!c.numero && !c.email) { esiti.push(`${c.nome}: né WhatsApp né email in Skorpio, niente lista`); continue; }
    if (!prova && await giaFatto(sb, oggi, c.nome, "giornata")) { esiti.push(`${c.nome}: già mandata`); continue; }
    const { testo: base } = await testoGiornata(sb, c, oggi);
    const righe = [base];
    if (c.nome === "Elisa") {
      const { data: scaduti } = await sb.from("task").select("descrizione, assegnato_a, cliente_nome, scadenza")
        .lt("scadenza", oggi).gte("scadenza", settegiorniFa).not("stato", "in", '("Fatto","Archiviato")').order("scadenza").limit(20);
      if (scaduti?.length) righe.push("", "Scaduti della squadra:", ...(scaduti as Riga[]).map((t) => `- ${t.descrizione} — ${t.assegnato_a}, era per ${inParole(String(t.scadenza), oggi)}`));
    }
    if (c.mansione === "produzione" && oggi >= "2026-10-01") righe.push("Quando inizi timbra l'Entrata: Skorpio → Persone.");
    righe.push(`Apri: ${LINK_CALENDARIO}`);
    const testo = righe.join("\n");
    const oggetto = `La tua giornata di ${inParole(oggi) === "oggi" ? `oggi, ${GIORNI[giornoSett(oggi)]} ${Number(oggi.slice(8))}/${Number(oggi.slice(5, 7))}` : oggi}`;
    const esito = await aTutti(sb, c, oggetto, testo, false);
    if (!prova) await segna(sb, oggi, c, "giornata", oggetto, testo, esito);
    esiti.push(esito);
  }
  return { ok: true, giorno: oggi, esiti };
}

// ─── Lavoro nuovo o spostato ─────────────────────────────────────────────────

export async function azioneAvvisaLavoro(sb: Sb, input: Riga): Promise<Riga> {
  const { data: k } = await sb.from("task").select("id, id_display, descrizione, cliente_nome, assegnato_a, assegnato_da, scadenza, consegna_ora, ore_stimate, stato")
    .eq("id", String(input.task_id ?? "")).maybeSingle();
  if (!k) return { ok: false, errore: "task non trovato" };
  if (["Fatto", "Archiviato"].includes(k.stato)) return { ok: true, saltato: "task già chiuso" };
  const c = (await contatti(sb)).find((x) => x.nome.toLowerCase() === String(k.assegnato_a).toLowerCase());
  if (!c) return { ok: false, errore: "persona non trovata" };
  const oggi = giornoRoma();
  const { data: blocchi } = await sb.from("calendario").select("data, ora, ora_fine").eq("blocco_task_id", k.id).gt("fine_ts", new Date().toISOString()).order("inizio_ts");
  const quando = `${inParole(String(k.scadenza), oggi)}${k.consegna_ora ? ` entro le ${hhmm(k.consegna_ora)}` : ""}`;
  const orari = ((blocchi ?? []) as Riga[]).map((b) => `${inParole(String(b.data), oggi)} ${hhmm(b.ora)}-${hhmm(b.ora_fine)}`).join(", ");
  const righe: string[] = [];
  const cliente = k.cliente_nome ? ` (${k.cliente_nome})` : "";
  if (input.riordino) {
    // Il pianificatore ha rimesso in fila il lavoro della persona: la consegna
    // di questo non è cambiata, sono cambiati gli orari.
    righe.push(`${c.nome}, ho rimesso in fila il tuo lavoro: «${k.descrizione}»${cliente} cambia orario, la consegna resta ${quando}.`);
  } else if (input.motivo === "spostato") {
    const prima = String(input.prima ?? "").trim();
    const primaInParole = prima ? `${inParole(prima.slice(0, 10), oggi)}${prima.length > 10 ? ` entro le ${prima.slice(11, 16)}` : ""}` : "";
    const chi = String(input.da ?? "").trim();
    righe.push(`${c.nome}, ${chi && chi !== c.nome ? `${chi} ha spostato` : "è stata spostata"} la consegna di «${k.descrizione}»${cliente}: ora è ${quando}${primaInParole ? ` (prima ${primaInParole})` : ""}.`);
  } else {
    const chi = String(k.assegnato_da ?? "").trim();
    righe.push(`${c.nome}, nuovo lavoro${chi && chi !== c.nome ? ` da ${chi}` : ""}: «${k.descrizione}»${cliente}${k.ore_stimate ? `, ${String(k.ore_stimate).replace(".", ",")} ore` : ""}, consegna ${quando}.`);
  }
  righe.push(orari ? `In agenda: ${orari}.` : "Non ci sono ore in agenda per questo lavoro.");
  const toccaOggi = ((blocchi ?? []) as Riga[]).some((b) => b.data === oggi) || k.scadenza === oggi;
  if (toccaOggi) {
    const { testo } = await testoGiornata(sb, c, oggi, false);
    righe.push("", "La tua giornata adesso:", testo);
  }
  righe.push(`Apri: ${LINK_CALENDARIO}`);
  const testo = righe.join("\n");
  const oggetto = input.riordino ? `Nuovi orari: ${k.descrizione}` : input.motivo === "spostato" ? `Consegna spostata: ${k.descrizione}` : `Nuovo lavoro: ${k.descrizione} (consegna ${quando})`;
  const esito = await aTutti(sb, c, oggetto, testo);
  await segna(sb, oggi, c, input.motivo === "spostato" ? "lavoro_spostato" : "lavoro_nuovo", oggetto, testo, `${k.id_display} · ${esito}`);
  return { ok: true, esito };
}

// ─── Un compito da smistare, a Elisa ─────────────────────────────────────────

export async function azioneSmistamento(sb: Sb, input: Riga): Promise<Riga> {
  const { data: k } = await sb.from("task").select("id, id_display, descrizione, assegnato_a, assegnato_da, stato, proposta, note")
    .eq("id", String(input.task_id ?? "")).maybeSingle();
  if (!k || !k.proposta) return { ok: false, errore: "compito da smistare non trovato" };
  if (k.stato !== "Da fare") return { ok: true, saltato: "già smistato" };
  const c = (await contatti(sb)).find((x) => x.nome.toLowerCase() === String(k.assegnato_a).toLowerCase());
  if (!c) return { ok: false, errore: "smistatore non trovato" };
  const pr: Riga = k.proposta;
  const verifica = String(k.note ?? "").replace(/^.*Verifica del pianificatore:\s*/s, "");
  const prop = pr.verifica?.proposte;
  const alternative: string[] = [];
  if (prop?.prima_data_possibile) alternative.push(`spostare la consegna a ${inParole(String(prop.prima_data_possibile))}`);
  for (const a of (prop?.altri_con_ore ?? []) as Riga[]) alternative.push(`darlo a ${a.persona} (${String(a.ore_libere).replace(".", ",")} ore libere)`);
  const testo = [
    `${c.nome}, ${pr.da ?? k.assegnato_da} ti passa un lavoro da dare ai ragazzi: ${String(k.descrizione).replace(/^Da dare a /, "per ")}.`,
    `Verifica: ${verifica}.`,
    alternative.length ? `Alternative: ${alternative.join(", oppure ")}.` : "",
    `Scrivimi «ok» e lo metto così, oppure a chi darlo, quante ore o che consegna. [${k.id_display}]`,
  ].filter(Boolean).join("\n");
  const esito = await aTutti(sb, c, `Da smistare: ${k.descrizione}`, testo);
  await segna(sb, giornoRoma(), c, "smistamento", `Da smistare: ${k.descrizione}`, testo, `${k.id_display} · ${esito}`);
  return { ok: true, esito };
}

// ─── Da vidimare, a Elisa ────────────────────────────────────────────────────

export async function azioneDaVidimare(sb: Sb, input: Riga): Promise<Riga> {
  const { data: k } = await sb.from("task").select("id, id_display, descrizione, cliente_nome, assegnato_a, assegnato_da, scadenza, consegna_ora, ore_stimate, stato, vidimato")
    .eq("id", String(input.task_id ?? "")).maybeSingle();
  if (!k) return { ok: false, errore: "task non trovato" };
  if (k.vidimato || ["Fatto", "Archiviato"].includes(k.stato)) return { ok: true, saltato: "già vidimato o chiuso" };
  const { data: conf } = await sb.schema("motore").from("config").select("valore").eq("chiave", "consegne_smistatore").maybeSingle();
  const nomeSmistatore = String(conf?.valore || "Elisa");
  const c = (await contatti(sb)).find((x) => x.nome.toLowerCase() === nomeSmistatore.toLowerCase());
  if (!c) return { ok: false, errore: "smistatore non trovato" };
  const oggi = giornoRoma();
  const { data: blocchi } = await sb.from("calendario").select("data, ora, ora_fine").eq("blocco_task_id", k.id).gt("fine_ts", new Date().toISOString()).order("inizio_ts");
  const orari = ((blocchi ?? []) as Riga[]).map((b) => `${inParole(String(b.data), oggi)} ${hhmm(b.ora)}-${hhmm(b.ora_fine)}`).join(", ");
  const quando = `${inParole(String(k.scadenza), oggi)}${k.consegna_ora ? ` entro le ${hhmm(k.consegna_ora)}` : ""}`;
  const testo = [
    `${c.nome}, ${k.assegnato_da ?? "Giovanni"} ha chiesto per ${k.assegnato_a}: «${k.descrizione}»${k.cliente_nome ? ` (${k.cliente_nome})` : ""}${k.ore_stimate ? `, ${String(k.ore_stimate).replace(".", ",")} ore` : ""}, consegna ${quando}.`,
    orari ? `L'ho messo in calendario e nel Kanban: ${orari}.` : "L'ho messo nel Kanban.",
    `${k.assegnato_a} non lo sa ancora. Scrivimi «vidima ${k.id_display}» (o «vidima tutto») e glielo mando. Per cambiarlo: «sposta ${k.id_display} a lunedì 12:00» oppure «dai ${k.id_display} a Luca».`,
    `Apri: ${LINK_CALENDARIO}`,
  ].join("\n");
  const oggetto = `Da vidimare: ${k.descrizione} (${k.assegnato_a})`;
  const esito = await aTutti(sb, c, oggetto, testo);
  await segna(sb, oggi, c, "da_vidimare", oggetto, testo, `${k.id_display} · ${esito}`);
  return { ok: true, esito };
}

// ─── La sera, a Giovanni: i compiti per il prossimo giorno ───────────────────

function prossimoFeriale(g: string): string {
  let d = new Date(Date.parse(`${g}T12:00:00Z`) + 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
  return d.toISOString().slice(0, 10);
}

export async function azioneChiediCompiti(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  const prova = input.prova === true;
  if (!prova && !allOraGiusta(input.alle)) return { ok: true, saltato: `non è l'ora (${oraRomaHHMM()} a Roma)` };
  if (!prova && !feriale(oggi)) return { ok: true, saltato: "sabato o domenica" };
  const tutti = await contatti(sb);
  const g = (await contatti(sb)).find((x) => x.nome === "Giovanni");
  if (!g) return { ok: false, errore: "Giovanni non trovato" };
  if (!prova && await giaFatto(sb, oggi, g.nome, "chiedi_compiti")) return { ok: true, saltato: "già chiesto" };
  const giorno = prossimoFeriale(oggi);
  const quando = inParole(giorno, oggi);
  const righe: string[] = [];
  for (const c of tutti.filter((x) => x.mansione === "produzione")) {
    const { data: gg } = await sb.rpc("consegne_giornata", { p_membro: c.nome, p_giorno: giorno });
    if (!gg?.ok) continue;
    const lavori = ((gg.agenda ?? []) as Riga[]).filter((a) => a.task).length;
    righe.push(`- ${c.nome}: ${gg.orario === "non lavora" ? "non lavora" : `${String(gg.ore_libere ?? 0).replace(".", ",")} ore libere (${gg.orario})`}${lavori ? `, ${lavori} blocchi di lavoro già messi` : ""}`);
  }
  const { data: pendenti } = await sb.from("task").select("id").eq("vidimato", false).not("stato", "in", '("Fatto","Archiviato")');
  const testo = [
    `Giovanni, che lavori ci sono per ${quando}?`,
    ...righe,
    pendenti?.length ? `In attesa che Elisa vidimi: ${pendenti.length}.` : "",
    "Scrivimeli uno per messaggio, così:",
    "lavoro Luca: montaggio reel Roxy, 3 ore, entro venerdì 17:30",
    "lavoro Alessandro: riprese Roxy, giovedì 15-18",
    "Li metto in calendario e nel Kanban e li passo a Elisa da vidimare. Puoi scrivermi anche più tardi o domattina.",
  ].filter(Boolean).join("\n");
  const w = await inviaWhatsapp(sb, g, testo);
  await inChat(sb, g, testo);
  const e = `${g.nome}: WhatsApp ${w.ok ? "ok" : `no (${w.errore})`}`;
  if (!prova) await segna(sb, oggi, g, "chiedi_compiti", `Lavori per ${quando}`, testo, e);
  return { ok: true, giorno, esito: e, testo };
}

// ─── Non entra ───────────────────────────────────────────────────────────────

export async function azioneNonEntra(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  const quando = `${inParole(String(input.entro), oggi)}${input.entro_ora ? ` entro le ${input.entro_ora}` : ""}`;
  const prop = input.proposte ?? {};
  const proposte: string[] = [];
  if (prop.prima_data_possibile) proposte.push(`spostare la consegna a ${inParole(String(prop.prima_data_possibile), oggi)}`);
  for (const a of (prop.altri_con_ore ?? []) as Riga[]) proposte.push(`passarlo a ${a.persona} (${String(a.ore_libere).replace(".", ",")} ore libere)`);
  const altri = ((input.non_entrano ?? []) as Riga[]).filter((x) => x.id_display).map((x) => `${x.id_display} (mancano ${x.mancano} ore)`);
  const testo = [
    input.dal_kanban
      ? `Attenzione: dopo il cambio dal Kanban, il lavoro di ${input.persona} «${input.cosa}» (consegna ${quando}) non entra nelle sue ore.${altri.length ? ` Scoperti: ${altri.join(", ")}.` : ""}`
      : `${input.richiedente ?? "Qualcuno"} ha chiesto a ${input.persona} «${input.cosa}», ${String(input.ore).replace(".", ",")} ore, consegna ${quando}: non entra. ${input.persona} ha ${String(input.ore_libere ?? "?").replace(".", ",")} ore libere prima della consegna, con il lavoro che ha già. Non l'ho messo.`,
    proposte.length ? `Si può: ${proposte.join(", oppure ")}.` : "Nessuno ha abbastanza ore libere prima di quella consegna: serve una data più avanti.",
    "Ditemi voi.",
  ].join("\n");
  const esiti: string[] = [];
  for (const c of (await contatti(sb)).filter((x) => x.nome === "Giovanni" || x.nome === "Elisa")) {
    const w = await inviaWhatsapp(sb, c, testo);
    await inChat(sb, c, testo, "sistema");
    esiti.push(`${c.nome}: WhatsApp ${w.ok ? "ok" : `no (${w.errore})`}`);
  }
  return { ok: true, esiti };
}

// ─── La sera ─────────────────────────────────────────────────────────────────

export async function azioneSera(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  const prova = input.prova === true;
  if (!prova && !allOraGiusta(input.alle)) return { ok: true, saltato: `non è l'ora (${oraRomaHHMM()} a Roma)` };
  if (!prova && !feriale(oggi)) return { ok: true, saltato: "sabato o domenica" };
  const tutti = await contatti(sb);
  const produzione = tutti.filter((c) => c.mansione === "produzione").map((c) => c.nome);
  const { data: aperti } = await sb.from("task").select("id_display, tipo, descrizione, cliente_nome, assegnato_a, consegna_ora, pianificato")
    .eq("scadenza", oggi).not("stato", "in", '("Fatto","Archiviato")').order("assegnato_a");
  const lavori = ((aperti ?? []) as Riga[]).filter((t) => t.pianificato || t.tipo === "Da smistare" || produzione.includes(String(t.assegnato_a)));
  if (!lavori.length) return { ok: true, esiti: ["tutto consegnato"] };
  const testo = [
    `Consegne di oggi non ancora in Fatto (${lavori.length}):`,
    ...lavori.map((t) => `- ${t.assegnato_a}: ${t.descrizione}${t.cliente_nome ? ` (${t.cliente_nome})` : ""}${t.consegna_ora ? `, entro le ${hhmm(t.consegna_ora)}` : ""} [${t.id_display}]`),
    "Se sono consegnate, vanno messe in Fatto nel Kanban; se no, ditemi la nuova data e la sposto.",
  ].join("\n");
  const esiti: string[] = [];
  for (const c of tutti.filter((x) => x.nome === "Giovanni" || x.nome === "Elisa")) {
    if (!prova && await giaFatto(sb, oggi, c.nome, "sera")) { esiti.push(`${c.nome}: già mandato`); continue; }
    const w = await inviaWhatsapp(sb, c, testo);
    await inChat(sb, c, testo, "sistema");
    const e = `${c.nome}: WhatsApp ${w.ok ? "ok" : `no (${w.errore})`}`;
    if (!prova) await segna(sb, oggi, c, "sera", "Consegne di oggi non chiuse", testo, e);
    esiti.push(e);
  }
  return { ok: true, lavori: lavori.length, esiti };
}

// ─── Timbratura ──────────────────────────────────────────────────────────────

export const TESTO_AVVIO = `Da oggi si timbra. Ricordati Entrata quando inizi e Uscita quando finisci: ${LINK_PERSONE}`;

export async function azioneTimbraturaAvvio(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  if (oggi < "2026-10-01" && input.prova !== true) return { ok: true, saltato: "parte il 1° ottobre" };
  if (!allOraGiusta(input.alle) && input.prova !== true) return { ok: true, saltato: `non è l'ora (${oraRomaHHMM()} a Roma)` };
  const esiti: string[] = [];
  for (const c of (await contatti(sb)).filter((x) => x.mansione === "produzione")) {
    if (await giaFatto(sb, "2026-10-01", c.nome, "timbratura_avvio")) { esiti.push(`${c.nome}: già mandato`); continue; }
    if (!c.numero && !c.email) { esiti.push(`${c.nome}: né WhatsApp né email in Skorpio`); continue; }
    const testo = `${c.nome}, ${TESTO_AVVIO.charAt(0).toLowerCase()}${TESTO_AVVIO.slice(1)}`;
    const e = await aTutti(sb, c, "Da oggi si timbra in Skorpio", testo);
    await segna(sb, "2026-10-01", c, "timbratura_avvio", "Da oggi si timbra in Skorpio", testo, e);
    esiti.push(e);
  }
  return { ok: true, esiti };
}

export async function azionePromemoriaTimbra(sb: Sb, input: Riga): Promise<Riga> {
  const oggi = giornoRoma();
  if (oggi < "2026-10-01") return { ok: true, saltato: "la timbratura parte il 1° ottobre" };
  if (!allOraGiusta(input.alle) || !feriale(oggi)) return { ok: true, saltato: `non è l'ora (${oraRomaHHMM()} a Roma)` };
  const esiti: string[] = [];
  for (const c of (await contatti(sb)).filter((x) => x.mansione === "produzione")) {
    const { data: g } = await sb.rpc("consegne_giornata", { p_membro: c.nome, p_giorno: oggi });
    if (!g || g.orario === "non lavora") { esiti.push(`${c.nome}: oggi non lavora`); continue; }
    if ((g.assenze ?? []).length) { esiti.push(`${c.nome}: assente`); continue; }
    const { data: timbri } = await sb.from("presenze").select("id").ilike("persona", c.nome).in("tipo", ["entrata", "turno"])
      .gte("inizio", new Date(Date.parse(`${oggi}T00:00:00Z`) - 3 * 3600_000).toISOString()).limit(1);
    if (timbri?.length) { esiti.push(`${c.nome}: ha timbrato`); continue; }
    if (await giaFatto(sb, oggi, c.nome, "promemoria_timbra")) { esiti.push(`${c.nome}: già ricordato`); continue; }
    const testo = `${c.nome}, non hai ancora timbrato l'Entrata di oggi. Fallo adesso: ${LINK_PERSONE}`;
    const w = await inviaWhatsapp(sb, c, testo);
    const m = w.ok ? { ok: true } : await inviaMail(sb, c, "Non hai ancora timbrato l'Entrata", testo);
    const e = `${c.nome}: WhatsApp ${w.ok ? "ok" : `no (${w.errore})`}${w.ok ? "" : `, email ${m.ok ? "ok" : "no"}`}`;
    await segna(sb, oggi, c, "promemoria_timbra", "Promemoria timbratura", testo, e);
    esiti.push(e);
  }
  return { ok: true, esiti };
}

export async function azioneProvaWhatsapp(sb: Sb, input: Riga): Promise<Riga> {
  const c = (await contatti(sb)).find((x) => x.nome.toLowerCase() === String(input.membro ?? "").toLowerCase());
  if (!c?.numero) return { ok: false, errore: "membro senza numero WhatsApp attivo" };
  const testo = String(input.testo ?? "").trim() || `[PROVA] ${TESTO_AVVIO}`;
  const w = await inviaWhatsapp(sb, c, testo);
  return { ok: w.ok, errore: w.errore, whatsapp_messaggi_id: w.id };
}
