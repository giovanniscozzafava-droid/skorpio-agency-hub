import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { TeamMember } from '../types';
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
  taskCounts: { daFare: number; urgenti: number; scaduti: number };
  onViewPersona: (nome: string | null) => void;
  personaView: string | null;
  onTeamChange: (team: TeamMember[]) => void;
}

export function TopBar({ team, taskCounts, onViewPersona, personaView, onTeamChange }: TopBarProps) {
  const { utente, tab, setTab, logout } = useApp();
  const [orologio, setOrologio] = useState(new Date());
  const [showImpostazioni, setShowImpostazioni] = useState(false);
  const [showNotifiche, setShowNotifiche] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
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
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Desktop counters */}
          <span className="stat-pill text-xs hidden md:inline-flex" style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}>
            📋 {taskCounts.daFare} da fare
          </span>
          {taskCounts.urgenti > 0 && (
            <span className="stat-pill text-xs hidden md:inline-flex" style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
              🔴 {taskCounts.urgenti} urgenti
            </span>
          )}
          {taskCounts.scaduti > 0 && (
            <span className="stat-pill text-xs hidden md:inline-flex" style={{ background: 'rgba(239,68,68,0.3)', color: '#F87171' }}>
              ⚠️ {taskCounts.scaduti} scaduti
            </span>
          )}

          {/* Mobile compact counters — just numbers */}
          <span className="stat-pill text-xs md:hidden" style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}>
            {taskCounts.daFare}
          </span>
          {taskCounts.urgenti > 0 && (
            <span className="stat-pill text-xs md:hidden" style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
              {taskCounts.urgenti}
            </span>
          )}
          {taskCounts.scaduti > 0 && (
            <span className="stat-pill text-xs md:hidden" style={{ background: 'rgba(239,68,68,0.3)', color: '#F87171' }}>
              {taskCounts.scaduti}
            </span>
          )}

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
                <Avatar nome={m.nome} colore={m.colore} size={28} />
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
          <Avatar nome={utente?.nome || '?'} colore={utente?.colore || '#64748B'} size={28} />
          <div className="text-left hidden sm:block">
            <p className="text-xs font-semibold text-white leading-none">{utente?.nome}</p>
            <p className="text-xs leading-none mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{utente?.label}</p>
          </div>
          <span className="text-xs ml-1 hidden sm:block" style={{ color: 'rgba(255,255,255,0.35)' }}>⚙️</span>
        </button>
      </div>

      {/* Tab bar */}
      <div className="skorpio-tabbar">
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
