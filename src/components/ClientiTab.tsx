import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { toDateStr } from '../lib/dateUtils';
import type { Cliente } from '../types';
import { ClienteLogo } from './ClienteLogo';
import { LogoUploader } from './LogoUploader';
import { PianoEditorialeModal } from './PianoEditorialeModal';

// ─── helpers mese ────────────────────────────────────────────────────────────
function meseRange(year: number, month: number) {
  // month: 0-indexed (0=gen, 11=dic)
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const end = toDateStr(new Date(year, month + 1, 0));
  return { start, end };
}

const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

// ─── helpers ────────────────────────────────────────────────────────────────

const PACCHETTO_COLORS: Record<string, string> = {
  'Tutto':   'bg-[hsl(var(--clr-violet)/0.15)] text-[hsl(var(--clr-violet))] border-[hsl(var(--clr-violet)/0.3)]',
  '8 Reel':  'bg-[hsl(var(--clr-blue)/0.15)]   text-[hsl(var(--clr-blue))]   border-[hsl(var(--clr-blue)/0.3)]',
  'Custom':  'bg-[hsl(var(--clr-amber)/0.15)]  text-[hsl(var(--clr-amber))]  border-[hsl(var(--clr-amber)/0.3)]',
  'Nessuno': 'bg-[hsl(var(--muted))]            text-muted-foreground          border-border',
};

const STATO_COLORS: Record<string, string> = {
  'Attivo':  'bg-[hsl(var(--clr-green)/0.15)]  text-[hsl(var(--clr-green))]  border-[hsl(var(--clr-green)/0.3)]',
  'Sospeso': 'bg-[hsl(var(--clr-amber)/0.15)]  text-[hsl(var(--clr-amber))]  border-[hsl(var(--clr-amber)/0.3)]',
  'Chiuso':  'bg-[hsl(var(--clr-red)/0.15)]    text-[hsl(var(--clr-red))]    border-[hsl(var(--clr-red)/0.3)]',
};

function getInitial(nome: string) {
  return nome.charAt(0).toUpperCase();
}

function clienteColor(nome: string): string {
  // deterministic color from name
  const colors = ['#F59E0B','#EC4899','#06B6D4','#22C55E','#8B5CF6','#EF4444','#3B82F6','#F97316','#14B8A6','#A855F7'];
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = nome.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function progressColor(fatti: number, quota: number): string {
  if (quota === 0) return 'hsl(var(--clr-green))';
  const pct = (fatti / quota) * 100;
  if (pct > 100) return 'hsl(var(--clr-red))';
  if (pct >= 75) return 'hsl(var(--clr-amber))';
  return 'hsl(var(--clr-green))';
}

function progressPct(fatti: number, quota: number): number {
  if (quota === 0) return 0;
  return Math.min((fatti / quota) * 100, 100);
}

function progressLabel(fatti: number, quota: number): string {
  const extra = fatti - quota;
  if (extra > 0) return `+${extra} extra`;
  return `${fatti}/${quota}`;
}

// ─── sub-components ─────────────────────────────────────────────────────────

function ClienteBadge({ text, colorClass }: { text: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}>
      {text}
    </span>
  );
}

function ServizioChip({ label, attivo }: { label: string; attivo: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors
      ${attivo
        ? 'bg-[hsl(var(--clr-blue)/0.12)] text-[hsl(var(--clr-blue))] border-[hsl(var(--clr-blue)/0.25)]'
        : 'bg-muted text-muted-foreground border-border opacity-50'}`}>
      {attivo ? '✅' : '—'} {label}
    </span>
  );
}

function ProgressBar({ fatti, quota, label }: { fatti: number; quota: number; label: string }) {
  const pct = progressPct(fatti, quota);
  const color = progressColor(fatti, quota);
  const over = quota > 0 && fatti > quota;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className={`font-semibold text-xs ${over ? 'text-[hsl(var(--clr-red))]' : 'text-foreground'}`}>
          {quota > 0 ? progressLabel(fatti, quota) : `${fatti} (nessuna quota)`}
        </span>
      </div>
      {quota > 0 && (
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Tripletta Reel 3 mesi ───────────────────────────────────────────────────

interface ReelMese {
  label: string;
  fatti: number;
  quota: number;
  isCurrent: boolean;
}

function ReelTrend({ mesi, quota }: { mesi: ReelMese[]; quota: number }) {
  if (quota === 0) return null;
  return (
    <div className="flex items-end gap-1.5">
      <span className="text-xs text-muted-foreground font-medium mr-0.5">🎬</span>
      {mesi.map((m, i) => {
        const over = m.fatti > quota;
        const pct = Math.min((m.fatti / quota) * 100, 100);
        const barColor = over
          ? 'hsl(var(--clr-red))'
          : pct >= 75
          ? 'hsl(var(--clr-amber))'
          : 'hsl(var(--clr-green))';

        return (
          <div
            key={i}
            className={`flex flex-col items-center gap-0.5 transition-all duration-200 ${m.isCurrent ? 'flex-1' : 'opacity-50 w-8'}`}
          >
            {/* Barra */}
            <div className={`w-full rounded-full bg-muted overflow-hidden ${m.isCurrent ? 'h-2' : 'h-1.5'}`}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
            {/* Contatore */}
            <span
              className={`font-mono tabular-nums leading-none ${
                m.isCurrent
                  ? `font-bold text-sm ${over ? 'text-[hsl(var(--clr-red))]' : 'text-foreground'}`
                  : 'text-[10px] text-muted-foreground'
              }`}
            >
              {m.fatti}/{quota}
            </span>
            {/* Etichetta mese */}
            <span className={`leading-none ${m.isCurrent ? 'text-[10px] font-semibold text-foreground' : 'text-[9px] text-muted-foreground'}`}>
              {m.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card Cliente ────────────────────────────────────────────────────────────

function ClienteCard({
  cliente,
  reelMesi,
  onClick,
}: {
  cliente: Cliente;
  reelMesi: ReelMese[];
  onClick: () => void;
}) {
  const color = clienteColor(cliente.nome);
  const extraGrafiche = Math.max(0, cliente.grafiche_fatte - cliente.grafiche_quota);

  // Alert fine mese corrente
  const now = new Date();
  const giorniFineM = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const currMese = reelMesi.find(m => m.isCurrent);
  const sottoQuota = cliente.stato === 'Attivo' && cliente.reel_quota > 0 && currMese && currMese.fatti < cliente.reel_quota;
  const reelMancanti = Math.max(0, cliente.reel_quota - (currMese?.fatti ?? 0));
  const alertFineMese = sottoQuota && giorniFineM <= 5;
  const overQuota = currMese && currMese.fatti > cliente.reel_quota;

  return (
    <div
      onClick={onClick}
      className={`bg-card border rounded-xl p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 flex flex-col gap-3
        ${alertFineMese ? 'border-[hsl(var(--clr-amber)/0.6)] shadow-[0_0_0_1px_hsl(var(--clr-amber)/0.2)]' : 'border-border'}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <ClienteLogo nome={cliente.nome} logoUrl={cliente.logo_url} size={40} />
          <div className="min-w-0">
            <div className="font-semibold text-sm text-foreground truncate leading-tight">{cliente.nome}</div>
            {cliente.referente && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">{cliente.referente}</div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <ClienteBadge text={cliente.pacchetto} colorClass={PACCHETTO_COLORS[cliente.pacchetto] || PACCHETTO_COLORS['Nessuno']} />
          <ClienteBadge text={cliente.stato} colorClass={STATO_COLORS[cliente.stato] || ''} />
        </div>
      </div>

      {/* Contatori */}
      <div className="space-y-2">
        {/* Tripletta Reel */}
        {cliente.reel_quota > 0 && reelMesi.length === 3 && (
          <ReelTrend mesi={reelMesi} quota={cliente.reel_quota} />
        )}
        {/* Grafiche (barra singola) */}
        <ProgressBar fatti={cliente.grafiche_fatte} quota={cliente.grafiche_quota} label="🖼️ Grafiche" />
        {overQuota && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-[hsl(var(--clr-red))] font-semibold bg-[hsl(var(--clr-red)/0.1)] px-2 py-0.5 rounded-full border border-[hsl(var(--clr-red)/0.25)]">
              ⚠️ {currMese!.fatti - cliente.reel_quota} reel extra fatturabili
            </span>
          </div>
        )}
        {extraGrafiche > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-[hsl(var(--clr-red))] font-semibold bg-[hsl(var(--clr-red)/0.1)] px-2 py-0.5 rounded-full border border-[hsl(var(--clr-red)/0.25)]">
              ⚠️ {extraGrafiche} grafiche extra
            </span>
          </div>
        )}
        {alertFineMese && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-[hsl(var(--clr-amber))] font-semibold bg-[hsl(var(--clr-amber)/0.1)] px-2 py-0.5 rounded-full border border-[hsl(var(--clr-amber)/0.25)]">
              🔔 {reelMancanti} reel mancanti — {giorniFineM}gg al fine mese
            </span>
          </div>
        )}
      </div>

      {/* Servizi */}
      <div className="flex flex-wrap gap-1">
        <ServizioChip label="Stories" attivo={cliente.stories_attivo} />
        <ServizioChip label="Andromeda" attivo={cliente.andromeda_attivo} />
        <ServizioChip label={`Sito ${cliente.sito_web !== 'No' ? cliente.sito_web : 'Web'}`} attivo={cliente.sito_web !== 'No'} />
        <ServizioChip label="ADV" attivo={cliente.adv_attivo} />
      </div>

      {/* Footer */}
      {cliente.telefono && (
        <div className="pt-1 border-t border-border text-xs text-muted-foreground flex items-center gap-1">
          📞 {cliente.telefono}
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  cliente: Cliente;
  onClose: () => void;
  onUpdate: (updated: Cliente) => void;
  onDelete: (id: string) => void;
}

function DetailPanel({ cliente, onClose, onUpdate, onDelete }: DetailPanelProps) {
  const { addToast } = useApp();
  const [form, setForm] = useState<Cliente>({ ...cliente });
  const [saving, setSaving] = useState(false);
  const [showPianoEditoriale, setShowPianoEditoriale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // sync if cliente changes from outside
  useEffect(() => { setForm({ ...cliente }); }, [cliente.id]);

  function set(key: keyof Cliente, val: unknown) {
    setForm(prev => {
      const next = { ...prev, [key]: val };
      // Auto-popola reel_quota quando si cambia pacchetto
      if (key === 'pacchetto') {
        if (val === '8 Reel' && next.reel_quota !== 8) next.reel_quota = 8;
        if (val === 'Tutto' && next.reel_quota === 0) next.reel_quota = 8;
        if (val === 'Nessuno') next.reel_quota = 0;
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from('clienti')
      .update({
        nome: form.nome,
        referente: form.referente,
        email: form.email,
        telefono: form.telefono,
        indirizzo: form.indirizzo,
        p_iva: form.p_iva,
        codice_fiscale: form.codice_fiscale,
        settore: form.settore,
        stato: form.stato,
        pacchetto: form.pacchetto,
        reel_quota: form.reel_quota,
        reel_fatti: form.reel_fatti,
        grafiche_quota: form.grafiche_quota,
        grafiche_fatte: form.grafiche_fatte,
        stories_attivo: form.stories_attivo,
        andromeda_attivo: form.andromeda_attivo,
        sito_web: form.sito_web,
        adv_attivo: form.adv_attivo,
        data_inizio: form.data_inizio || null,
        note: form.note,
      })
      .eq('id', cliente.id);

    setSaving(false);
    if (error) { addToast('❌ Errore salvataggio', 'error'); return; }
    addToast('✅ Cliente salvato', 'success');
    onUpdate({ ...form });
  }

  async function handleDelete() {
    const { error } = await supabase.from('clienti').delete().eq('id', cliente.id);
    if (error) { addToast('❌ Errore eliminazione', 'error'); return; }
    addToast('🗑️ Cliente eliminato', 'warn');
    onDelete(cliente.id);
  }

  const color = clienteColor(form.nome);
  const extraReel = Math.max(0, form.reel_fatti - form.reel_quota);
  const extraGrafiche = Math.max(0, form.grafiche_fatte - form.grafiche_quota);

  const inputCls = "w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--clr-blue)/0.4)]";
  const labelCls = "text-xs font-medium text-muted-foreground mb-0.5 block";
  const sectionCls = "border-t border-border pt-4 mt-4";

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/30 pointer-events-auto" onClick={onClose} />
      {/* panel */}
      <div className="absolute right-0 top-0 h-full w-[400px] max-w-full bg-card shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-200">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
            style={{ background: color }}
          >
            {getInitial(form.nome)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-foreground truncate">{form.nome}</div>
            <div className="text-xs text-muted-foreground">{form.id_display}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl ml-2">✕</button>
        </div>

        {/* scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">

          {/* ─── Google Drive ─── */}
          {(form as any).link_drive ? (
            <div className="rounded-xl p-3 border mb-2" style={{ background: 'hsl(214 100% 98%)', borderColor: 'hsl(214 80% 85%)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'hsl(214 60% 40%)' }}>📁 Google Drive</span>
              </div>
              <a
                href={(form as any).link_drive}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #c5d8fd' }}
              >
                <span>📂</span>
                <span className="flex-1 truncate">{form.id_display} – {form.nome}</span>
                <span className="text-xs opacity-60">↗ Apri</span>
              </a>
            </div>
          ) : null}

          {/* ─── Piano Editoriale ─── */}
          <button
            onClick={() => setShowPianoEditoriale(true)}
            className="w-full rounded-xl p-3 border mb-2 flex items-center gap-2 text-sm font-medium transition-all hover:opacity-80"
            style={{ background: 'hsl(270 60% 98%)', borderColor: 'hsl(270 60% 85%)', color: 'hsl(270 60% 40%)' }}
          >
            <span>📋</span>
            <span className="flex-1 text-left">Scarica Piano Editoriale</span>
            <span className="text-xs opacity-60">PDF ↓</span>
          </button>

          {/* Stato & Pacchetto */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Stato</label>
              <select className={inputCls} value={form.stato} onChange={e => set('stato', e.target.value as Cliente['stato'])}>
                <option>Attivo</option>
                <option>Sospeso</option>
                <option>Chiuso</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Pacchetto</label>
              <select className={inputCls} value={form.pacchetto} onChange={e => set('pacchetto', e.target.value as Cliente['pacchetto'])}>
                <option>Tutto</option>
                <option>8 Reel</option>
                <option>Custom</option>
                <option>Nessuno</option>
              </select>
            </div>
          </div>

          {/* Contatori */}
          <div className={sectionCls}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">📊 Contatori mese corrente</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Reel fatti</label>
                <input type="number" min={0} className={inputCls} value={form.reel_fatti}
                  onChange={e => set('reel_fatti', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>Reel quota/mese</label>
                <input type="number" min={0} className={inputCls} value={form.reel_quota}
                  onChange={e => set('reel_quota', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>Grafiche fatte</label>
                <input type="number" min={0} className={inputCls} value={form.grafiche_fatte}
                  onChange={e => set('grafiche_fatte', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>Grafiche quota/mese</label>
                <input type="number" min={0} className={inputCls} value={form.grafiche_quota}
                  onChange={e => set('grafiche_quota', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            {(extraReel > 0 || extraGrafiche > 0) && (
              <div className="mt-2 text-xs text-[hsl(var(--clr-red))] bg-[hsl(var(--clr-red)/0.08)] rounded-lg px-3 py-2 border border-[hsl(var(--clr-red)/0.2)]">
                ⚠️ Extra: {extraReel > 0 ? `${extraReel} reel` : ''}{extraReel > 0 && extraGrafiche > 0 ? ', ' : ''}{extraGrafiche > 0 ? `${extraGrafiche} grafiche` : ''} — da fatturare
              </div>
            )}
          </div>

          {/* Servizi pacchetto */}
          <div className={sectionCls}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">⚙️ Servizi pacchetto</p>
            <div className="space-y-2">
              {/* toggle rows */}
              {[
                { key: 'stories_attivo', label: '📱 Stories' },
                { key: 'andromeda_attivo', label: '🌀 Andromeda' },
                { key: 'adv_attivo', label: '📣 ADV' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-foreground">{label}</span>
                  <button
                    type="button"
                    onClick={() => set(key as keyof Cliente, !(form as Record<string, unknown>)[key])}
                    className={`relative inline-flex h-5 w-9 rounded-full transition-colors border-2 border-transparent focus:outline-none
                      ${(form as Record<string, unknown>)[key] ? 'bg-[hsl(var(--clr-blue))]' : 'bg-muted'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform
                      ${(form as Record<string, unknown>)[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </label>
              ))}
              <div>
                <label className={labelCls}>🌐 Sito Web</label>
                <select className={inputCls} value={form.sito_web} onChange={e => set('sito_web', e.target.value as Cliente['sito_web'])}>
                  <option>No</option>
                  <option>In corso</option>
                  <option>Consegnato</option>
                </select>
              </div>
            </div>
          </div>

          {/* Anagrafica */}
          <div className={sectionCls}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">👤 Anagrafica</p>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Logo</label>
                <LogoUploader
                  clienteId={cliente.id}
                  clienteNome={form.nome}
                  currentLogoUrl={form.logo_url}
                  onSaved={(url) => setForm(prev => ({ ...prev, logo_url: url || null }))}
                />
              </div>
              <div>
                <label className={labelCls}>Nome *</label>
                <input className={inputCls} value={form.nome} onChange={e => set('nome', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Referente</label>
                <input className={inputCls} value={form.referente} onChange={e => set('referente', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Telefono</label>
                  <input className={inputCls} value={form.telefono} onChange={e => set('telefono', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Indirizzo</label>
                <input className={inputCls} value={form.indirizzo} onChange={e => set('indirizzo', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>P.IVA</label>
                  <input className={inputCls} value={form.p_iva} onChange={e => set('p_iva', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Cod. Fiscale</label>
                  <input className={inputCls} value={form.codice_fiscale} onChange={e => set('codice_fiscale', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Settore</label>
                  <input className={inputCls} value={form.settore} onChange={e => set('settore', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Data inizio</label>
                  <input type="date" className={inputCls} value={form.data_inizio || ''} onChange={e => set('data_inizio', e.target.value || null)} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Note</label>
                <textarea rows={3} className={`${inputCls} resize-none`} value={form.note} onChange={e => set('note', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div className={sectionCls}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2 rounded-lg text-sm font-medium text-[hsl(var(--clr-red))] border border-[hsl(var(--clr-red)/0.3)] hover:bg-[hsl(var(--clr-red)/0.08)] transition-colors"
              >
                🗑️ Elimina cliente {form.id_display}
              </button>
            ) : (
              <div className="rounded-lg border border-[hsl(var(--clr-red)/0.4)] bg-[hsl(var(--clr-red)/0.06)] p-3 space-y-2">
                <p className="text-sm text-[hsl(var(--clr-red))] font-medium">Sei sicuro? Questa azione è irreversibile.</p>
                <div className="flex gap-2">
                  <button onClick={handleDelete} className="flex-1 py-1.5 rounded-md text-sm font-semibold bg-[hsl(var(--clr-red))] text-white hover:opacity-90 transition-opacity">
                    Sì, elimina
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 rounded-md text-sm font-medium border border-border hover:bg-muted transition-colors">
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-4" />
        </div>

        {/* footer save */}
        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[hsl(var(--clr-blue))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio…' : '💾 Salva modifiche'}
          </button>
        </div>
      </div>
      {showPianoEditoriale && (
        <PianoEditorialeModal cliente={cliente} onClose={() => setShowPianoEditoriale(false)} />
      )}
    </div>
  );
}

// ─── Modal Nuovo Cliente ──────────────────────────────────────────────────────

function NuovoClienteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Cliente) => void }) {
  const { addToast } = useApp();
  const [form, setForm] = useState({
    nome: '',
    referente: '',
    email: '',
    telefono: '',
    pacchetto: 'Nessuno' as Cliente['pacchetto'],
    settore: 'Estetica',
    reel_quota: 0,
    grafiche_quota: 0,
  });
  const [loading, setLoading] = useState(false);

  function set(k: string, v: unknown) { setForm(p => ({ ...p, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) { addToast('⚠️ Nome obbligatorio', 'warn'); return; }
    setLoading(true);

    const { data: idData, error: idErr } = await supabase.rpc('generate_display_id', {
      prefix: 'CLI',
      seq_name: 'cli_seq',
    });
    if (idErr || !idData) { addToast('❌ Errore generazione ID', 'error'); setLoading(false); return; }

    const { data, error } = await supabase
      .from('clienti')
      .insert({
        id_display: idData as string,
        nome: form.nome.trim(),
        referente: form.referente,
        email: form.email,
        telefono: form.telefono,
        pacchetto: form.pacchetto,
        settore: form.settore,
        reel_quota: form.reel_quota,
        grafiche_quota: form.grafiche_quota,
        stato: 'Attivo',
      })
      .select()
      .single();

    if (error || !data) { addToast('❌ Errore creazione cliente', 'error'); setLoading(false); return; }

    // ─── Crea cartella Drive automaticamente ───
    addToast('📁 Creo cartella Drive…', 'info');
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const driveRes = await fetch(`${supabaseUrl}/functions/v1/create-client-drive-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({
          cliente_id: data.id,
          cliente_nome: data.nome,
          id_display: data.id_display,
        }),
      });
      const driveResult = await driveRes.json();
      if (driveResult.success) {
        addToast(`📁 Cartella Drive creata per ${data.nome}!`, 'success');
        // Ricarica il cliente aggiornato con link_drive
        const { data: fresh } = await supabase.from('clienti').select('*').eq('id', data.id).single();
        onCreated((fresh || data) as Cliente);
      } else {
        addToast(`⚠️ Drive: ${driveResult.error}`, 'warn');
        onCreated(data as Cliente);
      }
    } catch {
      addToast('⚠️ Errore cartella Drive (cliente creato)', 'warn');
      onCreated(data as Cliente);
    }

    setLoading(false);
    onClose();
  }

  const inputCls = "w-full border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--clr-blue)/0.4)]";
  const labelCls = "text-xs font-medium text-muted-foreground mb-0.5 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base text-foreground">👥 Nuovo Cliente</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>Nome cliente *</label>
            <input autoFocus className={inputCls} placeholder="es: Saturday Beauty Center" value={form.nome}
              onChange={e => set('nome', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Referente</label>
              <input className={inputCls} placeholder="Nome referente" value={form.referente}
                onChange={e => set('referente', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Settore</label>
              <input className={inputCls} value={form.settore} onChange={e => set('settore', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Telefono</label>
              <input className={inputCls} value={form.telefono} onChange={e => set('telefono', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Pacchetto</label>
            <select className={inputCls} value={form.pacchetto}
              onChange={e => set('pacchetto', e.target.value)}>
              <option>Tutto</option>
              <option>8 Reel</option>
              <option>Custom</option>
              <option>Nessuno</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Reel/mese inclusi</label>
              <input type="number" min={0} className={inputCls} value={form.reel_quota}
                onChange={e => set('reel_quota', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Grafiche/mese incluse</label>
              <input type="number" min={0} className={inputCls} value={form.grafiche_quota}
                onChange={e => set('grafiche_quota', parseInt(e.target.value) || 0)} />
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">
              Annulla
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[hsl(var(--clr-blue))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? 'Creazione…' : '✅ Crea cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

// ─── tipo per la mappa reel per cliente ──────────────────────────────────────
type ReelMap = Record<string, { prev: number; curr: number; next: number }>;

export function ClientiTab() {
  const { addToast } = useApp();
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [reelMap, setReelMap] = useState<ReelMap>({});
  const [loading, setLoading] = useState(true);
  const [filtroStato, setFiltroStato] = useState<string>('Attivo');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Cliente | null>(null);
  const [showNuovo, setShowNuovo] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);

  // Mesi dinamici: precedente, corrente, prossimo
  const now = new Date();
  const currY = now.getFullYear();
  const currM = now.getMonth(); // 0-indexed

  const prevRange = meseRange(currY, currM === 0 ? 11 : currM - 1);
  const prevYear  = currM === 0 ? currY - 1 : currY;
  const prevRangeFixed = meseRange(prevYear, currM === 0 ? 11 : currM - 1);

  const currRange = meseRange(currY, currM);
  const nextRange = meseRange(currM === 11 ? currY + 1 : currY, (currM + 1) % 12);

  const giorniFineM = new Date(currY, currM + 1, 0).getDate() - now.getDate();

  // Calcola contatori 3 mesi per tutti i clienti
  const ricalcolaContatori = useCallback(async (clientiData: Cliente[]) => {
    const { data: clps } = await supabase
      .from('contenuti')
      .select('cliente_id, tipo, fase, data_pubblicazione')
      .eq('tipo', 'Reel')
      .in('fase', ['Programmato', 'Pubblicato']);

    if (!clps) return { clientiData, map: {} as ReelMap };

    const map: ReelMap = {};
    clps.forEach(c => {
      if (!c.cliente_id || !c.data_pubblicazione) return;
      const dp = c.data_pubblicazione;
      if (!map[c.cliente_id]) map[c.cliente_id] = { prev: 0, curr: 0, next: 0 };
      if (dp >= prevRangeFixed.start && dp <= prevRangeFixed.end) map[c.cliente_id].prev++;
      else if (dp >= currRange.start && dp <= currRange.end) map[c.cliente_id].curr++;
      else if (dp >= nextRange.start && dp <= nextRange.end) map[c.cliente_id].next++;
    });

    // Aggiorna DB reel_fatti con il conteggio del mese corrente
    await Promise.all(
      clientiData
        .filter(c => c.stato === 'Attivo' && c.reel_quota > 0)
        .map(c => {
          const n = map[c.id]?.curr ?? 0;
          return supabase.from('clienti').update({ reel_fatti: n }).eq('id', c.id);
        })
    );

    const updated = clientiData.map(c => ({ ...c, reel_fatti: map[c.id]?.curr ?? 0 }));
    return { clientiData: updated, map };
  }, [prevRangeFixed.start, prevRangeFixed.end, currRange.start, currRange.end, nextRange.start, nextRange.end]);

  // Se siamo a ≤5 giorni dalla fine mese, crea task alert per Elisa
  const checkQuoteInsufficienti = useCallback(async (clientiData: Cliente[]) => {
    if (giorniFineM > 5) return;

    const sottoQuota = clientiData.filter(c =>
      c.stato === 'Attivo' && c.reel_quota > 0 && c.reel_fatti < c.reel_quota
    );
    if (sottoQuota.length === 0) return;

    const meseLabel = currRange.start.slice(0, 7);
    const { data: existingTasks } = await supabase
      .from('task')
      .select('id, descrizione')
      .eq('assegnato_a', 'Elisa')
      .eq('tipo', 'Alert Quota')
      .gte('created_at', currRange.start);

    const existingDesc = (existingTasks || []).map(t => t.descrizione);
    const nuovi = sottoQuota.filter(c => !existingDesc.some(d => d.includes(c.id_display)));
    if (nuovi.length === 0) return;

    const descrizione = `⚠️ Quota Reel insufficiente (${meseLabel}): ${nuovi.map(c => `${c.nome} ${c.reel_fatti}/${c.reel_quota}`).join(', ')}`;
    await supabase.from('task').insert({
      tipo: 'Alert Quota',
      descrizione,
      assegnato_a: 'Elisa',
      assegnato_da: 'Sistema',
      priorita: '🔴 Alta',
      stato: 'Da fare',
      scadenza: currRange.end,
    });
  }, [giorniFineM, currRange.start, currRange.end]);

  const loadClienti = useCallback(async () => {
    const { data } = await supabase.from('clienti').select('*').order('nome');
    const raw = (data || []) as Cliente[];
    const { clientiData: aggiornati, map } = await ricalcolaContatori(raw);
    setClienti(aggiornati);
    setReelMap(map);
    setLoading(false);
    await checkQuoteInsufficienti(aggiornati);
  }, [ricalcolaContatori, checkQuoteInsufficienti]);

  useEffect(() => { loadClienti(); }, [loadClienti]);

  // Costruisce la tripletta per un cliente
  function buildReelMesi(c: Cliente): ReelMese[] {
    const m = reelMap[c.id] ?? { prev: 0, curr: 0, next: 0 };
    return [
      { label: MESI_IT[currM === 0 ? 11 : currM - 1], fatti: m.prev, quota: c.reel_quota, isCurrent: false },
      { label: MESI_IT[currM],                          fatti: m.curr, quota: c.reel_quota, isCurrent: true  },
      { label: MESI_IT[(currM + 1) % 12],               fatti: m.next, quota: c.reel_quota, isCurrent: false },
    ];
  }

  const filtered = clienti.filter(c => {
    if (filtroStato !== 'Tutti' && c.stato !== filtroStato) return false;
    if (search) {
      const s = search.toLowerCase();
      return c.nome.toLowerCase().includes(s) ||
        (c.referente || '').toLowerCase().includes(s) ||
        c.id_display.toLowerCase().includes(s);
    }
    return true;
  });

  function updateCliente(updated: Cliente) {
    setClienti(prev => prev.map(c => c.id === updated.id ? updated : c));
    if (selected?.id === updated.id) setSelected(updated);
  }

  function deleteCliente(id: string) {
    setClienti(prev => prev.filter(c => c.id !== id));
    setSelected(null);
  }

  async function handleFix() {
    setFixLoading(true);
    await loadClienti();
    addToast('🔧 Contatori ricalcolati (3 mesi: prev/curr/next)', 'success');
    setFixLoading(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-card">
        <select
          value={filtroStato}
          onChange={e => setFiltroStato(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--clr-blue)/0.4)]"
        >
          <option value="Tutti">Tutti gli stati</option>
          <option value="Attivo">Attivo</option>
          <option value="Sospeso">Sospeso</option>
          <option value="Chiuso">Chiuso</option>
        </select>

        <input
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--clr-blue)/0.4)] w-48"
          placeholder="🔍 Cerca cliente…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-xs text-muted-foreground ml-1">
          {filtered.length} / {clienti.length} clienti
        </span>

        <div className="ml-auto flex gap-2">
          <button
            onClick={handleFix}
            disabled={fixLoading}
            className="px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {fixLoading ? '⟳ Fix…' : '🔧 Fix contatori'}
          </button>
          <button
            onClick={() => setShowNuovo(true)}
            className="px-4 py-1.5 rounded-md bg-[hsl(var(--clr-blue))] text-white text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-1"
          >
            + Nuovo Cliente
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Caricamento clienti…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <div className="text-4xl mb-2">👥</div>
            <p className="text-sm">Nessun cliente trovato</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(c => (
              <ClienteCard
                key={c.id}
                cliente={c}
                reelMesi={buildReelMesi(c)}
                onClick={() => setSelected(c)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          cliente={selected}
          onClose={() => setSelected(null)}
          onUpdate={updateCliente}
          onDelete={deleteCliente}
        />
      )}

      {/* Modal nuovo */}
      {showNuovo && (
        <NuovoClienteModal
          onClose={() => setShowNuovo(false)}
          onCreated={c => setClienti(prev => [c, ...prev])}
        />
      )}
    </div>
  );
}
