import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../integrations/supabase/client';

// ─────────────────────────────────────────────────────────────────────────────
// Pagina «WhatsApp» dentro Alberto.
//
// Una conversazione per persona; sotto ogni messaggio in entrata si vede cosa ha
// fatto Alberto (task, eventi, azioni) con il link per aprirli. Elisa e Giovanni
// vedono tutte le conversazioni e possono rispondere a mano (il messaggio parte
// su WhatsApp); gli altri vedono solo la propria. I permessi li impone il
// database (RLS su whatsapp_messaggi e le funzioni alberto_whatsapp_*): questa
// pagina non filtra niente da sola.
//
// Dati:
//   rpc  alberto_whatsapp_conversazioni()          → elenco conversazioni visibili
//   from whatsapp_messaggi (RLS)                   → messaggi della persona scelta
//   rpc  alberto_whatsapp_rispondi(p_membro, p_testo) → risposta a mano (solo admin)
// ─────────────────────────────────────────────────────────────────────────────

interface Conversazione {
  membro: string;
  ultimo_at: string;
  ultimo_testo: string | null;
  non_risposti: number;
  messaggi: number;
}

interface AzioneTask { id: string; id_display?: string; cosa?: string; per?: string; scadenza?: string | null }
interface AzioneEvento { id: string; titolo?: string; data?: string; ora?: string }
interface AzioneLog { testo?: string; rpc?: string; task_id?: string }
interface AzioneMessaggio {
  task?: AzioneTask[];
  eventi?: AzioneEvento[];
  azioni?: AzioneLog[];
  errore?: string;
  comando?: boolean;
  risposta_manuale?: boolean;
  da?: string;
}

interface Messaggio {
  id: string;
  direzione: 'entrata' | 'uscita' | 'azione';
  testo: string | null;
  stato: string;
  errore: string | null;
  template_nome: string | null;
  created_at: string;
  azione: AzioneMessaggio | null;
}

export interface AlbertoWhatsappTabProps {
  /** Elisa e Giovanni: vedono tutte le conversazioni e possono rispondere. */
  isAdmin: boolean;
  /** Nome del membro loggato (es. «Luca»): è la conversazione che vedono i non admin. */
  membro: string;
  /** Apre il task nel Kanban (l'app decide come). Se manca, il chip non è cliccabile. */
  onApriTask?: (taskId: string) => void;
  /** Apre l'evento nel calendario. */
  onApriEvento?: (eventoId: string) => void;
}

const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const GIORNO = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'numeric' });

function quando(iso: string): string {
  const d = new Date(iso);
  const oggi = GIORNO.format(new Date());
  const g = GIORNO.format(d);
  return g === oggi ? ORA.format(d) : `${g} ${ORA.format(d)}`;
}

function etichettaStato(m: Messaggio): { testo: string; tono: 'ok' | 'attesa' | 'errore' | 'neutro' } {
  if (m.direzione === 'entrata') {
    const eta = Date.now() - Date.parse(m.created_at);
    if (m.stato === 'risposto') return { testo: 'Risposto', tono: 'ok' };
    if (m.stato === 'letto') return eta > 120_000 ? { testo: 'Letto da Alberto, non ancora risposto', tono: 'attesa' } : { testo: 'Letto da Alberto', tono: 'neutro' };
    if (m.stato === 'ricevuto') return eta > 120_000 ? { testo: 'Non ancora elaborato', tono: 'errore' } : { testo: 'Ricevuto', tono: 'neutro' };
    return { testo: m.stato, tono: 'neutro' };
  }
  if (m.stato === 'fallito') return { testo: `Non consegnato${m.errore ? `: ${m.errore}` : ''}`, tono: 'errore' };
  return { testo: m.stato === 'consegnato' ? 'Consegnato' : 'Inviato', tono: 'ok' };
}

const TONO: Record<string, string> = {
  ok: 'text-emerald-500',
  attesa: 'text-amber-500',
  errore: 'text-red-500',
  neutro: 'text-muted-foreground',
};

export function AlbertoWhatsappTab({ isAdmin, membro, onApriTask, onApriEvento }: AlbertoWhatsappTabProps) {
  const [conversazioni, setConversazioni] = useState<Conversazione[]>([]);
  const [scelto, setScelto] = useState<string | null>(isAdmin ? null : membro);
  const [messaggi, setMessaggi] = useState<Messaggio[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [testo, setTesto] = useState('');
  const [invio, setInvio] = useState(false);
  const [esitoInvio, setEsitoInvio] = useState<string | null>(null);
  const fondo = useRef<HTMLDivElement | null>(null);

  const caricaConversazioni = useCallback(async () => {
    const { data, error } = await supabase.rpc('alberto_whatsapp_conversazioni');
    if (error) { setErrore(error.message); return; }
    const lista = ((data ?? []) as unknown as Conversazione[]);
    setConversazioni(lista);
    setScelto((corrente) => corrente ?? lista[0]?.membro ?? (isAdmin ? null : membro));
  }, [isAdmin, membro]);

  const caricaMessaggi = useCallback(async (nome: string) => {
    const { data, error } = await supabase
      .from('whatsapp_messaggi')
      .select('id, direzione, testo, stato, errore, template_nome, created_at, azione')
      .eq('membro', nome)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { setErrore(error.message); return; }
    setErrore(null);
    setMessaggi(([...(data ?? [])] as unknown as Messaggio[]).reverse());
  }, []);

  // Elenco conversazioni + aggiornamento ogni 10 secondi.
  useEffect(() => {
    let vivo = true;
    (async () => { await caricaConversazioni(); if (vivo) setCaricamento(false); })();
    const t = setInterval(caricaConversazioni, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, [caricaConversazioni]);

  // Messaggi della persona scelta: subito, ogni 10 secondi e in tempo reale (se il canale è attivo).
  useEffect(() => {
    if (!scelto) { setMessaggi([]); return; }
    caricaMessaggi(scelto);
    const t = setInterval(() => caricaMessaggi(scelto), 10_000);
    const canale = supabase
      .channel(`alberto-whatsapp-${scelto}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messaggi', filter: `membro=eq.${scelto}` }, () => caricaMessaggi(scelto))
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(canale); };
  }, [scelto, caricaMessaggi]);

  useEffect(() => { fondo.current?.scrollIntoView({ block: 'end' }); }, [messaggi.length, scelto]);

  const bolle = useMemo(() => messaggi.filter((m) => m.direzione !== 'azione'), [messaggi]);

  // Finestra gratuita di WhatsApp: 24 ore dall'ultimo messaggio della persona.
  const finestra = useMemo(() => {
    const ultimo = [...messaggi].reverse().find((m) => m.direzione === 'entrata');
    if (!ultimo) return null;
    const fine = Date.parse(ultimo.created_at) + 24 * 3600_000;
    return { aperta: fine > Date.now(), fine: new Date(fine).toISOString() };
  }, [messaggi]);

  async function invia() {
    if (!scelto || !testo.trim() || invio) return;
    setInvio(true);
    setEsitoInvio(null);
    const { data, error } = await supabase.rpc('alberto_whatsapp_rispondi', { p_membro: scelto, p_testo: testo.trim() });
    setInvio(false);
    const esito = (data ?? {}) as { ok?: boolean; errore?: string };
    if (error || !esito.ok) { setEsitoInvio(error?.message ?? esito.errore ?? 'Non è partito.'); return; }
    setTesto('');
    setEsitoInvio('Messaggio in invio…');
    setTimeout(() => { caricaMessaggi(scelto); setEsitoInvio(null); }, 4000);
  }

  if (caricamento) return <div className="p-6 text-sm text-muted-foreground">Carico le conversazioni…</div>;

  return (
    <div className="flex h-full min-h-[480px] flex-col gap-3 p-4 md:flex-row">
      {isAdmin && (
        <aside className="w-full shrink-0 overflow-y-auto rounded-lg border border-border bg-card md:w-72">
          <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">WhatsApp di Alberto</h2>
          {conversazioni.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nessuna conversazione.</p>}
          {conversazioni.map((c) => (
            <button
              key={c.membro}
              onClick={() => setScelto(c.membro)}
              className={`block w-full border-b border-border px-3 py-2 text-left hover:bg-muted ${scelto === c.membro ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c.membro}</span>
                {c.non_risposti > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-2 text-xs text-amber-600" title="Messaggi non ancora risposti">{c.non_risposti}</span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">{c.ultimo_testo}</div>
              <div className="text-[11px] text-muted-foreground">{quando(c.ultimo_at)}</div>
            </button>
          ))}
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{scelto ? `Conversazione con ${scelto}` : 'Scegli una conversazione'}</h2>
          {finestra && (
            <span className={`text-xs ${finestra.aperta ? 'text-emerald-500' : 'text-amber-500'}`}>
              {finestra.aperta
                ? `Finestra gratuita aperta fino alle ${ORA.format(new Date(finestra.fine))} del ${GIORNO.format(new Date(finestra.fine))}`
                : 'Finestra di 24 ore chiusa: i messaggi di Alberto partono solo come modello a pagamento (o per email)'}
            </span>
          )}
        </header>

        {errore && <div className="border-b border-border bg-red-500/10 px-3 py-2 text-xs text-red-500">{errore}</div>}

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {bolle.length === 0 && scelto && <p className="text-sm text-muted-foreground">Ancora nessun messaggio.</p>}
          {bolle.map((m) => {
            const stato = etichettaStato(m);
            const a = m.azione;
            const haAzioni = !!a && ((a.task?.length ?? 0) + (a.eventi?.length ?? 0) + (a.azioni?.length ?? 0) > 0 || a.errore);
            const uscita = m.direzione === 'uscita';
            return (
              <div key={m.id} className={`flex flex-col ${uscita ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${uscita ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {m.testo}
                </div>
                <div className={`mt-0.5 text-[11px] ${TONO[stato.tono]}`}>
                  {quando(m.created_at)} · {stato.testo}
                  {uscita && a?.risposta_manuale && a.da ? ` · scritto da ${a.da}` : ''}
                  {uscita && m.template_nome ? ' · modello' : ''}
                </div>

                {haAzioni && a && (
                  <div className="mt-1 max-w-[85%] space-y-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs">
                    <div className="font-medium text-muted-foreground">Cosa ha fatto Alberto</div>
                    {(a.task ?? []).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onApriTask?.(t.id)}
                        disabled={!onApriTask}
                        className="mr-1 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 enabled:hover:bg-emerald-500/20"
                        title="Apri il task nel Kanban"
                      >
                        📋 {t.id_display ?? 'Task'}{t.per ? ` · ${t.per}` : ''}{t.cosa ? ` — ${t.cosa}` : ''}
                      </button>
                    ))}
                    {(a.eventi ?? []).map((e) => (
                      <button
                        key={e.id}
                        onClick={() => onApriEvento?.(e.id)}
                        disabled={!onApriEvento}
                        className="mr-1 inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600 enabled:hover:bg-blue-500/20"
                        title="Apri l'evento nel calendario"
                      >
                        📅 {e.titolo ?? 'Evento'}{e.data ? ` · ${e.data}` : ''}{e.ora ? ` ${e.ora}` : ''}
                      </button>
                    ))}
                    {(a.azioni ?? []).map((x, i) => (
                      <div key={`${m.id}-${i}`} className="text-muted-foreground">
                        • {x.testo}
                        {x.task_id && onApriTask && (
                          <button className="ml-1 underline" onClick={() => onApriTask(x.task_id as string)}>apri</button>
                        )}
                      </div>
                    ))}
                    {a.errore && <div className="text-red-500">Non elaborato: {a.errore}</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={fondo} />
        </div>

        {isAdmin && scelto && (
          <footer className="border-t border-border p-3">
            <div className="flex gap-2">
              <textarea
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) invia(); }}
                placeholder={`Rispondi a ${scelto} su WhatsApp…`}
                rows={2}
                className="min-h-[44px] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={invia}
                disabled={invio || !testo.trim()}
                className="self-end rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {invio ? 'Invio…' : 'Invia'}
              </button>
            </div>
            {esitoInvio && <p className="mt-1 text-xs text-muted-foreground">{esitoInvio}</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">Cmd/Ctrl+Invio per inviare. Se la finestra di 24 ore è chiusa il testo va anche per email.</p>
          </footer>
        )}
      </section>
    </div>
  );
}

export default AlbertoWhatsappTab;
