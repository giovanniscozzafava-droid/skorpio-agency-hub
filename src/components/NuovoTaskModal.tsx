import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toDateStr } from '../lib/dateUtils';
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
    scadenza: dataPrecompilata || '',
    ora: '',
    scadenza_giorni: '3',
  });
  // Multi-select: array di nomi
  const [assegnatiA, setAssegnatiA] = useState<string[]>(utente ? [utente.nome] : []);
  const [saving, setSaving] = useState(false);

  const hasData = TIPI_CON_DATA.includes(form.tipo);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const toggleMembro = (nome: string) => {
    setAssegnatiA(prev =>
      prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descrizione.trim() || assegnatiA.length === 0) return;
    setSaving(true);

    let scadenza: string | null = null;
    if (hasData && form.scadenza) {
      scadenza = form.scadenza;
    } else if (!hasData && form.scadenza_giorni) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(form.scadenza_giorni));
      scadenza = toDateStr(d);
    }

    const clienteSel = clienti.find(c => c.id === form.cliente_id);

    // Crea un task per ogni persona selezionata
    let lastTask: Task | null = null;
    const createdTaskIds: string[] = [];
    for (const persona of assegnatiA) {
      const { data: seqData } = await supabase.rpc('generate_display_id', { prefix: 'TSK', seq_name: 'task_seq' });
      const payload: any = {
        id_display: seqData || `TSK${Date.now()}`,
        tipo: form.tipo,
        descrizione: form.descrizione.trim(),
        cliente_id: form.cliente_id || null,
        cliente_nome: clienteSel?.nome || '',
        priorita: form.priorita,
        stato: 'Da fare',
        assegnato_a: persona,
        assegnato_da: utente?.nome || '',
        scadenza,
        ora: hasData && form.ora ? form.ora : null,
        note: '',
      };

      const { data, error } = await supabase.from('task').insert(payload).select().single();
      if (!error && data) {
        lastTask = data as Task;
        createdTaskIds.push(data.id);
      }
    }

    // Crea UN SOLO evento calendario (se c'è scadenza), con tutti i nomi
    if (scadenza && lastTask && hasData) {
      const taskIdTag = createdTaskIds.map(id => `[TASK:${id}]`).join('');
      const tuttiNomi = assegnatiA.join(', ');
      await supabase.from('calendario').insert({
        tipo: 'appuntamento',
        descrizione: `${form.descrizione.trim()} ${taskIdTag}`,
        data: scadenza,
        ora: (hasData && form.ora) ? form.ora : null,
        cliente_id: form.cliente_id || null,
        cliente_nome: clienteSel?.nome || '',
        persona: tuttiNomi,
      });
    }

    // Notifica il parent (solo ultimo task, per reload)
    if (lastTask) onCreated(lastTask);

    setSaving(false);
    if (lastTask) onClose();
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

          {/* Assegna a — multi-select */}
          <div>
            <label className="sk-label">
              Assegna a *
              {assegnatiA.length > 1 && (
                <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full"
                  style={{ background: 'hsl(214 80% 55% / 0.12)', color: 'hsl(214 70% 44%)' }}>
                  {assegnatiA.length} persone → {assegnatiA.length} task creati
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {team.map(m => {
                const sel = assegnatiA.includes(m.nome);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMembro(m.nome)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-all font-medium"
                    style={{
                      background: sel ? m.colore + '22' : 'transparent',
                      borderColor: sel ? m.colore : 'hsl(var(--border))',
                      color: sel ? m.colore : 'hsl(var(--muted-foreground))',
                      boxShadow: sel ? `0 0 0 2px ${m.colore}30` : 'none',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.colore }} />
                    {m.nome}
                    {sel && <span className="text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
            {assegnatiA.length === 0 && (
              <p className="text-xs mt-1" style={{ color: '#EF4444' }}>Seleziona almeno una persona</p>
            )}
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
            <button type="submit" disabled={saving || assegnatiA.length === 0} className="sk-btn-primary">
              {saving ? 'Salvataggio…' : assegnatiA.length > 1 ? `✅ Crea ${assegnatiA.length} Task` : '✅ Crea Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
