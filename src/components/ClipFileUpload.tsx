import React, { useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { LogRipresa } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface ClipFileUploadProps {
  clip: LogRipresa;
  onUpdated: (patch: Partial<LogRipresa>) => void;
  variant?: 'row' | 'panel';
}

interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric'
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

export function ClipFileUpload({ clip, onUpdated, variant = 'row' }: ClipFileUploadProps) {
  const { addToast } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [retryFile, setRetryFile] = useState<File | null>(null);

  const hasFile = !!(clip.file_id && !clip.file_deleted_at);
  const wasDeleted = !!(clip.file_deleted_at);

  const doUpload = useCallback(async (file: File) => {
    setUploading(true);
    setProgress({ loaded: 0, total: file.size, percent: 5 });
    setRetryFile(null);

    try {
      const ext = file.name.split('.').pop() || 'mp4';
      const slug = slugify(clip.titolo || clip.id_clip);
      const fileName = `${clip.id_clip}_${slug}.${ext}`;
      const percorso = `SKORPIO_Clip/${clip.cliente_nome || 'Generale'}`;

      const fd = new FormData();
      fd.append('file', file);
      fd.append('percorso', percorso);
      fd.append('contenuto_id', clip.contenuto_id || '');
      fd.append('nome_file', fileName);

      setProgress({ loaded: 0, total: file.size, percent: 20 });

      const res = await fetch(`${SUPABASE_URL}/functions/v1/aruba-webdav-upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: fd,
      });

      setProgress({ loaded: file.size * 0.9, total: file.size, percent: 90 });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload fallito');

      const fileUrl = data.url as string;
      const fileId = fileUrl; // su Aruba usiamo l'URL come ID univoco

      const patch: Partial<LogRipresa> = {
        file_id: fileId,
        file_url: fileUrl,
        file_name: fileName,
        file_size: file.size,
        file_mime_type: file.type || 'video/mp4',
        file_uploaded_at: new Date().toISOString(),
        file_deleted_at: null,
      };

      const { error } = await supabase
        .from('log_riprese')
        .update(patch)
        .eq('id', clip.id);

      if (error) throw error;

      setProgress({ loaded: file.size, total: file.size, percent: 100 });
      onUpdated(patch);
      addToast(`✅ "${fileName}" caricato su Aruba Drive`, 'success');
    } catch (err: unknown) {
      console.error('[ClipFileUpload] upload failed:', err);
      setRetryFile(file);
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
      addToast(`❌ Upload fallito: ${msg.slice(0, 80)}`, 'error');
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, [clip, onUpdated, addToast]);

  const handleFile = useCallback((file: File) => {
    const maxSize = 4 * 1024 * 1024 * 1024; // 4GB
    if (file.size > maxSize) {
      addToast('❌ File troppo grande (max 4 GB)', 'error');
      return;
    }
    doUpload(file);
  }, [doUpload, addToast]);

  async function handleDeleteFile() {
    if (!clip.file_id) return;

    const patch: Partial<LogRipresa> = {
      file_id: null,
      file_url: null,
      file_deleted_at: new Date().toISOString(),
    };

    await supabase.from('log_riprese').update(patch).eq('id', clip.id);
    onUpdated(patch);
    addToast('🗑️ File rimosso. Metadati conservati come riferimento.', 'success');
    setShowDeleteConfirm(false);
  }

  // ─── ROW variant ─────────────────────────────────────────────────────────
  if (variant === 'row') {
    if (uploading && progress) {
      return (
        <div className="flex items-center gap-1 min-w-[60px]">
          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{progress.percent}%</span>
        </div>
      );
    }

    if (wasDeleted) {
      return (
        <span
          title={`File rimosso il ${formatDate(clip.file_deleted_at!)}${clip.file_name ? ` — ${clip.file_name}` : ''} — archiviato su Aruba`}
          className="text-muted-foreground/40 cursor-help text-base"
        >
          ☁️
        </span>
      );
    }

    if (hasFile) {
      return (
        <div className="flex items-center gap-1 relative">
          <a
            href={clip.file_url!}
            target="_blank"
            rel="noopener noreferrer"
            title={clip.file_name || 'Apri file'}
            className="text-primary hover:opacity-70 text-sm transition-opacity"
          >
            🎬
          </a>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Rimuovi file"
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-xs transition-all"
          >
            🗑️
          </button>
          {showDeleteConfirm && (
            <div className="absolute z-50 bg-card border border-border rounded-lg shadow-xl p-3 text-xs w-44 top-6 left-0">
              <p className="text-foreground font-medium mb-2">Rimuovere il file?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteFile}
                  className="flex-1 py-1 rounded bg-destructive text-destructive-foreground font-semibold hover:opacity-80"
                >Sì</button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-1 rounded border border-border hover:bg-muted"
                >No</button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*,.mp4,.mov,.avi,.mp3,.wav,.mxf,.r3d"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        {retryFile ? (
          <button
            onClick={() => doUpload(retryFile)}
            title="Riprova upload"
            className="text-amber-500 hover:opacity-70 text-sm transition-opacity"
          >
            🔄
          </button>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Carica file su Aruba Drive"
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary text-sm transition-all"
          >
            ☁️↑
          </button>
        )}
      </>
    );
  }

  // ─── PANEL variant ────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {uploading && progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Caricamento su Aruba Drive…</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
          </p>
        </div>
      )}

      {!uploading && !hasFile && !wasDeleted && (
        <div
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
        >
          <div className="text-3xl mb-2">☁️</div>
          <p className="text-sm font-medium text-foreground">Trascina un file video qui</p>
          <p className="text-xs text-muted-foreground mt-1">o clicca per selezionare · MP4, MOV, AVI, MXF · max 4 GB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.mp4,.mov,.avi,.mp3,.wav,.mxf,.r3d"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {!uploading && retryFile && (
        <button
          onClick={() => doUpload(retryFile)}
          className="w-full py-2 rounded-lg border border-amber-500/50 text-amber-600 text-sm font-medium hover:bg-amber-50 transition-colors"
        >
          🔄 Riprova upload — {retryFile.name}
        </button>
      )}

      {hasFile && !uploading && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          {/* Video preview — solo se URL diretto (non drive.google.com) */}
          {clip.file_url && (clip.file_mime_type?.startsWith('video/') || clip.file_name?.match(/\.(mp4|mov|avi|webm)$/i)) && (
            <div className="rounded-lg overflow-hidden bg-black aspect-video">
              <video
                src={clip.file_url}
                controls
                className="w-full h-full object-contain"
                preload="metadata"
              >
                Il tuo browser non supporta il video inline.
              </video>
            </div>
          )}

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate" title={clip.file_name || ''}>
                🎬 {clip.file_name || 'File'}
              </p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {clip.file_size && <span>{formatBytes(clip.file_size)}</span>}
                {clip.file_uploaded_at && <span>Caricato {formatDate(clip.file_uploaded_at)}</span>}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <a
                href={clip.file_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:opacity-80 transition-opacity"
              >
                ↗ Apri
              </a>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:opacity-80 transition-opacity"
              >
                🗑️ Rimuovi
              </button>
            </div>
          </div>

          {showDeleteConfirm && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">
                Rimuovere il file da Aruba Drive?
              </p>
              <p className="text-xs text-muted-foreground">
                Il nome e la dimensione verranno conservati come riferimento storico.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteFile}
                  className="flex-1 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:opacity-80"
                >
                  Sì, rimuovi
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {wasDeleted && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 text-center space-y-1">
          <div className="text-2xl text-muted-foreground/40">☁️</div>
          <p className="text-xs text-muted-foreground font-medium">
            File rimosso il {formatDate(clip.file_deleted_at!)} — archiviato localmente
          </p>
          {clip.file_name && (
            <p className="text-xs text-muted-foreground">{clip.file_name}{clip.file_size ? ` · ${formatBytes(clip.file_size)}` : ''}</p>
          )}
        </div>
      )}
    </div>
  );
}
