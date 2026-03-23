import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { TeamMember } from '../types';
import { Avatar } from './Avatar';
import { ImpostazioniPanel } from './ImpostazioniPanel';

interface TopBarProps {
  team: TeamMember[];
  taskCounts: { daFare: number; urgenti: number; scaduti: number };
  onViewPersona: (nome: string | null) => void;
  personaView: string | null;
  onTeamChange: (team: TeamMember[]) => void;
}

export function TopBar({ team, taskCounts, onViewPersona, personaView, onTeamChange }: TopBarProps) {
  const { utente, setUtente, tab, setTab } = useApp();
  const [orologio, setOrologio] = useState(new Date());
  const [showImpostazioni, setShowImpostazioni] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setOrologio(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Ascolta evento logout dal pannello impostazioni
  useEffect(() => {
    const fn = () => setUtente(null);
    document.addEventListener('skorpio:logout', fn);
    return () => document.removeEventListener('skorpio:logout', fn);
  }, [setUtente]);

  const isAdmin = utente?.ruolo === 'Admin';

  const tabs = [
    { id: 'kanban', label: '📋 Kanban' },
    { id: 'calendario', label: '📅 Calendario' },
    { id: 'creative', label: '🤖 Creative Engine' },
    { id: 'contenuti', label: '📹 Contenuti' },
    { id: 'clienti', label: '👥 Clienti' },
    { id: 'riprese', label: '🎬 Riprese' },
    { id: 'chat', label: '💬 Chat' },
  ];

  return (
    <>
      {/* Top bar */}
      <div className="skorpio-topbar">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4 flex-shrink-0">
          <span className="text-xl">🦂</span>
          <span className="font-bold text-white text-lg tracking-tight hidden sm:block">SKORPIO</span>
        </div>

        {/* Contatori */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="stat-pill text-xs" style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}>
            📋 {taskCounts.daFare} da fare
          </span>
          {taskCounts.urgenti > 0 && (
            <span className="stat-pill text-xs" style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
              🔴 {taskCounts.urgenti} urgenti
            </span>
          )}
          {taskCounts.scaduti > 0 && (
            <span className="stat-pill text-xs" style={{ background: 'rgba(239,68,68,0.3)', color: '#F87171' }}>
              ⚠️ {taskCounts.scaduti} scaduti
            </span>
          )}
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

        {/* Utente loggato → apre Impostazioni */}
        <button
          onClick={() => setShowImpostazioni(v => !v)}
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
