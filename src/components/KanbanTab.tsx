import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { sounds } from '../lib/sounds';
import type { Task, TeamMember, Cliente } from '../types';
import { Avatar } from './Avatar';
import { TaskDetailPanel } from './TaskDetailPanel';
import { NuovoTaskModal } from './NuovoTaskModal';

const COLONNE = [
  { stato: 'Da fare', colore: '#F59E0B', bg: '#FFFBEB', border: '#F59E0B', icona: '📋' },
  { stato: 'In lavorazione', colore: '#3B82F6', bg: '#EFF6FF', border: '#3B82F6', icona: '⚡' },
  { stato: 'In revisione', colore: '#8B5CF6', bg: '#F5F3FF', border: '#8B5CF6', icona: '🔍' },
  { stato: 'Completato', colore: '#22C55E', bg: '#F0FDF4', border: '#22C55E', icona: '✅' },
  { stato: 'Non accettato', colore: '#EF4444', bg: '#FEF2F2', border: '#EF4444', icona: '❌' },
] as const;

const PRIORITA_COLOR: Record<string, string> = {
  '🔴 Alta': '#EF4444',
  '🟡 Media': '#F59E0B',
  '🟢 Bassa': '#22C55E',
};

function scadenzaInfo(task: Task): { label: string; colore: string; bg: string } | null {
  if (!task.scadenza) return null;
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const scad = new Date(task.scadenza); scad.setHours(0,0,0,0);
  const diff = Math.floor((scad.getTime() - oggi.getTime()) / 86400000);
  if (diff < 0) return { label: '⚠ SCADUTO', colore: '#EF4444', bg: '#FEF2F2' };
  if (diff === 0) return { label: '⏰ OGGI', colore: '#D97706', bg: '#FEF3C7' };
  if (diff === 1) return { label: '⏰ DOMANI', colore: '#D97706', bg: '#FEF3C7' };
  return { label: `📅 ${scad.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit' })}`, colore: '#64748B', bg: '#F1F5F9' };
}

interface KanbanTabProps {
  team: TeamMember[];
  clienti: Cliente[];
  personaView: string | null;
}

export function KanbanTab({ team, clienti, personaView }: KanbanTabProps) {
  const { utente, addToast } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNuovoTask, setShowNuovoTask] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task' }, payload => {
        if (payload.eventType === 'INSERT') {
          setTasks(prev => [...prev, payload.new as Task]);
          sounds.nuovoTask();
          addToast('📥 Nuovo task ricevuto', 'info');
        } else if (payload.eventType === 'UPDATE') {
          setTasks(prev => prev.map(t => t.id === (payload.new as Task).id ? payload.new as Task : t));
          if ((payload.new as Task).stato === 'Completato') {
            sounds.taskCompletato();
          }
        } else if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== (payload.old as any).id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadTasks = async () => {
    const { data } = await supabase
      .from('task')
      .select('*')
      .neq('stato', 'Archiviato')
      .order('created_at', { ascending: false });
    setTasks(data || []);
    setLoading(false);

    // Suono alert se ci sono scaduti
    const scaduti = (data || []).filter(t => {
      if (!t.scadenza) return false;
      const oggi = new Date(); oggi.setHours(0,0,0,0);
      const s = new Date(t.scadenza); s.setHours(0,0,0,0);
      return s < oggi && t.stato !== 'Completato';
    });
    if (scaduti.length > 0) sounds.alert();
  };

  const filteredTasks = (stato: string) => {
    return tasks.filter(t => {
      if (t.stato !== stato) return false;
      if (personaView && t.assegnato_a !== personaView) return false;
      if (utente?.ruolo !== 'Admin' && t.assegnato_a !== utente?.nome) return false;
      return true;
    });
  };

  const handleDrop = async (nuovoStato: string) => {
    if (!dragItem) return;
    setDropTarget(null);
    const task = tasks.find(t => t.id === dragItem);
    if (!task || task.stato === nuovoStato) return;

    // Permesso: solo owner o Admin
    if (utente?.ruolo !== 'Admin' && task.assegnato_a !== utente?.nome) {
      addToast('Non hai il permesso di spostare questo task', 'error');
      return;
    }

    // Aggiornamento ottimistico
    setTasks(prev => prev.map(t => t.id === dragItem ? { ...t, stato: nuovoStato as Task['stato'] } : t));

    const { error } = await supabase
      .from('task')
      .update({ stato: nuovoStato })
      .eq('id', dragItem);

    if (error) {
      addToast('Errore nel salvataggio', 'error');
      loadTasks();
    } else if (nuovoStato === 'Completato') {
      sounds.taskCompletato();
    }
    setDragItem(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="sk-spinner" style={{ color: '#3B82F6' }} />
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
          Kanban Board
        </h2>
        <button
          onClick={() => setShowNuovoTask(true)}
          className="sk-btn-primary text-sm"
        >
          + Nuovo Task
        </button>
      </div>

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLONNE.map(col => {
          const colTasks = filteredTasks(col.stato);
          return (
            <div
              key={col.stato}
              className={`kanban-col ${dropTarget === col.stato ? 'kanban-drop-target' : ''}`}
              style={{ background: col.bg, border: `1px solid ${col.border}30` }}
              onDragOver={e => { e.preventDefault(); setDropTarget(col.stato); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={() => handleDrop(col.stato)}
            >
              <div
                className="kanban-col-header"
                style={{ borderBottom: `2px solid ${col.border}40` }}
              >
                <div className="flex items-center gap-2">
                  <span>{col.icona}</span>
                  <span style={{ color: col.colore }}>{col.stato}</span>
                </div>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${col.colore}20`, color: col.colore }}
                >
                  {colTasks.length}
                </span>
              </div>

              <div className="kanban-col-body">
                {colTasks.map(task => {
                  const scad = scadenzaInfo(task);
                  const isScaduto = scad?.label.includes('SCADUTO');
                  const member = team.find(m => m.nome === task.assegnato_a);

                  return (
                    <div
                      key={task.id}
                      className={`task-card ${dragItem === task.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={() => setDragItem(task.id)}
                      onDragEnd={() => setDragItem(null)}
                      onClick={() => setSelectedTask(task)}
                      style={{
                        borderLeft: `3px solid ${PRIORITA_COLOR[task.priorita] || '#64748B'}`,
                        ...(isScaduto ? { borderColor: '#EF4444' } : {}),
                      }}
                    >
                      {/* Priorità dot */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div
                          className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                          style={{ backgroundColor: PRIORITA_COLOR[task.priorita] || '#64748B' }}
                        />
                        <p className="text-sm font-medium flex-1 leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                          {task.descrizione.length > 80 ? task.descrizione.slice(0, 80) + '…' : task.descrizione}
                        </p>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center justify-between gap-1 mt-2">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                            {task.id_display}
                          </span>
                          {task.tipo && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: 'hsl(210 40% 96%)', color: '#64748B' }}
                            >
                              {task.tipo}
                            </span>
                          )}
                        </div>
                        {member && (
                          <Avatar nome={member.nome} colore={member.colore} size={20} />
                        )}
                      </div>

                      {task.cliente_nome && (
                        <p className="text-xs mt-1 truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                          👤 {task.cliente_nome.slice(0, 22)}
                        </p>
                      )}

                      {scad && (
                        <div
                          className="inline-flex items-center text-xs px-1.5 py-0.5 rounded mt-1.5 font-medium"
                          style={{ background: scad.bg, color: scad.colore }}
                        >
                          {scad.label}
                          {task.ora && <span className="ml-1 opacity-70">{task.ora.slice(0, 5)}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div
                    className="flex items-center justify-center h-16 text-xs rounded-lg"
                    style={{ color: 'hsl(var(--skorpio-text-tertiary))', border: `1px dashed ${col.border}40` }}
                  >
                    Nessun task
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          team={team}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
            setSelectedTask(updated);
          }}
          onDelete={(id) => {
            setTasks(prev => prev.filter(t => t.id !== id));
            setSelectedTask(null);
          }}
        />
      )}

      {/* Nuovo Task Modal */}
      {showNuovoTask && (
        <NuovoTaskModal
          team={team}
          clienti={clienti}
          utente={utente}
          onClose={() => setShowNuovoTask(false)}
          onCreated={(task) => {
            setTasks(prev => [task, ...prev]);
            addToast(`✅ Task ${task.id_display} creato`, 'success');
          }}
        />
      )}
    </div>
  );
}
