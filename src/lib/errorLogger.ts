/**
 * SKORPIO Error Logger
 * Raccoglie tutti gli errori in DB `error_log` per debugging asincrono.
 * Installa listener globali per catturare errori non gestiti.
 */

import { supabase } from './supabase';

interface ErrorContext {
  tipo?: string;
  messaggio: string;
  stack?: string;
  component?: string;
  url?: string;
  user_nome?: string;
  contesto?: Record<string, unknown>;
}

let currentUserNome: string | null = null;

// Permette all'app di registrare chi è loggato (chiamato da AppContext)
export function setErrorLoggerUser(nome: string | null) {
  currentUserNome = nome;
}

/**
 * Log error al DB. Non blocca mai l'UI.
 * Usalo ovunque nel codice quando qualcosa fallisce.
 */
export async function logError(ctx: ErrorContext): Promise<void> {
  try {
    const payload = {
      tipo: ctx.tipo || 'generic',
      messaggio: (ctx.messaggio || 'Unknown error').slice(0, 500),
      stack: (ctx.stack || '').slice(0, 2000),
      component: (ctx.component || '').slice(0, 300),
      url: ctx.url || (typeof window !== 'undefined' ? window.location.href.slice(0, 500) : ''),
      user_nome: ctx.user_nome || currentUserNome || 'anonimo',
      contesto: ctx.contesto ? JSON.stringify(ctx.contesto).slice(0, 2000) : null,
    };
    await supabase.from('error_log').insert(payload);
  } catch {
    // Se logError stesso fallisce non fare niente (evita loop)
  }
}

/**
 * Installa listener globali per catturare errori non gestiti.
 * Chiamato UNA VOLTA all'avvio dell'app.
 */
let installed = false;
export function installGlobalErrorListeners() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 1. Errori JS non gestiti
  window.addEventListener('error', (event) => {
    logError({
      tipo: 'window_error',
      messaggio: event.message || 'Window error',
      stack: event.error?.stack,
      component: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  // 2. Promise rejection non gestite
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logError({
      tipo: 'unhandled_rejection',
      messaggio: (reason?.message || String(reason) || 'Unhandled rejection').slice(0, 500),
      stack: reason?.stack,
    });
  });

  // 3. Network errors (fetch failures) — wrap fetch globale
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const res = await origFetch(...args);
      // Log solo errori 4xx/5xx su edge functions (evita rumore)
      if (!res.ok && typeof args[0] === 'string' && args[0].includes('/functions/v1/')) {
        const url = args[0];
        const path = url.split('/functions/v1/')[1]?.split('?')[0] || '';
        logError({
          tipo: 'edge_function_error',
          messaggio: `Edge "${path}" returned ${res.status}`,
          component: path,
          contesto: { status: res.status, statusText: res.statusText },
        });
      }
      return res;
    } catch (err: any) {
      // Fetch fallito (network down, CORS, ecc.)
      if (typeof args[0] === 'string' && args[0].includes('/functions/v1/')) {
        logError({
          tipo: 'network_error',
          messaggio: err?.message || 'Network error',
          stack: err?.stack,
          component: args[0],
        });
      }
      throw err;
    }
  };
}
