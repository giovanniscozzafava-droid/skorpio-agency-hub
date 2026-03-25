import React, { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Tipi di file accettati per upload verso Aruba Drive
const ACCEPT_VIDEO = 'video/*,audio/*,.mp3,.mp4,.mov,.avi,.mkv,.mxf,.r3d,.braw';
const ACCEPT_ALL = `${ACCEPT_VIDEO},.pdf,.zip,.psd,.ai,.png,.jpg,.jpeg`;

export interface ArubaUploadProps {
  /** Percorso cartella su Aruba (es: "Cliente/Reel/Titolo") */
  percorso?: string;
  contenutoId?: string;
  /** 'icon' → solo icona paperclip, 'button' → bottone testo */
  variant?: 'icon' | 'button';
  onUploaded?: (url: string, nomeFile: string) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
}

export function ArubaUpload({
  percorso = '',
  contenutoId = '',
  variant = 'button',
  onUploaded,
  accept = ACCEPT_ALL,
  label = '☁️ Carica su Aruba',
  disabled = false,
}: ArubaUploadProps) {
  const { addToast } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input per permettere ri-upload dello stesso file
    e.target.value = '';

    // Controllo dimensione: avviso oltre 200MB ma non blocca
    const mb = file.size / (1024 * 1024);
    if (mb > 500) {
      addToast(`⚠️ File molto grande (${mb.toFixed(0)} MB). Upload potrebbe richiedere tempo.`, 'warn');
    }

    setUploading(true);
    setProgress(10);
    addToast(`⏳ Caricamento "${file.name}" su Aruba Drive…`, 'info');

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('percorso', percorso);
      fd.append('contenuto_id', contenutoId);
      fd.append('nome_file', file.name);

      setProgress(30);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/aruba-webdav-upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: fd,
      });

      setProgress(90);
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Upload fallito');

      setProgress(100);
      addToast(`✅ "${file.name}" caricato su Aruba Drive!`, 'success');
      onUploaded?.(data.url, file.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore upload';
      addToast(`❌ ${msg}`, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFile}
        disabled={uploading || disabled}
      />

      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled}
          title={uploading ? `Caricamento… ${progress}%` : 'Allega file su Aruba Drive'}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:scale-110 active:scale-95 disabled:opacity-40"
          style={{ color: uploading ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
        >
          {uploading ? (
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".25"/>
              <path d="M21 12a9 9 0 01-9 9"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-50"
          style={{
            background: uploading ? 'hsl(var(--muted))' : 'hsl(214 80% 55% / 0.12)',
            color: 'hsl(214 70% 45%)',
            border: '1px solid hsl(214 80% 55% / 0.3)',
          }}
        >
          {uploading ? (
            <>
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 01-9 9"/>
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".3"/>
              </svg>
              Caricamento… {progress}%
            </>
          ) : (
            label
          )}
        </button>
      )}
    </>
  );
}
