import React, { useEffect, useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { sounds } from '../lib/sounds';
import { useApp } from '../context/AppContext';
import type { TeamMember } from '../types';

/**
 * Mostrata quando l'utente è autenticato (session presente)
 * ma non ha ancora un profilo team collegato al proprio account.
 * Permette di "collegarsi" a un membro del team esistente,
 * oppure di aspettare che l'Admin li assegni.
 */
export function SplashProfile() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const { setUtente, session, logout } = useApp();

  useEffect(() => {
    supabase
      .from('team')
      .select('*')
      .is('auth_user_id', null)  // solo quelli non ancora collegati
      .order('created_at')
      .then(({ data }) => {
        setTeam((data as TeamMember[]) || []);
        setLoading(false);
      });
  }, []);

  const handleSelect = async (member: TeamMember) => {
    if (!session) return;
    setSelecting(member.id);
    sounds.login();

    // Collega auth_user_id al membro team
    const { error } = await supabase
      .from('team')
      .update({ auth_user_id: session.user.id })
      .eq('id', member.id);

    if (!error) {
      // Aggiorna/crea il profilo
      await supabase.from('profiles').upsert({
        auth_user_id: session.user.id,
        team_id: member.id,
      }, { onConflict: 'auth_user_id' });

      await new Promise(r => setTimeout(r, 600));
      setUtente({ ...member, auth_user_id: session.user.id } as TeamMember);
      setLinked(true);
    }
    setSelecting(null);
  };

  const ruoloColor: Record<string, string> = {
    Admin: '#F59E0B',
    Team: '#64748B',
  };

  if (linked) return null;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-8"
      style={{ background: 'linear-gradient(135deg, hsl(222 47% 8%) 0%, hsl(222 47% 14%) 100%)' }}
    >
      <div className="mb-10 text-center animate-fade-in">
        <div className="text-6xl mb-3 select-none">🦂</div>
        <h1 className="text-4xl font-bold text-white tracking-tight">SKORPIO</h1>
        <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Collega il tuo account al profilo team
        </p>
      </div>

      <p className="text-sm font-medium mb-6 uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
        Chi sei?
      </p>

      {loading ? (
        <div className="flex gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-40 h-52 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          ))}
        </div>
      ) : team.length === 0 ? (
        <div className="text-center max-w-sm">
          <p className="text-white/60 text-sm mb-4">
            Tutti i profili team sono già collegati, oppure l'Admin non ha ancora creato il tuo profilo.
          </p>
          <p className="text-white/40 text-xs">
            Contatta l'Admin per farti assegnare un profilo.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-5 justify-center animate-slide-up">
          {team.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelect(member)}
              disabled={selecting !== null}
              className="relative flex flex-col items-center gap-3 p-6 rounded-2xl cursor-pointer transition-all duration-200 text-center select-none"
              style={{
                background: selecting === member.id ? `${member.colore}30` : 'rgba(255,255,255,0.06)',
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
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-lg"
                style={{ backgroundColor: member.colore }}
              >
                {member.nome.charAt(0)}
              </div>
              <div>
                <p className="text-white font-semibold text-base">{member.nome}</p>
                <p className="text-xs mt-0.5" style={{ color: member.colore }}>{member.label}</p>
              </div>
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

      <button
        onClick={logout}
        className="mt-12 text-xs opacity-30 hover:opacity-60 transition-opacity"
        style={{ color: 'white' }}
      >
        ← Esci e usa un altro account
      </button>
    </div>
  );
}
