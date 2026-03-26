import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useUpload } from '../context/UploadContext';
import type { LogRipresa, Cliente, TeamMember, Contenuto } from '../types';
import { ClipFileUpload, FileStatusDot, formatBytes } from './ClipFileUpload';
import { ClipReviewModal } from './ClipReviewModal';
import { BulkUploadModal, AutoCleanupDialog } from './DriveStorageIndicator';
import { getStorageService } from '../services/storage';

// ─── Drive URL helpers ────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Download file via fetch+blob — no new tab */
async function downloadFileProxy(fileId: string, teamId: string, fileName?: string) {
  const url = `${SUPABASE_URL}/functions/v1/google-drive-download?fileId=${encodeURIComponent(fileId)}&teamId=${encodeURIComponent(teamId)}`;
  const res = await fetch(url, {
    headers: {
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string}`,
    },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(blobUrl);
}
/** Proxy streaming for HTML5 video player with Range support */
function proxyStreamUrl(fileId: string, teamId: string) {
  return `${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${encodeURIComponent(fileId)}&teamId=${encodeURIComponent(teamId)}`;
}
function isVideoFile(fileName?: string | null, mimeType?: string | null) {
  if (mimeType && mimeType.startsWith('video/')) return true;
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['mp4', 'mov', 'avi', 'mxf', 'r3d', 'mkv', 'webm'].includes(ext || '');
  }
  return false;
}

// ─── constants ───────────────────────────────────────────────────────────────

const STATI: LogRipresa['stato'][] = ['Da girare', 'Grezza', 'Buona', 'Scartata', 'Usata'];

const STATO_CFG: Record<string, { bg: string; text: string; border: string }> = {
  'Da girare': { bg: 'hsl(var(--clr-amber)/0.12)', text: 'hsl(var(--clr-amber))',  border: 'hsl(var(--clr-amber)/0.35)' },
  'Grezza':    { bg: 'hsl(var(--muted))',            text: 'hsl(var(--muted-foreground))', border: 'hsl(var(--border))' },
  'Buona':     { bg: 'hsl(var(--clr-green)/0.12)',   text: 'hsl(var(--clr-green))',  border: 'hsl(var(--clr-green)/0.35)' },
  'Scartata':  { bg: 'hsl(var(--clr-red)/0.10)',     text: 'hsl(var(--clr-red))',    border: 'hsl(var(--clr-red)/0.35)' },
  'Usata':     { bg: 'hsl(var(--clr-blue)/0.12)',    text: 'hsl(var(--clr-blue))',   border: 'hsl(var(--clr-blue)/0.35)' },
};

const FASE_COLORS: Record<string, string> = {
  'Idea':         '#94A3B8', 'Script':     '#F59E0B', 'Girato':    '#22C55E',
  'Pre montato':  '#06B6D4', 'Montato':    '#8B5CF6', 'Revisione': '#EC4899',
  'Programmato':  '#7C3AED', 'Pubblicato': '#3B82F6', 'Scartata':  '#EF4444',
};

const FORMATI = ['Verticale 9:16', 'Orizzontale 16:9', 'Quadrato 1:1', 'Foto', 'Raw / LOG', 'Slow Motion', 'Drone', 'Altro'];

/** Returns true if a clip state/fase transition should trigger auto-cleanup */
function shouldTriggerCleanup(field: 'stato' | 'fase', newValue: string): boolean {
  if (field === 'stato' && newValue === 'Usata') return true;
  if (field === 'fase' && newValue === 'Pubblicato') return true;
  return false;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function StatoBadge({ stato }: { stato: string }) {
  const cfg = STATO_CFG[stato] || STATO_CFG['Grezza'];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      {stato}
    </span>
  );
}

function FaseBadge({ fase }: { fase: string }) {
  const color = FASE_COLORS[fase] || '#94A3B8';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
      style={{ background: color + '22', color, borderColor: color + '55' }}>
      {fase}
    </span>
  );
}

function InlineSelect({
  value, options, onChange, colorMap,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  colorMap?: Record<string, { text: string; border: string }>;
}) {
  const cfg = colorMap?.[value];
  return (
    <select
      className="border rounded px-1.5 py-0.5 text-[11px] font-medium bg-background cursor-pointer focus:outline-none"
      style={cfg ? { color: cfg.text, borderColor: cfg.border } : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── Modal Nuova Clip ─────────────────────────────────────────────────────────

interface NuovaClipModalProps {
  clienti: Cliente[];
  team: TeamMember[];
  onClose: () => void;
  onCreated: () => void;
}

function NuovaClipModal({ clienti, team, onClose, onCreated }: NuovaClipModalProps) {
  const { addToast } = useApp();

  const [clpMode, setClpMode] = useState<'nuovo' | string>('nuovo');
  const [clpSenzaClip, setClpSenzaClip] = useState<Contenuto[]>([]);
  const [clpConClip, setClpConClip] = useState<Contenuto[]>([]);
  const [clpClipCount, setClpClipCount] = useState<Record<string, string[]>>({});

  const [form, setForm] = useState({
    codici: '',
    titolo: '',
    clienteId: '',
    clienteNome: '',
    stato: 'Grezza' as LogRipresa['stato'],
    formato: '',
    operatore: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: clps } = await supabase
        .from('contenuti')
        .select('*')
        .neq('fase', 'Pubblicato')
        .order('id_display');
      
      const { data: clips } = await supabase
        .from('log_riprese')
        .select('contenuto_id, id_clip')
        .not('contenuto_id', 'is', null);

      const clipMap: Record<string, string[]> = {};
      (clips || []).forEach(c => {
        if (c.contenuto_id) {
          if (!clipMap[c.contenuto_id]) clipMap[c.contenuto_id] = [];
          clipMap[c.contenuto_id].push(c.id_clip);
        }
      });
      setClpClipCount(clipMap);

      const all = (clps || []) as Contenuto[];
      setClpSenzaClip(all.filter(c => !clipMap[c.id]));
      setClpConClip(all.filter(c => !!clipMap[c.id]));
    }
    load();
  }, []);

  function handleClpChange(val: string) {
    setClpMode(val);
    if (val === 'nuovo') {
      setForm(f => ({ ...f, clienteId: '', clienteNome: '', titolo: '' }));
      return;
    }
    const allClps = [...clpSenzaClip, ...clpConClip];
    const clp = allClps.find(c => c.id === val);
    if (clp) {
      setForm(f => ({
        ...f,
        clienteId: clp.cliente_id || '',
        clienteNome: clp.cliente_nome || '',
        titolo: clp.titolo || '',
      }));
    }
  }

  function set(k: string, v: unknown) { setForm(p => ({ ...p, [k]: v })); }

  const infoBox = (() => {
    if (clpMode === 'nuovo') return {
      bg: 'hsl(var(--clr-blue)/0.1)',
      border: 'hsl(var(--clr-blue)/0.3)',
      text: '🆕 Verrà creato un nuovo CLP su CONTENUTI con fase Girato',
      color: 'hsl(var(--clr-blue))',
    };
    const allClps = [...clpSenzaClip, ...clpConClip];
    const clp = allClps.find(c => c.id === clpMode);
    if (!clp) return null;
    const clips = clpClipCount[clp.id];
    if (!clips) return {
      bg: 'hsl(var(--clr-green)/0.1)',
      border: 'hsl(var(--clr-green)/0.3)',
      text: `🔗 Clip collegata a ${clp.id_display} — ${clp.cliente_nome}`,
      color: 'hsl(var(--clr-green))',
    };
    return {
      bg: 'hsl(var(--clr-amber)/0.1)',
      border: 'hsl(var(--clr-amber)/0.3)',
      text: `📎 ${clp.id_display} ha già clip: ${clips.join(', ')}. I nuovi codici Sony verranno aggiunti`,
      color: 'hsl(var(--clr-amber))',
    };
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rawCodes = form.codici.split(',').map(s => s.trim()).filter(Boolean);
    if (rawCodes.length === 0) { addToast('⚠️ Inserisci almeno un codice Sony', 'warn'); return; }
    if (!form.clienteId && clpMode === 'nuovo') {
      addToast('⚠️ Seleziona un cliente', 'warn'); return;
    }
    setLoading(true);

    let contenutoId: string | null = null;
    let idContenutoDisplay = '';
    let clienteId = form.clienteId;
    let clienteNome = form.clienteNome;

    if (clpMode === 'nuovo') {
      const { data: idData } = await supabase.rpc('generate_display_id', {
        prefix: 'CLP',
        seq_name: 'clp_seq',
      });
      const cliente = clienti.find(c => c.id === form.clienteId);
      clienteNome = cliente?.nome || '';

      const { data: newClp, error: clpErr } = await supabase
        .from('contenuti')
        .insert({
          id_display: idData as string,
          titolo: form.titolo || rawCodes.join(', '),
          cliente_id: form.clienteId || null,
          cliente_nome: clienteNome,
          fase: 'Girato',
        })
        .select()
        .single();

      if (clpErr || !newClp) {
        addToast('❌ Errore creazione CLP', 'error');
        setLoading(false);
        return;
      }
      contenutoId = newClp.id;
      idContenutoDisplay = newClp.id_display as string;
    } else {
      const allClps = [...clpSenzaClip, ...clpConClip];
      const clp = allClps.find(c => c.id === clpMode);
      if (clp) {
        contenutoId = clp.id;
        idContenutoDisplay = clp.id_display;
        clienteId = clp.cliente_id || '';
        clienteNome = clp.cliente_nome || '';
      }
    }

    const rows = rawCodes.map(code => ({
      id_clip: code,
      contenuto_id: contenutoId,
      id_contenuto_display: idContenutoDisplay,
      cliente_id: clienteId || null,
      cliente_nome: clienteNome,
      titolo: form.titolo || '',
      stato: form.stato,
      formato: form.formato,
      operatore: form.operatore,
    }));

    const { error } = await supabase.from('log_riprese').insert(rows);
    setLoading(false);

    if (error) {
      if (error.code === '23505') {
        addToast('⚠️ Uno o più codici clip già esistenti', 'warn');
      } else {
        addToast('❌ Errore inserimento clip', 'error');
      }
      return;
    }

    if (contenutoId) {
      const { data: clpData } = await supabase
        .from('contenuti')
        .select('fase')
        .eq('id', contenutoId)
        .single();
      const fasePrecedente = ['Idea', 'Script'];
      if (clpData && fasePrecedente.includes(clpData.fase)) {
        await supabase
          .from('contenuti')
          .update({ fase: 'Girato' })
          .eq('id', contenutoId);
      }
    }

    addToast(`✅ ${rawCodes.length} clip inserita${rawCodes.length > 1 ? 'e' : ''}!`, 'success');
    onCreated();
    onClose();
  }

  const inputCls = "w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--clr-blue)/0.4)]";
  const labelCls = "text-xs font-medium text-muted-foreground mb-0.5 block";
  const isClpSelected = clpMode !== 'nuovo';

  // ── Searchable CLP dropdown state ──────────────────────────────────────────
  const [clpQuery, setClpQuery] = useState('');
  const [clpOpen, setClpOpen] = useState(false);
  const clpDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (clpDropRef.current && !clpDropRef.current.contains(e.target as Node)) setClpOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const allClps = [...clpSenzaClip, ...clpConClip];
  const clpFiltered = clpQuery.trim()
    ? allClps.filter(c =>
        c.id_display.toLowerCase().includes(clpQuery.toLowerCase()) ||
        c.titolo.toLowerCase().includes(clpQuery.toLowerCase()) ||
        (c.cliente_nome || '').toLowerCase().includes(clpQuery.toLowerCase())
      )
    : allClps;

  const clpSenzaClipFiltered = clpFiltered.filter(c => !clpClipCount[c.id]);
  const clpConClipFiltered   = clpFiltered.filter(c =>  !!clpClipCount[c.id]);

  const selectedClp = allClps.find(c => c.id === clpMode);
  const clpDisplayLabel = clpMode === 'nuovo'
    ? '🆕 Genera nuovo CLP'
    : selectedClp ? `${selectedClp.id_display} — ${selectedClp.titolo}` : '— Seleziona CLP —';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-lg border border-border animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-base text-foreground">🎬 Nuova Clip</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className={labelCls}>Codice(i) Sony * <span className="text-muted-foreground font-normal">(separati da virgola)</span></label>
            <input
              autoFocus
              className={inputCls}
              placeholder="es: C7876, C7877, C7878"
              value={form.codici}
              onChange={e => set('codici', e.target.value)}
            />
            {form.codici && (
              <div className="mt-1 flex flex-wrap gap-1">
                {form.codici.split(',').map(s => s.trim()).filter(Boolean).map(code => (
                  <span key={code} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[hsl(var(--clr-blue)/0.12)] text-[hsl(var(--clr-blue))] border border-[hsl(var(--clr-blue)/0.3)]">
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Searchable CLP dropdown */}
          <div>
            <label className={labelCls}>Contenuto CLP</label>
            <div ref={clpDropRef} className="relative">
              {/* Trigger */}
              <div
                className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground flex items-center justify-between cursor-pointer hover:border-[hsl(var(--clr-blue)/0.5)] transition-colors"
                onClick={() => setClpOpen(o => !o)}
              >
                <span className={clpMode === 'nuovo' ? 'text-[hsl(var(--clr-blue))] font-medium' : 'text-foreground'}>
                  {clpDisplayLabel}
                </span>
                <span className="text-muted-foreground text-[10px] ml-2">{clpOpen ? '▲' : '▼'}</span>
              </div>

              {clpOpen && (
                <div className="absolute left-0 top-full mt-1 w-full z-50 rounded-xl shadow-xl border border-border bg-card overflow-hidden"
                  style={{ maxHeight: 280 }}>
                  {/* Search bar */}
                  <div className="p-2 border-b border-border">
                    <input
                      className={inputCls + ' text-xs'}
                      placeholder="🔍 Cerca per ID, titolo o cliente…"
                      value={clpQuery}
                      onChange={e => setClpQuery(e.target.value)}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  </div>

                  <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                    {/* Genera nuovo */}
                    <div
                      className="px-3 py-2 text-xs cursor-pointer hover:bg-muted transition-colors flex items-center gap-2"
                      style={{ color: clpMode === 'nuovo' ? 'hsl(var(--clr-blue))' : undefined, fontWeight: clpMode === 'nuovo' ? 600 : undefined }}
                      onClick={() => { handleClpChange('nuovo'); setClpQuery(''); setClpOpen(false); }}
                    >
                      🆕 <span>Genera nuovo CLP</span>
                    </div>

                    {/* Senza clip */}
                    {clpSenzaClipFiltered.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 sticky top-0">
                          📋 CLP senza clip ({clpSenzaClipFiltered.length})
                        </div>
                        {clpSenzaClipFiltered.map(c => (
                          <div
                            key={c.id}
                            className="px-3 py-2 text-xs cursor-pointer hover:bg-muted transition-colors"
                            style={{
                              color: c.id === clpMode ? 'hsl(var(--clr-green))' : 'hsl(var(--foreground))',
                              background: c.id === clpMode ? 'hsl(var(--clr-green)/0.08)' : undefined,
                              fontWeight: c.id === clpMode ? 600 : undefined,
                            }}
                            onClick={() => { handleClpChange(c.id); setClpQuery(''); setClpOpen(false); }}
                          >
                            <span className="font-mono text-[10px] opacity-60 mr-1">{c.id_display}</span>
                            {c.titolo}
                            {c.cliente_nome && <span className="ml-1 opacity-50">[{c.cliente_nome}]</span>}
                          </div>
                        ))}
                      </>
                    )}

                    {/* Con clip */}
                    {clpConClipFiltered.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 sticky top-0">
                          🎬 CLP con clip ({clpConClipFiltered.length})
                        </div>
                        {clpConClipFiltered.map(c => (
                          <div
                            key={c.id}
                            className="px-3 py-2 text-xs cursor-pointer hover:bg-muted transition-colors"
                            style={{
                              color: c.id === clpMode ? 'hsl(var(--clr-amber))' : 'hsl(var(--foreground))',
                              background: c.id === clpMode ? 'hsl(var(--clr-amber)/0.08)' : undefined,
                              fontWeight: c.id === clpMode ? 600 : undefined,
                            }}
                            onClick={() => { handleClpChange(c.id); setClpQuery(''); setClpOpen(false); }}
                          >
                            <span className="font-mono text-[10px] opacity-60 mr-1">{c.id_display}</span>
                            {c.titolo}
                            {c.cliente_nome && <span className="ml-1 opacity-50">[{c.cliente_nome}]</span>}
                          </div>
                        ))}
                      </>
                    )}

                    {clpFiltered.length === 0 && clpQuery && (
                      <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                        Nessun CLP trovato per "{clpQuery}"
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {infoBox && (
              <div className="mt-1.5 rounded-lg px-3 py-2 text-xs font-medium border"
                style={{ background: infoBox.bg, borderColor: infoBox.border, color: infoBox.color }}>
                {infoBox.text}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Cliente *</label>
              <select
                className={inputCls}
                value={form.clienteId}
                onChange={e => {
                  const c = clienti.find(x => x.id === e.target.value);
                  set('clienteId', e.target.value);
                  set('clienteNome', c?.nome || '');
                }}
                disabled={isClpSelected}
              >
                <option value="">— Seleziona —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Stato clip</label>
              <select className={inputCls} value={form.stato} onChange={e => set('stato', e.target.value)}>
                {STATI.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Titolo / Descrizione</label>
            <input
              className={inputCls}
              placeholder="Descrizione clip"
              value={form.titolo}
              onChange={e => set('titolo', e.target.value)}
              disabled={isClpSelected}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Formato</label>
              <select className={inputCls} value={form.formato} onChange={e => set('formato', e.target.value)}>
                <option value="">— Nessuno —</option>
                {FORMATI.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Operatore</label>
              <select className={inputCls} value={form.operatore} onChange={e => set('operatore', e.target.value)}>
                <option value="">— Nessuno —</option>
                {team.map(t => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">
              Annulla
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[hsl(var(--clr-blue))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? 'Inserimento…' : `✅ Inserisci clip`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Clip Detail Panel ────────────────────────────────────────────────────────

interface ClipDetailPanelProps {
  clip: LogRipresa;
  clp: Contenuto | null;
  team: TeamMember[];
  onClose: () => void;
  onUpdated: (patch: Partial<LogRipresa>) => void;
}

function ClipDetailPanel({ clip, clp, team, onClose, onUpdated }: ClipDetailPanelProps) {
  const [showReview, setShowReview] = useState(false);

  const hasFile = !!(clip.file_id && !clip.file_deleted_at);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-lg border border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-bold text-base text-foreground font-mono">{clip.id_clip}</h2>
            {clp && (
              <p className="text-xs text-muted-foreground mt-0.5">{clp.id_display} — {clp.titolo}</p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
          {/* Clip info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Stato</p>
              <div className="mt-1"><StatoBadge stato={clip.stato} /></div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fase CLP</p>
              <div className="mt-1">{clp ? <FaseBadge fase={clp.fase} /> : <span className="text-muted-foreground">—</span>}</div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cliente</p>
              <p className="mt-1 font-medium">{clip.cliente_nome || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Operatore</p>
              <p className="mt-1 font-medium">{clip.operatore || '—'}</p>
            </div>
          </div>

          {/* File section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                ☁️ File Google Drive
              </h3>
              {hasFile && (
                <button
                  onClick={() => setShowReview(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--clr-blue)/0.12)] text-[hsl(var(--clr-blue))] text-xs font-semibold hover:opacity-80 transition-opacity border border-[hsl(var(--clr-blue)/0.3)]"
                >
                  🔍 Revisiona
                </button>
              )}
            </div>
            <ClipFileUpload clip={clip} clp={clp} onUpdated={onUpdated} variant="panel" />
          </div>
        </div>
      </div>

      {/* Review modal — rendered above the detail panel */}
      {showReview && (
        <ClipReviewModal
          clip={clip}
          clp={clp}
          team={team}
          onClose={() => setShowReview(false)}
          onApproved={() => {
            onUpdated({ stato: 'Buona' });
            setShowReview(false);
          }}
        />
      )}
    </div>
  );
}

// ─── RowDropZonePicker: dialog when dragging onto a table row ─────────────────

interface RowDropZonePickerProps {
  files: File[];
  clip: LogRipresa;
  onPick: (zone: 'clip' | 'file_esportato') => void;
  onCancel: () => void;
}

function RowDropZonePicker({ files, clip, onPick, onCancel }: RowDropZonePickerProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border p-6 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="text-center">
          <div className="text-3xl mb-2">📂</div>
          <h3 className="font-bold text-base text-foreground">Dove vuoi caricare?</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {files.length} file per <span className="font-mono font-semibold">{clip.id_clip}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onPick('clip')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-border hover:border-[hsl(var(--clr-amber)/0.6)] hover:bg-[hsl(var(--clr-amber)/0.06)] transition-all"
          >
            <span className="text-2xl">📁</span>
            <span className="text-xs font-semibold text-foreground">Clip da montare</span>
            <span className="text-[10px] text-muted-foreground">→ clip/</span>
          </button>
          <button
            onClick={() => onPick('file_esportato')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-border hover:border-[hsl(var(--clr-green)/0.6)] hover:bg-[hsl(var(--clr-green)/0.06)] transition-all"
          >
            <span className="text-2xl">▶️</span>
            <span className="text-xs font-semibold text-foreground">File esportato</span>
            <span className="text-[10px] text-muted-foreground">→ file_esportato/</span>
          </button>
        </div>
        <button onClick={onCancel} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
          Annulla
        </button>
      </div>
    </div>
  );
}

// ─── ZipDownloadButton ───────────────────────────────────────────────────────

function ZipDownloadButton({ rawFiles, teamId, clpId, clpTitolo }: {
  rawFiles: LogRipresa[];
  teamId: string;
  clpId: string;
  clpTitolo: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const { addToast } = useApp();

  const filesWithId = rawFiles.filter(c => !!c.file_id);
  const total = filesWithId.length;

  const handleDownload = async () => {
    if (downloading || total === 0) return;
    setDownloading(true);
    setProgress({ current: 0, total });

    try {
      const files = filesWithId.map(c => ({
        fileId: c.file_id!,
        fileName: c.file_name || c.file_id || 'file',
      }));

      // Sanitize zip name
      const safeTitolo = (clpTitolo || 'clip').replace(/[^a-zA-Z0-9À-ÿ_\- ]/g, '').replace(/\s+/g, '-');
      const zipName = `${clpId || 'CLP'}_${safeTitolo}_clip.zip`;

      // Show progress simulation (we can't get per-file progress from a single request)
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          const next = Math.min(prev.current + 1, prev.total - 1);
          return { ...prev, current: next };
        });
      }, 800);

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/google-drive-download-zip`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({ teamId, files, zipName }),
        }
      );

      clearInterval(progressInterval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download ZIP fallito' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setProgress({ current: total, total });

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      addToast(`✅ ZIP scaricato: ${zipName}`, 'success');
    } catch (err: any) {
      console.error('[ZipDownload]', err);
      addToast(`❌ Errore download ZIP: ${err.message}`, 'error');
    } finally {
      setDownloading(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div>
      <button
        disabled={downloading || total === 0}
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[hsl(var(--clr-blue))] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {downloading ? (
          <span className="inline-block w-3 h-3 border-2 border-[hsl(var(--clr-blue))] border-t-transparent rounded-full animate-spin" />
        ) : '📦'}
        {downloading
          ? `Preparazione download… ${progress.current}/${progress.total} file`
          : `Scarica tutti come ZIP (${total} file)`}
      </button>
      {downloading && (
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-[hsl(var(--clr-blue))] transition-all duration-300"
            style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
          />
        </div>
      )}
    </div>
  );
}


// Shows aggregated file info for a CLP group row.
// On upload: matches each file to its clip by Sony code in the filename.

interface GroupFileCellProps {
  clips: LogRipresa[];
  clp: Contenuto | null;
  reprClip: LogRipresa;
  onUpdatedById: (clipId: string, patch: Partial<LogRipresa>) => void;
}

/** Extract Sony code from a filename, e.g. "C8623.MP4" → "C8623" */
function extractSonyCode(fileName: string): string | null {
  const m = fileName.match(/\b(C\d{4,5})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function GroupFileCell({ clips: groupClips, clp, reprClip, onUpdatedById }: GroupFileCellProps) {
  const [open, setOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { utente, addToast } = useApp();
  const { enqueue, queue } = useUpload();

  // Sum raw_files_count across all clips
  const totalRawFiles = groupClips.reduce((sum, c) => {
    if (c.raw_files_count && c.raw_files_count > 0) return sum + c.raw_files_count;
    if (c.file_id && !c.file_deleted_at) return sum + 1;
    return sum;
  }, 0);
  const totalCount = groupClips.length;
  const rawFiles = groupClips.filter(c => c.file_id && !c.file_deleted_at);
  const hasExported = !!reprClip.exported_file_id;
  const driveConnected = !!(utente as any)?.google_drive_connected;

  // Check if any upload is active for this CLP group
  const clpIds = new Set(groupClips.map(c => c.id));
  const isUploading = queue.some(u =>
    clpIds.has(u.clipId) && (u.status === 'uploading' || u.status === 'queued')
  );
  const uploadingCount = queue.filter(u =>
    clpIds.has(u.clipId) && (u.status === 'uploading' || u.status === 'queued')
  ).length;

  const dot = hasExported
    ? 'bg-[hsl(var(--clr-green))]'
    : totalRawFiles > 0
      ? 'bg-[hsl(var(--clr-amber))]'
      : 'bg-[hsl(var(--muted-foreground))]';

  /** Match each file to its clip by Sony code; fallback to reprClip */
  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!utente) { addToast('❌ Utente non trovato', 'error'); return; }
    if (!driveConnected) {
      addToast('⚠️ Connetti prima Google Drive nelle Impostazioni → Integrazioni', 'warn');
      return;
    }
    const teamId = utente.id;

    // Build a map: sonyCode → clip
    const codeMap = new Map<string, LogRipresa>();
    groupClips.forEach(c => {
      const code = c.id_clip?.replace(/\.[^.]+$/, '').toUpperCase();
      if (code) codeMap.set(code, c);
    });

    // Group files by matched clip
    const clipFiles = new Map<string, { clip: LogRipresa; files: File[] }>();
    Array.from(files).forEach(file => {
      const code = extractSonyCode(file.name);
      const clip = (code && codeMap.get(code)) || reprClip;
      if (!clipFiles.has(clip.id)) clipFiles.set(clip.id, { clip, files: [] });
      clipFiles.get(clip.id)!.files.push(file);
    });

    // Enqueue each group separately
    clipFiles.forEach(({ clip, files: clipFileList }) => {
      enqueue(
        clipFileList,
        'clip',
        clip,
        clp,
        teamId,
        (id, patch) => onUpdatedById(id, patch)
      );
    });
  }

  /** Delete a single file from Drive + DB */
  async function deleteOneFile(c: LogRipresa) {
    const now = new Date().toISOString();
    const patch: Partial<LogRipresa> = {
      file_id: null, file_url: null, file_name: null,
      file_size: null, file_deleted_at: now,
      raw_files_count: 0, raw_files_size: 0,
    };
    if (!c.file_id) {
      await supabase.from('log_riprese').update(patch).eq('id', c.id);
      onUpdatedById(c.id, patch);
      return { ok: true, notFound: false };
    }
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-delete`, {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: c.file_id, teamId: utente?.id }),
      });
      let body: { error?: string } = {};
      try { body = await res.json(); } catch {}
      const isNotFound = res.status === 404 || body?.error?.includes('notFound');
      await supabase.from('log_riprese').update(patch).eq('id', c.id);
      onUpdatedById(c.id, patch);
      return { ok: res.ok || isNotFound, notFound: isNotFound };
    } catch {
      await supabase.from('log_riprese').update(patch).eq('id', c.id);
      onUpdatedById(c.id, patch);
      return { ok: false, notFound: false };
    }
  }

  return (
    <div className="relative inline-flex items-center gap-1.5">
      {/* Status dot — pulses while uploading */}
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot} ${isUploading ? 'animate-[pulse_1s_ease-in-out_infinite]' : ''}`} />

      {/* File count button */}
      <button
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        title={`${totalRawFiles} file grezzi caricati su ${totalCount} clip`}
      >
        {isUploading ? (
          /* Animated upload badge */
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[hsl(var(--clr-amber)/0.15)] border border-[hsl(var(--clr-amber)/0.4)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[hsl(var(--clr-amber))] animate-[pulse_0.8s_ease-in-out_infinite]" />
            <span className="text-[10px] font-semibold text-[hsl(var(--clr-amber))]">
              {uploadingCount} in caricamento…
            </span>
          </span>
        ) : (
          <>
            <span>📁</span>
            <span className="font-semibold tabular-nums">{totalRawFiles}/{totalCount}</span>
          </>
        )}
      </button>

      {/* Upload button — smart match to individual clips */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.avi,.mxf,.r3d"
        multiple
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
      />
      <button
        onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
        className={`text-sm transition-all ${isUploading ? 'opacity-100 animate-[pulse_1.5s_ease-in-out_infinite] text-[hsl(var(--clr-amber))]' : 'opacity-60 hover:opacity-100 text-muted-foreground hover:text-primary'}`}
        title="Carica file per questo CLP (abbinamento automatico per codice Sony)"
      >
        ☁️↑
      </button>

      {/* Popover with file list + download links */}
      {open && (
        <div
          className="absolute top-7 right-0 z-50 w-80 rounded-lg border border-border bg-popover shadow-lg p-3 text-left animate-in fade-in slide-in-from-top-1 duration-150"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">
              File grezzi · {totalRawFiles} / {totalCount} clip
            </span>
            <button
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => setOpen(false)}
            >✕</button>
          </div>

          {/* Raw files list */}
          {rawFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nessun file caricato</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {rawFiles.map(c => {
                const hasId = !!c.file_id;
                const isVideo = isVideoFile(c.file_name, c.file_mime_type);
                return (
                  <div key={c.id} className="flex items-center gap-1 py-0.5 group/row">
                    <span className="font-mono text-[10px] text-muted-foreground truncate flex-1 min-w-0" title={c.file_name || c.id_clip}>
                      {c.file_name || c.id_clip}
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {c.file_size ? `${(c.file_size / 1024 / 1024).toFixed(0)} MB` : '—'}
                    </span>

                    {/* Play preview — video only */}
                    {isVideo && hasId ? (
                      <button
                        onClick={() => setPreviewUrl(proxyStreamUrl(c.file_id!, utente?.id || ''))}
                        className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--clr-green)/0.1)] text-[hsl(var(--clr-green))] hover:opacity-80"
                        title="Anteprima video"
                      >▶</button>
                    ) : isVideo ? (
                      <span className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded opacity-30 cursor-not-allowed text-muted-foreground" title="File non disponibile per l'anteprima — prova a ricaricare">▶</span>
                    ) : null}

                    {/* Download direct */}
                    {hasId ? (
                      <button
                        onClick={() => downloadFileProxy(c.file_id!, utente?.id || '', c.file_name || c.file_id || 'download')}
                        className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--clr-blue)/0.1)] text-[hsl(var(--clr-blue))] hover:opacity-80"
                        title="Download diretto"
                      >⬇</button>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded opacity-30 cursor-not-allowed text-muted-foreground" title="File non disponibile per il download — prova a ricaricare">⬇</span>
                    )}

                    {/* Download proxy */}

                    {/* Delete */}
                    <button
                      onClick={async () => {
                        if (!confirm(`Eliminare "${c.file_name || c.file_id || 'questo file'}" anche da Google Drive?`)) return;
                        const { notFound } = await deleteOneFile(c);
                        if (notFound) addToast('⚠️ File già rimosso da Drive, riferimento eliminato', 'warn');
                        else addToast('🗑️ File eliminato da Drive', 'success');
                      }}
                      className="flex-shrink-0 opacity-0 group-hover/row:opacity-100 text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--clr-red)/0.1)] text-[hsl(var(--clr-red))] hover:opacity-80 transition-opacity"
                      title="Elimina da Drive e DB"
                    >🗑️</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Delete ALL files */}
          {rawFiles.length > 1 && (
            <div className="mt-2 pt-2 border-t border-border">
              <button
                disabled={deletingAll}
                onClick={async () => {
                  if (!confirm(`Eliminare tutti i ${rawFiles.length} file da Google Drive? Questa azione è irreversibile.`)) return;
                  setDeletingAll(true);
                  let deleted = 0, notFound = 0, errors = 0;
                  for (const c of rawFiles) {
                    const result = await deleteOneFile(c);
                    if (result.notFound) notFound++;
                    else if (result.ok) deleted++;
                    else errors++;
                  }
                  setDeletingAll(false);
                  const parts = [];
                  if (deleted > 0) parts.push(`${deleted} eliminati`);
                  if (notFound > 0) parts.push(`${notFound} già rimossi`);
                  if (errors > 0) parts.push(`${errors} errori`);
                  addToast(`🗑️ ${parts.join(' · ')}`, errors > 0 ? 'warn' : 'success');
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[hsl(var(--clr-red))] hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {deletingAll ? (
                  <span className="inline-block w-3 h-3 border-2 border-[hsl(var(--clr-red))] border-t-transparent rounded-full animate-spin" />
                ) : '🗑️'}
                {deletingAll ? 'Eliminazione in corso…' : `Cancella tutti i file da Drive (${rawFiles.length})`}
              </button>
            </div>
          )}

          {/* Download all as ZIP */}
          {rawFiles.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <ZipDownloadButton
                rawFiles={rawFiles}
                teamId={utente?.id || ''}
                clpId={reprClip.id_contenuto_display || ''}
                clpTitolo={reprClip.titolo || clp?.titolo || ''}
              />
            </div>
          )}

          {/* Exported file */}
          {hasExported && reprClip.exported_file_id && (
            <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
              {isVideoFile(reprClip.exported_file_name, reprClip.exported_file_mime_type) && (
                <button
                  onClick={() => setPreviewUrl(proxyStreamUrl(reprClip.exported_file_id!, utente?.id || ''))}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--clr-green))] hover:underline"
                  title="Anteprima"
                >▶</button>
              )}
              <button
                onClick={() => downloadFileProxy(reprClip.exported_file_id!, utente?.id || '', reprClip.exported_file_name || 'export')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--clr-green))] hover:underline"
              >
                🎬 {reprClip.exported_file_name || 'File esportato'} ⬇
              </button>
            </div>
          )}

          {/* Video preview modal */}
          {previewUrl && (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
              onClick={() => setPreviewUrl(null)}
            >
              <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl" style={{ width: '80vw', maxWidth: 900, aspectRatio: '16/9' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setPreviewUrl(null)}
                  className="absolute top-2 right-2 z-10 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-black/80"
                >✕</button>
                <video
                  src={previewUrl}
                  controls
                  autoPlay
                  className="w-full h-full"
                  style={{ objectFit: 'contain' }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface RipreseTabProps {
  clienti: Cliente[];
  team: TeamMember[];
}

export function RipreseTab({ clienti, team }: RipreseTabProps) {
  const { addToast, utente } = useApp();
  const [clips, setClips] = useState<LogRipresa[]>([]);
  const [contenuti, setContenuti] = useState<Record<string, Contenuto>>({});
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [filtroStato, setFiltroStato] = useState<string>('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroOperatore, setFiltroOperatore] = useState('');
  const [search, setSearch] = useState('');
  const [showNuova, setShowNuova] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [detailClip, setDetailClip] = useState<LogRipresa | null>(null);
  const [filtroPubblicatiConRaw, setFiltroPubblicatiConRaw] = useState(false);

  // Drag-and-drop on row
  const [rowDragTarget, setRowDragTarget] = useState<string | null>(null);
  const [dropZonePicker, setDropZonePicker] = useState<{ files: File[]; clip: LogRipresa } | null>(null);
  // Per-clip file upload ref map (to trigger uploads programmatically after zone pick)
  

  // Auto-cleanup dialog state
  const [cleanupPending, setCleanupPending] = useState<{
    clipId: string;
    field: 'stato' | 'fase';
    newValue: string;
  } | null>(null);

  const loadClips = useCallback(async () => {
    const { data } = await supabase
      .from('log_riprese')
      .select('*')
      .order('created_at', { ascending: false });
    setClips((data || []) as LogRipresa[]);
    setLoading(false);

    const ids = [...new Set((data || []).map((c: LogRipresa) => c.contenuto_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: clps } = await supabase.from('contenuti').select('*').in('id', ids);
      const map: Record<string, Contenuto> = {};
      (clps || []).forEach((c: Contenuto) => { map[c.id] = c; });
      setContenuti(map);
    }
  }, []);

  useEffect(() => { loadClips(); }, [loadClips]);

  const statCounts = STATI.reduce((acc, s) => {
    acc[s] = clips.filter(c => c.stato === s).length;
    return acc;
  }, {} as Record<string, number>);

  const reportClienti = React.useMemo(() => {
    const map: Record<string, { nome: string; clienteId: string; buona: number; grezza: number; daGirare: number; scartata: number; usata: number; totale: number }> = {};
    clips.forEach(c => {
      const key = c.cliente_nome || '(Senza cliente)';
      if (!map[key]) map[key] = { nome: key, clienteId: c.cliente_id || '', buona: 0, grezza: 0, daGirare: 0, scartata: 0, usata: 0, totale: 0 };
      map[key].totale++;
      if (c.stato === 'Buona') map[key].buona++;
      else if (c.stato === 'Grezza') map[key].grezza++;
      else if (c.stato === 'Da girare') map[key].daGirare++;
      else if (c.stato === 'Scartata') map[key].scartata++;
      else if (c.stato === 'Usata') map[key].usata++;
    });
    return Object.values(map).sort((a, b) => b.totale - a.totale);
  }, [clips]);

  const filtered = clips.filter(c => {
    if (filtroStato && c.stato !== filtroStato) return false;
    if (filtroCliente && (c.cliente_nome || '') !== filtroCliente) return false;
    if (filtroOperatore && c.operatore !== filtroOperatore) return false;
    // Filter: Pubblicati con file grezzi ancora presenti (per cleanup)
    if (filtroPubblicatiConRaw) {
      const clp = c.contenuto_id ? contenuti[c.contenuto_id] : null;
      if (clp?.fase !== 'Pubblicato') return false;
      if (!c.file_id || c.file_deleted_at) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      return (
        c.id_clip.toLowerCase().includes(s) ||
        (c.titolo || '').toLowerCase().includes(s) ||
        (c.cliente_nome || '').toLowerCase().includes(s) ||
        (c.id_contenuto_display || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Drive alert: clips pubblicati con file grezzi presenti
  const clipsPublicatiConRaw = clips.filter(c => {
    const clp = c.contenuto_id ? contenuti[c.contenuto_id] : null;
    return clp?.fase === 'Pubblicato' && c.file_id && !c.file_deleted_at;
  });
  const totalRawSizePublicati = clipsPublicatiConRaw.reduce((acc, c) => acc + (c.raw_files_size || c.file_size || 0), 0);

  const reportClienteAttivo = filtroCliente
    ? reportClienti.find(r => r.nome === filtroCliente)
    : null;

  // ─── Grouped view ────────────────────────────────────────────────────────────
  type ClpGroup = {
    key: string; // contenuto_id or 'orphan__id_clip'
    clp: Contenuto | null;
    clips: LogRipresa[];
    isOrphan: boolean;
  };

  const groupedRows = React.useMemo((): ClpGroup[] => {
    const map = new Map<string, ClpGroup>();
    filtered.forEach(clip => {
      if (clip.contenuto_id) {
        if (!map.has(clip.contenuto_id)) {
          map.set(clip.contenuto_id, {
            key: clip.contenuto_id,
            clp: contenuti[clip.contenuto_id] || null,
            clips: [],
            isOrphan: false,
          });
        }
        map.get(clip.contenuto_id)!.clips.push(clip);
      } else {
        // Orphan clip (no CLP linked) → own group
        const k = `orphan__${clip.id}`;
        map.set(k, { key: k, clp: null, clips: [clip], isOrphan: true });
      }
    });
    return Array.from(map.values());
  }, [filtered, contenuti]);

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function updateClipLocally(id: string, patch: Partial<LogRipresa>) {
    setClips(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    if (detailClip?.id === id) setDetailClip(prev => prev ? { ...prev, ...patch } : prev);
  }

  async function updateClip(id: string, patch: Partial<LogRipresa>) {
    const { error } = await supabase.from('log_riprese').update(patch).eq('id', id);
    if (error) { addToast('❌ Errore aggiornamento', 'error'); return; }
    updateClipLocally(id, patch);
  }

  /** Handle stato/fase change — intercept if needs cleanup dialog */
  async function handleStatoChange(clip: LogRipresa, newStato: string) {
    if (clip.file_id && !clip.file_deleted_at && shouldTriggerCleanup('stato', newStato)) {
      setCleanupPending({ clipId: clip.id, field: 'stato', newValue: newStato });
      return;
    }
    await updateClip(clip.id, { stato: newStato as LogRipresa['stato'] });
  }

  async function handleCleanupConfirm(deleteFile: boolean) {
    if (!cleanupPending) return;
    const clip = clips.find(c => c.id === cleanupPending.clipId);
    if (!clip) { setCleanupPending(null); return; }

    const patch: Partial<LogRipresa> = { [cleanupPending.field]: cleanupPending.newValue as LogRipresa['stato'] };

    if (deleteFile && clip.file_id) {
      const storage = getStorageService();
      const deleted = await storage.deleteFile(clip.file_id);
      Object.assign(patch, {
        file_id: null,
        file_url: null,
        file_deleted_at: new Date().toISOString(),
      });
      if (deleted) {
        addToast('🗑️ File rimosso da Google Drive. Copia locale conservata.', 'success');
      } else {
        addToast('⚠️ Errore rimozione Drive — stato aggiornato comunque', 'warn');
      }
    }

    await updateClip(clip.id, patch);
    setCleanupPending(null);
  }

  async function deleteClip(id: string) {
    const { error } = await supabase.from('log_riprese').delete().eq('id', id);
    if (error) { addToast('❌ Errore eliminazione', 'error'); return; }
    setClips(prev => prev.filter(c => c.id !== id));
    setDeletingId(null);
    addToast('🗑️ Clip eliminata', 'warn');
  }

  const thCls = "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap bg-muted/60 sticky top-0 z-10";
  const tdCls = "px-3 py-2 text-sm text-foreground border-b border-border/50";

  return (
    <div className="flex flex-col h-full">

      {/* ── Drive Alert Banner (>85% or pubblicati con raw) ── */}
      {clipsPublicatiConRaw.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[hsl(var(--clr-amber)/0.4)] bg-[hsl(var(--clr-amber)/0.08)]">
          <span className="text-sm">⚠️</span>
          <p className="text-xs text-[hsl(var(--clr-amber))] flex-1">
            <span className="font-semibold">{clipsPublicatiConRaw.length} clip Pubblicate</span> hanno ancora file grezzi su Drive
            {totalRawSizePublicati > 0 && <span className="text-muted-foreground"> · {formatBytes(totalRawSizePublicati)} liberabili</span>}
          </p>
          <button
            onClick={() => {
              setFiltroPubblicatiConRaw(true);
            }}
            className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[hsl(var(--clr-amber))] text-white hover:opacity-90 transition-opacity"
          >
            Mostra clip da pulire
          </button>
          {filtroPubblicatiConRaw && (
            <button
              onClick={() => setFiltroPubblicatiConRaw(false)}
              className="flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
            >
              ✕ Reset
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <select
            className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground focus:outline-none"
            value={filtroStato}
            onChange={e => setFiltroStato(e.target.value)}
          >
            <option value="">Tutti gli stati</option>
            {STATI.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground focus:outline-none max-w-[190px]"
            value={filtroCliente}
            onChange={e => setFiltroCliente(e.target.value)}
          >
            <option value="">Tutti i clienti</option>
            {clienti.map(c => {
              const count = clips.filter(cl => cl.cliente_id === c.id || cl.cliente_nome === c.nome).length;
              return (
                <option key={c.id} value={c.nome}>
                  {c.nome}{count > 0 ? ` (${count})` : ''}
                </option>
              );
            })}
          </select>

          <select
            className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground focus:outline-none max-w-[150px]"
            value={filtroOperatore}
            onChange={e => setFiltroOperatore(e.target.value)}
          >
            <option value="">Tutti gli operatori</option>
            {team
              .filter(t => clips.some(cl => cl.operatore === t.nome))
              .map(t => {
                const count = clips.filter(cl => cl.operatore === t.nome).length;
                return (
                  <option key={t.id} value={t.nome}>
                    {t.nome} ({count})
                  </option>
                );
              })}
          </select>

          <input
            className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground focus:outline-none w-36"
            placeholder="🔍 Cerca clip…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {groupedRows.length} CLP · {filtered.length} / {clips.length} clip
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowReport(v => !v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${showReport ? 'bg-[hsl(var(--clr-blue))] text-white border-[hsl(var(--clr-blue))]' : 'border-border hover:bg-muted text-foreground'}`}
            >
              📊 Report
            </button>
            <button
              onClick={() => setShowBulkUpload(true)}
              className="px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground text-xs font-medium transition-colors"
              title="Upload clip multiple da Google Drive"
            >
              ☁️ Upload Clip
            </button>
            <button
              onClick={() => setShowNuova(true)}
              className="px-4 py-1.5 rounded-md bg-[hsl(var(--clr-blue))] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              + Nuova Clip
            </button>
          </div>
        </div>
      </div>

      {/* Report panel */}
      {showReport && (
        <div className="flex-shrink-0 border-b border-border bg-card/40 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">📊 Report clip per cliente</span>
            <button onClick={() => setShowReport(false)} className="text-muted-foreground hover:text-foreground text-xs">✕ Chiudi</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="py-1.5 pr-4 text-muted-foreground font-semibold">Cliente</th>
                  <th className="py-1.5 px-3 text-center text-muted-foreground font-semibold">Tot.</th>
                  <th className="py-1.5 px-3 text-center font-semibold" style={{ color: 'hsl(var(--clr-green))' }}>Buona</th>
                  <th className="py-1.5 px-3 text-center font-semibold" style={{ color: 'hsl(var(--muted-foreground))' }}>Grezza</th>
                  <th className="py-1.5 px-3 text-center font-semibold" style={{ color: 'hsl(var(--clr-blue))' }}>Usata</th>
                  <th className="py-1.5 px-3 text-center font-semibold" style={{ color: 'hsl(var(--clr-red))' }}>Scartata</th>
                  <th className="py-1.5 pl-3 text-left font-semibold text-muted-foreground">Qualità %</th>
                </tr>
              </thead>
              <tbody>
                {reportClienti.map(r => {
                  const qualita = r.totale > 0 ? Math.round((r.buona / r.totale) * 100) : 0;
                  const isActive = filtroCliente === r.nome;
                  return (
                    <tr
                      key={r.nome}
                      onClick={() => setFiltroCliente(isActive ? '' : r.nome)}
                      className={`cursor-pointer border-t border-border/40 transition-colors ${isActive ? 'bg-[hsl(var(--clr-blue)/0.12)]' : 'hover:bg-muted/40'}`}
                    >
                      <td className="py-1.5 pr-4 font-medium text-foreground">
                        {isActive && <span className="mr-1 text-[hsl(var(--clr-blue))]">▶</span>}
                        {r.nome}
                      </td>
                      <td className="py-1.5 px-3 text-center font-bold text-foreground">{r.totale}</td>
                      <td className="py-1.5 px-3 text-center font-semibold" style={{ color: 'hsl(var(--clr-green))' }}>{r.buona}</td>
                      <td className="py-1.5 px-3 text-center text-muted-foreground">{r.grezza}</td>
                      <td className="py-1.5 px-3 text-center" style={{ color: 'hsl(var(--clr-blue))' }}>{r.usata}</td>
                      <td className="py-1.5 px-3 text-center" style={{ color: 'hsl(var(--clr-red))' }}>{r.scartata}</td>
                      <td className="py-1.5 pl-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${qualita}%`,
                                background: qualita >= 70 ? 'hsl(var(--clr-green))' : qualita >= 40 ? 'hsl(var(--clr-amber))' : 'hsl(var(--clr-red))',
                              }}
                            />
                          </div>
                          <span className="text-muted-foreground">{qualita}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cliente filter banner */}
      {filtroCliente && reportClienteAttivo && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 border-b border-border bg-[hsl(var(--clr-blue)/0.06)]">
          <span className="text-sm font-semibold text-[hsl(var(--clr-blue))]">🎬 {reportClienteAttivo.nome}</span>
          <span className="text-xs text-muted-foreground">{reportClienteAttivo.totale} clip totali</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[hsl(var(--clr-green)/0.15)] text-[hsl(var(--clr-green))] border border-[hsl(var(--clr-green)/0.3)]">
            ✓ {reportClienteAttivo.buona} Buone
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted text-muted-foreground border border-border">
            {reportClienteAttivo.grezza} Grezze
          </span>
          {reportClienteAttivo.usata > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[hsl(var(--clr-blue)/0.15)] text-[hsl(var(--clr-blue))] border border-[hsl(var(--clr-blue)/0.3)]">
              {reportClienteAttivo.usata} Usate
            </span>
          )}
          <button onClick={() => setFiltroCliente('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground underline">
            ✕ Reset
          </button>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex-shrink-0 flex flex-wrap gap-2 px-4 py-2.5 border-b border-border bg-card/60">
        {STATI.map(s => {
          const cfg = STATO_CFG[s];
          const count = statCounts[s] || 0;
          const active = filtroStato === s;
          return (
            <button
              key={s}
              onClick={() => setFiltroStato(active ? '' : s)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-150"
              style={{
                background: active ? cfg.text : cfg.bg,
                color: active ? '#fff' : cfg.text,
                borderColor: cfg.border,
                boxShadow: active ? `0 2px 8px ${cfg.text}44` : undefined,
              }}
            >
              {s}
              <span className={`rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold ${active ? 'bg-white/30' : ''}`}
                style={!active ? { background: cfg.text + '22' } : undefined}
              >
                {count}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setFiltroStato('')}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline"
        >
          {filtroStato ? 'Reset filtro' : ''}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Caricamento clip…
          </div>
        ) : groupedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <div className="text-4xl mb-2">🎬</div>
            <p className="text-sm">Nessuna clip trovata</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thCls + ' w-6'}></th>
                <th className={thCls}>Clip Sony</th>
                <th className={thCls}>CLP</th>
                <th className={thCls}>Cliente</th>
                <th className={thCls}>Titolo</th>
                <th className={thCls}>Stato Clip</th>
                <th className={thCls}>Fase CLP</th>
                <th className={thCls}>Operatore</th>
                <th className={`${thCls} w-12 text-center`}>FILE</th>
                <th className={`${thCls} w-8 text-center`}>🗑️</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(group => {
                const { key, clp, clips: groupClips, isOrphan } = group;
                const isExpanded = expandedGroups.has(key);
                const firstClip = groupClips[0];

                // Aggregate stato counts
                const statoCounts = groupClips.reduce((acc, c) => {
                  acc[c.stato] = (acc[c.stato] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>);

                // Exported file: find first clip with exported_file_id
                const exportedClip = groupClips.find(c => c.exported_file_id) || null;
                // Representative clip for FileUpload (prefer exportedClip, fallback first)
                const reprClip = exportedClip || firstClip;

                // Sony codes
                const MAX_VISIBLE = 5;
                const codes = groupClips.map(c => c.id_clip);
                const visibleCodes = codes.slice(0, MAX_VISIBLE);
                const hiddenCount = codes.length - MAX_VISIBLE;

                // Operatori unici
                const operatori = [...new Set(groupClips.map(c => c.operatore).filter(Boolean))];

                const isDragTargetGroup = groupClips.some(c => rowDragTarget === c.id);

                return (
                  <React.Fragment key={key}>
                    {/* ── GROUP ROW ── */}
                    <tr
                      className={`hover:bg-muted/40 transition-colors group cursor-pointer border-b border-border/30 ${isDragTargetGroup ? 'bg-primary/5' : ''}`}
                      onClick={() => toggleGroup(key)}
                      onDragOver={e => { e.preventDefault(); setRowDragTarget(firstClip.id); }}
                      onDragLeave={() => setRowDragTarget(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setRowDragTarget(null);
                        const files = Array.from(e.dataTransfer.files).filter(f =>
                          f.type.startsWith('video/') || /\.(mp4|mov|avi|mxf|r3d)$/i.test(f.name)
                        );
                        if (files.length === 0) return;
                        e.stopPropagation();
                        setDropZonePicker({ files, clip: reprClip });
                      }}
                    >
                      {/* Expand toggle */}
                      <td className={`${tdCls} text-center w-6`} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => toggleGroup(key)}
                          className="text-muted-foreground hover:text-foreground text-[11px] w-5 h-5 flex items-center justify-center rounded transition-colors"
                          title={isExpanded ? 'Comprimi' : `Espandi ${groupClips.length} clip`}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>

                      {/* Sony codes as chips */}
                      <td className={`${tdCls} max-w-[220px]`}>
                        <div className="flex flex-wrap gap-1 items-center">
                          {visibleCodes.map(code => (
                            <span
                              key={code}
                              className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[hsl(var(--clr-blue)/0.1)] text-[hsl(var(--clr-blue))] border border-[hsl(var(--clr-blue)/0.25)] cursor-pointer hover:bg-[hsl(var(--clr-blue)/0.18)]"
                              onClick={e => {
                                e.stopPropagation();
                                const c = groupClips.find(x => x.id_clip === code);
                                if (c) setDetailClip(c);
                              }}
                            >
                              {code}
                            </span>
                          ))}
                          {hiddenCount > 0 && (
                            <span className="text-[10px] text-muted-foreground font-medium">
                              +{hiddenCount} altre
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CLP */}
                      <td className={tdCls}>
                        {clp ? (
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {clp.id_display}
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>

                      {/* Cliente */}
                      <td className={`${tdCls} max-w-[120px]`}>
                        <span className="truncate block text-xs text-muted-foreground">
                          {firstClip.cliente_nome || '—'}
                        </span>
                      </td>

                      {/* Titolo */}
                      <td className={`${tdCls} max-w-[180px]`}>
                        <span className="truncate block text-xs">{clp?.titolo || firstClip.titolo || '—'}</span>
                      </td>

                      {/* Stato aggregate */}
                      <td className={tdCls} onClick={e => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(statoCounts)
                            .sort((a, b) => b[1] - a[1])
                            .map(([stato, cnt]) => {
                              const cfg = STATO_CFG[stato] || STATO_CFG['Grezza'];
                              return (
                                <span key={stato}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border"
                                  style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
                                >
                                  {cnt} {stato}
                                </span>
                              );
                            })}
                        </div>
                      </td>

                      {/* Fase CLP */}
                      <td className={tdCls}>
                        {clp ? <FaseBadge fase={clp.fase} /> : <span className="text-xs text-muted-foreground">—</span>}
                      </td>

                      {/* Operatore */}
                      <td className={tdCls}>
                        <span className="text-xs text-muted-foreground">{operatori.join(', ') || '—'}</span>
                      </td>

                      {/* File column — group summary */}
                      <td className={`${tdCls} text-center relative`} onClick={e => e.stopPropagation()}>
                        <GroupFileCell clips={groupClips} clp={clp} reprClip={reprClip} onUpdatedById={updateClipLocally} />
                      </td>

                      {/* Delete group */}
                      <td className={`${tdCls} text-center`} onClick={e => e.stopPropagation()}>
                        {deletingId === key ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={async () => {
                                for (const c of groupClips) await deleteClip(c.id);
                                setDeletingId(null);
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--clr-red))] text-white font-semibold hover:opacity-80"
                            >
                              Sì
                            </button>
                            <button onClick={() => setDeletingId(null)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted">
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeletingId(key)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(var(--clr-red))] transition-all text-sm"
                            title={`Elimina tutte le ${groupClips.length} clip`}
                          >
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* ── EXPANDED: individual clip sub-rows ── */}
                    {isExpanded && groupClips.map(clip => {
                      const isDeleting = deletingId === clip.id;
                      const isDragTarget = rowDragTarget === clip.id;
                      return (
                        <tr key={clip.id}
                          className={`transition-colors group cursor-pointer bg-muted/20 hover:bg-muted/40 ${isDragTarget ? 'bg-primary/5' : ''}`}
                          onClick={() => setDetailClip(clip)}
                          onDragOver={e => { e.preventDefault(); setRowDragTarget(clip.id); }}
                          onDragLeave={() => setRowDragTarget(null)}
                          onDrop={e => {
                            e.preventDefault();
                            setRowDragTarget(null);
                            const files = Array.from(e.dataTransfer.files).filter(f =>
                              f.type.startsWith('video/') || /\.(mp4|mov|avi|mxf|r3d)$/i.test(f.name)
                            );
                            if (files.length === 0) return;
                            e.stopPropagation();
                            setDropZonePicker({ files, clip });
                          }}
                        >
                          {/* indent spacer */}
                          <td className={tdCls}></td>

                          {/* Clip ID */}
                          <td className={`${tdCls} pl-5`}>
                            <span className="font-mono text-[11px] font-semibold text-[hsl(var(--clr-blue))]">
                              ↳ {clip.id_clip}
                            </span>
                          </td>

                          {/* CLP (empty in sub-row) */}
                          <td className={tdCls}></td>

                          {/* Cliente */}
                          <td className={`${tdCls} max-w-[120px]`}>
                            <span className="truncate block text-xs text-muted-foreground">{clip.cliente_nome || '—'}</span>
                          </td>

                          {/* Titolo */}
                          <td className={`${tdCls} max-w-[180px]`}>
                            <span className="truncate block text-xs text-muted-foreground">{clip.titolo || '—'}</span>
                          </td>

                          {/* Stato inline select */}
                          <td className={tdCls} onClick={e => e.stopPropagation()}>
                            <InlineSelect
                              value={clip.stato}
                              options={STATI}
                              onChange={v => handleStatoChange(clip, v)}
                              colorMap={Object.fromEntries(
                                Object.entries(STATO_CFG).map(([k, v]) => [k, { text: v.text, border: v.border }])
                              )}
                            />
                          </td>

                          {/* Fase CLP */}
                          <td className={tdCls}></td>

                          {/* Operatore */}
                          <td className={tdCls}>
                            <span className="text-xs text-muted-foreground">{clip.operatore || '—'}</span>
                          </td>

                          {/* File upload */}
                          <td className={`${tdCls} text-center relative`} onClick={e => e.stopPropagation()}>
                            <ClipFileUpload
                              clip={clip}
                              clp={clp}
                              onUpdated={patch => updateClipLocally(clip.id, patch)}
                              variant="row"
                            />
                          </td>

                          {/* Delete single clip */}
                          <td className={`${tdCls} text-center`} onClick={e => e.stopPropagation()}>
                            {isDeleting ? (
                              <div className="flex items-center gap-1">
                                <button onClick={() => deleteClip(clip.id)}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--clr-red))] text-white font-semibold hover:opacity-80">
                                  Sì
                                </button>
                                <button onClick={() => setDeletingId(null)}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted">
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeletingId(clip.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(var(--clr-red))] transition-all text-sm"
                              >
                                🗑️
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showNuova && (
        <NuovaClipModal
          clienti={clienti}
          team={team}
          onClose={() => setShowNuova(false)}
          onCreated={loadClips}
        />
      )}

      {showBulkUpload && (
        <BulkUploadModal
          clips={clips}
          onClose={() => setShowBulkUpload(false)}
          onUploaded={(clipId, patch) => updateClipLocally(clipId, patch)}
        />
      )}

      {detailClip && (
        <ClipDetailPanel
          clip={detailClip}
          clp={detailClip.contenuto_id ? contenuti[detailClip.contenuto_id] : null}
          team={team}
          onClose={() => setDetailClip(null)}
          onUpdated={patch => {
            updateClipLocally(detailClip.id, patch);
            setDetailClip(prev => prev ? { ...prev, ...patch } : prev);
          }}
        />
      )}

      {cleanupPending && (() => {
        const clip = clips.find(c => c.id === cleanupPending.clipId);
        if (!clip) return null;
        return (
          <AutoCleanupDialog
            clip={clip}
            newValue={cleanupPending.newValue}
            field={cleanupPending.field}
            onConfirm={handleCleanupConfirm}
            onCancel={() => setCleanupPending(null)}
          />
        );
      })()}

      {/* Drop zone picker — appears when dragging files onto a row */}
      {dropZonePicker && (
        <RowDropZonePicker
          files={dropZonePicker.files}
          clip={dropZonePicker.clip}
          onPick={(zone) => {
            const { files, clip } = dropZonePicker;
            setDropZonePicker(null);
            // Store for inline upload trigger — we propagate via a CustomEvent
            const evt = new CustomEvent('row-drop-upload', { detail: { files, zone, clipId: clip.id } });
            window.dispatchEvent(evt);
          }}
          onCancel={() => setDropZonePicker(null)}
        />
      )}
    </div>
  );
}

