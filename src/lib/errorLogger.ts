/**
 * SKORPIO Error Logger
 * Raccoglie tutti gli errori in DB `error_log` per debugging asincrono.
 * Installa listener globali per catturare errori non gestiti.
 * Mantiene breadcrumbs delle azioni utente per contesto.
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

interface Breadcrumb {
  t: number; // timestamp
  cat: string; // 'click' | 'nav' | 'action' | 'api'
  msg: string;
  data?: Record<string, unknown>;
}

let currentUserNome: string | null = null;
const breadcrumbs: Breadcrumb[] = [];
const MAX_BREADCRUMBS = 20;

// Deduplicazione — se stesso errore nei 30s, incrementa contatore invece di duplicare
const recentErrors = new Map<string, { count: number; lastAt: number }>();
const DEDUPE_WINDOW_MS = 30_000;

// Permette all'app di registrare chi è loggato
export function setErrorLoggerUser(nome: string | null) {
  currentUserNome = nome;
}

/**
 * Registra un breadcrumb (azione utente).
 * Chiamato automaticamente per click/nav, manualmente per azioni custom.
 */
export function breadcrumb(cat: string, msg: string, data?: Record<string, unknown>) {
  breadcrumbs.push({ t: Date.now(), cat, msg: msg.slice(0, 200), data });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

function getRecentBreadcrumbs(): Breadcrumb[] {
  return breadcrumbs.slice(-10);
}

function dedupeKey(ctx: ErrorContext): string {
  return `${ctx.tipo || 'generic'}::${(ctx.messaggio || '').slice(0, 100)}::${ctx.component || ''}`;
}

/**
 * Log error al DB. Non blocca mai l'UI.
 * Deduplicato: stesso errore entro 30s → incrementa contatore invece di nuova riga.
 */
export async function logError(ctx: ErrorContext): Promise<void> {
  try {
    const key = dedupeKey(ctx);
    const now = Date.now();
    const recent = recentErrors.get(key);

    if (recent && (now - recent.lastAt) < DEDUPE_WINDOW_MS) {
      // Dedupe: stesso errore recente → solo incrementa in memoria
      recent.count++;
      recent.lastAt = now;
      return;
    }
    recentErrors.set(key, { count: 1, lastAt: now });

    const contestoConBreadcrumbs = {
      ...(ctx.contesto || {}),
      _breadcrumbs: getRecentBreadcrumbs(),
    };

    const payload = {
      tipo: ctx.tipo || 'generic',
      messaggio: (ctx.messaggio || 'Unknown error').slice(0, 500),
      stack: (ctx.stack || '').slice(0, 2000),
      component: (ctx.component || '').slice(0, 300),
      url: ctx.url || (typeof window !== 'undefined' ? window.location.href.slice(0, 500) : ''),
      user_nome: ctx.user_nome || currentUserNome || 'anonimo',
      contesto: JSON.stringify(contestoConBreadcrumbs).slice(0, 4000),
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

  // Auto-breadcrumb: click globali (solo elementi semantici)
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t) return;
    const btn = t.closest('button, a, [role="button"]');
    if (btn) {
      const label = (btn.textContent || btn.getAttribute('aria-label') || '').trim().slice(0, 80);
      const id = btn.id ? `#${btn.id}` : '';
      if (label) breadcrumb('click', `${label}${id}`);
    }
  }, true);

  // Auto-breadcrumb: cambi tab (hashchange / popstate)
  window.addEventListener('popstate', () => {
    breadcrumb('nav', window.location.pathname + window.location.hash);
  });

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
    const urlStr = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    const isEdge = urlStr.includes('/functions/v1/');
    const isSupabaseREST = urlStr.includes('/rest/v1/');

    try {
      const res = await origFetch(...args);
      if (!res.ok && isEdge) {
        const path = urlStr.split('/functions/v1/')[1]?.split('?')[0] || '';
        // Leggi il body per avere più dettagli
        let errBody = '';
        try { errBody = (await res.clone().text()).slice(0, 500); } catch {}
        logError({
          tipo: 'edge_function_error',
          messaggio: `Edge "${path}" returned ${res.status}`,
          component: path,
          contesto: { status: res.status, statusText: res.statusText, body: errBody },
        });
      } else if (!res.ok && isSupabaseREST && res.status >= 500) {
        // Errori DB server-side (non 4xx che sono spesso normali)
        logError({
          tipo: 'supabase_server_error',
          messaggio: `Supabase REST returned ${res.status}`,
          component: urlStr.split('/rest/v1/')[1]?.split('?')[0] || '',
          contesto: { status: res.status },
        });
      }
      return res;
    } catch (err: any) {
      if (isEdge || isSupabaseREST) {
        logError({
          tipo: 'network_error',
          messaggio: err?.message || 'Network error',
          stack: err?.stack,
          component: urlStr.slice(0, 200),
        });
      }
      throw err;
    }
  };
}

