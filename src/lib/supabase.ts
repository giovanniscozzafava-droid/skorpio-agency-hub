import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Disable Supabase auto URL token detection to prevent stale token loops.
// We handle it manually below.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: false,
  },
});

// Manually handle OAuth callback: if URL has a FRESH access_token, set it.
// If expired, strip it. This runs AFTER createClient so Supabase is ready.
if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
  (async () => {
    try {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token') || '';
      const refreshToken = params.get('refresh_token') || '';
      const now = Math.floor(Date.now() / 1000);
      let isExpired = false;

      // Decode JWT (base64url → base64) and check exp
      if (accessToken.includes('.')) {
        try {
          const b64url = accessToken.split('.')[1];
          const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64url.length % 4) % 4);
          const payload = JSON.parse(atob(b64));
          if (payload.exp && payload.exp < now) isExpired = true;
        } catch {}
      }

      // Also check expires_at param
      const expiresAt = params.get('expires_at');
      if (expiresAt && Number(expiresAt) < now) isExpired = true;

      if (isExpired) {
        console.warn('[Auth] Token scaduto nell\'URL — ignorato, mostro login');
      } else if (accessToken && refreshToken) {
        // Fresh token from OAuth callback — set session manually
        console.log('[Auth] Token fresco nell\'URL — imposto sessione');
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }

      // Always clean hash from URL
      window.history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      console.error('[Auth] Errore gestione token URL:', e);
      window.history.replaceState(null, '', window.location.pathname);
    }
  })();
}

// Realtime channel factory
export const getRealtimeChannel = (name: string) => {
  return supabase.channel(name);
};
