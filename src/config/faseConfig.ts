import type { FaseCLP } from '../types';

export interface FaseConfigEntry {
  color: string;
  bg: string;
  text: string;
  border: string;
  emoji: string;
  label: string;
}

export const FASE_CONFIG: Record<FaseCLP, FaseConfigEntry> = {
  'Idea':         { color: '#9E9E9E', bg: '#F1F5F9', text: '#64748B', border: '#CBD5E1', emoji: '💡', label: 'Idea' },
  'Script':       { color: '#F9A825', bg: '#FEF3C7', text: '#D97706', border: '#FDE68A', emoji: '📝', label: 'Script' },
  'Girato':       { color: '#2E7D32', bg: '#DCFCE7', text: '#16A34A', border: '#BBF7D0', emoji: '🎬', label: 'Girato' },
  'Pre montato':  { color: '#00ACC1', bg: '#CFFAFE', text: '#0E7490', border: '#A5F3FC', emoji: '✂️', label: 'Pre montato' },
  'Montato':      { color: '#7B1FA2', bg: '#EDE9FE', text: '#7C3AED', border: '#DDD6FE', emoji: '🎞️', label: 'Montato' },
  'Uploadato':    { color: '#FF8F00', bg: '#FEF9C3', text: '#A16207', border: '#FDE047', emoji: '☁️', label: 'Uploadato' },
  'Revisionato':  { color: '#AD1457', bg: '#FCE7F3', text: '#BE185D', border: '#FBCFE8', emoji: '👁️', label: 'Revisionato' },
  'Programmato':  { color: '#4A148C', bg: '#EDE9FE', text: '#6D28D9', border: '#C4B5FD', emoji: '📅', label: 'Programmato' },
  'Pubblicato':   { color: '#1565C0', bg: '#DBEAFE', text: '#1D4ED8', border: '#BFDBFE', emoji: '📤', label: 'Pubblicato' },
  'Scartata':     { color: '#C62828', bg: '#FEE2E2', text: '#DC2626', border: '#FECACA', emoji: '🚫', label: 'Scartata' },
} as const;

/** Ordered phase sequence for workflow transitions */
export const FASE_ORDER: FaseCLP[] = [
  'Idea', 'Script', 'Girato', 'Pre montato', 'Montato',
  'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato',
];

/** Allowed transitions: map of fase → array of valid next fasi */
export const FASE_TRANSITIONS: Record<string, string[]> = {
  'Idea':         ['Script', 'Girato', 'Scartata'],
  'Script':       ['Idea', 'Girato', 'Scartata'],
  'Girato':       ['Idea', 'Script', 'Pre montato', 'Scartata'],
  'Pre montato':  ['Girato', 'Montato', 'Scartata'],
  'Montato':      ['Girato', 'Pre montato', 'Uploadato', 'Scartata'],
  'Uploadato':    ['Girato', 'Pre montato', 'Montato', 'Revisionato', 'Scartata'],
  'Revisionato':  ['Girato', 'Pre montato', 'Montato', 'Programmato', 'Scartata'],
  'Programmato':  ['Girato', 'Pre montato', 'Montato', 'Revisionato', 'Pubblicato', 'Scartata'],
  'Pubblicato':   ['Scartata'],
  'Scartata':     ['Idea'],
};

/** Check if a phase transition is valid */
export function isTransitionValid(from: string, to: string): boolean {
  // Same phase = no-op, considered valid
  if (from === to) return true;
  const allowed = FASE_TRANSITIONS[from];
  if (!allowed) return false;
  // Also allow skipping forward (e.g. Idea → Girato via upload)
  const fromIdx = FASE_ORDER.indexOf(from as FaseCLP);
  const toIdx = FASE_ORDER.indexOf(to as FaseCLP);
  if (to === 'Scartata') return true;
  if (toIdx > fromIdx) return true; // forward is always allowed
  return allowed.includes(to);
}

/** Get the workflow task type that "lives" in a given phase */
export const FASE_TO_TASK_TIPO: Record<string, { tipo: string; keyword: string; emoji: string }> = {
  'Script':       { tipo: 'Scrittura script',     keyword: 'Giovanni',   emoji: '📝' },
  'Girato':       { tipo: 'Premontaggio',        keyword: 'Luca',       emoji: '🎬' },
  'Pre montato':  { tipo: 'Montaggio',            keyword: 'Alessandro', emoji: '✂️' },
  'Montato':      { tipo: 'Upload esportato',     keyword: 'Alessandro', emoji: '📤' },
  'Uploadato':    { tipo: 'Revisione montaggio',  keyword: 'Elisa',      emoji: '👁️' },
  'Revisionato':  { tipo: 'Programmazione',       keyword: 'Elisa',      emoji: '📅' },
};

/** Simple fase → tipo string mapping, derived from FASE_TO_TASK_TIPO */
export const FASE_TIPO_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FASE_TO_TASK_TIPO).map(([fase, { tipo }]) => [fase, tipo])
);

/** Centralised team member assignments per task type — DEFAULTS.
 *  Per Premontaggio/Montaggio/Upload, il valore viene sovrascritto
 *  da contenuti.assegnato_montaggio se impostato da Elisa. */
export const TEAM_ASSIGNMENTS: Record<string, string> = {
  'Scrittura script':    'Giovanni',
  'Premontaggio':        'Luca',       // default — override da assegnato_montaggio
  'Montaggio':           'Alessandro', // default — override da assegnato_montaggio
  'Upload esportato':    'Alessandro', // default — override da assegnato_montaggio
  'Revisione montaggio': 'Elisa',
  'Programmazione':      'Elisa',
  'Cleanup':             'Elisa',
  'Supervisione':        'Giovanni',
};

/** Lead times per tipo di contenuto (giorni prima della pubblicazione) */
export const LEAD_TIMES_BY_TIPO: Record<string, Record<string, number>> = {
  'Reel': { 'Scrittura script': 5, 'Premontaggio': 3, 'Montaggio': 2, 'Upload esportato': 1, 'Revisione montaggio': 1, 'Programmazione': 1 },
  'Showreel': { 'Scrittura script': 10, 'Premontaggio': 7, 'Montaggio': 5, 'Upload esportato': 3, 'Revisione montaggio': 2, 'Programmazione': 1 },
  'Post': { 'Scrittura script': 3, 'Premontaggio': 2, 'Montaggio': 1, 'Upload esportato': 1, 'Revisione montaggio': 1, 'Programmazione': 1 },
  'default': { 'Scrittura script': 7, 'Premontaggio': 5, 'Montaggio': 3, 'Upload esportato': 2, 'Revisione montaggio': 2, 'Programmazione': 1 },
};
