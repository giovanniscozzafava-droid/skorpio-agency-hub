import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { TeamMember } from '../types';
import { supabase } from '../integrations/supabase/client';
import { checkAutoPubblica, syncMissingWorkflowTasks } from '../lib/clpWorkflow';

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
  // Usa session.user.id come chiave per evitare ri-esecuzioni su TOKEN_REFRESHED
  useEffect(() => {
    if (!session?.user?.id) return;

    // Se l'utente è già caricato per questo stesso auth_user_id, non fare nulla
    if (utente && (utente as any).auth_user_id === session.user.id) return;

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

        if (match) {
          // Collega automaticamente (anche se già aveva auth_user_id — potrebbe essere lo stesso)
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
  }, [session?.user?.id]);

  // ── Listener globale postMessage da popup OAuth Google ───────────────────
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'GDRIVE_CONNECTED' || e.data?.type === 'GCAL_CONNECTED') {
        // Ricarica il profilo utente dal DB per avere i token aggiornati
        if (utente) {
          const { data } = await supabase.from('team').select('*').eq('id', utente.id).single();
          if (data) setUtente(data as TeamMember);
        }
        const label = e.data.type === 'GDRIVE_CONNECTED' ? 'Google Drive' : 'Google Calendar';
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, msg: `✅ ${label} connesso con successo!`, tipo: 'success' }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [utente]);

  // ── Auto-pubblica CLPs + sync task mancanti (mount + ogni 5 min) ──
  useEffect(() => {
    const run = async () => {
      const n = await checkAutoPubblica();
      if (n > 0) {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, {
          id,
          msg: `🚀 ${n} contenuto${n > 1 ? 'i' : ''} auto-pubblicato${n > 1 ? 'i' : ''} — task cleanup creati per Elisa`,
          tipo: 'success'
        }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
      }
      // Sync missing workflow tasks for CLPs already in workflow phases
      const synced = await syncMissingWorkflowTasks();
      if (synced > 0) {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, {
          id,
          msg: `⚡ ${synced} task workflow creati automaticamente per CLP esistenti`,
          tipo: 'info'
        }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
      }
    };
    run();
    const interval = setInterval(run, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
