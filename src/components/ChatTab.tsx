import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import type { TeamMember, ChatMessaggio, Task } from '../types';
import { Avatar } from './Avatar';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';

interface ChatTabProps {
  team: TeamMember[];
  clienti?: { id: string; nome: string }[];
}

interface ContattoPreview {
  membro: TeamMember;
  ultimoMsg: ChatMessaggio | null;
  nonLetti: number;
}

function formatOra(ts: string) {
  const d = new Date(ts);
  const oggi = new Date();
  const ieri = new Date(oggi);
  ieri.setDate(oggi.getDate() - 1);
  if (d.toDateString() === oggi.toDateString()) {
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  if (d.toDateString() === ieri.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function formatSeparatoreData(ts: string) {
  const d = new Date(ts);
  const oggi = new Date();
  const ieri = new Date(oggi);
  ieri.setDate(oggi.getDate() - 1);
  if (d.toDateString() === oggi.toDateString()) return 'Oggi';
  if (d.toDateString() === ieri.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ChatTab({ team }: ChatTabProps) {
  const { utente, addToast } = useApp();
  const [messaggi, setMessaggi] = useState<ChatMessaggio[]>([]);
  const [contattoAttivo, setContattoAttivo] = useState<TeamMember | null>(null);
  const [testo, setTesto] = useState('');
  const [invio, setInvio] = useState(false);
  const [contatti, setContatti] = useState<ContattoPreview[]>([]);
  const [creaTaskMsg, setCreaTaskMsg] = useState<ChatMessaggio | null>(null);
  const [taskDescrizione, setTaskDescrizione] = useState('');
  const [taskPriorita, setTaskPriorita] = useState<'🔴 Alta' | '🟡 Media' | '🟢 Bassa'>('🟡 Media');
  const [taskScadenza, setTaskScadenza] = useState('');
  const [salvandoTask, setSalvandoTask] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const altriMembri = team.filter(m => m.nome !== utente?.nome);

  // Carica tutti i messaggi che mi riguardano
  const caricaMessaggi = useCallback(async () => {
    if (!utente) return;
    const { data } = await supabase
      .from('chat_messaggi')
      .select('*')
      .or(`da.eq.${utente.nome},a.eq.${utente.nome}`)
      .order('created_at', { ascending: true });
    setMessaggi((data as ChatMessaggio[]) || []);
  }, [utente]);

  useEffect(() => {
    caricaMessaggi();
  }, [caricaMessaggi]);

  // Realtime subscription
  useEffect(() => {
    if (!utente) return;
    const channel = supabase
      .channel('chat-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messaggi' },
        (payload) => {
          const msg = payload.new as ChatMessaggio;
          // Solo messaggi che riguardano me
          if (msg.da === utente.nome || msg.a === utente.nome) {
            setMessaggi(prev => {
              if (prev.find(m => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            // Suono solo se sono il destinatario
            if (msg.da !== utente.nome) {
              sounds.messaggio();
              addToast(`💬 ${msg.da}: ${msg.testo.substring(0, 40)}${msg.testo.length > 40 ? '…' : ''}`, 'info');
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [utente, addToast]);

  // Aggiorna contatti con previews
  useEffect(() => {
    if (!utente) return;
    const previews: ContattoPreview[] = altriMembri.map(m => {
      const conv = messaggi.filter(
        msg => (msg.da === utente.nome && msg.a === m.nome) ||
               (msg.da === m.nome && msg.a === utente.nome)
      );
      const ultimoMsg = conv.length > 0 ? conv[conv.length - 1] : null;
      const nonLetti = conv.filter(msg => msg.da === m.nome && !msg.letto).length;
      return { membro: m, ultimoMsg, nonLetti };
    });
    // Ordina per ultimo messaggio
    previews.sort((a, b) => {
      if (!a.ultimoMsg && !b.ultimoMsg) return 0;
      if (!a.ultimoMsg) return 1;
      if (!b.ultimoMsg) return -1;
      return new Date(b.ultimoMsg.created_at).getTime() - new Date(a.ultimoMsg.created_at).getTime();
    });
    setContatti(previews);
  }, [messaggi, altriMembri, utente]);

  // Messaggi conversazione attiva
  const msgConversazione = contattoAttivo && utente
    ? messaggi.filter(
        m => (m.da === utente.nome && m.a === contattoAttivo.nome) ||
             (m.da === contattoAttivo.nome && m.a === utente.nome)
      )
    : [];

  // Scroll in fondo
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgConversazione.length, contattoAttivo]);

  // Marca come letti quando apri la conversazione
  useEffect(() => {
    if (!contattoAttivo || !utente) return;
    const nonLettiIds = messaggi
      .filter(m => m.da === contattoAttivo.nome && m.a === utente.nome && !m.letto)
      .map(m => m.id);
    if (nonLettiIds.length === 0) return;
    supabase
      .from('chat_messaggi')
      .update({ letto: true })
      .in('id', nonLettiIds)
      .then(() => {
        setMessaggi(prev =>
          prev.map(m => nonLettiIds.includes(m.id) ? { ...m, letto: true } : m)
        );
      });
  }, [contattoAttivo, utente]);

  // Invia messaggio
  async function invia() {
    if (!testo.trim() || !contattoAttivo || !utente || invio) return;
    setInvio(true);
    const nuovoMsg: Omit<ChatMessaggio, 'id' | 'created_at'> = {
      da: utente.nome,
      a: contattoAttivo.nome,
      testo: testo.trim(),
      tipo: 'messaggio',
      rif_task: '',
      letto: false,
    };
    const { data, error } = await supabase
      .from('chat_messaggi')
      .insert(nuovoMsg)
      .select()
      .single();
    if (!error && data) {
      setMessaggi(prev => [...prev, data as ChatMessaggio]);
    }
    setTesto('');
    setInvio(false);
    inputRef.current?.focus();
  }

  // Crea task da messaggio
  async function salvaTask() {
    if (!taskDescrizione.trim() || !creaTaskMsg || !utente) return;
    setSalvandoTask(true);
    const { data: taskData, error } = await supabase
      .from('task')
      .insert({
        descrizione: taskDescrizione.trim(),
        assegnato_a: creaTaskMsg.da === utente.nome ? creaTaskMsg.a : creaTaskMsg.da,
        assegnato_da: utente.nome,
        priorita: taskPriorita,
        scadenza: taskScadenza || null,
        stato: 'Da fare',
        tipo: 'chat',
        note: `Da messaggio chat di ${creaTaskMsg.da}: "${creaTaskMsg.testo}"`,
      })
      .select()
      .single();

    if (!error && taskData) {
      sounds.nuovoTask();
      // Manda messaggio di riferimento
      await supabase.from('chat_messaggi').insert({
        da: utente.nome,
        a: creaTaskMsg.da === utente.nome ? creaTaskMsg.a : creaTaskMsg.da,
        testo: `📋 Task creato: "${taskDescrizione.trim()}"`,
        tipo: 'task-ref',
        rif_task: (taskData as Task).id_display || (taskData as Task).id,
        letto: false,
      });
      await caricaMessaggi();
      addToast('✅ Task creato dalla chat!', 'success');
      setCreaTaskMsg(null);
      setTaskDescrizione('');
      setTaskScadenza('');
      setTaskPriorita('🟡 Media');
    } else {
      sounds.errore();
      addToast('Errore creazione task', 'error');
    }
    setSalvandoTask(false);
  }

  // Raggruppa messaggi per data (separatori)
  const msgConSeparatori = React.useMemo(() => {
    const result: Array<{ tipo: 'separatore'; data: string } | { tipo: 'msg'; msg: ChatMessaggio }> = [];
    let ultimaData = '';
    for (const m of msgConversazione) {
      const dataMsg = new Date(m.created_at).toDateString();
      if (dataMsg !== ultimaData) {
        result.push({ tipo: 'separatore', data: formatSeparatoreData(m.created_at) });
        ultimaData = dataMsg;
      }
      result.push({ tipo: 'msg', msg: m });
    }
    return result;
  }, [msgConversazione]);

  if (!utente) return null;

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      {/* ── Sidebar contatti ── */}
      <div
        className="w-72 flex-shrink-0 flex flex-col border-r overflow-hidden"
        style={{
          background: 'hsl(var(--card))',
          borderColor: 'hsl(var(--border))',
        }}
      >
        {/* Header sidebar */}
        <div
          className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <span className="text-lg">💬</span>
          <span className="font-bold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Chat Team</span>
          {contatti.reduce((acc, c) => acc + c.nonLetti, 0) > 0 && (
            <span
              className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
            >
              {contatti.reduce((acc, c) => acc + c.nonLetti, 0)}
            </span>
          )}
        </div>

        {/* Lista contatti */}
        <div className="flex-1 overflow-y-auto">
          {contatti.length === 0 && (
            <p className="text-xs text-center py-8 opacity-40" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Nessun membro nel team
            </p>
          )}
          {contatti.map(({ membro, ultimoMsg, nonLetti }) => {
            const attivo = contattoAttivo?.id === membro.id;
            return (
              <button
                key={membro.id}
                onClick={() => setContattoAttivo(membro)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 border-b"
                style={{
                  background: attivo ? 'hsl(var(--muted))' : 'transparent',
                  borderColor: 'hsl(var(--border))',
                  borderBottomWidth: 1,
                }}
              >
                <div className="relative flex-shrink-0">
                  <Avatar nome={membro.nome} colore={membro.colore} size={42} />
                  {nonLetti > 0 && (
                    <span
                      className="absolute -top-1 -right-1 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full"
                      style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                    >
                      {nonLetti > 9 ? '9+' : nonLetti}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="text-sm font-semibold truncate"
                      style={{ color: 'hsl(var(--skorpio-text-primary))' }}
                    >
                      {membro.nome}
                    </span>
                    {ultimoMsg && (
                      <span
                        className="text-xs flex-shrink-0"
                        style={{ color: 'hsl(var(--muted-foreground))' }}
                      >
                        {formatOra(ultimoMsg.created_at)}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs truncate mt-0.5"
                    style={{
                      color: nonLetti > 0 ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                      fontWeight: nonLetti > 0 ? 600 : 400,
                    }}
                  >
                    {ultimoMsg
                      ? `${ultimoMsg.da === utente.nome ? 'Tu: ' : ''}${ultimoMsg.testo}`
                      : <span className="opacity-40 italic">Nessun messaggio</span>
                    }
                  </p>
                  {membro.label && (
                    <span
                      className="text-xs mt-0.5 inline-block"
                      style={{ color: membro.colore, opacity: 0.8 }}
                    >
                      {membro.label}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Area chat principale ── */}
      {!contattoAttivo ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-40">
          <span className="text-5xl">💬</span>
          <p className="text-sm font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Seleziona un membro per chattare
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header chat */}
          <div
            className="px-5 py-3 border-b flex items-center gap-3 flex-shrink-0"
            style={{
              background: 'hsl(var(--card))',
              borderColor: 'hsl(var(--border))',
            }}
          >
            <Avatar nome={contattoAttivo.nome} colore={contattoAttivo.colore} size={38} />
            <div>
              <p className="font-bold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                {contattoAttivo.nome}
              </p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {contattoAttivo.ruolo} · {contattoAttivo.label}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span
                className="text-xs px-2 py-1 rounded-full"
                style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
              >
                🔴 LIVE
              </span>
            </div>
          </div>

          {/* Bolle messaggi */}
          <div
            className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1"
            style={{ background: 'hsl(var(--skorpio-bg))' }}
          >
            {msgConSeparatori.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 opacity-30 my-auto">
                <span className="text-4xl">🦂</span>
                <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Inizia la conversazione…
                </p>
              </div>
            )}

            {msgConSeparatori.map((item, i) => {
              if (item.tipo === 'separatore') {
                return (
                  <div key={`sep-${i}`} className="flex items-center gap-3 my-3">
                    <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: 'hsl(var(--muted))',
                        color: 'hsl(var(--muted-foreground))',
                      }}
                    >
                      {item.data}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
                  </div>
                );
              }

              const msg = item.msg;
              const isMio = msg.da === utente.nome;
              const isTaskRef = msg.tipo === 'task-ref';

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 group ${isMio ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {!isMio && (
                    <div className="flex-shrink-0 mb-1">
                      <Avatar nome={msg.da} colore={contattoAttivo.colore} size={28} />
                    </div>
                  )}

                  <div className={`flex flex-col max-w-[65%] ${isMio ? 'items-end' : 'items-start'}`}>
                    <div
                      className="px-3 py-2 rounded-2xl text-sm leading-relaxed relative"
                      style={{
                        background: isTaskRef
                          ? isMio ? 'hsl(var(--primary) / 0.15)' : 'hsl(142 71% 45% / 0.12)'
                          : isMio
                          ? 'hsl(var(--primary))'
                          : 'hsl(var(--card))',
                        color: isTaskRef
                          ? 'hsl(var(--foreground))'
                          : isMio
                          ? 'hsl(var(--primary-foreground))'
                          : 'hsl(var(--foreground))',
                        borderRadius: isMio
                          ? '18px 18px 4px 18px'
                          : '18px 18px 18px 4px',
                        boxShadow: '0 1px 2px hsl(var(--foreground) / 0.06)',
                        border: isTaskRef
                          ? `1px solid hsl(${isMio ? 'var(--primary)' : '142 71% 45%'} / 0.3)`
                          : isMio
                          ? 'none'
                          : '1px solid hsl(var(--border))',
                      }}
                    >
                      {isTaskRef && <span className="block text-xs font-bold mb-1 opacity-70">📋 Task creato</span>}
                      {msg.testo}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 px-1">
                      <span
                        className="text-xs"
                        style={{ color: 'hsl(var(--muted-foreground))' }}
                      >
                        {new Date(msg.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isMio && (
                        <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {msg.letto ? '✓✓' : '✓'}
                        </span>
                      )}

                      {/* Bottone crea task — solo su messaggi ricevuti non-task */}
                      {!isMio && !isTaskRef && (
                        <button
                          onClick={() => {
                            setCreaTaskMsg(msg);
                            setTaskDescrizione(msg.testo);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: 'hsl(var(--muted))',
                            color: 'hsl(var(--muted-foreground))',
                          }}
                          title="Crea task da questo messaggio"
                        >
                          📋 Task
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Form crea task da messaggio */}
          {creaTaskMsg && (
            <div
              className="mx-4 mb-2 p-4 rounded-xl border"
              style={{
                background: 'hsl(142 71% 45% / 0.06)',
                borderColor: 'hsl(142 71% 45% / 0.25)',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold" style={{ color: 'hsl(142 71% 35%)' }}>
                  📋 Crea Task da Messaggio
                </p>
                <button
                  onClick={() => setCreaTaskMsg(null)}
                  className="text-xs opacity-50 hover:opacity-100"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2 p-2 rounded-lg text-xs italic"
                style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                💬 "{creaTaskMsg.testo.substring(0, 80)}{creaTaskMsg.testo.length > 80 ? '…' : ''}"
              </div>
              <textarea
                className="w-full text-sm px-3 py-2 rounded-lg border resize-none outline-none mb-2"
                style={{
                  background: 'hsl(var(--background))',
                  borderColor: 'hsl(var(--border))',
                  color: 'hsl(var(--foreground))',
                }}
                rows={2}
                placeholder="Descrizione task…"
                value={taskDescrizione}
                onChange={e => setTaskDescrizione(e.target.value)}
              />
              <div className="flex gap-2 mb-3">
                <select
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border outline-none"
                  style={{
                    background: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--border))',
                    color: 'hsl(var(--foreground))',
                  }}
                  value={taskPriorita}
                  onChange={e => setTaskPriorita(e.target.value as typeof taskPriorita)}
                >
                  <option value="🔴 Alta">🔴 Alta</option>
                  <option value="🟡 Media">🟡 Media</option>
                  <option value="🟢 Bassa">🟢 Bassa</option>
                </select>
                <input
                  type="date"
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border outline-none"
                  style={{
                    background: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--border))',
                    color: 'hsl(var(--foreground))',
                  }}
                  value={taskScadenza}
                  onChange={e => setTaskScadenza(e.target.value)}
                />
              </div>
              <p className="text-xs mb-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                📌 Assegnato a: <strong>{creaTaskMsg.da === utente.nome ? creaTaskMsg.a : creaTaskMsg.da}</strong>
              </p>
              <button
                onClick={salvaTask}
                disabled={salvandoTask || !taskDescrizione.trim()}
                className="w-full py-2 rounded-lg text-sm font-bold transition-opacity disabled:opacity-50"
                style={{
                  background: 'hsl(142 71% 45%)',
                  color: 'white',
                }}
              >
                {salvandoTask ? '⏳ Creando…' : '✅ Crea Task'}
              </button>
            </div>
          )}

          {/* Input messaggio */}
          <div
            className="px-4 py-3 border-t flex items-end gap-3 flex-shrink-0"
            style={{
              background: 'hsl(var(--card))',
              borderColor: 'hsl(var(--border))',
            }}
          >
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                className="w-full text-sm px-4 py-2.5 rounded-full border outline-none transition-shadow"
                style={{
                  background: 'hsl(var(--muted))',
                  borderColor: 'hsl(var(--border))',
                  color: 'hsl(var(--foreground))',
                }}
                placeholder={`Scrivi a ${contattoAttivo.nome}…`}
                value={testo}
                onChange={e => setTesto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invia(); } }}
                disabled={invio}
              />
            </div>
            <button
              onClick={invia}
              disabled={invio || !testo.trim()}
              className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-40 active:scale-95"
              style={{
                background: testo.trim() ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                color: testo.trim() ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
              title="Invia (Enter)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
