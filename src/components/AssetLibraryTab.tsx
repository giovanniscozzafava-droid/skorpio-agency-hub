import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { ClienteLogo } from './ClienteLogo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function invokeEdge(path: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Edge error ${res.status}`);
  return data;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Cliente { id: string; nome: string; logo_url?: string | null; drive_assets_folder_id?: string | null; }
interface Asset {
  id: string; cliente_id: string; cliente_nome: string; nome: string; tipo: string;
  drive_file_id: string | null; drive_url: string | null; thumbnail_url: string | null;
  mime_type: string | null; file_size: number; tags: string[]; categoria: string;
  descrizione: string; colori_dominanti: string[]; larghezza: number | null;
  altezza: number | null; orientamento: string; preferito: boolean; archiviato: boolean;
  usato_in_clp: string[]; caricato_da: string; created_at: string;
}
interface BrandKit {
  id: string; cliente_id: string; cliente_nome: string;
  colore_primario: string; colore_secondario: string; colore_accento: string;
  colore_sfondo: string; colore_testo: string; colori_extra: string[];
  font_primario: string; font_secondario: string; font_peso_titoli: string; font_peso_corpo: string;
  logo_asset_id: string | null; logo_chiaro_asset_id: string | null; logo_icona_asset_id: string | null;
  mood_tags: string[]; stile_foto: string; stile_video: string;
  regole_do: string[]; regole_dont: string[]; hashtag_fissi: string[];
  tono_voce: string; canva_brand_kit_id: string | null;
}

const TAGS_PRESET = ['ritratto', 'ambiente', 'prodotto', 'before-after', 'staff', 'trattamento', 'dettaglio', 'esterno', 'promo', 'logo'];
const CATEGORIE = ['generale', 'social', 'catalogo', 'sito', 'stampa'];
const MOOD_TAGS = ['minimal', 'bold', 'warm', 'clinical', 'luxury', 'playful', 'elegant', 'organic', 'dark', 'colorful'];
const CHUNK_SIZE = 4 * 1024 * 1024;

// ── Main Component ───────────────────────────────────────────────────────────
export function AssetLibraryTab({ clienti }: { clienti: Cliente[] }) {
  const { utente, addToast } = useApp();
  const [selCliente, setSelCliente] = useState<Cliente | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'assets' | 'brandkit'>('assets');
  const [filterTag, setFilterTag] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProg, setUploadProg] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load assets + brand kit ────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selCliente) return;
    setLoading(true);
    const [{ data: a }, { data: bk }] = await Promise.all([
      supabase.from('client_assets').select('*').eq('cliente_id', selCliente.id).eq('archiviato', false).order('created_at', { ascending: false }),
      supabase.from('brand_kit').select('*').eq('cliente_id', selCliente.id).single(),
    ]);
    setAssets((a as Asset[]) || []);
    setBrandKit((bk as BrandKit) || null);
    setLoading(false);
  }, [selCliente]);

  useEffect(() => { if (selCliente) loadData(); }, [selCliente, loadData]);

  // ── Ensure Drive folder ────────────────────────────────────────────────────
  const ensureFolder = async (): Promise<string | null> => {
    if (selCliente?.drive_assets_folder_id) return selCliente.drive_assets_folder_id;
    try {
      const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
      const tid = dt?.[0]?.id || utente?.id;
      if (!tid) return null;
      const r = await invokeEdge('create-drive-folder', {
        contenuto_id: `assets_${selCliente!.id}`,
        titolo: `ASSETS_${selCliente!.nome}`,
        cliente_nome: selCliente!.nome,
        tipo: 'Assets', id_display: `AST_${selCliente!.nome}`,
        team_id: tid,
      });
      if (r.success && r.folder_id) {
        await supabase.from('clienti').update({ drive_assets_folder_id: r.folder_id }).eq('id', selCliente!.id);
        setSelCliente(prev => prev ? { ...prev, drive_assets_folder_id: r.folder_id } : null);
        return r.folder_id;
      }
    } catch (e: any) { addToast(`❌ Drive: ${e.message}`, 'error'); }
    return null;
  };

  // ── Upload files ───────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selCliente) return;
    e.target.value = '';
    const folderId = await ensureFolder();
    if (!folderId) { addToast('⚠️ Impossibile creare cartella Drive', 'warn'); return; }

    setUploading(true);
    const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
    const tid = dt?.[0]?.id || utente?.id || '';
    let done = 0;

    for (const file of Array.from(files)) {
      setUploadProg(Math.round((done / files.length) * 100));
      try {
        const mimeType = file.type || 'application/octet-stream';
        const initRes = await invokeEdge('google-drive-upload-init', {
          fileName: file.name, mimeType, fileSize: file.size, teamId: tid,
          clientName: selCliente.nome, zone: 'assets',
          contenutoId: `assets_${selCliente.id}`, idDisplay: `AST`,
          titolo: `ASSETS_${selCliente.nome}`, folderId,
        });
        const uploadUrl = initRes.uploadUrl;
        if (!uploadUrl) throw new Error('No uploadUrl');

        let uploaded = 0;
        let fileId = '';
        while (uploaded < file.size) {
          const end = Math.min(uploaded + CHUNK_SIZE, file.size);
          const chunk = file.slice(uploaded, end);
          const cr = `bytes ${uploaded}-${end - 1}/${file.size}`;
          const chunkRes = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'x-upload-url': uploadUrl, 'x-content-range': cr, 'x-content-type': mimeType, 'Content-Type': 'application/octet-stream' },
            body: chunk,
          });
          if (!chunkRes.ok) throw new Error('Chunk failed');
          const cd = await chunkRes.json();
          uploaded = end;
          if (cd.fileId) fileId = cd.fileId;
        }

        if (!fileId) throw new Error('No fileId');
        const isVideo = mimeType.startsWith('video/');
        const isImage = mimeType.startsWith('image/');
        const thumb = `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
        const streamUrl = `${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${encodeURIComponent(fileId)}&teamId=${encodeURIComponent(tid)}`;

        // Detect orientation from filename hints or default
        let orientamento = 'orizzontale';
        if (file.name.match(/vert|story|9.16|portrait/i)) orientamento = 'verticale';
        else if (file.name.match(/quad|square|1.1/i)) orientamento = 'quadrato';

        await supabase.from('client_assets').insert({
          cliente_id: selCliente.id, cliente_nome: selCliente.nome,
          nome: file.name.replace(/\.[^/.]+$/, ''),
          tipo: isVideo ? 'video' : isImage ? 'foto' : 'grafica',
          drive_file_id: fileId, drive_url: streamUrl, thumbnail_url: thumb,
          mime_type: mimeType, file_size: file.size, orientamento,
          caricato_da: utente?.nome || '',
        });
        done++;
      } catch (err: any) {
        addToast(`❌ ${file.name}: ${err.message}`, 'error');
      }
    }

    setUploading(false);
    setUploadProg(0);
    addToast(`✅ ${done}/${files.length} asset caricati`, 'success');
    loadData();
  };

  // ── Filter assets ──────────────────────────────────────────────────────────
  const filtered = assets.filter(a => {
    if (filterTag && !a.tags.includes(filterTag)) return false;
    if (filterCat && a.categoria !== filterCat) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.nome.toLowerCase().includes(q) && !a.descrizione.toLowerCase().includes(q) && !a.tags.some(t => t.includes(q))) return false;
    }
    return true;
  });

  // ── Toggle tag on asset ────────────────────────────────────────────────────
  const toggleTag = async (assetId: string, tag: string) => {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;
    const newTags = asset.tags.includes(tag) ? asset.tags.filter(t => t !== tag) : [...asset.tags, tag];
    await supabase.from('client_assets').update({ tags: newTags }).eq('id', assetId);
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, tags: newTags } : a));
    if (selectedAsset?.id === assetId) setSelectedAsset(prev => prev ? { ...prev, tags: newTags } : null);
  };

  const toggleFav = async (assetId: string) => {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;
    await supabase.from('client_assets').update({ preferito: !asset.preferito }).eq('id', assetId);
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, preferito: !a.preferito } : a));
  };

  const archiveAsset = async (assetId: string) => {
    await supabase.from('client_assets').update({ archiviato: true }).eq('id', assetId);
    setAssets(prev => prev.filter(a => a.id !== assetId));
    setSelectedAsset(null);
    addToast('🗑️ Asset archiviato', 'info');
  };

  // ── No client selected ─────────────────────────────────────────────────────
  if (!selCliente) return (
    <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎨 Asset Library & Brand Kit</h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Seleziona un cliente per gestire il suo catalogo visivo</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {clienti.map(c => (
          <button key={c.id} onClick={() => setSelCliente(c)}
            className="rounded-xl border p-4 text-left hover:shadow-lg transition-all group"
            style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
            <div className="flex items-center gap-3">
              <ClienteLogo nome={c.nome} logoUrl={c.logo_url} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate group-hover:text-[#8B5CF6] transition-colors" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.nome}</p>
                <p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Asset & Brand Kit</p>
              </div>
              <span className="text-lg opacity-30 group-hover:opacity-100 transition-opacity">→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Client selected — main UI ──────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0 flex-wrap" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <button onClick={() => { setSelCliente(null); setAssets([]); setBrandKit(null); }}
          className="text-sm px-3 py-1.5 rounded-lg" style={{ background: 'hsl(var(--muted))' }}>← Clienti</button>
        <ClienteLogo nome={selCliente.nome} logoUrl={selCliente.logo_url} size={28} />
        <h1 className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{selCliente.nome}</h1>

        {/* View toggle */}
        <div className="flex gap-1 ml-auto rounded-lg p-0.5" style={{ background: 'hsl(var(--muted))' }}>
          <button onClick={() => setView('assets')}
            className="px-3 py-1 rounded-md text-xs font-semibold transition-all"
            style={{ background: view === 'assets' ? '#8B5CF6' : 'transparent', color: view === 'assets' ? 'white' : 'hsl(var(--skorpio-text-secondary))' }}>
            🖼️ Assets ({assets.length})
          </button>
          <button onClick={() => setView('brandkit')}
            className="px-3 py-1 rounded-md text-xs font-semibold transition-all"
            style={{ background: view === 'brandkit' ? '#EC4899' : 'transparent', color: view === 'brandkit' ? 'white' : 'hsl(var(--skorpio-text-secondary))' }}>
            🎨 Brand Kit
          </button>
        </div>
      </div>

      {view === 'assets' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleUpload} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: '#8B5CF6' }}>
                {uploading ? `⏳ ${uploadProg}%` : '⬆️ Carica asset'}
              </button>

              {/* Search */}
              <input className="sk-input text-xs flex-1 min-w-[120px]" placeholder="🔍 Cerca…" value={search} onChange={e => setSearch(e.target.value)} />

              {/* Category filter */}
              <select className="sk-select text-xs" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">Tutte le categorie</option>
                {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              {/* Tag filter */}
              <div className="flex gap-1 flex-wrap">
                {TAGS_PRESET.slice(0, 6).map(t => (
                  <button key={t} onClick={() => setFilterTag(filterTag === t ? '' : t)}
                    className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-all"
                    style={{ background: filterTag === t ? '#8B5CF620' : 'hsl(var(--muted))', color: filterTag === t ? '#8B5CF6' : 'hsl(var(--skorpio-text-tertiary))', border: filterTag === t ? '1px solid #8B5CF640' : '1px solid transparent' }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="px-4 py-1">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
                  <div className="h-full rounded-full transition-all" style={{ background: '#8B5CF6', width: `${uploadProg}%` }} />
                </div>
              </div>
            )}

            {/* Asset grid — masonry style */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <p className="text-center text-sm py-12" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Caricamento…</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-4">🖼️</span>
                  <p className="text-sm font-medium" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                    {assets.length === 0 ? 'Nessun asset. Carica il primo!' : 'Nessun risultato per i filtri selezionati'}
                  </p>
                  {assets.length === 0 && (
                    <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs px-4 py-2 rounded-lg font-semibold text-white" style={{ background: '#8B5CF6' }}>
                      ⬆️ Carica asset
                    </button>
                  )}
                </div>
              ) : (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3">
                  {filtered.map(a => (
                    <div key={a.id} onClick={() => setSelectedAsset(a)}
                      className="mb-3 break-inside-avoid rounded-xl overflow-hidden border cursor-pointer group transition-all hover:shadow-xl hover:-translate-y-0.5"
                      style={{ borderColor: a.preferito ? '#F59E0B40' : 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
                      {/* Thumbnail */}
                      <div className="relative" style={{ background: '#0F172A' }}>
                        {a.thumbnail_url ? (
                          <img src={a.thumbnail_url} alt={a.nome} className="w-full object-cover" referrerPolicy="no-referrer"
                            style={{ minHeight: 80, maxHeight: 300 }} loading="lazy" />
                        ) : (
                          <div className="h-24 flex items-center justify-center text-2xl">{a.tipo === 'video' ? '🎥' : '🖼️'}</div>
                        )}
                        {/* Overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-end">
                          <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-end">
                            <button onClick={e => { e.stopPropagation(); toggleFav(a.id); }}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                              style={{ background: 'rgba(0,0,0,0.5)', color: a.preferito ? '#F59E0B' : 'white' }}>
                              {a.preferito ? '★' : '☆'}
                            </button>
                            <div className="flex gap-1">
                              {a.tags.slice(0, 2).map(t => (
                                <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(139,92,246,0.8)', color: 'white' }}>{t}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                        {a.tipo === 'video' && <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>🎥</span>}
                      </div>
                      {/* Info */}
                      <div className="p-2">
                        <p className="text-[11px] font-medium truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{a.nome}</p>
                        <p className="text-[9px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                          {a.tipo} · {a.categoria}{a.file_size ? ` · ${(a.file_size / 1048576).toFixed(1)}MB` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Asset detail sidebar */}
          {selectedAsset && (
            <AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)}
              onToggleTag={toggleTag} onToggleFav={toggleFav} onArchive={archiveAsset}
              onUpdate={(updated) => { setAssets(prev => prev.map(a => a.id === updated.id ? updated : a)); setSelectedAsset(updated); }} />
          )}
        </div>
      ) : (
        <BrandKitEditor clienteId={selCliente.id} clienteNome={selCliente.nome} brandKit={brandKit} assets={assets} onReload={loadData} />
      )}
    </div>
  );
}

// ── Asset Detail Sidebar ─────────────────────────────────────────────────────
function AssetDetail({ asset, onClose, onToggleTag, onToggleFav, onArchive, onUpdate }: {
  asset: Asset; onClose: () => void; onToggleTag: (id: string, tag: string) => void;
  onToggleFav: (id: string) => void; onArchive: (id: string) => void;
  onUpdate: (a: Asset) => void;
}) {
  const [desc, setDesc] = useState(asset.descrizione);
  const [cat, setCat] = useState(asset.categoria);

  useEffect(() => { setDesc(asset.descrizione); setCat(asset.categoria); }, [asset.id]);

  const saveField = async (field: string, value: any) => {
    await supabase.from('client_assets').update({ [field]: value }).eq('id', asset.id);
    onUpdate({ ...asset, [field]: value });
  };

  return (
    <div className="w-72 border-l flex-shrink-0 overflow-y-auto" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
      <div className="sticky top-0 z-10 px-3 py-2 border-b flex items-center justify-between" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
        <span className="text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Dettaglio</span>
        <button onClick={onClose} className="text-sm">✕</button>
      </div>

      {/* Preview */}
      <div style={{ background: '#0F172A' }}>
        {asset.thumbnail_url ? (
          <img src={asset.thumbnail_url} alt={asset.nome} className="w-full object-contain" referrerPolicy="no-referrer" style={{ maxHeight: 250 }} />
        ) : (
          <div className="h-32 flex items-center justify-center text-3xl">{asset.tipo === 'video' ? '🎥' : '🖼️'}</div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Name */}
        <div>
          <p className="text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{asset.nome}</p>
          <p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
            {asset.tipo} · {asset.orientamento} · {asset.file_size ? `${(asset.file_size / 1048576).toFixed(1)}MB` : ''}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={() => onToggleFav(asset.id)}
            className="flex-1 text-[10px] py-1.5 rounded-lg font-semibold"
            style={{ background: asset.preferito ? '#F59E0B15' : 'hsl(var(--muted))', color: asset.preferito ? '#F59E0B' : 'hsl(var(--skorpio-text-secondary))', border: asset.preferito ? '1px solid #F59E0B30' : '1px solid transparent' }}>
            {asset.preferito ? '★ Preferito' : '☆ Preferito'}
          </button>
          <button onClick={() => onArchive(asset.id)}
            className="text-[10px] px-3 py-1.5 rounded-lg" style={{ background: 'hsl(var(--muted))', color: '#EF4444' }}>🗑️</button>
        </div>

        {/* Categoria */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Categoria</label>
          <select className="sk-select w-full text-xs mt-1" value={cat}
            onChange={e => { setCat(e.target.value); saveField('categoria', e.target.value); }}>
            {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Tag</label>
          <div className="flex gap-1 flex-wrap mt-1">
            {TAGS_PRESET.map(t => (
              <button key={t} onClick={() => onToggleTag(asset.id, t)}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-all"
                style={{ background: asset.tags.includes(t) ? '#8B5CF620' : 'hsl(var(--muted))', color: asset.tags.includes(t) ? '#8B5CF6' : 'hsl(var(--skorpio-text-tertiary))', border: asset.tags.includes(t) ? '1px solid #8B5CF640' : '1px solid transparent' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Descrizione */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Note</label>
          <textarea className="sk-input w-full text-xs mt-1" rows={3} value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={() => saveField('descrizione', desc)}
            placeholder="Note sull'asset…" />
        </div>

        {/* Info */}
        <div className="text-[9px] space-y-0.5 pt-2 border-t" style={{ color: 'hsl(var(--skorpio-text-tertiary))', borderColor: 'hsl(var(--border))' }}>
          <p>Caricato da: {asset.caricato_da}</p>
          <p>Data: {new Date(asset.created_at).toLocaleDateString('it-IT')}</p>
          {asset.drive_file_id && <a href={`https://drive.google.com/file/d/${asset.drive_file_id}/view`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: '#3B82F6' }}>📂 Apri su Drive</a>}
        </div>
      </div>
    </div>
  );
}

// ── Brand Kit Editor ─────────────────────────────────────────────────────────
function BrandKitEditor({ clienteId, clienteNome, brandKit, assets, onReload }: {
  clienteId: string; clienteNome: string; brandKit: BrandKit | null; assets: Asset[]; onReload: () => void;
}) {
  const { addToast } = useApp();
  const [kit, setKit] = useState<Partial<BrandKit>>(brandKit || {
    colore_primario: '#000000', colore_secondario: '#666666', colore_accento: '#3B82F6',
    colore_sfondo: '#FFFFFF', colore_testo: '#1A1A1A', colori_extra: [],
    font_primario: 'Inter', font_secondario: 'Inter', font_peso_titoli: '700', font_peso_corpo: '400',
    mood_tags: [], stile_foto: '', stile_video: '', regole_do: [], regole_dont: [],
    hashtag_fissi: [], tono_voce: '',
  });
  const [saving, setSaving] = useState(false);
  const [newDo, setNewDo] = useState('');
  const [newDont, setNewDont] = useState('');
  const [newHash, setNewHash] = useState('');

  const save = async () => {
    setSaving(true);
    const payload = { ...kit, cliente_id: clienteId, cliente_nome: clienteNome };
    if (brandKit) {
      await supabase.from('brand_kit').update(payload).eq('id', brandKit.id);
    } else {
      await supabase.from('brand_kit').insert(payload);
    }
    setSaving(false);
    addToast('✅ Brand Kit salvato!', 'success');
    onReload();
  };

  const set = (k: string, v: any) => setKit(prev => ({ ...prev, [k]: v }));
  const toggleMood = (tag: string) => {
    const cur = kit.mood_tags || [];
    set('mood_tags', cur.includes(tag) ? cur.filter(t => t !== tag) : [...cur, tag]);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎨 Brand Kit — {clienteNome}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Identità visiva e regole di stile</p>
        </div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#EC4899' }}>
          {saving ? '⏳…' : '💾 Salva Brand Kit'}
        </button>
      </div>

      <div className="space-y-6">
        {/* ── Palette Colori ──────────────────────────────────────────────── */}
        <section className="rounded-xl border p-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#EC4899' }}>🎨 Palette Colori</h3>
          <div className="grid grid-cols-5 gap-3">
            {[['colore_primario', 'Primario'], ['colore_secondario', 'Secondario'], ['colore_accento', 'Accento'], ['colore_sfondo', 'Sfondo'], ['colore_testo', 'Testo']].map(([key, label]) => (
              <div key={key} className="text-center">
                <input type="color" value={(kit as any)[key] || '#000000'} onChange={e => set(key, e.target.value)}
                  className="w-12 h-12 rounded-xl cursor-pointer border-2" style={{ borderColor: 'hsl(var(--border))' }} />
                <p className="text-[10px] mt-1 font-medium" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>{label}</p>
                <p className="text-[9px] font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{(kit as any)[key]}</p>
              </div>
            ))}
          </div>
          {/* Preview */}
          <div className="mt-4 rounded-xl overflow-hidden" style={{ background: kit.colore_sfondo }}>
            <div className="p-4">
              <p className="text-lg font-bold" style={{ color: kit.colore_primario, fontFamily: kit.font_primario }}>Anteprima titolo</p>
              <p className="text-sm mt-1" style={{ color: kit.colore_testo, fontFamily: kit.font_secondario }}>Testo di esempio con il font e i colori selezionati.</p>
              <div className="flex gap-2 mt-2">
                <span className="text-xs px-3 py-1 rounded-full text-white font-semibold" style={{ background: kit.colore_accento }}>Accento</span>
                <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: kit.colore_secondario, color: 'white' }}>Secondario</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Tipografia ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#EC4899' }}>🔤 Tipografia</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="sk-label">Font titoli</label>
              <input className="sk-input w-full text-sm" value={kit.font_primario || ''} onChange={e => set('font_primario', e.target.value)} placeholder="es. Playfair Display" />
            </div>
            <div>
              <label className="sk-label">Font corpo</label>
              <input className="sk-input w-full text-sm" value={kit.font_secondario || ''} onChange={e => set('font_secondario', e.target.value)} placeholder="es. Inter" />
            </div>
            <div>
              <label className="sk-label">Peso titoli</label>
              <select className="sk-select w-full text-sm" value={kit.font_peso_titoli || '700'} onChange={e => set('font_peso_titoli', e.target.value)}>
                <option value="400">Regular (400)</option><option value="500">Medium (500)</option>
                <option value="600">Semibold (600)</option><option value="700">Bold (700)</option>
                <option value="800">Extrabold (800)</option><option value="900">Black (900)</option>
              </select>
            </div>
            <div>
              <label className="sk-label">Peso corpo</label>
              <select className="sk-select w-full text-sm" value={kit.font_peso_corpo || '400'} onChange={e => set('font_peso_corpo', e.target.value)}>
                <option value="300">Light (300)</option><option value="400">Regular (400)</option>
                <option value="500">Medium (500)</option><option value="600">Semibold (600)</option>
              </select>
            </div>
          </div>
        </section>

        {/* ── Mood & Stile ───────────────────────────────────────────────── */}
        <section className="rounded-xl border p-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#EC4899' }}>✨ Mood & Stile</h3>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {MOOD_TAGS.map(t => (
              <button key={t} onClick={() => toggleMood(t)}
                className="text-xs px-3 py-1 rounded-full font-semibold transition-all"
                style={{ background: (kit.mood_tags || []).includes(t) ? '#EC489920' : 'hsl(var(--muted))', color: (kit.mood_tags || []).includes(t) ? '#EC4899' : 'hsl(var(--skorpio-text-secondary))', border: (kit.mood_tags || []).includes(t) ? '1px solid #EC489940' : '1px solid transparent' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="sk-label">Stile foto</label>
              <textarea className="sk-input w-full text-xs" rows={2} value={kit.stile_foto || ''} onChange={e => set('stile_foto', e.target.value)} placeholder="es. luminose, naturali, sfondi chiari" />
            </div>
            <div>
              <label className="sk-label">Stile video</label>
              <textarea className="sk-input w-full text-xs" rows={2} value={kit.stile_video || ''} onChange={e => set('stile_video', e.target.value)} placeholder="es. transizioni morbide, sottotitoli bianchi" />
            </div>
          </div>
          <div className="mt-3">
            <label className="sk-label">Tono di voce</label>
            <input className="sk-input w-full text-sm" value={kit.tono_voce || ''} onChange={e => set('tono_voce', e.target.value)} placeholder="es. professionale ma accessibile, empatico" />
          </div>
        </section>

        {/* ── Regole Do / Don't ──────────────────────────────────────────── */}
        <section className="rounded-xl border p-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#EC4899' }}>📋 Regole</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold" style={{ color: '#22C55E' }}>✅ DO</label>
              <div className="space-y-1 mt-1">
                {(kit.regole_do || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs p-1.5 rounded" style={{ background: '#22C55E08' }}>
                    <span className="flex-1">{r}</span>
                    <button onClick={() => set('regole_do', (kit.regole_do || []).filter((_, j) => j !== i))} className="text-[10px] text-red-400">✕</button>
                  </div>
                ))}
                <div className="flex gap-1">
                  <input className="sk-input flex-1 text-xs" value={newDo} onChange={e => setNewDo(e.target.value)} placeholder="Aggiungi regola…"
                    onKeyDown={e => { if (e.key === 'Enter' && newDo.trim()) { set('regole_do', [...(kit.regole_do || []), newDo.trim()]); setNewDo(''); } }} />
                  <button onClick={() => { if (newDo.trim()) { set('regole_do', [...(kit.regole_do || []), newDo.trim()]); setNewDo(''); } }}
                    className="text-xs px-2 rounded" style={{ background: '#22C55E15', color: '#22C55E' }}>+</button>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold" style={{ color: '#EF4444' }}>❌ DON'T</label>
              <div className="space-y-1 mt-1">
                {(kit.regole_dont || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs p-1.5 rounded" style={{ background: '#EF444408' }}>
                    <span className="flex-1">{r}</span>
                    <button onClick={() => set('regole_dont', (kit.regole_dont || []).filter((_, j) => j !== i))} className="text-[10px] text-red-400">✕</button>
                  </div>
                ))}
                <div className="flex gap-1">
                  <input className="sk-input flex-1 text-xs" value={newDont} onChange={e => setNewDont(e.target.value)} placeholder="Aggiungi regola…"
                    onKeyDown={e => { if (e.key === 'Enter' && newDont.trim()) { set('regole_dont', [...(kit.regole_dont || []), newDont.trim()]); setNewDont(''); } }} />
                  <button onClick={() => { if (newDont.trim()) { set('regole_dont', [...(kit.regole_dont || []), newDont.trim()]); setNewDont(''); } }}
                    className="text-xs px-2 rounded" style={{ background: '#EF444415', color: '#EF4444' }}>+</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Hashtag ────────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-4" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#EC4899' }}># Hashtag fissi</h3>
          <div className="flex gap-1 flex-wrap">
            {(kit.hashtag_fissi || []).map((h, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-full flex items-center gap-1" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                #{h}
                <button onClick={() => set('hashtag_fissi', (kit.hashtag_fissi || []).filter((_, j) => j !== i))} className="text-[10px]">✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <input className="sk-input flex-1 text-xs" value={newHash} onChange={e => setNewHash(e.target.value.replace(/[^a-zA-Z0-9àèéìòù_]/g, ''))} placeholder="Aggiungi hashtag…"
              onKeyDown={e => { if (e.key === 'Enter' && newHash.trim()) { set('hashtag_fissi', [...(kit.hashtag_fissi || []), newHash.trim()]); setNewHash(''); } }} />
            <button onClick={() => { if (newHash.trim()) { set('hashtag_fissi', [...(kit.hashtag_fissi || []), newHash.trim()]); setNewHash(''); } }}
              className="text-xs px-3 py-1 rounded-lg" style={{ background: '#3B82F615', color: '#3B82F6' }}>+</button>
          </div>
        </section>

        {/* Save button bottom */}
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#EC4899' }}>
          {saving ? '⏳ Salvataggio…' : '💾 Salva Brand Kit'}
        </button>
      </div>
    </div>
  );
}
