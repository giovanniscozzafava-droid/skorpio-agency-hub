import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { getStorageService } from '../services/storage';
import type { LogRipresa, Contenuto } from '../types';
import { buildClipFileName } from '../services/storage/StorageService';
import { ClipFileUpload } from './ClipFileUpload';

interface DriveStorageIndicatorProps {
  /** compact: show pill in topbar; expanded: show inline popover */
  compact?: boolean;
}

interface UsageData {
  used: number;
  total: number;
  byClient?: Record<string, { used: number; fileCount: number }>;
}

function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb < 0.1 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${gb.toFixed(1)} GB`;
}

export function DriveStorageIndicator({ compact = true }: DriveStorageIndicatorProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const storage = getStorageService();
      const data = await storage.getStorageUsage();
      setUsage(data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!usage || usage.total === 0) return null;

  const pct = Math.round((usage.used / usage.total) * 100);
  const color = pct >= 85 ? '#EF4444' : pct >= 60 ? '#F59E0B' : '#22C55E';
  const colorBg = pct >= 85 ? 'rgba(239,68,68,0.2)' : pct >= 60 ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.15)';

  const clientEntries = Object.entries(usage.byClient || {})
    .sort((a, b) => b[1].used - a[1].used);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => { setOpen(v => !v); if (!open) load(); }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors"
        style={{ background: open ? 'rgba(255,255,255,0.15)' : 'transparent' }}
        title="Google Drive Storage"
      >
        {loading ? (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>⟳</span>
        ) : (
          <span className="text-xs leading-none">🗂️</span>
        )}
        <span className="text-xs font-mono hidden sm:block" style={{ color }}>
          {formatGB(usage.used)}<span style={{ color: 'rgba(255,255,255,0.3)' }}> / {formatGB(usage.total)}</span>
        </span>
        {/* Mini progress bar */}
        <div className="hidden sm:block w-10 h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-foreground">🗂️ Google Drive SKORPIO_Clip</span>
              <span className="text-xs font-mono" style={{ color }}>{pct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>{formatGB(usage.used)} usati</span>
              <span>{formatGB(usage.total)} totali</span>
            </div>
          </div>

          {pct >= 85 && (
            <div className="px-4 py-2 bg-[hsl(var(--clr-red)/0.08)] border-b border-[hsl(var(--clr-red)/0.2)]">
              <p className="text-xs text-[hsl(var(--clr-red))] font-medium">
                ⚠️ Spazio quasi esaurito! Pulisci le clip Pubblicate.
              </p>
            </div>
          )}

          {clientEntries.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {clientEntries.map(([name, info]) => {
                const pctClient = usage.used > 0 ? Math.round((info.used / usage.used) * 100) : 0;
                return (
                  <div key={name} className="px-4 py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground truncate flex-1 mr-2" title={name}>{name}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{info.fileCount} file</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-[hsl(var(--clr-blue))]" style={{ width: `${pctClient}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatGB(info.used)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center">
              Nessun file in SKORPIO_Clip
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BulkUploadModalProps {
  clips: LogRipresa[];
  onClose: () => void;
  onUploaded: (clipId: string, patch: Partial<LogRipresa>) => void;
}

function BulkUploadModal({ clips, onClose, onUploaded }: BulkUploadModalProps) {
  const { addToast } = useApp();
  const [matches, setMatches] = useState<{ file: File; clip: LogRipresa | null }[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  function matchFilesToClips(files: File[]) {
    const result = files.map(f => {
      // Try to match by CLP ID pattern: "CLP012_..." or "C7876_..."
      const name = f.name.toUpperCase();
      const clip = clips.find(c => {
        const clipIdUpper = c.id_clip.toUpperCase();
        return name.startsWith(clipIdUpper + '_') || name.startsWith(clipIdUpper + '.');
      }) || null;
      return { file: f, clip };
    });
    setMatches(result);
    setConfirmed(false);
  }

  async function handleConfirmedUpload() {
    const toUpload = matches.filter(m => m.clip);
    if (toUpload.length === 0) return;

    setUploading(true);
    const storage = getStorageService();

    for (const { file, clip } of toUpload) {
      if (!clip) continue;
      try {
        setUploadProgress(p => ({ ...p, [clip.id]: 0 }));
        const result = await storage.upload(
          file,
          {
            clipId: clip.id_clip,
            clientName: clip.cliente_nome || 'Generale',
            clipTitle: clip.titolo || clip.id_clip,
            operatorName: clip.operatore || undefined,
          },
          (prog) => setUploadProgress(p => ({ ...p, [clip.id]: prog.percent }))
        );

        const patch: Partial<LogRipresa> = {
          file_id: result.fileId,
          file_url: result.fileUrl,
          file_name: result.fileName,
          file_size: result.fileSize,
          file_mime_type: result.mimeType,
          file_uploaded_at: result.uploadedAt,
          file_deleted_at: null,
        };

        await supabase.from('log_riprese').update(patch).eq('id', clip.id);
        onUploaded(clip.id, patch);
        setUploadProgress(p => ({ ...p, [clip.id]: 100 }));
      } catch {
        addToast(`❌ Errore upload ${file.name}`, 'error');
      }
    }

    addToast(`✅ ${toUpload.length} file caricati su Google Drive`, 'success');
    setUploading(false);
    onClose();
  }

  const matched = matches.filter(m => m.clip);
  const unmatched = matches.filter(m => !m.clip);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={!uploading ? onClose : undefined} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-lg border border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-base text-foreground">☁️ Upload Clip Multiple</h2>
          {!uploading && <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>}
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {matches.length === 0 ? (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-[hsl(var(--clr-blue)/0.5)] hover:bg-muted/30 transition-all"
            >
              <div className="text-4xl mb-3">📁</div>
              <p className="text-sm font-medium text-foreground">Seleziona più file video</p>
              <p className="text-xs text-muted-foreground mt-1">
                I file con nome tipo <span className="font-mono bg-muted px-1 rounded">C7876_titolo.mp4</span> verranno associati automaticamente
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="video/*,.mp4,.mov,.avi,.mp3"
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []);
                  matchFilesToClips(files);
                }}
              />
            </div>
          ) : (
            <>
              {matched.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[hsl(var(--clr-green))] mb-2">
                    ✅ {matched.length} file abbinati
                  </p>
                  {matched.map(({ file, clip }) => (
                    <div key={file.name} className="flex items-center gap-3 py-2 border-b border-border/50">
                      <span className="text-sm flex-shrink-0">🎬</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono truncate text-foreground">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{clip!.id_clip} — {clip!.titolo || '—'}</p>
                      </div>
                      {uploading && uploadProgress[clip!.id] !== undefined && (
                        <div className="w-16 h-1 rounded-full bg-muted overflow-hidden flex-shrink-0">
                          <div
                            className="h-full bg-[hsl(var(--clr-blue))] transition-all"
                            style={{ width: `${uploadProgress[clip!.id]}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {unmatched.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[hsl(var(--clr-amber))] mb-2">
                    ⚠️ {unmatched.length} file non abbinati
                  </p>
                  {unmatched.map(({ file }) => (
                    <div key={file.name} className="flex items-center gap-2 py-1.5 text-muted-foreground">
                      <span className="text-sm">📄</span>
                      <span className="text-xs font-mono truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {matches.length > 0 && !uploading && (
          <div className="px-6 py-4 border-t border-border flex gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted"
            >
              Annulla
            </button>
            <button
              onClick={handleConfirmedUpload}
              disabled={matched.length === 0}
              className="flex-1 py-2.5 rounded-lg bg-[hsl(var(--clr-blue))] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
            >
              ☁️ Carica {matched.length} file
            </button>
          </div>
        )}

        {uploading && (
          <div className="px-6 py-4 border-t border-border text-center text-sm text-muted-foreground flex-shrink-0">
            Caricamento in corso…
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AutoCleanupDialogProps {
  clip: LogRipresa;
  newValue: string;
  field: 'stato' | 'fase';
  onConfirm: (deleteFile: boolean) => void;
  onCancel: () => void;
}

export function AutoCleanupDialog({ clip, newValue, field, onConfirm, onCancel }: AutoCleanupDialogProps) {
  const label = field === 'stato' ? 'stato Usata' : 'fase Pubblicato';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border p-6 space-y-4">
        <div className="text-center">
          <div className="text-3xl mb-2">☁️</div>
          <h3 className="font-bold text-base text-foreground">Rimuovere il file da Google Drive?</h3>
        </div>
        <div className="rounded-lg bg-[hsl(var(--clr-amber)/0.1)] border border-[hsl(var(--clr-amber)/0.3)] px-4 py-3 text-sm text-foreground">
          La clip <span className="font-mono font-semibold">{clip.id_clip}</span> sta passando a <span className="font-semibold">{newValue}</span>.
          Ha un file caricato su Google Drive: <span className="font-medium">{clip.file_name}</span>.
        </div>
        <p className="text-xs text-muted-foreground text-center">
          L'archivio fisico locale resta intatto. Solo il file su Drive verrà rimosso per liberare spazio.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => onConfirm(true)}
            className="w-full py-2.5 rounded-lg bg-[hsl(var(--clr-red))] text-white font-semibold text-sm hover:opacity-90"
          >
            🗑️ Sì — cambia stato e rimuovi da Drive
          </button>
          <button
            onClick={() => onConfirm(false)}
            className="w-full py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted"
          >
            ✅ Cambia stato — mantieni file su Drive
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

export { BulkUploadModal };
export type { UsageData };
