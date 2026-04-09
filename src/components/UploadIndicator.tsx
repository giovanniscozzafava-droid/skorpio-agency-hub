import React, { useRef, useState, useEffect } from 'react';
import { useUpload, UploadItem } from '../context/UploadContext';
import { ErrorHelper } from './ErrorHelper';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (!b) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSpeed(bps: number): string {
  if (!bps) return '';
  return `${formatBytes(bps)}/s`;
}

function formatEta(sec: number): string {
  if (!sec || sec <= 0) return '';
  if (sec < 60) return `~${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return `~${m}m${s > 0 ? ` ${s}s` : ''}`;
}

// ─── Single row ──────────────────────────────────────────────────────────────

function UploadRow({ item, onPause, onResume, onCancel, onRetry }: {
  item: UploadItem;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const isActive    = item.status === 'uploading';
  const isQueued    = item.status === 'queued';
  const isPaused    = item.status === 'paused';
  const isCompleted = item.status === 'completed';
  const isFailed    = item.status === 'failed';

  const statusColor = isActive ? 'hsl(var(--clr-blue))' :
    isQueued ? 'hsl(var(--muted-foreground))' :
    isPaused ? 'hsl(var(--clr-amber))' :
    isCompleted ? 'hsl(var(--clr-green))' :
    'hsl(var(--clr-red))';

  const zoneLabel = item.zone === 'clip' ? 'clip/' : 'file_esportato/';

  return (
    <div className="px-3 py-2.5 border-b border-border/50 last:border-0">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <span className="text-sm flex-shrink-0 mt-0.5">
          {isCompleted ? '✅' : isFailed ? '❌' : isPaused ? '⏸️' : isQueued ? '⏳' : '📹'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground truncate" title={item.fileName}>
            {item.fileName}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <span className="font-mono">{item.clipDisplayId || item.clipCode}</span>
            {item.clienteNome && <span> · {item.clienteNome}</span>}
            <span style={{ color: statusColor }} className="ml-1">→ {zoneLabel}</span>
          </p>
        </div>
        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0 mt-0.5">
          {(isActive || isQueued) && (
            <button
              onClick={onPause}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
              title="Pausa"
            >
              ⏸
            </button>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--clr-blue)/0.15)] text-[hsl(var(--clr-blue))] hover:opacity-80 transition-colors"
              title="Riprendi"
            >
              ▶
            </button>
          )}
          {isFailed && (
            <button
              onClick={onRetry}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--clr-amber)/0.15)] text-[hsl(var(--clr-amber))] hover:opacity-80 transition-colors"
              title="Riprova"
            >
              🔄
            </button>
          )}
          {!isCompleted && (
            <button
              onClick={onCancel}
              className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:opacity-80 transition-colors"
              title="Annulla"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || isPaused) && (
        <div className="mt-1.5 ml-6">
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${item.percent}%`,
                background: isPaused ? 'hsl(var(--clr-amber))' : 'hsl(var(--clr-blue))',
              }}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(item.loadedBytes)} / {formatBytes(item.fileSize)}
              {item.speedBps > 0 && <span className="ml-1">· {formatSpeed(item.speedBps)}</span>}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {item.percent}%
              {item.etaSeconds > 0 && <span className="ml-1">{formatEta(item.etaSeconds)}</span>}
            </span>
          </div>
        </div>
      )}

      {/* Queued state */}
      {isQueued && (
        <p className="text-[10px] text-muted-foreground mt-1 ml-6">
          ⏳ In coda — {formatBytes(item.fileSize)}
        </p>
      )}

      {/* Failed state */}
      {isFailed && item.errorMsg && (
        <>
          <p className="text-[10px] text-[hsl(var(--clr-red))] mt-1 ml-6 truncate" title={item.errorMsg}>
            {item.errorMsg}
          </p>
          <ErrorHelper
            errorMsg={item.errorMsg}
            context={`Upload ${item.fileName} → ${item.clipDisplayId || item.clipCode}${item.clienteNome ? ` (${item.clienteNome})` : ''}`}
            compact
          />
        </>
      )}

      {/* Completed state */}
      {isCompleted && (
        <p className="text-[10px] text-[hsl(var(--clr-green))] mt-0.5 ml-6">
          {formatBytes(item.fileSize)} — completato
        </p>
      )}
    </div>
  );
}

// ─── Main indicator ──────────────────────────────────────────────────────────

export function UploadIndicator() {
  const { queue, pause, resume, cancel, retry, clearCompleted, activeCount, queuedCount } = useUpload();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const totalActive = activeCount + queuedCount;
  const failedCount = queue.filter(u => u.status === 'failed').length;
  const completedCount = queue.filter(u => u.status === 'completed').length;

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Don't render if queue is empty
  if (queue.length === 0) return null;

  const badgeColor = failedCount > 0
    ? 'hsl(var(--clr-red))'
    : activeCount > 0
      ? 'hsl(var(--clr-blue))'
      : 'hsl(var(--clr-green))';

  const badgeLabel = failedCount > 0
    ? `${failedCount}⚠️`
    : totalActive > 0
      ? `${totalActive}`
      : `✓`;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors"
        style={{
          background: open ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
        }}
        title="Upload in corso"
      >
        {/* Animated cloud icon */}
        <span className={`text-sm leading-none ${activeCount > 0 ? 'animate-pulse' : ''}`}>☁️</span>
        <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.8)' }}>↑</span>

        {/* Badge */}
        <span
          className="min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
          style={{ background: badgeColor }}
        >
          {badgeLabel}
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-96 bg-card border border-border rounded-2xl shadow-2xl z-[300] overflow-hidden"
          style={{ maxHeight: 480 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <span className="text-sm">☁️↑</span>
              <span className="text-xs font-bold text-foreground">Upload in corso</span>
              {totalActive > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: 'hsl(var(--clr-blue)/0.15)', color: 'hsl(var(--clr-blue))' }}
                >
                  {activeCount} attivi{queuedCount > 0 ? `, ${queuedCount} in coda` : ''}
                </span>
              )}
            </div>
            {completedCount > 0 && (
              <button
                onClick={clearCompleted}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Pulisci ✓
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
            {/* Active + queued first */}
            {queue.filter(u => u.status !== 'completed').map(item => (
              <UploadRow
                key={item.id}
                item={item}
                onPause={() => pause(item.id)}
                onResume={() => resume(item.id)}
                onCancel={() => cancel(item.id)}
                onRetry={() => retry(item.id)}
              />
            ))}
            {/* Completed at bottom */}
            {queue.filter(u => u.status === 'completed').map(item => (
              <UploadRow
                key={item.id}
                item={item}
                onPause={() => pause(item.id)}
                onResume={() => resume(item.id)}
                onCancel={() => cancel(item.id)}
                onRetry={() => retry(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
