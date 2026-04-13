import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Task, TeamMember } from '../types';

interface Props {
  team: TeamMember[];
  utente: TeamMember;
}

interface DailyPriority {
  id: string;
  task_id: string;
  assegnato_a: string;
  creato_da: string;
  nota: string;
  show_morning: boolean;
  show_evening: boolean;
  attivo: boolean;
  created_at: string;
  task?: Task;
}

export function DailyPriorityManager({ team, utente }: Props) {
  const [priorities, setPriorities] = useState<DailyPriority[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPerson, setSelectedPerson] = useState<string>(team[0]?.nome || '');
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: pData }, { data: tData }] = await Promise.all([
      supabase.from('daily_priorities').select('*').eq('attivo', true).order('created_at', { ascending: false }),
      supabase.from('task').select('*').neq('stato', 'Archiviato').neq('stato', 'Completato'),
    ]);
    const taskMap: Record<string, Task> = {};
    (tData || []).forEach(t => { taskMap[t.id] = t as Task; });
    const enriched = (pData || []).map(p => ({ ...p, task: taskMap[p.task_id] }));
    setPriorities(enriched as DailyPriority[]);
    setTasks((tData || []) as Task[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const removePriority = async (id: string) => {
    await supabase.from('daily_priorities').update({ attivo: false }).eq('id', id);
    setPriorities(prev => prev.filter(p => p.id !== id));
  };

  const toggleTime = async (id: string, field: 'show_morning' | 'show_evening', value: boolean) => {
    await supabase.from('daily_priorities').update({ [field]: value }).eq('id', id);
    setPriorities(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const updateNota = async (id: string, nota: string) => {
    await supabase.from('daily_priorities').update({ nota }).eq('id', id);
    setPriorities(prev => prev.map(p => p.id === id ? { ...p, nota } : p));
  };

  const triggerNow = async (persona: string) => {
    // Forza apertura popup rimuovendo il flag localStorage per quella persona
    // Nota: funziona solo se la persona ha il browser aperto
    localStorage.removeItem('skorpio_daily_' + persona);
    localStorage.removeItem('skorpio_evening_' + persona);
    alert('Popup forzato per ' + persona + '. Se ha SKORPIO aperto, vedra il popup al prossimo refresh.');
  };

  const personPriorities = priorities.filter(p => p.assegnato_a === selectedPerson);
  const availableTasks = tasks.filter(t => {
    // Show ALL tasks (not just the selected person's) so admin can reassign
    if (priorities.find(p => p.task_id === t.id && p.assegnato_a === selectedPerson && p.attivo)) return false;
    if (searchQuery && !(t.descrizione + t.cliente_nome + t.id_display + t.assegnato_a).toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const addPriorityAndReassign = async (taskId: string, persona: string) => {
    setSaving(true);
    const exists = priorities.find(p => p.task_id === taskId && p.assegnato_a === persona && p.attivo);
    if (exists) { setSaving(false); return; }
    // If task is assigned to someone else, reassign it
    const task = tasks.find(t => t.id === taskId);
    if (task && task.assegnato_a !== persona) {
      await supabase.from('task').update({ assegnato_a: persona }).eq('id', taskId);
    }
    await supabase.from('daily_priorities').insert({
      task_id: taskId,
      assegnato_a: persona,
      creato_da: utente.nome,
      show_morning: true,
      show_evening: true,
    });
    await load();
    setSaving(false);
    setShowAddModal(false);
    setSearchQuery('');
  };

  if (loading) return <div className="text-center py-8 text-sm text-muted-foreground">Caricamento...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            Daily Priority
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gestisci le priorita giornaliere per ogni membro del team
          </p>
        </div>
      </div>

      {/* Person selector */}
      <div className="flex gap-2 flex-wrap">
        {team.filter(m => m.nome !== 'Giovanni' || utente.nome === 'Giovanni').map(m => (
          <button key={m.nome} onClick={() => setSelectedPerson(m.nome)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
            style={{
              background: selectedPerson === m.nome ? m.colore || '#6C5CE7' : 'hsl(var(--muted))',
              color: selectedPerson === m.nome ? 'white' : 'hsl(var(--skorpio-text-secondary))',
            }}>
            {m.nome}
          </button>
        ))}
      </div>

      {/* Priorities list */}
      <div className="space-y-2">
        {personPriorities.length === 0 ? (
          <div className="text-center py-6 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
            <p className="text-xs text-muted-foreground">Nessuna priorita assegnata a {selectedPerson}</p>
          </div>
        ) : (
          personPriorities.map(p => (
            <div key={p.id} className="rounded-xl p-3 space-y-2" style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                    {p.task?.descrizione || 'Task eliminato'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {p.task?.cliente_nome && <span className="text-[10px] text-muted-foreground">{p.task.cliente_nome}</span>}
                    <span className="text-[10px] font-mono text-muted-foreground">{p.task?.id_display}</span>
                  </div>
                </div>
                <button onClick={() => removePriority(p.id)}
                  className="text-xs text-muted-foreground hover:text-red-500 cursor-pointer flex-shrink-0" title="Rimuovi">
                  ✕
                </button>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={p.show_morning}
                    onChange={e => toggleTime(p.id, 'show_morning', e.target.checked)} className="rounded" />
                  <span className="text-[11px]" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>Mattina</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={p.show_evening}
                    onChange={e => toggleTime(p.id, 'show_evening', e.target.checked)} className="rounded" />
                  <span className="text-[11px]" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>Sera (17:00)</span>
                </label>
                <span className="text-[10px] text-muted-foreground">da {p.creato_da}</span>
              </div>

              {/* Nota */}
              <input
                className="w-full text-xs px-2 py-1.5 rounded-lg border bg-transparent"
                style={{ borderColor: 'hsl(var(--border))' }}
                placeholder="Nota per il membro..."
                defaultValue={p.nota || ''}
                onBlur={e => updateNota(p.id, e.target.value)}
              />
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => setShowAddModal(true)}
          className="flex-1 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ background: 'hsl(270 60% 55%)', color: 'white' }}>
          + Aggiungi priorita per {selectedPerson}
        </button>
        <button onClick={() => triggerNow(selectedPerson)}
          className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ background: 'hsl(38 92% 50%)', color: 'white' }}
          title="Forza apertura popup adesso">
          Invia ora
        </button>
      </div>

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 99999 }}>
          <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'hsl(var(--background))' }}>
            <div className="p-4 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Aggiungi priorita per {selectedPerson}</h3>
                <button onClick={() => { setShowAddModal(false); setSearchQuery(''); }} className="cursor-pointer text-lg">✕</button>
              </div>
              <input
                className="w-full mt-2 text-sm px-3 py-2 rounded-lg border bg-transparent"
                style={{ borderColor: 'hsl(var(--border))' }}
                placeholder="Cerca task..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {availableTasks.length === 0 ? (
                <p className="text-center py-6 text-xs text-muted-foreground">Nessun task disponibile</p>
              ) : (
                availableTasks.slice(0, 20).map(t => {
                  const willReassign = t.assegnato_a !== selectedPerson;
                  return (
                  <button key={t.id} onClick={() => addPriorityAndReassign(t.id, selectedPerson)} disabled={saving}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer"
                    style={{ opacity: saving ? 0.5 : 1 }}>
                    <p className="text-sm font-medium truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                      {t.descrizione.length > 60 ? t.descrizione.slice(0, 60) + '...' : t.descrizione}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-muted-foreground">{t.id_display}</span>
                      {t.cliente_nome && <span className="text-[10px] text-muted-foreground">{t.cliente_nome}</span>}
                      <span className="text-[10px]" style={{ color: t.priorita === '🔴 Alta' ? '#EF4444' : '#F59E0B' }}>{t.priorita}</span>
                      {willReassign ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                          {t.assegnato_a} → {selectedPerson}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">→ {t.assegnato_a}</span>
                      )}
                    </div>
                  </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
