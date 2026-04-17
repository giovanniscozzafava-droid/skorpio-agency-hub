import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Only strip access_token from URL if it's a stale reload (localStorage already has a session).
// If no localStorage session exists, it's a fresh OAuth callback — let Supabase read it.
if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const hasStoredSession = !!localStorage.getItem(storageKey);

  if (hasStoredSession) {
    // Already have a session in storage — the URL hash is stale (bookmark/reload)
    console.warn('[Auth] Hash con token + sessione in storage → hash stale, rimuovo');
    window.location.hash = '';
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    // No stored session — this is a fresh OAuth callback, let Supabase handle it
    // [Auth] OAuth callback fresco
    // Clean hash after Supabase reads it
    setTimeout(() => {
      if (window.location.hash.includes('access_token=')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }, 2000);
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Realtime channel factory
export const getRealtimeChannel = (name: string) => {
  return supabase.channel(name);
};
