import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Clock, X, CheckCircle2, ArrowRight, Film } from 'lucide-react';
import type { Task, TeamMember } from '../types';

interface Props {
  tasks: Task[];
  utente: TeamMember;
  onGoToTask?: (taskId: string) => void;
}

const STORAGE_KEY = 'deadline_alert_dismissed';
const SNOOZE_MINUTES = 30;
const HOURS_BEFORE = 12;

// Task CLP = ha id_contenuto valorizzato OPPURE tipo appartenente al workflow produttivo
const CLP_TIPI = ['Premontaggio', 'Montaggio', 'Revisione', 'Programmazione', 'Pubblicazione'];

function isClpTask(task: Task): boolean {
  return !!(task.id_contenuto && task.id_contenuto.trim() !== '') ||
    CLP_TIPI.includes(task.tipo ?? '');
}

function getDismissedMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setDismissedMap(map: Record<string, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function getUrgentTasks(tasks: Task[], utente: TeamMember) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + HOURS_BEFORE * 60 * 60 * 1000);
  const dismissed = getDismissedMap();

  const urgent = tasks.filter(t => {
    if (t.stato === 'Completato' || t.stato === 'Archiviato') return false;
    if (t.assegnato_a !== utente.nome) return false;
    if (!t.scadenza) return false;
    const scadenzaDate = t.ora
      ? new Date(`${t.scadenza}T${t.ora}`)
      : new Date(`${t.scadenza}T23:59:59`);
    if (!(scadenzaDate > now && scadenzaDate <= cutoff)) return false;
    const lastDismissed = dismissed[t.id];
    if (!lastDismissed) return true;
    return Date.now() - lastDismissed >= SNOOZE_MINUTES * 60 * 1000;
  });

  return {
    clp: urgent.filter(isClpTask),
    other: urgent.filter(t => !isClpTask(t)),
  };
}

function getMinutesRemaining(task: Task): number {
  const now = new Date();
  const scadenzaDate = task.ora
    ? new Date(`${task.scadenza}T${task.ora}`)
    : new Date(`${task.scadenza}T23:59:59`);
  return Math.floor((scadenzaDate.getTime() - now.getTime()) / 60000);
}

function formatCountdown(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getPrioColor(priorita: string): string {
  if (priorita.includes('Alta')) return 'hsl(var(--destructive))';
  if (priorita.includes('Media')) return 'hsl(45 100% 55%)';
  return 'hsl(var(--primary))';
}

// ─── Full-screen modal per task CLP ─────────────────────────────────────────

function ClpDeadlineModal({
  tasks,
  onDismiss,
  onGoToTask,
}: {
  tasks: Task[];
  onDismiss: () => void;
  onGoToTask: () => void;
}) {
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          background: `radial-gradient(ellipse at center, hsl(var(--destructive) / ${pulse ? '0.18' : '0.06'}) 0%, transparent 70%)`,
        }}
      />

      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
        style={{
          background: 'hsl(var(--card))',
          border: `2px solid hsl(var(--destructive))`,
          boxShadow: `0 0 60px hsl(var(--destructive) / 0.4), 0 0 120px hsl(var(--destructive) / 0.15)`,
        }}
      >
        {/* Header */}
        <div
          className="relative px-6 py-5 flex items-center gap-4"
          style={{
            background: `linear-gradient(135deg, hsl(var(--destructive) / 0.2), hsl(var(--destructive) / 0.05))`,
            borderBottom: '1px solid hsl(var(--destructive) / 0.3)',
          }}
        >
          <div
            className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-700"
            style={{
              background: `hsl(var(--destructive) / 0.15)`,
              border: `2px solid hsl(var(--destructive) / ${pulse ? '1' : '0.4'})`,
              boxShadow: pulse ? `0 0 20px hsl(var(--destructive) / 0.6)` : 'none',
            }}
          >
            <Film
              size={26}
              style={{ color: 'hsl(var(--destructive))', transform: pulse ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.7s' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--destructive))' }}>
              🎬 Produzione CLP — Urgente
            </p>
            <h2 className="text-xl font-black leading-tight" style={{ color: 'hsl(var(--foreground))' }}>
              {tasks.length === 1 ? '1 task di produzione in scadenza!' : `${tasks.length} task di produzione in scadenza!`}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Scadono nelle prossime {HOURS_BEFORE} ore — blocca il workflow
            </p>
          </div>

          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            title="Snooze 30 min"
          >
            <X size={18} />
          </button>
        </div>

        {/* Lista task */}
        <div className="px-6 py-4 space-y-3 max-h-[50vh] overflow-y-auto">
          {tasks.map(task => {
            const mins = getMinutesRemaining(task);
            const isVeryUrgent = mins < 120;
            return (
              <div
                key={task.id}
                className="rounded-xl p-4"
                style={{
                  background: `hsl(var(--muted) / 0.5)`,
                  border: `1px solid ${isVeryUrgent ? 'hsl(var(--destructive) / 0.5)' : 'hsl(var(--border))'}`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5"
                    style={{ background: getPrioColor(task.priorita), boxShadow: `0 0 6px ${getPrioColor(task.priorita)}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-snug" style={{ color: 'hsl(var(--foreground))' }}>
                      {task.descrizione}
                    </p>
                    {task.cliente_nome && (
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {task.cliente_nome}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span
                        className="flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: isVeryUrgent ? 'hsl(var(--destructive) / 0.15)' : 'hsl(var(--muted))',
                          color: isVeryUrgent ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))',
                        }}
                      >
                        <Clock size={11} />
                        {formatCountdown(mins)}
                      </span>
                      <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {task.tipo} · {task.id_display}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={onGoToTask}
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-80 active:scale-95"
                    style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                  >
                    Vai <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <button
            onClick={onDismiss}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-80 active:scale-95"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            <Clock size={16} />
            Ricordamelo tra 30 min
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-80 active:scale-95"
            style={{
              background: 'hsl(var(--destructive))',
              color: 'hsl(var(--destructive-foreground))',
              boxShadow: '0 4px 16px hsl(var(--destructive) / 0.4)',
            }}
          >
            <CheckCircle2 size={16} />
            Ho capito, ci penso
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Finestrella bottom-right per task normali ───────────────────────────────

function OtherDeadlineToast({
  tasks,
  onDismiss,
  onGoToTask,
}: {
  tasks: Task[];
  onDismiss: () => void;
  onGoToTask: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shownTasks = expanded ? tasks : tasks.slice(0, 2);

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] w-80 rounded-2xl overflow-hidden shadow-2xl animate-slide-up"
      style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}
    >
      {/* Header compatto */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{
          background: 'hsl(45 100% 55% / 0.12)',
          borderBottom: '1px solid hsl(45 100% 55% / 0.25)',
        }}
      >
        <AlertTriangle size={15} style={{ color: 'hsl(45 100% 55%)', flexShrink: 0 }} />
        <span className="text-xs font-bold flex-1" style={{ color: 'hsl(45 100% 55%)' }}>
          {tasks.length === 1 ? '1 task in scadenza' : `${tasks.length} task in scadenza`}
        </span>
        <button
          onClick={onDismiss}
          className="p-1 rounded transition-colors hover:opacity-60"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Lista */}
      <div className="px-4 py-3 space-y-2">
        {shownTasks.map(task => {
          const mins = getMinutesRemaining(task);
          return (
            <div key={task.id} className="flex items-start gap-2">
              <div
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5"
                style={{ background: getPrioColor(task.priorita) }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-snug truncate" style={{ color: 'hsl(var(--foreground))' }}>
                  {task.descrizione}
                </p>
                <span className="text-[10px] font-semibold" style={{ color: 'hsl(45 100% 55%)' }}>
                  ⏱ {formatCountdown(mins)}
                </span>
              </div>
            </div>
          );
        })}

        {!expanded && tasks.length > 2 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[10px] font-semibold w-full text-center pt-1 hover:opacity-70 transition-opacity"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            +{tasks.length - 2} altri…
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 text-xs py-2 rounded-lg font-medium transition-all hover:opacity-70"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
        >
          <Clock size={11} className="inline mr-1" />
          30 min
        </button>
        <button
          onClick={onGoToTask}
          className="flex-1 text-xs py-2 rounded-lg font-semibold transition-all hover:opacity-80 flex items-center justify-center gap-1"
          style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
        >
          Vedi <ArrowRight size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Componente principale ───────────────────────────────────────────────────

export function DeadlineAlertModal({ tasks, utente, onGoToTask }: Props) {
  const [clpTasks, setClpTasks] = useState<Task[]>([]);
  const [otherTasks, setOtherTasks] = useState<Task[]>([]);

  const compute = useCallback(() => {
    const { clp, other } = getUrgentTasks(tasks, utente);
    setClpTasks(clp);
    setOtherTasks(other);
  }, [tasks, utente]);

  useEffect(() => { compute(); }, [compute]);

  useEffect(() => {
    const interval = setInterval(compute, SNOOZE_MINUTES * 60 * 1000);
    return () => clearInterval(interval);
  }, [compute]);

  const dismissTasks = (ts: Task[]) => {
    const dismissed = getDismissedMap();
    const now = Date.now();
    ts.forEach(t => { dismissed[t.id] = now; });
    setDismissedMap(dismissed);
  };

  const handleDismissClp = () => {
    dismissTasks(clpTasks);
    setClpTasks([]);
  };

  const handleDismissOther = () => {
    dismissTasks(otherTasks);
    setOtherTasks([]);
  };

  return (
    <>
      {/* Full-screen modal CLP */}
      {clpTasks.length > 0 && (
        <ClpDeadlineModal
          tasks={clpTasks}
          onDismiss={handleDismissClp}
          onGoToTask={() => { handleDismissClp(); onGoToTask?.(''); }}
        />
      )}

      {/* Toast bottom-right per task normali (solo se il modal CLP non è visibile) */}
      {otherTasks.length > 0 && clpTasks.length === 0 && (
        <OtherDeadlineToast
          tasks={otherTasks}
          onDismiss={handleDismissOther}
          onGoToTask={() => { handleDismissOther(); onGoToTask?.(''); }}
        />
      )}
    </>
  );
}
