import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { NuovoTaskModal } from './NuovoTaskModal';
import { creaTaskWorkflow, completaTaskPerContenuto, findMembro } from '../lib/clpWorkflow';
import type { CalendarioEvent, Contenuto, MarketingEvent, TeamMember, Cliente, Task } from '../types';
import { parseLocalDate, toDateStr, isSameDay, addDays } from '../lib/dateUtils';
import { useIsMobile } from '../hooks/use-mobile';

// ─── Constants ──────────────────────────────────────────────────────────────
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const GIORNI_FULL = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// Google Calendar-style category colors
const TIPO_STYLE: Record<string, { bg: string; border: string; icon: string; label: string; dot: string }> = {
  pubblicazione:    { bg: '#E8F5E9', border: '#2E7D32', icon: '📤', label: 'Pubblicazione', dot: '#2E7D32' },
  appuntamento:     { bg: '#FFF3E0', border: '#E65100', icon: '📅', label: 'Appuntamento',  dot: '#E65100' },
  contenuto:        { bg: '#F3E5F5', border: '#7B1FA2', icon: '🎬', label: 'Contenuto',     dot: '#7B1FA2' },
  slot_pianificato: { bg: '#FFFDE7', border: '#F9A825', icon: '📝', label: 'Slottato',      dot: '#F9A825' },
};

// Workflow task sub-colors based on tipo_contenuto (task type)
const WORKFLOW_STYLES: Record<string, { bg: string; border: string; icon: string; label: string; dot: string }> = {
  'Premontaggio':  { bg: '#E3F2FD', border: '#1565C0', icon: '🎬', label: 'Pre montaggio',  dot: '#1565C0' },
  'Montaggio':     { bg: '#EDE7F6', border: '#5E35B1', icon: '✂️', label: 'Montaggio',       dot: '#5E35B1' },
  'Revisione':     { bg: '#FCE4EC', border: '#C62828', icon: '👁️', label: 'Revisione',       dot: '#C62828' },
  'Cleanup':       { bg: '#ECEFF1', border: '#546E7A', icon: '🧹', label: 'Cleanup',         dot: '#546E7A' },
};
const WORKFLOW_DEFAULT = { bg: '#E3F2FD', border: '#1565C0', icon: '⚙️', label: 'Task Workflow', dot: '#1565C0' };

const MARKETING_COLOR: Record<string, string> = {
  fest: '#F97316', gm: '#0D9488', mkt: '#DC2626', sport: '#2563EB', cult: '#7C3AED',
};
const MARKETING_LABEL: Record<string, string> = {
  fest: '🎉', gm: '🌍', mkt: '🛒', sport: '⚽', cult: '🎭',
};

const FASE_COLORS: Record<string, string> = {
  Idea: '#94A3B8', Script: '#F59E0B', Girato: '#22C55E', 'Pre montato': '#06B6D4',
  Montato: '#8B5CF6', Revisione: '#EC4899', Programmato: '#7C3AED',
  Pubblicato: '#3B82F6', Scartata: '#EF4444',
};

const RICORRENZA_OPTIONS = [
  { value: '', label: 'Nessuna' },
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'biweekly', label: 'Ogni 2 settimane' },
  { value: 'monthly', label: 'Ogni mese' },
];

const WEEKDAY_LABELS = [
  { key: 'mon', label: 'L' }, { key: 'tue', label: 'M' }, { key: 'wed', label: 'Me' },
  { key: 'thu', label: 'G' }, { key: 'fri', label: 'V' }, { key: 'sat', label: 'S' }, { key: 'sun', label: 'D' },
];

type DesktopVista = 'mese' | 'settimana' | 'giorno' | 'agenda';
type MobileVista = 'agenda' | 'giorno' | '3giorni' | 'settimana' | 'mese';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function startOfWeekMon(d: Date) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function formatTime(t: string | null) {
  if (!t) return '';
  return t.slice(0, 5);
}

function getDayIndex(d: Date) {
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}

function getEventStyle(ev: CalendarioEvent) {
  if (ev.tipo === 'appuntamento' && ev.descrizione?.includes('[TASK:')) {
    return WORKFLOW_STYLES[ev.tipo_contenuto] || WORKFLOW_DEFAULT;
  }
  return TIPO_STYLE[ev.tipo] || TIPO_STYLE.appuntamento;
}

function isEventScaduto(ev: CalendarioEvent, oggi: Date) {
  return ev.data < toDateStr(oggi) && ev.stato !== 'Completato';
}

function isEventCompletato(ev: CalendarioEvent) {
  return ev.stato === 'Completato';
}

function getHourFromTime(t: string | null): number {
  if (!t) return -1;
  return parseInt(t.slice(0, 2));
}

function getMinuteFromTime(t: string | null): number {
  if (!t) return 0;
  return parseInt(t.slice(3, 5));
}

// ─── Countdown Helper ────────────────────────────────────────────────────────
function getCountdown(ev: CalendarioEvent, now: Date): { text: string; color: string; level: 'green' | 'yellow' | 'red' | 'scaduto' } | null {
  if (isEventCompletato(ev)) return null;
  const evDate = parseLocalDate(ev.data);
  if (ev.ora) {
    const [h, m] = ev.ora.split(':').map(Number);
    evDate.setHours(h, m, 0, 0);
  } else {
    evDate.setHours(23, 59, 59, 999);
  }

  const diffMs = evDate.getTime() - now.getTime();
  if (diffMs < 0) return { text: 'SC', color: '#EF4444', level: 'scaduto' };

  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffH / 24);
  const remainH = diffH % 24;

  if (diffD > 3) return { text: `${diffD}g`, color: '#16A34A', level: 'green' };
  if (diffD >= 1) return { text: `${diffD}g ${remainH}h`, color: '#F59E0B', level: 'yellow' };
  if (diffH > 0) return { text: `${diffH}h`, color: '#EF4444', level: 'red' };
  const diffMin = Math.floor(diffMs / (1000 * 60));
  return { text: `${diffMin}min`, color: '#EF4444', level: 'red' };
}

// Countdown badge component
function CountdownBadge({ ev, now, size = 'sm' }: { ev: CalendarioEvent; now: Date; size?: 'sm' | 'md' }) {
  const cd = getCountdown(ev, now);
  if (!cd) return null;
  const isSmall = size === 'sm';
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-semibold rounded shrink-0 ${isSmall ? 'text-[9px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5'}`}
      style={{ background: cd.color + '18', color: cd.color }}
    >
      {cd.level === 'scaduto' ? '🔴' : '⏰'} {cd.text}
    </span>
  );
}

// ─── Search Dropdown ─────────────────────────────────────────────────────────
function SearchDropdown({ query, eventi, onSelect, onClose }: {
  query: string; eventi: CalendarioEvent[];
  onSelect: (ev: CalendarioEvent) => void; onClose: () => void;
}) {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 2) return null;
  const results = eventi.filter(ev => {
    return (ev.descrizione || '').toLowerCase().includes(q) ||
      (ev.cliente_nome || '').toLowerCase().includes(q) ||
      (ev.persona || '').toLowerCase().includes(q) ||
      (ev.tipo || '').toLowerCase().includes(q);
  }).slice(0, 8);

  if (results.length === 0) return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 p-3">
      <p className="text-xs text-muted-foreground">Nessun risultato</p>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
        {results.map(ev => {
          const s = getEventStyle(ev);
          const d = parseLocalDate(ev.data);
          return (
            <button key={ev.id} onClick={() => { onSelect(ev); onClose(); }}
              className="w-full text-left px-3 py-2 hover:bg-accent/50 flex items-center gap-2 border-b last:border-b-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.border }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
                <div className="text-[10px] text-muted-foreground">
                  {d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                  {ev.cliente_nome && ` · ${ev.cliente_nome}`}
                  {ev.persona && ` · ${ev.persona}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ─── Mini Calendar (Sidebar) ────────────────────────────────────────────────
function MiniCalendar({ year, month, oggi, selectedDate, onDateSelect, onMonthChange }: {
  year: number; month: number; oggi: Date; selectedDate: Date;
  onDateSelect: (d: Date) => void;
  onMonthChange: (dir: -1 | 1) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => onMonthChange(-1)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent text-xs">◀</button>
        <span className="text-sm font-semibold">{MESI[month].slice(0, 3)} {year}</span>
        <button onClick={() => onMonthChange(1)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent text-xs">▶</button>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {GIORNI.map(g => (
          <div key={g} className="text-center text-[10px] font-medium text-muted-foreground py-1">{g.charAt(0)}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="w-7 h-7" />;
          const isToday = isSameDay(d, oggi);
          const isSelected = isSameDay(d, selectedDate);
          return (
            <button
              key={toDateStr(d)}
              onClick={() => onDateSelect(d)}
              className={`w-7 h-7 text-xs rounded-full flex items-center justify-center transition-colors
                ${isSelected ? 'bg-primary text-primary-foreground' : isToday ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-accent text-foreground'}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sidebar Filters (with workflow categories) ─────────────────────────────
function SidebarFilters({
  categories, toggleCategory, operators, toggleOperator, team
}: {
  categories: Record<string, boolean>;
  toggleCategory: (k: string) => void;
  operators: Record<string, boolean>;
  toggleOperator: (name: string) => void;
  team: TeamMember[];
}) {
  const allCategories = [
    ...Object.entries(TIPO_STYLE).map(([k, v]) => ({ key: k, ...v })),
    ...Object.entries(WORKFLOW_STYLES).map(([k, v]) => ({ key: `wf_${k}`, ...v })),
    { key: 'marketing', bg: '#FFF7ED', border: '#F97316', icon: '📌', label: 'Marketing', dot: '#F97316' },
  ];

  return (
    <>
      <div className="border-t pt-3 mt-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">📂 Categorie</div>
        <div className="space-y-1.5">
          {allCategories.map(v => (
            <label key={v.key} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <input type="checkbox" checked={categories[v.key] !== false} onChange={() => toggleCategory(v.key)} className="sr-only" />
              <span className="w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center"
                style={{ borderColor: v.dot, background: categories[v.key] !== false ? v.dot : 'transparent' }}>
                {categories[v.key] !== false && <span className="text-white text-[8px]">✓</span>}
              </span>
              <span>{v.icon} {v.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t pt-3 mt-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">👥 Operatori</div>
        <div className="space-y-1.5">
          {team.map(m => (
            <label key={m.id} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <input type="checkbox" checked={operators[m.nome] !== false} onChange={() => toggleOperator(m.nome)} className="sr-only" />
              <span className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                style={{ borderColor: m.colore, background: operators[m.nome] !== false ? m.colore : 'transparent' }}>
                {operators[m.nome] !== false && <span className="text-white text-[8px]">✓</span>}
              </span>
              <span>{m.nome}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Desktop Agenda View ────────────────────────────────────────────────────
function DesktopAgendaView({ eventi, marketing, oggi, onEventClick, now }: {
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
  now: Date;
}) {
  const allDates = new Set<string>();
  eventi.forEach(e => allDates.add(e.data));
  marketing.forEach(e => allDates.add(e.data));

  const todayStr = toDateStr(oggi);
  if (!allDates.has(todayStr)) allDates.add(todayStr);

  const sortedDates = Array.from(allDates).sort();
  const pastCutoff = toDateStr(addDays(oggi, -14));
  const futureCutoff = toDateStr(addDays(oggi, 60));
  const visibleDates = sortedDates.filter(d => d >= pastCutoff && d <= futureCutoff);

  if (visibleDates.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">Nessun evento in programma</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {visibleDates.map(dateStr => {
        const d = parseLocalDate(dateStr);
        const isToday = isSameDay(d, oggi);
        const dayEvents = eventi.filter(e => e.data === dateStr).sort((a, b) => (a.ora || '').localeCompare(b.ora || ''));
        const dayMkt = marketing.filter(e => {
          if (e.data === dateStr) return true;
          if (e.data_fine && e.data <= dateStr && e.data_fine >= dateStr) return true;
          return false;
        });

        if (dayEvents.length === 0 && dayMkt.length === 0) return null;

        return (
          <div key={dateStr} className="border-b last:border-b-0">
            <div className="flex items-start py-3 px-4">
              <div className={`w-24 shrink-0 pt-0.5 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                <div className="text-xs font-medium">{GIORNI_FULL[getDayIndex(d)].slice(0, 3)}</div>
                <div className={`text-2xl font-bold leading-tight ${isToday ? 'text-primary' : ''}`}>{d.getDate()}</div>
                <div className="text-xs">{MESI[d.getMonth()].slice(0, 3)}</div>
              </div>

              <div className="flex-1 space-y-1.5">
                {dayMkt.map(m => {
                  const color = MARKETING_COLOR[m.categoria] || '#F97316';
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: '#FFF7ED' }}>
                      <span className="text-sm">{MARKETING_LABEL[m.categoria]}</span>
                      <span className="text-sm font-medium" style={{ color }}>{m.titolo}</span>
                    </div>
                  );
                })}
                {dayEvents.map(ev => {
                  const s = getEventStyle(ev);
                  const scaduto = isEventScaduto(ev, oggi);
                  const completato = isEventCompletato(ev);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => onEventClick(ev)}
                      className={`flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer hover:shadow-sm transition-all ${completato ? 'opacity-50 line-through' : ''}`}
                      style={{ background: s.bg, borderLeft: `4px solid ${scaduto ? '#EF4444' : s.border}` }}
                    >
                      <span className="text-xs font-mono w-12 shrink-0 text-muted-foreground">
                        {ev.ora ? formatTime(ev.ora) : '—'}
                      </span>
                      <span className="text-sm">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</span>
                        {ev.cliente_nome && <span className="text-xs text-muted-foreground ml-2">· {ev.cliente_nome}</span>}
                      </div>
                      {ev.persona && (
                        <span className="text-xs text-muted-foreground shrink-0">{ev.persona}</span>
                      )}
                      <CountdownBadge ev={ev} now={now} size="md" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Desktop Day View (timeline with resize) ────────────────────────────────
function DesktopDayView({ date, eventi, marketing, oggi, onEventClick, onSlotClick, onEventDrop, dragEvId, setDragEvId, now, onQuickCreate, onResize }: {
  date: Date;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
  onSlotClick: (date: Date, hour: number) => void;
  onEventDrop: (evId: string, newDate: string, newHour?: number) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
  now: Date;
  onQuickCreate: (date: Date, startHour: number, endHour: number) => void;
  onResize: (evId: string, newEndTime: string) => void;
}) {
  const dateStr = toDateStr(date);
  const isToday = isSameDay(date, oggi);
  const dayEvents = eventi.filter(e => e.data === dateStr);
  const dayMkt = marketing.filter(e => {
    if (e.data === dateStr) return true;
    if (e.data_fine && e.data <= dateStr && e.data_fine >= dateStr) return true;
    return false;
  });

  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  const noTimeEvents = dayEvents.filter(e => !e.ora);
  const timedEvents = dayEvents.filter(e => !!e.ora);

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const showRedLine = isToday && currentHour >= 6 && currentHour <= 22;
  const redLineTop = showRedLine ? (currentHour - 6) * 60 + currentMinute : -1;

  const [dropHour, setDropHour] = useState<number | null>(null);
  const [dragCreateStart, setDragCreateStart] = useState<number | null>(null);
  const [dragCreateEnd, setDragCreateEnd] = useState<number | null>(null);
  const [resizingEv, setResizingEv] = useState<string | null>(null);
  const [resizeHour, setResizeHour] = useState<number | null>(null);

  const handleMouseDown = (h: number) => {
    if (!dragEvId) setDragCreateStart(h);
  };
  const handleMouseEnter = (h: number) => {
    if (dragCreateStart !== null && !dragEvId) setDragCreateEnd(h);
    if (resizingEv) setResizeHour(h + 1);
  };
  const handleMouseUp = (h: number) => {
    if (dragCreateStart !== null && !dragEvId) {
      const startH = Math.min(dragCreateStart, h);
      const endH = Math.max(dragCreateStart, h) + 1;
      if (endH > startH) onQuickCreate(date, startH, endH);
      setDragCreateStart(null);
      setDragCreateEnd(null);
    }
    if (resizingEv && resizeHour !== null) {
      const newEnd = `${resizeHour.toString().padStart(2, '0')}:00`;
      onResize(resizingEv, newEnd);
      setResizingEv(null);
      setResizeHour(null);
    }
  };

  const isDragCreating = dragCreateStart !== null && dragCreateEnd !== null;
  const dcMin = isDragCreating ? Math.min(dragCreateStart!, dragCreateEnd!) : -1;
  const dcMax = isDragCreating ? Math.max(dragCreateStart!, dragCreateEnd!) : -1;

  return (
    <div className="flex-1 overflow-y-auto" onMouseUp={() => { setDragCreateStart(null); setDragCreateEnd(null); if (resizingEv) { setResizingEv(null); setResizeHour(null); } }}>
      <div className={`text-center py-3 border-b sticky top-0 z-10 ${isToday ? 'bg-primary/5' : 'bg-white'}`}>
        <div className="text-xs text-muted-foreground">{GIORNI_FULL[getDayIndex(date)]}</div>
        <div className={`text-3xl font-bold mt-0.5 w-12 h-12 mx-auto flex items-center justify-center rounded-full
          ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
          {date.getDate()}
        </div>
        <div className="text-xs text-muted-foreground">{MESI[date.getMonth()]} {date.getFullYear()}</div>
      </div>

      {(noTimeEvents.length > 0 || dayMkt.length > 0) && (
        <div className="border-b px-4 py-2 bg-muted/20">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Tutto il giorno</div>
          <div className="flex flex-wrap gap-1.5">
            {dayMkt.map(m => {
              const color = MARKETING_COLOR[m.categoria] || '#F97316';
              return (
                <div key={m.id} className="text-xs rounded px-2 py-1" style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}>
                  {MARKETING_LABEL[m.categoria]} {m.titolo}
                </div>
              );
            })}
            {noTimeEvents.map(ev => {
              const s = getEventStyle(ev);
              const completato = isEventCompletato(ev);
              return (
                <div key={ev.id} onClick={() => onEventClick(ev)}
                  className={`text-xs rounded px-2 py-1 cursor-pointer hover:opacity-80 ${completato ? 'opacity-50 line-through' : ''}`}
                  style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                  {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}
                  {ev.cliente_nome && <span className="text-muted-foreground ml-1">· {ev.cliente_nome}</span>}
                  <CountdownBadge ev={ev} now={now} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative" style={{ minHeight: hours.length * 60 }}>
        {showRedLine && (
          <div className="absolute left-14 right-0 z-20 flex items-center" style={{ top: redLineTop }}>
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 h-[2px] bg-red-500" />
          </div>
        )}

        {hours.map(h => {
          const hEvents = timedEvents.filter(e => getHourFromTime(e.ora) === h);
          const isDragOver = dropHour === h;
          const isDcRange = isDragCreating && h >= dcMin && h <= dcMax;
          return (
            <div
              key={h}
              className="flex border-b select-none"
              style={{ height: 60 }}
              onMouseDown={() => handleMouseDown(h)}
              onMouseEnter={() => handleMouseEnter(h)}
              onMouseUp={() => handleMouseUp(h)}
              onDragOver={e => { e.preventDefault(); setDropHour(h); }}
              onDragLeave={() => setDropHour(null)}
              onDrop={e => {
                e.preventDefault(); setDropHour(null);
                if (dragEvId) onEventDrop(dragEvId, dateStr, h);
              }}
            >
              <div className="w-14 shrink-0 text-right pr-3 -mt-2 text-xs text-muted-foreground font-mono">
                {h.toString().padStart(2, '0')}:00
              </div>
              <div className={`flex-1 border-l px-2 py-1 cursor-pointer transition-colors
                ${isDragOver ? 'bg-primary/10' : isDcRange ? 'bg-primary/15' : 'hover:bg-accent/30'}`}>
                {isDcRange && hEvents.length === 0 && h === dcMin && (
                  <div className="text-[10px] text-primary font-medium opacity-70">
                    Nuovo evento {dcMin.toString().padStart(2,'0')}:00 – {(dcMax+1).toString().padStart(2,'0')}:00
                  </div>
                )}
                {hEvents.map(ev => {
                  const s = getEventStyle(ev);
                  const completato = isEventCompletato(ev);
                  return (
                    <div
                      key={ev.id}
                      draggable
                      onDragStart={e => { e.stopPropagation(); setDragEvId(ev.id); }}
                      onDragEnd={() => setDragEvId(null)}
                      onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                      className={`rounded-lg px-3 py-1.5 text-sm cursor-grab mb-1 hover:shadow-sm transition-shadow relative group ${completato ? 'opacity-50 line-through' : ''}`}
                      style={{ background: s.bg, borderLeft: `4px solid ${s.border}` }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs" style={{ color: s.border }}>
                          {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                        </span>
                        <span>{s.icon}</span>
                        <span className="font-medium">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</span>
                        <CountdownBadge ev={ev} now={now} />
                      </div>
                      {(ev.cliente_nome || ev.persona) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {ev.cliente_nome}{ev.persona && ` · ${ev.persona}`}
                        </div>
                      )}
                      {/* Resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: s.border + '30' }}
                        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setResizingEv(ev.id); setResizeHour(h + 1); }}
                      >
                        <div className="w-8 h-1 bg-current rounded mx-auto mt-0.5" style={{ color: s.border }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Resize tooltip */}
        {resizingEv && resizeHour !== null && (() => {
          const ev = eventi.find(e => e.id === resizingEv);
          if (!ev) return null;
          return (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background text-xs px-3 py-1.5 rounded-lg shadow-lg">
              {formatTime(ev.ora)} – {resizeHour.toString().padStart(2,'0')}:00
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Desktop Week View (timeline with resize) ──────────────────────────────
function DesktopWeekTimelineView({ weekStart, eventi, marketing, oggi, onEventClick, onSlotClick, onEventDrop, dragEvId, setDragEvId, now, onQuickCreate, onResize }: {
  weekStart: Date;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
  onSlotClick: (date: Date, hour: number) => void;
  onEventDrop: (evId: string, newDate: string, newHour?: number) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
  now: Date;
  onQuickCreate: (date: Date, startHour: number, endHour: number) => void;
  onResize: (evId: string, newEndTime: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [resizingEv, setResizingEv] = useState<string | null>(null);
  const [resizeHour, setResizeHour] = useState<number | null>(null);

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const isCurrentWeek = days.some(d => isSameDay(d, oggi));
  const todayCol = isCurrentWeek ? days.findIndex(d => isSameDay(d, oggi)) : -1;
  const redLineTop = (currentHour >= 6 && currentHour <= 22) ? (currentHour - 6) * 60 + currentMinute : -1;

  const allDayByDay = (d: Date) => {
    const ds = toDateStr(d);
    const calEv = eventi.filter(e => e.data === ds && !e.ora);
    const mkt = marketing.filter(e => {
      if (e.data === ds) return true;
      if (e.data_fine && e.data <= ds && e.data_fine >= ds) return true;
      return false;
    });
    return { calEv, mkt };
  };

  const hasAnyAllDay = days.some(d => {
    const { calEv, mkt } = allDayByDay(d);
    return calEv.length > 0 || mkt.length > 0;
  });

  return (
    <div className="flex-1 overflow-auto min-h-0"
      onMouseUp={() => { if (resizingEv && resizeHour !== null) { const newEnd = `${resizeHour.toString().padStart(2,'0')}:00`; onResize(resizingEv, newEnd); setResizingEv(null); setResizeHour(null); } }}>
      <div className="sticky top-0 z-20 bg-white border-b">
        <div className="flex">
          <div className="w-14 shrink-0" />
          {days.map(d => {
            const isDayToday = isSameDay(d, oggi);
            return (
              <div key={toDateStr(d)} className={`flex-1 text-center py-2 border-l ${isDayToday ? 'bg-primary/5' : ''}`}>
                <div className="text-xs text-muted-foreground">{GIORNI[getDayIndex(d)]}</div>
                <div className={`text-lg font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full mt-0.5
                  ${isDayToday ? 'bg-primary text-primary-foreground' : ''}`}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {hasAnyAllDay && (
          <div className="flex border-t">
            <div className="w-14 shrink-0 text-right pr-2 text-[10px] text-muted-foreground pt-1">giorno</div>
            {days.map(d => {
              const { calEv, mkt } = allDayByDay(d);
              return (
                <div key={toDateStr(d)} className="flex-1 border-l px-0.5 py-1 min-h-[28px]">
                  {mkt.slice(0, 1).map(m => {
                    const color = MARKETING_COLOR[m.categoria] || '#F97316';
                    return (
                      <div key={m.id} className="text-[9px] rounded px-1 py-0.5 truncate mb-0.5"
                        style={{ background: '#FFF7ED', borderLeft: `2px solid ${color}`, color }}>
                        {MARKETING_LABEL[m.categoria]} {m.titolo.slice(0, 12)}
                      </div>
                    );
                  })}
                  {calEv.slice(0, 1).map(ev => {
                    const s = getEventStyle(ev);
                    const completato = isEventCompletato(ev);
                    return (
                      <div key={ev.id} onClick={() => onEventClick(ev)}
                        className={`text-[9px] rounded px-1 py-0.5 truncate cursor-pointer ${completato ? 'opacity-50 line-through' : ''}`}
                        style={{ background: s.bg, borderLeft: `2px solid ${s.border}` }}>
                        {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 12)}
                      </div>
                    );
                  })}
                  {(calEv.length + mkt.length) > 1 && (
                    <div className="text-[9px] text-muted-foreground pl-1">+{calEv.length + mkt.length - 1}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative">
        {todayCol >= 0 && redLineTop >= 0 && (
          <div className="absolute z-20 pointer-events-none"
            style={{
              top: redLineTop,
              left: `calc(56px + ${todayCol} * (100% - 56px) / 7)`,
              width: `calc((100% - 56px) / 7)`,
            }}>
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 h-[2px] bg-red-500" />
            </div>
          </div>
        )}

        {hours.map(h => (
          <div key={h} className="flex" style={{ height: 60 }}>
            <div className="w-14 shrink-0 text-right pr-3 -mt-2 text-xs text-muted-foreground font-mono">
              {h.toString().padStart(2, '0')}:00
            </div>
            {days.map(d => {
              const ds = toDateStr(d);
              const isDayToday = isSameDay(d, oggi);
              const targetKey = `${ds}-${h}`;
              const isDragOver = dropTarget === targetKey;
              const hEvents = eventi.filter(e => e.data === ds && e.ora && getHourFromTime(e.ora) === h);

              return (
                <div
                  key={targetKey}
                  className={`flex-1 border-l border-b px-0.5 py-0.5 cursor-pointer transition-colors select-none
                    ${isDragOver ? 'bg-primary/10' : isDayToday ? 'bg-primary/[0.02]' : 'hover:bg-accent/20'}`}
                  onClick={() => onSlotClick(d, h)}
                  onMouseEnter={() => { if (resizingEv) setResizeHour(h + 1); }}
                  onDragOver={e => { e.preventDefault(); setDropTarget(targetKey); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={e => {
                    e.preventDefault(); setDropTarget(null);
                    if (dragEvId) onEventDrop(dragEvId, ds, h);
                  }}
                >
                  {hEvents.map(ev => {
                    const s = getEventStyle(ev);
                    const completato = isEventCompletato(ev);
                    return (
                      <div
                        key={ev.id}
                        draggable
                        onDragStart={e => { e.stopPropagation(); setDragEvId(ev.id); }}
                        onDragEnd={() => setDragEvId(null)}
                        onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                        className={`rounded px-1.5 py-1 text-[10px] leading-tight cursor-grab mb-0.5 hover:shadow-sm transition-shadow relative group ${completato ? 'opacity-40 line-through' : ''}`}
                        style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, opacity: dragEvId === ev.id ? 0.4 : undefined }}
                      >
                        <div className="font-mono font-semibold" style={{ color: s.border, fontSize: 9 }}>
                          {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                        </div>
                        <div className="font-medium truncate">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 18)}</div>
                        <div className="flex items-center gap-1">
                          {ev.cliente_nome && <span className="truncate text-muted-foreground" style={{ fontSize: 9 }}>{ev.cliente_nome}</span>}
                          <CountdownBadge ev={ev} now={now} />
                        </div>
                        {/* Resize handle */}
                        <div
                          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: s.border + '40' }}
                          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setResizingEv(ev.id); setResizeHour(h + 1); }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {resizingEv && resizeHour !== null && (() => {
        const ev = eventi.find(e => e.id === resizingEv);
        if (!ev) return null;
        return (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background text-xs px-3 py-1.5 rounded-lg shadow-lg">
            {formatTime(ev.ora)} – {resizeHour.toString().padStart(2,'0')}:00
          </div>
        );
      })()}
    </div>
  );
}

// ─── Desktop Month View (enhanced) ──────────────────────────────────────────
function DesktopMonthView({ year, month, eventi, marketing, oggi, onDayClick, onEventClick, onEventDrop, dragEvId, setDragEvId, now }: {
  year: number; month: number;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onDayClick: (date: Date, x: number, y: number) => void;
  onEventClick: (ev: CalendarioEvent) => void;
  onEventDrop: (evId: string, newDate: string) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
  now: Date;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [morePopover, setMorePopover] = useState<{ dateStr: string; x: number; y: number } | null>(null);

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const evByDay = (d: Date) => eventi.filter(e => e.data === toDateStr(d));
  const mktByDay = (d: Date) => {
    const ds = toDateStr(d);
    return marketing.filter(e => {
      if (e.data === ds) return true;
      if (e.data_fine && e.data <= ds && e.data_fine >= ds) return true;
      return false;
    });
  };

  return (
    <div className="flex-1 overflow-auto min-h-0 relative">
      <div className="grid grid-cols-7 border-b sticky top-0 bg-white z-10">
        {GIORNI.map(g => (
          <div key={g} className="text-center text-xs font-semibold text-muted-foreground py-2 border-r last:border-r-0">{g}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} className="border-b border-r bg-muted/10 min-h-[100px]" />;

          const ds = toDateStr(d);
          const isToday = isSameDay(d, oggi);
          const isDragOver = dropTarget === ds;
          const dayEv = evByDay(d);
          const dayMkt = mktByDay(d);
          const MAX_SHOW = 3;
          const totalItems = dayEv.length + dayMkt.length;
          const overflow = totalItems > MAX_SHOW;

          return (
            <div
              key={ds}
              className="border-b border-r p-1 min-h-[100px] cursor-pointer transition-colors relative"
              style={{
                background: isDragOver ? 'hsl(214 80% 55% / 0.10)' : isToday ? 'hsl(214 80% 55% / 0.03)' : undefined,
                outline: isDragOver ? '2px solid hsl(214 80% 55% / 0.50)' : undefined,
                outlineOffset: '-2px',
              }}
              onClick={e => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onDayClick(d, Math.min(rect.left, window.innerWidth - 220), rect.bottom);
              }}
              onDragOver={e => { e.preventDefault(); setDropTarget(ds); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault();
                setDropTarget(null);
                if (dragEvId) onEventDrop(dragEvId, ds);
              }}
            >
              <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full
                ${isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'}`}>
                {d.getDate()}
              </div>

              {dayMkt.slice(0, 2).map(m => {
                const color = MARKETING_COLOR[m.categoria] || '#F97316';
                const icon = MARKETING_LABEL[m.categoria] || '📌';
                return (
                  <div key={m.id} title={m.titolo}
                    style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}
                    className="truncate px-1 py-0.5 rounded text-[10px] leading-tight mb-0.5">
                    {icon} {m.titolo.slice(0, 20)}
                  </div>
                );
              })}
              {dayEv.slice(0, MAX_SHOW - Math.min(dayMkt.length, 2)).map(ev => {
                const s = getEventStyle(ev);
                const completato = isEventCompletato(ev);
                const cd = getCountdown(ev, now);
                return (
                  <div
                    key={ev.id}
                    draggable
                    onDragStart={e => { e.stopPropagation(); setDragEvId(ev.id); }}
                    onDragEnd={() => setDragEvId(null)}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    title={`${ev.descrizione} — trascina per spostare`}
                    style={{
                      background: s.bg,
                      borderLeft: `3px solid ${isEventScaduto(ev, oggi) ? '#EF4444' : s.border}`,
                      cursor: 'grab',
                      opacity: dragEvId === ev.id ? 0.4 : completato ? 0.5 : 1,
                    }}
                    className={`truncate px-1 py-0.5 rounded text-[10px] leading-tight mb-0.5 hover:shadow-sm transition-shadow flex items-center gap-0.5 ${completato ? 'line-through' : ''}`}
                  >
                    <span className="truncate flex-1">
                      {ev.ora && <span className="font-mono mr-0.5" style={{ fontSize: 9 }}>{formatTime(ev.ora)}</span>}
                      {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 14)}
                    </span>
                    {cd && (
                      <span className="shrink-0 text-[8px] font-semibold px-0.5 rounded" style={{ color: cd.color }}>
                        {cd.level === 'scaduto' ? '🔴' : '⏰'}{cd.text}
                      </span>
                    )}
                  </div>
                );
              })}

              {overflow && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMorePopover({ dateStr: ds, x: rect.left, y: rect.bottom });
                  }}
                  className="text-[10px] text-primary font-medium pl-1 hover:underline"
                >
                  +{totalItems - MAX_SHOW} altri
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* "+N altri" popover */}
      {morePopover && (() => {
        const d = parseLocalDate(morePopover.dateStr);
        const dayEv = evByDay(d);
        const dayMkt = mktByDay(d);
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMorePopover(null)} />
            <div
              className="fixed z-50 bg-white border rounded-xl shadow-xl p-3 max-w-xs"
              style={{ left: Math.min(morePopover.x, window.innerWidth - 300), top: Math.min(morePopover.y, window.innerHeight - 300) }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">
                  {GIORNI_FULL[getDayIndex(d)]} {d.getDate()} {MESI[d.getMonth()]}
                </span>
                <button onClick={() => setMorePopover(null)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {dayMkt.map(m => {
                  const color = MARKETING_COLOR[m.categoria] || '#F97316';
                  return (
                    <div key={m.id} className="text-xs rounded px-2 py-1.5" style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}>
                      {MARKETING_LABEL[m.categoria]} {m.titolo}
                    </div>
                  );
                })}
                {dayEv.map(ev => {
                  const s = getEventStyle(ev);
                  const completato = isEventCompletato(ev);
                  return (
                    <div key={ev.id} onClick={() => { setMorePopover(null); onEventClick(ev); }}
                      className={`text-xs rounded px-2 py-1.5 cursor-pointer hover:shadow-sm ${completato ? 'opacity-50 line-through' : ''}`}
                      style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                      <div className="flex items-center gap-1">
                        {ev.ora && <span className="font-mono" style={{ fontSize: 9 }}>{formatTime(ev.ora)}</span>}
                        <span>{s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</span>
                        <CountdownBadge ev={ev} now={now} />
                      </div>
                      {ev.cliente_nome && <div className="text-[10px] text-muted-foreground mt-0.5">{ev.cliente_nome}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ─── Mobile Agenda View ─────────────────────────────────────────────────────
function AgendaView({ eventi, marketing, oggi, onEventClick, now }: {
  eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void; now: Date;
}) {
  const todayStr = toDateStr(oggi);
  const futureDateStr = toDateStr(addDays(oggi, 60));
  const allDates = new Set<string>();
  eventi.forEach(e => allDates.add(e.data));
  marketing.forEach(e => allDates.add(e.data));
  const sortedDates = Array.from(allDates);
  if (!allDates.has(todayStr)) sortedDates.push(todayStr);
  sortedDates.sort();
  const visibleDates = sortedDates.filter(d => d >= toDateStr(addDays(oggi, -7)) && d <= futureDateStr);

  if (visibleDates.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">Nessun evento in programma</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {visibleDates.map(dateStr => {
        const d = parseLocalDate(dateStr);
        const isToday = isSameDay(d, oggi);
        const dayEvents = eventi.filter(e => e.data === dateStr).sort((a, b) => (a.ora || '').localeCompare(b.ora || ''));
        const dayMkt = marketing.filter(e => {
          if (e.data === dateStr) return true;
          if (e.data_fine && e.data <= dateStr && e.data_fine >= dateStr) return true;
          return false;
        });
        if (dayEvents.length === 0 && dayMkt.length === 0) return null;
        return (
          <div key={dateStr}>
            <div className={`sticky top-0 z-10 px-4 py-2 text-xs font-semibold border-b ${isToday ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
              {isToday && <span className="mr-1">●</span>}
              {GIORNI_FULL[getDayIndex(d)]} {d.getDate()} {MESI[d.getMonth()]}
            </div>
            <div className="px-3 py-2 space-y-2">
              {dayMkt.map(m => {
                const color = MARKETING_COLOR[m.categoria] || '#F97316';
                const icon = MARKETING_LABEL[m.categoria] || '📌';
                return (
                  <div key={m.id} className="rounded-xl p-3 border" style={{ background: '#FFF7ED', borderColor: color + '40' }}>
                    <div className="flex items-center gap-2">
                      <span>{icon}</span>
                      <span className="font-medium text-sm" style={{ color }}>{m.titolo}</span>
                    </div>
                  </div>
                );
              })}
              {dayEvents.map(ev => {
                const s = getEventStyle(ev);
                const scaduto = dateStr < todayStr && ev.stato !== 'Completato';
                const completato = isEventCompletato(ev);
                return (
                  <div key={ev.id} onClick={() => onEventClick(ev)}
                    className={`rounded-xl p-3 border active:scale-[0.98] transition-transform cursor-pointer ${completato ? 'opacity-50' : ''}`}
                    style={{ background: s.bg, borderColor: s.border + '40', borderLeftWidth: 4, borderLeftColor: s.border }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium text-sm leading-snug ${completato ? 'line-through' : ''}`}>{s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {ev.cliente_nome && <span className="text-xs text-muted-foreground">{ev.cliente_nome}</span>}
                          {ev.persona && <span className="text-xs text-muted-foreground">· {ev.persona}</span>}
                          {ev.ora && (
                            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: s.border + '18', color: s.border }}>
                              ⏰ {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                            </span>
                          )}
                          <CountdownBadge ev={ev} now={now} size="md" />
                          {scaduto && <span className="text-xs font-semibold text-destructive">🔴 SCADUTO</span>}
                        </div>
                      </div>
                      {ev.id_contenuto_display && (
                        <span className="text-[10px] font-mono bg-white/60 px-1.5 py-0.5 rounded shrink-0">{ev.id_contenuto_display}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Mobile Day View
function MobileDayView({ date, eventi, marketing, oggi, onEventClick, now }: {
  date: Date; eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void; now: Date;
}) {
  const dateStr = toDateStr(date);
  const dayEvents = eventi.filter(e => e.data === dateStr);
  const dayMkt = marketing.filter(e => {
    if (e.data === dateStr) return true;
    if (e.data_fine && e.data <= dateStr && e.data_fine >= dateStr) return true;
    return false;
  });
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);
  const eventsAtHour = (h: number) => dayEvents.filter(e => e.ora && parseInt(e.ora.slice(0, 2)) === h);
  const noTimeEvents = dayEvents.filter(e => !e.ora);

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {(noTimeEvents.length > 0 || dayMkt.length > 0) && (
        <div className="px-3 py-2 border-b bg-muted/30">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase font-semibold">Tutto il giorno</div>
          <div className="space-y-1">
            {dayMkt.map(m => {
              const color = MARKETING_COLOR[m.categoria] || '#F97316';
              return (
                <div key={m.id} className="text-xs rounded-lg px-2 py-1.5" style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}>
                  {MARKETING_LABEL[m.categoria]} {m.titolo}
                </div>
              );
            })}
            {noTimeEvents.map(ev => {
              const s = getEventStyle(ev);
              return (
                <div key={ev.id} onClick={() => onEventClick(ev)} className="text-xs rounded-lg px-2 py-1.5 cursor-pointer active:scale-[0.98]"
                  style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                  {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}
                  {ev.cliente_nome && <span className="text-muted-foreground ml-1">· {ev.cliente_nome}</span>}
                  <CountdownBadge ev={ev} now={now} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {hours.map(h => {
        const hEvents = eventsAtHour(h);
        return (
          <div key={h} className="flex border-b min-h-[52px]">
            <div className="w-14 shrink-0 text-right pr-2 pt-1 text-xs text-muted-foreground font-mono">
              {h.toString().padStart(2, '0')}:00
            </div>
            <div className="flex-1 border-l py-1 px-2 space-y-1">
              {hEvents.map(ev => {
                const s = getEventStyle(ev);
                return (
                  <div key={ev.id} onClick={() => onEventClick(ev)} className="rounded-lg px-2.5 py-2 text-xs cursor-pointer active:scale-[0.98]"
                    style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                    <div className="font-medium flex items-center gap-1">
                      {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}
                      <CountdownBadge ev={ev} now={now} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                      {ev.cliente_nome && ` · ${ev.cliente_nome}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Mobile 3-Day View
function Mobile3DayView({ centerDate, eventi, marketing, oggi, onEventClick, now }: {
  centerDate: Date; eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void; now: Date;
}) {
  const days = [addDays(centerDate, -1), centerDate, addDays(centerDate, 1)];
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);
  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="grid grid-cols-3 sticky top-0 z-10 bg-white border-b">
        {days.map(d => {
          const isToday = isSameDay(d, oggi);
          return (
            <div key={toDateStr(d)} className={`text-center py-2 border-r last:border-r-0 ${isToday ? 'bg-primary/10' : ''}`}>
              <div className="text-[10px] text-muted-foreground">{GIORNI[getDayIndex(d)]}</div>
              <div className={`text-sm font-bold ${isToday ? 'text-primary' : ''}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      {hours.map(h => (
        <div key={h} className="flex border-b min-h-[48px]">
          <div className="w-10 shrink-0 text-right pr-1 pt-0.5 text-[10px] text-muted-foreground font-mono">{h.toString().padStart(2, '0')}</div>
          <div className="flex-1 grid grid-cols-3">
            {days.map(d => {
              const dateStr = toDateStr(d);
              const hEvents = eventi.filter(e => e.data === dateStr && e.ora && parseInt(e.ora.slice(0, 2)) === h);
              return (
                <div key={dateStr} className="border-l px-0.5 py-0.5 space-y-0.5">
                  {hEvents.map(ev => {
                    const s = getEventStyle(ev);
                    return (
                      <div key={ev.id} onClick={() => onEventClick(ev)} className="rounded px-1 py-0.5 text-[9px] leading-tight cursor-pointer active:scale-[0.98] truncate"
                        style={{ background: s.bg, borderLeft: `2px solid ${s.border}` }}>
                        {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 15)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Mobile Month View (dots)
function MobileMonthView({ year, month, eventi, marketing, oggi, onDaySelect }: {
  year: number; month: number; eventi: CalendarioEvent[]; marketing: MarketingEvent[];
  oggi: Date; onDaySelect: (d: Date) => void;
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const evByDay = (d: Date) => eventi.filter(e => e.data === toDateStr(d));
  const mktByDay = (d: Date) => {
    const ds = toDateStr(d);
    return marketing.filter(e => {
      if (e.data === ds) return true;
      if (e.data_fine && e.data <= ds && e.data_fine >= ds) return true;
      return false;
    });
  };

  const expandedEvents = expandedDay ? eventi.filter(e => e.data === expandedDay) : [];
  const expandedMkt = expandedDay ? marketing.filter(e => {
    if (e.data === expandedDay) return true;
    if (e.data_fine && e.data <= expandedDay && e.data_fine >= expandedDay) return true;
    return false;
  }) : [];

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="grid grid-cols-7 border-b">
        {GIORNI.map(g => (
          <div key={g} className="text-center text-[10px] font-semibold text-muted-foreground py-2">{g}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="aspect-square border-b border-r bg-muted/20" />;
          const ds = toDateStr(d);
          const isToday = isSameDay(d, oggi);
          const isExpanded = expandedDay === ds;
          const dayEv = evByDay(d);
          const dayMkt = mktByDay(d);
          const totalCount = dayEv.length + dayMkt.length;
          const dots: string[] = [];
          if (dayMkt.length > 0) dots.push('#F97316');
          dayEv.forEach(ev => {
            const s = getEventStyle(ev);
            if (s && !dots.includes(s.border)) dots.push(s.border);
          });
          return (
            <div key={ds} onClick={() => { setExpandedDay(isExpanded ? null : ds); onDaySelect(d); }}
              className={`aspect-square border-b border-r flex flex-col items-center justify-center cursor-pointer relative transition-colors ${isExpanded ? 'bg-primary/10' : ''}`}>
              <div className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                {d.getDate()}
              </div>
              {totalCount > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {dots.slice(0, 3).map((color, idx) => (
                    <div key={idx} className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                  ))}
                  {dots.length > 3 && <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {expandedDay && (expandedEvents.length > 0 || expandedMkt.length > 0) && (
        <div className="px-3 py-3 border-t bg-muted/30 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            {(() => { const d = parseLocalDate(expandedDay); return `${GIORNI_FULL[getDayIndex(d)]} ${d.getDate()} ${MESI[d.getMonth()]}`; })()}
          </div>
          {expandedMkt.map(m => {
            const color = MARKETING_COLOR[m.categoria] || '#F97316';
            return (
              <div key={m.id} className="rounded-xl p-2.5 text-xs" style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}>
                {MARKETING_LABEL[m.categoria]} {m.titolo}
              </div>
            );
          })}
          {expandedEvents.map(ev => {
            const s = getEventStyle(ev);
            return (
              <div key={ev.id} className="rounded-xl p-2.5 text-xs cursor-pointer active:scale-[0.98]"
                style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                <div className="font-medium">{s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
                {ev.cliente_nome && <div className="text-[10px] text-muted-foreground mt-0.5">{ev.cliente_nome}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Mobile View Switcher
function MobileViewSwitcher({ vista, onChange }: { vista: MobileVista; onChange: (v: MobileVista) => void }) {
  const views: { key: MobileVista; label: string }[] = [
    { key: 'agenda', label: 'Agenda' },
    { key: 'giorno', label: 'Giorno' },
    { key: '3giorni', label: '3 giorni' },
    { key: 'settimana', label: 'Settimana' },
    { key: 'mese', label: 'Mese' },
  ];
  return (
    <div className="flex overflow-x-auto no-scrollbar border-b bg-white">
      {views.map(v => (
        <button key={v.key} onClick={() => onChange(v.key)}
          className={`shrink-0 text-xs font-medium px-3 py-2.5 border-b-2 transition-colors min-h-[44px]
            ${vista === v.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// Mobile Legend Bottom Sheet
function LegendaBottomSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 p-5 pb-8 animate-slide-up">
        <div className="w-10 h-1 bg-muted rounded-full mx-auto mb-4" />
        <h3 className="font-semibold text-sm mb-3">Filtri Categoria</h3>
        <div className="space-y-3">
          {Object.entries(TIPO_STYLE).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 py-2">
              <span style={{ width: 14, height: 14, borderRadius: 3, background: v.bg, border: `2px solid ${v.border}`, display: 'inline-block' }} />
              <span className="text-sm">{v.icon} {v.label}</span>
            </div>
          ))}
          {Object.entries(WORKFLOW_STYLES).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 py-2">
              <span style={{ width: 14, height: 14, borderRadius: 3, background: v.bg, border: `2px solid ${v.border}`, display: 'inline-block' }} />
              <span className="text-sm">{v.icon} {v.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 py-2">
            <span style={{ width: 14, height: 14, borderRadius: 3, background: '#FFF7ED', border: '2px solid #F97316', display: 'inline-block' }} />
            <span className="text-sm">📌 Marketing</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Day Click Menu ───────────────────────────────────────────────────────────
interface DayMenuProps {
  date: Date; x: number; y: number; utente: TeamMember;
  onNewTask: () => void; onPickCLP: () => void; onSlot: () => void; onClose: () => void;
}
function DayMenu({ x, y, utente, onNewTask, onPickCLP, onSlot, onClose }: DayMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'fixed', top: Math.min(y, window.innerHeight - 160), left: Math.min(x, window.innerWidth - 220), zIndex: 1000,
      background: 'white', border: '1px solid hsl(var(--border))',
      borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: 200, padding: 4
    }}>
      <button onClick={() => { onClose(); onNewTask(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md">📝 Nuovo task / Appuntamento</button>
      <button onClick={() => { onClose(); onPickCLP(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md">📹 Posiziona contenuto (CLP)</button>
      {utente.nome === 'Elisa' && (
        <button onClick={() => { onClose(); onSlot(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md">📅 Pianifica slot</button>
      )}
    </div>
  );
}

// ─── CLP Picker Modal ─────────────────────────────────────────────────────────
interface CLPPickerProps {
  contenuti: Contenuto[];
  selectedDate: Date;
  onSave: (c: Contenuto, ora: string) => void;
  onClose: () => void;
}
function CLPPicker({ contenuti, selectedDate, onSave, onClose }: CLPPickerProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contenuto | null>(null);
  const [ora, setOra] = useState('');

  const available = contenuti.filter(c =>
    !search || c.titolo.toLowerCase().includes(search.toLowerCase()) ||
    c.id_display.toLowerCase().includes(search.toLowerCase()) ||
    (c.cliente_nome || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-modal animate-slide-up" style={{ maxWidth: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
          <h3 className="font-semibold text-base">📹 Posiziona CLP — {selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>
        <div className="p-3 border-b flex-shrink-0">
          <input className="sk-input w-full" placeholder="Cerca per titolo, ID, cliente…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {available.length === 0 && <p className="text-center text-muted-foreground text-sm py-8">Nessun contenuto disponibile</p>}
          {available.map(c => (
            <div key={c.id} onClick={() => setSelected(selected?.id === c.id ? null : c)}
              className={`p-3 rounded-lg border mb-2 cursor-pointer transition-all ${selected?.id === c.id ? 'border-primary bg-accent' : 'border-border hover:border-muted-foreground'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{c.titolo}</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: FASE_COLORS[c.fase] + '22', color: FASE_COLORS[c.fase] }}>{c.fase}</span>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{c.id_display}</span>
                {c.cliente_nome && <span>• {c.cliente_nome}</span>}
                {c.canale && <span>• {c.canale}</span>}
                {c.tipo && <span>• {c.tipo}</span>}
              </div>
            </div>
          ))}
        </div>
        {selected && (
          <div className="p-4 border-t bg-accent/50">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Ora pubblicazione (opzionale)</div>
                <input type="time" className="sk-input w-full" value={ora} onChange={e => setOra(e.target.value)} />
              </div>
              <button onClick={() => onSave(selected, ora)} className="sk-btn-primary">✅ Posiziona</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slot Pianificato Modal ───────────────────────────────────────────────────
interface SlotModalProps {
  selectedDate: Date; team: TeamMember[];
  onSave: (descrizione: string, persona: string, ora: string, oraFine: string) => void; onClose: () => void;
}
function SlotModal({ selectedDate, team, onSave, onClose }: SlotModalProps) {
  const [descrizione, setDescrizione] = useState('');
  const [persona, setPersona] = useState('');
  const [ora, setOra] = useState('');
  const [oraFine, setOraFine] = useState('');

  return (
    <div className="sk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-modal animate-slide-up" style={{ maxWidth: 400 }}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-base">📅 Pianifica Slot — {selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="sk-label">Descrizione *</label>
            <input className="sk-input w-full" value={descrizione} onChange={e => setDescrizione(e.target.value)} placeholder="es: Shooting mattutino" />
          </div>
          <div>
            <label className="sk-label">Persona</label>
            <select className="sk-select w-full" value={persona} onChange={e => setPersona(e.target.value)}>
              <option value="">— Team —</option>
              {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="sk-label">Ora inizio</label>
              <input type="time" className="sk-input w-full" value={ora} onChange={e => setOra(e.target.value)} />
            </div>
            <div>
              <label className="sk-label">Ora fine</label>
              <input type="time" className="sk-input w-full" value={oraFine} onChange={e => setOraFine(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="sk-btn-ghost">Annulla</button>
            <button onClick={() => { if (descrizione.trim()) onSave(descrizione, persona, ora, oraFine); }} className="sk-btn-primary">✅ Crea Slot</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Recurrence Edit Component ───────────────────────────────────────────────
function RecurrenceEditor({ tipo, giorni, fine, onChange }: {
  tipo: string; giorni: string[]; fine: string;
  onChange: (tipo: string, giorni: string[], fine: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="sk-label">Ripeti</label>
        <select className="sk-select w-full text-sm" value={tipo} onChange={e => onChange(e.target.value, giorni, fine)}>
          {RICORRENZA_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {tipo === 'weekly' && (
        <div>
          <label className="sk-label text-xs">Giorni della settimana</label>
          <div className="flex gap-1 mt-1">
            {WEEKDAY_LABELS.map(wd => (
              <button key={wd.key} type="button"
                onClick={() => {
                  const newGiorni = giorni.includes(wd.key) ? giorni.filter(g => g !== wd.key) : [...giorni, wd.key];
                  onChange(tipo, newGiorni, fine);
                }}
                className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${giorni.includes(wd.key) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
              >
                {wd.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {tipo && (
        <div>
          <label className="sk-label text-xs">Fine ricorrenza (opzionale)</label>
          <input type="date" className="sk-input w-full text-sm" value={fine} onChange={e => onChange(tipo, giorni, e.target.value)} />
        </div>
      )}
    </div>
  );
}

// ─── Event Detail Panel ──────────────────────────────────────────────────────
interface EventDetailProps {
  ev: CalendarioEvent; team: TeamMember[]; clienti: Cliente[];
  onClose: () => void; onDelete: () => void; onUpdate: (updated: CalendarioEvent) => void;
  now: Date;
}
function EventDetail({ ev, team, clienti, onClose, onDelete, onUpdate, now }: EventDetailProps) {
  const s = getEventStyle(ev);
  const { addToast } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    descrizione: ev.descrizione,
    data: ev.data,
    ora: ev.ora ? ev.ora.slice(0, 5) : '',
    ora_fine: ev.ora_fine ? ev.ora_fine.slice(0, 5) : '',
    persona: ev.persona || '',
    cliente_id: ev.cliente_id || '',
    stato: ev.stato || '',
  });
  const [recTipo, setRecTipo] = useState((ev as any).ricorrenza_tipo || '');
  const [recGiorni, setRecGiorni] = useState<string[]>((ev as any).ricorrenza_giorni || []);
  const [recFine, setRecFine] = useState((ev as any).ricorrenza_fine || '');
  const [saving, setSaving] = useState(false);
  const [deleteMode, setDeleteMode] = useState<null | 'ask'>(null);
  const setF = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const isRecurring = !!(ev as any).ricorrenza_tipo || !!(ev as any).ricorrenza_parent_id;

  const handleSave = async () => {
    setSaving(true);
    const payload: any = {
      descrizione: form.descrizione,
      data: form.data,
      ora: form.ora || null,
      ora_fine: form.ora_fine || null,
      persona: form.persona || null,
      cliente_id: form.cliente_id || null,
      cliente_nome: clienti.find(c => c.id === form.cliente_id)?.nome || ev.cliente_nome,
      stato: form.stato || null,
      ricorrenza_tipo: recTipo || null,
      ricorrenza_giorni: recGiorni.length > 0 ? recGiorni : null,
      ricorrenza_fine: recFine || null,
    };
    const { data, error } = await supabase.from('calendario').update(payload).eq('id', ev.id).select().single();
    setSaving(false);
    if (!error && data) {
      // Sync task if linked
      if (ev.tipo === 'appuntamento' && ev.descrizione?.includes('[TASK:')) {
        const taskIdMatch = ev.descrizione.match(/\[TASK:([^\]]+)\]/);
        if (taskIdMatch) {
          await supabase.from('task').update({ scadenza: form.data, ora: form.ora || null }).eq('id', taskIdMatch[1]);
        }
      }
      onUpdate(data as CalendarioEvent);
      setEditing(false);
      addToast('✅ Evento aggiornato', 'success');
    }
  };

  const handleDeleteRecurring = async (mode: 'this' | 'future' | 'all') => {
    if (mode === 'this') {
      await supabase.from('calendario').delete().eq('id', ev.id);
    } else if (mode === 'all') {
      const parentId = (ev as any).ricorrenza_parent_id || ev.id;
      await supabase.from('calendario').delete().or(`id.eq.${parentId},ricorrenza_parent_id.eq.${parentId}`);
    } else if (mode === 'future') {
      const parentId = (ev as any).ricorrenza_parent_id || ev.id;
      await supabase.from('calendario').delete().eq('ricorrenza_parent_id', parentId).gte('data', ev.data);
    }
    onDelete();
  };

  const cd = getCountdown(ev, now);

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-white border-l shadow-2xl z-50 flex flex-col"
      style={{ top: 0, animation: 'slideInRight 0.2s ease-out' }}>
      <div className="flex items-center justify-between p-4 border-b" style={{ background: s.bg, borderBottomColor: s.border + '40' }}>
        <span className="font-semibold text-sm">{s.icon} {s.label}</span>
        <div className="flex items-center gap-2">
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1 rounded-md transition-colors font-medium"
              style={{ background: s.border + '20', color: s.border, border: `1px solid ${s.border}40` }}>✏️ Modifica</button>
          )}
          <button onClick={onClose} className="sk-btn-ghost text-sm px-2">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="sk-label">Descrizione</label>
              <textarea className="sk-textarea w-full text-sm" rows={2} value={form.descrizione} onChange={e => setF('descrizione', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="sk-label">Data</label><input type="date" className="sk-input w-full text-sm" value={form.data} onChange={e => setF('data', e.target.value)} /></div>
              <div><label className="sk-label">Stato</label>
                <select className="sk-select w-full text-sm" value={form.stato} onChange={e => setF('stato', e.target.value)}>
                  <option value="">—</option><option value="Pianificato">Pianificato</option><option value="Completato">Completato</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="sk-label">Ora inizio</label><input type="time" className="sk-input w-full text-sm" value={form.ora} onChange={e => setF('ora', e.target.value)} /></div>
              <div><label className="sk-label">Ora fine</label><input type="time" className="sk-input w-full text-sm" value={form.ora_fine} onChange={e => setF('ora_fine', e.target.value)} /></div>
            </div>
            <div>
              <label className="sk-label">Persona</label>
              <select className="sk-select w-full text-sm" value={form.persona} onChange={e => setF('persona', e.target.value)}>
                <option value="">—</option>
                {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="sk-label">Cliente</label>
              <select className="sk-select w-full text-sm" value={form.cliente_id} onChange={e => setF('cliente_id', e.target.value)}>
                <option value="">—</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <RecurrenceEditor tipo={recTipo} giorni={recGiorni} fine={recFine}
              onChange={(t, g, f) => { setRecTipo(t); setRecGiorni(g); setRecFine(f); }} />
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditing(false)} className="flex-1 sk-btn-ghost text-sm">Annulla</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 sk-btn-primary text-sm">{saving ? 'Salvo…' : '✅ Salva'}</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Descrizione</div>
              <div className="font-medium leading-snug">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Data</div>
              <div className="text-sm">{parseLocalDate(ev.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
            {(ev.ora || ev.ora_fine) && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Orario</div>
                <div className="text-sm">{formatTime(ev.ora)}{ev.ora_fine ? ` – ${formatTime(ev.ora_fine)}` : ''}</div>
              </div>
            )}
            {cd && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Countdown</div>
                <div className="flex items-center gap-2">
                  <CountdownBadge ev={ev} now={now} size="md" />
                  <span className="text-sm text-muted-foreground">
                    {cd.level === 'scaduto' ? 'Scaduto' : `${cd.text} rimasti`}
                  </span>
                </div>
              </div>
            )}
            {ev.cliente_nome && <div><div className="text-xs text-muted-foreground mb-1">Cliente</div><div className="text-sm">{ev.cliente_nome}</div></div>}
            {ev.id_contenuto_display && <div><div className="text-xs text-muted-foreground mb-1">Contenuto</div><div className="text-sm font-mono text-primary">{ev.id_contenuto_display}</div></div>}
            {ev.canale && <div><div className="text-xs text-muted-foreground mb-1">Canale</div><div className="text-sm">{ev.canale}</div></div>}
            {ev.persona && <div><div className="text-xs text-muted-foreground mb-1">Persona</div><div className="text-sm">{ev.persona}</div></div>}
            {ev.stato && <div><div className="text-xs text-muted-foreground mb-1">Stato</div><div className="text-sm">{ev.stato}</div></div>}
            {(ev as any).ricorrenza_tipo && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Ricorrenza</div>
                <div className="text-sm">🔁 {RICORRENZA_OPTIONS.find(o => o.value === (ev as any).ricorrenza_tipo)?.label || (ev as any).ricorrenza_tipo}</div>
              </div>
            )}
            <div className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'hsl(214 80% 55% / 0.07)', color: 'hsl(214 70% 44%)', border: '1px solid hsl(214 80% 55% / 0.20)' }}>
              💡 Puoi anche trascinare l'evento nel calendario per cambiare data
            </div>
          </>
        )}
      </div>

      <div className="p-4 border-t space-y-2">
        {isRecurring && deleteMode === 'ask' ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground mb-1">Elimina evento ricorrente:</div>
            <button onClick={() => handleDeleteRecurring('this')} className="w-full text-sm text-left px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive border border-destructive/20">Solo questo evento</button>
            <button onClick={() => handleDeleteRecurring('future')} className="w-full text-sm text-left px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive border border-destructive/20">Questo e i futuri</button>
            <button onClick={() => handleDeleteRecurring('all')} className="w-full text-sm text-left px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive border border-destructive/20">Tutti gli eventi</button>
            <button onClick={() => setDeleteMode(null)} className="w-full text-sm text-center text-muted-foreground py-1">Annulla</button>
          </div>
        ) : (
          <button onClick={() => isRecurring ? setDeleteMode('ask') : onDelete()}
            className="w-full text-sm text-destructive border border-destructive/30 rounded-lg py-2 hover:bg-destructive/10 transition-colors">
            🗑️ Elimina evento
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface CalendarioTabProps {
  team: TeamMember[];
  clienti: Cliente[];
}

export function CalendarioTab({ team, clienti }: CalendarioTabProps) {
  const { utente, addToast } = useApp();
  const isMobile = useIsMobile();
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);

  const [vista, setVista] = useState<DesktopVista>('mese');
  const [mobileVista, setMobileVista] = useState<MobileVista>('agenda');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [eventi, setEventi] = useState<CalendarioEvent[]>([]);
  const [marketing, setMarketing] = useState<MarketingEvent[]>([]);
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Countdown timer - updates every 60s
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Filters
  const [categoryFilters, setCategoryFilters] = useState<Record<string, boolean>>({});
  const [operatorFilters, setOperatorFilters] = useState<Record<string, boolean>>({});

  const toggleCategory = (k: string) => setCategoryFilters(prev => ({ ...prev, [k]: prev[k] === false ? true : false }));
  const toggleOperator = (name: string) => setOperatorFilters(prev => ({ ...prev, [name]: prev[name] === false ? true : false }));

  // Drag state
  const [dragEvId, setDragEvId] = useState<string | null>(null);
  // Undo state
  const [undoData, setUndoData] = useState<{ evId: string; oldDate: string; oldOra: string | null; taskId?: string } | null>(null);

  // Modal states
  const [dayMenu, setDayMenu] = useState<{ date: Date; x: number; y: number } | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showCLPPicker, setShowCLPPicker] = useState(false);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarioEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(oggi);
  const [quickCreateData, setQuickCreateData] = useState<{ date: Date; startHour: number; endHour: number } | null>(null);

  // Mini calendar separate month tracking
  const [miniCalMonth, setMiniCalMonth] = useState(oggi.getMonth());
  const [miniCalYear, setMiniCalYear] = useState(oggi.getFullYear());

  // ── Data loading (PRESERVED - zero changes to queries) ─────────────────────
  const loadData = useCallback(async () => {
    if (!utente) return;
    setLoading(true);
    let rangeStart: string, rangeEnd: string;

    if (isMobile) {
      const y = currentDate.getFullYear(), m = currentDate.getMonth();
      rangeStart = toDateStr(new Date(y, m - 1, 1));
      rangeEnd = toDateStr(new Date(y, m + 2, 0));
    } else if (vista === 'mese') {
      const y = currentDate.getFullYear(), m = currentDate.getMonth();
      rangeStart = toDateStr(new Date(y, m - 1, 1));
      rangeEnd = toDateStr(new Date(y, m + 2, 0));
    } else if (vista === 'agenda') {
      rangeStart = toDateStr(addDays(oggi, -14));
      rangeEnd = toDateStr(addDays(oggi, 60));
    } else if (vista === 'giorno') {
      rangeStart = toDateStr(addDays(currentDate, -1));
      rangeEnd = toDateStr(addDays(currentDate, 2));
    } else {
      const ws = startOfWeekMon(currentDate);
      rangeStart = toDateStr(addDays(ws, -1));
      rangeEnd = toDateStr(addDays(ws, 8));
    }

    const isAdmin = utente.ruolo === 'Admin';

    const [evResAll, mktRes, contRes] = await Promise.all([
      supabase.from('calendario').select('*').gte('data', rangeStart).lte('data', rangeEnd).order('ora', { nullsFirst: true }),
      supabase.from('marketing_calendar').select('*').gte('data', rangeStart).lte('data', rangeEnd),
      supabase.from('contenuti').select('id, id_display, titolo, cliente_nome, tipo, canale, fase, data_pubblicazione').neq('fase', 'Pubblicato').neq('fase', 'Scartata'),
    ]);

    const tuttiEventi = (evResAll.data as CalendarioEvent[]) || [];

    const eventiFiltrati = isAdmin
      ? tuttiEventi
      : tuttiEventi.filter(ev =>
          ev.tipo === 'pubblicazione' ||
          ev.persona === utente.nome ||
          ev.persona === '' ||
          ev.persona === null
        );

    console.log(`[Calendario] Loaded ${eventiFiltrati.length} events (total: ${tuttiEventi.length}), ${(mktRes.data || []).length} marketing events`);

    setEventi(eventiFiltrati);
    setMarketing((mktRes.data as MarketingEvent[]) || []);
    setContenuti((contRes.data as any[]) || []);
    setLoading(false);
  }, [vista, currentDate, utente, isMobile]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('calendario-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendario' }, (payload) => {
        const newEv = payload.new as CalendarioEvent;
        setEventi(prev => {
          if (prev.some(e => e.id === newEv.id)) return prev;
          return [...prev, newEv];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendario' }, (payload) => {
        const updated = payload.new as CalendarioEvent;
        setEventi(prev => prev.map(e => e.id === updated.id ? updated : e));
        setSelectedEvent(prev => prev?.id === updated.id ? updated : prev);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'calendario' }, (payload) => {
        const deleted = payload.old as any;
        setEventi(prev => prev.filter(e => e.id !== deleted.id));
        setSelectedEvent(prev => prev?.id === deleted.id ? null : prev);
      })
      .subscribe();

    // Also listen for task changes (trigger creates calendar events)
    const taskChannel = supabase
      .channel('task-calendario-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task' }, () => {
        // Reload data when tasks change to pick up trigger-generated calendar events
        setTimeout(() => loadData(), 1000);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(taskChannel);
    };
  }, [loadData]);

  // ── Apply filters to events ────────────────────────────────────────────────
  const filteredEventi = useMemo(() => eventi.filter(ev => {
    // Category filter
    if (categoryFilters[ev.tipo] === false) return false;
    // Workflow sub-category filter
    if (ev.tipo === 'appuntamento' && ev.descrizione?.includes('[TASK:') && ev.tipo_contenuto) {
      if (categoryFilters[`wf_${ev.tipo_contenuto}`] === false) return false;
    }
    // Operator filter
    if (ev.persona && operatorFilters[ev.persona] === false) return false;
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = (ev.descrizione || '').toLowerCase().includes(q) ||
        (ev.cliente_nome || '').toLowerCase().includes(q) ||
        (ev.persona || '').toLowerCase().includes(q) ||
        (ev.id_contenuto_display || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  }), [eventi, categoryFilters, operatorFilters, searchQuery]);

  const filteredMarketing = marketing.filter(() => categoryFilters['marketing'] !== false);

  // ── Search with debounce ───────────────────────────────────────────────────
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setShowSearchDropdown(val.length >= 2);
    }, 300);
  };

  const handleSearchSelect = (ev: CalendarioEvent) => {
    setCurrentDate(parseLocalDate(ev.data));
    setSelectedEvent(ev);
    setShowSearchDropdown(false);
    setSearchQuery('');
    setShowSearch(false);
  };

  // ── Navigation (PRESERVED) ────────────────────────────────────────────────
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (isMobile) {
      if (mobileVista === 'mese') d.setMonth(d.getMonth() + dir);
      else if (mobileVista === 'settimana') d.setDate(d.getDate() + dir * 7);
      else if (mobileVista === '3giorni') d.setDate(d.getDate() + dir * 3);
      else d.setDate(d.getDate() + dir);
    } else if (vista === 'mese') {
      d.setMonth(d.getMonth() + dir);
    } else if (vista === 'settimana') {
      d.setDate(d.getDate() + dir * 7);
    } else if (vista === 'giorno') {
      d.setDate(d.getDate() + dir);
    } else if (vista === 'agenda') {
      d.setDate(d.getDate() + dir * 7);
    }
    setCurrentDate(d);
  };

  const goToday = () => {
    setCurrentDate(new Date());
    setMiniCalMonth(oggi.getMonth());
    setMiniCalYear(oggi.getFullYear());
  };

  // ── Title ─────────────────────────────────────────────────────────────────
  const getTitle = () => {
    if (isMobile) {
      if (mobileVista === 'mese') return `${MESI[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      if (mobileVista === 'agenda') return `${MESI[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      if (mobileVista === 'giorno') return `${currentDate.getDate()} ${MESI[currentDate.getMonth()].slice(0, 3)}`;
      if (mobileVista === '3giorni') {
        const end = addDays(currentDate, 2);
        return `${currentDate.getDate()}–${end.getDate()} ${MESI[end.getMonth()].slice(0, 3)}`;
      }
      const ws = startOfWeekMon(currentDate);
      const we = addDays(ws, 6);
      return `${ws.getDate()}–${we.getDate()} ${MESI[we.getMonth()].slice(0, 3)}`;
    }
    if (vista === 'mese') return `${MESI[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (vista === 'giorno') return `${GIORNI_FULL[getDayIndex(currentDate)]} ${currentDate.getDate()} ${MESI[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (vista === 'agenda') return `Agenda`;
    const ws = startOfWeekMon(currentDate);
    const we = addDays(ws, 6);
    return `${ws.getDate()} – ${we.getDate()} ${MESI[we.getMonth()]} ${we.getFullYear()}`;
  };

  const title = getTitle();

  // ── Day click ─────────────────────────────────────────────────────────────
  const handleDayClick = (date: Date, x: number, y: number) => {
    setSelectedDate(date);
    if (!isMobile) {
      setDayMenu({ date, x, y });
    }
  };

  // ── Slot click (for timeline views) ────────────────────────────────────────
  const handleSlotClick = (date: Date, hour: number) => {
    setSelectedDate(date);
    setDayMenu({ date, x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 80 });
  };

  // ── Quick create from click+drag ──────────────────────────────────────────
  const handleQuickCreate = (date: Date, startHour: number, endHour: number) => {
    setSelectedDate(date);
    setQuickCreateData({ date, startHour, endHour });
    setShowTaskModal(true);
  };

  // ── Resize event ──────────────────────────────────────────────────────────
  const handleResize = async (evId: string, newEndTime: string) => {
    setEventi(prev => prev.map(e => e.id === evId ? { ...e, ora_fine: newEndTime } : e));
    const { error } = await supabase.from('calendario').update({ ora_fine: newEndTime }).eq('id', evId);
    if (error) {
      addToast('Errore nel resize', 'error');
      loadData();
    } else {
      addToast(`⏱️ Durata aggiornata → fine ${newEndTime.slice(0, 5)}`, 'success');
    }
  };

  // ── Drag-drop evento (PRESERVED + enhanced with undo) ─────────────────────
  const handleEventDrop = async (evId: string, newDateStr: string, newHour?: number) => {
    const ev = eventi.find(e => e.id === evId);
    if (!ev) return;
    if (ev.data === newDateStr && newHour === undefined) return;

    const oldDate = ev.data;
    const oldOra = ev.ora;
    const newOra = newHour !== undefined ? `${newHour.toString().padStart(2, '0')}:00` : undefined;

    // Optimistic update
    setEventi(prev => prev.map(e => e.id === evId ? { ...e, data: newDateStr, ...(newOra ? { ora: newOra } : {}) } : e));
    if (selectedEvent?.id === evId) setSelectedEvent(prev => prev ? { ...prev, data: newDateStr, ...(newOra ? { ora: newOra } : {}) } : null);

    const updatePayload: any = { data: newDateStr };
    if (newOra) updatePayload.ora = newOra;

    const { error } = await supabase.from('calendario').update(updatePayload).eq('id', evId);

    if (error) {
      addToast('Errore nello spostamento dell\'evento', 'error');
      loadData();
    } else {
      // Sync with task if linked
      let taskId: string | undefined;
      if (ev.tipo === 'appuntamento' && ev.descrizione?.includes('[TASK:')) {
        const taskIdMatch = ev.descrizione.match(/\[TASK:([^\]]+)\]/);
        if (taskIdMatch) {
          taskId = taskIdMatch[1];
          const taskUpdate: any = { scadenza: newDateStr };
          if (newOra) taskUpdate.ora = newOra;
          await supabase.from('task').update(taskUpdate).eq('id', taskId);
        }
      }
      // Sync with contenuti if linked
      if (ev.contenuto_id) {
        await supabase.from('contenuti').update({ data_pubblicazione: newDateStr }).eq('id', ev.contenuto_id);
      }

      // Set undo data
      setUndoData({ evId, oldDate, oldOra, taskId });

      const d = parseLocalDate(newDateStr);
      // Show toast with undo - auto-dismiss after 5s
      addToast(`📅 Evento spostato al ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}${newOra ? ` alle ${newOra}` : ''}`, 'success');
    }
  };

  // ── Undo last drag ────────────────────────────────────────────────────────
  const handleUndo = async () => {
    if (!undoData) return;
    const { evId, oldDate, oldOra, taskId } = undoData;
    const updatePayload: any = { data: oldDate };
    if (oldOra) updatePayload.ora = oldOra;
    await supabase.from('calendario').update(updatePayload).eq('id', evId);
    if (taskId) {
      const taskUpdate: any = { scadenza: oldDate };
      if (oldOra) taskUpdate.ora = oldOra;
      await supabase.from('task').update(taskUpdate).eq('id', taskId);
    }
    setEventi(prev => prev.map(e => e.id === evId ? { ...e, data: oldDate, ...(oldOra ? { ora: oldOra } : {}) } : e));
    setUndoData(null);
    addToast('↩️ Spostamento annullato', 'info');
  };

  // Auto-clear undo after 5 seconds
  useEffect(() => {
    if (!undoData) return;
    const timer = setTimeout(() => setUndoData(null), 5000);
    return () => clearTimeout(timer);
  }, [undoData]);

  // ── Create CLP event (PRESERVED) ──────────────────────────────────────────
  const handleSaveCLP = async (contenuto: Contenuto, ora: string) => {
    const dataStr = toDateStr(selectedDate);
    const oraStr = ora || null;

    const payload = {
      tipo: 'contenuto' as const,
      descrizione: contenuto.titolo,
      data: dataStr,
      ora: oraStr,
      cliente_id: contenuto.cliente_id,
      cliente_nome: contenuto.cliente_nome,
      contenuto_id: contenuto.id,
      id_contenuto_display: contenuto.id_display,
      canale: contenuto.canale,
      tipo_contenuto: contenuto.tipo,
      persona: utente?.nome || '',
    };

    const { data, error } = await supabase.from('calendario').insert(payload).select().single();
    if (!error && data) {
      setEventi(prev => [...prev, data as CalendarioEvent]);
      await supabase.from('contenuti').update({ data_pubblicazione: dataStr, ora_pubblicazione: oraStr }).eq('id', contenuto.id);

      if (contenuto.fase === 'Girato') {
        const nomeLuca = findMembro(team, 'Luca');
        const contenutoAggiornato = { ...contenuto, data_pubblicazione: dataStr, ora_pubblicazione: oraStr };
        const newTask = await creaTaskWorkflow(contenutoAggiornato, nomeLuca, 'Premontaggio',
          `🎬 Premontaggia ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
          'Da fare', dataStr, oraStr);
        if (newTask) {
          addToast(`📋 Task premontaggio creato per ${nomeLuca}`, 'success');
        } else {
          const { data: existingTask } = await supabase.from('task').select('id')
            .eq('id_contenuto', contenuto.id).eq('tipo', 'Premontaggio')
            .neq('stato', 'Completato').neq('stato', 'Archiviato').single();
          if (existingTask) {
            await supabase.from('task').update({ scadenza: dataStr, ora: oraStr, priorita: '🔴 Alta' }).eq('id', existingTask.id);
            addToast(`⏰ Scadenza task Luca aggiornata`, 'success');
          }
        }
      }
      addToast(`📹 ${contenuto.id_display} posizionato il ${selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`, 'success');
    }
    setShowCLPPicker(false);
  };

  // ── Create slot (PRESERVED) ───────────────────────────────────────────────
  const handleSaveSlot = async (descrizione: string, persona: string, ora: string, oraFine: string) => {
    const payload = {
      tipo: 'slot_pianificato' as const,
      descrizione,
      data: toDateStr(selectedDate),
      ora: ora || null,
      ora_fine: oraFine || null,
      persona,
    };
    const { data, error } = await supabase.from('calendario').insert(payload).select().single();
    if (!error && data) {
      setEventi(prev => [...prev, data as CalendarioEvent]);
      addToast('📅 Slot pianificato creato', 'success');
    }
    setShowSlotModal(false);
  };

  // ── Create task from calendar (PRESERVED) ─────────────────────────────────
  const handleTaskCreated = async (task: Task) => {
    if (task.scadenza) {
      const payload: any = {
        tipo: 'appuntamento' as const,
        descrizione: task.descrizione,
        data: task.scadenza,
        ora: task.ora || null,
        cliente_id: task.cliente_id || null,
        cliente_nome: task.cliente_nome || '',
        persona: task.assegnato_a,
      };
      // Add quick create end time if available
      if (quickCreateData && !task.ora) {
        payload.ora = `${quickCreateData.startHour.toString().padStart(2, '0')}:00`;
        payload.ora_fine = `${quickCreateData.endHour.toString().padStart(2, '0')}:00`;
      }
      const { data } = await supabase.from('calendario').insert(payload).select().single();
      if (data) setEventi(prev => [...prev, data as CalendarioEvent]);
    }
    addToast(`✅ Task ${task.id_display} creato`, 'success');
    setShowTaskModal(false);
    setQuickCreateData(null);
  };

  // ── Delete event (PRESERVED) ──────────────────────────────────────────────
  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    await supabase.from('calendario').delete().eq('id', selectedEvent.id);
    setEventi(prev => prev.filter(e => e.id !== selectedEvent.id));
    setSelectedEvent(null);
    addToast('🗑️ Evento eliminato', 'info');
  };

  // ── Update event (PRESERVED) ──────────────────────────────────────────────
  const handleUpdateEvent = (updated: CalendarioEvent) => {
    setEventi(prev => prev.map(e => e.id === updated.id ? updated : e));
    setSelectedEvent(updated);
  };

  if (!utente) return null;

  // ── MOBILE LAYOUT (PRESERVED) ─────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full overflow-hidden relative">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-white flex-shrink-0">
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="sk-btn-ghost text-sm px-2 py-1 min-h-[44px] min-w-[44px]">◀</button>
            <button onClick={goToday} className="sk-btn-ghost text-xs px-2 py-1 min-h-[44px]">Oggi</button>
            <button onClick={() => navigate(1)} className="sk-btn-ghost text-sm px-2 py-1 min-h-[44px] min-w-[44px]">▶</button>
          </div>
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={() => setShowLegend(true)} className="sk-btn-ghost text-xs px-2 py-1 min-h-[44px]">🎨</button>
        </div>

        <MobileViewSwitcher vista={mobileVista} onChange={setMobileVista} />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <span className="animate-spin mr-2">⏳</span> Caricamento…
          </div>
        ) : (
          <>
            {mobileVista === 'agenda' && <AgendaView eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} now={now} />}
            {mobileVista === 'giorno' && <MobileDayView date={currentDate} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} now={now} />}
            {mobileVista === '3giorni' && <Mobile3DayView centerDate={currentDate} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} now={now} />}
            {mobileVista === 'settimana' && (
              <div className="flex-1 overflow-x-auto overflow-y-auto pb-24">
                <DesktopWeekTimelineView weekStart={startOfWeekMon(currentDate)} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick} onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                  now={now} onQuickCreate={handleQuickCreate} onResize={handleResize} />
              </div>
            )}
            {mobileVista === 'mese' && (
              <MobileMonthView year={currentDate.getFullYear()} month={currentDate.getMonth()} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onDaySelect={d => setSelectedDate(d)} />
            )}
          </>
        )}

        <button onClick={() => { setSelectedDate(oggi); setShowTaskModal(true); }}
          className="fixed bottom-6 right-4 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center text-2xl active:scale-95 transition-transform">+</button>

        <LegendaBottomSheet open={showLegend} onClose={() => setShowLegend(false)} />

        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white animate-slide-up">
            <EventDetail ev={selectedEvent} team={team} clienti={clienti} onClose={() => setSelectedEvent(null)} onDelete={handleDeleteEvent} onUpdate={handleUpdateEvent} now={now} />
          </div>
        )}

        {showTaskModal && <NuovoTaskModal team={team} clienti={clienti} utente={utente} onClose={() => { setShowTaskModal(false); setQuickCreateData(null); }} onCreated={handleTaskCreated} dataPrecompilata={toDateStr(selectedDate)} />}
        {showCLPPicker && <CLPPicker contenuti={contenuti} selectedDate={selectedDate} onSave={handleSaveCLP} onClose={() => setShowCLPPicker(false)} />}
        {showSlotModal && <SlotModal selectedDate={selectedDate} team={team} onSave={handleSaveSlot} onClose={() => setShowSlotModal(false)} />}
      </div>
    );
  }

  // ── DESKTOP LAYOUT — Google Calendar Style ────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header (Google Calendar style) ─────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebarOpen(p => !p)} className="sk-btn-ghost text-sm px-2 py-1" title="Toggle sidebar">☰</button>
          <button onClick={() => navigate(-1)} className="sk-btn-ghost text-sm px-2 py-1">◀</button>
          <button onClick={goToday} className="sk-btn-ghost text-sm px-3 py-1 border rounded-lg">Oggi</button>
          <button onClick={() => navigate(1)} className="sk-btn-ghost text-sm px-2 py-1">▶</button>
          <h2 className="font-semibold text-lg ml-3">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          {showSearch ? (
            <div className="relative">
              <div className="flex items-center gap-1 border rounded-lg px-2 py-1">
                <span className="text-muted-foreground text-sm">🔍</span>
                <input
                  type="text"
                  placeholder="Cerca evento…"
                  className="text-sm border-none outline-none bg-transparent w-48"
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setShowSearch(false); setShowSearchDropdown(false); } }}
                  onBlur={() => { setTimeout(() => { if (!searchQuery) { setShowSearch(false); setShowSearchDropdown(false); } }, 200); }}
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setShowSearchDropdown(false); }} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                )}
              </div>
              {showSearchDropdown && (
                <SearchDropdown query={searchQuery} eventi={eventi} onSelect={handleSearchSelect} onClose={() => setShowSearchDropdown(false)} />
              )}
            </div>
          ) : (
            <button onClick={() => setShowSearch(true)} className="sk-btn-ghost text-sm px-2 py-1" title="Cerca evento">🔍</button>
          )}

          {/* View switcher */}
          <div className="flex border rounded-lg overflow-hidden">
            {(['giorno', 'settimana', 'mese', 'agenda'] as DesktopVista[]).map(v => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={`text-xs px-3 py-1.5 transition-colors capitalize ${vista === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                {v === 'giorno' ? 'Giorno' : v === 'settimana' ? 'Settimana' : v === 'mese' ? 'Mese' : 'Agenda'}
              </button>
            ))}
          </div>

          {/* New event button */}
          <button
            onClick={() => { setSelectedDate(oggi); setShowTaskModal(true); }}
            className="sk-btn-primary text-sm flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Nuovo evento
          </button>
        </div>
      </div>

      {/* ── Body: Sidebar + Calendar ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-56 shrink-0 border-r bg-white overflow-y-auto p-3 flex flex-col">
            <MiniCalendar
              year={miniCalYear}
              month={miniCalMonth}
              oggi={oggi}
              selectedDate={currentDate}
              onDateSelect={(d) => {
                setCurrentDate(d);
                if (vista === 'mese') {
                  // Navigate month view to that month
                  setCurrentDate(d);
                } else if (vista === 'settimana') {
                  setCurrentDate(d);
                } else {
                  setVista('giorno');
                  setCurrentDate(d);
                }
              }}
              onMonthChange={(dir) => {
                const newDate = new Date(miniCalYear, miniCalMonth + dir, 1);
                setMiniCalMonth(newDate.getMonth());
                setMiniCalYear(newDate.getFullYear());
              }}
            />

            <SidebarFilters
              categories={categoryFilters}
              toggleCategory={toggleCategory}
              operators={operatorFilters}
              toggleOperator={toggleOperator}
              team={team}
            />
          </div>
        )}

        {/* Main calendar area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <span className="animate-spin mr-2">⏳</span> Caricamento…
            </div>
          ) : (
            <>
              {vista === 'mese' && (
                <DesktopMonthView
                  year={currentDate.getFullYear()} month={currentDate.getMonth()}
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onDayClick={handleDayClick} onEventClick={setSelectedEvent}
                  onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                  now={now}
                />
              )}
              {vista === 'settimana' && (
                <DesktopWeekTimelineView
                  weekStart={startOfWeekMon(currentDate)}
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick}
                  onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                  now={now} onQuickCreate={handleQuickCreate} onResize={handleResize}
                />
              )}
              {vista === 'giorno' && (
                <DesktopDayView
                  date={currentDate}
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick}
                  onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                  now={now} onQuickCreate={handleQuickCreate} onResize={handleResize}
                />
              )}
              {vista === 'agenda' && (
                <DesktopAgendaView
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent}
                  now={now}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Undo toast ───────────────────────────────────────────────────────── */}
      {undoData && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-3 animate-slide-up">
          <span className="text-sm">📅 Evento spostato</span>
          <button onClick={handleUndo} className="text-sm font-semibold underline hover:no-underline">Annulla</button>
        </div>
      )}

      {/* ── Context menu ─────────────────────────────────────────────────────── */}
      {dayMenu && (
        <DayMenu date={dayMenu.date} x={dayMenu.x} y={dayMenu.y} utente={utente}
          onNewTask={() => setShowTaskModal(true)} onPickCLP={() => setShowCLPPicker(true)}
          onSlot={() => setShowSlotModal(true)} onClose={() => setDayMenu(null)} />
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showTaskModal && <NuovoTaskModal team={team} clienti={clienti} utente={utente} onClose={() => { setShowTaskModal(false); setQuickCreateData(null); }} onCreated={handleTaskCreated} dataPrecompilata={toDateStr(selectedDate)} />}
      {showCLPPicker && <CLPPicker contenuti={contenuti} selectedDate={selectedDate} onSave={handleSaveCLP} onClose={() => setShowCLPPicker(false)} />}
      {showSlotModal && <SlotModal selectedDate={selectedDate} team={team} onSave={handleSaveSlot} onClose={() => setShowSlotModal(false)} />}

      {/* ── Event Detail Panel ─────────────────────────────────────────────── */}
      {selectedEvent && (
        <EventDetail ev={selectedEvent} team={team} clienti={clienti} onClose={() => setSelectedEvent(null)} onDelete={handleDeleteEvent} onUpdate={handleUpdateEvent} now={now} />
      )}
    </div>
  );
}
