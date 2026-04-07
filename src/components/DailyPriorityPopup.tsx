import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Task, TeamMember } from '../types';

interface DailyPriorityPopupProps {
  utente: TeamMember;
  onClose: () => void;
  onTaskClick?: (task: Task) => void;
}

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getTargetDate(scadenza: string, ora: string | null): Date {
  const d = parseLocalDate(scadenza);
  if (ora) { const [h, m] = ora.split(':').map(Number); d.setHours(h, m, 0, 0); }
  else { d.setHours(23, 59, 59, 0); }
  return d;
}

function LiveCountdown({ scadenza, ora }: { scadenza: string; ora: string | null }) {
  const [diff, setDiff] = useState(() => getTargetDate(scadenza, ora).getTime() - Date.now());
  useEffect(() => { const id = setInterval(() => setDiff(getTargetDate(scadenza, ora).getTime() - Date.now()), 60000); return () => clearInterval(id); }, [scadenza, ora]);
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000), h = Math.floor((abs % 86400000) / 3600000), m = Math.floor((abs % 3600000) / 60000);
  const isScaduto = diff <= 0;
  const text = isScaduto ? (d > 0 ? `da ${d}g ${h}h` : `da ${h}h ${m}min`) : d > 7 ? `${d}gg` : d >= 1 ? `${d}g ${h}h` : h >= 1 ? `${h}h ${m}min` : `${m}min`;
  const level = isScaduto ? 'scaduto' : d > 7 ? 'ok' : d >= 1 ? 'warn' : 'urgent';
  const styles: Record<string, { bg: string; c: string; label: string }> = {
    ok:      { bg: 'hsl(214 80% 55%/0.1)',  c: 'hsl(214 70% 44%)',  label: 'SCADE TRA' },
    warn:    { bg: 'hsl(38 92% 50%/0.12)',  c: 'hsl(32 95% 35%)',   label: 'IN SCADENZA' },
    urgent:  { bg: 'hsl(0 80% 55%/0.12)',   c: 'hsl(0 70% 42%)',    label: 'URGENTE' },
    scaduto: { bg: 'hsl(0 80% 55%/0.14)',   c: 'hsl(0 70% 38%)',    label: 'SCADUTO' },
  };
  const s = styles[level];
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex-shrink-0${level === 'urgent' ? ' animate-pulse' : ''}`}
      style={{ background: s.bg, color: s.c }}>
      <span className="uppercase" style={{ fontSize: 9 }}>{s.label}</span>
      <span className="font-mono tabular-nums">{text}</span>
    </div>
  );
}

export function DailyPriorityPopup({ utente, onClose, onTaskClick }: DailyPriorityPopupProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);
  const [isEvening, setIsEvening] = useState(false);

  const loadPriorities = useCallback(async () => {
    const now = new Date();
    const isMorning = now.getHours() < 17;
    setIsEvening(!isMorning);

    // 1. Fetch manually assigned priorities from Elisa/Admin
    const { data: manualPrios } = await supabase
      .from('daily_priorities')
      .select('task_id, nota, show_morning, show_evening, creato_da')
      .eq('assegnato_a', utente.nome)
      .eq('attivo', true);

    const manualTaskIds = new Set<string>();
    const manualNotes: Record<string, string> = {};
    const manualCreators: Record<string, string> = {};
    if (manualPrios) {
      manualPrios
        .filter(p => isMorning ? p.show_morning : p.show_evening)
        .forEach(p => { manualTaskIds.add(p.task_id); manualNotes[p.task_id] = p.nota || ''; manualCreators[p.task_id] = p.creato_da; });
    }

    // 2. Fetch all tasks for this user
    const { data } = await supabase
      .from('task')
      .select('*')
      .eq('assegnato_a', utente.nome)
      .neq('stato', 'Archiviato')
      .order('scadenza', { ascending: true, nullsFirst: false });

    if (!data) { setLoading(false); return; }

    // Carica anche le date pubblicazione CLP
    const contenutoIds = [...new Set(data.filter(t => t.id_contenuto).map(t => t.id_contenuto))];
    let pubDates: Record<string, { data: string | null; ora: string | null }> = {};
    if (contenutoIds.length > 0) {
      const { data: clps } = await supabase
        .from('contenuti')
        .select('id, data_pubblicazione, ora_pubblicazione')
        .in('id', contenutoIds);
      if (clps) {
        clps.forEach(c => { pubDates[c.id] = { data: c.data_pubblicazione, ora: c.ora_pubblicazione }; });
      }
    }

    // Filtra e ordina per urgenza
    const now2 = Date.now();
    const scored = data
      .filter(t => t.stato !== 'Completato')
      .map(t => {
        let ms = Infinity;
        if (t.scadenza) ms = parseLocalDate(t.scadenza).getTime();
        else if (t.id_contenuto && pubDates[t.id_contenuto]?.data) ms = parseLocalDate(pubDates[t.id_contenuto].data!).getTime();

        const isScaduto = ms < now2;
        const diffDays = (ms - now2) / 86400000;
        let score = 100; // default: no date
        if (isScaduto) score = -10; // scaduto = massima urgenza
        else if (diffDays <= 1) score = 0;
        else if (diffDays <= 3) score = 10;
        else if (diffDays <= 7) score = 20;
        else if (diffDays <= 14) score = 30;
        else score = 50;

        // Boost per priorità alta
        if (t.priorita === '🔴 Alta') score -= 5;

        // Boost per priorità assegnate manualmente da admin
        const isManual = manualTaskIds.has(t.id);
        if (isManual) score = -20;

        return { ...t, _score: score, _ms: ms, _isScaduto: isScaduto, _diffDays: diffDays, _pubData: t.id_contenuto ? pubDates[t.id_contenuto]?.data : null, _isManual: isManual, _manualNote: manualNotes[t.id] || '', _manualCreator: manualCreators[t.id] || '' };
      })
      .sort((a, b) => a._score - b._score || a._ms - b._ms)
      .slice(0, 10); // max 10 task

    // Per la sera: mostra anche i completati di oggi
    if (now.getHours() >= 17) {
      const todayStr = now.toISOString().slice(0, 10);
      const { data: completedToday } = await supabase
        .from('task')
        .select('*')
        .eq('assegnato_a', utente.nome)
        .eq('stato', 'Completato')
        .gte('updated_at', todayStr + 'T00:00:00')
        .lte('updated_at', todayStr + 'T23:59:59');

      if (completedToday) {
        completedToday.forEach(t => {
          if (!scored.find(s => s.id === t.id)) {
            scored.push({ ...t, _score: 200, _ms: Infinity, _isScaduto: false, _diffDays: 0, _pubData: null } as any);
          }
        });
      }
    }

    setTasks(scored as any);
    setLoading(false);
  }, [utente.nome]);

  useEffect(() => { loadPriorities(); }, [loadPriorities]);

  const handleToggle = async (taskId: string, currentStato: string) => {
    setCompleting(taskId);
    const newStato = currentStato === 'Completato' ? 'Da fare' : 'Completato';
    await supabase.from('task').update({ stato: newStato }).eq('id', taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, stato: newStato } : t));
    setCompleting(null);
  };

  const getCountdownLabel = (t: any) => {
    if (t._ms === Infinity) return null;
    if (t._isScaduto) {
      const days = Math.abs(Math.floor(t._diffDays));
      return { text: 'SCADUTO da ' + days + 'g', color: '#EF4444', bg: '#FEF2F2' };
    }
    if (t._diffDays <= 1) return { text: 'OGGI', color: '#D97706', bg: '#FEF3C7' };
    if (t._diffDays <= 3) return { text: Math.ceil(t._diffDays) + 'g', color: '#D97706', bg: '#FEF3C7' };
    if (t._diffDays <= 7) return { text: Math.ceil(t._diffDays) + 'g', color: '#6366F1', bg: '#EEF2FF' };
    return { text: Math.ceil(t._diffDays) + 'g', color: '#64748B', bg: '#F1F5F9' };
  };

  const pendingCount = tasks.filter(t => t.stato !== 'Completato').length;
  const completedCount = tasks.filter(t => t.stato === 'Completato').length;
  const greeting = isEvening
    ? 'Riepilogo giornata'
    : new Date().getHours() < 12 ? 'Buongiorno' : 'Buon pomeriggio';

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 99999, backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'hsl(var(--background))' }}>
        {/* Header */}
        <div className="p-5 relative" style={{ background: isEvening ? 'linear-gradient(135deg, #1E1B4B, #312E81)' : 'linear-gradient(135deg, #6C5CE7, #A29BFE)' }}>
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer" style={{ fontSize: 18 }}>✕</button>
          <p className="text-white/70 text-sm font-medium">{greeting}, {utente.nome.split(' ')[0]}</p>
          <h2 className="text-white text-xl font-bold mt-1">
            {isEvening ? 'Hai completato le tue priorita?' : 'Le tue priorita per oggi'}
          </h2>
          {isEvening && (
            <div className="flex gap-3 mt-3">
              <div className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(34,197,94,0.2)', color: '#86EFAC' }}>
                {completedCount} completati
              </div>
              <div className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: pendingCount > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)', color: pendingCount > 0 ? '#FCA5A5' : '#94A3B8' }}>
                {pendingCount} in sospeso
              </div>
            </div>
          )}
        </div>

        {/* Task list */}
        <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Caricamento...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🎉</div>
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Nessun task urgente!</p>
              <p className="text-xs text-muted-foreground mt-1">Sei in pari con tutto</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map(t => {
                const done = t.stato === 'Completato';
                return (
                  <div key={t.id}
                    className="flex items-center gap-3 p-3 rounded-xl transition-all"
                    style={{
                      background: done ? 'hsl(142 70% 45% / 0.06)' : 'hsl(var(--muted))',
                      opacity: done ? 0.6 : 1,
                      border: done ? '1px solid hsl(142 70% 45% / 0.2)' : '1px solid transparent',
                    }}>

                    {/* Checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(t.id, t.stato); }}
                      disabled={completing === t.id}
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
                      style={{
                        borderColor: done ? 'hsl(142 70% 45%)' : 'hsl(var(--border))',
                        background: done ? 'hsl(142 70% 45%)' : 'transparent',
                      }}>
                      {done && <span className="text-white text-xs">✓</span>}
                      {completing === t.id && <span className="text-xs">⏳</span>}
                    </button>

                    {/* Task info */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onTaskClick?.(t)}>
                      <div className="flex items-center gap-1.5">
                        {(t as any)._isManual && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: 'hsl(270 60% 55% / 0.15)', color: 'hsl(270 60% 55%)' }}>
                            PRIORITA
                          </span>
                        )}
                        <p className="text-sm font-medium truncate" style={{
                          color: 'hsl(var(--skorpio-text-primary))',
                          textDecoration: done ? 'line-through' : 'none',
                        }}>
                          {t.descrizione.length > 50 ? t.descrizione.slice(0, 50) + '...' : t.descrizione}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {t.cliente_nome && <span className="text-[10px] text-muted-foreground">{t.cliente_nome}</span>}
                        <span className="text-[10px] font-mono text-muted-foreground">{t.id_display}</span>
                        {(t as any)._manualCreator && <span className="text-[10px]" style={{ color: 'hsl(270 60% 55%)' }}>da {(t as any)._manualCreator}</span>}
                      </div>
                      {(t as any)._manualNote && (
                        <p className="text-[10px] mt-1 italic" style={{ color: 'hsl(38 80% 35%)' }}>
                          {(t as any)._manualNote}
                        </p>
                      )}
                    </div>

                    {/* Countdown */}
                    {!done && (t as any)._ms < Infinity && (
                      <LiveCountdown scadenza={(t as any)._pubData || t.scadenza || ''} ora={t.ora || null} />
                    )}
                    {done && (
                      <span className="text-[10px] font-bold flex-shrink-0" style={{ color: 'hsl(142 70% 45%)' }}>Fatto</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer"
            style={{ background: 'hsl(var(--primary))', color: 'white' }}>
            {isEvening
              ? (pendingCount > 0 ? 'Chiudi ('+pendingCount+' task ancora in sospeso)' : 'Ottimo lavoro! Chiudi')
              : 'Inizia la giornata'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Hook per gestire quando mostrare il popup ──────────────────────────
export function useDailyPopup(utente: TeamMember | null) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!utente) return;

    const key = 'skorpio_daily_' + utente.nome;
    const eveningKey = 'skorpio_evening_' + utente.nome;
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay(); // 0=dom, 6=sab

    // Solo lun-ven
    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    // Mattina (prima delle 17): mostra se non gia mostrato oggi
    if (hour < 17) {
      const lastShown = localStorage.getItem(key);
      if (lastShown !== today) {
        localStorage.setItem(key, today);
        setShow(true);
      }
    }
    // Sera (17+): mostra se non gia mostrato stasera
    else {
      const lastEvening = localStorage.getItem(eveningKey);
      if (lastEvening !== today) {
        localStorage.setItem(eveningKey, today);
        setShow(true);
      }
    }

    // Timer per popup delle 17:00 se aperto prima
    if (hour < 17) {
      const now = new Date();
      const fivePM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);
      const msUntil5 = fivePM.getTime() - now.getTime();
      if (msUntil5 > 0 && msUntil5 < 8 * 3600000) { // max 8 ore
        const timer = setTimeout(() => {
          const evKey = 'skorpio_evening_' + utente.nome;
          const td = new Date().toISOString().slice(0, 10);
          if (localStorage.getItem(evKey) !== td) {
            localStorage.setItem(evKey, td);
            setShow(true);
          }
        }, msUntil5);
        return () => clearTimeout(timer);
      }
    }
  }, [utente]);

  return { show, close: () => setShow(false) };
}
