import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

interface Props {
  onClose: () => void;
}

const CATEGORIE = [
  { id: 'bug', label: '🐛 Qualcosa non funziona', desc: 'Un bottone, un\'azione che fallisce, un errore' },
  { id: 'slow', label: '🐌 SKORPIO è lento', desc: 'Caricamenti eterni, lag, freeze' },
  { id: 'wrong', label: '❓ Comportamento strano', desc: 'Funziona ma non come dovrebbe' },
  { id: 'missing', label: '💡 Manca qualcosa', desc: 'Una funzione che sarebbe utile avere' },
  { id: 'ux', label: '🎨 UI/UX confusa', desc: 'Difficile capire cosa fare' },
];

// Ridimensiona e comprime lo screenshot per non saturare il bucket
async function compressImage(file: File | Blob, maxSize = 1600, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas ctx null')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas blob null'));
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function BugReportModal({ onClose }: Props) {
  const { utente, addToast } = useApp();
  const [categoria, setCategoria] = useState('bug');
  const [cosaStavoFacendo, setCosaStavoFacendo] = useState('');
  const [cosaMiAspettavo, setCosaMiAspettavo] = useState('');
  const [cosaEsuccesso, setCosaEsuccesso] = useState('');
  const [sending, setSending] = useState(false);
  const [screenshot, setScreenshot] = useState<{ preview: string; blob: Blob } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Listener globale: Cmd+V / Ctrl+V → se ha immagine, la usa come screenshot
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          try {
            const compressed = await compressImage(file);
            const preview = URL.createObjectURL(compressed);
            setScreenshot({ preview, blob: compressed });
            addToast('📸 Screenshot incollato!', 'success');
          } catch (err: any) {
            addToast('❌ Errore compressione screenshot', 'error');
          }
          return;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [addToast]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const preview = URL.createObjectURL(compressed);
      setScreenshot({ preview, blob: compressed });
    } catch (err) {
      addToast('❌ Errore compressione', 'error');
    }
    e.target.value = '';
  }, [addToast]);

  const removeScreenshot = () => {
    if (screenshot?.preview) URL.revokeObjectURL(screenshot.preview);
    setScreenshot(null);
  };

  const uploadScreenshot = async (): Promise<string | null> => {
    if (!screenshot) return null;
    setUploading(true);
    try {
      const fileName = `bug_reports/${utente?.nome || 'anon'}_${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('bug-screenshots').upload(fileName, screenshot.blob, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) {
        console.warn('[BugReport] upload screenshot failed:', error);
        return null;
      }
      const { data } = supabase.storage.from('bug-screenshots').getPublicUrl(fileName);
      return data.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!cosaStavoFacendo.trim() || !cosaEsuccesso.trim()) {
      addToast('⚠️ Compila almeno "Cosa stavi facendo" e "Cosa è successo"', 'warn');
      return;
    }
    setSending(true);
    try {
      const screenshotUrl = await uploadScreenshot();

      await supabase.from('error_log').insert({
        tipo: 'user_report',
        messaggio: `[${categoria}] ${cosaEsuccesso.slice(0, 400)}`,
        component: 'user_report',
        url: window.location.href,
        user_nome: utente?.nome || 'anonimo',
        contesto: JSON.stringify({
          categoria,
          cosa_stavo_facendo: cosaStavoFacendo,
          cosa_mi_aspettavo: cosaMiAspettavo,
          cosa_e_successo: cosaEsuccesso,
          screenshot_url: screenshotUrl,
          browser: navigator.userAgent,
          screen: `${window.screen.width}x${window.screen.height}`,
        }).slice(0, 4000),
      });
      addToast('✅ Segnalazione inviata! Giovanni la vedrà e interverrà.', 'success');
      onClose();
    } catch (err: any) {
      addToast(`❌ Errore invio: ${err.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: 'hsl(var(--card))' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: 'hsl(var(--border))', background: 'linear-gradient(135deg, #EF444410, #F9731610)' }}>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🐛 Segnala un problema</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              Più dettagli dai, più veloce risolvo
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-[hsl(var(--muted))]">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Categoria */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-2 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Tipo di problema</label>
            <div className="space-y-1.5">
              {CATEGORIE.map(c => (
                <button key={c.id} onClick={() => setCategoria(c.id)}
                  className="w-full text-left p-2.5 rounded-xl border transition-all"
                  style={{
                    background: categoria === c.id ? '#EF444410' : 'hsl(var(--card))',
                    borderColor: categoria === c.id ? '#EF444450' : 'hsl(var(--border))',
                  }}>
                  <p className="text-xs font-semibold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{c.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Cosa stavi facendo */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              📍 Cosa stavi facendo? *
            </label>
            <textarea className="sk-input w-full text-xs" rows={2} value={cosaStavoFacendo}
              onChange={e => setCosaStavoFacendo(e.target.value)}
              placeholder="Es. Stavo caricando un asset per il cliente Saturday, ho cliccato ⬆️ Carica…" />
          </div>

          {/* Cosa ti aspettavi */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              🎯 Cosa ti aspettavi?
            </label>
            <textarea className="sk-input w-full text-xs" rows={2} value={cosaMiAspettavo}
              onChange={e => setCosaMiAspettavo(e.target.value)}
              placeholder="Es. Che il file apparisse nella griglia" />
          </div>

          {/* Cosa è successo */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              ⚠️ Cosa è successo invece? *
            </label>
            <textarea className="sk-input w-full text-xs" rows={3} value={cosaEsuccesso}
              onChange={e => setCosaEsuccesso(e.target.value)}
              placeholder="Es. Non è successo niente, il bottone ha lampeggiato ma il file non è stato caricato" />
          </div>

          {/* Screenshot */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              📸 Screenshot (opzionale)
            </label>

            {screenshot ? (
              <div className="relative rounded-xl overflow-hidden border" style={{ borderColor: 'hsl(var(--border))' }}>
                <img src={screenshot.preview} alt="Screenshot" className="w-full max-h-60 object-contain" style={{ background: '#0F172A' }} />
                <button onClick={removeScreenshot}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: 'rgba(0,0,0,0.7)' }}>✕</button>
                <div className="absolute bottom-2 left-2 px-2 py-1 rounded text-[10px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.7)' }}>
                  {Math.round(screenshot.blob.size / 1024)} KB
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="p-3 rounded-xl border-2 border-dashed text-center" style={{ borderColor: 'hsl(var(--border))' }}>
                  <p className="text-xs font-semibold" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                    📋 Incolla screenshot con <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'hsl(var(--muted))' }}>⌘V</kbd> (Mac) o <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'hsl(var(--muted))' }}>Ctrl+V</kbd> (Windows)
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    Fai prima lo screenshot con <kbd className="px-1 py-0.5 rounded text-[9px] font-mono" style={{ background: 'hsl(var(--muted))' }}>⌘⇧4</kbd> (Mac) o <kbd className="px-1 py-0.5 rounded text-[9px] font-mono" style={{ background: 'hsl(var(--muted))' }}>Win+⇧+S</kbd> (Windows)
                  </p>
                </div>
                <div className="text-center">
                  <label className="text-[11px] font-semibold cursor-pointer inline-block px-3 py-1.5 rounded-lg transition-all hover:scale-105"
                    style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                    📁 …oppure carica dal disco
                    <input type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Info auto */}
          <div className="text-[10px] p-2.5 rounded-lg" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-tertiary))' }}>
            <p className="font-semibold mb-1">ℹ️ Info raccolte automaticamente:</p>
            <p>👤 Utente: <strong>{utente?.nome}</strong></p>
            <p>🌐 Pagina: {window.location.pathname}</p>
            <p>🕐 Ora: {new Date().toLocaleString('it-IT')}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex gap-2 flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
          <button onClick={onClose} className="text-xs px-4 py-2 rounded-xl font-semibold" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
            Annulla
          </button>
          <button onClick={submit} disabled={sending || uploading || !cosaStavoFacendo.trim() || !cosaEsuccesso.trim()}
            className="flex-1 text-xs py-2 rounded-xl font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #EF4444, #F97316)' }}>
            {uploading ? '📤 Upload screenshot…' : sending ? '⏳ Invio…' : '🚀 Invia segnalazione'}
          </button>
        </div>
      </div>
    </div>
  );
}
