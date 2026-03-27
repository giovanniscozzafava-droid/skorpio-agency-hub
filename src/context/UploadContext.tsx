import React, { createContext, useContext, useCallback, useRef, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { LogRipresa, Contenuto } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'completed' | 'failed';

export interface UploadItem {
  id: string;             // unique ID for this upload job
  clipId: string;         // log_riprese.id
  clipCode: string;       // e.g. "C7876"
  clipDisplayId: string;  // e.g. "CLP012"
  clienteNome: string;
  zone: 'clip' | 'file_esportato';
  fileName: string;
  fileSize: number;
  status: UploadStatus;
  percent: number;
  speedBps: number;       // bytes/sec current
  etaSeconds: number;     // estimated seconds remaining
  loadedBytes: number;
  errorMsg?: string;
  completedAt?: number;   // Date.now() when done
}

interface UploadContextType {
  queue: UploadItem[];
  enqueue: (
    files: File[],
    zone: 'clip' | 'file_esportato',
    clip: LogRipresa,
    clp: Contenuto | null | undefined,
    teamId: string,
    onUpdated: (id: string, patch: Partial<LogRipresa>) => void
  ) => void;
  pause: (uploadId: string) => void;
  resume: (uploadId: string) => void;
  cancel: (uploadId: string) => void;
  retry: (uploadId: string) => void;
  clearCompleted: () => void;
  activeCount: number;
  queuedCount: number;
}

const UploadContext = createContext<UploadContextType | null>(null);

// ─── Constants ───────────────────────────────────────────────────────────────

const CHUNK_SIZE    = 4 * 1024 * 1024;  // 4 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_CONCURRENT = 2;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40);
}

function buildRenamedFileName(file: File, clipIdDisplay: string, existingCount: number): string {
  const ext = file.name.split('.').pop() || 'mp4';
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const n = String(existingCount + 1).padStart(2, '0');
  return `${clipIdDisplay}_${n}_${baseName}.${ext}`;
}

async function invokeEdge(path: string, payload: Record<string, unknown> = {}) {
  const url = `${SUPABASE_URL}/functions/v1/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Edge function error ${res.status}`);
  return data;
}

async function sendChunkViaProxy(
  uploadUrl: string,
  chunk: Blob,
  contentRange: string,
  mimeType: string
): Promise<{ status: number; range?: string | null; fileId?: string }> {
  const proxyUrl = `${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'x-upload-url': uploadUrl,
      'x-content-range': contentRange,
      'x-content-type': mimeType,
      'Content-Type': 'application/octet-stream',
    },
    body: chunk,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(errData?.error || `Proxy error ${res.status}`);
  }
  return res.json();
}

// ─── Provider ────────────────────────────────────────────────────────────────

// Internal job: file + metadata needed to execute the upload
interface UploadJob {
  id: string;
  file: File;
  zone: 'clip' | 'file_esportato';
  clip: LogRipresa;
  clp: Contenuto | null | undefined;
  teamId: string;
  onUpdated: (id: string, patch: Partial<LogRipresa>) => void;
  rawCountAtEnqueue: number; // snapshot of clip.raw_files_count at enqueue time
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<UploadItem[]>([]);

  // Refs to avoid stale closures in the upload loop
  const jobsRef = useRef<Map<string, UploadJob>>(new Map());
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const pausedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef<Set<string>>(new Set());
  const triggerLockRef = useRef(false);

  // Derived counts
  const activeCount  = queue.filter(u => u.status === 'uploading').length;
  const queuedCount  = queue.filter(u => u.status === 'queued').length;

  // ── helpers to mutate state ──────────────────────────────────────────────

  const patchItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  // ── core upload logic ────────────────────────────────────────────────────

  const runUpload = useCallback(async (uploadId: string) => {
    const job = jobsRef.current.get(uploadId);
    if (!job) return;

    runningRef.current.add(uploadId);
    patchItem(uploadId, { status: 'uploading', percent: 1 });

    const { file, zone, clip, clp, teamId } = job;
    const mimeType = file.type || 'video/mp4';
    const ext = file.name.split('.').pop() || 'mp4';

    if (file.size > MAX_FILE_SIZE) {
      patchItem(uploadId, { status: 'failed', errorMsg: 'File troppo grande (max 5 GB)' });
      runningRef.current.delete(uploadId);
      triggerNext();
      return;
    }

    let fileName: string;
    if (zone === 'clip') {
      const idDisplay = clp?.id_display || clip.id_contenuto_display || clip.id_clip;
      // Count how many jobs for this clip/zone are before this one in the queue (to avoid collisions)
      const jobsBefore = Array.from(jobsRef.current.values()).filter(
        j => j.clip.id === clip.id && j.zone === 'clip' && j.id !== uploadId
      ).length;
      fileName = buildRenamedFileName(file, idDisplay, (job.rawCountAtEnqueue || 0) + jobsBefore);
    } else {
      const slug = slugify(clip.titolo || clip.id_clip);
      fileName = `${clip.id_clip}_${slug}_export.${ext}`;
    }

    const resumeKey = `skorpio_upload_${clip.id}_${zone}_${fileName}`;
    let uploadUrl = '';
    let startByte = 0;

    // Try to resume
    const savedState = localStorage.getItem(resumeKey);
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        if (state.fileSize === file.size && state.mimeType === mimeType) {
          try {
            const checkResult = await sendChunkViaProxy(state.uploadUrl, new Blob([]), `bytes */${file.size}`, mimeType);
            if (checkResult.status === 308 && checkResult.range) {
              startByte = parseInt(checkResult.range.split('-')[1]) + 1;
              uploadUrl = state.uploadUrl;
            } else {
              localStorage.removeItem(resumeKey);
            }
          } catch {
            localStorage.removeItem(resumeKey);
          }
        } else {
          localStorage.removeItem(resumeKey);
        }
      } catch {
        localStorage.removeItem(resumeKey);
      }
    }

    // Init new session if needed
    if (!uploadUrl) {
      patchItem(uploadId, { percent: 2 });
      try {
        const result = await invokeEdge('google-drive-upload-init', {
          fileName,
          mimeType,
          fileSize: file.size,
          teamId,
          clientName: clip.cliente_nome || 'Generale',
          zone,
          contenutoId: clip.contenuto_id,
          idDisplay: clp?.id_display || clip.id_contenuto_display || '',
          titolo: clp?.titolo || clip.titolo || '',
        });
        uploadUrl = result.uploadUrl;
        startByte = 0;
        localStorage.setItem(resumeKey, JSON.stringify({ uploadUrl, uploadedBytes: 0, fileName, fileSize: file.size, mimeType }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        patchItem(uploadId, { status: 'failed', errorMsg: msg });
        runningRef.current.delete(uploadId);
        triggerNext();
        return;
      }
    }

    // Chunked upload loop
    let uploadedBytes = startByte;
    let lastBytes = startByte;
    let lastTime = Date.now();
    let fileId = '';

    try {
      while (uploadedBytes < file.size) {
        // Check for pause / cancel
        if (pausedRef.current.has(uploadId)) {
          patchItem(uploadId, { status: 'paused', loadedBytes: uploadedBytes });
          runningRef.current.delete(uploadId);
          triggerNext();
          return;
        }

        const end = Math.min(uploadedBytes + CHUNK_SIZE, file.size);
        const chunk = file.slice(uploadedBytes, end);
        const contentRange = `bytes ${uploadedBytes}-${end - 1}/${file.size}`;

        let result: { status: number; range?: string | null; fileId?: string } | null = null;
        let lastErr: Error | null = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          // Check pause/cancel between retries
          if (pausedRef.current.has(uploadId)) break;
          try {
            result = await sendChunkViaProxy(uploadUrl, chunk, contentRange, mimeType);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }

        if (pausedRef.current.has(uploadId)) {
          patchItem(uploadId, { status: 'paused', loadedBytes: uploadedBytes });
          runningRef.current.delete(uploadId);
          triggerNext();
          return;
        }

        if (lastErr || !result) throw lastErr || new Error('Upload chunk fallito');

        if (result.status === 308) {
          uploadedBytes = result.range ? parseInt(result.range.split('-')[1]) + 1 : end;
        } else if (result.status === 200 || result.status === 201) {
          if (!result.fileId) throw new Error('Upload completato ma fileId mancante');
          fileId = result.fileId;
          uploadedBytes = file.size;
        } else {
          throw new Error(`Chunk status inatteso: ${result.status}`);
        }

        // Speed and ETA calculation
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed > 0.5) {
          const speedBps = (uploadedBytes - lastBytes) / elapsed;
          const remaining = file.size - uploadedBytes;
          const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;
          lastBytes = uploadedBytes;
          lastTime = now;
          patchItem(uploadId, {
            percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
            loadedBytes: uploadedBytes,
            speedBps,
            etaSeconds,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      localStorage.removeItem(resumeKey);
      patchItem(uploadId, { status: 'failed', errorMsg: msg.slice(0, 120) });
      runningRef.current.delete(uploadId);
      triggerNext();
      return;
    }

    // Done — save to DB
    localStorage.removeItem(resumeKey);

    const fileUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-download?fileId=${fileId}`;
    let patch: Partial<LogRipresa> = {};

    if (zone === 'clip') {
      const prevCount = clip.raw_files_count || 0;
      const prevSize  = clip.raw_files_size  || 0;
      patch = {
        file_id: fileId,
        file_url: fileUrl,
        file_name: fileName,
        file_size: file.size,
        file_mime_type: mimeType,
        file_uploaded_at: new Date().toISOString(),
        file_deleted_at: null,
        raw_files_count: prevCount + 1,
        raw_files_size:  prevSize  + file.size,
      };
    } else {
      patch = {
        exported_file_id: fileId,
        exported_file_url: fileUrl,
        exported_file_name: fileName,
        exported_file_size: file.size,
        exported_file_mime_type: mimeType,
        exported_file_uploaded_at: new Date().toISOString(),
      };
    }

    try {
      const { error } = await supabase.from('log_riprese').update(patch).eq('id', clip.id);
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchItem(uploadId, { status: 'failed', errorMsg: `DB update fallito: ${msg.slice(0, 80)}` });
      runningRef.current.delete(uploadId);
      triggerNext();
      return;
    }

    job.onUpdated(clip.id, patch);
    patchItem(uploadId, { status: 'completed', percent: 100, loadedBytes: file.size, completedAt: Date.now() });
    runningRef.current.delete(uploadId);
    triggerNext();
  }, [patchItem]);

  // ── trigger next queued item ─────────────────────────────────────────────

  const triggerNext = useCallback(() => {
    // Use functional state update to get latest queue
    setQueue(prev => {
      const running = runningRef.current.size;
      if (running >= MAX_CONCURRENT) return prev;
      const slots = MAX_CONCURRENT - running;
      let started = 0;
      for (const item of prev) {
        if (started >= slots) break;
        if (item.status === 'queued' && !runningRef.current.has(item.id) && !pausedRef.current.has(item.id)) {
          runningRef.current.add(item.id);
          // Launch async (no await in setQueue)
          setTimeout(() => runUpload(item.id), 0);
          started++;
        }
      }
      return prev;
    });
  }, [runUpload]);

  // ── public API ───────────────────────────────────────────────────────────

  const enqueue = useCallback((
    files: File[],
    zone: 'clip' | 'file_esportato',
    clip: LogRipresa,
    clp: Contenuto | null | undefined,
    teamId: string,
    onUpdated: (id: string, patch: Partial<LogRipresa>) => void
  ) => {
    const rawCountAtEnqueue = clip.raw_files_count || 0;

    const newItems: UploadItem[] = files.map(file => ({
      id: uid(),
      clipId: clip.id,
      clipCode: clip.id_clip,
      clipDisplayId: clp?.id_display || clip.id_contenuto_display || '',
      clienteNome: clip.cliente_nome || '',
      zone,
      fileName: file.name,
      fileSize: file.size,
      status: 'queued',
      percent: 0,
      speedBps: 0,
      etaSeconds: 0,
      loadedBytes: 0,
    }));

    // Register jobs
    files.forEach((file, i) => {
      jobsRef.current.set(newItems[i].id, {
        id: newItems[i].id,
        file,
        zone,
        clip,
        clp,
        teamId,
        onUpdated,
        rawCountAtEnqueue,
      });
    });

    setQueue(prev => {
      const updated = [...prev, ...newItems];
      return updated;
    });

    // Trigger immediately after state update
    setTimeout(() => triggerNext(), 50);
  }, [triggerNext]);

  const pause = useCallback((uploadId: string) => {
    pausedRef.current.add(uploadId);
    // If not currently running, mark immediately
    if (!runningRef.current.has(uploadId)) {
      patchItem(uploadId, { status: 'paused' });
    }
  }, [patchItem]);

  const resume = useCallback((uploadId: string) => {
    pausedRef.current.delete(uploadId);
    patchItem(uploadId, { status: 'queued' });
    setTimeout(() => triggerNext(), 50);
  }, [patchItem, triggerNext]);

  const cancel = useCallback((uploadId: string) => {
    pausedRef.current.delete(uploadId);
    abortRef.current.get(uploadId)?.abort();
    abortRef.current.delete(uploadId);
    runningRef.current.delete(uploadId);
    jobsRef.current.delete(uploadId);
    setQueue(prev => prev.filter(u => u.id !== uploadId));
    setTimeout(() => triggerNext(), 50);
  }, [triggerNext]);

  const retry = useCallback((uploadId: string) => {
    pausedRef.current.delete(uploadId);
    patchItem(uploadId, { status: 'queued', percent: 0, loadedBytes: 0, errorMsg: undefined, speedBps: 0, etaSeconds: 0 });
    setTimeout(() => triggerNext(), 50);
  }, [patchItem, triggerNext]);

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(u => u.status !== 'completed'));
  }, []);

  // Clean up very old completed items (>5 min)
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setQueue(prev => prev.filter(u => {
        if (u.status === 'completed' && u.completedAt && now - u.completedAt > 5 * 60 * 1000) return false;
        return true;
      }));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <UploadContext.Provider value={{ queue, enqueue, pause, resume, cancel, retry, clearCompleted, activeCount, queuedCount }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be inside UploadProvider');
  return ctx;
}
