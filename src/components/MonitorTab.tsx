import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { ClienteLogo } from './ClienteLogo';

// ── Types ────────────────────────────────────────────────────────────────────
interface Monitor {
  id: string;
  cliente_id: string | null;
  cliente_nome: string;
  nome: string;
  slug: string;
  orientamento: 'orizzontale' | 'verticale';
  risoluzione: string;
  durata_immagine: number;
  transizione: 'fade' | 'slide' | 'taglio';
  attivo: boolean;
  created_at: string;
}

interface MonitorContenuto {
  id: string;
  monitor_id: string;
  cliente_id: string | null;
  titolo: string;
  tipo: 'immagine' | 'video';
  drive_file_id: string | null;
  drive_url: string | null;
  thumbnail_url: string | null;
  durata_secondi: number;
  ordine: number;
  attivo: boolean;
}

interface MonitorFascia {
  id: string;
  monitor_id: string;
  nome_fascia: string;
  giorni: string[];
  ora_inizio: string;
  ora_fine: string;
  contenuti_ids: string[];
  transizione: string | null;
  attivo: boolean;
}

interface Cliente {
  id: string;
  nome: string;
  logo_url?: string | null;
}

const GIORNI_LABELS: Record<string, string> = { lun: 'Lun', mar: 'Mar', mer: 'Mer', gio: 'Gio', ven: 'Ven', sab: 'Sab', dom: 'Dom' };
const GIORNI_ALL = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

// ── Main Component ───────────────────────────────────────────────────────────
export function MonitorTab({ clienti }: { clienti: Cliente[] }) {
  const { addToast } = useApp();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<Monitor | null>(null);
  const [contenuti, setContenuti] = useState<MonitorContenuto[]>([]);
  const [fasce, setFasce] = useState<MonitorFascia[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // ── Load monitors ──────────────────────────────────────────────────────────
  const loadMonitors = useCallback(async () => {
    const { data } = await supabase.from('monitor').select('*').order('cliente_nome');
    setMonitors((data as Monitor[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadMonitors(); }, [loadMonitors]);

  // ── Load contenuti + fasce when monitor selected ───────────────────────────
  const loadDetails = useCallback(async (monitorId: string) => {
    const [{ data: c }, { data: f }] = await Promise.all([
      supabase.from('monitor_contenuti').select('*').eq('monitor_id', monitorId).order('ordine'),
      supabase.from('monitor_fasce').select('*').eq('monitor_id', monitorId).order('ora_inizio'),
    ]);
    setContenuti((c as MonitorContenuto[]) || []);
    setFasce((f as MonitorFascia[]) || []);
  }, []);

  useEffect(() => {
    if (selected) loadDetails(selected.id);
  }, [selected, loadDetails]);

  // ── Back to list ───────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
              🖥️ Palinsesto Monitor
            </h1>
            <p className="text-sm mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              Gestione contenuti monitor pubblicitari
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#3B82F6' }}
          >
            + Nuovo Monitor
          </button>
        </div>

        {/* Monitor list */}
        {loading ? (
          <p className="text-sm text-center py-12" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Caricamento…</p>
        ) : monitors.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-5xl block mb-4">🖥️</span>
            <p className="text-sm" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessun monitor configurato</p>
            <button onClick={() => setShowNew(true)} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>
              + Aggiungi il primo monitor
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {monitors.map(m => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="rounded-xl border p-4 text-left hover:shadow-lg transition-all"
                style={{ background: 'hsl(var(--card))', borderColor: m.attivo ? '#3B82F640' : 'hsl(var(--border))' }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-3xl">{m.orientamento === 'orizzontale' ? '🖥️' : '📱'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{m.nome}</p>
                    <p className="text-xs truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{m.cliente_nome}</p>
                  </div>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${m.attivo ? 'animate-pulse' : ''}`}
                    style={{ background: m.attivo ? '#22C55E' : '#94A3B8' }} />
                </div>
                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>
                    {m.orientamento === 'orizzontale' ? '⬛ 16:9' : '⬜ 9:16'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>
                    {m.risoluzione}
                  </span>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>
                    {m.transizione}
                  </span>
                </div>
                <div className="mt-3 text-[10px] font-mono truncate" style={{ color: '#3B82F6' }}>
                  /tv/{m.slug}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* New monitor modal */}
        {showNew && <NewMonitorModal clienti={clienti} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); loadMonitors(); addToast('✅ Monitor creato!', 'success'); }} />}
      </div>
    );
  }

  // ── Monitor Detail View ────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setSelected(null)} className="text-sm px-3 py-1.5 rounded-lg" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
          ← Indietro
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {selected.orientamento === 'orizzontale' ? '🖥️' : '📱'} {selected.nome}
          </h1>
          <p className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{selected.cliente_nome} · /tv/{selected.slug}</p>
        </div>
        <div className={`w-3 h-3 rounded-full ${selected.attivo ? 'animate-pulse' : ''}`} style={{ background: selected.attivo ? '#22C55E' : '#94A3B8' }} />
        <a href={`/tv/${selected.slug}`} target="_blank" rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: '#7C3AED' }}>
          👁️ Preview TV
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Libreria Contenuti ──────────────────────────────────────────── */}
        <ContenutiPanel monitorId={selected.id} clienteId={selected.cliente_id} contenuti={contenuti} onReload={() => loadDetails(selected.id)} />

        {/* ── Palinsesto Fasce ────────────────────────────────────────────── */}
        <FascePanel monitorId={selected.id} fasce={fasce} contenuti={contenuti} onReload={() => loadDetails(selected.id)} />
      </div>
    </div>
  );
}

// ── New Monitor Modal ────────────────────────────────────────────────────────
function NewMonitorModal({ clienti, onClose, onCreated }: { clienti: Cliente[]; onClose: () => void; onCreated: () => void }) {
  const [clienteId, setClienteId] = useState('');
  const [nome, setNome] = useState('Reception');
  const [slug, setSlug] = useState('');
  const [orient, setOrient] = useState<'orizzontale' | 'verticale'>('orizzontale');
  const [saving, setSaving] = useState(false);

  const clienteNome = clienti.find(c => c.id === clienteId)?.nome || '';

  // Auto-generate slug
  useEffect(() => {
    if (clienteNome) {
      const s = clienteNome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      setSlug(s);
    }
  }, [clienteNome]);

  const handleCreate = async () => {
    if (!clienteId || !slug.trim()) return;
    setSaving(true);
    const ris = orient === 'orizzontale' ? '1920x1080' : '1080x1920';
    const { error } = await supabase.from('monitor').insert({
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      nome: nome.trim() || 'Reception',
      slug: slug.trim(),
      orientamento: orient,
      risoluzione: ris,
    });
    setSaving(false);
    if (error) {
      alert('Errore: ' + (error.message.includes('duplicate') ? 'Slug già in uso' : error.message));
    } else {
      onCreated();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl border shadow-2xl p-5 w-full max-w-md" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🖥️ Nuovo Monitor</h2>

        <div className="space-y-3">
          <div>
            <label className="sk-label">Cliente</label>
            <select className="sk-select w-full text-sm" value={clienteId} onChange={e => setClienteId(e.target.value)}>
              <option value="">— Seleziona —</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="sk-label">Nome monitor</label>
            <input className="sk-input w-full text-sm" value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Reception, Sala attesa" />
          </div>
          <div>
            <label className="sk-label">Slug (URL)</label>
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>/tv/</span>
              <input className="sk-input flex-1 text-sm font-mono" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            </div>
          </div>
          <div>
            <label className="sk-label">Orientamento</label>
            <div className="flex gap-2">
              <button onClick={() => setOrient('orizzontale')}
                className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-all"
                style={{ background: orient === 'orizzontale' ? '#3B82F620' : 'transparent', borderColor: orient === 'orizzontale' ? '#3B82F6' : 'hsl(var(--border))', color: orient === 'orizzontale' ? '#3B82F6' : 'hsl(var(--skorpio-text-secondary))' }}>
                ⬛ Orizzontale (16:9)
              </button>
              <button onClick={() => setOrient('verticale')}
                className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-all"
                style={{ background: orient === 'verticale' ? '#8B5CF620' : 'transparent', borderColor: orient === 'verticale' ? '#8B5CF6' : 'hsl(var(--border))', color: orient === 'verticale' ? '#8B5CF6' : 'hsl(var(--skorpio-text-secondary))' }}>
                ⬜ Verticale (9:16)
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-sm" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>Annulla</button>
          <button onClick={handleCreate} disabled={!clienteId || !slug.trim() || saving}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: '#3B82F6' }}>
            {saving ? '⏳…' : '✅ Crea monitor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Contenuti Panel ──────────────────────────────────────────────────────────
function ContenutiPanel({ monitorId, clienteId, contenuti, onReload }: {
  monitorId: string; clienteId: string | null; contenuti: MonitorContenuto[]; onReload: () => void;
}) {
  const { addToast } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [titolo, setTitolo] = useState('');
  const [tipo, setTipo] = useState<'immagine' | 'video'>('immagine');
  const [driveUrl, setDriveUrl] = useState('');
  const [durata, setDurata] = useState(10);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!titolo.trim() || !driveUrl.trim()) return;
    setSaving(true);
    // Extract file ID from Drive URL
    const fileIdMatch = driveUrl.match(/[-\w]{25,}/);
    const fileId = fileIdMatch ? fileIdMatch[0] : null;
    // Generate direct preview URL
    const previewUrl = fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w640` : null;

    await supabase.from('monitor_contenuti').insert({
      monitor_id: monitorId,
      cliente_id: clienteId,
      titolo: titolo.trim(),
      tipo,
      drive_file_id: fileId,
      drive_url: driveUrl.trim(),
      thumbnail_url: previewUrl,
      durata_secondi: tipo === 'video' ? 0 : durata,
      ordine: contenuti.length,
    });
    setSaving(false);
    setShowAdd(false);
    setTitolo('');
    setDriveUrl('');
    onReload();
    addToast('✅ Contenuto aggiunto', 'success');
  };

  const handleDelete = async (id: string) => {
    await supabase.from('monitor_contenuti').delete().eq('id', id);
    onReload();
    addToast('🗑️ Contenuto rimosso', 'info');
  };

  const toggleAttivo = async (id: string, current: boolean) => {
    await supabase.from('monitor_contenuti').update({ attivo: !current }).eq('id', id);
    onReload();
  };

  return (
    <div className="rounded-xl border" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎬 Contenuti ({contenuti.length})</span>
        <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 rounded-lg font-semibold text-white" style={{ background: '#22C55E' }}>
          + Aggiungi
        </button>
      </div>

      <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
        {contenuti.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessun contenuto. Aggiungi il primo!</p>
        ) : contenuti.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: c.attivo ? 'hsl(var(--muted) / 0.3)' : 'hsl(0 0% 50% / 0.05)', opacity: c.attivo ? 1 : 0.5 }}>
            <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0" style={{ background: '#1E293B' }}>
              {c.thumbnail_url ? (
                <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg">{c.tipo === 'video' ? '🎥' : '🖼️'}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.titolo}</p>
              <p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                {c.tipo === 'video' ? '🎥 Video' : `🖼️ ${c.durata_secondi}s`}
                {c.drive_url && <a href={c.drive_url} target="_blank" rel="noopener noreferrer" className="ml-2 hover:underline" style={{ color: '#3B82F6' }}>📂 Drive</a>}
              </p>
            </div>
            <button onClick={() => toggleAttivo(c.id, c.attivo)} className="text-xs px-1.5 py-0.5 rounded" title={c.attivo ? 'Disattiva' : 'Attiva'}>
              {c.attivo ? '🟢' : '⚪'}
            </button>
            <button onClick={() => handleDelete(c.id)} className="text-xs px-1.5 py-0.5 rounded hover:bg-red-100" title="Elimina">🗑️</button>
          </div>
        ))}
      </div>

      {/* Add content form */}
      {showAdd && (
        <div className="p-3 border-t space-y-2" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.2)' }}>
          <input className="sk-input w-full text-sm" placeholder="Titolo contenuto…" value={titolo} onChange={e => setTitolo(e.target.value)} />
          <div className="flex gap-2">
            <select className="sk-select flex-1 text-sm" value={tipo} onChange={e => setTipo(e.target.value as 'immagine' | 'video')}>
              <option value="immagine">🖼️ Immagine</option>
              <option value="video">🎥 Video</option>
            </select>
            {tipo === 'immagine' && (
              <input type="number" className="sk-input w-20 text-sm" value={durata} onChange={e => setDurata(Number(e.target.value))} min={3} max={120} placeholder="Sec" />
            )}
          </div>
          <input className="sk-input w-full text-sm" placeholder="Link Google Drive (URL del file)…" value={driveUrl} onChange={e => setDriveUrl(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-1.5 rounded-lg text-xs" style={{ background: 'hsl(var(--muted))' }}>Annulla</button>
            <button onClick={handleAdd} disabled={!titolo.trim() || !driveUrl.trim() || saving}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{ background: '#22C55E' }}>
              {saving ? '⏳…' : '✅ Aggiungi'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fasce Panel ──────────────────────────────────────────────────────────────
function FascePanel({ monitorId, fasce, contenuti, onReload }: {
  monitorId: string; fasce: MonitorFascia[]; contenuti: MonitorContenuto[]; onReload: () => void;
}) {
  const { addToast } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [nomeFascia, setNomeFascia] = useState('');
  const [giorni, setGiorni] = useState<string[]>(['lun', 'mar', 'mer', 'gio', 'ven']);
  const [oraInizio, setOraInizio] = useState('09:00');
  const [oraFine, setOraFine] = useState('18:00');
  const [selContenuti, setSelContenuti] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleGiorno = (g: string) => {
    setGiorni(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const toggleContenuto = (id: string) => {
    setSelContenuti(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleAdd = async () => {
    if (!nomeFascia.trim() || giorni.length === 0 || selContenuti.length === 0) return;
    setSaving(true);
    await supabase.from('monitor_fasce').insert({
      monitor_id: monitorId,
      nome_fascia: nomeFascia.trim(),
      giorni,
      ora_inizio: oraInizio,
      ora_fine: oraFine,
      contenuti_ids: selContenuti,
    });
    setSaving(false);
    setShowAdd(false);
    setNomeFascia('');
    setSelContenuti([]);
    onReload();
    addToast('✅ Fascia creata', 'success');
  };

  const handleDelete = async (id: string) => {
    await supabase.from('monitor_fasce').delete().eq('id', id);
    onReload();
    addToast('🗑️ Fascia rimossa', 'info');
  };

  const toggleFasciaAttiva = async (id: string, current: boolean) => {
    await supabase.from('monitor_fasce').update({ attivo: !current }).eq('id', id);
    onReload();
  };

  return (
    <div className="rounded-xl border" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>📅 Palinsesto ({fasce.length} fasce)</span>
        <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 rounded-lg font-semibold text-white" style={{ background: '#8B5CF6' }}>
          + Fascia
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {fasce.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessuna fascia oraria. Crea il palinsesto!</p>
        ) : fasce.map(f => {
          const contNames = f.contenuti_ids.map(id => contenuti.find(c => c.id === id)?.titolo || '?').join(', ');
          return (
            <div key={f.id} className="rounded-lg border p-3" style={{ borderColor: f.attivo ? '#8B5CF640' : 'hsl(var(--border))', opacity: f.attivo ? 1 : 0.5 }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold" style={{ color: '#8B5CF6' }}>{f.nome_fascia}</span>
                <div className="flex gap-1">
                  <button onClick={() => toggleFasciaAttiva(f.id, f.attivo)} className="text-xs">{f.attivo ? '🟢' : '⚪'}</button>
                  <button onClick={() => handleDelete(f.id)} className="text-xs hover:bg-red-100 rounded px-1">🗑️</button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                  🕐 {f.ora_inizio.slice(0, 5)} – {f.ora_fine.slice(0, 5)}
                </span>
                <div className="flex gap-0.5">
                  {GIORNI_ALL.map(g => (
                    <span key={g} className="text-[9px] px-1 py-0.5 rounded font-medium"
                      style={{
                        background: f.giorni.includes(g) ? '#8B5CF620' : 'transparent',
                        color: f.giorni.includes(g) ? '#8B5CF6' : 'hsl(var(--skorpio-text-tertiary))',
                      }}>
                      {GIORNI_LABELS[g]}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[10px] truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                🎬 {f.contenuti_ids.length} contenut{f.contenuti_ids.length === 1 ? 'o' : 'i'}: {contNames}
              </p>
            </div>
          );
        })}
      </div>

      {/* Add fascia form */}
      {showAdd && (
        <div className="p-3 border-t space-y-3" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.2)' }}>
          <input className="sk-input w-full text-sm" placeholder="Nome fascia (es. Mattina promo)…" value={nomeFascia} onChange={e => setNomeFascia(e.target.value)} />

          <div>
            <label className="sk-label">Giorni</label>
            <div className="flex gap-1 flex-wrap">
              {GIORNI_ALL.map(g => (
                <button key={g} onClick={() => toggleGiorno(g)}
                  className="text-xs px-2 py-1 rounded-lg font-semibold transition-all"
                  style={{
                    background: giorni.includes(g) ? '#8B5CF6' : 'hsl(var(--muted))',
                    color: giorni.includes(g) ? 'white' : 'hsl(var(--skorpio-text-secondary))',
                  }}>
                  {GIORNI_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="sk-label">Inizio</label>
              <input type="time" className="sk-input w-full text-sm" value={oraInizio} onChange={e => setOraInizio(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="sk-label">Fine</label>
              <input type="time" className="sk-input w-full text-sm" value={oraFine} onChange={e => setOraFine(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="sk-label">Contenuti nella rotazione</label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {contenuti.filter(c => c.attivo).map(c => (
                <button key={c.id} onClick={() => toggleContenuto(c.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-all"
                  style={{
                    background: selContenuti.includes(c.id) ? '#8B5CF615' : 'transparent',
                    border: selContenuti.includes(c.id) ? '1px solid #8B5CF640' : '1px solid transparent',
                    color: 'hsl(var(--skorpio-text-primary))',
                  }}>
                  <span>{selContenuti.includes(c.id) ? '☑️' : '⬜'}</span>
                  <span className="truncate">{c.tipo === 'video' ? '🎥' : '🖼️'} {c.titolo}</span>
                </button>
              ))}
              {contenuti.filter(c => c.attivo).length === 0 && (
                <p className="text-[10px] text-center py-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Aggiungi prima dei contenuti</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-1.5 rounded-lg text-xs" style={{ background: 'hsl(var(--muted))' }}>Annulla</button>
            <button onClick={handleAdd} disabled={!nomeFascia.trim() || giorni.length === 0 || selContenuti.length === 0 || saving}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{ background: '#8B5CF6' }}>
              {saving ? '⏳…' : '✅ Crea fascia'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
