import React, { useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { LogRipresa, Contenuto } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ─── types ────────────────────────────────────────────────────────────────────

interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface ClipFileUploadProps {
  clip: LogRipresa;
  clp?: Contenuto | null;   // needed for folder IDs + metadata
  onUpdated: (patch: Partial<LogRipresa>) => void;
  variant?: 'row' | 'panel';
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isVideoMime(mimeType: string | null | undefined): boolean {
  return !!(mimeType && (mimeType.startsWith('video/') || mimeType === 'application/octet-stream'));
}

async function invokeEdge(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/functions/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Edge function error ${res.status}`);
  return data;
}

// ─── Core upload logic ────────────────────────────────────────────────────────

async function uploadFileToZone(
  file: File,
  zone: 'clip' | 'file_esportato',
  clip: LogRipresa,
  clp: Contenuto | null | undefined,
  userId: string,
  onProgress: (p: UploadProgress) => void
): Promise<{ fileId: string; fileUrl: string; fileName: string }> {
  const ext = file.name.split('.').pop() || 'mp4';
  const slug = slugify(clip.titolo || clip.id_clip);
  const zonePrefix = zone === 'file_esportato' ? 'export_' : '';
  const fileName = `${clip.id_clip}_${slug}_${zonePrefix}${Date.now()}.${ext}`;
  const mimeType = file.type || 'video/mp4';
  const clientName = clip.cliente_nome || 'Generale';
  const storagePath = `${userId}/${zone}/${Date.now()}_${fileName}`;

  // Step 1: Upload to Supabase Storage buffer
  const { data: { session } } = await supabase.auth.getSession();
  const authToken = session?.access_token || SUPABASE_KEY;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${SUPABASE_URL}/storage/v1/object/temp-uploads/${storagePath}`;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(3 + (e.loaded / e.total) * 78);
        onProgress({ loaded: e.loaded, total: file.size, percent: pct });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        console.error('[ClipFileUpload] Storage upload failed', {
          status: xhr.status,
          responseText: xhr.responseText,
          zone,
          fileSize: file.size,
          authTokenIsAnon: authToken === SUPABASE_KEY,
        });
        reject(new Error(`Storage upload fallito (${xhr.status}): ${xhr.responseText}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Errore di rete durante upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload annullato')));

    xhr.open('POST', url);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.send(file);
  });

  onProgress({ loaded: file.size, total: file.size, percent: 85 });

  // Step 2: Transfer to Google Drive via edge function
  const result = await invokeEdge('google-drive-transfer', {
    method: 'POST',
    body: JSON.stringify({
      storagePath,
      fileName,
      mimeType,
      fileSize: file.size,
      clientName,
      teamId: userId,
      zone,
      contenutoId: clip.contenuto_id,
      idDisplay: clp?.id_display || clip.id_contenuto_display || '',
      titolo: clp?.titolo || clip.titolo || '',
    }),
  });

  return { fileId: result.fileId, fileUrl: result.fileUrl, fileName };
}

// ─── Row variant ──────────────────────────────────────────────────────────────

export function ClipFileUpload({ clip, clp, onUpdated, variant = 'row' }: ClipFileUploadProps) {
  const { addToast, utente } = useApp();
  const rawInputRef  = useRef<HTMLInputElement>(null);
  const expInputRef  = useRef<HTMLInputElement>(null);

  const [uploadingZone, setUploadingZone] = useState<'clip' | 'file_esportato' | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [draggingZone, setDraggingZone] = useState<'clip' | 'file_esportato' | null>(null);
  const [showDeleteExport, setShowDeleteExport] = useState(false);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  const hasExport  = !!(clip.exported_file_id && clip.exported_file_url);
  const hasRawFile = !!(clip.file_id && !clip.file_deleted_at);
  const rawDeleted = !!(clip.file_deleted_at);
  const driveConnected = !!(utente as any)?.google_drive_connected;

  const doUpload = useCallback(async (file: File, zone: 'clip' | 'file_esportato') => {
    if (!utente) { addToast('❌ Utente non trovato', 'error'); return; }
    if (!driveConnected) {
      addToast('⚠️ Connetti prima Google Drive nelle Impostazioni → Integrazioni', 'warn');
      return;
    }

    setUploadingZone(zone);
    setProgress({ loaded: 0, total: file.size, percent: 2 });

    try {
      const { fileId, fileUrl, fileName } = await uploadFileToZone(
        file, zone, clip, clp, utente.id,
        (p) => setProgress(p)
      );

      setProgress({ loaded: file.size, total: file.size, percent: 99 });

      let patch: Partial<LogRipresa> = {};

      if (zone === 'clip') {
        patch = {
          file_id: fileId,
          file_url: fileUrl,
          file_name: fileName,
          file_size: file.size,
          file_mime_type: file.type || 'video/mp4',
          file_uploaded_at: new Date().toISOString(),
          file_deleted_at: null,
          raw_files_count: (clip.raw_files_count || 0) + 1,
          raw_files_size: (clip.raw_files_size || 0) + file.size,
        };
      } else {
        patch = {
          exported_file_id: fileId,
          exported_file_url: fileUrl,
          exported_file_name: fileName,
          exported_file_size: file.size,
          exported_file_mime_type: file.type || 'video/mp4',
          exported_file_uploaded_at: new Date().toISOString(),
        };
      }

      const { error } = await supabase.from('log_riprese').update(patch).eq('id', clip.id);
      if (error) throw error;

      setProgress({ loaded: file.size, total: file.size, percent: 100 });
      onUpdated(patch);

      const label = zone === 'clip' ? '📁 File grezzo caricato' : '✅ Video esportato caricato';
      addToast(`${label}: ${fileName}`, 'success');
    } catch (err: unknown) {
      console.error('[ClipFileUpload] upload failed:', err);
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
      addToast(`❌ Upload fallito: ${msg.slice(0, 100)}`, 'error');
    } finally {
      setUploadingZone(null);
      setProgress(null);
    }
  }, [clip, clp, onUpdated, addToast, utente, driveConnected]);

  const handleDeleteExport = async () => {
    if (!clip.exported_file_id) return;
    try {
      await invokeEdge('google-drive-delete', {
        method: 'POST',
        body: JSON.stringify({ fileId: clip.exported_file_id, teamId: utente?.id }),
      });
    } catch (err) {
      console.warn('[ClipFileUpload] delete export from Drive failed:', err);
    }
    const patch: Partial<LogRipresa> = {
      exported_file_id: null,
      exported_file_url: null,
      exported_file_name: null,
      exported_file_size: null,
      exported_file_uploaded_at: null,
    };
    await supabase.from('log_riprese').update(patch).eq('id', clip.id);
    onUpdated(patch);
    addToast('🗑️ File esportato rimosso da Google Drive.', 'success');
    setShowDeleteExport(false);
    setShowVideoPlayer(false);
  };

  // ─── ROW variant ──────────────────────────────────────────────────────────
  if (variant === 'row') {
    if (uploadingZone && progress) {
      return (
        <div className="flex items-center gap-1 min-w-[60px]">
          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground">{progress.percent}%</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 relative">
        {/* Exported file indicator — play button */}
        {hasExport && (
          <button
            onClick={() => setShowVideoPlayer(true)}
            title={clip.exported_file_name || 'Anteprima video esportato'}
            className="text-[hsl(var(--clr-green))] hover:opacity-70 text-sm transition-opacity"
          >
            ▶️
          </button>
        )}

        {/* Raw files indicator */}
        {hasRawFile && (
          <span
            title={`${clip.raw_files_count || 1} file grezzo • ${formatBytes(clip.raw_files_size || clip.file_size)}`}
            className="text-muted-foreground text-xs cursor-default"
          >
            📁{clip.raw_files_count ? ` ${clip.raw_files_count}` : ''}
          </span>
        )}

        {rawDeleted && !hasRawFile && !hasExport && (
          <span title="File grezzi rimossi" className="text-muted-foreground/40 text-xs">☁️</span>
        )}

        {/* Upload trigger (if nothing at all) */}
        {!hasExport && !hasRawFile && !rawDeleted && (
          <>
            <input
              ref={rawInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.avi,.mxf,.r3d"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, 'clip'); e.target.value = ''; }}
            />
            <button
              onClick={() => rawInputRef.current?.click()}
              title="Carica file grezzo su Google Drive"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary text-sm transition-all"
            >
              ☁️↑
            </button>
          </>
        )}

        {/* Inline video player modal */}
        {showVideoPlayer && hasExport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setShowVideoPlayer(false)}>
            <div className="absolute inset-0 bg-black/80" />
            <div className="relative bg-card rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-border z-10"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold truncate">{clip.exported_file_name || 'Video esportato'}</p>
                <div className="flex items-center gap-2">
                  <a href={clip.exported_file_url!} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:opacity-80">↗ Drive</a>
                  <button onClick={() => setShowVideoPlayer(false)}
                    className="text-muted-foreground hover:text-foreground text-xl px-1">✕</button>
                </div>
              </div>
              {isVideoMime(clip.exported_file_mime_type) ? (
                <video
                  src={clip.exported_file_url!}
                  controls
                  className="w-full max-h-[70vh]"
                  style={{ background: 'hsl(0 0% 0%)' }}
                  autoPlay={false}
                />
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <div className="text-4xl mb-2">📄</div>
                  <p className="text-sm">{clip.exported_file_name}</p>
                  <a href={clip.exported_file_url!} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-block text-xs text-primary underline">Apri su Google Drive</a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── PANEL variant ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── ZONA 1: Clip da montare ──────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">📁 Clip da montare</span>
          <span className="text-[10px] text-muted-foreground">→ cartella clip/</span>
        </div>

        {uploadingZone === 'clip' && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress.percent < 84 ? 'Caricamento…' : 'Trasferimento su Google Drive…'}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</p>
          </div>
        )}

        {!rawDeleted && uploadingZone !== 'clip' && (
          <>
            {/* Drop zone */}
            <div
              onDragEnter={() => setDraggingZone('clip')}
              onDragLeave={() => setDraggingZone(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                setDraggingZone(null);
                const files = Array.from(e.dataTransfer.files);
                files.forEach(f => doUpload(f, 'clip'));
              }}
              onClick={() => rawInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                draggingZone === 'clip' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
              }`}
            >
              <div className="text-2xl mb-1">📁</div>
              <p className="text-xs font-medium text-foreground">Upload file grezzi (multiplo)</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">MP4, MOV, AVI, MXF, R3D · drag & drop</p>
              <input
                ref={rawInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.avi,.mxf,.r3d"
                multiple
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []);
                  files.forEach(f => doUpload(f, 'clip'));
                  e.target.value = '';
                }}
              />
            </div>

            {/* Current raw file info */}
            {hasRawFile && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 flex items-center gap-3">
                <span className="text-lg">📁</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{clip.file_name}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {clip.file_size && <span>{formatBytes(clip.file_size)}</span>}
                    {clip.raw_files_count && clip.raw_files_count > 1 && (
                      <span>· {clip.raw_files_count} file · {formatBytes(clip.raw_files_size)} totale</span>
                    )}
                    {clip.file_uploaded_at && <span>· Caricato {formatDate(clip.file_uploaded_at)}</span>}
                  </div>
                </div>
                <a
                  href={clip.file_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:opacity-80 flex-shrink-0"
                >
                  ↗ Drive
                </a>
              </div>
            )}
          </>
        )}

        {rawDeleted && (
          <div className="rounded-lg border border-border bg-muted/10 p-3 text-center">
            <p className="text-xs text-muted-foreground">
              ☁️ File grezzi rimossi {clip.file_deleted_at ? `il ${formatDate(clip.file_deleted_at)}` : ''}
              {clip.file_name ? ` — era ${clip.file_name}` : ''}
              {clip.raw_files_size ? ` · ${formatBytes(clip.raw_files_size)} liberati` : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── ZONA 2: File esportato ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">▶️ File esportato</span>
          <span className="text-[10px] text-muted-foreground">→ cartella file_esportato/</span>
        </div>

        {uploadingZone === 'file_esportato' && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress.percent < 84 ? 'Caricamento…' : 'Trasferimento su Google Drive…'}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</p>
          </div>
        )}

        {uploadingZone !== 'file_esportato' && (
          <>
            {hasExport ? (
              <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 space-y-3">
                {/* Video player inline */}
                {isVideoMime(clip.exported_file_mime_type) ? (
                  <video
                    src={clip.exported_file_url!}
                    controls
                    className="w-full rounded-lg max-h-[250px] bg-black"
                    preload="metadata"
                  />
                ) : (
                  <div className="flex items-center gap-3 p-2">
                    <span className="text-2xl">📄</span>
                    <p className="text-xs font-medium text-foreground truncate flex-1">{clip.exported_file_name}</p>
                    <a href={clip.exported_file_url!} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:opacity-80">↗ Drive</a>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">{clip.exported_file_name}</p>
                    <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                      {clip.exported_file_size && <span>{formatBytes(clip.exported_file_size)}</span>}
                      {clip.exported_file_uploaded_at && <span>· Caricato {formatDate(clip.exported_file_uploaded_at)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <a href={clip.exported_file_url!} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium hover:opacity-80">
                      ↗ Drive
                    </a>
                    <button
                      onClick={() => {
                        // Replace export — upload new file
                        expInputRef.current?.click();
                      }}
                      className="px-2 py-1 rounded bg-muted text-muted-foreground text-[10px] font-medium hover:bg-muted/80"
                    >
                      🔄 Sostituisci
                    </button>
                    <button
                      onClick={() => setShowDeleteExport(true)}
                      className="px-2 py-1 rounded bg-destructive/10 text-destructive text-[10px] font-medium hover:opacity-80"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {showDeleteExport && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">Rimuovere il file esportato da Google Drive?</p>
                    <div className="flex gap-2">
                      <button onClick={handleDeleteExport}
                        className="flex-1 py-1 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:opacity-80">
                        Sì, rimuovi
                      </button>
                      <button onClick={() => setShowDeleteExport(false)}
                        className="flex-1 py-1 rounded border border-border text-xs font-medium hover:bg-muted">
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                onDragEnter={() => setDraggingZone('file_esportato')}
                onDragLeave={() => setDraggingZone(null)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  setDraggingZone(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) doUpload(f, 'file_esportato');
                }}
                onClick={() => expInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                  draggingZone === 'file_esportato' ? 'border-green-500 bg-green-500/5' : 'border-border hover:border-green-500/50 hover:bg-muted/40'
                }`}
              >
                <div className="text-2xl mb-1">▶️</div>
                <p className="text-xs font-medium text-foreground">Carica video finale (1 file)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">MP4, MOV · player inline · max 15 GB</p>
              </div>
            )}

            <input
              ref={expInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.avi,.mxf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) {
                  if (hasExport) {
                    if (confirm(`Sostituire il file esportato esistente con "${f.name}"?`)) {
                      doUpload(f, 'file_esportato');
                    }
                  } else {
                    doUpload(f, 'file_esportato');
                  }
                }
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
