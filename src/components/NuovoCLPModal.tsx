import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Contenuto, FaseCLP, TeamMember, Cliente } from '../types';

const FASI: FaseCLP[] = ['Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Revisionato', 'Programmato', 'Pubblicato', 'Scartata'];
const CANALI = ['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro'];
const TIPI = ['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro'];

interface NuovoCLPModalProps {
  team: TeamMember[];
  clienti: Cliente[];
  onClose: () => void;
  onCreated: (c: Contenuto) => void;
}

export function NuovoCLPModal({ team, clienti, onClose, onCreated }: NuovoCLPModalProps) {
  const [form, setForm] = useState({
    titolo: '',
    cliente_id: '',
    fase: 'Idea' as FaseCLP,
    tipo: '',
    canale: '',
    hook: '',
    assegnato_riprese: '',
    assegnato_montaggio: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titolo.trim()) return;
    setSaving(true);

    const cliente = clienti.find(c => c.id === form.cliente_id);

    // Genera ID display
    const { data: seqData } = await supabase.rpc('generate_display_id', {
      prefix: 'CLP',
      seq_name: 'clp_seq',
    });

    const payload = {
      id_display: seqData || `CLP${Date.now()}`,
      titolo: form.titolo.trim(),
      cliente_id: form.cliente_id || null,
      cliente_nome: cliente?.nome || '',
      fase: form.fase,
      tipo: form.tipo,
      canale: form.canale,
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
            {/* Cliente */}
            <div>
              <label className="sk-label">Cliente</label>
              <select
                className="sk-select w-full"
                value={form.cliente_id}
                onChange={e => set('cliente_id', e.target.value)}
              >
                <option value="">— Nessuno —</option>
                {clienti.filter(c => c.stato === 'Attivo').map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
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

          {/* Hook */}
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
