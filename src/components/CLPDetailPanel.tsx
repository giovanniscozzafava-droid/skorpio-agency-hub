import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { Contenuto, FaseCLP, TeamMember, Cliente } from '../types';
import { FASE_CONFIG } from './ContenutiTab';

async function createDriveFolder(contenuto: Contenuto): Promise<string | null> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/create-drive-folder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
      },
      body: JSON.stringify({
        contenuto_id: contenuto.id,
        titolo: contenuto.titolo,
        cliente_nome: contenuto.cliente_nome,
        id_display: contenuto.id_display,
      }),
    });
    const result = await res.json();
    return result.success ? result.folder_url : null;
  } catch {
    return null;
  }
}

const FASI: FaseCLP[] = ['Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Revisione', 'Programmato', 'Pubblicato', 'Scartata'];
const CANALI = ['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro'];
const TIPI = ['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro'];

interface CLPDetailPanelProps {
  contenuto: Contenuto;
  team: TeamMember[];
  clienti: Cliente[];
  onClose: () => void;
  onUpdate: (updated: Contenuto) => void;
  onDelete: (id: string) => void;
  onFaseChange: (c: Contenuto, fase: FaseCLP) => void;
}

type FormData = Partial<Contenuto>;

function Section({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 my-4">
      <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
      <span className="text-xs font-bold uppercase tracking-widest px-2"
        style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
        {title}
      </span>
      <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
    </div>
  );
}

export function CLPDetailPanel({ contenuto, team, clienti, onClose, onUpdate, onDelete, onFaseChange }: CLPDetailPanelProps) {
  const { addToast } = useApp();
  const [form, setForm] = useState<Contenuto>({ ...contenuto });
  const [saving, setSaving] = useState(false);
  const [creatingDrive, setCreatingDrive] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when contenuto changes
  useEffect(() => {
    setForm({ ...contenuto });
  }, [contenuto.id]);

  const set = (k: keyof Contenuto, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }));
    // Auto-save con debounce
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveField(k, v), 800);
  };

  const saveField = async (k: keyof Contenuto, v: any) => {
    await supabase.from('contenuti').update({ [k]: v }).eq('id', contenuto.id);
    // Aggiorna il parent silenziosamente
    const { data } = await supabase.from('contenuti').select('*').eq('id', contenuto.id).single();
    if (data) onUpdate(data as Contenuto);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from('contenuti')
      .update(form)
      .eq('id', contenuto.id)
      .select()
      .single();
    setSaving(false);
    if (!error && data) {
      onUpdate(data as Contenuto);
      addToast('CLP salvato ✅', 'success');
    }
  };

  const handleCreateDrive = async () => {
    setCreatingDrive(true);
    addToast('📁 Creazione cartella Drive…', 'info');
    const url = await createDriveFolder(form);
    if (url) {
      set('link_drive', url);
      addToast('📁 Cartella Drive creata!', 'success');
    } else {
      addToast('⚠️ Errore creazione cartella Drive', 'warn');
    }
    setCreatingDrive(false);
  };

  const faseCfg = FASE_CONFIG[form.fase];
  const clienteSelezionato = clienti.find(c => c.id === form.cliente_id);

  const LabelInput = ({ label, field, type = 'text', placeholder = '' }: {
    label: string; field: keyof Contenuto; type?: string; placeholder?: string;
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <input
        type={type}
        className="sk-input w-full text-sm"
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const LabelTextarea = ({ label, field, rows = 2, placeholder = '' }: {
    label: string; field: keyof Contenuto; rows?: number; placeholder?: string;
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <textarea
        className="sk-textarea w-full text-sm"
        rows={rows}
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const LabelSelect = ({ label, field, options }: {
    label: string; field: keyof Contenuto; options: string[];
  }) => (
    <div>
      <label className="sk-label">{label}</label>
      <select
        className="sk-select w-full text-sm"
        value={(form[field] as string) || ''}
        onChange={e => set(field, e.target.value)}
      >
        <option value="">— Seleziona —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 bg-card flex flex-col animate-slide-in-right overflow-hidden"
        style={{
          width: 400,
          borderLeft: '1px solid hsl(var(--border))',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-card">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              {form.id_display}
            </span>
            {form.generato_da_ai && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: '#EDE9FE', color: '#7C3AED' }}>🤖 AI</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="sk-btn-primary text-xs px-3 py-1.5"
            >
              {saving ? '…' : '💾 Salva'}
            </button>
            <button onClick={onClose} className="sk-btn-ghost px-2 py-1 text-lg">✕</button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* Fase — dropdown grande */}
          <div className="mb-4">
            <label className="sk-label">Fase</label>
            <div className="flex flex-wrap gap-1.5">
              {FASI.map(f => {
                const cfg = FASE_CONFIG[f];
                const active = form.fase === f;
                return (
                  <button
                    key={f}
                    onClick={() => {
                      set('fase', f);
                      onFaseChange({ ...form, fase: f }, f);
                    }}
                    className="fase-badge cursor-pointer transition-all text-xs"
                    style={{
                      background: active ? cfg.text : cfg.bg,
                      color: active ? 'white' : cfg.text,
                      border: `1px solid ${cfg.border}`,
                      fontWeight: active ? 700 : 400,
                      transform: active ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Titolo */}
          <LabelInput label="Titolo" field="titolo" placeholder="Titolo del contenuto…" />

          <div className="grid grid-cols-2 gap-3 mt-3">
            {/* Cliente */}
            <div>
              <label className="sk-label">Cliente</label>
              <select
                className="sk-select w-full text-sm"
                value={form.cliente_id || ''}
                onChange={e => {
                  const cliente = clienti.find(c => c.id === e.target.value);
                  set('cliente_id', e.target.value || null);
                  set('cliente_nome', cliente?.nome || '');
                }}
              >
                <option value="">— Nessuno —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            {/* Durata */}
            <LabelInput label="Durata" field="durata" placeholder="es: 30s" />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <LabelSelect label="Tipo" field="tipo" options={['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro']} />
            <LabelSelect label="Canale" field="canale" options={['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro']} />
          </div>

          {/* ─── CREATIVITÀ ─── */}
          <Section title="CREATIVITÀ" />

          <LabelTextarea label="🎣 Hook" field="hook" rows={2} placeholder="Frase di apertura che cattura l'attenzione…" />
          <div className="mt-3">
            <LabelTextarea label="📝 Script" field="script" rows={4} placeholder="Testo completo del contenuto…" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <LabelInput label="📣 CTA" field="cta" placeholder="es: Clicca il link in bio" />
            <LabelInput label="🎵 Musica" field="musica" placeholder="es: Brano - Artista" />
          </div>
          <div className="mt-3">
            <LabelInput label="#️⃣ Hashtag" field="hashtag" placeholder="#beauty #estetica #skincare…" />
          </div>

          {/* ─── PRODUZIONE ─── */}
          <Section title="PRODUZIONE" />

          <div className="grid grid-cols-2 gap-3">
            <LabelInput label="📍 Location" field="location" placeholder="es: Studio, Sede cliente…" />
            <LabelInput label="🎭 Props" field="props" placeholder="es: prodotti, attrezzatura…" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="sk-label">📷 Riprese →</label>
              <select
                className="sk-select w-full text-sm"
                value={form.assegnato_riprese}
                onChange={e => set('assegnato_riprese', e.target.value)}
              >
                <option value="">— Nessuno —</option>
                {team.map(m => (
                  <option key={m.id} value={m.nome}>{m.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sk-label">✂️ Montaggio →</label>
              <select
                className="sk-select w-full text-sm"
                value={form.assegnato_montaggio}
                onChange={e => set('assegnato_montaggio', e.target.value)}
              >
                <option value="">— Nessuno —</option>
                {team.map(m => (
                  <option key={m.id} value={m.nome}>{m.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ─── DATE ─── */}
          <Section title="DATE" />

          <div className="grid grid-cols-2 gap-3">
            <LabelInput label="📷 Data ripresa" field="data_ripresa" type="date" />
            <LabelInput label="⏰ Scadenza" field="data_scadenza" type="date" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <LabelInput label="📱 Data pubblicaz." field="data_pubblicazione" type="date" />
            <LabelInput label="🕐 Ora pubblicaz." field="ora_pubblicazione" type="time" />
          </div>

          {/* ─── NOTE & LINK ─── */}
          <Section title="NOTE E LINK" />

          <LabelTextarea label="Note" field="note" rows={2} placeholder="Note interne…" />
          <div className="mt-3">
            <LabelTextarea label="Note revisione" field="note_revisione" rows={2} placeholder="Feedback dal cliente o per il team…" />
          </div>
          {/* ─── GOOGLE DRIVE ─── */}
          <div className="mt-3 rounded-lg p-3 border" style={{ background: 'hsl(214 100% 98%)', borderColor: 'hsl(214 80% 85%)' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-widest" style={{ color: 'hsl(214 60% 40%)' }}>
                📁 Google Drive
              </label>
              {!form.link_drive && (
                <button
                  onClick={handleCreateDrive}
                  disabled={creatingDrive}
                  className="text-xs px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1"
                  style={{ background: '#1a73e8', color: 'white', opacity: creatingDrive ? 0.6 : 1 }}
                >
                  {creatingDrive ? (
                    <>⏳ Creazione…</>
                  ) : (
                    <>📁 Crea cartella</>
                  )}
                </button>
              )}
            </div>
            {form.link_drive ? (
              <div className="flex items-center gap-2">
                <a
                  href={form.link_drive}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-md text-sm font-medium truncate transition-all"
                  style={{ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #c5d8fd' }}
                >
                  <span>📂</span>
                  <span className="truncate">{form.id_display} – {form.cliente_nome || 'Senza cliente'}</span>
                  <span className="ml-auto flex-shrink-0 text-xs opacity-60">↗</span>
                </a>
                <button
                  onClick={() => set('link_drive', '')}
                  className="sk-btn-ghost text-xs px-1.5 py-1 flex-shrink-0 opacity-50 hover:opacity-100"
                  title="Rimuovi link"
                >✕</button>
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'hsl(214 40% 55%)' }}>
                {form.fase === 'Montato' ? (
                  <span>Nessuna cartella — clicca "Crea cartella" per generarla automaticamente su Drive.</span>
                ) : (
                  <span>La cartella verrà creata automaticamente quando il contenuto passa a <strong>Montato</strong>.</span>
                )}
              </div>
            )}
          </div>

          {/* Metadati */}
          <div className="mt-4 pt-4 border-t text-xs space-y-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            <p>Creato: {new Date(contenuto.created_at).toLocaleString('it-IT')}</p>
            <p>Aggiornato: {new Date(contenuto.updated_at).toLocaleString('it-IT')}</p>
          </div>
        </div>

        {/* Footer — elimina */}
        <div className="flex-shrink-0 p-4 border-t">
          <button
            onClick={() => onDelete(contenuto.id)}
            className="sk-btn-danger w-full text-sm"
          >
            🗑️ Elimina contenuto {contenuto.id_display}
          </button>
          <p className="text-xs text-center mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            Elimina anche le clip collegate su LOG_RIPRESE
          </p>
        </div>
      </div>
    </>
  );
}
