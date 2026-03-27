import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { sounds } from '../lib/sounds';
import type { Task, TeamMember, Cliente } from '../types';
import { Avatar } from './Avatar';
import { TaskDetailPanel } from './TaskDetailPanel';
import { NuovoTaskModal } from './NuovoTaskModal';
import { parseLocalDate } from '../lib/dateUtils';
import { completaTaskEAvanzaFase } from '../lib/clpWorkflow';

// ─── Countdown ────────────────────────────────────────────────────────────────
function getTargetDate(scadenza: string, ora: string | null): Date {
  return new Date(`${scadenza}T${ora ? ora.slice(0, 5) : '23:59'}:00`);
}

function isScadenzaOggi(scadenza: string): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return scadenza === today;
}

function formatCountdownHuman(
  diff: number,
  scadenzaOggi = false,
  hasOra = false,
): { text: string; icon: string; level: 'ok' | 'warn' | 'urgent' | 'scaduto' } {
  if (diff <= 0) {
    const elapsed = Math.abs(diff);
    const d = Math.floor(elapsed / 86400000);
    const h = Math.floor((elapsed % 86400000) / 3600000);
    if (d > 0) return { text: `SCADUTO da ${d}g`, icon: '🔴', level: 'scaduto' };
    return { text: `SCADUTO da ${h}h`, icon: '🔴', level: 'scaduto' };
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 7) return { text: `📅 ${d} giorni`, icon: '📅', level: 'ok' };
  if (scadenzaOggi && !hasOra) return { text: `oggi · ${h}h ${m}min`, icon: '🔴', level: 'urgent' };
  if (d >= 1) return { text: `⏰ ${d}g ${h}h`, icon: '⏰', level: 'warn' };
  if (h >= 1) return { text: `🔴 ${h}h ${m}min`, icon: '🔴', level: 'urgent' };
  return { text: `🔴 ${m}min`, icon: '🔴', level: 'urgent' };
}

function LiveClock({ scadenza, ora }: { scadenza: string; ora: string | null }) {
  const [diff, setDiff] = useState(() => getTargetDate(scadenza, ora).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setDiff(getTargetDate(scadenza, ora).getTime() - Date.now());
    }, 60000);
    return () => clearInterval(id);
  }, [scadenza, ora]);

  const { text, level } = formatCountdownHuman(diff, isScadenzaOggi(scadenza), !!ora);

  const styles = {
    ok:      { bg: 'hsl(214 80% 55% / 0.10)', color: 'hsl(214 70% 44%)', border: 'hsl(214 80% 55% / 0.25)' },
    warn:    { bg: 'hsl(38 92% 50% / 0.12)',  color: 'hsl(32 95% 35%)',  border: 'hsl(38 92% 50% / 0.35)' },
    urgent:  { bg: 'hsl(0 80% 55% / 0.12)',   color: 'hsl(0 70% 42%)',   border: 'hsl(0 80% 55% / 0.40)' },
    scaduto: { bg: 'hsl(0 80% 55% / 0.14)',   color: 'hsl(0 70% 38%)',   border: 'hsl(0 80% 55% / 0.50)' },
  }[level];

  return (
    <div
      className={`mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold${level === 'urgent' ? ' animate-pulse' : ''}`}
      style={{ background: styles.bg, border: `1px solid ${styles.border}`, color: styles.color }}
    >
      <span className="uppercase tracking-wide" style={{ fontSize: '0.65rem' }}>
        {level === 'scaduto' ? 'SCADUTO' : level === 'urgent' ? 'URGENTE' : level === 'warn' ? 'IN SCADENZA' : 'SCADE TRA'}
      </span>
      <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem' }}>
        {text.replace(/^[🔴⏰📅]\s*/, '')}
      </span>
    </div>
  );
}

// ─── Colonne standard (task senza CLP) ───────────────────────────────────────
const COLONNE = [
  { stato: 'Da fare',       colore: '#F59E0B', bg: '#FFFBEB', border: '#F59E0B', icona: '📋' },
  { stato: 'In lavorazione', colore: '#3B82F6', bg: '#EFF6FF', border: '#3B82F6', icona: '⚡' },
  { stato: 'In revisione',  colore: '#8B5CF6', bg: '#F5F3FF', border: '#8B5CF6', icona: '🔍' },
  { stato: 'Completato',    colore: '#22C55E', bg: '#F0FDF4', border: '#22C55E', icona: '✅' },
  { stato: 'Non accettato', colore: '#EF4444', bg: '#FEF2F2', border: '#EF4444', icona: '❌' },
] as const;

// ─── Colonne workflow CLP ─────────────────────────────────────────────────────
// Ogni colonna = fase del CLP. Il task appare nella colonna corrispondente al suo tipo.
const COLONNE_CLP = [
  { stato: 'Girato',      tipo: 'Premontaggio',        colore: '#8B5CF6', bg: 'hsl(270 60% 97%)', border: '#8B5CF6', icona: '🎬', label: 'Girato — Premontaggio' },
  { stato: 'Pre montato', tipo: 'Montaggio',            colore: '#3B82F6', bg: 'hsl(214 80% 97%)', border: '#3B82F6', icona: '✂️', label: 'Pre montato — Montaggio' },
  { stato: 'Montato',     tipo: 'Upload esportato',     colore: '#F59E0B', bg: 'hsl(38 92% 97%)',  border: '#F59E0B', icona: '📤', label: 'Montato — Upload' },
  { stato: 'Caricato',    tipo: 'Revisione montaggio',  colore: '#EC4899', bg: 'hsl(328 80% 97%)', border: '#EC4899', icona: '🔍', label: 'Caricato — Revisione' },
  { stato: 'Revisionato', tipo: 'Programmazione',       colore: '#7C3AED', bg: 'hsl(263 70% 97%)', border: '#7C3AED', icona: '📅', label: 'Revisionato — Programmazione' },
  { stato: 'Programmato', tipo: '',                     colore: '#6D28D9', bg: 'hsl(263 60% 97%)', border: '#6D28D9', icona: '📡', label: 'Programmato' },
  { stato: 'Pubblicato',  tipo: '',                     colore: '#22C55E', bg: 'hsl(142 76% 97%)', border: '#22C55E', icona: '✅', label: 'Pubblicato' },
] as const;

const PRIORITA_COLOR: Record<string, string> = {
  '🔴 Alta': '#EF4444',
  '🟡 Media': '#F59E0B',
  '🟢 Bassa': '#22C55E',
};

// Mappa tipo task → info fase corrente (per badge nella card standard)
const TIPO_TO_FASE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  'Premontaggio':        { label: '🎬 Girato',       bg: 'hsl(270 60% 55% / 0.10)', color: 'hsl(270 50% 45%)', border: 'hsl(270 60% 55% / 0.30)' },
  'Montaggio':           { label: '✂️ Pre montato',   bg: 'hsl(214 80% 55% / 0.10)', color: 'hsl(214 70% 44%)', border: 'hsl(214 80% 55% / 0.28)' },
  'Revisione montaggio': { label: '🔍 Montato',       bg: 'hsl(25 90% 55% / 0.10)',  color: 'hsl(25 70% 40%)',  border: 'hsl(25 90% 55% / 0.28)'  },
  'Programmazione':      { label: '📅 Revisionato',   bg: 'hsl(328 80% 55% / 0.10)', color: 'hsl(328 65% 40%)', border: 'hsl(328 80% 55% / 0.28)' },
};

// Fase successiva per il drag CLP
const FASE_NEXT: Record<string, string> = {
  'Girato':      'Pre montato',
  'Pre montato': 'Montato',
  'Montato':     'Revisionato',
  'Revisionato': 'Programmato',
  'Programmato': 'Pubblicato',
};

// Tipo task che "vive" in quella colonna CLP
const TIPO_PER_FASE: Record<string, string> = {
  'Girato':      'Premontaggio',
  'Pre montato': 'Montaggio',
  'Montato':     'Revisione montaggio',
  'Revisionato': 'Programmazione',
};

function scadenzaInfo(task: Task): { label: string; colore: string; bg: string } | null {
  if (!task.scadenza) return null;
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const scad = parseLocalDate(task.scadenza); scad.setHours(0,0,0,0);
  const diff = Math.floor((scad.getTime() - oggi.getTime()) / 86400000);
  if (diff < 0) return { label: '⚠ SCADUTO', colore: '#EF4444', bg: '#FEF2F2' };
  if (diff === 0) return { label: '⏰ OGGI', colore: '#D97706', bg: '#FEF3C7' };
  if (diff === 1) return { label: '⏰ DOMANI', colore: '#D97706', bg: '#FEF3C7' };
  return { label: `📅 ${scad.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit' })}`, colore: '#64748B', bg: '#F1F5F9' };
}

// ─── Task card (condivisa tra le due board) ───────────────────────────────────
interface TaskCardProps {
  task: Task;
  team: TeamMember[];
  utente: TeamMember | null;
  isNew: boolean;
  draggingId: string | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  /** Se true, mostra il badge fase CLP (solo board standard) */
  showFaseBadge?: boolean;
}

function TaskCard({ task, team, utente, isNew, draggingId, onDragStart, onDragEnd, onClick, showFaseBadge = true }: TaskCardProps) {
  const scad = scadenzaInfo(task);
  const isScaduto = scad?.label.includes('SCADUTO');
  const member = team.find(m => m.nome === task.assegnato_a);
  const isAssignedToMe = task.assegnato_a === utente?.nome;
  const isAutoTask = task.assegnato_da?.includes('Sistema') || task.assegnato_da?.includes('⚡');

  return (
    <div
      key={task.id}
      className={`task-card ${draggingId === task.id ? 'dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        borderLeft: `3px solid ${PRIORITA_COLOR[task.priorita] || '#64748B'}`,
        ...(isScaduto ? { borderColor: '#EF4444' } : {}),
        ...(isNew ? {
          outline: '2px solid #3B82F6',
          outlineOffset: '1px',
          animation: 'taskHighlight 3s ease-out forwards',
        } : {}),
        ...(isAssignedToMe ? { boxShadow: '0 0 0 1px rgba(59,130,246,0.2)' } : {}),
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {isNew && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
            style={{ background: '#DBEAFE', color: '#1D4ED8' }}>
            NUOVO
          </span>
        )}
        {isAutoTask && (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded inline-block"
            style={{ background: 'hsl(38 92% 50% / 0.15)', color: 'hsl(32 95% 40%)' }}>
            ⚡ Auto
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 mb-2">
        <div
          className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
          style={{ backgroundColor: PRIORITA_COLOR[task.priorita] || '#64748B' }}
        />
        <p className="text-sm font-medium flex-1 leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
          {task.descrizione.length > 80 ? task.descrizione.slice(0, 80) + '…' : task.descrizione}
        </p>
      </div>

      <div className="flex items-center justify-between gap-1 mt-2">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            {task.id_display}
          </span>
          {showFaseBadge && task.tipo && (() => {
            const fase = TIPO_TO_FASE[task.tipo];
            return fase ? (
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ background: fase.bg, color: fase.color, border: `1px solid ${fase.border}` }}
              >
                {fase.label}
              </span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'hsl(210 40% 96%)', color: '#64748B' }}>
                {task.tipo}
              </span>
            );
          })()}
        </div>
        {member && <Avatar nome={member.nome} colore={member.colore} size={20} />}
      </div>

      {task.cliente_nome && (
        <p className="text-xs mt-1 truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
          👤 {task.cliente_nome.slice(0, 22)}
        </p>
      )}

      {task.scadenza ? (
        <LiveClock scadenza={task.scadenza} ora={task.ora} />
      ) : scad ? (
        <div
          className="inline-flex items-center text-xs px-1.5 py-0.5 rounded mt-1.5 font-medium"
          style={{ background: scad.bg, color: scad.colore }}
        >
          {scad.label}
          {task.ora && <span className="ml-1 opacity-70">{task.ora.slice(0, 5)}</span>}
        </div>
      ) : null}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface KanbanTabProps {
  team: TeamMember[];
  clienti: Cliente[];
  personaView: string | null;
}

interface RealtimeEvent {
  tipo: 'nuovo' | 'spostato' | 'completato';
  task: Task;
  fromStato?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function KanbanTab({ team, clienti, personaView }: KanbanTabProps) {
  const { utente, addToast } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNuovoTask, setShowNuovoTask] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [liveActive, setLiveActive] = useState(false);
  const [newTaskIds, setNewTaskIds] = useState<Set<string>>(new Set());
  const [filtraOggi, setFiltraOggi] = useState(false);
  const [boardMode, setBoardMode] = useState<'standard' | 'clp' | 'both'>('both');
  const [searchQuery, setSearchQuery] = useState('');
  const [clpFasi, setClpFasi] = useState<Record<string, string>>({});

  const pendingEventsRef = useRef<RealtimeEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMyAction = useRef(false);
  const tasksRef = useRef<Task[]>([]);

  const flushNotifications = useCallback(() => {
    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];
    if (events.length === 0) return;
    const assignedToMe = events.filter(e => e.task.assegnato_a === utente?.nome);
    const nuovi = events.filter(e => e.tipo === 'nuovo');
    const spostati = events.filter(e => e.tipo === 'spostato');
    const completati = events.filter(e => e.tipo === 'completato');
    if (assignedToMe.some(e => e.tipo === 'nuovo')) sounds.nuovoTask();
    else if (completati.length > 0) sounds.taskCompletato();
    else if (spostati.length > 0) sounds.messaggio();
    if (nuovi.length > 0) {
      const miei = nuovi.filter(e => e.task.assegnato_a === utente?.nome);
      if (miei.length > 0) {
        addToast(miei.length === 1 ? `📥 Nuovo task assegnato a te: "${miei[0].task.descrizione.slice(0, 40)}"` : `📥 ${miei.length} nuovi task assegnati a te`, 'success');
      } else {
        addToast(nuovi.length === 1 ? `📋 Nuovo task: "${nuovi[0].task.descrizione.slice(0, 40)}"` : `📋 ${nuovi.length} nuovi task aggiunti`, 'info');
      }
    }
    if (spostati.length > 0 && !isMyAction.current) {
      addToast(spostati.length === 1 ? `↕️ Task spostato → ${spostati[0].task.stato}` : `↕️ ${spostati.length} task spostati da un membro del team`, 'info');
    }
    if (completati.length > 0) {
      addToast(completati.length === 1 ? `✅ Task completato: "${completati[0].task.descrizione.slice(0, 35)}"` : `✅ ${completati.length} task completati`, 'success');
    }
    isMyAction.current = false;
  }, [utente, addToast]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushNotifications, 1500);
  }, [flushNotifications]);

  const loadTasks = useCallback(async () => {
    const [{ data: taskData }, { data: contenutiData }] = await Promise.all([
      supabase
        .from('task')
        .select('*')
        .neq('stato', 'Archiviato')
        .order('created_at', { ascending: false }),
      supabase
        .from('contenuti')
        .select('id, fase'),
    ]);

    const nextTasks = taskData || [];
    setTasks(nextTasks);
    tasksRef.current = nextTasks;
    setClpFasi(
      Object.fromEntries((contenutiData || []).map(contenuto => [contenuto.id, contenuto.fase || '']))
    );
    setLoading(false);

    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const scaduti = nextTasks.filter(t => {
      if (!t.scadenza) return false;
      const s = parseLocalDate(t.scadenza);
      return s < oggi && t.stato !== 'Completato';
    });
    if (scaduti.length > 0) sounds.alert();
  }, []);

  useEffect(() => {
    loadTasks();
    const channel = supabase
      .channel('kanban-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task' }, payload => {
        setLiveActive(true);
        setTimeout(() => setLiveActive(false), 800);
        if (payload.eventType === 'INSERT') {
          const newTask = payload.new as Task;
          setTasks(prev => {
            const next = prev.some(t => t.id === newTask.id) ? prev : [newTask, ...prev];
            tasksRef.current = next;
            return next;
          });
          setNewTaskIds(prev => new Set(prev).add(newTask.id));
          setTimeout(() => setNewTaskIds(prev => { const next = new Set(prev); next.delete(newTask.id); return next; }), 3000);
          pendingEventsRef.current.push({ tipo: 'nuovo', task: newTask });
          scheduleFlush();
          void loadTasks();
        } else if (payload.eventType === 'UPDATE') {
          const updatedTask = payload.new as Task;
          const prevTask = tasksRef.current.find(t => t.id === updatedTask.id);
          setTasks(prev => {
            const next = prev.map(t => t.id === updatedTask.id ? updatedTask : t);
            tasksRef.current = next;
            return next;
          });
          setSelectedTask(prev => prev?.id === updatedTask.id ? updatedTask : prev);
          if (updatedTask.stato === 'Completato' && prevTask?.stato !== 'Completato') {
            pendingEventsRef.current.push({ tipo: 'completato', task: updatedTask, fromStato: prevTask?.stato });
          } else if (prevTask && prevTask.stato !== updatedTask.stato) {
            pendingEventsRef.current.push({ tipo: 'spostato', task: updatedTask, fromStato: prevTask.stato });
          }
          scheduleFlush();
          void loadTasks();
        } else if (payload.eventType === 'DELETE') {
          setTasks(prev => {
            const next = prev.filter(t => t.id !== (payload.old as Task).id);
            tasksRef.current = next;
            return next;
          });
          void loadTasks();
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [loadTasks, scheduleFlush]);

  // ── Task standard (senza CLP) ───────────────────────────────────────────────
  const matchesSearch = (t: Task) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.descrizione.toLowerCase().includes(q) ||
      (t.cliente_nome || '').toLowerCase().includes(q) ||
      (t.id_display || '').toLowerCase().includes(q) ||
      (t.id_contenuto || '').toLowerCase().includes(q) ||
      (t.assegnato_a || '').toLowerCase().includes(q) ||
      (t.tipo || '').toLowerCase().includes(q)
    );
  };

  const filteredStandard = (stato: string) => {
    const now = Date.now();
    const in24h = now + 24 * 3600000;
    const filtered = tasks.filter(t => {
      if (t.stato !== stato) return false;
      if (t.id_contenuto && t.id_contenuto.trim() !== '') return false;
      if (personaView && t.assegnato_a !== personaView) return false;
      if (utente?.ruolo !== 'Admin' && t.assegnato_a !== utente?.nome) return false;
      if (!matchesSearch(t)) return false;
      if (filtraOggi) {
        if (!t.scadenza) return false;
        const ms = getTargetDate(t.scadenza, t.ora).getTime();
        if (ms > in24h || ms < now - 86400000) return false;
      }
      return true;
    });
    const score = (t: Task) => {
      if (!t.scadenza) return 2_000_000_000_000;
      const ms = getTargetDate(t.scadenza, t.ora).getTime();
      if (ms < Date.now()) return 3_000_000_000_000 + (Date.now() - ms);
      return ms;
    };
    return filtered.sort((a, b) => score(a) - score(b));
  };

  // ── Task CLP: mappa fase CLP → tipo task attivo ─────────────────────────────
  const filteredCLP = (faseCLP: string) => {
    const tipoColonna = TIPO_PER_FASE[faseCLP];
    return tasks.filter(t => {
      if (!t.id_contenuto || t.id_contenuto.trim() === '') return false;
      if (personaView && t.assegnato_a !== personaView) return false;
      if (utente?.ruolo !== 'Admin' && t.assegnato_a !== utente?.nome) return false;
      if (!matchesSearch(t)) return false;

      const faseReale = clpFasi[t.id_contenuto];
      if (!faseReale) return false;

      if (faseCLP === 'Programmato') {
        return faseReale === 'Programmato' && t.tipo === 'Programmazione' && t.stato !== 'Completato';
      }

      if (faseCLP === 'Pubblicato') {
        return faseReale === 'Pubblicato' && (t.tipo === 'Cleanup' || (t.stato === 'Completato' && t.tipo === 'Programmazione'));
      }

      return faseReale === faseCLP && tipoColonna === t.tipo && t.stato !== 'Completato';
    });
  };

  // ── Drag standard (stato → stato) ──────────────────────────────────────────
  const handleDropStandard = async (nuovoStato: string) => {
    if (!dragItem) return;
    setDropTarget(null);
    const task = tasks.find(t => t.id === dragItem);
    if (!task || task.stato === nuovoStato) return;
    if (utente?.ruolo !== 'Admin' && task.assegnato_a !== utente?.nome) {
      addToast('Non hai il permesso di spostare questo task', 'error');
      return;
    }
    isMyAction.current = true;
    setTasks(prev => prev.map(t => t.id === dragItem ? { ...t, stato: nuovoStato as Task['stato'] } : t));
    const { error } = await supabase.from('task').update({ stato: nuovoStato }).eq('id', dragItem);
    if (error) {
      sounds.errore();
      addToast('Errore nel salvataggio', 'error');
      isMyAction.current = false;
      loadTasks();
    } else if (nuovoStato === 'Completato') {
      sounds.taskCompletato();
      addToast('✅ Task completato!', 'success');
    } else {
      sounds.drop();
      addToast(`↕️ Spostato → ${nuovoStato}`, 'info');
    }
    setDragItem(null);
  };

  // ── Drag CLP (fase → fase successiva = completa task + avanza CLP) ──────────
  const handleDropCLP = async (faseCLP: string) => {
    if (!dragItem) return;
    setDropTarget(null);
    const task = tasks.find(t => t.id === dragItem);
    if (!task) return;
    if (utente?.ruolo !== 'Admin' && task.assegnato_a !== utente?.nome) {
      addToast('Non hai il permesso di spostare questo task', 'error');
      return;
    }
    // La colonna di destinazione deve essere la fase successiva
    const faseCorrente = Object.entries(TIPO_PER_FASE).find(([, tipo]) => tipo === task.tipo)?.[0];
    const fasePrevista = faseCorrente ? FASE_NEXT[faseCorrente] : null;
    if (fasePrevista && fasePrevista !== faseCLP) {
      addToast(`⚠️ Puoi spostare solo alla fase successiva: ${fasePrevista}`, 'warn');
      setDragItem(null);
      return;
    }
    if (!task.id_contenuto) return;

    isMyAction.current = true;
    addToast('⏳ Avanzamento in corso…', 'info');

    try {
      const nuovaFase = await completaTaskEAvanzaFase(
        task.tipo,
        task.id_contenuto,
        team,
        utente?.id
      );
      if (nuovaFase) {
        // Completa il task corrente localmente
        setTasks(prev => prev.map(t => t.id === dragItem ? { ...t, stato: 'Completato' } : t));
        sounds.taskCompletato();
        addToast(`✅ ${task.tipo} completato → ${nuovaFase}`, 'success');
        // Ricarica per avere il task successivo
        setTimeout(() => loadTasks(), 800);
      }
    } catch (e) {
      addToast('❌ Errore avanzamento', 'error');
    }
    setDragItem(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="sk-spinner" style={{ color: '#3B82F6' }} />
      </div>
    );
  }

  const showStandard = boardMode === 'standard' || boardMode === 'both';
  const showCLP = boardMode === 'clp' || boardMode === 'both';

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-lg" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            Kanban Board
          </h2>
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: liveActive ? '#DCFCE7' : '#F1F5F9', color: liveActive ? '#16A34A' : '#94A3B8', transition: 'all 0.3s' }}>
            <span className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: liveActive ? '#22C55E' : '#94A3B8', boxShadow: liveActive ? '0 0 0 3px #BBF7D0' : 'none', transition: 'all 0.3s' }} />
            LIVE
          </div>
          {/* Filtro oggi */}
          <button
            onClick={() => setFiltraOggi(f => !f)}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all"
            style={filtraOggi
              ? { background: '#FEE2E2', color: '#DC2626', border: '1px solid rgba(220,38,38,0.4)' }
              : { background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}
          >
            ⏰ In scadenza oggi {filtraOggi && '×'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>🔍</span>
            <input
              type="text"
              placeholder="Cerca task..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none transition-colors w-44"
              style={{
                background: 'hsl(var(--background))',
                borderColor: searchQuery ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >✕</button>
            )}
          </div>
          {/* Selector board */}
          <div className="flex rounded-lg overflow-hidden border border-border text-xs">
            {(['both', 'standard', 'clp'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setBoardMode(mode)}
                className="px-2.5 py-1 font-medium transition-colors"
                style={boardMode === mode
                  ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                  : { background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))' }}
              >
                {mode === 'both' ? 'Tutte' : mode === 'standard' ? 'Task' : '🎬 CLP'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowNuovoTask(true)} className="sk-btn-primary text-sm">
            + Nuovo Task
          </button>
        </div>
      </div>

      {/* Board CLP */}
      {showCLP && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--muted-foreground))' }}>
              🎬 Workflow Produzione CLP
            </span>
            <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
            <span className="text-[10px] text-muted-foreground italic">
              Trascina sulla colonna successiva per completare lo step
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {COLONNE_CLP.map(col => {
              const colTasks = filteredCLP(col.stato);
              const isDrop = dropTarget === `clp__${col.stato}`;
              return (
                <div
                  key={col.stato}
                  className={`kanban-col ${isDrop ? 'kanban-drop-target' : ''}`}
                  style={{ background: col.bg, border: `1px solid ${col.border}30`, minWidth: 180 }}
                  onDragOver={e => { e.preventDefault(); setDropTarget(`clp__${col.stato}`); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={() => handleDropCLP(col.stato)}
                >
                  <div className="kanban-col-header" style={{ borderBottom: `2px solid ${col.border}40` }}>
                    <div className="flex items-center gap-1.5">
                      <span>{col.icona}</span>
                      <span className="text-xs font-semibold" style={{ color: col.colore }}>{col.stato}</span>
                    </div>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${col.colore}20`, color: col.colore }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="kanban-col-body">
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        team={team}
                        utente={utente}
                        isNew={newTaskIds.has(task.id)}
                        draggingId={dragItem}
                        onDragStart={() => setDragItem(task.id)}
                        onDragEnd={() => setDragItem(null)}
                        onClick={() => setSelectedTask(task)}
                        showFaseBadge={false}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="flex items-center justify-center h-12 text-xs rounded-lg"
                        style={{ color: 'hsl(var(--muted-foreground))', border: `1px dashed ${col.border}40` }}>
                        Nessun task
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Board standard */}
      {showStandard && (
        <div>
          {boardMode === 'both' && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--muted-foreground))' }}>
                📋 Task generali
              </span>
              <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
            </div>
          )}
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLONNE.map(col => {
              const colTasks = filteredStandard(col.stato);
              return (
                <div
                  key={col.stato}
                  className={`kanban-col ${dropTarget === col.stato ? 'kanban-drop-target' : ''}`}
                  style={{ background: col.bg, border: `1px solid ${col.border}30` }}
                  onDragOver={e => { e.preventDefault(); setDropTarget(col.stato); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={() => handleDropStandard(col.stato)}
                >
                  <div className="kanban-col-header" style={{ borderBottom: `2px solid ${col.border}40` }}>
                    <div className="flex items-center gap-2">
                      <span>{col.icona}</span>
                      <span style={{ color: col.colore }}>{col.stato}</span>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${col.colore}20`, color: col.colore }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="kanban-col-body">
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        team={team}
                        utente={utente}
                        isNew={newTaskIds.has(task.id)}
                        draggingId={dragItem}
                        onDragStart={() => setDragItem(task.id)}
                        onDragEnd={() => setDragItem(null)}
                        onClick={() => setSelectedTask(task)}
                        showFaseBadge={true}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="flex items-center justify-center h-16 text-xs rounded-lg"
                        style={{ color: 'hsl(var(--skorpio-text-tertiary))', border: `1px dashed ${col.border}40` }}>
                        Nessun task
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          team={team}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            isMyAction.current = true;
            setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
            setSelectedTask(updated);
          }}
          onDelete={(id) => {
            setTasks(prev => prev.filter(t => t.id !== id));
            setSelectedTask(null);
          }}
        />
      )}

      {showNuovoTask && (
        <NuovoTaskModal
          team={team}
          clienti={clienti}
          utente={utente}
          onClose={() => setShowNuovoTask(false)}
          onCreated={(task) => {
            isMyAction.current = true;
            setTasks(prev => [task, ...prev]);
            addToast(`✅ Task ${task.id_display} creato`, 'success');
          }}
        />
      )}
    </div>
  );
}
