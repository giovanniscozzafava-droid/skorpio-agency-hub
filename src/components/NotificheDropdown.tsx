import React, { useRef, useEffect } from 'react';
import { useNotifiche, type Notifica } from '@/hooks/useNotifiche';
import { useApp } from '@/context/AppContext';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ora';
  if (m < 60) return `${m}m fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h fa`;
  return `${Math.floor(h / 24)}g fa`;
}

function icona(tipo: Notifica['tipo']) {
  switch (tipo) {
    case 'task_assegnato': return '📋';
    case 'task_stato': return '🔄';
    case 'task_scadenza': return '⏰';
    case 'menzione': return '💬';
    default: return '🔔';
  }
}

interface Props {
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}

export function NotificheDropdown({ onClose, onOpenTask }: Props) {
  const { utente } = useApp();
  const { notifiche, nonLette, marcaLetta, marcaTutteLette } = useNotifiche(utente?.nome ?? null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 rounded-xl shadow-2xl z-50 overflow-hidden"
      style={{
        background: 'hsl(var(--topbar-bg))',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">🔔 Notifiche</span>
          {nonLette > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-bold text-white"
              style={{ background: 'hsl(var(--primary))' }}>
              {nonLette}
            </span>
          )}
        </div>
        {nonLette > 0 && (
          <button
            onClick={marcaTutteLette}
            className="text-xs hover:opacity-80 transition-opacity"
            style={{ color: 'hsl(var(--primary))' }}
          >
            Segna tutte lette
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
        {notifiche.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Nessuna notifica 🎉
          </div>
        ) : (
          notifiche.map(n => (
            <div
              key={n.id}
              onClick={() => {
                marcaLetta(n.id);
                if (n.task_id && onOpenTask) onOpenTask(n.task_id);
                onClose();
              }}
              className="flex gap-3 px-4 py-3 cursor-pointer transition-colors border-b hover:bg-white/5"
              style={{
                borderColor: 'rgba(255,255,255,0.06)',
                background: n.letto ? 'transparent' : 'rgba(59,130,246,0.08)',
              }}
            >
              <span className="text-lg flex-shrink-0 mt-0.5">{icona(n.tipo)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white leading-snug">{n.titolo}</p>
                <p className="text-xs mt-0.5 leading-snug line-clamp-2"
                  style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {n.messaggio}
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {n.task_id_display && (
                    <span className="mr-2 font-mono">{n.task_id_display}</span>
                  )}
                  {timeAgo(n.created_at)}
                </p>
              </div>
              {!n.letto && (
                <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: 'hsl(var(--primary))' }} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
