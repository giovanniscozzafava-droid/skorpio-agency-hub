import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { sounds } from '../lib/sounds';
import { avanzaFaseDaTask, completaTaskEAvanzaFase, WORKFLOW_MAP } from '../lib/clpWorkflow';
import type { Task, TeamMember, FaseCLP } from '../types';
import { Avatar } from './Avatar';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { parseLocalDate } from '../lib/dateUtils';

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

const FASI_PIPELINE: FaseCLP[] = ['Girato', 'Pre montato', 'Montato', 'Revisionato', 'Programmato', 'Pubblicato'];

const FASE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Girato':      { bg: 'hsl(271 80% 55% / 0.12)', text: 'hsl(271 60% 40%)',  border: 'hsl(271 80% 55% / 0.35)' },
  'Pre montato': { bg: 'hsl(214 80% 55% / 0.12)', text: 'hsl(214 70% 40%)',  border: 'hsl(214 80% 55% / 0.35)' },
  'Montato':     { bg: 'hsl(25 90% 55% / 0.12)',  text: 'hsl(25 70% 40%)',   border: 'hsl(25 90% 55% / 0.35)' },
  'Revisionato': { bg: 'hsl(328 80% 55% / 0.12)', text: 'hsl(328 65% 40%)',  border: 'hsl(328 80% 55% / 0.35)' },
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
  const [taskCompletato, setTaskCompletato] = useState(task.stato === 'Completato');

  // ── Programmazione date picker ─────────────────────────────────────────────
  const [dataPub, setDataPub] = useState<Date | undefined>(
    task.scadenza ? parseLocalDate(task.scadenza) : undefined
  );
  const [oraPub, setOraPub] = useState<string>(task.ora ? task.ora.slice(0, 5) : '');
  const [savingProg, setSavingProg] = useState(false);
  const isProgrammazioneTask = task.tipo === 'Programmazione';

  const isCLPTask = !!(task.id_contenuto && WORKFLOW_MAP[task.tipo]);
  const workflowStep = WORKFLOW_MAP[task.tipo];

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

  useEffect(() => {
    setTaskCompletato(task.stato === 'Completato');
  }, [task.stato]);

  useEffect(() => {
    setDataPub(task.scadenza ? parseLocalDate(task.scadenza) : undefined);
    setOraPub(task.ora ? task.ora.slice(0, 5) : '');
  }, [task.scadenza, task.ora]);

  const scad = task.scadenza ? parseLocalDate(task.scadenza) : null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const isScaduto = scad && scad < oggi && task.stato !== 'Completato';

  // ── Salva data/ora di pubblicazione (task Programmazione) ─────────────────
  const handleSalvaProgrammazione = async () => {
    if (!dataPub || !task.id_contenuto) return;
    setSavingProg(true);
    const dataStr = format(dataPub, 'yyyy-MM-dd');
    const oraStr = oraPub || null;

    // Aggiorna scadenza del task e data_pubblicazione del CLP
    await Promise.all([
      supabase.from('task').update({ scadenza: dataStr, ora: oraStr }).eq('id', task.id),
      supabase.from('contenuti').update({
        data_pubblicazione: dataStr,
        ora_pubblicazione: oraStr,
        fase: 'Programmato',
      }).eq('id', task.id_contenuto),
    ]);

    // Completa il task e aggiunge evento calendario
    await supabase.from('task').update({ stato: 'Completato' }).eq('id', task.id);

    // Crea evento calendario per la pubblicazione
    const { data: contenuto } = await supabase
      .from('contenuti')
      .select('*')
      .eq('id', task.id_contenuto)
      .single();

    if (contenuto) {
      await supabase.from('calendario').insert({
        tipo: 'pubblicazione',
        data: dataStr,
        ora: oraStr,
        descrizione: `📱 Pubblica ${contenuto.id_display} – ${contenuto.titolo}`,
        cliente_id: contenuto.cliente_id,
        cliente_nome: contenuto.cliente_nome || '',
        contenuto_id: contenuto.id,
        id_contenuto_display: contenuto.id_display,
        canale: contenuto.canale || '',
        tipo_contenuto: contenuto.tipo || '',
        persona: 'Elisa',
        stato: 'Pianificato',
      });
    }

    setClpFase('Programmato');
    setTaskCompletato(true);
    sounds.taskCompletato();
    addToast(`📅 CLP programmato per ${format(dataPub, 'd MMM yyyy', { locale: it })}${oraStr ? ' alle ' + oraStr : ''} — verrà pubblicato automaticamente!`, 'success');

    const { data: updated } = await supabase.from('task').select('*').eq('id', task.id).single();
    if (updated) onUpdate(updated as Task);
    setSavingProg(false);
  };



  // ── Cambia solo lo stato del task (senza toccare il CLP) ──────────────────
  const handleStatoChange = async (nuovoStato: Task['stato']) => {
    setSaving(true);
    const { data, error } = await supabase
      .from('task')
      .update({ stato: nuovoStato })
      .eq('id', task.id)
      .select()
      .single();

    if (!error && nuovoStato === 'Completato' && isCLPTask) {
      sounds.taskCompletato();
      const nuovaFase = await completaTaskEAvanzaFase(task.tipo, task.id_contenuto!, team, utente?.id);
      if (nuovaFase) {
        setClpFase(nuovaFase);
        setTaskCompletato(true);
        const isDrive = nuovaFase === 'Montato';
        addToast(
          `✅ Task completato → CLP avanzato a "${nuovaFase}"${isDrive ? ' + 📁 Drive in creazione…' : ' — nuovo task creato!'}`,
          'success'
        );
      }
    } else if (!error) {
      if (nuovoStato === 'Completato') sounds.taskCompletato();
      else sounds.salva();
      addToast(`Stato → ${nuovoStato}`, 'success');
    }

    setSaving(false);
    if (!error && data) onUpdate(data as Task);
  };

  // ── Cambia la fase CLP: se coincide con faseNext → completa task + avanza ─
  const handleFaseCLPChange = async (nuovaFase: FaseCLP) => {
    if (!task.id_contenuto || savingFase) return;
    setSavingFase(true);

    const result = await avanzaFaseDaTask(
      task.id,
      task.tipo,
      task.id_contenuto,
      nuovaFase,
      team
    );

    setClpFase(nuovaFase);
    setSavingFase(false);

    if (result.completatoTask) {
      setTaskCompletato(true);
      sounds.taskCompletato();
      // Rifletti il completamento nel task visualizzato
      const { data } = await supabase.from('task').select('*').eq('id', task.id).single();
      if (data) onUpdate(data as Task);

      const msgs: string[] = [`✅ Task completato — CLP → "${nuovaFase}"`];
      if (result.taskCreato) msgs.push('Nuovo task creato!');
      if (result.driveTriggered) msgs.push('📁 Drive in creazione…');
      addToast(msgs.join(' · '), 'success');
    } else {
      sounds.salva();
      addToast(`🔄 Fase CLP → ${nuovaFase}`, 'success');
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
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 bg-card flex flex-col animate-slide-in-right"
        style={{ width: 360, borderLeft: '1px solid hsl(var(--border))', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-xs font-mono text-muted-foreground">{task.id_display}</span>
          <button onClick={onClose} className="sk-btn-ghost text-lg px-2 py-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Descrizione */}
          <p className="text-base font-semibold leading-snug" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {task.descrizione}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: statoInfo.bg, color: statoInfo.text }}>
              {task.stato}
            </span>
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: prioritaInfo.bg, color: prioritaInfo.text }}>
              {task.priorita}
            </span>
            {isScaduto && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: '#FEE2E2', color: '#DC2626' }}>⚠ SCADUTO</span>
            )}
          </div>

          {/* Info rows */}
          <div className="space-y-2">
            {[
              ['Tipo', task.tipo || '—'],
              ['Cliente', task.cliente_nome || '—'],
              ['Contenuto', task.id_contenuto || '—'],
              ['Assegnato da', task.assegnato_da || '—'],
              ['Scadenza', task.scadenza ? parseLocalDate(task.scadenza).toLocaleDateString('it-IT') : '—'],
              ['Ora', task.ora ? task.ora.slice(0, 5) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="flex-shrink-0 text-xs font-medium w-28" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{label}</span>
                <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{value}</span>
              </div>
            ))}
          </div>

          {task.note && (
            <div className="rounded-lg p-3 text-xs whitespace-pre-wrap leading-relaxed"
              style={{ background: 'hsl(210 40% 96%)', color: 'hsl(var(--skorpio-text-secondary))' }}>
              {task.note}
            </div>
          )}

          <hr style={{ borderColor: 'hsl(var(--border))' }} />

          {/* ─── PROGRAMMAZIONE DATE PICKER (task Programmazione) ───────────── */}
          {isProgrammazioneTask && !taskCompletato && (
            <div>
              <p className="text-xs font-medium mb-3" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                📅 SCEGLI DATA DI PUBBLICAZIONE
              </p>
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: 'hsl(328 80% 55% / 0.06)', border: '1px solid hsl(328 80% 55% / 0.25)' }}>
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(328 65% 40%)' }}>
                  Scegli quando pubblicare questo contenuto. Il CLP passerà a <strong>Programmato</strong> e a quella data diventerà <strong>Pubblicato</strong> in automatico.
                </p>

                {/* Date picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all"
                      style={{
                        background: dataPub ? 'hsl(328 80% 55% / 0.10)' : 'hsl(var(--muted))',
                        border: `1px solid ${dataPub ? 'hsl(328 80% 55% / 0.40)' : 'hsl(var(--border))'}`,
                        color: dataPub ? 'hsl(328 65% 40%)' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <CalendarIcon size={14} />
                        {dataPub ? format(dataPub, 'd MMMM yyyy', { locale: it }) : 'Seleziona data…'}
                      </span>
                      {dataPub && <span className="text-xs opacity-60">cambia</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataPub}
                      onSelect={setDataPub}
                      initialFocus
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                    />
                  </PopoverContent>
                </Popover>

                {/* Ora opzionale */}
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    Ora pubblicazione (opzionale)
                  </label>
                  <input
                    type="time"
                    value={oraPub}
                    onChange={e => setOraPub(e.target.value)}
                    className="sk-input w-full text-sm"
                  />
                </div>

                <button
                  onClick={handleSalvaProgrammazione}
                  disabled={!dataPub || savingProg}
                  className="sk-btn-primary w-full text-sm font-semibold"
                  style={{ opacity: (!dataPub || savingProg) ? 0.5 : 1 }}
                >
                  {savingProg ? '⏳ Salvando…' : `📅 Programma per ${dataPub ? format(dataPub, 'd MMM', { locale: it }) : '…'}`}
                </button>
              </div>
            </div>
          )}

          {isProgrammazioneTask && taskCompletato && (
            <div className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
              ✅ Programmato per {task.scadenza ? format(new Date(task.scadenza), 'd MMM yyyy', { locale: it }) : '—'}
              {task.ora ? ` alle ${task.ora.slice(0,5)}` : ''} — verrà pubblicato automaticamente!
            </div>
          )}

          {/* ─── PIPELINE FASE CLP (solo task workflow NON Programmazione) ──── */}
          {isCLPTask && !isProgrammazioneTask && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                FASE CLP
              </p>

              {/* Pipeline visiva */}
              <div className="flex items-center mb-3 overflow-x-auto pb-1">
                {FASI_PIPELINE.map((fase, i) => {
                  const isCurrent = clpFase === fase;
                  const isPast = clpFase ? FASI_PIPELINE.indexOf(clpFase) > i : false;
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  return (
                    <React.Fragment key={fase}>
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ minWidth: 52 }}>
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{
                            background: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted))',
                            borderColor: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--border))',
                            opacity: isPast ? 0.45 : 1,
                          }}
                        />
                        <span className="text-[9px] font-medium text-center leading-tight"
                          style={{
                            color: isCurrent ? style.text : isPast ? style.text : 'hsl(var(--muted-foreground))',
                            opacity: isPast ? 0.55 : 1,
                            fontWeight: isCurrent ? 700 : 400,
                          }}>
                          {fase}
                        </span>
                      </div>
                      {i < FASI_PIPELINE.length - 1 && (
                        <div className="flex-1 h-px mx-0.5 flex-shrink-0"
                          style={{ background: isPast ? style.text : 'hsl(var(--border))', opacity: isPast ? 0.4 : 1, minWidth: 6 }} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Bottoni fase */}
              <div className="flex flex-wrap gap-1.5">
                {FASI_PIPELINE.map(fase => {
                  const style = FASE_STYLE[fase] || FASE_STYLE['Girato'];
                  const isCurrent = clpFase === fase;
                  const isNextStep = workflowStep?.faseNext === fase && !taskCompletato;
                  return (
                    <button
                      key={fase}
                      onClick={() => handleFaseCLPChange(fase)}
                      disabled={isCurrent || savingFase || taskCompletato}
                      className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-all"
                      style={{
                        background: isCurrent ? style.text : isNextStep ? style.text : style.bg,
                        color: isCurrent || isNextStep ? 'white' : style.text,
                        border: `1px solid ${isNextStep ? style.text : style.border}`,
                        opacity: (savingFase || taskCompletato) && !isCurrent ? 0.45 : 1,
                        fontWeight: isCurrent || isNextStep ? 700 : 500,
                        cursor: isCurrent || taskCompletato ? 'default' : 'pointer',
                        boxShadow: isNextStep ? `0 0 0 2px ${style.text}40` : 'none',
                      }}
                    >
                      {isCurrent ? `● ${fase}` : isNextStep ? `→ ${fase}` : fase}
                    </button>
                  );
                })}
              </div>

              {/* Hint contestuale */}
              {workflowStep && !taskCompletato && (
                <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5"
                  style={{ background: 'hsl(214 80% 55% / 0.08)', color: 'hsl(214 70% 40%)', border: '1px solid hsl(214 80% 55% / 0.25)' }}>
                  💡 Clicca <strong>→ {workflowStep.faseNext}</strong> per completare il tuo task e passare il lavoro a <strong>{workflowStep.assegnatoKeyword}</strong>
                  {workflowStep.faseNext === 'Montato' && <> · 📁 Drive verrà creato automaticamente</>}
                </div>
              )}
              {taskCompletato && (
                <div className="mt-2 text-[11px] rounded-md px-2.5 py-1.5"
                  style={{ background: 'hsl(142 70% 45% / 0.08)', color: 'hsl(142 60% 35%)', border: '1px solid hsl(142 70% 45% / 0.25)' }}>
                  ✅ Task completato — il lavoro è stato passato al prossimo membro del team
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

          {/* ─── NOTA ────────────────────────────────────────────────────────── */}
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
