import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import type { TeamMember, ChatMessaggio, Task } from '../types';
import { Avatar } from './Avatar';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';

interface ChatPopupProps {
  team: TeamMember[];
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
  if (d.toDateString() === oggi.toDateString())
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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

export function ChatPopup({ team }: ChatPopupProps) {
  const { utente, addToast } = useApp();

  const [aperto, setAperto] = useState(false);
  const [messaggi, setMessaggi] = useState<ChatMessaggio[]>([]);
  const [contattoAttivo, setContattoAttivo] = useState<TeamMember | null>(null);
  const [testo, setTesto] = useState('');
  const [invio, setInvio] = useState(false);
  const [creaTaskMsg, setCreaTaskMsg] = useState<ChatMessaggio | null>(null);
  const [taskDescrizione, setTaskDescrizione] = useState('');
  const [taskPriorita, setTaskPriorita] = useState<'🔴 Alta' | '🟡 Media' | '🟢 Bassa'>('🟡 Media');
  const [taskScadenza, setTaskScadenza] = useState('');
  const [salvandoTask, setSalvandoTask] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Nomi degli altri membri — memo stabile su team
  const altriNomi = useMemo(() => team.filter(m => m.nome !== utente?.nome).map(m => m.nome), [team, utente?.nome]);

  // Carica messaggi
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

  // Realtime
  useEffect(() => {
    if (!utente) return;
    const channel = supabase
      .channel('chat-popup-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messaggi' },
        (payload) => {
          const msg = payload.new as ChatMessaggio;
          if (msg.da === utente.nome || msg.a === utente.nome) {
            setMessaggi(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
            if (msg.da !== utente.nome) {
              sounds.messaggio();
              if (!aperto) {
                addToast(`💬 ${msg.da}: ${msg.testo.substring(0, 45)}${msg.testo.length > 45 ? '…' : ''}`, 'info');
              }
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [utente, aperto, addToast]);

  // Contatti con preview — calcolati da messaggi (no useEffect separato)
  const contatti: ContattoPreview[] = useMemo(() => {
    if (!utente) return [];
    const altriMembri = team.filter(m => m.nome !== utente.nome);
    return altriMembri
      .map(m => {
        const conv = messaggi.filter(
          msg => (msg.da === utente.nome && msg.a === m.nome) ||
                 (msg.da === m.nome && msg.a === utente.nome)
        );
        const ultimoMsg = conv.length > 0 ? conv[conv.length - 1] : null;
        const nonLetti = conv.filter(msg => msg.da === m.nome && !msg.letto).length;
        return { membro: m, ultimoMsg, nonLetti };
      })
      .sort((a, b) => {
        if (!a.ultimoMsg && !b.ultimoMsg) return 0;
        if (!a.ultimoMsg) return 1;
        if (!b.ultimoMsg) return -1;
        return new Date(b.ultimoMsg.created_at).getTime() - new Date(a.ultimoMsg.created_at).getTime();
      });
  }, [messaggi, team, utente]);

  const totaleNonLetti = useMemo(() => contatti.reduce((acc, c) => acc + c.nonLetti, 0), [contatti]);

  // Messaggi conversazione attiva
  const msgConversazione = useMemo(() => {
    if (!contattoAttivo || !utente) return [];
    return messaggi.filter(
      m => (m.da === utente.nome && m.a === contattoAttivo.nome) ||
           (m.da === contattoAttivo.nome && m.a === utente.nome)
    );
  }, [messaggi, contattoAttivo, utente]);

  // Scroll in fondo
  useEffect(() => {
    if (aperto) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [msgConversazione.length, contattoAttivo, aperto]);

  // Marca come letti
  useEffect(() => {
    if (!contattoAttivo || !utente || !aperto) return;
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
  }, [contattoAttivo?.nome, aperto, utente]); // eslint-disable-line react-hooks/exhaustive-deps

  // Invia messaggio
  async function invia() {
    if (!testo.trim() || !contattoAttivo || !utente || invio) return;
    setInvio(true);
    const { data, error } = await supabase
      .from('chat_messaggi')
      .insert({ da: utente.nome, a: contattoAttivo.nome, testo: testo.trim(), tipo: 'messaggio', rif_task: '', letto: false })
      .select()
      .single();
    if (!error && data) setMessaggi(prev => [...prev, data as ChatMessaggio]);
    setTesto('');
    setInvio(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Crea task da messaggio
  async function salvaTask() {
    if (!taskDescrizione.trim() || !creaTaskMsg || !utente) return;
    setSalvandoTask(true);
    const assegnaA = creaTaskMsg.da === utente.nome ? creaTaskMsg.a : creaTaskMsg.da;
    const { data: taskData, error } = await supabase
      .from('task')
      .insert({
        descrizione: taskDescrizione.trim(),
        assegnato_a: assegnaA,
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
      await supabase.from('chat_messaggi').insert({
        da: utente.nome, a: assegnaA,
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

  // Separatori data
  const msgConSeparatori = useMemo(() => {
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
    <>
      {/* ── Bottone floating ── */}
      <button
        onClick={() => setAperto(v => !v)}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{
          background: aperto ? 'hsl(var(--foreground))' : 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
        }}
        title="Chat Team"
      >
        {aperto ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {totaleNonLetti > 0 && (
              <span
                className="absolute -top-1 -right-1 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full"
                style={{ background: 'hsl(0 84% 60%)', color: 'white', fontSize: 10 }}
              >
                {totaleNonLetti > 9 ? '9+' : totaleNonLetti}
              </span>
            )}
          </>
        )}
      </button>

      {/* ── Popup chat ── */}
      {aperto && (
        <div
          className="fixed bottom-24 right-5 z-50 flex shadow-2xl rounded-2xl overflow-hidden"
          style={{
            width: contattoAttivo ? 700 : 300,
            height: 520,
            border: '1px solid hsl(var(--border))',
            transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          {/* ── Sidebar contatti ── */}
          <div
            className="flex flex-col overflow-hidden flex-shrink-0"
            style={{
              width: 280,
              background: 'hsl(var(--card))',
              borderRight: '1px solid hsl(var(--border))',
            }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0"
              style={{
                background: 'hsl(var(--topbar-bg))',
                borderColor: 'hsl(var(--border))',
              }}
            >
              <span className="text-base">💬</span>
              <span className="font-bold text-sm text-white">Chat Team</span>
              {totaleNonLetti > 0 && (
                <span
                  className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'hsl(0 84% 60%)', color: 'white' }}
                >
                  {totaleNonLetti}
                </span>
              )}
            </div>

            {/* Lista contatti */}
            <div className="flex-1 overflow-y-auto">
              {contatti.length === 0 && (
                <p className="text-xs text-center py-8 opacity-40" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Nessun membro
                </p>
              )}
              {contatti.map(({ membro, ultimoMsg, nonLetti }) => {
                const attivo = contattoAttivo?.id === membro.id;
                return (
                  <button
                    key={membro.id}
                    onClick={() => setContattoAttivo(membro)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b"
                    style={{
                      background: attivo ? 'hsl(var(--muted))' : 'transparent',
                      borderColor: 'hsl(var(--border))',
                    }}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar nome={membro.nome} colore={membro.colore} size={38} />
                      {nonLetti > 0 && (
                        <span
                          className="absolute -top-1 -right-1 text-xs font-bold w-4 h-4 flex items-center justify-center rounded-full"
                          style={{ background: 'hsl(var(--primary))', color: 'white', fontSize: 9 }}
                        >
                          {nonLetti > 9 ? '9+' : nonLetti}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                          {membro.nome}
                        </span>
                        {ultimoMsg && (
                          <span className="text-xs flex-shrink-0 ml-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
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
                          : <em className="opacity-40">Nessun messaggio</em>
                        }
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Area chat ── */}
          {contattoAttivo && (
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
              {/* Header chat */}
              <div
                className="px-4 py-2.5 border-b flex items-center gap-3 flex-shrink-0"
                style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
              >
                <button
                  onClick={() => setContattoAttivo(null)}
                  className="text-xs opacity-40 hover:opacity-80 mr-1"
                  title="Torna ai contatti"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  ←
                </button>
                <Avatar nome={contattoAttivo.nome} colore={contattoAttivo.colore} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-xs truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                    {contattoAttivo.nome}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {contattoAttivo.label || contattoAttivo.ruolo}
                  </p>
                </div>
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{ background: 'hsl(142 71% 45% / 0.15)', color: 'hsl(142 71% 35%)' }}>
                  🔴 LIVE
                </span>
              </div>

              {/* Bolle */}
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-0.5">
                {msgConSeparatori.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 opacity-30">
                    <span className="text-3xl">🦂</span>
                    <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Inizia la conversazione…</p>
                  </div>
                )}
                {msgConSeparatori.map((item, i) => {
                  if (item.tipo === 'separatore') {
                    return (
                      <div key={`sep-${i}`} className="flex items-center gap-2 my-2">
                        <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
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
                    <div key={msg.id} className={`flex items-end gap-1.5 group mb-0.5 ${isMio ? 'flex-row-reverse' : 'flex-row'}`}>
                      {!isMio && (
                        <div className="flex-shrink-0 mb-1">
                          <Avatar nome={msg.da} colore={contattoAttivo.colore} size={22} />
                        </div>
                      )}
                      <div className={`flex flex-col max-w-[72%] ${isMio ? 'items-end' : 'items-start'}`}>
                        <div
                          className="px-3 py-1.5 text-xs leading-relaxed"
                          style={{
                            background: isTaskRef
                              ? isMio ? 'hsl(var(--primary) / 0.12)' : 'hsl(142 71% 45% / 0.10)'
                              : isMio ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                            color: isTaskRef
                              ? 'hsl(var(--foreground))'
                              : isMio ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                            borderRadius: isMio ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                            border: isTaskRef
                              ? `1px solid hsl(${isMio ? 'var(--primary)' : '142 71% 45%'} / 0.25)`
                              : isMio ? 'none' : '1px solid hsl(var(--border))',
                          }}
                        >
                          {isTaskRef && <span className="block text-xs font-bold mb-0.5 opacity-60">📋 Task</span>}
                          {msg.testo}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 px-1">
                          <span className="text-xs opacity-50" style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}>
                            {new Date(msg.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMio && (
                            <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
                              {msg.letto ? '✓✓' : '✓'}
                            </span>
                          )}
                          {!isMio && !isTaskRef && (
                            <button
                              onClick={() => { setCreaTaskMsg(msg); setTaskDescrizione(msg.testo); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-0.5 rounded"
                              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                              title="Crea task"
                            >
                              📋
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Form crea task */}
              {creaTaskMsg && (
                <div className="mx-3 mb-2 p-3 rounded-xl border text-xs"
                  style={{ background: 'hsl(142 71% 45% / 0.06)', borderColor: 'hsl(142 71% 45% / 0.25)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold" style={{ color: 'hsl(142 71% 35%)' }}>📋 Crea Task</span>
                    <button onClick={() => setCreaTaskMsg(null)} className="opacity-40 hover:opacity-80">✕</button>
                  </div>
                  <div className="italic mb-2 px-2 py-1 rounded" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                    "{creaTaskMsg.testo.substring(0, 60)}{creaTaskMsg.testo.length > 60 ? '…' : ''}"
                  </div>
                  <textarea
                    className="w-full px-2 py-1.5 rounded-lg border resize-none outline-none mb-2 text-xs"
                    style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    rows={2}
                    placeholder="Descrizione task…"
                    value={taskDescrizione}
                    onChange={e => setTaskDescrizione(e.target.value)}
                  />
                  <div className="flex gap-1.5 mb-2">
                    <select
                      className="flex-1 px-2 py-1 rounded border outline-none text-xs"
                      style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                      value={taskPriorita}
                      onChange={e => setTaskPriorita(e.target.value as typeof taskPriorita)}
                    >
                      <option value="🔴 Alta">🔴 Alta</option>
                      <option value="🟡 Media">🟡 Media</option>
                      <option value="🟢 Bassa">🟢 Bassa</option>
                    </select>
                    <input
                      type="date"
                      className="flex-1 px-2 py-1 rounded border outline-none text-xs"
                      style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                      value={taskScadenza}
                      onChange={e => setTaskScadenza(e.target.value)}
                    />
                  </div>
                  <p className="mb-2 opacity-60">📌 → <strong>{creaTaskMsg.da === utente.nome ? creaTaskMsg.a : creaTaskMsg.da}</strong></p>
                  <button
                    onClick={salvaTask}
                    disabled={salvandoTask || !taskDescrizione.trim()}
                    className="w-full py-1.5 rounded-lg font-bold transition-opacity disabled:opacity-50 text-xs"
                    style={{ background: 'hsl(142 71% 45%)', color: 'white' }}
                  >
                    {salvandoTask ? '⏳…' : '✅ Crea Task'}
                  </button>
                </div>
              )}

              {/* Input */}
              <div className="px-3 py-2.5 border-t flex items-center gap-2 flex-shrink-0"
                style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 text-xs px-3 py-2 rounded-full border outline-none"
                  style={{ background: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  placeholder={`Scrivi a ${contattoAttivo.nome}…`}
                  value={testo}
                  onChange={e => setTesto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invia(); } }}
                  disabled={invio}
                />
                <button
                  onClick={invia}
                  disabled={invio || !testo.trim()}
                  className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-40 active:scale-95"
                  style={{
                    background: testo.trim() ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                    color: testo.trim() ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
