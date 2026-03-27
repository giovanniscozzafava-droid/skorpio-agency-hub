import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Workflow task colors (auto-generated tasks from CLP workflow)
const WORKFLOW_STYLE = { bg: '#E3F2FD', border: '#1565C0', icon: '⚙️', label: 'Task Workflow', dot: '#1565C0' };

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
  // Check if it's a workflow-generated task (from trigger sync)
  if (ev.tipo === 'appuntamento' && ev.descrizione?.includes('[TASK:')) {
    return WORKFLOW_STYLE;
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

// ─── Sidebar Filters ────────────────────────────────────────────────────────
function SidebarFilters({ 
  categories, toggleCategory, operators, toggleOperator, team 
}: {
  categories: Record<string, boolean>;
  toggleCategory: (k: string) => void;
  operators: Record<string, boolean>;
  toggleOperator: (name: string) => void;
  team: TeamMember[];
}) {
  return (
    <>
      <div className="border-t pt-3 mt-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">📂 Categorie</div>
        <div className="space-y-1.5">
          {Object.entries(TIPO_STYLE).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <input type="checkbox" checked={categories[k] !== false} onChange={() => toggleCategory(k)} className="sr-only" />
              <span className="w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center" 
                style={{ borderColor: v.dot, background: categories[k] !== false ? v.dot : 'transparent' }}>
                {categories[k] !== false && <span className="text-white text-[8px]">✓</span>}
              </span>
              <span>{v.icon} {v.label}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
            <input type="checkbox" checked={categories['marketing'] !== false} onChange={() => toggleCategory('marketing')} className="sr-only" />
            <span className="w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center"
              style={{ borderColor: '#F97316', background: categories['marketing'] !== false ? '#F97316' : 'transparent' }}>
              {categories['marketing'] !== false && <span className="text-white text-[8px]">✓</span>}
            </span>
            <span>📌 Marketing</span>
          </label>
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
function DesktopAgendaView({ eventi, marketing, oggi, onEventClick }: {
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
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
              {/* Date column */}
              <div className={`w-24 shrink-0 pt-0.5 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                <div className="text-xs font-medium">{GIORNI_FULL[getDayIndex(d)].slice(0, 3)}</div>
                <div className={`text-2xl font-bold leading-tight ${isToday ? 'text-primary' : ''}`}>{d.getDate()}</div>
                <div className="text-xs">{MESI[d.getMonth()].slice(0, 3)}</div>
              </div>

              {/* Events column */}
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
                      className={`flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer hover:shadow-sm transition-all ${completato ? 'opacity-50' : ''}`}
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
                      {scaduto && <span className="text-xs font-semibold text-destructive shrink-0">🔴 SCADUTO</span>}
                      {ev.ora_fine && (
                        <span className="text-xs text-muted-foreground shrink-0">→ {formatTime(ev.ora_fine)}</span>
                      )}
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

// ─── Desktop Day View (timeline) ────────────────────────────────────────────
function DesktopDayView({ date, eventi, marketing, oggi, onEventClick, onSlotClick, onEventDrop, dragEvId, setDragEvId }: {
  date: Date;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
  onSlotClick: (date: Date, hour: number) => void;
  onEventDrop: (evId: string, newDate: string, newHour?: number) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
}) {
  const dateStr = toDateStr(date);
  const isToday = isSameDay(date, oggi);
  const dayEvents = eventi.filter(e => e.data === dateStr);
  const dayMkt = marketing.filter(e => {
    if (e.data === dateStr) return true;
    if (e.data_fine && e.data <= dateStr && e.data_fine >= dateStr) return true;
    return false;
  });

  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6:00 - 22:00
  const noTimeEvents = dayEvents.filter(e => !e.ora);
  const timedEvents = dayEvents.filter(e => !!e.ora);

  // Current time indicator
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const showRedLine = isToday && currentHour >= 6 && currentHour <= 22;
  const redLineTop = showRedLine ? (currentHour - 6) * 60 + currentMinute : -1;

  const [dropHour, setDropHour] = useState<number | null>(null);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Day header */}
      <div className={`text-center py-3 border-b sticky top-0 z-10 ${isToday ? 'bg-primary/5' : 'bg-white'}`}>
        <div className="text-xs text-muted-foreground">{GIORNI_FULL[getDayIndex(date)]}</div>
        <div className={`text-3xl font-bold mt-0.5 w-12 h-12 mx-auto flex items-center justify-center rounded-full
          ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
          {date.getDate()}
        </div>
        <div className="text-xs text-muted-foreground">{MESI[date.getMonth()]} {date.getFullYear()}</div>
      </div>

      {/* All-day events */}
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
              return (
                <div key={ev.id} onClick={() => onEventClick(ev)} className="text-xs rounded px-2 py-1 cursor-pointer hover:opacity-80"
                  style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                  {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}
                  {ev.cliente_nome && <span className="text-muted-foreground ml-1">· {ev.cliente_nome}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative" style={{ minHeight: hours.length * 60 }}>
        {/* Red line for current time */}
        {showRedLine && (
          <div className="absolute left-14 right-0 z-20 flex items-center" style={{ top: redLineTop }}>
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 h-[2px] bg-red-500" />
          </div>
        )}

        {hours.map(h => {
          const hEvents = timedEvents.filter(e => getHourFromTime(e.ora) === h);
          const isDragOver = dropHour === h;
          return (
            <div
              key={h}
              className="flex border-b"
              style={{ height: 60 }}
              onClick={() => onSlotClick(date, h)}
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
              <div className={`flex-1 border-l px-2 py-1 cursor-pointer transition-colors ${isDragOver ? 'bg-primary/10' : 'hover:bg-accent/30'}`}>
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
                      className={`rounded-lg px-3 py-1.5 text-sm cursor-grab mb-1 hover:shadow-sm transition-shadow ${completato ? 'opacity-50' : ''}`}
                      style={{ background: s.bg, borderLeft: `4px solid ${s.border}` }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs" style={{ color: s.border }}>
                          {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                        </span>
                        <span>{s.icon}</span>
                        <span className="font-medium">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</span>
                      </div>
                      {(ev.cliente_nome || ev.persona) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {ev.cliente_nome}{ev.persona && ` · ${ev.persona}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Desktop Week View (timeline) ───────────────────────────────────────────
function DesktopWeekTimelineView({ weekStart, eventi, marketing, oggi, onEventClick, onSlotClick, onEventDrop, dragEvId, setDragEvId }: {
  weekStart: Date;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
  onSlotClick: (date: Date, hour: number) => void;
  onEventDrop: (evId: string, newDate: string, newHour?: number) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Current time red line
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const isCurrentWeek = days.some(d => isSameDay(d, oggi));
  const todayCol = isCurrentWeek ? days.findIndex(d => isSameDay(d, oggi)) : -1;
  const redLineTop = (currentHour >= 6 && currentHour <= 22) ? (currentHour - 6) * 60 + currentMinute : -1;

  // All-day events per day
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
    <div className="flex-1 overflow-auto min-h-0">
      {/* Sticky header with day names */}
      <div className="sticky top-0 z-20 bg-white border-b">
        <div className="flex">
          <div className="w-14 shrink-0" />
          {days.map(d => {
            const isToday = isSameDay(d, oggi);
            return (
              <div key={toDateStr(d)} className={`flex-1 text-center py-2 border-l ${isToday ? 'bg-primary/5' : ''}`}>
                <div className="text-xs text-muted-foreground">{GIORNI[getDayIndex(d)]}</div>
                <div className={`text-lg font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full mt-0.5
                  ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day events row */}
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
                    return (
                      <div key={ev.id} onClick={() => onEventClick(ev)} className="text-[9px] rounded px-1 py-0.5 truncate cursor-pointer"
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

      {/* Timeline grid */}
      <div className="relative">
        {/* Red line for current time */}
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
              const isToday = isSameDay(d, oggi);
              const targetKey = `${ds}-${h}`;
              const isDragOver = dropTarget === targetKey;
              const hEvents = eventi.filter(e => e.data === ds && e.ora && getHourFromTime(e.ora) === h);

              return (
                <div
                  key={targetKey}
                  className={`flex-1 border-l border-b px-0.5 py-0.5 cursor-pointer transition-colors
                    ${isDragOver ? 'bg-primary/10' : isToday ? 'bg-primary/[0.02]' : 'hover:bg-accent/20'}`}
                  onClick={() => onSlotClick(d, h)}
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
                        className={`rounded px-1.5 py-1 text-[10px] leading-tight cursor-grab mb-0.5 hover:shadow-sm transition-shadow ${completato ? 'opacity-40' : ''}`}
                        style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, opacity: dragEvId === ev.id ? 0.4 : undefined }}
                      >
                        <div className="font-mono font-semibold" style={{ color: s.border, fontSize: 9 }}>
                          {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                        </div>
                        <div className="font-medium truncate">{ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 18)}</div>
                        {ev.cliente_nome && <div className="truncate text-muted-foreground" style={{ fontSize: 9 }}>{ev.cliente_nome}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Desktop Month View (enhanced) ──────────────────────────────────────────
function DesktopMonthView({ year, month, eventi, marketing, oggi, onDayClick, onEventClick, onEventDrop, dragEvId, setDragEvId }: {
  year: number; month: number;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  onDayClick: (date: Date, x: number, y: number) => void;
  onEventClick: (ev: CalendarioEvent) => void;
  onEventDrop: (evId: string, newDate: string) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
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
              className={`border-b border-r p-1 min-h-[100px] cursor-pointer transition-colors relative`}
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
                    className="truncate px-1 py-0.5 rounded text-[10px] leading-tight mb-0.5 hover:shadow-sm transition-shadow"
                  >
                    {ev.ora && <span className="font-mono mr-0.5" style={{ fontSize: 9 }}>{formatTime(ev.ora)}</span>}
                    {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '').slice(0, 18)}
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
                    <div key={m.id} className="text-xs rounded px-2 py-1" style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}>
                      {MARKETING_LABEL[m.categoria]} {m.titolo}
                    </div>
                  );
                })}
                {dayEv.map(ev => {
                  const s = getEventStyle(ev);
                  return (
                    <div key={ev.id} onClick={() => { setMorePopover(null); onEventClick(ev); }}
                      className="text-xs rounded px-2 py-1.5 cursor-pointer hover:shadow-sm"
                      style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}>
                      {ev.ora && <span className="font-mono mr-1">{formatTime(ev.ora)}</span>}
                      {s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}
                      {ev.cliente_nome && <span className="text-muted-foreground ml-1">· {ev.cliente_nome}</span>}
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

// ─── Mobile Components (preserved from original) ────────────────────────────

// Mobile Agenda View
function AgendaView({ eventi, marketing, oggi, onEventClick }: {
  eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
}) {
  const allDates = new Set<string>();
  eventi.forEach(e => allDates.add(e.data));
  marketing.forEach(e => allDates.add(e.data));
  const sortedDates = Array.from(allDates).sort();
  const todayStr = toDateStr(oggi);
  const futureDate = addDays(oggi, 30);
  const futureDateStr = toDateStr(futureDate);
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
                return (
                  <div key={ev.id} onClick={() => onEventClick(ev)}
                    className="rounded-xl p-3 border active:scale-[0.98] transition-transform cursor-pointer"
                    style={{ background: s.bg, borderColor: s.border + '40', borderLeftWidth: 4, borderLeftColor: s.border }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm leading-snug">{s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {ev.cliente_nome && <span className="text-xs text-muted-foreground">{ev.cliente_nome}</span>}
                          {ev.persona && <span className="text-xs text-muted-foreground">· {ev.persona}</span>}
                          {ev.ora && (
                            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: s.border + '18', color: s.border }}>
                              ⏰ {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                            </span>
                          )}
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
function MobileDayView({ date, eventi, marketing, oggi, onEventClick }: {
  date: Date; eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
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
                    <div className="font-medium">{s.icon} {ev.descrizione?.replace(/\s*\[TASK:[^\]]+\]/, '')}</div>
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
function Mobile3DayView({ centerDate, eventi, marketing, oggi, onEventClick }: {
  centerDate: Date; eventi: CalendarioEvent[]; marketing: MarketingEvent[]; oggi: Date;
  onEventClick: (ev: CalendarioEvent) => void;
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
  contenuti: Contenuto[]; selectedDate: Date;
  onSave: (contenuto: Contenuto, ora: string) => void; onClose: () => void;
}
function CLPPicker({ contenuti, selectedDate, onSave, onClose }: CLPPickerProps) {
  const [search, setSearch] = useState('');
  const [ora, setOra] = useState('');
  const [selected, setSelected] = useState<Contenuto | null>(null);

  const available = contenuti.filter(c =>
    c.fase !== 'Pubblicato' && c.fase !== 'Scartata' &&
    (search === '' ||
      c.titolo.toLowerCase().includes(search.toLowerCase()) ||
      c.id_display.toLowerCase().includes(search.toLowerCase()) ||
      c.cliente_nome.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="sk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-modal animate-slide-up" style={{ maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-base">📹 Posiziona contenuto — {selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>
        <div className="p-4 border-b">
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

// ─── Event Detail Panel ──────────────────────────────────────────────────────
interface EventDetailProps {
  ev: CalendarioEvent; team: TeamMember[]; clienti: Cliente[];
  onClose: () => void; onDelete: () => void; onUpdate: (updated: CalendarioEvent) => void;
}
function EventDetail({ ev, team, clienti, onClose, onDelete, onUpdate }: EventDetailProps) {
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
  const [saving, setSaving] = useState(false);
  const setF = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      descrizione: form.descrizione,
      data: form.data,
      ora: form.ora || null,
      ora_fine: form.ora_fine || null,
      persona: form.persona || null,
      cliente_id: form.cliente_id || null,
      cliente_nome: clienti.find(c => c.id === form.cliente_id)?.nome || ev.cliente_nome,
      stato: form.stato || null,
    };
    const { data, error } = await supabase.from('calendario').update(payload).eq('id', ev.id).select().single();
    setSaving(false);
    if (!error && data) {
      if (ev.tipo === 'appuntamento') {
        await supabase.from('task').update({ scadenza: form.data, ora: form.ora || null })
          .like('descrizione', `%${ev.descrizione.replace(/\[TASK:.*\]/, '').trim()}%`)
          .eq('scadenza', ev.data);
      }
      onUpdate(data as CalendarioEvent);
      setEditing(false);
      addToast('✅ Evento aggiornato', 'success');
    }
  };

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
            {ev.cliente_nome && <div><div className="text-xs text-muted-foreground mb-1">Cliente</div><div className="text-sm">{ev.cliente_nome}</div></div>}
            {ev.id_contenuto_display && <div><div className="text-xs text-muted-foreground mb-1">Contenuto</div><div className="text-sm font-mono text-primary">{ev.id_contenuto_display}</div></div>}
            {ev.canale && <div><div className="text-xs text-muted-foreground mb-1">Canale</div><div className="text-sm">{ev.canale}</div></div>}
            {ev.persona && <div><div className="text-xs text-muted-foreground mb-1">Persona</div><div className="text-sm">{ev.persona}</div></div>}
            {ev.stato && <div><div className="text-xs text-muted-foreground mb-1">Stato</div><div className="text-sm">{ev.stato}</div></div>}
            <div className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'hsl(214 80% 55% / 0.07)', color: 'hsl(214 70% 44%)', border: '1px solid hsl(214 80% 55% / 0.20)' }}>
              💡 Puoi anche trascinare l'evento nel calendario per cambiare data
            </div>
          </>
        )}
      </div>

      <div className="p-4 border-t">
        <button onClick={onDelete} className="w-full text-sm text-destructive border border-destructive/30 rounded-lg py-2 hover:bg-destructive/10 transition-colors">
          🗑️ Elimina evento
        </button>
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

  // Filters
  const [categoryFilters, setCategoryFilters] = useState<Record<string, boolean>>({});
  const [operatorFilters, setOperatorFilters] = useState<Record<string, boolean>>({});

  const toggleCategory = (k: string) => setCategoryFilters(prev => ({ ...prev, [k]: prev[k] === false ? true : false }));
  const toggleOperator = (name: string) => setOperatorFilters(prev => ({ ...prev, [name]: prev[name] === false ? true : false }));

  // Drag state
  const [dragEvId, setDragEvId] = useState<string | null>(null);

  // Modal states
  const [dayMenu, setDayMenu] = useState<{ date: Date; x: number; y: number } | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showCLPPicker, setShowCLPPicker] = useState(false);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarioEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(oggi);

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

    // Log event count for data integrity verification
    console.log(`[Calendario] Loaded ${eventiFiltrati.length} events (total: ${tuttiEventi.length}), ${(mktRes.data || []).length} marketing events`);

    setEventi(eventiFiltrati);
    setMarketing((mktRes.data as MarketingEvent[]) || []);
    setContenuti((contRes.data as any[]) || []);
    setLoading(false);
  }, [vista, currentDate, utente, isMobile]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Apply filters to events ────────────────────────────────────────────────
  const filteredEventi = eventi.filter(ev => {
    // Category filter
    if (categoryFilters[ev.tipo] === false) return false;
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
  });

  const filteredMarketing = marketing.filter(() => categoryFilters['marketing'] !== false);

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

  // ── Drag-drop evento (PRESERVED + enhanced for hour) ──────────────────────
  const handleEventDrop = async (evId: string, newDateStr: string, newHour?: number) => {
    const ev = eventi.find(e => e.id === evId);
    if (!ev) return;
    if (ev.data === newDateStr && newHour === undefined) return;

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
      if (ev.tipo === 'appuntamento') {
        const taskUpdate: any = { scadenza: newDateStr };
        if (newOra) taskUpdate.ora = newOra;
        await supabase.from('task').update(taskUpdate)
          .like('descrizione', `%${ev.descrizione.replace(/ \[TASK:.*\]/, '').trim()}%`)
          .eq('scadenza', ev.data);
      }
      const d = parseLocalDate(newDateStr);
      addToast(`📅 Evento spostato al ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}${newOra ? ` alle ${newOra}` : ''}`, 'success');
    }
  };

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
      const payload = {
        tipo: 'appuntamento' as const,
        descrizione: task.descrizione,
        data: task.scadenza,
        ora: task.ora || null,
        cliente_id: task.cliente_id || null,
        cliente_nome: task.cliente_nome || '',
        persona: task.assegnato_a,
      };
      const { data } = await supabase.from('calendario').insert(payload).select().single();
      if (data) setEventi(prev => [...prev, data as CalendarioEvent]);
    }
    addToast(`✅ Task ${task.id_display} creato`, 'success');
    setShowTaskModal(false);
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
            {mobileVista === 'agenda' && <AgendaView eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} />}
            {mobileVista === 'giorno' && <MobileDayView date={currentDate} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} />}
            {mobileVista === '3giorni' && <Mobile3DayView centerDate={currentDate} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi} onEventClick={setSelectedEvent} />}
            {mobileVista === 'settimana' && (
              <div className="flex-1 overflow-x-auto overflow-y-auto pb-24">
                <DesktopWeekTimelineView weekStart={startOfWeekMon(currentDate)} eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick} onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId} />
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
            <EventDetail ev={selectedEvent} team={team} clienti={clienti} onClose={() => setSelectedEvent(null)} onDelete={handleDeleteEvent} onUpdate={handleUpdateEvent} />
          </div>
        )}

        {showTaskModal && <NuovoTaskModal team={team} clienti={clienti} utente={utente} onClose={() => setShowTaskModal(false)} onCreated={handleTaskCreated} dataPrecompilata={toDateStr(selectedDate)} />}
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
            <div className="flex items-center gap-1 border rounded-lg px-2 py-1">
              <span className="text-muted-foreground text-sm">🔍</span>
              <input
                type="text"
                placeholder="Cerca evento…"
                className="text-sm border-none outline-none bg-transparent w-40"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
                onBlur={() => { if (!searchQuery) setShowSearch(false); }}
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setShowSearch(false); }} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
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
                  // Stay in month view but navigate to that month
                } else {
                  setVista('giorno');
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
                />
              )}
              {vista === 'settimana' && (
                <DesktopWeekTimelineView
                  weekStart={startOfWeekMon(currentDate)}
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick}
                  onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                />
              )}
              {vista === 'giorno' && (
                <DesktopDayView
                  date={currentDate}
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent} onSlotClick={handleSlotClick}
                  onEventDrop={handleEventDrop} dragEvId={dragEvId} setDragEvId={setDragEvId}
                />
              )}
              {vista === 'agenda' && (
                <DesktopAgendaView
                  eventi={filteredEventi} marketing={filteredMarketing} oggi={oggi}
                  onEventClick={setSelectedEvent}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Context menu ─────────────────────────────────────────────────────── */}
      {dayMenu && (
        <DayMenu date={dayMenu.date} x={dayMenu.x} y={dayMenu.y} utente={utente}
          onNewTask={() => setShowTaskModal(true)} onPickCLP={() => setShowCLPPicker(true)}
          onSlot={() => setShowSlotModal(true)} onClose={() => setDayMenu(null)} />
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showTaskModal && <NuovoTaskModal team={team} clienti={clienti} utente={utente} onClose={() => setShowTaskModal(false)} onCreated={handleTaskCreated} dataPrecompilata={toDateStr(selectedDate)} />}
      {showCLPPicker && <CLPPicker contenuti={contenuti} selectedDate={selectedDate} onSave={handleSaveCLP} onClose={() => setShowCLPPicker(false)} />}
      {showSlotModal && <SlotModal selectedDate={selectedDate} team={team} onSave={handleSaveSlot} onClose={() => setShowSlotModal(false)} />}

      {/* ── Event detail panel ───────────────────────────────────────────────── */}
      {selectedEvent && (
        <EventDetail ev={selectedEvent} team={team} clienti={clienti}
          onClose={() => setSelectedEvent(null)} onDelete={handleDeleteEvent} onUpdate={handleUpdateEvent} />
      )}
    </div>
  );
}
