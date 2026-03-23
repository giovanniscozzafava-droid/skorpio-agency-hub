import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';
import { useApp } from '../context/AppContext';
import type { TeamMember } from '../types';

export function SplashScreen() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const { setUtente } = useApp();

  useEffect(() => {
    supabase
      .from('team')
      .select('*')
      .order('created_at')
      .then(({ data }) => {
        setTeam(data || []);
        setLoading(false);
      });
  }, []);

  const handleLogin = async (member: TeamMember) => {
    setSelecting(member.id);
    sounds.login();
    await new Promise(r => setTimeout(r, 600));
    setUtente(member);
  };

  const ruoloColor: Record<string, string> = {
    Admin: '#F59E0B',
    Team: '#64748B',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8"
      style={{ background: 'linear-gradient(135deg, hsl(222 47% 8%) 0%, hsl(222 47% 14%) 100%)' }}>
      
      {/* Logo */}
      <div className="mb-12 text-center animate-fade-in">
        <div className="text-7xl mb-3 select-none">🦂</div>
        <h1 className="text-5xl font-bold text-white tracking-tight">SKORPIO</h1>
        <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Fuyue Digital Agency — Gestionale Interno
        </p>
      </div>

      {/* Titolo */}
      <p className="text-sm font-medium mb-6 uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
        Chi sei?
      </p>

      {/* Team cards */}
      {loading ? (
        <div className="flex gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-40 h-52 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-5 justify-center animate-slide-up">
          {team.map((member) => (
            <button
              key={member.id}
              onClick={() => handleLogin(member)}
              disabled={selecting !== null}
              className="relative flex flex-col items-center gap-3 p-6 rounded-2xl cursor-pointer transition-all duration-200 text-center select-none"
              style={{
                background: selecting === member.id 
                  ? `${member.colore}30` 
                  : 'rgba(255,255,255,0.06)',
                border: `2px solid ${selecting === member.id ? member.colore : 'rgba(255,255,255,0.1)'}`,
                transform: selecting === member.id ? 'scale(1.05)' : 'scale(1)',
                minWidth: 148,
              }}
              onMouseEnter={e => {
                if (!selecting) {
                  (e.currentTarget as HTMLButtonElement).style.background = `${member.colore}20`;
                  (e.currentTarget as HTMLButtonElement).style.border = `2px solid ${member.colore}80`;
                }
              }}
              onMouseLeave={e => {
                if (!selecting) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
                  (e.currentTarget as HTMLButtonElement).style.border = '2px solid rgba(255,255,255,0.1)';
                }
              }}
            >
              {/* Avatar */}
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-lg"
                style={{ backgroundColor: member.colore }}
              >
                {member.nome.charAt(0)}
              </div>

              {/* Nome */}
              <div>
                <p className="text-white font-semibold text-base">{member.nome}</p>
                <p className="text-xs mt-0.5" style={{ color: member.colore }}>
                  {member.label}
                </p>
              </div>

              {/* Ruolo badge */}
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: `${ruoloColor[member.ruolo] || '#64748B'}20`,
                  color: ruoloColor[member.ruolo] || '#64748B',
                  border: `1px solid ${ruoloColor[member.ruolo] || '#64748B'}40`,
                }}
              >
                {member.ruolo}
              </span>

              {/* Spinner se sta facendo login */}
              {selecting === member.id && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl"
                  style={{ background: 'rgba(0,0,0,0.3)' }}>
                  <div className="sk-spinner" style={{ color: member.colore }} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Footer */}
      <p className="mt-16 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
        v1.0 — {new Date().getFullYear()} Fuyue Digital Agency
      </p>
    </div>
  );
}
