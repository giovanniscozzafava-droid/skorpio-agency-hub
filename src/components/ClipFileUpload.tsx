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
  fileName?: string;
}

export interface ClipFileUploadProps {
  clip: LogRipresa;
  clp?: Contenuto | null;
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

// ─── Compute auto-renamed filename for clip/ zone ─────────────────────────────
// {CLP_ID}_{N:02d}_{originalName}.ext
function buildRenamedFileName(
  file: File,
  clipIdDisplay: string, // e.g. CLP012
  existingCount: number  // how many raw files already exist
): string {
  const ext = file.name.split('.').pop() || 'mp4';
  const baseName = file.name.replace(/\.[^/.]+$/, ''); // without ext
  const n = String(existingCount + 1).padStart(2, '0');
  return `${clipIdDisplay}_${n}_${baseName}.${ext}`;
}

// ─── Core upload logic — chunked direct to Google Drive ───────────────────────
// Max 5 GB, chunk size 5 MB, retry 3x con backoff esponenziale.
// Resume support via localStorage.

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

function getResumeKey(clipId: string, zone: string, fileName: string) {
  return `skorpio_upload_${clipId}_${zone}_${fileName}`;
}

interface ResumeState {
  uploadUrl: string;
  uploadedBytes: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

async function uploadChunkedToDrive(
  uploadUrl: string,
  file: File,
  mimeType: string,
  startByte: number,
  onProgress: (p: UploadProgress) => void
): Promise<string> {
  let uploadedBytes = startByte;

  while (uploadedBytes < file.size) {
    const end = Math.min(uploadedBytes + CHUNK_SIZE, file.size);
    const chunk = file.slice(uploadedBytes, end);

    let res: Response | null = null;
    let lastErr: Error | null = null;

    // Retry up to 3 volte con backoff esponenziale
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${uploadedBytes}-${end - 1}/${file.size}`,
            'Content-Type': mimeType,
          },
          body: chunk,
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }

    if (lastErr || !res) throw lastErr || new Error('Upload chunk fallito dopo 3 tentativi');

    if (res.status === 308) {
      // Incomplete — continua
      const range = res.headers.get('Range');
      uploadedBytes = range ? parseInt(range.split('-')[1]) + 1 : end;
    } else if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      onProgress({ loaded: file.size, total: file.size, percent: 100, fileName: file.name });
      return data.id as string;
    } else {
      const body = await res.text().catch(() => '');
      throw new Error(`Chunk upload error ${res.status}: ${body.slice(0, 200)}`);
    }

    onProgress({
      loaded: uploadedBytes,
      total: file.size,
      percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
      fileName: file.name,
    });
  }

  throw new Error('Upload terminato senza conferma da Google Drive');
}

async function uploadFileToZone(
  file: File,
  zone: 'clip' | 'file_esportato',
  clip: LogRipresa,
  clp: Contenuto | null | undefined,
  userId: string,
  onProgress: (p: UploadProgress) => void
): Promise<{ fileId: string; fileUrl: string; fileName: string }> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File troppo grande. Il limite è 5 GB.');
  }

  const ext      = file.name.split('.').pop() || 'mp4';
  const mimeType = file.type || 'video/mp4';

  let fileName: string;
  if (zone === 'clip') {
    const idDisplay = clp?.id_display || clip.id_contenuto_display || clip.id_clip;
    fileName = buildRenamedFileName(file, idDisplay, clip.raw_files_count || 0);
  } else {
    const slug = slugify(clip.titolo || clip.id_clip);
    fileName = `${clip.id_clip}_${slug}_export.${ext}`;
  }

  const resumeKey = getResumeKey(clip.id, zone, fileName);
  let uploadUrl: string;
  let startByte = 0;

  // Controlla se c'è uno stato di resume in localStorage
  const savedState = localStorage.getItem(resumeKey);
  if (savedState) {
    try {
      const state: ResumeState = JSON.parse(savedState);
      if (state.fileSize === file.size && state.mimeType === mimeType) {
        // Verifica quanti byte Google ha già ricevuto
        const checkRes = await fetch(state.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes */${file.size}`, 'Content-Type': mimeType },
        });
        if (checkRes.status === 308) {
          const range = checkRes.headers.get('Range');
          startByte = range ? parseInt(range.split('-')[1]) + 1 : 0;
          uploadUrl = state.uploadUrl;
        } else {
          localStorage.removeItem(resumeKey);
          uploadUrl = '';
        }
      } else {
        localStorage.removeItem(resumeKey);
        uploadUrl = '';
      }
    } catch {
      localStorage.removeItem(resumeKey);
      uploadUrl = '';
    }
  } else {
    uploadUrl = '';
  }

  // Se non abbiamo un URI valido, ne creiamo uno nuovo
  if (!uploadUrl) {
    onProgress({ loaded: 0, total: file.size, percent: 1, fileName: file.name });

    const result = await invokeEdge('google-drive-upload-init', {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        mimeType,
        fileSize: file.size,
        teamId: userId,
        clientName: clip.cliente_nome || 'Generale',
        zone,
        contenutoId: clip.contenuto_id,
        idDisplay: clp?.id_display || clip.id_contenuto_display || '',
        titolo: clp?.titolo || clip.titolo || '',
      }),
    });

    uploadUrl = result.uploadUrl;
    startByte = 0;

    // Salva stato per eventuale resume
    const state: ResumeState = { uploadUrl, uploadedBytes: 0, fileName, fileSize: file.size, mimeType };
    localStorage.setItem(resumeKey, JSON.stringify(state));
  }

  // Upload chunked diretto verso Google Drive
  const fileId = await uploadChunkedToDrive(uploadUrl, file, mimeType, startByte, onProgress);

  // Pulizia localStorage
  localStorage.removeItem(resumeKey);

  const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;
  return { fileId, fileUrl, fileName };
}

// ─── FileStatusDot: visual indicator ─────────────────────────────────────────

export function FileStatusDot({ clip, clp }: { clip: LogRipresa; clp: Contenuto | null | undefined }) {
  const hasExport = !!(clip.exported_file_id && clip.exported_file_url);
  const hasRaw = !!(clip.file_id && !clip.file_deleted_at) || (clip.raw_files_count || 0) > 0;
  const fase = clp?.fase || '';
  const latePhases = ['Montato', 'Revisione', 'Programmato', 'Pubblicato'];

  if (hasExport) {
    return (
      <span
        title="File esportato presente — pronto"
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: 'hsl(var(--clr-green))' }}
      />
    );
  }
  if (latePhases.includes(fase) && !hasExport) {
    return (
      <span
        title={`⚠️ Fase ${fase} ma nessun file esportato`}
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: 'hsl(var(--clr-red))' }}
      />
    );
  }
  if (hasRaw) {
    return (
      <span
        title="File grezzi presenti — in attesa montaggio"
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: 'hsl(var(--clr-amber))' }}
      />
    );
  }
  return (
    <span
      title="Nessun file"
      className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-muted-foreground/30"
    />
  );
}

// ─── FileInfoPopover: popover con lista file ──────────────────────────────────

interface FileInfoPopoverProps {
  clip: LogRipresa;
  clp: Contenuto | null | undefined;
  onDeleteRaw: () => void;
  onOpenUpload: () => void;
  onUpdated: (patch: Partial<LogRipresa>) => void;
}

function FileInfoPopover({ clip, clp, onDeleteRaw, onOpenUpload, onUpdated }: FileInfoPopoverProps) {
  const { utente, addToast } = useApp();
  const [show, setShow] = useState(false);
  const [deletingExport, setDeletingExport] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const hasExport = !!(clip.exported_file_id && clip.exported_file_url);
  const hasRaw = !!(clip.file_id && !clip.file_deleted_at) || (clip.raw_files_count || 0) > 0;
  const rawCount = clip.raw_files_count || (clip.file_id && !clip.file_deleted_at ? 1 : 0);
  const rawSize = clip.raw_files_size || clip.file_size || 0;

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    }
    if (show) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  const handleDeleteExport = async () => {
    if (!clip.exported_file_id) return;
    setDeletingExport(true);
    try {
      await invokeEdge('google-drive-delete', {
        method: 'POST',
        body: JSON.stringify({ fileId: clip.exported_file_id, teamId: utente?.id }),
      });
    } catch (err) {
      console.warn('[FileInfoPopover] delete export failed:', err);
    }
    const patch: Partial<LogRipresa> = {
      exported_file_id: null, exported_file_url: null,
      exported_file_name: null, exported_file_size: null,
      exported_file_uploaded_at: null, exported_file_mime_type: null,
    };
    await supabase.from('log_riprese').update(patch).eq('id', clip.id);
    onUpdated(patch);
    addToast('🗑️ File esportato rimosso.', 'success');
    setDeletingExport(false);
    setShow(false);
  };

  if (!hasRaw && !hasExport) {
    // Empty state — show upload trigger
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onOpenUpload(); }}
        title="Carica file"
        className="opacity-40 group-hover:opacity-100 text-muted-foreground hover:text-primary text-sm transition-all"
      >
        ☁️↑
      </button>
    );
  }

  // Build display label
  const parts: string[] = [];
  if (rawCount > 0) parts.push(`📁 ${rawCount} clip${rawSize > 0 ? ` (${formatBytes(rawSize)})` : ''}`);
  if (hasExport) parts.push(`▶️ Esportato${clip.exported_file_size ? ` (${formatBytes(clip.exported_file_size)})` : ''}`);
  const label = parts.join(' | ');

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setShow(v => !v)}
        className="text-xs text-foreground hover:text-primary transition-colors whitespace-nowrap leading-tight text-left"
        title="Vedi dettagli file"
      >
        {label}
      </button>

      {show && (
        <div
          className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-2xl z-[200] overflow-hidden"
          style={{ minWidth: 260 }}
        >
          {/* Raw files */}
          {(hasRaw || clip.file_deleted_at) && (
            <div className="border-b border-border/60">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  📁 Clip da montare
                </span>
                {rawCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{rawCount} file · {formatBytes(rawSize)}</span>
                )}
              </div>

              {clip.file_id && !clip.file_deleted_at ? (
                <div className="px-3 pb-2 space-y-1">
                  <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5">
                    <span className="text-sm">🎬</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate text-foreground">{clip.file_name || 'file.mp4'}</p>
                      <div className="flex gap-2 text-[10px] text-muted-foreground">
                        {clip.file_size && <span>{formatBytes(clip.file_size)}</span>}
                        {clip.file_uploaded_at && <span>· {formatDate(clip.file_uploaded_at)}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {clip.file_url && (
                        <a href={clip.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:opacity-80">
                          ↗
                        </a>
                      )}
                      <button
                        onClick={onDeleteRaw}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:opacity-80"
                        title="Elimina file grezzo"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  {(clip.raw_files_count || 0) > 1 && (
                    <p className="text-[10px] text-muted-foreground px-1">
                      + altri {(clip.raw_files_count || 1) - 1} file nella cartella clip/
                    </p>
                  )}
                </div>
              ) : clip.file_deleted_at ? (
                <p className="px-3 pb-2 text-[10px] text-muted-foreground/60">
                  ☁️ File rimossi il {formatDate(clip.file_deleted_at)}
                </p>
              ) : (
                <p className="px-3 pb-2 text-[10px] text-muted-foreground">Nessun file grezzo</p>
              )}

              {/* Always show add more button */}
              <button
                onClick={() => { onOpenUpload(); setShow(false); }}
                className="w-full px-3 pb-2 text-[10px] text-primary hover:underline text-left flex items-center gap-1"
              >
                ＋ Aggiungi altri file grezzi
              </button>
            </div>
          )}

          {/* Exported file */}
          <div className="px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">▶️ File esportato</span>
            {hasExport ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-[hsl(var(--clr-green)/0.08)] border border-[hsl(var(--clr-green)/0.2)] px-2 py-1.5">
                <span className="text-sm">🎬</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate text-foreground">{clip.exported_file_name || 'export.mp4'}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    {clip.exported_file_size && <span>{formatBytes(clip.exported_file_size)}</span>}
                    {clip.exported_file_uploaded_at && <span>· {formatDate(clip.exported_file_uploaded_at)}</span>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {clip.exported_file_url && (
                    <a href={clip.exported_file_url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:opacity-80">
                      ↗
                    </a>
                  )}
                  <button
                    onClick={handleDeleteExport}
                    disabled={deletingExport}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:opacity-80 disabled:opacity-40"
                    title="Rimuovi file esportato"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">Nessun file esportato</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ClipFileUpload({ clip, clp, onUpdated, variant = 'row' }: ClipFileUploadProps) {
  const { addToast, utente } = useApp();
  const rawInputRef  = useRef<HTMLInputElement>(null);
  const expInputRef  = useRef<HTMLInputElement>(null);

  const [uploadingZone, setUploadingZone] = useState<'clip' | 'file_esportato' | null>(null);
  const [uploadQueue, setUploadQueue] = useState<{ name: string; done: boolean }[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [draggingZone, setDraggingZone] = useState<'clip' | 'file_esportato' | null>(null);
  const [showDeleteExport, setShowDeleteExport] = useState(false);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  // We keep a local mutable ref for raw_files_count to handle sequential uploads
  const localRawCount = useRef(clip.raw_files_count || 0);
  const localRawSize  = useRef(clip.raw_files_size  || 0);

  const hasExport  = !!(clip.exported_file_id && clip.exported_file_url);
  const hasRawFile = !!(clip.file_id && !clip.file_deleted_at) || (clip.raw_files_count || 0) > 0;
  const driveConnected = !!(utente as any)?.google_drive_connected;

  // Update local refs when clip changes externally
  React.useEffect(() => {
    localRawCount.current = clip.raw_files_count || 0;
    localRawSize.current  = clip.raw_files_size  || 0;
  }, [clip.raw_files_count, clip.raw_files_size]);

  const doUpload = useCallback(async (file: File, zone: 'clip' | 'file_esportato') => {
    if (!utente) { addToast('❌ Utente non trovato', 'error'); return; }
    if (!driveConnected) {
      addToast('⚠️ Connetti prima Google Drive nelle Impostazioni → Integrazioni', 'warn');
      return;
    }

    setUploadingZone(zone);
    setProgress({ loaded: 0, total: file.size, percent: 2, fileName: file.name });

    try {
      const { fileId, fileUrl, fileName } = await uploadFileToZone(
        file, zone, clip, clp, utente.id,
        (p) => setProgress(p)
      );

      setProgress({ loaded: file.size, total: file.size, percent: 99, fileName: file.name });

      let patch: Partial<LogRipresa> = {};

      if (zone === 'clip') {
        localRawCount.current += 1;
        localRawSize.current  += file.size;
        patch = {
          file_id: fileId,
          file_url: fileUrl,
          file_name: fileName,
          file_size: file.size,
          file_mime_type: file.type || 'video/mp4',
          file_uploaded_at: new Date().toISOString(),
          file_deleted_at: null,
          raw_files_count: localRawCount.current,
          raw_files_size: localRawSize.current,
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

      setProgress({ loaded: file.size, total: file.size, percent: 100, fileName: file.name });
      onUpdated(patch);

      const label = zone === 'clip' ? `📁 Grezzo caricato (${localRawCount.current} tot.)` : '✅ Video esportato caricato';
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

  // Sequential multi-file upload
  const doMultiUpload = useCallback(async (files: File[], zone: 'clip' | 'file_esportato') => {
    setUploadQueue(files.map(f => ({ name: f.name, done: false })));
    for (let i = 0; i < files.length; i++) {
      await doUpload(files[i], zone);
      setUploadQueue(q => q.map((item, idx) => idx === i ? { ...item, done: true } : item));
    }
    setUploadQueue([]);
  }, [doUpload]);

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
      exported_file_id: null, exported_file_url: null,
      exported_file_name: null, exported_file_size: null,
      exported_file_mime_type: null, exported_file_uploaded_at: null,
    };
    await supabase.from('log_riprese').update(patch).eq('id', clip.id);
    onUpdated(patch);
    addToast('🗑️ File esportato rimosso da Google Drive.', 'success');
    setShowDeleteExport(false);
    setShowVideoPlayer(false);
  };

  const handleDeleteRawSingle = async () => {
    if (!clip.file_id) return;
    if (!confirm(`Rimuovere il file grezzo "${clip.file_name}" da Google Drive?`)) return;
    try {
      await invokeEdge('google-drive-delete', {
        method: 'POST',
        body: JSON.stringify({ fileId: clip.file_id, teamId: utente?.id }),
      });
    } catch (err) {
      console.warn('[ClipFileUpload] delete raw failed:', err);
    }
    const newCount = Math.max(0, (clip.raw_files_count || 1) - 1);
    const newSize  = Math.max(0, (clip.raw_files_size  || clip.file_size || 0) - (clip.file_size || 0));
    const patch: Partial<LogRipresa> = {
      file_id: null, file_url: null, file_name: null,
      file_size: null, file_mime_type: null,
      raw_files_count: newCount,
      raw_files_size: newCount > 0 ? newSize : 0,
    };
    await supabase.from('log_riprese').update(patch).eq('id', clip.id);
    onUpdated(patch);
    addToast('🗑️ File grezzo rimosso.', 'success');
  };

  // Listen for row-drop-upload events dispatched from the table
  React.useEffect(() => {
    if (variant !== 'row') return;
    function handler(e: Event) {
      const { files, zone, clipId } = (e as CustomEvent).detail;
      if (clipId !== clip.id) return;
      doMultiUpload(files, zone);
    }
    window.addEventListener('row-drop-upload', handler);
    return () => window.removeEventListener('row-drop-upload', handler);
  }, [variant, clip.id, doMultiUpload]);

  // ─── ROW variant ──────────────────────────────────────────────────────────
  if (variant === 'row') {
    if (uploadingZone && progress) {
      return (
        <div className="flex items-center gap-1 min-w-[80px]">
          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden flex-shrink-0">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground">{progress.percent}%</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5 relative">
        {/* Status dot */}
        <FileStatusDot clip={clip} clp={clp} />

        {/* File info popover / upload trigger */}
        <FileInfoPopover
          clip={clip}
          clp={clp}
          onDeleteRaw={handleDeleteRawSingle}
          onOpenUpload={() => rawInputRef.current?.click()}
          onUpdated={onUpdated}
        />

        {/* Play button for exported video */}
        {hasExport && (
          <button
            onClick={() => setShowVideoPlayer(true)}
            title="Anteprima video esportato"
            className="text-[hsl(var(--clr-green))] hover:opacity-70 text-sm transition-opacity flex-shrink-0"
          >
            ▶️
          </button>
        )}

        {/* Hidden inputs */}
        <input
          ref={rawInputRef}
          type="file"
          accept="video/*,.mp4,.mov,.avi,.mxf,.r3d"
          multiple
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) doMultiUpload(files, 'clip');
            e.target.value = '';
          }}
        />
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

        {/* Inline video player modal */}
        {showVideoPlayer && hasExport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={() => setShowVideoPlayer(false)}>
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
          {(clip.raw_files_count || 0) > 0 && (
            <span className="text-[10px] font-semibold text-[hsl(var(--clr-amber))] ml-auto">
              {clip.raw_files_count} file · {formatBytes(clip.raw_files_size)}
            </span>
          )}
        </div>

        {uploadingZone === 'clip' && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[200px]">
                {progress.percent < 84
                  ? `Caricamento ${progress.fileName || ''}…`
                  : 'Trasferimento su Google Drive…'}
              </span>
              <span className="flex-shrink-0">{progress.percent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</p>
            {uploadQueue.length > 1 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {uploadQueue.map((q, i) => (
                  <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    q.done
                      ? 'bg-[hsl(var(--clr-green)/0.1)] text-[hsl(var(--clr-green))] border-[hsl(var(--clr-green)/0.3)]'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}>
                    {q.done ? '✓' : '○'} {q.name.slice(0, 20)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload zone — ALWAYS visible (additive) */}
        {uploadingZone !== 'clip' && (
          <>
            <div
              onDragEnter={() => setDraggingZone('clip')}
              onDragLeave={() => setDraggingZone(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                setDraggingZone(null);
                const files = Array.from(e.dataTransfer.files).filter(f =>
                  f.type.startsWith('video/') || /\.(mp4|mov|avi|mxf|r3d)$/i.test(f.name)
                );
                if (files.length > 0) doMultiUpload(files, 'clip');
              }}
              onClick={() => rawInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                draggingZone === 'clip'
                  ? 'border-primary bg-primary/5'
                  : hasRawFile
                    ? 'border-border/50 hover:border-primary/50 hover:bg-muted/30 py-2.5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/40'
              }`}
            >
              <div className={hasRawFile ? 'text-lg mb-0.5' : 'text-2xl mb-1'}>
                {draggingZone === 'clip' ? '📂' : '📁'}
              </div>
              <p className="text-xs font-medium text-foreground">
                {hasRawFile ? 'Aggiungi altri file grezzi' : 'Upload file grezzi (multiplo)'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">MP4, MOV, AVI, MXF, R3D · drag & drop · rinominati automaticamente</p>
              <input
                ref={rawInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.avi,.mxf,.r3d"
                multiple
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) doMultiUpload(files, 'clip');
                  e.target.value = '';
                }}
              />
            </div>

            {/* Current raw file info */}
            {clip.file_id && !clip.file_deleted_at && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 flex items-center gap-3">
                <span className="text-lg">📁</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{clip.file_name}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {clip.file_size && <span>{formatBytes(clip.file_size)}</span>}
                    {(clip.raw_files_count || 0) > 1 && (
                      <span>· {clip.raw_files_count} file totali · {formatBytes(clip.raw_files_size)}</span>
                    )}
                    {clip.file_uploaded_at && <span>· Caricato {formatDate(clip.file_uploaded_at)}</span>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {clip.file_url && (
                    <a href={clip.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:opacity-80 flex-shrink-0">
                      ↗ Drive
                    </a>
                  )}
                  <button
                    onClick={handleDeleteRawSingle}
                    className="text-xs text-destructive/70 hover:text-destructive flex-shrink-0"
                    title="Rimuovi file grezzo"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Deleted state — still show upload zone (handled above) */}
        {clip.file_deleted_at && !clip.file_id && (
          <div className="rounded-lg border border-border bg-muted/10 p-2.5 text-center">
            <p className="text-xs text-muted-foreground/60">
              ☁️ File grezzi rimossi {clip.file_deleted_at ? `il ${formatDate(clip.file_deleted_at)}` : ''}
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
              <span>{progress.percent < 84 ? `Caricamento ${progress.fileName || ''}…` : 'Trasferimento su Google Drive…'}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-[hsl(var(--clr-green))] transition-all duration-300"
                style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</p>
          </div>
        )}

        {uploadingZone !== 'file_esportato' && (
          <>
            {hasExport ? (
              <div className="rounded-xl border p-3 space-y-3"
                style={{ borderColor: 'hsl(var(--clr-green) / 0.3)', background: 'hsl(var(--clr-green) / 0.05)' }}>
                {isVideoMime(clip.exported_file_mime_type) ? (
                  <video
                    src={clip.exported_file_url!}
                    controls
                    className="w-full rounded-lg max-h-[250px]"
                    style={{ background: 'hsl(0 0% 0%)' }}
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
                      onClick={() => expInputRef.current?.click()}
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
                    <p className="text-[10px] text-muted-foreground">Le cartelle Drive restano intatte — solo il file viene rimosso.</p>
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
                  draggingZone === 'file_esportato'
                    ? 'border-[hsl(var(--clr-green))] bg-[hsl(var(--clr-green)/0.05)]'
                    : 'border-border hover:border-[hsl(var(--clr-green)/0.5)] hover:bg-muted/40'
                }`}
              >
                <div className="text-2xl mb-1">▶️</div>
                <p className="text-xs font-medium text-foreground">Carica video finale (1 file)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">MP4, MOV · player inline · max 5 GB</p>
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
