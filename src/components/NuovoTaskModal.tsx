import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Task, TeamMember, Cliente } from '../types';

const TIPI_TASK = ['Call', 'Briefing', 'Sopralluogo', 'Riprese', 'Shooting', 'Consegna Foto', 'Piano Editoriale', 'Amministrativo', 'Grafica', 'Montaggio', 'Copywriting', 'Altro'];
const TIPI_CON_DATA = ['Call', 'Briefing', 'Sopralluogo', 'Riprese', 'Shooting'];

interface NuovoTaskModalProps {
  team: TeamMember[];
  clienti: Cliente[];
  utente: TeamMember | null;
  onClose: () => void;
  onCreated: (task: Task) => void;
  dataPrecompilata?: string;
}

export function NuovoTaskModal({ team, clienti, utente, onClose, onCreated, dataPrecompilata }: NuovoTaskModalProps) {
  const [form, setForm] = useState({
    descrizione: '',
    tipo: '',
    cliente_id: '',
    cliente_nome: '',
    priorita: '🟡 Media' as Task['priorita'],
    assegnato_a: utente?.nome || '',
    scadenza: dataPrecompilata || '',
    ora: '',
    scadenza_giorni: '3',
  });
  const [saving, setSaving] = useState(false);

  const hasData = TIPI_CON_DATA.includes(form.tipo);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descrizione.trim() || !form.assegnato_a) return;
    setSaving(true);

    let scadenza: string | null = null;
    if (hasData && form.scadenza) {
      scadenza = form.scadenza;
    } else if (!hasData && form.scadenza_giorni) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(form.scadenza_giorni));
      scadenza = d.toISOString().split('T')[0];
    }

    const clienteSel = clienti.find(c => c.id === form.cliente_id);

    const payload: any = {
      id_display: '', // verrà auto-generato via trigger se vogliamo, per ora generiamo nel client
      tipo: form.tipo,
      descrizione: form.descrizione.trim(),
      cliente_id: form.cliente_id || null,
      cliente_nome: clienteSel?.nome || '',
      priorita: form.priorita,
      stato: 'Da fare',
      assegnato_a: form.assegnato_a,
      assegnato_da: utente?.nome || '',
      scadenza,
      ora: hasData && form.ora ? form.ora : null,
      note: '',
    };

    // Genera id_display
    const { data: seqData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });
    payload.id_display = seqData || `TSK${Date.now()}`;

    const { data, error } = await supabase.from('task').insert(payload).select().single();
    setSaving(false);
    if (!error && data) {
      onCreated(data as Task);
      onClose();
    }
  };

  return (
    <div className="sk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-modal animate-slide-up">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-base">+ Nuovo Task</h3>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Descrizione */}
          <div>
            <label className="sk-label">Descrizione *</label>
            <textarea
              className="sk-textarea w-full"
              rows={3}
              value={form.descrizione}
              onChange={e => set('descrizione', e.target.value)}
              placeholder="Descrivi il task…"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="sk-label">Tipo</label>
              <select className="sk-select w-full" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">— Tipo —</option>
                {TIPI_TASK.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Priorità */}
            <div>
              <label className="sk-label">Priorità</label>
              <select className="sk-select w-full" value={form.priorita} onChange={e => set('priorita', e.target.value as Task['priorita'])}>
                <option value="🟡 Media">🟡 Media</option>
                <option value="🔴 Alta">🔴 Alta</option>
                <option value="🟢 Bassa">🟢 Bassa</option>
              </select>
            </div>
          </div>

          {/* Cliente */}
          <div>
            <label className="sk-label">Cliente</label>
            <select
              className="sk-select w-full"
              value={form.cliente_id}
              onChange={e => set('cliente_id', e.target.value)}
            >
              <option value="">— Nessun cliente —</option>
              {clienti.filter(c => c.stato === 'Attivo').map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          {/* Assegna a */}
          <div>
            <label className="sk-label">Assegna a *</label>
            <select
              className="sk-select w-full"
              value={form.assegnato_a}
              onChange={e => set('assegnato_a', e.target.value)}
              required
            >
              <option value="">— Seleziona —</option>
              {team.map(m => (
                <option key={m.id} value={m.nome}>{m.nome} ({m.label})</option>
              ))}
            </select>
          </div>

          {/* Data/Scadenza logica condizionale */}
          {hasData ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="sk-label">Data appuntamento</label>
                <input
                  type="date"
                  className="sk-input w-full"
                  value={form.scadenza}
                  onChange={e => set('scadenza', e.target.value)}
                />
              </div>
              <div>
                <label className="sk-label">Ora</label>
                <input
                  type="time"
                  className="sk-input w-full"
                  value={form.ora}
                  onChange={e => set('ora', e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="sk-label">Scadenza tra (giorni)</label>
              <input
                type="number"
                className="sk-input w-full"
                min="1"
                max="365"
                value={form.scadenza_giorni}
                onChange={e => set('scadenza_giorni', e.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="sk-btn-ghost">Annulla</button>
            <button type="submit" disabled={saving} className="sk-btn-primary">
              {saving ? 'Salvataggio…' : '✅ Crea Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
