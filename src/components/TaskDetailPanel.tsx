import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { sounds } from '../lib/sounds';
import { completaTaskEAvanzaFase, WORKFLOW_MAP } from '../lib/clpWorkflow';
import type { Task, TeamMember, FaseCLP, Contenuto } from '../types';
import { Avatar } from './Avatar';

const STATI: Task['stato'][] = ['Da fare', 'In lavorazione', 'In revisione', 'Completato', 'Non accettato'];

const STATO_COLORS: Record<string, { bg: string; text: string }> = {
  'Da fare':        { bg: '#FEF3C7', text: '#D97706' },
  'In lavorazione': { bg: '#DBEAFE', text: '#2563EB' },
  'In revisione':   { bg: '#EDE9FE', text: '#7C3AED' },
  'Completato':     { bg: '#DCFCE7', text: '#16A34A' },
  'Non accettato':  { bg: '#FEE2E2', text: '#DC2626' },
  'Archiviato':     { bg: '#F1F5F9', text: '#64748B' },
};

const PRIORITA_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  '🔴 Alta':  { dot: '#EF4444', bg: '#FEE2E2', text: '#DC2626' },
  '🟡 Media': { dot: '#F59E0B', bg: '#FEF3C7', text: '#D97706' },
  '🟢 Bassa': { dot: '#22C55E', bg: '#DCFCE7', text: '#16A34A' },
};

// Pipeline CLP ordinata
const FASI_PIPELINE: FaseCLP[] = ['Girato', 'Pre montato', 'Montato', 'Revisione', 'Programmato', 'Pubblicato'];

const FASE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Girato':      { bg: 'hsl(271 80% 55% / 0.12)', text: 'hsl(271 60% 40%)',  border: 'hsl(271 80% 55% / 0.35)' },
  'Pre montato': { bg: 'hsl(214 80% 55% / 0.12)', text: 'hsl(214 70% 40%)',  border: 'hsl(214 80% 55% / 0.35)' },
  'Montato':     { bg: 'hsl(25 90% 55% / 0.12)',  text: 'hsl(25 70% 40%)',   border: 'hsl(25 90% 55% / 0.35)' },
  'Revisione':   { bg: 'hsl(45 90% 55% / 0.12)',  text: 'hsl(45 70% 38%)',   border: 'hsl(45 90% 55% / 0.35)' },
  'Programmato': { bg: 'hsl(142 70% 45% / 0.12)', text: 'hsl(142 60% 35%)',  border: 'hsl(142 70% 45% / 0.35)' },
  'Pubblicato':  { bg: 'hsl(142 70% 45% / 0.20)', text: 'hsl(142 60% 30%)',  border: 'hsl(142 70% 45% / 0.50)' },
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
  const [clpFase, setClpFase] = useState<FaseCLP | null>(null);
  const [savingFase, setSavingFase] = useState(false);

  // Determina se questo task è legato al workflow CLP
  const isCLPTask = !!(task.id_contenuto && WORKFLOW_MAP[task.tipo]);
  const workflowStep = WORKFLOW_MAP[task.tipo];

  // Carica la fase attuale del CLP collegato
  useEffect(() => {
    if (!task.id_contenuto) return;
    supabase
      .from('contenuti')
      .select('fase')
      .eq('id', task.id_contenuto)
      .single()
      .then(({ data }) => {
        if (data) setClpFase(data.fase as FaseCLP);
      });
  }, [task.id_contenuto]);

  const scad = task.scadenza ? new Date(task.scadenza) : null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const isScaduto = scad && scad < oggi && task.stato !== 'Completato';

  const handleStatoChange = async (nuovoStato: Task['stato']) => {
    setSaving(true);

    const { data, error } = await supabase
      .from('task')
      .update({ stato: nuovoStato })
      .eq('id', task.id)
      .select()
      .single();

    // Se completato e il task è parte del workflow CLP → avanza fase CLP
    if (!error && nuovoStato === 'Completato' && isCLPTask) {
      sounds.taskCompletato();
      addToast(`Task completato ✅`, 'success');

      const nuovaFase = await completaTaskEAvanzaFase(task.tipo, task.id_contenuto!, team);
      if (nuovaFase) {
        setClpFase(nuovaFase);
        addToast(`🔄 CLP avanzato a "${nuovaFase}" — nuovo task creato!`, 'success');
      }
    } else if (!error) {
      if (nuovoStato === 'Completato') sounds.taskCompletato();
      else sounds.salva();
      addToast(`Stato cambiato → ${nuovoStato}`, 'success');
    }

    setSaving(false);
    if (!error && data) onUpdate(data as Task);
  };

  // Avanza manualmente la fase CLP dal pannello task
  const handleFaseCLPChange = async (nuovaFase: FaseCLP) => {
    if (!task.id_contenuto || savingFase) return;
    setSavingFase(true);
    const { error } = await supabase
      .from('contenuti')
      .update({ fase: nuovaFase })
      .eq('id', task.id_contenuto);
    setSavingFase(false);
    if (!error) {
      setClpFase(nuovaFase);
      addToast(`🔄 Fase CLP aggiornata → ${nuovaFase}`, 'success');
    }
  };

  const handleArchivia = async () => {
    if (!confirm(`Archiviare il task ${task.id_display}?`)) return;
    sounds.elimina();
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
      sounds.salva();
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
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

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

          <hr style={{ borderColor: 'hsl(var(--border))' }} />

          {/* ─── FASE CLP (solo per task workflow) ──────────────────────────── */}
          {isCLPTask && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                FASE CLP
              </p>

              {/* Pipeline visiva */}
              <div className="flex items-center gap-0 mb-3 overflow-x-auto pb-1">
                {FASI_PIPELINE.map((fase, i) => {
                  const isCurrent = clpFase === fase;
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  const isPast = clpFase ? FASI_PIPELINE.indexOf(clpFase) > i : false;
                  return (
                    <React.Fragment key={fase}>
                      <div
                        className="flex flex-col items-center gap-0.5 flex-shrink-0"
                        style={{ minWidth: 52 }}
                      >
                        <div
                          className="w-3 h-3 rounded-full border-2 flex-shrink-0"
                          style={{
                            background: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted))',
                            borderColor: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--border))',
                            opacity: isPast ? 0.5 : 1,
                          }}
                        />
                        <span
                          className="text-[9px] font-medium text-center leading-tight"
                          style={{
                            color: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted-foreground))',
                            opacity: isPast ? 0.6 : 1,
                            fontWeight: isCurrent ? 700 : 400,
                          }}
                        >
                          {fase}
                        </span>
                      </div>
                      {i < FASI_PIPELINE.length - 1 && (
                        <div
                          className="flex-1 h-px mx-0.5 flex-shrink-0"
                          style={{
                            background: isPast ? style.text : 'hsl(var(--border))',
                            opacity: isPast ? 0.5 : 1,
                            minWidth: 6,
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Bottoni per avanzare/modificare fase */}
              <div className="flex flex-wrap gap-1.5">
                {FASI_PIPELINE.map(fase => {
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  const isCurrent = clpFase === fase;
                  return (
                    <button
                      key={fase}
                      onClick={() => handleFaseCLPChange(fase)}
                      disabled={isCurrent || savingFase}
                      className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-all"
                      style={{
                        background: isCurrent ? style.text : style.bg,
                        color: isCurrent ? 'white' : style.text,
                        border: `1px solid ${style.border}`,
                        opacity: savingFase ? 0.5 : 1,
                        fontWeight: isCurrent ? 700 : 500,
                        cursor: isCurrent ? 'default' : 'pointer',
                      }}
                    >
                      {isCurrent ? `● ${fase}` : fase}
                    </button>
                  );
                })}
              </div>

              {/* Hint: completando il task viene avanzata la fase automaticamente */}
              {workflowStep && task.stato !== 'Completato' && (
                <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5"
                  style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
                  ✅ Completando il task, il CLP passerà automaticamente a <strong>{workflowStep.faseNext}</strong>
                </div>
              )}
            </div>
          )}

          {/* ─── CAMBIA STATO TASK ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>CAMBIA STATO TASK</p>
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

          {/* ─── SPOSTA A ────────────────────────────────────────────────────── */}
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

          {/* ─── AGGIUNGI NOTA ───────────────────────────────────────────────── */}
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
