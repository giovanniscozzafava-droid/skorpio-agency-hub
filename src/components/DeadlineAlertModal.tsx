import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Clock, X, CheckCircle2, ArrowRight } from 'lucide-react';
import type { Task, TeamMember } from '../types';
import { useApp } from '../context/AppContext';

interface Props {
  tasks: Task[];
  utente: TeamMember;
  onGoToTask?: (taskId: string) => void;
}

const STORAGE_KEY = 'deadline_alert_dismissed';
const SNOOZE_MINUTES = 30;
const HOURS_BEFORE = 12;

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

function getUrgentTasks(tasks: Task[], utente: TeamMember): Task[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + HOURS_BEFORE * 60 * 60 * 1000);

  return tasks.filter(t => {
    if (t.stato === 'Completato' || t.stato === 'Archiviato') return false;
    if (t.assegnato_a !== utente.nome) return false;
    if (!t.scadenza) return false;

    // Costruisci la data di scadenza con ora se disponibile
    const scadenzaDate = t.ora
      ? new Date(`${t.scadenza}T${t.ora}`)
      : new Date(`${t.scadenza}T23:59:59`);

    return scadenzaDate > now && scadenzaDate <= cutoff;
  });
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

export function DeadlineAlertModal({ tasks, utente, onGoToTask }: Props) {
  const [visibleTasks, setVisibleTasks] = useState<Task[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [pulse, setPulse] = useState(true);

  const computeVisible = useCallback(() => {
    const urgent = getUrgentTasks(tasks, utente);
    const dismissed = getDismissedMap();
    const now = Date.now();

    const toShow = urgent.filter(t => {
      const lastDismissed = dismissed[t.id];
      if (!lastDismissed) return true;
      // Riappare dopo SNOOZE_MINUTES minuti
      return now - lastDismissed >= SNOOZE_MINUTES * 60 * 1000;
    });

    setVisibleTasks(toShow);
    setIsVisible(toShow.length > 0);
  }, [tasks, utente]);

  // Check all'apertura dell'app
  useEffect(() => {
    computeVisible();
  }, [computeVisible]);

  // Ri-check ogni 30 minuti (intervallo snooze)
  useEffect(() => {
    const interval = setInterval(computeVisible, SNOOZE_MINUTES * 60 * 1000);
    return () => clearInterval(interval);
  }, [computeVisible]);

  // Effetto pulsante ogni 2 secondi
  useEffect(() => {
    if (!isVisible) return;
    const t = setInterval(() => setPulse(p => !p), 1500);
    return () => clearInterval(t);
  }, [isVisible]);

  const handleDismiss = () => {
    const dismissed = getDismissedMap();
    const now = Date.now();
    visibleTasks.forEach(t => { dismissed[t.id] = now; });
    setDismissedMap(dismissed);
    setIsVisible(false);
  };

  const handleGoToTask = (taskId: string) => {
    handleDismiss();
    onGoToTask?.(taskId);
  };

  if (!isVisible || visibleTasks.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Sfondo pulsante rosso */}
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
          {/* Icona animata */}
          <div
            className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-700"
            style={{
              background: `hsl(var(--destructive) / 0.15)`,
              border: `2px solid hsl(var(--destructive) / ${pulse ? '1' : '0.4'})`,
              boxShadow: pulse ? `0 0 20px hsl(var(--destructive) / 0.6)` : 'none',
            }}
          >
            <AlertTriangle
              size={28}
              style={{ color: 'hsl(var(--destructive))', transform: pulse ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.7s' }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-bold uppercase tracking-widest mb-1"
              style={{ color: 'hsl(var(--destructive))' }}
            >
              ⚠ Attenzione richiesta
            </p>
            <h2
              className="text-xl font-black leading-tight"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {visibleTasks.length === 1
                ? 'Hai 1 task in scadenza!'
                : `Hai ${visibleTasks.length} task in scadenza!`}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Scadono nelle prossime {HOURS_BEFORE} ore
            </p>
          </div>

          {/* X discreta in alto a destra */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            title="Snooze 30 min"
          >
            <X size={18} />
          </button>
        </div>

        {/* Lista task */}
        <div className="px-6 py-4 space-y-3 max-h-[50vh] overflow-y-auto">
          {visibleTasks.map(task => {
            const mins = getMinutesRemaining(task);
            const isVeryUrgent = mins < 120;
            return (
              <div
                key={task.id}
                className="rounded-xl p-4 transition-all"
                style={{
                  background: `hsl(var(--muted) / 0.5)`,
                  border: `1px solid ${isVeryUrgent ? 'hsl(var(--destructive) / 0.5)' : 'hsl(var(--border))'}`,
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Indicatore priorità */}
                  <div
                    className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5"
                    style={{ background: getPrioColor(task.priorita), boxShadow: `0 0 6px ${getPrioColor(task.priorita)}` }}
                  />

                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm leading-snug"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {task.descrizione}
                    </p>
                    {task.cliente_nome && (
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {task.cliente_nome}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-2">
                      {/* Countdown */}
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
                        {task.id_display}
                      </span>
                    </div>
                  </div>

                  {/* Freccia per aprire il task */}
                  <button
                    onClick={() => handleGoToTask(task.id)}
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-80 active:scale-95"
                    style={{
                      background: 'hsl(var(--primary))',
                      color: 'hsl(var(--primary-foreground))',
                    }}
                  >
                    Vai
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{ borderTop: '1px solid hsl(var(--border))' }}
        >
          <button
            onClick={handleDismiss}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-80 active:scale-95"
            style={{
              background: 'hsl(var(--muted))',
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            <Clock size={16} />
            Ricordamelo tra 30 min
          </button>
          <button
            onClick={handleDismiss}
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
