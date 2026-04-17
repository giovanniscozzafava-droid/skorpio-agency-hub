/**
 * devLog — logga solo se c'è ?debug=1 nell'URL o localStorage skorpio_debug = '1'
 * In produzione resta silente per non spammare la console.
 *
 * Uso: devLog('[Componente] messaggio', { dati });
 * Per attivare: aggiungi ?debug=1 all'URL, oppure in console:
 *   localStorage.setItem('skorpio_debug', '1')
 */
const isDebug = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location.search.includes('debug=1')) return true;
    return localStorage.getItem('skorpio_debug') === '1';
  } catch {
    return false;
  }
};

export const devLog = (...args: unknown[]): void => {
  if (isDebug()) console.log(...args);
};

export const devWarn = (...args: unknown[]): void => {
  if (isDebug()) console.warn(...args);
};

// Gli errori veri restano sempre visibili
export const devError = (...args: unknown[]): void => {
  console.error(...args);
};

// ── Role & permission helpers ──────────────────────────────────────────────
interface UtenteLike {
  nome?: string;
  ruolo?: string;
}

export const isManager = (utente: UtenteLike | null | undefined): boolean => {
  if (!utente) return false;
  return utente.ruolo === 'Admin' || utente.nome === 'Elisa';
};

export const canEditProgrammazione = (utente: UtenteLike | null | undefined): boolean => {
  if (!utente) return false;
  return utente.nome === 'Elisa' || utente.nome === 'Giovanni' || utente.ruolo === 'Admin';
};

export const isAdmin = (utente: UtenteLike | null | undefined): boolean => {
  return utente?.ruolo === 'Admin';
};
