import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
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
  onViewPersona: (nome: string | null) => void;
  personaView: string | null;
  onTeamChange: (team: TeamMember[]) => void;
}

function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

type DropdownType = 'clp' | 'task' | 'urgenti' | 'scaduti' | null;

function CounterDropdown({ tasks, tipo, onClose }: { tasks: Task[]; tipo: DropdownType; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);

  const filtered = tipo === 'clp'
    ? tasks.filter(t => t.id_contenuto?.trim() && t.stato !== 'Completato')
    : tipo === 'task'
    ? tasks.filter(t => !t.id_contenuto?.trim() && t.stato !== 'Completato')
    : tipo === 'urgenti'
    ? tasks.filter(t => t.priorita === '🔴 Alta' && t.stato !== 'Completato')
    : tipo === 'scaduti'
    ? tasks.filter(t => t.scadenza && t.stato !== 'Completato' && parseLocalDate(t.scadenza) < oggi)
    : [];

  const label = tipo === 'clp' ? '🎬 CLP attivi' : tipo === 'task' ? '📋 Task attivi' : tipo === 'urgenti' ? '🔴 Urgenti' : '⚠️ Scaduti';
  const color = tipo === 'clp' ? '#8B5CF6' : tipo === 'task' ? '#F59E0B' : '#EF4444';

  return (
    <div ref={ref} className="absolute top-full left-0 mt-2 w-80 max-h-[400px] rounded-xl shadow-2xl border overflow-hidden z-[200]"
      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-xs font-bold" style={{ color }}>{label} ({filtered.length})</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="overflow-y-auto max-h-[350px]">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Nessun elemento</p>
        ) : (
          filtered.slice(0, 30).map(t => (
            <div key={t.id} className="px-3 py-2 border-b last:border-0 hover:bg-muted/50 transition-colors"
              style={{ borderColor: 'hsl(var(--border) / 0.5)' }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold flex-shrink-0" style={{ color }}>{t.id_display}</span>
                <span className="text-xs text-foreground truncate flex-1">{t.descrizione}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                  background: t.stato === 'Da fare' ? 'hsl(38 92% 50% / 0.1)' : t.stato === 'In lavorazione' ? 'hsl(214 80% 55% / 0.1)' : 'hsl(var(--muted))',
                  color: t.stato === 'Da fare' ? 'hsl(38 80% 40%)' : t.stato === 'In lavorazione' ? 'hsl(214 70% 44%)' : 'hsl(var(--muted-foreground))',
                }}>{t.stato}</span>
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
              </div>
            </div>
          ))
        )}
        {filtered.length > 30 && (
          <p className="text-[10px] text-center text-muted-foreground py-2">…e altri {filtered.length - 30}</p>
        )}
      </div>
    </div>
  );
}

export function TopBar({ team, taskCounts, tasks, onViewPersona, personaView, onTeamChange }: TopBarProps) {
  const { utente, tab, setTab, logout } = useApp();
  const [orologio, setOrologio] = useState(new Date());
  const [showImpostazioni, setShowImpostazioni] = useState(false);
  const [showNotifiche, setShowNotifiche] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [counterDrop, setCounterDrop] = useState<DropdownType>(null);
  const { nonLette } = useNotifiche(utente?.nome ?? null);

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

        {/* Contatori — desktop: full text, mobile: compact numbers */}
        <div className="flex items-center gap-2 flex-1 min-w-0 relative">
          {/* Desktop counters */}
          <span className="stat-pill text-xs hidden md:inline-flex cursor-pointer hover:opacity-80 transition-opacity"
            style={{ background: counterDrop === 'clp' ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.2)', color: '#C4B5FD' }}
            onClick={() => setCounterDrop(prev => prev === 'clp' ? null : 'clp')}>
            🎬 {taskCounts.clpDaFare} CLP
          </span>
          <span className="stat-pill text-xs hidden md:inline-flex cursor-pointer hover:opacity-80 transition-opacity"
            style={{ background: counterDrop === 'task' ? 'rgba(245,158,11,0.4)' : 'rgba(245,158,11,0.2)', color: '#FCD34D' }}
            onClick={() => setCounterDrop(prev => prev === 'task' ? null : 'task')}>
            📋 {taskCounts.taskDaFare} Task
          </span>
          {taskCounts.urgenti > 0 && (
            <span className="stat-pill text-xs hidden md:inline-flex cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: counterDrop === 'urgenti' ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.2)', color: '#FCA5A5' }}
              onClick={() => setCounterDrop(prev => prev === 'urgenti' ? null : 'urgenti')}>
              🔴 {taskCounts.urgenti} urgenti
            </span>
          )}
          {taskCounts.scaduti > 0 && (
            <span className="stat-pill text-xs hidden md:inline-flex cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: counterDrop === 'scaduti' ? 'rgba(239,68,68,0.45)' : 'rgba(239,68,68,0.3)', color: '#F87171' }}
              onClick={() => setCounterDrop(prev => prev === 'scaduti' ? null : 'scaduti')}>
              ⚠️ {taskCounts.scaduti} scaduti
            </span>
          )}

          {/* Mobile compact counters — just numbers */}
          <span className="stat-pill text-xs md:hidden cursor-pointer" style={{ background: 'rgba(139,92,246,0.2)', color: '#C4B5FD' }}
            onClick={() => setCounterDrop(prev => prev === 'clp' ? null : 'clp')}>
            🎬{taskCounts.clpDaFare}
          </span>
          <span className="stat-pill text-xs md:hidden cursor-pointer" style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}
            onClick={() => setCounterDrop(prev => prev === 'task' ? null : 'task')}>
            📋{taskCounts.taskDaFare}
          </span>
          {taskCounts.urgenti > 0 && (
            <span className="stat-pill text-xs md:hidden cursor-pointer" style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5' }}
              onClick={() => setCounterDrop(prev => prev === 'urgenti' ? null : 'urgenti')}>
              {taskCounts.urgenti}
            </span>
          )}
          {taskCounts.scaduti > 0 && (
            <span className="stat-pill text-xs md:hidden cursor-pointer" style={{ background: 'rgba(239,68,68,0.3)', color: '#F87171' }}
              onClick={() => setCounterDrop(prev => prev === 'scaduti' ? null : 'scaduti')}>
              {taskCounts.scaduti}
            </span>
          )}

          {/* Dropdown lista */}
          {counterDrop && <CounterDropdown tasks={tasks} tipo={counterDrop} onClose={() => setCounterDrop(null)} />}

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
