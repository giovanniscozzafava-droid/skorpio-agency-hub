import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { LogRipresa, Cliente, TeamMember, Contenuto } from '../types';

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

// Inline select for stato / formato
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

  // CLP picker state
  const [clpMode, setClpMode] = useState<'nuovo' | string>('nuovo'); // 'nuovo' or contenuto.id
  const [clpSenzaClip, setClpSenzaClip] = useState<Contenuto[]>([]);
  const [clpConClip, setClpConClip] = useState<Contenuto[]>([]);
  const [clpClipCount, setClpClipCount] = useState<Record<string, string[]>>({});

  const [form, setForm] = useState({
    codici: '',           // comma-separated Sony codes
    titolo: '',
    clienteId: '',
    clienteNome: '',
    stato: 'Grezza' as LogRipresa['stato'],
    formato: '',
    operatore: '',
  });
  const [loading, setLoading] = useState(false);

  // load CLP data on mount
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

  // auto-fill cliente when CLP is selected
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

  // infobox content
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

    // If "Genera nuovo CLP" — create contenuto first
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

    // Insert one row per Sony code
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

    addToast(`✅ ${rawCodes.length} clip inserita${rawCodes.length > 1 ? 'e' : ''}!`, 'success');
    onCreated();
    onClose();
  }

  const inputCls = "w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--clr-blue)/0.4)]";
  const labelCls = "text-xs font-medium text-muted-foreground mb-0.5 block";
  const isClpSelected = clpMode !== 'nuovo';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-lg border border-border animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-base text-foreground">🎬 Nuova Clip</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

          {/* Codici Sony */}
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

          {/* CLP selector */}
          <div>
            <label className={labelCls}>Contenuto CLP</label>
            <select className={inputCls} value={clpMode} onChange={e => handleClpChange(e.target.value)}>
              <option value="nuovo">🆕 Genera nuovo CLP</option>
              {clpSenzaClip.length > 0 && (
                <optgroup label={`📋 CLP senza clip (${clpSenzaClip.length})`}>
                  {clpSenzaClip.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.id_display} — {c.titolo} [{c.cliente_nome}]
                    </option>
                  ))}
                </optgroup>
              )}
              {clpConClip.length > 0 && (
                <optgroup label={`🎬 CLP con clip (${clpConClip.length})`}>
                  {clpConClip.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.id_display} — {c.titolo} [{c.cliente_nome}]
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* Info box */}
            {infoBox && (
              <div className="mt-1.5 rounded-lg px-3 py-2 text-xs font-medium border"
                style={{ background: infoBox.bg, borderColor: infoBox.border, color: infoBox.color }}>
                {infoBox.text}
              </div>
            )}
          </div>

          {/* Cliente */}
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

          {/* Titolo */}
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

          {/* Formato + Operatore */}
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

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface RipreseTabProps {
  clienti: Cliente[];
  team: TeamMember[];
}

export function RipreseTab({ clienti, team }: RipreseTabProps) {
  const { addToast } = useApp();
  const [clips, setClips] = useState<LogRipresa[]>([]);
  const [contenuti, setContenuti] = useState<Record<string, Contenuto>>({});
  const [loading, setLoading] = useState(true);
  const [filtroStato, setFiltroStato] = useState<string>('');  // '' = tutti
  const [filtroCliente, setFiltroCliente] = useState('');
  const [search, setSearch] = useState('');
  const [showNuova, setShowNuova] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadClips = useCallback(async () => {
    const { data } = await supabase
      .from('log_riprese')
      .select('*')
      .order('created_at', { ascending: false });
    setClips((data || []) as LogRipresa[]);
    setLoading(false);

    // load related contenuti
    const ids = [...new Set((data || []).map((c: LogRipresa) => c.contenuto_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: clps } = await supabase.from('contenuti').select('*').in('id', ids);
      const map: Record<string, Contenuto> = {};
      (clps || []).forEach((c: Contenuto) => { map[c.id] = c; });
      setContenuti(map);
    }
  }, []);

  useEffect(() => { loadClips(); }, [loadClips]);

  // Stats per stato
  const statCounts = STATI.reduce((acc, s) => {
    acc[s] = clips.filter(c => c.stato === s).length;
    return acc;
  }, {} as Record<string, number>);

  // Filtered
  const filtered = clips.filter(c => {
    if (filtroStato && c.stato !== filtroStato) return false;
    if (filtroCliente && c.cliente_id !== filtroCliente) return false;
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

  async function updateClip(id: string, patch: Partial<LogRipresa>) {
    const { error } = await supabase.from('log_riprese').update(patch).eq('id', id);
    if (error) { addToast('❌ Errore aggiornamento', 'error'); return; }
    setClips(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
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

      {/* Toolbar */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-card">
        <select
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none"
          value={filtroStato}
          onChange={e => setFiltroStato(e.target.value)}
        >
          <option value="">Tutti gli stati</option>
          {STATI.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none max-w-[180px]"
          value={filtroCliente}
          onChange={e => setFiltroCliente(e.target.value)}
        >
          <option value="">Tutti i clienti</option>
          {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        <input
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none w-44"
          placeholder="🔍 Cerca clip…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-xs text-muted-foreground">
          {filtered.length} / {clips.length} clip
        </span>

        <div className="ml-auto">
          <button
            onClick={() => setShowNuova(true)}
            className="px-4 py-1.5 rounded-md bg-[hsl(var(--clr-blue))] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            + Nuova Clip
          </button>
        </div>
      </div>

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
              <span className={`rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold
                ${active ? 'bg-white/30' : ''}`}
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <div className="text-4xl mb-2">🎬</div>
            <p className="text-sm">Nessuna clip trovata</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thCls}>Clip Sony</th>
                <th className={thCls}>CLP</th>
                <th className={thCls}>Cliente</th>
                <th className={thCls}>Titolo</th>
                <th className={thCls}>Stato Clip</th>
                <th className={thCls}>Fase CLP</th>
                <th className={thCls}>Formato</th>
                <th className={thCls}>Operatore</th>
                <th className={`${thCls} w-8 text-center`}>🗑️</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(clip => {
                const clp = clip.contenuto_id ? contenuti[clip.contenuto_id] : null;
                const isDeleting = deletingId === clip.id;
                return (
                  <tr key={clip.id}
                    className="hover:bg-muted/40 transition-colors group"
                  >
                    {/* Clip ID */}
                    <td className={`${tdCls} font-mono font-semibold text-[hsl(var(--clr-blue))]`}>
                      {clip.id_clip}
                    </td>

                    {/* CLP */}
                    <td className={tdCls}>
                      {clip.id_contenuto_display ? (
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {clip.id_contenuto_display}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>

                    {/* Cliente */}
                    <td className={`${tdCls} max-w-[120px]`}>
                      <span className="truncate block text-xs text-muted-foreground">
                        {clip.cliente_nome || '—'}
                      </span>
                    </td>

                    {/* Titolo */}
                    <td className={`${tdCls} max-w-[180px]`}>
                      <span className="truncate block text-xs">{clip.titolo || '—'}</span>
                    </td>

                    {/* Stato inline select */}
                    <td className={tdCls}>
                      <InlineSelect
                        value={clip.stato}
                        options={STATI}
                        onChange={v => updateClip(clip.id, { stato: v as LogRipresa['stato'] })}
                        colorMap={Object.fromEntries(
                          Object.entries(STATO_CFG).map(([k, v]) => [k, { text: v.text, border: v.border }])
                        )}
                      />
                    </td>

                    {/* Fase CLP badge */}
                    <td className={tdCls}>
                      {clp ? <FaseBadge fase={clp.fase} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </td>

                    {/* Formato inline select */}
                    <td className={tdCls}>
                      <InlineSelect
                        value={clip.formato || ''}
                        options={['', ...FORMATI]}
                        onChange={v => updateClip(clip.id, { formato: v })}
                      />
                    </td>

                    {/* Operatore */}
                    <td className={tdCls}>
                      <span className="text-xs text-muted-foreground">{clip.operatore || '—'}</span>
                    </td>

                    {/* Delete */}
                    <td className={`${tdCls} text-center`}>
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
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showNuova && (
        <NuovaClipModal
          clienti={clienti}
          team={team}
          onClose={() => setShowNuova(false)}
          onCreated={loadClips}
        />
      )}
    </div>
  );
}
