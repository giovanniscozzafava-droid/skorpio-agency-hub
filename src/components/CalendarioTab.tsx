import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { NuovoTaskModal } from './NuovoTaskModal';
import { creaTaskWorkflow, completaTaskPerContenuto, findMembro } from '../lib/clpWorkflow';
import type { CalendarioEvent, Contenuto, MarketingEvent, TeamMember, Cliente, Task } from '../types';
import { parseLocalDate, toDateStr, isSameDay, addDays } from '../lib/dateUtils';

// ─── Constants ──────────────────────────────────────────────────────────────
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const TIPO_STYLE: Record<string, { bg: string; border: string; icon: string; label: string }> = {
  pubblicazione: { bg: '#EDE9FE', border: '#7C3AED', icon: '📱', label: 'Pubblicazione' },
  appuntamento:  { bg: '#FEF3C7', border: '#D97706', icon: '📅', label: 'Appuntamento' },
  contenuto:     { bg: '#ECFDF5', border: '#059669', icon: '📹', label: 'Contenuto' },
  slot_pianificato: { bg: '#DBEAFE', border: '#2563EB', icon: '📝', label: 'Slot Pianificato' },
};

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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function startOfWeekMon(d: Date) {
  const day = d.getDay(); // 0=Sun
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

// ─── Legenda ─────────────────────────────────────────────────────────────────
function Legenda() {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {Object.entries(TIPO_STYLE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1">
          <span style={{ width: 10, height: 10, borderRadius: 2, background: v.bg, border: `1.5px solid ${v.border}`, display: 'inline-block' }} />
          {v.label}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#FFF7ED', border: '1.5px solid #F97316', display: 'inline-block' }} />
        Marketing
      </span>
    </div>
  );
}

// ─── Event Badge (compact) ────────────────────────────────────────────────────
function EventBadge({ ev, onClick, onDragStart, onDragEnd, isDragging }: {
  ev: CalendarioEvent;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const s = TIPO_STYLE[ev.tipo] || TIPO_STYLE.appuntamento;
  return (
    <div
      draggable
      onDragStart={e => { e.stopPropagation(); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={`${ev.descrizione} — trascina per spostare`}
      style={{
        background: s.bg,
        borderLeft: `3px solid ${s.border}`,
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
      }}
      className="truncate px-1 py-0.5 rounded text-[10px] leading-tight mb-0.5 hover:opacity-80"
    >
      {s.icon} {ev.descrizione.slice(0, 20)}
    </div>
  );
}

function MarketingBadge({ ev }: { ev: MarketingEvent }) {
  const color = MARKETING_COLOR[ev.categoria] || '#F97316';
  const icon = MARKETING_LABEL[ev.categoria] || '📌';
  return (
    <div
      title={ev.titolo}
      style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}
      className="truncate px-1 py-0.5 rounded text-[10px] leading-tight mb-0.5"
    >
      {icon} {ev.titolo.slice(0, 20)}
    </div>
  );
}

// ─── Day Click Menu ───────────────────────────────────────────────────────────
interface DayMenuProps {
  date: Date;
  x: number;
  y: number;
  utente: TeamMember;
  onNewTask: () => void;
  onPickCLP: () => void;
  onSlot: () => void;
  onClose: () => void;
}
function DayMenu({ x, y, utente, onNewTask, onPickCLP, onSlot, onClose }: DayMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', top: y, left: x, zIndex: 1000,
        background: 'white', border: '1px solid hsl(var(--border))',
        borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        minWidth: 200, padding: 4
      }}
    >
      <button
        onClick={() => { onClose(); onNewTask(); }}
        className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md"
      >📝 Nuovo task / Appuntamento</button>
      <button
        onClick={() => { onClose(); onPickCLP(); }}
        className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md"
      >📹 Posiziona contenuto (CLP)</button>
      {utente.nome === 'Elisa' && (
        <button
          onClick={() => { onClose(); onSlot(); }}
          className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md"
        >📅 Pianifica slot</button>
      )}
    </div>
  );
}

// ─── CLP Picker Modal ─────────────────────────────────────────────────────────
interface CLPPickerProps {
  contenuti: Contenuto[];
  selectedDate: Date;
  onSave: (contenuto: Contenuto, ora: string) => void;
  onClose: () => void;
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
          <h3 className="font-semibold text-base">
            📹 Posiziona contenuto — {selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}
          </h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        <div className="p-4 border-b">
          <input
            className="sk-input w-full"
            placeholder="Cerca per titolo, ID, cliente…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {available.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">Nessun contenuto disponibile</p>
          )}
          {available.map(c => (
            <div
              key={c.id}
              onClick={() => setSelected(selected?.id === c.id ? null : c)}
              className={`p-3 rounded-lg border mb-2 cursor-pointer transition-all ${selected?.id === c.id ? 'border-primary bg-accent' : 'border-border hover:border-muted-foreground'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{c.titolo}</span>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: FASE_COLORS[c.fase] + '22', color: FASE_COLORS[c.fase] }}
                >
                  {c.fase}
                </span>
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
              <button
                onClick={() => onSave(selected, ora)}
                className="sk-btn-primary"
              >
                ✅ Posiziona
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slot Pianificato Modal ───────────────────────────────────────────────────
interface SlotModalProps {
  selectedDate: Date;
  team: TeamMember[];
  onSave: (descrizione: string, persona: string, ora: string, oraFine: string) => void;
  onClose: () => void;
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
          <h3 className="font-semibold text-base">
            📅 Pianifica Slot — {selectedDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}
          </h3>
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
            <button
              onClick={() => { if (descrizione.trim()) onSave(descrizione, persona, ora, oraFine); }}
              className="sk-btn-primary"
            >✅ Crea Slot</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Event Detail Panel (editabile) ──────────────────────────────────────────
interface EventDetailProps {
  ev: CalendarioEvent;
  team: TeamMember[];
  clienti: Cliente[];
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: CalendarioEvent) => void;
}

function EventDetail({ ev, team, clienti, onClose, onDelete, onUpdate }: EventDetailProps) {
  const s = TIPO_STYLE[ev.tipo] || TIPO_STYLE.appuntamento;
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

    const { data, error } = await supabase
      .from('calendario')
      .update(payload)
      .eq('id', ev.id)
      .select()
      .single();

    setSaving(false);
    if (!error && data) {
      // Se è un appuntamento/task, aggiorna anche il task associato sul Kanban
      if (ev.tipo === 'appuntamento') {
        // Cerca il task corrispondente per descrizione (task sincronizzato dal trigger)
        await supabase
          .from('task')
          .update({ scadenza: form.data, ora: form.ora || null })
          .like('descrizione', `%${ev.descrizione.replace(/\[TASK:.*\]/, '').trim()}%`)
          .eq('scadenza', ev.data);
      }
      onUpdate(data as CalendarioEvent);
      setEditing(false);
      addToast('✅ Evento aggiornato', 'success');
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 w-96 bg-white border-l shadow-2xl z-50 flex flex-col"
      style={{ top: 0, animation: 'slideInRight 0.2s ease-out' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 border-b"
        style={{ background: s.bg, borderBottomColor: s.border + '40' }}
      >
        <span className="font-semibold text-sm">{s.icon} {s.label}</span>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-2.5 py-1 rounded-md transition-colors font-medium"
              style={{ background: s.border + '20', color: s.border, border: `1px solid ${s.border}40` }}
            >
              ✏️ Modifica
            </button>
          )}
          <button onClick={onClose} className="sk-btn-ghost text-sm px-2">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {editing ? (
          /* ── EDIT MODE ─────────────────────────────────────────────────── */
          <div className="space-y-3">
            <div>
              <label className="sk-label">Descrizione</label>
              <textarea
                className="sk-textarea w-full text-sm"
                rows={2}
                value={form.descrizione}
                onChange={e => setF('descrizione', e.target.value)}
              />
            </div>

            <div>
              <label className="sk-label">Data</label>
              <input
                type="date"
                className="sk-input w-full text-sm"
                value={form.data}
                onChange={e => setF('data', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="sk-label">Ora inizio</label>
                <input type="time" className="sk-input w-full text-sm" value={form.ora} onChange={e => setF('ora', e.target.value)} />
              </div>
              <div>
                <label className="sk-label">Ora fine</label>
                <input type="time" className="sk-input w-full text-sm" value={form.ora_fine} onChange={e => setF('ora_fine', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="sk-label">Persona</label>
              <select className="sk-select w-full text-sm" value={form.persona} onChange={e => setF('persona', e.target.value)}>
                <option value="">— Nessuno —</option>
                {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>

            <div>
              <label className="sk-label">Cliente</label>
              <select className="sk-select w-full text-sm" value={form.cliente_id} onChange={e => setF('cliente_id', e.target.value)}>
                <option value="">— Nessuno —</option>
                {clienti.filter(c => c.stato === 'Attivo').map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="sk-label">Stato</label>
              <select className="sk-select w-full text-sm" value={form.stato} onChange={e => setF('stato', e.target.value)}>
                <option value="">—</option>
                <option value="Pianificato">Pianificato</option>
                <option value="Confermato">Confermato</option>
                <option value="Completato">Completato</option>
                <option value="Annullato">Annullato</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 sk-btn-ghost text-sm"
              >
                Annulla
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 sk-btn-primary text-sm"
              >
                {saving ? 'Salvo…' : '✅ Salva'}
              </button>
            </div>
          </div>
        ) : (
          /* ── VIEW MODE ─────────────────────────────────────────────────── */
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Descrizione</div>
              <div className="font-medium leading-snug">{ev.descrizione}</div>
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
            {ev.cliente_nome && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Cliente</div>
                <div className="text-sm">{ev.cliente_nome}</div>
              </div>
            )}
            {ev.id_contenuto_display && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Contenuto</div>
                <div className="text-sm font-mono text-primary">{ev.id_contenuto_display}</div>
              </div>
            )}
            {ev.canale && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Canale</div>
                <div className="text-sm">{ev.canale}</div>
              </div>
            )}
            {ev.persona && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Persona</div>
                <div className="text-sm">{ev.persona}</div>
              </div>
            )}
            {ev.stato && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Stato</div>
                <div className="text-sm">{ev.stato}</div>
              </div>
            )}

            {/* Hint drag */}
            <div className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'hsl(214 80% 55% / 0.07)', color: 'hsl(214 70% 44%)', border: '1px solid hsl(214 80% 55% / 0.20)' }}>
              💡 Puoi anche trascinare l'evento nel calendario per cambiare data
            </div>
          </>
        )}
      </div>

      <div className="p-4 border-t">
        <button
          onClick={onDelete}
          className="w-full text-sm text-destructive border border-destructive/30 rounded-lg py-2 hover:bg-destructive/10 transition-colors"
        >
          🗑️ Elimina evento
        </button>
      </div>
    </div>
  );
}

// ─── Vista Mese ───────────────────────────────────────────────────────────────
interface MonthViewProps {
  year: number;
  month: number;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  utente: TeamMember;
  onDayClick: (date: Date, x: number, y: number) => void;
  onEventClick: (ev: CalendarioEvent) => void;
  onEventDrop: (evId: string, newDate: string) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
}

function MonthView({ year, month, eventi, marketing, oggi, onDayClick, onEventClick, onEventDrop, dragEvId, setDragEvId }: MonthViewProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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
    <div className="flex-1 overflow-auto min-h-0">
      <div className="grid grid-cols-7 border-b sticky top-0 bg-white z-10">
        {GIORNI.map(g => (
          <div key={g} className="text-center text-xs font-semibold text-muted-foreground py-2 border-r last:border-r-0">{g}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} className="border-b border-r bg-muted/20 min-h-[90px]" />;

          const ds = toDateStr(d);
          const isToday = isSameDay(d, oggi);
          const isDragOver = dropTarget === ds;
          const dayEv = evByDay(d);
          const dayMkt = mktByDay(d);
          const MAX_SHOW = 3;

          return (
            <div
              key={ds}
              className="border-b border-r p-1 min-h-[90px] cursor-pointer transition-colors relative"
              style={{
                background: isDragOver ? 'hsl(214 80% 55% / 0.10)' : undefined,
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

              {dayMkt.slice(0, 2).map(m => <MarketingBadge key={m.id} ev={m} />)}
              {dayEv.slice(0, MAX_SHOW - Math.min(dayMkt.length, 2)).map(ev => (
                <EventBadge
                  key={ev.id}
                  ev={ev}
                  onClick={() => onEventClick(ev)}
                  onDragStart={() => setDragEvId(ev.id)}
                  onDragEnd={() => setDragEvId(null)}
                  isDragging={dragEvId === ev.id}
                />
              ))}

              {(dayEv.length + dayMkt.length) > MAX_SHOW && (
                <div className="text-[10px] text-muted-foreground pl-1">
                  +{dayEv.length + dayMkt.length - MAX_SHOW} altri
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vista Settimana ──────────────────────────────────────────────────────────
interface WeekViewProps {
  weekStart: Date;
  eventi: CalendarioEvent[];
  marketing: MarketingEvent[];
  oggi: Date;
  utente: TeamMember;
  onDayClick: (date: Date, x: number, y: number) => void;
  onEventClick: (ev: CalendarioEvent) => void;
  onEventDrop: (evId: string, newDate: string) => void;
  dragEvId: string | null;
  setDragEvId: (id: string | null) => void;
}

function WeekView({ weekStart, eventi, marketing, oggi, onDayClick, onEventClick, onEventDrop, dragEvId, setDragEvId }: WeekViewProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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
    <div className="flex-1 overflow-auto min-h-0">
      <div className="grid grid-cols-7 min-w-[600px]">
        {days.map(d => {
          const ds = toDateStr(d);
          const isToday = isSameDay(d, oggi);
          const isDragOver = dropTarget === ds;
          const dayEv = evByDay(d);
          const dayMkt = mktByDay(d);

          return (
            <div
              key={ds}
              className="border-r last:border-r-0 min-h-[400px] cursor-pointer transition-colors"
              style={{
                background: isDragOver ? 'hsl(214 80% 55% / 0.08)' : isToday ? 'hsl(214 80% 55% / 0.03)' : undefined,
                outline: isDragOver ? '2px solid hsl(214 80% 55% / 0.50)' : undefined,
                outlineOffset: '-2px',
              }}
              onClick={e => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onDayClick(d, Math.min(rect.left, window.innerWidth - 220), rect.bottom - 200);
              }}
              onDragOver={e => { e.preventDefault(); setDropTarget(ds); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault();
                setDropTarget(null);
                if (dragEvId) onEventDrop(dragEvId, ds);
              }}
            >
              {/* Day header */}
              <div className={`text-center py-3 border-b sticky top-0 z-10 ${isToday ? 'bg-primary/10' : 'bg-white'}`}>
                <div className="text-xs text-muted-foreground">{GIORNI[d.getDay() === 0 ? 6 : d.getDay() - 1]}</div>
                <div className={`text-lg font-bold mt-0.5 w-8 h-8 mx-auto flex items-center justify-center rounded-full
                  ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>
                  {d.getDate()}
                </div>
                <div className="text-[10px] text-muted-foreground">{MESI[d.getMonth()].slice(0, 3)}</div>
              </div>

              {/* Events */}
              <div className="p-1 space-y-1">
                {dayMkt.map(m => {
                  const color = MARKETING_COLOR[m.categoria] || '#F97316';
                  const icon = MARKETING_LABEL[m.categoria] || '📌';
                  return (
                    <div
                      key={m.id}
                      style={{ background: '#FFF7ED', borderLeft: `3px solid ${color}`, color }}
                      className="rounded px-2 py-1 text-xs"
                      title={m.titolo}
                    >
                      {icon} <span className="font-medium">{m.titolo}</span>
                    </div>
                  );
                })}

                {dayEv.map(ev => {
                  const s = TIPO_STYLE[ev.tipo] || TIPO_STYLE.appuntamento;
                  const isDragging = dragEvId === ev.id;
                  return (
                    <div
                      key={ev.id}
                      draggable
                      onDragStart={e => { e.stopPropagation(); setDragEvId(ev.id); }}
                      onDragEnd={() => setDragEvId(null)}
                      onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                      style={{
                        background: s.bg,
                        borderLeft: `3px solid ${s.border}`,
                        cursor: 'grab',
                        opacity: isDragging ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}
                      className="rounded px-2 py-1.5 text-xs hover:opacity-80 transition-opacity"
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        {ev.ora && (
                          <span
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: s.border + '22', color: s.border }}
                          >
                            {formatTime(ev.ora)}{ev.ora_fine ? `–${formatTime(ev.ora_fine)}` : ''}
                          </span>
                        )}
                        <span className="opacity-60">{s.icon}</span>
                      </div>
                      <div className="font-medium leading-tight">{ev.descrizione}</div>
                      {ev.cliente_nome && (
                        <div className="text-[10px] opacity-60 mt-0.5 truncate">{ev.cliente_nome}</div>
                      )}
                      {ev.canale && (
                        <div className="text-[10px] opacity-50 truncate">{ev.canale}</div>
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

// ─── Main Component ───────────────────────────────────────────────────────────
interface CalendarioTabProps {
  team: TeamMember[];
  clienti: Cliente[];
}

export function CalendarioTab({ team, clienti }: CalendarioTabProps) {
  const { utente, addToast } = useApp();
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);

  const [vista, setVista] = useState<'mese' | 'settimana'>('mese');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [eventi, setEventi] = useState<CalendarioEvent[]>([]);
  const [marketing, setMarketing] = useState<MarketingEvent[]>([]);
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [loading, setLoading] = useState(true);

  // Drag state for events
  const [dragEvId, setDragEvId] = useState<string | null>(null);

  // Modal states
  const [dayMenu, setDayMenu] = useState<{ date: Date; x: number; y: number } | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showCLPPicker, setShowCLPPicker] = useState(false);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarioEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(oggi);

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!utente) return;
    setLoading(true);
    let rangeStart: string, rangeEnd: string;

    if (vista === 'mese') {
      const y = currentDate.getFullYear(), m = currentDate.getMonth();
      rangeStart = toDateStr(new Date(y, m - 1, 1));
      rangeEnd = toDateStr(new Date(y, m + 2, 0));
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

    setEventi(eventiFiltrati);
    setMarketing((mktRes.data as MarketingEvent[]) || []);
    setContenuti((contRes.data as any[]) || []);
    setLoading(false);
  }, [vista, currentDate, utente]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (vista === 'mese') {
      d.setMonth(d.getMonth() + dir);
    } else {
      d.setDate(d.getDate() + dir * 7);
    }
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = vista === 'mese'
    ? `${MESI[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : (() => {
      const ws = startOfWeekMon(currentDate);
      const we = addDays(ws, 6);
      return `${ws.getDate()} – ${we.getDate()} ${MESI[we.getMonth()]} ${we.getFullYear()}`;
    })();

  // ── Day click ──────────────────────────────────────────────────────────────
  const handleDayClick = (date: Date, x: number, y: number) => {
    setSelectedDate(date);
    setDayMenu({ date, x, y });
  };

  // ── Drag-drop evento: sposta data ──────────────────────────────────────────
  const handleEventDrop = async (evId: string, newDateStr: string) => {
    const ev = eventi.find(e => e.id === evId);
    if (!ev || ev.data === newDateStr) return;

    // Optimistic update
    setEventi(prev => prev.map(e => e.id === evId ? { ...e, data: newDateStr } : e));
    if (selectedEvent?.id === evId) setSelectedEvent(prev => prev ? { ...prev, data: newDateStr } : null);

    const { error } = await supabase
      .from('calendario')
      .update({ data: newDateStr })
      .eq('id', evId);

    if (error) {
      addToast('Errore nello spostamento dell\'evento', 'error');
      loadData();
    } else {
      // Se è un appuntamento task, aggiorna anche il task nel Kanban
      if (ev.tipo === 'appuntamento') {
        await supabase
          .from('task')
          .update({ scadenza: newDateStr })
          .like('descrizione', `%${ev.descrizione.replace(/ \[TASK:.*\]/, '').trim()}%`)
          .eq('scadenza', ev.data);
      }
      const d = parseLocalDate(newDateStr);
      addToast(`📅 Evento spostato al ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`, 'success');
    }
  };

  // ── Create CLP event ────────────────────────────────────────────────────────
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

      await supabase.from('contenuti').update({
        data_pubblicazione: dataStr,
        ora_pubblicazione: oraStr,
      }).eq('id', contenuto.id);

      if (contenuto.fase === 'Girato') {
        const nomeLuca = findMembro(team, 'Luca');
        const contenutoAggiornato = { ...contenuto, data_pubblicazione: dataStr, ora_pubblicazione: oraStr };
        const newTask = await creaTaskWorkflow(
          contenutoAggiornato,
          nomeLuca,
          'Premontaggio',
          `🎬 Premontaggia ${contenuto.id_display} – ${contenuto.titolo}${contenuto.cliente_nome ? ` (${contenuto.cliente_nome})` : ''}`,
          'Da fare',
          dataStr,
          oraStr
        );
        if (newTask) {
          addToast(`📋 Task premontaggio creato per ${nomeLuca}`, 'success');
        } else {
          const { data: existingTask } = await supabase
            .from('task')
            .select('id')
            .eq('id_contenuto', contenuto.id)
            .eq('tipo', 'Premontaggio')
            .neq('stato', 'Completato')
            .neq('stato', 'Archiviato')
            .single();
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

  // ── Create slot pianificato ───────────────────────────────────────────────
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

  // ── Create task from calendar ─────────────────────────────────────────────
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

  // ── Delete event ──────────────────────────────────────────────────────────
  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    await supabase.from('calendario').delete().eq('id', selectedEvent.id);
    setEventi(prev => prev.filter(e => e.id !== selectedEvent.id));
    setSelectedEvent(null);
    addToast('🗑️ Evento eliminato', 'info');
  };

  // ── Update event ──────────────────────────────────────────────────────────
  const handleUpdateEvent = (updated: CalendarioEvent) => {
    setEventi(prev => prev.map(e => e.id === updated.id ? updated : e));
    setSelectedEvent(updated);
  };

  if (!utente) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="sk-btn-ghost text-sm px-2 py-1">◀</button>
          <button onClick={goToday} className="sk-btn-ghost text-sm px-3 py-1">Oggi</button>
          <button onClick={() => navigate(1)} className="sk-btn-ghost text-sm px-2 py-1">▶</button>
          <h2 className="font-semibold text-base ml-2 min-w-[200px]">{title}</h2>
        </div>

        <div className="flex items-center gap-3">
          <Legenda />
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setVista('mese')}
              className={`text-xs px-3 py-1.5 transition-colors ${vista === 'mese' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Mese
            </button>
            <button
              onClick={() => setVista('settimana')}
              className={`text-xs px-3 py-1.5 transition-colors ${vista === 'settimana' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Settimana
            </button>
          </div>
        </div>
      </div>

      {/* ── Main view ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <span className="animate-spin mr-2">⏳</span> Caricamento…
        </div>
      ) : (
        <>
          {vista === 'mese' ? (
            <MonthView
              year={currentDate.getFullYear()}
              month={currentDate.getMonth()}
              eventi={eventi}
              marketing={marketing}
              oggi={oggi}
              utente={utente}
              onDayClick={handleDayClick}
              onEventClick={setSelectedEvent}
              onEventDrop={handleEventDrop}
              dragEvId={dragEvId}
              setDragEvId={setDragEvId}
            />
          ) : (
            <WeekView
              weekStart={startOfWeekMon(currentDate)}
              eventi={eventi}
              marketing={marketing}
              oggi={oggi}
              utente={utente}
              onDayClick={handleDayClick}
              onEventClick={setSelectedEvent}
              onEventDrop={handleEventDrop}
              dragEvId={dragEvId}
              setDragEvId={setDragEvId}
            />
          )}
        </>
      )}

      {/* ── Day context menu ────────────────────────────────────────────────── */}
      {dayMenu && (
        <DayMenu
          date={dayMenu.date}
          x={dayMenu.x}
          y={dayMenu.y}
          utente={utente}
          onNewTask={() => { setShowTaskModal(true); }}
          onPickCLP={() => { setShowCLPPicker(true); }}
          onSlot={() => { setShowSlotModal(true); }}
          onClose={() => setDayMenu(null)}
        />
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showTaskModal && (
        <NuovoTaskModal
          team={team}
          clienti={clienti}
          utente={utente}
          onClose={() => setShowTaskModal(false)}
          onCreated={handleTaskCreated}
          dataPrecompilata={toDateStr(selectedDate)}
        />
      )}

      {showCLPPicker && (
        <CLPPicker
          contenuti={contenuti}
          selectedDate={selectedDate}
          onSave={handleSaveCLP}
          onClose={() => setShowCLPPicker(false)}
        />
      )}

      {showSlotModal && (
        <SlotModal
          selectedDate={selectedDate}
          team={team}
          onSave={handleSaveSlot}
          onClose={() => setShowSlotModal(false)}
        />
      )}

      {/* ── Event detail panel ───────────────────────────────────────────────── */}
      {selectedEvent && (
        <EventDetail
          ev={selectedEvent}
          team={team}
          clienti={clienti}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDeleteEvent}
          onUpdate={handleUpdateEvent}
        />
      )}
    </div>
  );
}
