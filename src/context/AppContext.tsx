import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { TeamMember } from '../types';
import { supabase } from '../integrations/supabase/client';
import { checkAutoPubblica } from '../lib/clpWorkflow';

interface AppContextType {
  utente: TeamMember | null;
  setUtente: (u: TeamMember | null) => void;
  session: Session | null;
  tab: string;
  setTab: (t: string) => void;
  toasts: ToastItem[];
  addToast: (msg: string, tipo?: 'info' | 'success' | 'error' | 'warn') => void;
  removeToast: (id: string) => void;
  logout: () => Promise<void>;
}

export interface ToastItem {
  id: string;
  msg: string;
  tipo: 'info' | 'success' | 'error' | 'warn';
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<TeamMember | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState('kanban');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Sync Supabase session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setUtente(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Quando arriva una session, carica il profilo team corrispondente
  useEffect(() => {
    if (!session) return;

    const autoLink = async () => {
      // 1. Cerca per auth_user_id già collegato
      const { data: byUid } = await supabase
        .from('team')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      if (byUid) {
        setUtente(byUid as TeamMember);
        return;
      }

      // 2. Prova auto-match: estrai il nome dall'email (es. giovanni@fuyue.it → "giovanni")
      //    e cerca un team member il cui nome (case-insensitive) inizia con quella stringa
      const emailLocal = (session.user.email ?? '').split('@')[0].toLowerCase().trim();
      if (emailLocal) {
        const { data: allTeam } = await supabase.from('team').select('*');
        const match = (allTeam ?? []).find((m: any) =>
          m.nome.toLowerCase().startsWith(emailLocal) ||
          emailLocal.startsWith(m.nome.toLowerCase())
        );

        if (match && !match.auth_user_id) {
          // Collega automaticamente
          await supabase.from('team').update({ auth_user_id: session.user.id }).eq('id', match.id);
          await supabase.from('profiles').upsert(
            { auth_user_id: session.user.id, team_id: match.id },
            { onConflict: 'auth_user_id' }
          );
          setUtente({ ...match, auth_user_id: session.user.id } as TeamMember);
          return;
        }
      }

      // 3. Nessun match → SplashProfile (scelta manuale)
    };

    autoLink();
  }, [session]);

  const addToast = (msg: string, tipo: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, msg, tipo }]);
    setTimeout(() => removeToast(id), 3000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUtente(null);
    setSession(null);
  };

  return (
    <AppContext.Provider value={{ utente, setUtente, session, tab, setTab, toasts, addToast, removeToast, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
