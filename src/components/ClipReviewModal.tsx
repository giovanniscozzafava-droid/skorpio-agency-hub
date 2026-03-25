/**
 * ClipReviewModal
 * ────────────────────────────────────────────────────────────────────────────
 * Opened from ClipDetailPanel when a clip has a file on Drive.
 *
 * Elisa can:
 *   ✅ "Approva e Scarica"  — marks clip Buona, triggers download
 *   ✏️ "Richiedi Modifiche" — opens a sub-form to describe the revision;
 *       on confirm creates a new Task for Alessandro with tipo "Revisione Montaggio"
 */

import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { LogRipresa, Contenuto, TeamMember } from '../types';

interface ClipReviewModalProps {
  clip: LogRipresa;
  clp: Contenuto | null;
  team: TeamMember[];
  onClose: () => void;
  onApproved: () => void;   // called after approval so parent can update stato → Buona
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function ClipReviewModal({ clip, clp, team, onClose, onApproved }: ClipReviewModalProps) {
  const { addToast, utente } = useApp();

  const [view, setView] = useState<'main' | 'revision'>('main');
  const [revisionNote, setRevisionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // ─── Find Alessandro in team (montaggio) ─────────────────────────────────
  const alessandro = team.find(t =>
    t.nome.toLowerCase().startsWith('ales') ||
    t.nome.toLowerCase() === 'alessandro'
  );

  // ─── Approve & Download ───────────────────────────────────────────────────
  async function handleApprove() {
    setDownloading(true);
    try {
      // 1. Mark clip stato → Buona
      await supabase
        .from('log_riprese')
        .update({ stato: 'Buona' })
        .eq('id', clip.id);

      // 2. Trigger browser download via hidden anchor
      if (clip.file_url) {
        const a = document.createElement('a');
        a.href = clip.file_url;
        a.download = clip.file_name || clip.id_clip;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      addToast('✅ Clip approvata e download avviato!', 'success');
      onApproved();
      onClose();
    } catch (err) {
      console.error('[ClipReview] approve error:', err);
      addToast('❌ Errore approvazione', 'error');
    } finally {
      setDownloading(false);
    }
  }

  // ─── Request Changes → Task for Alessandro ───────────────────────────────
  async function handleRevisionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!revisionNote.trim()) {
      addToast('⚠️ Descrivi le modifiche richieste', 'warn');
      return;
    }
    setSubmitting(true);

    try {
      const assegnatoA = alessandro?.nome || 'Alessandro';
      const assegnatoDA = utente?.nome || 'Elisa';
      const clpLabel = clp ? `${clp.id_display} — ${clp.titolo}` : clip.id_clip;

      // Generate display ID for the task
      const { data: idData } = await supabase.rpc('generate_display_id', {
        prefix: 'TSK',
        seq_name: 'tsk_seq',
      });

      const { error } = await supabase.from('task').insert({
        id_display: idData as string,
        tipo: 'Revisione Montaggio',
        descrizione: `✂️ Revisione clip ${clip.id_clip} — ${clpLabel}`,
        note: revisionNote.trim(),
        id_contenuto: clp?.id_display || '',
        cliente_id: clip.cliente_id || null,
        cliente_nome: clip.cliente_nome || '',
        priorita: '🔴 Alta',
        stato: 'Da fare',
        assegnato_a: assegnatoA,
        assegnato_da: assegnatoDA,
        scadenza: clp?.data_scadenza || null,
      });

      if (error) throw error;

      // Also mark the clip stato → Revisione (if that stato exists, else keep Grezza)
      await supabase
        .from('log_riprese')
        .update({ stato: 'Grezza' })
        .eq('id', clip.id);

      addToast(`✏️ Modifiche inviate ad ${assegnatoA}`, 'success');
      onClose();
    } catch (err) {
      console.error('[ClipReview] revision error:', err);
      addToast('❌ Errore creazione task', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const isVideo = clip.file_mime_type?.startsWith('video/') ||
    !!clip.file_name?.match(/\.(mp4|mov|avi|webm|mkv)$/i);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🔍</span>
              <h2 className="font-bold text-base text-foreground font-mono">{clip.id_clip}</h2>
              {clip.file_name && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full truncate max-w-[200px]">
                  {clip.file_name}
                </span>
              )}
            </div>
            {clp && (
              <p className="text-xs text-muted-foreground mt-0.5 ml-7">
                {clp.id_display} — {clp.titolo} · {clip.cliente_nome}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {view === 'main' && (
            <div className="space-y-0">
              {/* Video preview */}
              {isVideo && clip.file_url && (
                <div className="bg-black">
                  <video
                    src={clip.file_url}
                    controls
                    autoPlay={false}
                    className="w-full max-h-[380px] object-contain"
                    preload="metadata"
                  >
                    Il browser non supporta il video inline.
                  </video>
                </div>
              )}

              {/* Non-video file info */}
              {!isVideo && clip.file_url && (
                <div className="px-6 py-6 flex flex-col items-center gap-3 text-center">
                  <div className="text-5xl">📄</div>
                  <p className="font-semibold text-foreground">{clip.file_name || 'File'}</p>
                  <a
                    href={clip.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg bg-[hsl(var(--clr-blue)/0.12)] text-[hsl(var(--clr-blue))] text-sm font-medium hover:opacity-80 transition-opacity"
                  >
                    ↗ Apri in Drive
                  </a>
                </div>
              )}

              {/* File meta */}
              <div className="px-6 py-3 flex items-center gap-4 text-xs text-muted-foreground border-t border-border/50 bg-muted/20">
                {clip.file_size && <span>💾 {formatBytes(clip.file_size)}</span>}
                {clip.file_uploaded_at && (
                  <span>📅 Caricato {new Date(clip.file_uploaded_at).toLocaleDateString('it-IT')}</span>
                )}
                {clip.operatore && <span>👤 {clip.operatore}</span>}
              </div>

              {/* Actions */}
              <div className="px-6 py-5 space-y-3">
                <p className="text-sm font-medium text-foreground">Qual è la tua decisione?</p>

                {/* Approve */}
                <button
                  onClick={handleApprove}
                  disabled={downloading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[hsl(var(--clr-green))] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {downloading ? (
                    <span className="animate-spin text-base">⏳</span>
                  ) : (
                    <span className="text-base">✅</span>
                  )}
                  {downloading ? 'Download in corso…' : 'Approva e Scarica'}
                </button>

                {/* Request changes */}
                <button
                  onClick={() => setView('revision')}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[hsl(var(--clr-amber)/0.5)] bg-[hsl(var(--clr-amber)/0.08)] text-[hsl(var(--clr-amber))] font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  <span className="text-base">✏️</span>
                  Richiedi Modifiche ad Alessandro
                </button>
              </div>
            </div>
          )}

          {/* Revision form */}
          {view === 'revision' && (
            <form onSubmit={handleRevisionSubmit} className="px-6 py-5 space-y-4">
              <button
                type="button"
                onClick={() => setView('main')}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Torna alla revisione
              </button>

              <div>
                <h3 className="font-bold text-base text-foreground mb-1">✏️ Richiesta modifiche</h3>
                <p className="text-sm text-muted-foreground">
                  Descrivi le modifiche da apportare. Verrà creato un task{' '}
                  <span className="font-semibold text-foreground">
                    🔴 Alta priorità
                  </span>{' '}
                  per {alessandro?.nome || 'Alessandro'}.
                </p>
              </div>

              {/* Clip recap */}
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[hsl(var(--clr-blue))]">{clip.id_clip}</span>
                  {clp && <span className="text-muted-foreground">→ {clp.id_display} — {clp.titolo}</span>}
                </div>
                {clip.file_name && (
                  <p className="text-muted-foreground truncate">{clip.file_name}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Descrizione modifiche *
                </label>
                <textarea
                  autoFocus
                  rows={5}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--clr-amber)/0.4)] placeholder:text-muted-foreground/50"
                  placeholder="es: Il taglio a 0:32 è troppo brusco, aggiungere una transizione. La musica copre il parlato negli ultimi 10 secondi…"
                  value={revisionNote}
                  onChange={e => setRevisionNote(e.target.value)}
                />
                <p className="text-right text-xs text-muted-foreground mt-1">{revisionNote.length} caratteri</p>
              </div>

              {/* Target member */}
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                {alessandro?.colore && (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: alessandro.colore }}
                  >
                    {(alessandro.nome || 'A').charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-foreground">{alessandro?.nome || 'Alessandro'}</p>
                  <p className="text-xs text-muted-foreground">✂️ Montaggio — riceverà un task 🔴 Alta priorità</p>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setView('main')}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting || !revisionNote.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-[hsl(var(--clr-amber))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {submitting ? '⏳ Invio…' : '✏️ Invia a Alessandro'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
