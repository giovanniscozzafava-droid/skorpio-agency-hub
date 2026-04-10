import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Strip expired access_token from URL BEFORE Supabase reads it.
if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
  try {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token') || '';
    const now = Math.floor(Date.now() / 1000);
    let isExpired = false;

    // Method 1: check expires_at param in URL
    const expiresAt = params.get('expires_at');
    if (expiresAt && Number(expiresAt) < now) {
      isExpired = true;
    }

    // Method 2: decode JWT (base64url → base64) and check exp claim
    if (!isExpired && accessToken.includes('.')) {
      try {
        const b64url = accessToken.split('.')[1];
        // base64url → base64: replace - with +, _ with /, add padding
        const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64url.length % 4) % 4);
        const payload = JSON.parse(atob(b64));
        if (payload.exp && payload.exp < now) {
          isExpired = true;
        }
      } catch (e) {
        console.warn('[Supabase] JWT decode fallito:', e);
      }
    }

    if (isExpired) {
      console.warn('[Supabase] Token scaduto nell\'URL — rimosso prima dell\'init');
      window.location.hash = '';
      window.history.replaceState(null, '', window.location.pathname);
    } else {
      // Token valido — pulisci hash dopo che Supabase lo legge (1s)
      setTimeout(() => {
        if (window.location.hash.includes('access_token=')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }, 2000);
    }
  } catch (e) {
    console.error('[Supabase] Errore check token URL:', e);
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Realtime channel factory
export const getRealtimeChannel = (name: string) => {
  return supabase.channel(name);
};
