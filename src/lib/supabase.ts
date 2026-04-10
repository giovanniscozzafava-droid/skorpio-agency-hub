import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Check if URL has an EXPIRED access_token and strip it before Supabase reads it.
// Fresh tokens (from OAuth callback) are left for Supabase to handle normally.
let hasExpiredUrlToken = false;
if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
  try {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token') || '';
    const now = Math.floor(Date.now() / 1000);

    // Check expires_at param
    const expiresAt = params.get('expires_at');
    if (expiresAt && Number(expiresAt) < now) {
      hasExpiredUrlToken = true;
    }

    // Decode JWT (base64url → base64) and check exp
    if (!hasExpiredUrlToken && accessToken.includes('.')) {
      try {
        const b64url = accessToken.split('.')[1];
        const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64url.length % 4) % 4);
        const payload = JSON.parse(atob(b64));
        if (payload.exp && payload.exp < now) hasExpiredUrlToken = true;
      } catch {}
    }

    if (hasExpiredUrlToken) {
      console.warn('[Auth] Token scaduto nell\'URL — rimosso, mostro login');
      window.location.hash = '';
      window.history.replaceState(null, '', window.location.pathname);
    } else {
      // Fresh token — clean URL after Supabase reads it (2s delay)
      setTimeout(() => {
        if (window.location.hash.includes('access_token=')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }, 2000);
    }
  } catch (e) {
    console.error('[Auth] Errore check token URL:', e);
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Realtime channel factory
export const getRealtimeChannel = (name: string) => {
  return supabase.channel(name);
};
