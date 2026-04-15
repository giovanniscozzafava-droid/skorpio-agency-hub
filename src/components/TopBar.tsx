import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { supabase } from '../integrations/supabase/client';
import type { TeamMember, Task } from '../types';
import { Avatar } from './Avatar';
import { ImpostazioniPanel } from './ImpostazioniPanel';
import fuyueLogo from '@/assets/fuyue-logo-white.svg';
import { NotificheDropdown } from './NotificheDropdown';
import { useNotifiche } from '@/hooks/useNotifiche';
import { DriveStorageIndicator } from './DriveStorageIndicator';
import { UploadIndicator } from './UploadIndicator';
import { MobileDrawer } from './MobileDrawer';
import { Menu } from 'lucide-react';

interface TopBarProps {
  team: TeamMember[];
  taskCounts: { daFare: number; clpDaFare: number; taskDaFare: number; urgenti: number; scaduti: number };
  tasks: Task[];
  clpPubDates?: Record<string, { data: string | null; ora: string | null; fase?: string }>;
  onViewPersona: (nome: string | null) => void;
  personaView: string | null;
  onTeamChange: (team: TeamMember[]) => void;
  onGoToTask?: (taskId: string) => void;
  onTaskReassigned?: (taskId: string, newDate: string, newPersona?: string) => void;
}

function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type DropdownType = 'clp' | 'task' | 'urgenti' | 'scaduti' | null;

function CounterDropdown({ tasks, team, tipo, onClose, onClickTask, onReassign, onArchive, clpPubDates, pos }: {
  tasks: Task[];
  team: TeamMember[];
  tipo: DropdownType;
  onClose: () => void;
  onClickTask: (taskId: string) => void;
  onReassign: (taskId: string, newDate: string, newPersona?: string) => void;
  onArchive: (taskId: string) => void;
  clpPubDates?: Record<string, { data: string | null; ora: string | null; fase?: string }>;
  pos?: { top: number; left: number };
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newPersona, setNewPersona] = useState('');
  const [bulkDate, setBulkDate] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  React.useEffect(() => {
    // Delay to prevent the same click that opened the dropdown from closing it
    let fn: ((e: MouseEvent) => void) | null = null;
    const timer = setTimeout(() => {
      fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
      document.addEventListener('mousedown', fn);
    }, 150);
    return () => {
      clearTimeout(timer);
      if (fn) document.removeEventListener('mousedown', fn);
    };
  }, [onClose]);

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const domani = toDateStr(new Date(oggi.getTime() + 86400000));

  const filtered = tipo === 'clp'
    ? tasks.filter(t => t.id_contenuto?.trim() && t.stato !== 'Completato')
    : tipo === 'task'
    ? tasks.filter(t => !t.id_contenuto?.trim() && t.stato !== 'Completato')
    : tipo === 'urgenti'
    ? tasks.filter(t => t.priorita === '🔴 Alta' && t.stato !== 'Completato')
    : tipo === 'scaduti'
    ? tasks.filter(t => {
        if (t.stato === 'Completato') return false;
        if (t.id_contenuto && clpPubDates?.[t.id_contenuto]) {
          const fase = clpPubDates[t.id_contenuto].fase;
          if (fase === 'Pubblicato' || fase === 'Scartata') return false;
        }
        const now = Date.now();
        if (t.scadenza) { const d = parseLocalDate(t.scadenza); d.setHours(23,59,59); return d.getTime() < now; }
        if (t.id_contenuto && clpPubDates?.[t.id_contenuto]?.data) { const d = parseLocalDate(clpPubDates[t.id_contenuto].data!); d.setHours(23,59,59); return d.getTime() < now; }
        return false;
      })
    : [];

  const label = tipo === 'clp' ? '🎬 CLP attivi' : tipo === 'task' ? '📋 Task attivi' : tipo === 'urgenti' ? '🔴 Urgenti' : '⚠️ Scaduti';
  const color = tipo === 'clp' ? '#8B5CF6' : tipo === 'task' ? '#F59E0B' : '#EF4444';
  const isScaduti = tipo === 'scaduti';

  return (
    <div ref={ref} className="fixed rounded-xl shadow-2xl border overflow-hidden"
      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', width: (isScaduti || tipo === 'urgenti') ? 380 : 320, maxHeight: 520, top: pos?.top ?? 110, left: pos?.left ?? 16, zIndex: 9999 }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-xs font-bold" style={{ color }}>{label} ({filtered.length})</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      {/* Bulk actions for scaduti */}
      {isScaduti && filtered.length > 0 && (
        <div className="px-3 py-2.5 border-b space-y-2" style={{ background: 'hsl(0 80% 55% / 0.04)', borderColor: 'hsl(var(--border))' }}>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[9px] font-bold uppercase" style={{ color: '#EF4444' }}>🔄 Rischedula tutti a:</label>
              <input type="date" className="sk-input w-full text-xs mt-0.5" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
            </div>
            <button
              disabled={!bulkDate || bulkBusy}
              onClick={async () => {
                setBulkBusy(true);
                for (const t of filtered) {
                  await onReassign(t.id, bulkDate);
                }
                setBulkBusy(false);
                setBulkDate('');
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40 transition-all whitespace-nowrap"
              style={{ background: '#3B82F6' }}
            >
              {bulkBusy ? '⏳…' : `✅ Tutti (${filtered.length})`}
            </button>
          </div>
          <button
            disabled={bulkBusy}
            onClick={async () => {
              setBulkBusy(true);
              for (const t of filtered) {
                await onArchive(t.id);
              }
              setBulkBusy(false);
            }}
            className="w-full py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
            style={{ background: 'hsl(0 70% 50% / 0.08)', color: 'hsl(0 60% 45%)', border: '1px solid hsl(0 60% 50% / 0.15)' }}
          >
            {bulkBusy ? '⏳…' : `🗑️ Archivia tutti (${filtered.length})`}
          </button>
        </div>
      )}
      <div className="overflow-y-auto" style={{ maxHeight: 370 }}>
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Nessun elemento</p>
        ) : (
          filtered.slice(0, 40).map(t => (
            <div key={t.id} className="border-b last:border-0" style={{ borderColor: 'hsl(var(--border) / 0.5)' }}>
              {/* Task info */}
              <div className="px-3 pt-2 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold flex-shrink-0" style={{ color }}>{t.id_display}</span>
                  <span className="text-xs text-foreground truncate flex-1">{t.descrizione}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {t.cliente_nome && <span className="text-[10px] text-muted-foreground">{t.cliente_nome}</span>}
                  {t.assegnato_a && <span className="text-[10px] text-muted-foreground">→ {t.assegnato_a}</span>}
                  {t.scadenza && (
                    <span className="text-[10px] ml-auto" style={{
                      color: parseLocalDate(t.scadenza) < oggi ? '#EF4444' : 'hsl(var(--muted-foreground))'
                    }}>
                      📅 {parseLocalDate(t.scadenza).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {!t.scadenza && t.id_contenuto && clpPubDates?.[t.id_contenuto]?.data && (
                    <span className="text-[10px] ml-auto" style={{
                      color: parseLocalDate(clpPubDates[t.id_contenuto].data!) < oggi ? '#EF4444' : '#7C3AED'
                    }}>
                      📡 {parseLocalDate(clpPubDates[t.id_contenuto].data!).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Action bar */}
              {(isScaduti || tipo === 'urgenti') ? (
                <div className="px-3 pb-2 flex gap-1.5 mt-1">
                  <button
                    onClick={() => onClickTask(t.id)}
                    className="text-[10px] px-2 py-1 rounded font-semibold transition-colors"
                    style={{ background: 'hsl(214 80% 55% / 0.1)', color: 'hsl(214 70% 44%)' }}
                  >
                    📍 Vai
                  </button>
                  <button
                    onClick={() => {
                      if (expandedId === t.id) { setExpandedId(null); }
                      else { setExpandedId(t.id); setNewDate(domani); setNewPersona(t.assegnato_a || ''); }
                    }}
                    className="text-[10px] px-2 py-1 rounded font-semibold transition-colors"
                    style={{ background: expandedId === t.id ? 'hsl(214 80% 55% / 0.2)' : 'hsl(38 92% 50% / 0.12)', color: expandedId === t.id ? 'hsl(214 70% 44%)' : 'hsl(38 80% 40%)' }}
                  >
                    {expandedId === t.id ? '✕ Chiudi' : '🔄 Rischedula'}
                  </button>
                  <button
                    onClick={() => onArchive(t.id)}
                    className="text-[10px] px-2 py-1 rounded font-semibold transition-colors"
                    style={{ background: 'hsl(0 70% 50% / 0.08)', color: 'hsl(0 60% 45%)' }}
                  >
                    🗑️ Archivia
                  </button>
                </div>
              ) : (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => onClickTask(t.id)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    📍 Apri nel Kanban
                  </button>
                </div>
              )}

              {/* Inline reschedule form */}
              {(isScaduti || tipo === 'urgenti') && expandedId === t.id && (
                <div className="px-3 pb-2.5 pt-1 space-y-1.5" style={{ background: 'hsl(38 92% 50% / 0.04)' }} onClick={e => e.stopPropagation()}>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Nuova scadenza</label>
                      <input type="date" className="sk-input w-full text-xs" value={newDate} onChange={e => setNewDate(e.target.value)} />
                    </div>
                    <div className="flex-1">
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">Assegnato a</label>
                      <select className="sk-select w-full text-xs" value={newPersona} onChange={e => setNewPersona(e.target.value)}>
                        {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={() => { onReassign(t.id, newDate, newPersona !== t.assegnato_a ? newPersona : undefined); setExpandedId(null); }}
                    disabled={!newDate}
                    className="w-full py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all"
                    style={{ background: '#3B82F6' }}
                  >
                    ✅ Riassegna{newPersona !== t.assegnato_a ? ` a ${newPersona}` : ''} → {newDate ? parseLocalDate(newDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        {filtered.length > 40 && (
          <p className="text-[10px] text-center text-muted-foreground py-2">…e altri {filtered.length - 40}</p>
        )}
      </div>
    </div>
  );
}

export function TopBar({ team, taskCounts, tasks, clpPubDates, onViewPersona, personaView, onTeamChange, onGoToTask, onTaskReassigned }: TopBarProps) {
  const { utente, tab, setTab, logout } = useApp();
  const [orologio, setOrologio] = useState(new Date());
  const [showImpostazioni, setShowImpostazioni] = useState(false);
  const [showNotifiche, setShowNotifiche] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [counterDrop, setCounterDrop] = useState<DropdownType>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const { nonLette } = useNotifiche(utente?.nome ?? null);

  const openDrop = (tipo: DropdownType, e: React.MouseEvent) => {
    if (counterDrop === tipo) { setCounterDrop(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
    setCounterDrop(tipo);
  };

  useEffect(() => {
    const t = setInterval(() => setOrologio(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isAdmin = utente?.ruolo === 'Admin';

  const tabs = [
    { id: 'kanban', label: '📋 Kanban' },
    { id: 'calendario', label: '📅 Calendario' },
    { id: 'creative', label: '🤖 Creative Engine' },
    { id: 'contenuti', label: '📹 Contenuti' },
    { id: 'clienti', label: '👥 Clienti' },
    { id: 'riprese', label: '🎬 Riprese' },
    { id: 'monitor', label: '🖥️ Monitor' },
    { id: 'assets', label: '🎨 Assets' },
    { id: 'siti', label: '🌐 Siti Web' },
    { id: 'andromeda', label: '🏥 Andromeda' },
    { id: 'report', label: '📊 Report' },
  ];

  return (
    <>
      {/* Top bar */}
      <div className="skorpio-topbar">
        {/* Hamburger — mobile only */}
        <button
          onClick={() => setShowDrawer(true)}
          className="lg:hidden p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          aria-label="Menu"
        >
          <Menu size={22} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 mr-4 flex-shrink-0">
          <span className="text-xl">🦂</span>
          <div className="hidden sm:flex items-baseline gap-1.5">
            <span className="font-bold text-white text-lg tracking-tight">SKORPIO</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>v1.4.1</span>
          </div>
          <span className="hidden lg:block text-xs mx-1" style={{ color: 'rgba(255,255,255,0.2)' }}>by</span>
          <img src={fuyueLogo} alt="Fuyue" className="hidden lg:block h-4 w-auto opacity-50 hover:opacity-80 transition-opacity" />
        </div>

        {/* Contatori — cliccabili, aprono dropdown */}
        <div className="flex items-center gap-2 flex-1 min-w-0 relative">
          {/* Desktop counters */}
          <button className="stat-pill text-xs hidden md:inline-flex hover:scale-105 active:scale-95 transition-all"
            style={{ background: counterDrop === 'clp' ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.2)', color: '#C4B5FD', cursor: 'pointer', border: counterDrop === 'clp' ? '1px solid #C4B5FD' : '1px solid transparent' }}
            onClick={e => openDrop('clp', e)}>
            🎬 {taskCounts.clpDaFare} CLP
          </button>
          <button className="stat-pill text-xs hidden md:inline-flex hover:scale-105 active:scale-95 transition-all"
            style={{ background: counterDrop === 'task' ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.2)', color: '#FCD34D', cursor: 'pointer', border: counterDrop === 'task' ? '1px solid #FCD34D' : '1px solid transparent' }}
            onClick={e => openDrop('task', e)}>
            📋 {taskCounts.taskDaFare} Task
          </button>
          {taskCounts.urgenti > 0 && (
            <button className="stat-pill text-xs hidden md:inline-flex hover:scale-105 active:scale-95 transition-all"
              style={{ background: counterDrop === 'urgenti' ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.2)', color: '#FCA5A5', cursor: 'pointer', border: counterDrop === 'urgenti' ? '1px solid #FCA5A5' : '1px solid transparent' }}
              onClick={e => openDrop('urgenti', e)}>
              🔴 {taskCounts.urgenti} urgenti
            </button>
          )}
          {taskCounts.scaduti > 0 && (
            <button className="stat-pill text-xs hidden md:inline-flex hover:scale-105 active:scale-95 transition-all"
              style={{ background: counterDrop === 'scaduti' ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)', color: '#F87171', cursor: 'pointer', border: counterDrop === 'scaduti' ? '1px solid #F87171' : '1px solid transparent' }}
              onClick={e => openDrop('scaduti', e)}>
              ⚠️ {taskCounts.scaduti} scaduti
            </button>
          )}

          {/* Mobile compact counters */}
          <button className="stat-pill text-xs md:hidden" style={{ background: 'rgba(139,92,246,0.2)', color: '#C4B5FD', cursor: 'pointer' }}
            onClick={e => openDrop('clp', e)}>
            🎬{taskCounts.clpDaFare}
          </button>
          <button className="stat-pill text-xs md:hidden" style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D', cursor: 'pointer' }}
            onClick={e => openDrop('task', e)}>
            📋{taskCounts.taskDaFare}
          </button>
          {taskCounts.urgenti > 0 && (
            <button className="stat-pill text-xs md:hidden" style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5', cursor: 'pointer' }}
              onClick={e => openDrop('urgenti', e)}>
              {taskCounts.urgenti}
            </button>
          )}
          {taskCounts.scaduti > 0 && (
            <button className="stat-pill text-xs md:hidden" style={{ background: 'rgba(239,68,68,0.3)', color: '#F87171', cursor: 'pointer' }}
              onClick={e => openDrop('scaduti', e)}>
              {taskCounts.scaduti}
            </button>
          )}

          {/* Dropdown lista — rendered via portal to avoid z-index issues */}
          {counterDrop && createPortal(<CounterDropdown
            tasks={tasks}
            team={team}
            tipo={counterDrop}
            onClose={() => setCounterDrop(null)}
            onClickTask={(taskId) => {
              setCounterDrop(null);
              setTab('kanban');
              if (onGoToTask) onGoToTask(taskId);
            }}
            onReassign={async (taskId, newDate, newPersona) => {
              const update: any = { scadenza: newDate };
              if (newPersona) update.assegnato_a = newPersona;
              await supabase.from('task').update(update).eq('id', taskId);
              if (onTaskReassigned) onTaskReassigned(taskId, newDate, newPersona);
            }}
            onArchive={async (taskId) => {
              await supabase.from('task').update({ stato: 'Archiviato' }).eq('id', taskId);
              const { data: calEvts } = await supabase.from('calendario')
                .select('id, descrizione')
                .like('descrizione', `%[TASK:${taskId}]%`);
              if (calEvts?.length) {
                for (const ev of calEvts) {
                  await supabase.from('calendario').delete().eq('id', ev.id);
                }
              }
              if (onTaskReassigned) onTaskReassigned(taskId, '', undefined);
            }}
            clpPubDates={clpPubDates}
            pos={dropPos}
          />, document.body)}

          {/* Google Drive storage indicator */}
          <div className="hidden md:block">
            <DriveStorageIndicator />
          </div>
        </div>

        {/* Admin: avatar team per filtrare kanban */}
        {isAdmin && tab === 'kanban' && (
          <div className="flex items-center gap-1 mx-3">
            <button
              onClick={() => onViewPersona(null)}
              className="text-xs px-2 py-1 rounded-md transition-colors"
              style={{
                background: personaView === null ? 'rgba(255,255,255,0.2)' : 'transparent',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              Tutti
            </button>
            {team.map(m => (
              <button
                key={m.id}
                title={m.nome}
                onClick={() => onViewPersona(personaView === m.nome ? null : m.nome)}
                className="rounded-full transition-all hover:opacity-100"
                style={{
                  opacity: personaView === m.nome || personaView === null ? 1 : 0.4,
                  transform: personaView === m.nome ? 'scale(1.15)' : 'scale(1)',
                  outline: personaView === m.nome ? `2px solid ${m.colore}` : 'none',
                  outlineOffset: 2,
                }}
              >
                <Avatar nome={m.nome} colore={m.colore} size={28} avatarUrl={m.avatar_url} />
              </button>
            ))}
          </div>
        )}

        {/* Orologio */}
        <div className="text-xs font-mono mx-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {orologio.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>

        {/* Upload indicator */}
        <div className="mr-1">
          <UploadIndicator />
        </div>

        {/* Campanella notifiche */}
        <div className="relative flex-shrink-0 mr-2">
          <button
            onClick={() => {
              setShowNotifiche(v => !v);
              setShowImpostazioni(false);
            }}
            className="relative p-1.5 rounded-lg transition-colors"
            style={{
              background: showNotifiche ? 'rgba(255,255,255,0.15)' : 'transparent',
            }}
            title="Notifiche"
          >
            <span className="text-base leading-none">🔔</span>
            {nonLette > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                style={{ background: 'hsl(var(--skorpio-accent))' }}
              >
                {nonLette > 9 ? '9+' : nonLette}
              </span>
            )}
          </button>

          {showNotifiche && (
            <NotificheDropdown onClose={() => setShowNotifiche(false)} />
          )}
        </div>

        {/* Utente loggato → apre Impostazioni */}
        <button
          onClick={() => {
            setShowImpostazioni(v => !v);
            setShowNotifiche(false);
          }}
          className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
          style={{ background: showImpostazioni ? 'rgba(255,255,255,0.15)' : 'transparent' }}
          title="Impostazioni"
        >
          <Avatar nome={utente?.nome || '?'} colore={utente?.colore || '#64748B'} size={28} avatarUrl={utente?.avatar_url} />
          <div className="text-left hidden sm:block">
            <p className="text-xs font-semibold text-white leading-none">{utente?.nome}</p>
            <p className="text-xs leading-none mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{utente?.label}</p>
          </div>
          <span className="text-xs ml-1 hidden sm:block" style={{ color: 'rgba(255,255,255,0.35)' }}>⚙️</span>
        </button>
      </div>

      {/* Tab bar — hidden on mobile, replaced by drawer */}
      <div className="skorpio-tabbar hidden lg:flex">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`skorpio-tab ${tab === t.id ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        onOpenImpostazioni={() => setShowImpostazioni(true)}
      />

      {/* Pannello Impostazioni */}
      {showImpostazioni && (
        <ImpostazioniPanel
          team={team}
          onTeamChange={(newTeam) => {
            onTeamChange(newTeam);
          }}
          onClose={() => setShowImpostazioni(false)}
        />
      )}
    </>
  );
}
