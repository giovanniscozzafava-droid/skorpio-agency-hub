/**
 * KanbanTab — RISCRITTO DA ZERO
 * Principio: DB è l'unica fonte di verità.
 * Ogni azione → scrivi sul DB → loadTasks() → render.
 * Realtime → loadTasks(). Fine.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { sounds } from '../lib/sounds';
import type { Task, TeamMember, Cliente } from '../types';
import { Avatar } from './Avatar';
import { ClienteLogo } from './ClienteLogo';
import { TaskDetailPanel } from './TaskDetailPanel';
import { NuovoTaskModal } from './NuovoTaskModal';
import { parseLocalDate } from '../lib/dateUtils';
import { completaTaskEAvanzaFase, ricalcolaScadenzeTask } from '../lib/clpWorkflow';
import { FASE_TIPO_MAP } from '../config/faseConfig';

const COLONNE = [
  { stato: 'Da fare',        colore: '#F59E0B', bg: '#FFFBEB', border: '#F59E0B', icona: '📋' },
  { stato: 'In lavorazione', colore: '#3B82F6', bg: '#EFF6FF', border: '#3B82F6', icona: '⚡' },
  { stato: 'In revisione',   colore: '#8B5CF6', bg: '#F5F3FF', border: '#8B5CF6', icona: '🔍' },
  { stato: 'Completato',     colore: '#22C55E', bg: '#F0FDF4', border: '#22C55E', icona: '✅' },
  { stato: 'Non accettato',  colore: '#EF4444', bg: '#FEF2F2', border: '#EF4444', icona: '❌' },
] as const;

const COLONNE_CLP = [
  { stato: 'Girato',      tipo: 'Premontaggio',        colore: '#8B5CF6', bg: 'hsl(270 60% 97%)', border: '#8B5CF6', icona: '🎬', label: 'Girato' },
  { stato: 'Pre montato', tipo: 'Montaggio',            colore: '#3B82F6', bg: 'hsl(214 80% 97%)', border: '#3B82F6', icona: '✂️', label: 'Pre montato' },
  { stato: 'Montato',     tipo: 'Upload esportato',     colore: '#F59E0B', bg: 'hsl(38 92% 97%)',  border: '#F59E0B', icona: '📤', label: 'Montato' },
  { stato: 'Uploadato',   tipo: 'Revisione montaggio',  colore: '#EC4899', bg: 'hsl(328 80% 97%)', border: '#EC4899', icona: '🔍', label: 'Uploadato' },
  { stato: 'Revisionato', tipo: 'Programmazione',       colore: '#7C3AED', bg: 'hsl(263 70% 97%)', border: '#7C3AED', icona: '📅', label: 'Revisionato' },
  { stato: 'Programmato', tipo: '',                     colore: '#6D28D9', bg: 'hsl(263 60% 97%)', border: '#6D28D9', icona: '📡', label: 'Programmato' },
  { stato: 'Pubblicato',  tipo: '',                     colore: '#22C55E', bg: 'hsl(142 76% 97%)', border: '#22C55E', icona: '✅', label: 'Pubblicato' },
] as const;

const PRIORITA_COLOR: Record<string, string> = { '🔴 Alta': '#EF4444', '🟡 Media': '#F59E0B', '🟢 Bassa': '#22C55E' };

const TIPO_TO_FASE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  'Premontaggio':        { label: '🎬 Girato',     bg: 'hsl(270 60% 55%/0.1)', color: 'hsl(270 50% 45%)', border: 'hsl(270 60% 55%/0.3)' },
  'Montaggio':           { label: '✂️ Pre montato', bg: 'hsl(214 80% 55%/0.1)', color: 'hsl(214 70% 44%)', border: 'hsl(214 80% 55%/0.28)' },
  'Upload esportato':    { label: '📤 Montato',     bg: 'hsl(38 92% 55%/0.1)',  color: 'hsl(38 80% 35%)',  border: 'hsl(38 92% 55%/0.28)' },
  'Revisione montaggio': { label: '🔍 Uploadato',   bg: 'hsl(328 80% 55%/0.1)', color: 'hsl(328 65% 40%)', border: 'hsl(328 80% 55%/0.28)' },
  'Programmazione':      { label: '📅 Revisionato', bg: 'hsl(263 70% 55%/0.1)', color: 'hsl(263 55% 40%)', border: 'hsl(263 70% 55%/0.28)' },
};

const FASE_NEXT: Record<string, string> = {
  'Girato': 'Pre montato', 'Pre montato': 'Montato', 'Montato': 'Uploadato',
  'Uploadato': 'Revisionato', 'Revisionato': 'Programmato', 'Programmato': 'Pubblicato',
};

const TIPO_PER_FASE = FASE_TIPO_MAP;

function getTargetDate(scadenza: string, ora: string | null): Date {
  return new Date(`${scadenza}T${ora ? ora.slice(0, 5) : '23:59'}:00`);
}

function LiveClock({ scadenza, ora, onReschedule }: { scadenza: string; ora: string | null; onReschedule?: (newDate: string, newOra?: string) => void }) {
  const [diff, setDiff] = useState(() => getTargetDate(scadenza, ora).getTime() - Date.now());
  const [showPicker, setShowPicker] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newOra, setNewOra] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const id = setInterval(() => setDiff(getTargetDate(scadenza, ora).getTime() - Date.now()), 60000); return () => clearInterval(id); }, [scadenza, ora]);
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000), h = Math.floor((abs % 86400000) / 3600000), m = Math.floor((abs % 3600000) / 60000);
  const isScaduto = diff <= 0;
  const text = isScaduto ? (d > 0 ? `da ${d}g` : `da ${h}h`) : d > 7 ? `${d}gg` : d >= 1 ? `${d}g ${h}h` : h >= 1 ? `${h}h ${m}min` : `${m}min`;
  const level = isScaduto ? 'scaduto' : d > 7 ? 'ok' : d >= 1 ? 'warn' : 'urgent';
  const s = { ok: { bg: 'hsl(214 80% 55%/0.1)', c: 'hsl(214 70% 44%)', b: 'hsl(214 80% 55%/0.25)' }, warn: { bg: 'hsl(38 92% 50%/0.12)', c: 'hsl(32 95% 35%)', b: 'hsl(38 92% 50%/0.35)' }, urgent: { bg: 'hsl(0 80% 55%/0.12)', c: 'hsl(0 70% 42%)', b: 'hsl(0 80% 55%/0.4)' }, scaduto: { bg: 'hsl(0 80% 55%/0.14)', c: 'hsl(0 70% 38%)', b: 'hsl(0 80% 55%/0.5)' } }[level];
  return (
    <div className="mt-2" onClick={e => e.stopPropagation()}>
      <div
        className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold${level === 'urgent' ? ' animate-pulse' : ''}${onReschedule ? ' cursor-pointer hover:opacity-80' : ''}`}
        style={{ background: s.bg, border: `1px solid ${s.b}`, color: s.c }}
        onClick={e => {
          e.stopPropagation();
          if (onReschedule) {
            const domani = new Date(); domani.setDate(domani.getDate() + 1);
            setNewDate(`${domani.getFullYear()}-${String(domani.getMonth()+1).padStart(2,'0')}-${String(domani.getDate()).padStart(2,'0')}`);
            setNewOra(ora?.slice(0, 5) || '10:00');
            setShowPicker(v => !v);
          }
        }}
      >
        <span className="uppercase tracking-wide" style={{ fontSize: '0.65rem' }}>{isScaduto ? 'SCADUTO' : level === 'urgent' ? 'URGENTE' : level === 'warn' ? 'IN SCADENZA' : 'SCADE TRA'}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem' }}>{text}</span>
          {onReschedule && <span style={{ fontSize: '0.65rem' }}>🔄</span>}
        </div>
      </div>
      {showPicker && onReschedule && (
        <div className="mt-1 rounded-lg p-2 space-y-1.5" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }} onClick={e => e.stopPropagation()}>
          <div className="grid grid-cols-2 gap-1">
            <input type="date" className="text-[10px] px-1.5 py-1 rounded border w-full" style={{ borderColor: '#FCA5A5', background: 'white' }} value={newDate} onChange={e => setNewDate(e.target.value)} />
            <input type="time" className="text-[10px] px-1.5 py-1 rounded border w-full" style={{ borderColor: '#FCA5A5', background: 'white' }} value={newOra} onChange={e => setNewOra(e.target.value)} />
          </div>
          <div className="flex gap-1">
            <button
              disabled={!newDate || saving}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                setSaving(true);
                await onReschedule(newDate, newOra || undefined);
                setSaving(false);
                setShowPicker(false);
              }}
              className="flex-1 py-1 rounded text-[10px] font-bold text-white disabled:opacity-40"
              style={{ background: '#3B82F6' }}
            >
              {saving ? '⏳…' : '✅ Rischedula'}
            </button>
            <button onClick={e => { e.stopPropagation(); setShowPicker(false); }} className="text-[10px] px-2 py-1 rounded" style={{ background: '#F1F5F9', color: '#64748B' }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

function TaskCard({ task, team, utente, draggingId, onDragStart, onDragEnd, onClick, showFaseBadge = true, pubDate, revisionCount, isProgrammato, canEditProgrammazione, onRiprogramma, onEditPubDate, clientLogoUrl, onPriorityChange, onReschedule, hideCountdown }: {
  task: Task; team: TeamMember[]; utente: TeamMember | null; draggingId: string | null;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
  showFaseBadge?: boolean; pubDate?: { data: string | null; ora: string | null } | null; revisionCount?: number;
  isProgrammato?: boolean; canEditProgrammazione?: boolean; onRiprogramma?: () => void; onEditPubDate?: (d: string, o: string | null) => void;
  clientLogoUrl?: string | null; onPriorityChange?: (taskId: string, newPrio: string) => void;
  onReschedule?: (taskId: string, newDate: string, newOra?: string) => void;
  hideCountdown?: boolean;
}) {
  const member = team.find(m => m.nome === task.assegnato_a);
  const isAuto = task.assegnato_da?.includes('Sistema') || task.assegnato_da?.includes('⚡');
  const [editPub, setEditPub] = useState(false);
  const [eDate, setEDate] = useState(pubDate?.data || '');
  const [eOra, setEOra] = useState(pubDate?.ora?.slice(0, 5) || '');
  const [showMenu, setShowMenu] = useState(false);
  const [showResched, setShowResched] = useState(false);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedOra, setReschedOra] = useState('');

  const scadInfo = (() => {
    if (!task.scadenza) return null;
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    const scad = parseLocalDate(task.scadenza); scad.setHours(0,0,0,0);
    const diff = Math.floor((scad.getTime() - oggi.getTime()) / 86400000);
    if (diff < 0) return { label: '⚠ SCADUTO', color: '#EF4444', bg: '#FEF2F2' };
    if (diff === 0) return { label: '⏰ OGGI', color: '#D97706', bg: '#FEF3C7' };
    if (diff === 1) return { label: '⏰ DOMANI', color: '#D97706', bg: '#FEF3C7' };
    return { label: `📅 ${scad.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit' })}`, color: '#64748B', bg: '#F1F5F9' };
  })();

  return (
    <div className={`task-card ${draggingId === task.id ? 'dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}
      style={{ borderLeft: `3px solid ${PRIORITA_COLOR[task.priorita] || '#64748B'}`, ...(!hideCountdown && scadInfo?.label.includes('SCADUTO') ? { borderColor: '#EF4444' } : {}) }}>
      <div className="flex items-center gap-1.5 mb-1">
        {isAuto && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'hsl(38 92% 50%/0.15)', color: 'hsl(32 95% 40%)' }}>⚡ Auto</span>}
        {(revisionCount ?? 0) >= 3 && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A' }}>⚠️ {revisionCount} rev</span>}
      </div>
      <div className="flex items-start gap-2 mb-2">
        <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0 cursor-pointer hover:scale-150 transition-transform" title={`Priorità: ${task.priorita || 'Media'} — clicca per cambiare`} style={{ backgroundColor: PRIORITA_COLOR[task.priorita] || '#64748B' }} onClick={e => { e.stopPropagation(); const cycle = ['🔴 Alta', '🟡 Media', '🟢 Bassa']; const idx = cycle.indexOf(task.priorita); const next = cycle[(idx + 1) % 3]; onPriorityChange?.(task.id, next); }} />
        <p className="text-sm font-medium flex-1 leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{task.descrizione.length > 80 ? task.descrizione.slice(0, 80) + '…' : task.descrizione}</p>
      </div>
      <div className="flex items-center justify-between gap-1 mt-2">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{task.id_display}</span>
          {showFaseBadge && task.tipo && (() => { const f = TIPO_TO_FASE[task.tipo]; return f ? <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: f.bg, color: f.color, border: `1px solid ${f.border}` }}>{f.label}</span> : null; })()}
        </div>
        {member && <Avatar nome={member.nome} colore={member.colore} size={20} avatarUrl={member.avatar_url} />}
      </div>
      {task.cliente_nome && <div className="flex items-center gap-1.5 mt-1 truncate"><ClienteLogo nome={task.cliente_nome} logoUrl={clientLogoUrl} size={16} /><span className="text-xs truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{task.cliente_nome.slice(0, 20)}</span></div>}

      {!hideCountdown && pubDate?.data ? (
        <div className="mt-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#7C3AED', opacity: 0.7 }}>📡 Pubblicazione</p>
            {isProgrammato && canEditProgrammazione && <button onClick={e => { e.stopPropagation(); setEditPub(v => !v); setEDate(pubDate.data || ''); setEOra(pubDate.ora?.slice(0, 5) || ''); }} className="text-[10px] px-1 py-0.5 rounded" style={{ color: '#7C3AED' }}>✏️</button>}
          </div>
          {editPub && isProgrammato && canEditProgrammazione ? (
            <div className="mt-1 space-y-1" onClick={e => e.stopPropagation()}>
              <input type="date" className="w-full text-[11px] px-1.5 py-1 rounded border" style={{ borderColor: '#C4B5FD' }} value={eDate} onChange={e => setEDate(e.target.value)} />
              <input type="time" className="w-full text-[11px] px-1.5 py-1 rounded border" style={{ borderColor: '#C4B5FD' }} value={eOra} onChange={e => setEOra(e.target.value)} />
              <div className="flex gap-1">
                <button className="flex-1 text-[10px] px-2 py-1 rounded font-semibold" style={{ background: '#7C3AED', color: 'white' }} onClick={() => { onEditPubDate?.(eDate, eOra || null); setEditPub(false); }}>Salva</button>
                <button className="text-[10px] px-2 py-1 rounded" style={{ background: '#F1F5F9' }} onClick={() => setEditPub(false)}>✕</button>
              </div>
            </div>
          ) : (
            <>
              {isProgrammato && pubDate.data && <p className="text-[11px] font-bold mt-0.5" style={{ color: '#6D28D9' }}>{new Date(pubDate.data + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}{pubDate.ora && <span className="ml-1 font-mono">{pubDate.ora.slice(0, 5)}</span>}</p>}
              <LiveClock scadenza={pubDate.data} ora={pubDate.ora} onReschedule={onReschedule ? (d, o) => onReschedule(task.id, d, o) : undefined} />
            </>
          )}
        </div>
      ) : !hideCountdown && task.scadenza ? <LiveClock scadenza={task.scadenza} ora={task.ora} onReschedule={onReschedule ? (d, o) => onReschedule(task.id, d, o) : undefined} /> : !hideCountdown && scadInfo ? (
        <div className="inline-flex items-center text-xs px-1.5 py-0.5 rounded mt-1.5 font-medium cursor-pointer hover:opacity-80" style={{ background: scadInfo.bg, color: scadInfo.color }}
          onClick={e => { e.stopPropagation(); setShowResched(v => !v); const domani = new Date(); domani.setDate(domani.getDate()+1); setReschedDate(`${domani.getFullYear()}-${String(domani.getMonth()+1).padStart(2,'0')}-${String(domani.getDate()).padStart(2,'0')}`); setReschedOra(task.ora?.slice(0,5) || '10:00'); }}>
          {scadInfo.label} 🔄
        </div>
      ) : null}

      {/* Inline reschedule for scadInfo badges */}
      {!hideCountdown && showResched && onReschedule && (
        <div className="mt-1 rounded-lg p-2 space-y-1.5" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }} onClick={e => e.stopPropagation()}>
          <div className="grid grid-cols-2 gap-1">
            <input type="date" className="text-[10px] px-1.5 py-1 rounded border w-full" style={{ borderColor: '#FCA5A5', background: 'white' }} value={reschedDate} onChange={e => setReschedDate(e.target.value)} />
            <input type="time" className="text-[10px] px-1.5 py-1 rounded border w-full" style={{ borderColor: '#FCA5A5', background: 'white' }} value={reschedOra} onChange={e => setReschedOra(e.target.value)} />
          </div>
          <div className="flex gap-1">
            <button disabled={!reschedDate} onClick={async (e) => { e.stopPropagation(); await onReschedule(task.id, reschedDate, reschedOra || undefined); setShowResched(false); }}
              className="flex-1 py-1 rounded text-[10px] font-bold text-white disabled:opacity-40" style={{ background: '#3B82F6' }}>✅ Rischedula</button>
            <button onClick={e => { e.stopPropagation(); setShowResched(false); }} className="text-[10px] px-2 py-1 rounded" style={{ background: '#F1F5F9', color: '#64748B' }}>✕</button>
          </div>
        </div>
      )}

      {isProgrammato && canEditProgrammazione && (
        <div className="relative mt-1.5">
          <button onClick={e => { e.stopPropagation(); setShowMenu(v => !v); }} className="text-xs px-1.5 py-0.5 rounded hover:bg-purple-100" style={{ color: '#7C3AED' }}>⋮</button>
          {showMenu && <div className="absolute right-0 top-full mt-1 rounded-lg border shadow-lg py-1 z-50" style={{ background: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', minWidth: 160 }} onClick={e => e.stopPropagation()}>
            <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-purple-50" onClick={() => { setShowMenu(false); onRiprogramma?.(); }}>🔄 Riprogramma</button>
          </div>}
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export function KanbanTab({ team, clienti, personaView, focusTaskId }: { team: TeamMember[]; clienti: Cliente[]; personaView: string | null; focusTaskId?: string | null }) {
  const { utente, addToast } = useApp();
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clpFasi, setClpFasi] = useState<Record<string, string>>({});
  const [clpPubDates, setClpPubDates] = useState<Record<string, { data: string | null; ora: string | null }>>({});
  const [clpRevisionCount, setClpRevisionCount] = useState<Record<string, number>>({});

  // Mappa cliente_id → logo_url per le card
  const clientLogoMap: Record<string, string | null> = {};
  for (const c of clienti) { if (c.logo_url) clientLogoMap[c.id] = c.logo_url; }
  // Anche per nome (fallback quando il task ha solo cliente_nome)
  const clientLogoByName: Record<string, string | null> = {};
  for (const c of clienti) { if (c.logo_url) clientLogoByName[c.nome] = c.logo_url; }
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNuovoTask, setShowNuovoTask] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtraOggi, setFiltraOggi] = useState(false);
  const [boardMode, setBoardMode] = useState<'standard' | 'clp' | 'both'>('both');
  const [mobileCol, setMobileCol] = useState('Da fare');
  const [mobileCLPCol, setMobileCLPCol] = useState('Girato');
  const [riprogrammaConfirm, setRiprogrammaConfirm] = useState<{ taskId: string; contenutoId: string; desc: string } | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEditProgrammazione = utente?.nome === 'Elisa' || utente?.nome === 'Giovanni' || utente?.ruolo === 'Admin';

  // ── L'UNICA FUNZIONE CHE LEGGE DAL DB ────────────────────────────────────
  const loadTasks = useCallback(async () => {
    try {
      const [{ data: td }, { data: cd }] = await Promise.all([
        supabase.from('task').select('*').neq('stato', 'Archiviato').order('created_at', { ascending: false }),
        supabase.from('contenuti').select('id, fase, data_pubblicazione, ora_pubblicazione, revision_count'),
      ]);
      setTasks(td || []);
      setClpFasi(Object.fromEntries((cd || []).map(c => [c.id, c.fase || ''])));
      setClpPubDates(Object.fromEntries((cd || []).map(c => [c.id, { data: c.data_pubblicazione, ora: c.ora_pubblicazione }])));
      setClpRevisionCount(Object.fromEntries((cd || []).map(c => [c.id, c.revision_count || 0])));
    } catch (e) { console.error('[Kanban] loadTasks:', e); }
    setLoading(false);
    // Sync contatori TopBar
    window.dispatchEvent(new Event('skorpio-refresh-tasks'));
  }, []);

  // Debounced reload per realtime (evita 10 reload in 1 secondo)
  const debouncedReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => loadTasks(), 500);
  }, [loadTasks]);

  // ── REALTIME: qualsiasi cambiamento → ricarica (debounced) ───────────────
  useEffect(() => {
    loadTasks();
    const ch = supabase.channel('kanban-v3')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task' }, () => debouncedReload())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contenuti' }, () => debouncedReload())
      .subscribe();
    return () => { supabase.removeChannel(ch); if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [loadTasks, debouncedReload]);

  // ── Focus task from TopBar dropdown ─────────────────────────────────────
  useEffect(() => {
    if (!focusTaskId || loading) return;
    const t = tasks.find(tk => tk.id === focusTaskId);
    if (t) {
      setSelectedTask(t);
      // Reset focusTaskId so clicking the same task again works
      window.dispatchEvent(new CustomEvent('skorpio-focus-handled'));
    }
  }, [focusTaskId, tasks, loading]);

  // ── FILTRI ───────────────────────────────────────────────────────────────
  const matchSearch = (t: Task) => !searchQuery.trim() || (t.descrizione + t.cliente_nome + t.id_display + t.id_contenuto + t.assegnato_a + t.tipo).toLowerCase().includes(searchQuery.toLowerCase());

  const PRIO_ORDER = { '🔴 Alta': 0, '🟡 Media': 1, '🟢 Bassa': 2 };
  const sortByUrgenza = (a, b) => {
    const now = Date.now();
    // Usa scadenza task, oppure data_pubblicazione del CLP come fallback
    const getMs = (t) => {
      if (t.scadenza) return getTargetDate(t.scadenza, t.ora).getTime();
      if (t.id_contenuto && clpPubDates[t.id_contenuto]?.data) return getTargetDate(clpPubDates[t.id_contenuto].data, clpPubDates[t.id_contenuto].ora).getTime();
      return Infinity;
    };
    const msA = getMs(a), msB = getMs(b);
    // 1. Scaduti in cima
    const scadutoA = msA < now ? -1 : 0;
    const scadutoB = msB < now ? -1 : 0;
    if (scadutoA !== scadutoB) return scadutoA - scadutoB;
    // 2. Chi ha data prima di chi non ce l'ha
    const hasA = msA < Infinity ? 0 : 1;
    const hasB = msB < Infinity ? 0 : 1;
    if (hasA !== hasB) return hasA - hasB;
    // 3. Data più vicina in cima
    if (msA !== msB) return msA - msB;
    // 4. Priorità
    return (PRIO_ORDER[a.priorita] ?? 1) - (PRIO_ORDER[b.priorita] ?? 1);
  };
  const filteredStandard = (stato: string) => tasks.filter(t => {
    if (t.stato !== stato || (t.id_contenuto && t.id_contenuto.trim())) return false;
    if (personaView && t.assegnato_a !== personaView) return false;
    if (utente?.ruolo !== 'Admin' && t.assegnato_a !== utente?.nome) return false;
    if (!matchSearch(t)) return false;
    if (filtraOggi && t.scadenza) { const ms = getTargetDate(t.scadenza, t.ora).getTime(); if (ms > Date.now() + 86400000 || ms < Date.now() - 86400000) return false; }
    else if (filtraOggi) return false;
    return true;
 }).sort(sortByUrgenza);

  const filteredCLP = (faseCLP: string) => {
    const tipoCol = TIPO_PER_FASE[faseCLP];
    return tasks.filter(t => {
      if (!t.id_contenuto?.trim() || !matchSearch(t)) return false;
      const fase = clpFasi[t.id_contenuto];
      if (!fase) return false;
      if (faseCLP === 'Programmato') return fase === 'Programmato' && t.tipo === 'Programmazione';
      if (faseCLP === 'Pubblicato') return fase === 'Pubblicato' && (t.tipo === 'Cleanup' || (t.stato === 'Completato' && t.tipo === 'Programmazione'));
      if (personaView && t.assegnato_a !== personaView) return false;
      if (utente?.ruolo !== 'Admin' && t.assegnato_a !== utente?.nome) return false;
      // Revisionato: mostra sia Programmazione che Supervisione
      if (faseCLP === 'Revisionato' && fase === 'Revisionato' && t.tipo === 'Supervisione' && t.stato !== 'Completato') return true;
      return fase === faseCLP && tipoCol === t.tipo && t.stato !== 'Completato';
    }).sort(sortByUrgenza);
  };

  // ── HANDLERS: azione → DB → loadTasks() ──────────────────────────────────
  const handlePriorityChange = async (taskId: string, newPrio: string) => {
    await supabase.from('task').update({ priorita: newPrio }).eq('id', taskId);
    await loadTasks();
  };

  const handleReschedule = async (taskId: string, newDate: string, newOra?: string) => {
    const task = tasks.find(t => t.id === taskId);
    const update: any = { scadenza: newDate };
    if (newOra) update.ora = newOra;
    await supabase.from('task').update(update).eq('id', taskId);

    // Sync calendario: cerca evento collegato e aggiornalo
    if (task) {
      // 1. Cerca per [TASK:id] nella descrizione
      const { data: calByTag } = await supabase.from('calendario')
        .select('id')
        .like('descrizione', `%[TASK:${taskId}]%`);
      if (calByTag?.length) {
        const calUpdate: any = { data: newDate };
        if (newOra) calUpdate.ora = newOra;
        for (const ev of calByTag) {
          await supabase.from('calendario').update(calUpdate).eq('id', ev.id);
        }
      }
      // 2. Se è un CLP task, aggiorna anche data_pubblicazione del contenuto
      if (task.id_contenuto) {
        await supabase.from('contenuti').update({ data_pubblicazione: newDate, ...(newOra ? { ora_pubblicazione: newOra } : {}) }).eq('id', task.id_contenuto);
        // Aggiorna evento calendario collegato al contenuto
        const calUpdate2: any = { data: newDate };
        if (newOra) calUpdate2.ora = newOra;
        await supabase.from('calendario').update(calUpdate2).eq('contenuto_id', task.id_contenuto);
      }
    }
    await loadTasks();
  };

  const handleDropStandard = async (nuovoStato: string) => {
    if (!dragItem) return;
    setDropTarget(null);
    const task = tasks.find(t => t.id === dragItem);
    if (!task || task.stato === nuovoStato || task.stato === 'Archiviato') { setDragItem(null); return; }
    setDragItem(null);
    const { error } = await supabase.from('task').update({ stato: nuovoStato }).eq('id', task.id);
    if (error) { sounds.errore(); addToast('Errore', 'error'); }
    else if (nuovoStato === 'Completato') { sounds.taskCompletato(); addToast('✅ Task completato!', 'success'); }
    else { sounds.drop(); addToast(`↕️ → ${nuovoStato}`, 'info'); }
    await loadTasks();
  };

  const handleDropCLP = async (faseCLP: string) => {
    if (!dragItem) return;
    setDropTarget(null);
    const task = tasks.find(t => t.id === dragItem);
    if (!task?.id_contenuto) { setDragItem(null); return; }
    const faseCorr = Object.entries(TIPO_PER_FASE).find(([, tipo]) => tipo === task.tipo)?.[0];
    const fasePrev = faseCorr ? FASE_NEXT[faseCorr] : null;
    if (fasePrev && fasePrev !== faseCLP) { addToast(`⚠️ Solo alla fase successiva: ${fasePrev}`, 'warn'); setDragItem(null); return; }
    setDragItem(null);
    addToast('⏳ Avanzamento…', 'info');
    try {
      const nf = await completaTaskEAvanzaFase(task.tipo, task.id_contenuto, team, utente?.id);
      if (nf) { sounds.taskCompletato(); addToast(`✅ ${task.tipo} → ${nf}`, 'success'); }
    } catch (e: any) { sounds.errore(); addToast('❌ ' + (e?.message || 'Errore'), 'error'); }
    await loadTasks();
    // Backup reload — in caso il primo arrivi prima che il DB abbia committato
    setTimeout(() => loadTasks(), 1000);
  };

  const handleRiprogramma = async (contenutoId: string) => {
    setRiprogrammaConfirm(null);
    addToast('⏳ Riprogrammazione…', 'info');
    const { cambiaFaseCLP } = await import('../services/faseService');
    const r = await cambiaFaseCLP({ contenutoId, nuovaFase: 'Revisionato', source: 'kanban', userId: utente?.id || 'unknown', oldFase: 'Programmato' });
    addToast(r.success ? '🔄 Riprogrammato' : '❌ ' + (r.errors[0] || 'Errore'), r.success ? 'success' : 'error');
    await loadTasks();
  };

  const handleEditPubDate = async (contenutoId: string, newDate: string, newOra: string | null) => {
    if (!newDate) return;
    await supabase.from('contenuti').update({ data_pubblicazione: newDate, ora_pubblicazione: newOra }).eq('id', contenutoId);
    await supabase.from('calendario').update({ data: newDate, ora: newOra }).eq('contenuto_id', contenutoId).eq('tipo', 'pubblicazione');
    const { data: c } = await supabase.from('contenuti').select('tipo').eq('id', contenutoId).single();
    const count = await ricalcolaScadenzeTask(contenutoId, newDate, newOra, c?.tipo);
    addToast(`📅 Data aggiornata — ${count} scadenze ricalcolate`, 'success');
    await loadTasks();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="sk-spinner" style={{ color: '#3B82F6' }} /></div>;
  const showStd = boardMode === 'standard' || boardMode === 'both';
  const showCLP = boardMode === 'clp' || boardMode === 'both';

  return (
    <div className="p-4 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-lg" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Kanban Board</h2>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: '#DCFCE7', color: '#16A34A' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22C55E', boxShadow: '0 0 0 3px #BBF7D0' }} /> LIVE
          </div>
          <button onClick={() => setFiltraOggi(f => !f)} className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={filtraOggi ? { background: '#FEE2E2', color: '#DC2626', border: '1px solid rgba(220,38,38,0.4)' } : { background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}>
            ⏰ {!isMobile && 'In scadenza oggi '}{filtraOggi && '×'}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>🔍</span>
            <input type="text" placeholder="Cerca task..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none w-full sm:w-44"
              style={{ background: 'hsl(var(--background))', borderColor: searchQuery ? 'hsl(var(--primary))' : 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">✕</button>}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-border text-xs flex-shrink-0">
            {(['both', 'standard', 'clp'] as const).map(mode => (
              <button key={mode} onClick={() => setBoardMode(mode)} className="px-2.5 py-1 font-medium"
                style={boardMode === mode ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' } : { background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))' }}>
                {mode === 'both' ? 'Tutte' : mode === 'standard' ? 'Task' : '🎬 CLP'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowNuovoTask(true)} className="sk-btn-primary text-sm hidden sm:inline-flex">+ Nuovo Task</button>
        </div>
      </div>

      {/* BOARD CLP */}
      {showCLP && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--muted-foreground))' }}>🎬 Workflow Produzione CLP</span>
            <div className="flex-1 h-px hidden sm:block" style={{ background: 'hsl(var(--border))' }} />
          </div>
          {isMobile && <div className="flex gap-1 overflow-x-auto pb-2 mb-2">{COLONNE_CLP.map(col => <button key={col.stato} onClick={() => setMobileCLPCol(col.stato)} className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0" style={{ background: mobileCLPCol === col.stato ? col.colore : `${col.colore}15`, color: mobileCLPCol === col.stato ? '#fff' : col.colore }}>{col.icona} {col.stato} ({filteredCLP(col.stato).length})</button>)}</div>}
          <div className={isMobile ? '' : 'flex gap-3 overflow-x-auto pb-2'}>
            {COLONNE_CLP.filter(col => !isMobile || col.stato === mobileCLPCol).map(col => {
              const ct = filteredCLP(col.stato);
              return (
                <div key={col.stato} className={`kanban-col ${dropTarget === `clp__${col.stato}` ? 'kanban-drop-target' : ''}`}
                  style={{ background: col.bg, border: `1px solid ${col.border}30`, minWidth: isMobile ? '100%' : 180 }}
                  onDragOver={e => { e.preventDefault(); setDropTarget(`clp__${col.stato}`); }} onDragLeave={() => setDropTarget(null)} onDrop={() => handleDropCLP(col.stato)}>
                  <div className="kanban-col-header" style={{ borderBottom: `2px solid ${col.border}40` }}>
                    <div className="flex items-center gap-1.5"><span>{col.icona}</span><span className="text-xs font-semibold" style={{ color: col.colore }}>{col.stato}</span></div>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${col.colore}20`, color: col.colore }}>{ct.length}</span>
                  </div>
                  <div className="kanban-col-body">
                    {ct.map(t => <TaskCard key={t.id} task={t} team={team} utente={utente} draggingId={dragItem} onDragStart={() => setDragItem(t.id)} onDragEnd={() => setDragItem(null)} onClick={() => setSelectedTask(t)} showFaseBadge={false} pubDate={t.id_contenuto ? clpPubDates[t.id_contenuto] : null} revisionCount={t.id_contenuto ? clpRevisionCount[t.id_contenuto] : undefined} isProgrammato={col.stato === 'Programmato'} canEditProgrammazione={canEditProgrammazione} onRiprogramma={() => t.id_contenuto && setRiprogrammaConfirm({ taskId: t.id, contenutoId: t.id_contenuto, desc: t.descrizione.slice(0, 50) })} onEditPubDate={(d, o) => t.id_contenuto && handleEditPubDate(t.id_contenuto, d, o)} clientLogoUrl={t.cliente_id ? clientLogoMap[t.cliente_id] : clientLogoByName[t.cliente_nome]} onPriorityChange={handlePriorityChange} onReschedule={handleReschedule} hideCountdown={col.stato === 'Pubblicato'} />)}
                    {ct.length === 0 && <div className="flex items-center justify-center h-12 text-xs rounded-lg" style={{ color: 'hsl(var(--muted-foreground))', border: `1px dashed ${col.border}40` }}>Nessun task</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Conferma riprogramma */}
      {riprogrammaConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setRiprogrammaConfirm(null)}>
          <div className="rounded-xl border shadow-xl p-5 max-w-sm w-full mx-4" style={{ background: 'hsl(var(--background))' }} onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-2">🔄 Riprogramma CLP</p>
            <p className="text-xs mb-4" style={{ color: 'hsl(var(--muted-foreground))' }}>Vuoi riprogrammare "{riprogrammaConfirm.desc}"?</p>
            <div className="flex gap-2">
              <button className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold" style={{ background: 'hsl(38 92% 50%)', color: 'white' }} onClick={() => handleRiprogramma(riprogrammaConfirm.contenutoId)}>Conferma</button>
              <button className="text-xs px-3 py-2 rounded-lg font-semibold" style={{ background: 'hsl(var(--muted))' }} onClick={() => setRiprogrammaConfirm(null)}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {/* BOARD STANDARD */}
      {showStd && (
        <div>
          {boardMode === 'both' && <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--muted-foreground))' }}>📋 Task generali</span><div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} /></div>}
          {isMobile && <div className="flex gap-1 overflow-x-auto pb-2 mb-2">{COLONNE.map(col => <button key={col.stato} onClick={() => setMobileCol(col.stato)} className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0" style={{ background: mobileCol === col.stato ? col.colore : `${col.colore}15`, color: mobileCol === col.stato ? '#fff' : col.colore }}>{col.icona} {col.stato} ({filteredStandard(col.stato).length})</button>)}</div>}
          <div className={isMobile ? '' : 'flex gap-4 overflow-x-auto pb-4'}>
            {COLONNE.filter(col => !isMobile || col.stato === mobileCol).map(col => {
              const ct = filteredStandard(col.stato);
              return (
                <div key={col.stato} className={`kanban-col ${dropTarget === col.stato ? 'kanban-drop-target' : ''}`}
                  style={{ background: col.bg, border: `1px solid ${col.border}30`, minWidth: isMobile ? '100%' : undefined }}
                  onDragOver={e => { e.preventDefault(); setDropTarget(col.stato); }} onDragLeave={() => setDropTarget(null)} onDrop={() => handleDropStandard(col.stato)}>
                  <div className="kanban-col-header" style={{ borderBottom: `2px solid ${col.border}40` }}>
                    <div className="flex items-center gap-2"><span>{col.icona}</span><span style={{ color: col.colore }}>{col.stato}</span></div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${col.colore}20`, color: col.colore }}>{ct.length}</span>
                  </div>
                  <div className="kanban-col-body">
                    {ct.map(t => <TaskCard key={t.id} task={t} team={team} utente={utente} draggingId={dragItem} onDragStart={() => setDragItem(t.id)} onDragEnd={() => setDragItem(null)} onClick={() => setSelectedTask(t)} showFaseBadge={true} revisionCount={t.id_contenuto ? clpRevisionCount[t.id_contenuto] : undefined} clientLogoUrl={t.cliente_id ? clientLogoMap[t.cliente_id] : clientLogoByName[t.cliente_nome]} onPriorityChange={handlePriorityChange} onReschedule={handleReschedule} />)}
                    {ct.length === 0 && <div className="flex items-center justify-center h-16 text-xs rounded-lg" style={{ color: 'hsl(var(--skorpio-text-tertiary))', border: `1px dashed ${col.border}40` }}>Nessun task</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isMobile && <button onClick={() => setShowNuovoTask(true)} className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl text-white" style={{ background: 'hsl(var(--primary))' }}>+</button>}

      {selectedTask && <TaskDetailPanel task={selectedTask} team={team} onClose={() => setSelectedTask(null)} onUpdate={async (_updated: Task) => { await loadTasks(); }} onDelete={async (_id: string) => { setSelectedTask(null); await loadTasks(); }} />}
      {showNuovoTask && <NuovoTaskModal team={team} clienti={clienti} utente={utente} onClose={() => setShowNuovoTask(false)} onCreated={async (t) => { addToast(`✅ Task ${t.id_display} creato`, 'success'); setShowNuovoTask(false); await loadTasks(); }} />}
    </div>
  );
}
