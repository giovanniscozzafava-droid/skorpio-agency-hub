import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { Task, TeamMember } from '../types';
import { Avatar } from './Avatar';

const STATI: Task['stato'][] = ['Da fare', 'In lavorazione', 'In revisione', 'Completato', 'Non accettato'];

const STATO_COLORS: Record<string, { bg: string; text: string }> = {
  'Da fare': { bg: '#FEF3C7', text: '#D97706' },
  'In lavorazione': { bg: '#DBEAFE', text: '#2563EB' },
  'In revisione': { bg: '#EDE9FE', text: '#7C3AED' },
  'Completato': { bg: '#DCFCE7', text: '#16A34A' },
  'Non accettato': { bg: '#FEE2E2', text: '#DC2626' },
  'Archiviato': { bg: '#F1F5F9', text: '#64748B' },
};

const PRIORITA_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  '🔴 Alta': { dot: '#EF4444', bg: '#FEE2E2', text: '#DC2626' },
  '🟡 Media': { dot: '#F59E0B', bg: '#FEF3C7', text: '#D97706' },
  '🟢 Bassa': { dot: '#22C55E', bg: '#DCFCE7', text: '#16A34A' },
};

interface TaskDetailPanelProps {
  task: Task;
  team: TeamMember[];
  onClose: () => void;
  onUpdate: (updated: Task) => void;
  onDelete: (id: string) => void;
}

export function TaskDetailPanel({ task, team, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  const { utente, addToast } = useApp();
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  const scad = task.scadenza ? new Date(task.scadenza) : null;
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const isScaduto = scad && scad < oggi && task.stato !== 'Completato';

  const handleStatoChange = async (nuovoStato: Task['stato']) => {
    setSaving(true);
    const { data, error } = await supabase
      .from('task')
      .update({ stato: nuovoStato })
      .eq('id', task.id)
      .select()
      .single();
    setSaving(false);
    if (!error && data) {
      onUpdate(data as Task);
      addToast(`Stato cambiato → ${nuovoStato}`, 'success');
    }
  };

  const handleArchivia = async () => {
    if (!confirm(`Archiviare il task ${task.id_display}?`)) return;
    await supabase.from('task').update({ stato: 'Archiviato' }).eq('id', task.id);
    onDelete(task.id);
    addToast('Task archiviato', 'info');
  };

  const handleAddNota = async () => {
    if (!nota.trim()) return;
    const nuovaNota = task.note ? `${task.note}\n---\n${nota}` : nota;
    const { data, error } = await supabase
      .from('task')
      .update({ note: nuovaNota })
      .eq('id', task.id)
      .select()
      .single();
    if (!error && data) {
      onUpdate(data as Task);
      setNota('');
      addToast('Nota aggiunta', 'success');
    }
  };

  const handleSpostaA = async (nome: string) => {
    const { data, error } = await supabase
      .from('task')
      .update({ assegnato_a: nome, assegnato_da: utente?.nome || '' })
      .eq('id', task.id)
      .select()
      .single();
    if (!error && data) {
      onUpdate(data as Task);
      addToast(`Task spostato a ${nome}`, 'success');
    }
  };

  const statoInfo = STATO_COLORS[task.stato] || STATO_COLORS['Da fare'];
  const prioritaInfo = PRIORITA_COLORS[task.priorita] || PRIORITA_COLORS['🟡 Media'];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 bg-card flex flex-col animate-slide-in-right"
        style={{
          width: 360,
          borderLeft: '1px solid hsl(var(--border))',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-xs font-mono text-muted-foreground">{task.id_display}</span>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Descrizione */}
          <p className="text-base font-semibold leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {task.descrizione}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <span
              className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: statoInfo.bg, color: statoInfo.text }}
            >
              {task.stato}
            </span>
            <span
              className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: prioritaInfo.bg, color: prioritaInfo.text }}
            >
              {task.priorita}
            </span>
            {isScaduto && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: '#FEE2E2', color: '#DC2626' }}>
                ⚠ SCADUTO
              </span>
            )}
          </div>

          {/* Info rows */}
          <div className="space-y-2 text-sm">
            {[
              ['Tipo', task.tipo || '—'],
              ['Cliente', task.cliente_nome || '—'],
              ['Contenuto', task.id_contenuto || '—'],
              ['Assegnato da', task.assegnato_da || '—'],
              ['Scadenza', task.scadenza ? new Date(task.scadenza).toLocaleDateString('it-IT') : '—'],
              ['Ora', task.ora ? task.ora.slice(0, 5) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="flex-shrink-0 text-xs font-medium w-28" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  {label}
                </span>
                <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Note */}
          {task.note && (
            <div className="rounded-lg p-3 text-xs whitespace-pre-wrap leading-relaxed"
              style={{ background: 'hsl(210 40% 96%)', color: 'hsl(var(--skorpio-text-secondary))' }}>
              {task.note}
            </div>
          )}

          {/* Separatore */}
          <hr style={{ borderColor: 'hsl(var(--border))' }} />

          {/* Cambia stato */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>CAMBIA STATO</p>
            <div className="flex flex-wrap gap-1.5">
              {STATI.map(s => (
                <button
                  key={s}
                  onClick={() => handleStatoChange(s)}
                  disabled={task.stato === s || saving}
                  className="text-xs px-2.5 py-1.5 rounded-md transition-all font-medium"
                  style={{
                    background: task.stato === s ? (STATO_COLORS[s]?.bg || '#F1F5F9') : 'hsl(210 40% 96%)',
                    color: task.stato === s ? (STATO_COLORS[s]?.text || '#64748B') : '#64748B',
                    opacity: saving ? 0.5 : 1,
                    fontWeight: task.stato === s ? 700 : 500,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Sposta a */}
          {(utente?.ruolo === 'Admin' || task.assegnato_a === utente?.nome) && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>SPOSTA A</p>
              <div className="flex flex-wrap gap-2">
                {team.filter(m => m.nome !== task.assegnato_a).map(m => (
                  <button
                    key={m.id}
                    onClick={() => handleSpostaA(m.nome)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors"
                    style={{ background: `${m.colore}15`, color: m.colore, border: `1px solid ${m.colore}30` }}
                  >
                    <Avatar nome={m.nome} colore={m.colore} size={16} />
                    {m.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Aggiungi nota */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>AGGIUNGI NOTA</p>
            <textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              className="sk-textarea w-full text-sm"
              rows={2}
              placeholder="Scrivi una nota…"
            />
            <button onClick={handleAddNota} className="sk-btn-primary text-xs mt-1.5 w-full">
              Aggiungi nota
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t">
          <button onClick={handleArchivia} className="sk-btn-danger w-full text-sm">
            🗄️ Archivia task {task.id_display}
          </button>
        </div>
      </div>
    </>
  );
}
