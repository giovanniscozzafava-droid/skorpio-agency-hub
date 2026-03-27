import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Contenuto, FaseCLP, TeamMember, Cliente } from '../types';

const FASI: FaseCLP[] = ['Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Revisionato', 'Programmato', 'Pubblicato', 'Scartata'];
const CANALI = ['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro'];
const TIPI = ['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro'];
const STILI = ['Commedia', 'Storytelling', 'Trend', 'Ispirazione', 'Divulgativo', 'Tutorial', 'Behind the scenes', 'Talking head', 'Testimonial', 'Before/After', 'Unboxing', 'ASMR', 'Vlog', 'Altro'];

interface NuovoCLPModalProps {
  team: TeamMember[];
  clienti: Cliente[];
  onClose: () => void;
  onCreated: (c: Contenuto) => void;
}

// ── Searchable Cliente Dropdown ────────────────────────────────────────────────
function ClienteDropdown({
  clienti,
  value,
  onChange,
}: {
  clienti: Cliente[];
  value: string;
  onChange: (id: string, nome: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newNome, setNewNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [localClienti, setLocalClienti] = useState<Cliente[]>(clienti);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalClienti(clienti);
  }, [clienti]);

  const attivi = localClienti.filter(c => c.stato === 'Attivo');
  const filtered = query.trim()
    ? attivi.filter(c => c.nome.toLowerCase().includes(query.toLowerCase()))
    : attivi;

  const selected = attivi.find(c => c.id === value);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreatingNew(false);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const handleCreate = async () => {
    if (!newNome.trim()) return;
    setSaving(true);
    try {
      let id_display = `CLI${Date.now()}`;
      try {
        const { data: seqData } = await supabase.rpc('generate_display_id', { prefix: 'CLI', seq_name: 'cli_seq' });
        if (seqData) id_display = seqData;
      } catch (_) { }

      const { data, error } = await supabase
        .from('clienti')
        .insert({ nome: newNome.trim(), stato: 'Attivo', id_display })
        .select()
        .single();

      if (!error && data) {
        setLocalClienti(prev => [...prev, data as Cliente]);
        onChange(data.id, data.nome);
        setQuery(data.nome);
        setOpen(false);
        setCreatingNew(false);
        setNewNome('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <div
        className="sk-input w-full flex items-center justify-between cursor-pointer"
        style={{ minHeight: 36, userSelect: 'none' }}
        onClick={() => { setOpen(o => !o); setCreatingNew(false); }}
      >
        <span style={{ color: selected ? 'hsl(var(--skorpio-text-primary))' : 'hsl(var(--skorpio-text-tertiary))' }}>
          {selected ? selected.nome : '— Nessuno —'}
        </span>
        <span style={{ color: 'hsl(var(--skorpio-text-tertiary))', fontSize: 10 }}>▼</span>
      </div>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-full z-50 rounded-xl shadow-xl border overflow-hidden"
          style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', maxHeight: 260 }}
        >
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <input
              className="sk-input w-full text-sm"
              placeholder="🔍 Cerca cliente…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
            {/* Nessuno */}
            <div
              className="px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors"
              style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}
              onClick={() => { onChange('', ''); setQuery(''); setOpen(false); }}
            >
              — Nessuno —
            </div>

            {filtered.map(c => (
              <div
                key={c.id}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors"
                style={{
                  color: 'hsl(var(--skorpio-text-primary))',
                  background: c.id === value ? 'hsl(var(--accent))' : undefined,
                  fontWeight: c.id === value ? 600 : undefined,
                }}
                onClick={() => { onChange(c.id, c.nome); setQuery(c.nome); setOpen(false); }}
              >
                {c.nome}
              </div>
            ))}

            {filtered.length === 0 && !creatingNew && (
              <div className="px-3 py-2 text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                Nessun risultato per "{query}"
              </div>
            )}
          </div>

          {/* + Nuovo cliente */}
          {!creatingNew ? (
            <div
              className="px-3 py-2.5 text-xs font-semibold border-t cursor-pointer hover:bg-muted transition-colors flex items-center gap-2"
              style={{ borderColor: 'hsl(var(--border))', color: '#3B82F6' }}
              onClick={e => { e.stopPropagation(); setCreatingNew(true); setNewNome(query); }}
            >
              <span className="text-base">＋</span> Nuovo cliente al volo
            </div>
          ) : (
            <div
              className="px-3 py-2.5 border-t space-y-2"
              style={{ borderColor: 'hsl(var(--border))' }}
              onClick={e => e.stopPropagation()}
            >
              <input
                className="sk-input w-full text-sm"
                placeholder="Nome nuovo cliente…"
                value={newNome}
                onChange={e => setNewNome(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={saving || !newNome.trim()}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: '#3B82F6' }}
                >
                  {saving ? '⏳' : '✅ Crea'}
                </button>
                <button
                  onClick={() => setCreatingNew(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border"
                  style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NuovoCLPModal({ team, clienti, onClose, onCreated }: NuovoCLPModalProps) {
  const [form, setForm] = useState({
    titolo: '',
    cliente_id: '',
    cliente_nome: '',
    fase: 'Idea' as FaseCLP,
    tipo: '',
    canale: '',
    stile: '',
    link_ispirazione: '',
    hook: '',
    assegnato_riprese: '',
    assegnato_montaggio: '',
  });
  const [saving, setSaving] = useState(false);
  const [driveWarning, setDriveWarning] = useState(false);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titolo.trim()) return;
    setSaving(true);

    const { data: seqData } = await supabase.rpc('generate_display_id', {
      prefix: 'CLP',
      seq_name: 'clp_seq',
    });

    const id_display = seqData || `CLP${Date.now()}`;

    const payload = {
      id_display,
      titolo: form.titolo.trim(),
      cliente_id: form.cliente_id || null,
      cliente_nome: form.cliente_nome || '',
      fase: form.fase,
      tipo: form.tipo,
      canale: form.canale,
      stile: form.stile,
      link_ispirazione: form.link_ispirazione,
      hook: form.hook,
      assegnato_riprese: form.assegnato_riprese,
      assegnato_montaggio: form.assegnato_montaggio,
    };

    const { data, error } = await supabase
      .from('contenuti')
      .insert(payload)
      .select()
      .single();

    setSaving(false);
    if (!error && data) {
      // Auto-crea cartelle Drive in background (fire & forget)
      const { data: teamData } = await supabase
        .from('team')
        .select('id, google_drive_connected')
        .eq('google_drive_connected', true)
        .limit(1)
        .single();

      if (teamData?.id) {
        fetch(`${SUPABASE_URL}/functions/v1/create-drive-folder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            contenuto_id: data.id,
            titolo: data.titolo,
            cliente_nome: data.cliente_nome || '',
            id_display: data.id_display,
            team_id: teamData.id,
          }),
        }).catch(() => setDriveWarning(true));
      } else {
        setDriveWarning(true);
      }

      onCreated(data as Contenuto);
      onClose();
    }
  };

  return (
    <div className="sk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-modal animate-slide-up" style={{ maxWidth: 520 }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-base">📹 Nuovo CLP</h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Titolo */}
          <div>
            <label className="sk-label">Titolo *</label>
            <input
              type="text"
              className="sk-input w-full"
              value={form.titolo}
              onChange={e => set('titolo', e.target.value)}
              placeholder="es: Tutorial skincare autunnale…"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Cliente — searchable */}
            <div>
              <label className="sk-label">Cliente</label>
              <ClienteDropdown
                clienti={clienti}
                value={form.cliente_id}
                onChange={(id, nome) => setForm(prev => ({ ...prev, cliente_id: id, cliente_nome: nome }))}
              />
            </div>

            {/* Fase */}
            <div>
              <label className="sk-label">Fase iniziale</label>
              <select
                className="sk-select w-full"
                value={form.fase}
                onChange={e => set('fase', e.target.value)}
              >
                {FASI.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="sk-label">Tipo</label>
              <select className="sk-select w-full" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">— Seleziona —</option>
                {TIPI.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Canale */}
            <div>
              <label className="sk-label">Canale</label>
              <select className="sk-select w-full" value={form.canale} onChange={e => set('canale', e.target.value)}>
                <option value="">— Seleziona —</option>
                {CANALI.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Stile + Link ispirazione */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="sk-label">🎬 Stile</label>
              <select className="sk-select w-full" value={form.stile} onChange={e => set('stile', e.target.value)}>
                <option value="">— Seleziona —</option>
                {STILI.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="sk-label">🔗 Link ispirazione</label>
              <input
                type="url"
                className="sk-input w-full"
                value={form.link_ispirazione}
                onChange={e => set('link_ispirazione', e.target.value)}
                placeholder="https://instagram.com/reel/..."
              />
            </div>
          </div>

          <div>
            <label className="sk-label">🎣 Hook (opzionale)</label>
            <input
              type="text"
              className="sk-input w-full"
              value={form.hook}
              onChange={e => set('hook', e.target.value)}
              placeholder="Frase iniziale che cattura l'attenzione…"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Riprese */}
            <div>
              <label className="sk-label">📷 Riprese →</label>
              <select className="sk-select w-full" value={form.assegnato_riprese} onChange={e => set('assegnato_riprese', e.target.value)}>
                <option value="">— Nessuno —</option>
                {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>

            {/* Montaggio */}
            <div>
              <label className="sk-label">✂️ Montaggio →</label>
              <select className="sk-select w-full" value={form.assegnato_montaggio} onChange={e => set('assegnato_montaggio', e.target.value)}>
                <option value="">— Nessuno —</option>
                {team.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            {driveWarning && (
              <p className="text-xs flex-1 text-left" style={{ color: '#D97706' }}>
                ⚠️ CLP creato ma cartelle Drive non create. Riprova dalla sincronizzazione.
              </p>
            )}
            <button type="button" onClick={onClose} className="sk-btn-ghost">Annulla</button>
            <button type="submit" disabled={saving} className="sk-btn-primary">
              {saving ? 'Creazione…' : '✅ Crea CLP'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
