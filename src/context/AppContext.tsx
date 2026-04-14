import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
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

  // Sync Supabase session with auto-refresh retry
  const refreshRetries = useRef(0);
  const maxRetries = 3;

  useEffect(() => {
    // Strip expired access_token from URL to prevent stale session loops
    if (window.location.hash.includes('access_token=')) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const expiresAt = params.get('expires_at');
      if (expiresAt && Number(expiresAt) < Math.floor(Date.now() / 1000)) {
        console.warn('[Auth] Token nell\'URL scaduto — rimuovo hash');
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (session) {
        // Check if session is already expired
        if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) {
          console.warn('[Auth] Sessione scaduta, pulisco URL e riprovo');
          window.history.replaceState(null, '', window.location.pathname);
          supabase.auth.signOut();
          return;
        }
        setSession(session);
      } else if (window.location.hash.includes('access_token')) {
        // Token in URL but getSession failed — strip hash
        console.warn('[Auth] getSession fallito con token in URL — rimuovo hash');
        window.history.replaceState(null, '', window.location.pathname);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setSession(session);
        refreshRetries.current = 0; // Reset on success
      } else if (event === 'SIGNED_OUT') {
        // Explicit logout — clear everything
        setSession(null);
        setUtente(null);
      } else {
        // Session lost (expired, refresh failed) — retry before kicking out
        if (refreshRetries.current < maxRetries) {
          refreshRetries.current++;
          const delay = refreshRetries.current * 2000; // 2s, 4s, 6s
          console.warn(`[Auth] Sessione persa, retry ${refreshRetries.current}/${maxRetries} tra ${delay/1000}s…`);
          setTimeout(async () => {
            const { data, error } = await supabase.auth.refreshSession();
            if (data?.session) {
              console.log('[Auth] Sessione ripristinata!');
              setSession(data.session);
              refreshRetries.current = 0;
            } else {
              console.error('[Auth] Refresh fallito:', error?.message);
              // Will trigger onAuthStateChange again → next retry
            }
          }, delay);
        } else {
          console.error('[Auth] Max retries raggiunto — logout');
          setSession(null);
          setUtente(null);
        }
      }
    });

    // Proactive refresh every 50 minutes (token expires at 60 min)
    const refreshInterval = setInterval(async () => {
      const { data } = await supabase.auth.refreshSession();
      if (data?.session) {
        console.log('[Auth] Token refreshed proattivamente');
      }
    }, 50 * 60 * 1000);

    return () => { subscription.unsubscribe(); clearInterval(refreshInterval); };
  }, []);

  // Quando arriva una session, carica il profilo team corrispondente
  // Usa session.user.id come chiave per evitare ri-esecuzioni su TOKEN_REFRESHED
  useEffect(() => {
    if (!session?.user?.id) return;

    // Se l'utente è già caricato per questo stesso auth_user_id, non fare nulla
    if (utente && (utente as any).auth_user_id === session.user.id) return;

    const autoLink = async (attempt = 0) => {
      // 1. Cerca per auth_user_id già collegato
      const { data: byUid, error: uidErr } = await supabase
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

      // 3. Retry una volta dopo 1.5s (RLS / race condition)
      if (attempt < 2) {
        console.warn(`[AppContext] autoLink attempt ${attempt} failed, retrying...`);
        setTimeout(() => autoLink(attempt + 1), 1500);
        return;
      }

      // 4. Nessun match → SplashProfile (scelta manuale)
      console.warn('[AppContext] autoLink failed after retries, showing SplashProfile');
    };

    autoLink(0);
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
    };
    run();
    const interval = setInterval(run, 60 * 1000); // ogni 60 secondi per check preciso su orario
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
