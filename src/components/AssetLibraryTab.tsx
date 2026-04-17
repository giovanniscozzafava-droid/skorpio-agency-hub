import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { ClienteLogo } from './ClienteLogo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const CANVA_CLIENT_ID = 'OC-AZ2QNp_DRJpc';
const CANVA_REDIRECT_URI = `${window.location.origin}/canva-callback`;
const CHUNK_SIZE = 4 * 1024 * 1024;

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
  descrizione: string; colori_dominanti: string[]; orientamento: string;
  preferito: boolean; archiviato: boolean; caricato_da: string; created_at: string;
}
interface BrandKit {
  id?: string; cliente_id: string; cliente_nome: string;
  colore_primario: string; colore_secondario: string; colore_accento: string;
  colore_sfondo: string; colore_testo: string; colori_extra: string[];
  font_primario: string; font_secondario: string; font_peso_titoli: string; font_peso_corpo: string;
  mood_tags: string[]; stile_foto: string; stile_video: string;
  regole_do: string[]; regole_dont: string[]; hashtag_fissi: string[]; tono_voce: string;
  canva_brand_kit_id: string | null;
}

const TAGS = ['ritratto', 'ambiente', 'prodotto', 'before-after', 'staff', 'trattamento', 'dettaglio', 'esterno', 'promo', 'logo'];
const CATEGORIE = ['generale', 'social', 'catalogo', 'sito', 'stampa'];
const MOODS = ['minimal', 'bold', 'warm', 'clinical', 'luxury', 'playful', 'elegant', 'organic', 'dark', 'colorful'];

const emptyKit = (cid: string, cn: string): BrandKit => ({
  cliente_id: cid, cliente_nome: cn,
  colore_primario: '#1a1a2e', colore_secondario: '#16213e', colore_accento: '#e94560',
  colore_sfondo: '#FFFFFF', colore_testo: '#1A1A1A', colori_extra: [],
  font_primario: 'Playfair Display', font_secondario: 'Inter',
  font_peso_titoli: '700', font_peso_corpo: '400',
  mood_tags: [], stile_foto: '', stile_video: '',
  regole_do: [], regole_dont: [], hashtag_fissi: [], tono_voce: '',
  canva_brand_kit_id: null,
});

// ── Main ─────────────────────────────────────────────────────────────────────
export function AssetLibraryTab({ clienti }: { clienti: Cliente[] }) {
  const { utente, addToast } = useApp();
  const [sel, setSel] = useState<Cliente | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'assets' | 'brandkit'>('assets');
  const [tagF, setTagF] = useState('');
  const [catF, setCatF] = useState('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [upProg, setUpProg] = useState(0);
  const [upCount, setUpCount] = useState({ done: 0, total: 0 });
  const [detail, setDetail] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    if (!sel) return;
    setLoading(true);
    const [{ data: a }, { data: bk }] = await Promise.all([
      supabase.from('client_assets').select('*').eq('cliente_id', sel.id).eq('archiviato', false).order('created_at', { ascending: false }),
      supabase.from('brand_kit').select('*').eq('cliente_id', sel.id).maybeSingle(),
    ]);
    setAssets((a as Asset[]) || []);
    setKit((bk as BrandKit) || null);
    setLoading(false);
  }, [sel]);

  useEffect(() => { if (sel) load(); }, [sel, load]);

  // ── Ensure Drive folder for assets ─────────────────────────────────────────
  const ensureFolder = async (): Promise<string | null> => {
    if (sel?.drive_assets_folder_id) return sel.drive_assets_folder_id;
    addToast('📂 Creo cartella Assets su Drive…', 'info');
    try {
      const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
      const tid = dt?.[0]?.id || utente?.id;
      if (!tid) { addToast('⚠️ Nessun utente con Drive connesso', 'warn'); return null; }
      const r = await invokeEdge('create-drive-folder', {
        contenuto_id: `assets_${sel!.id}`, titolo: `ASSETS_${sel!.nome}`,
        cliente_nome: sel!.nome, tipo: 'Assets', id_display: `AST_${sel!.nome}`, team_id: tid,
      });
      if (r.success && r.folder_id) {
        await supabase.from('clienti').update({ drive_assets_folder_id: r.folder_id }).eq('id', sel!.id);
        setSel(prev => prev ? { ...prev, drive_assets_folder_id: r.folder_id } : null);
        addToast('✅ Cartella Drive creata!', 'success');
        return r.folder_id;
      }
      addToast('⚠️ Cartella Drive non creata: ' + JSON.stringify(r), 'warn');
    } catch (e: any) { addToast(`❌ Drive folder: ${e.message}`, 'error'); console.error('[AssetLib] ensureFolder:', e); }
    return null;
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !sel) return;
    e.target.value = '';

    const folderId = await ensureFolder();
    if (!folderId) return;

    setUploading(true);
    setUpCount({ done: 0, total: fileList.length });

    const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
    const tid = dt?.[0]?.id || utente?.id || '';
    if (!tid) { addToast('⚠️ Nessun utente Drive', 'warn'); setUploading(false); return; }

    let done = 0;
    for (const file of Array.from(fileList)) {
      setUpProg(0);
      try {
        const mimeType = file.type || 'application/octet-stream';
        addToast(`⬆️ Caricamento ${file.name}…`, 'info');

        // Init resumable upload
        const initRes = await invokeEdge('google-drive-upload-init', {
          fileName: file.name, mimeType, fileSize: file.size, teamId: tid,
          clientName: sel.nome, zone: 'assets',
          contenutoId: `assets_${sel.id}`, idDisplay: 'AST',
          titolo: `ASSETS_${sel.nome}`, folderId,
        });

        const uploadUrl = initRes.uploadUrl;
        if (!uploadUrl) throw new Error('Nessun uploadUrl dal server. Risposta: ' + JSON.stringify(initRes));

        // Chunked upload
        let uploaded = 0;
        let fileId = '';
        while (uploaded < file.size) {
          const end = Math.min(uploaded + CHUNK_SIZE, file.size);
          const chunk = file.slice(uploaded, end);
          const contentRange = `bytes ${uploaded}-${end - 1}/${file.size}`;

          const chunkRes = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
              'x-upload-url': uploadUrl, 'x-content-range': contentRange,
              'x-content-type': mimeType, 'Content-Type': 'application/octet-stream',
            },
            body: chunk,
          });

          if (!chunkRes.ok) {
            const errBody = await chunkRes.json().catch(() => ({}));
            throw new Error(`Chunk error ${chunkRes.status}: ${errBody?.error || 'unknown'}`);
          }

          const cd = await chunkRes.json();
          uploaded = end;
          setUpProg(Math.round((uploaded / file.size) * 100));
          if (cd.fileId) fileId = cd.fileId;
        }

        if (!fileId) throw new Error('Upload completato ma nessun fileId');

        // Save to DB
        const isVideo = mimeType.startsWith('video/');
        const isImage = mimeType.startsWith('image/');
        const thumb = `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
        const streamUrl = `${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${encodeURIComponent(fileId)}&teamId=${encodeURIComponent(tid)}`;

        await supabase.from('client_assets').insert({
          cliente_id: sel.id, cliente_nome: sel.nome,
          nome: file.name.replace(/\.[^/.]+$/, ''),
          tipo: isVideo ? 'video' : isImage ? 'foto' : 'grafica',
          drive_file_id: fileId, drive_url: streamUrl, thumbnail_url: thumb,
          mime_type: mimeType, file_size: file.size,
          caricato_da: utente?.nome || '',
        });

        done++;
        setUpCount({ done, total: fileList.length });
      } catch (err: any) {
        console.error('[AssetLib] Upload error:', err);
        addToast(`❌ ${file.name}: ${err.message}`, 'error');
      }
    }

    setUploading(false);
    setUpProg(0);
    if (done > 0) {
      addToast(`✅ ${done} asset caricati per ${sel.nome}`, 'success');
      load();
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = assets.filter(a => {
    if (tagF && !a.tags.includes(tagF)) return false;
    if (catF && a.categoria !== catF) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(a.nome + a.descrizione + a.tags.join(' ')).toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const toggleTag = async (id: string, tag: string) => {
    const a = assets.find(x => x.id === id); if (!a) return;
    const nt = a.tags.includes(tag) ? a.tags.filter(t => t !== tag) : [...a.tags, tag];
    await supabase.from('client_assets').update({ tags: nt }).eq('id', id);
    setAssets(prev => prev.map(x => x.id === id ? { ...x, tags: nt } : x));
    if (detail?.id === id) setDetail(prev => prev ? { ...prev, tags: nt } : null);
  };

  const toggleFav = async (id: string) => {
    const a = assets.find(x => x.id === id); if (!a) return;
    await supabase.from('client_assets').update({ preferito: !a.preferito }).eq('id', id);
    setAssets(prev => prev.map(x => x.id === id ? { ...x, preferito: !a.preferito } : x));
  };

  const archiveAsset = async (id: string) => {
    await supabase.from('client_assets').update({ archiviato: true }).eq('id', id);
    setAssets(prev => prev.filter(x => x.id !== id));
    setDetail(null);
    addToast('🗑️ Asset archiviato', 'info');
  };

  // ── Canva OAuth ────────────────────────────────────────────────────────────
  const connectCanva = () => {
    const state = Math.random().toString(36).slice(2);
    localStorage.setItem('canva_oauth_state', state);
    if (sel) localStorage.setItem('canva_oauth_cliente_id', sel.id);
    const scopes = 'asset:read asset:write brandtemplate:content:read brandtemplate:meta:read design:content:read design:meta:read folder:read folder:write profile:read';
    const url = `https://www.canva.com/api/oauth/authorize?response_type=code&client_id=${CANVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(CANVA_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
    window.open(url, '_blank', 'width=600,height=700');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // CLIENT SELECTOR
  // ══════════════════════════════════════════════════════════════════════════
  if (!sel) return (
    <div className="flex-1 overflow-auto p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎨 Asset Library</h1>
          <p className="text-sm mt-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Catalogo visivo e Brand Kit per ogni cliente</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clienti.map(c => (
            <button key={c.id} onClick={() => setSel(c)}
              className="rounded-2xl border p-5 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group"
              style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
              <div className="flex items-center gap-3">
                <ClienteLogo nome={c.nome} logoUrl={c.logo_url} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate transition-colors" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.nome}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Asset Library & Brand Kit</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN UI — CLIENT SELECTED
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <button onClick={() => { setSel(null); setDetail(null); setAssets([]); }}
          className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>← Clienti</button>
        <ClienteLogo nome={sel.nome} logoUrl={sel.logo_url} size={28} />
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{sel.nome}</span>

        {/* View toggle */}
        <div className="flex gap-0.5 ml-auto rounded-xl p-0.5" style={{ background: 'hsl(var(--muted))' }}>
          {([['assets', '🖼️ Assets', '#8B5CF6'], ['brandkit', '🎨 Brand Kit', '#EC4899']] as const).map(([v, label, col]) => (
            <button key={v} onClick={() => setView(v as any)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
              style={{ background: view === v ? col : 'transparent', color: view === v ? '#fff' : 'hsl(var(--skorpio-text-tertiary))' }}>
              {label} {v === 'assets' ? `(${assets.length})` : ''}
            </button>
          ))}
        </div>

        {/* Canva connect */}
        <button onClick={connectCanva} className="text-[10px] px-2.5 py-1.5 rounded-lg font-semibold transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg, #7B2FF7, #00C4CC)', color: 'white' }}>
          🔗 Canva
        </button>
      </div>

      {view === 'assets' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* ── ASSETS VIEW ────────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
              <label className="text-xs px-4 py-1.5 rounded-xl font-bold text-white transition-all hover:scale-105 cursor-pointer inline-block"
                style={{ background: uploading ? '#8B5CF680' : '#8B5CF6', pointerEvents: uploading ? 'none' : 'auto' }}>
                {uploading ? `⬆️ ${upCount.done}/${upCount.total} (${upProg}%)` : '⬆️ Carica'}
                <input type="file" accept="image/*,video/*" multiple onChange={handleUpload}
                  style={{display:'none'}} disabled={uploading} />
              </label>

              <div className="flex-1 min-w-[100px] relative">
                <input className="sk-input w-full text-xs pl-7" placeholder="Cerca asset…" value={search} onChange={e => setSearch(e.target.value)} />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px]">🔍</span>
              </div>

              <select className="sk-select text-[10px] py-1" value={catF} onChange={e => setCatF(e.target.value)}>
                <option value="">Tutte</option>
                {CATEGORIE.map(c => <option key={c}>{c}</option>)}
              </select>

              <div className="flex gap-1 overflow-x-auto">
                {TAGS.map(t => (
                  <button key={t} onClick={() => setTagF(tagF === t ? '' : t)}
                    className="text-[9px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap transition-all"
                    style={{
                      background: tagF === t ? '#8B5CF6' : 'hsl(var(--muted))',
                      color: tagF === t ? '#fff' : 'hsl(var(--skorpio-text-tertiary))',
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="h-1" style={{ background: 'hsl(var(--muted))' }}>
                <div className="h-full transition-all duration-300" style={{ background: 'linear-gradient(90deg, #8B5CF6, #EC4899)', width: `${upProg}%` }} />
              </div>
            )}

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#8B5CF640', borderTopColor: '#8B5CF6' }} />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-20">
                  <span className="text-6xl block mb-4 opacity-30">🖼️</span>
                  <p className="font-medium" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                    {assets.length === 0 ? `Nessun asset per ${sel.nome}` : 'Nessun risultato'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    {assets.length === 0 ? 'Clicca "⬆️ Carica" per iniziare' : 'Prova a cambiare i filtri'}
                  </p>
                  {assets.length === 0 && (
                    <label className="mt-4 text-xs px-5 py-2 rounded-xl font-bold text-white cursor-pointer inline-block" style={{ background: '#8B5CF6' }}>
                      ⬆️ Carica i primi asset
                      <input type="file" accept="image/*,video/*" multiple onChange={handleUpload} style={{display:'none'}} />
                    </label>
                  )}
                </div>
              ) : (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 [column-fill:_balance]">
                  {filtered.map(a => (
                    <div key={a.id} onClick={() => setDetail(a)}
                      className="mb-3 break-inside-avoid rounded-2xl overflow-hidden border cursor-pointer group transition-all duration-300 hover:shadow-2xl hover:-translate-y-1"
                      style={{ borderColor: a.preferito ? '#F59E0B50' : 'transparent', background: 'hsl(var(--card))' }}>
                      <div className="relative overflow-hidden" style={{ background: '#0a0a0f' }}>
                        {a.thumbnail_url ? (
                          <img src={a.thumbnail_url} alt={a.nome} loading="lazy" referrerPolicy="no-referrer"
                            className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            style={{ minHeight: 80 }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="h-28 flex items-center justify-center text-3xl opacity-30">{a.tipo === 'video' ? '🎥' : '🖼️'}</div>
                        )}
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2.5">
                          <div className="flex items-center justify-between w-full">
                            <button onClick={e => { e.stopPropagation(); toggleFav(a.id); }}
                              className="w-7 h-7 rounded-full backdrop-blur-md flex items-center justify-center transition-transform hover:scale-110"
                              style={{ background: 'rgba(255,255,255,0.15)', color: a.preferito ? '#F59E0B' : '#fff' }}>
                              {a.preferito ? '★' : '☆'}
                            </button>
                            <div className="flex gap-1">
                              {a.tags.slice(0, 2).map(t => (
                                <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full backdrop-blur-md font-semibold" style={{ background: 'rgba(139,92,246,0.6)', color: '#fff' }}>{t}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                        {a.tipo === 'video' && <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-md font-bold backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>▶ Video</span>}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[11px] font-semibold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{a.nome}</p>
                        <p className="text-[9px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                          {a.categoria}{a.file_size ? ` · ${(a.file_size / 1048576).toFixed(1)}MB` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Detail Sidebar ──────────────────────────────────────────────── */}
          {detail && (
            <div className="w-80 border-l flex-shrink-0 overflow-y-auto" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
              <div className="sticky top-0 z-10 px-3 py-2.5 border-b flex items-center justify-between backdrop-blur-md" style={{ background: 'hsl(var(--card) / 0.9)', borderColor: 'hsl(var(--border))' }}>
                <span className="text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Dettaglio asset</span>
                <button onClick={() => setDetail(null)} className="w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-[hsl(var(--muted))] transition-colors">✕</button>
              </div>
              <div style={{ background: '#0a0a0f' }}>
                {detail.thumbnail_url ? (
                  <img src={detail.thumbnail_url} alt={detail.nome} className="w-full object-contain" referrerPolicy="no-referrer" style={{ maxHeight: 260 }} />
                ) : (
                  <div className="h-36 flex items-center justify-center text-4xl opacity-20">🖼️</div>
                )}
              </div>
              <div className="p-3 space-y-4">
                <div>
                  <p className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{detail.nome}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    {detail.tipo} · {detail.orientamento}{detail.file_size ? ` · ${(detail.file_size / 1048576).toFixed(1)}MB` : ''}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={() => toggleFav(detail.id)}
                    className="flex-1 text-[10px] py-2 rounded-xl font-bold transition-all"
                    style={{ background: detail.preferito ? '#F59E0B15' : 'hsl(var(--muted))', color: detail.preferito ? '#F59E0B' : 'hsl(var(--skorpio-text-secondary))', border: detail.preferito ? '1px solid #F59E0B30' : '1px solid transparent' }}>
                    {detail.preferito ? '★ Preferito' : '☆ Preferito'}
                  </button>
                  {detail.drive_file_id && (
                    <a href={`https://drive.google.com/file/d/${detail.drive_file_id}/view`} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] px-3 py-2 rounded-xl font-bold" style={{ background: '#3B82F615', color: '#3B82F6' }}>📂 Drive</a>
                  )}
                  <button onClick={() => archiveAsset(detail.id)}
                    className="text-[10px] px-3 py-2 rounded-xl" style={{ background: '#EF444410', color: '#EF4444' }}>🗑️</button>
                </div>

                {/* Categoria */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Categoria</label>
                  <select className="sk-select w-full text-xs mt-1" value={detail.categoria}
                    onChange={async e => {
                      await supabase.from('client_assets').update({ categoria: e.target.value }).eq('id', detail.id);
                      setDetail(prev => prev ? { ...prev, categoria: e.target.value } : null);
                      setAssets(prev => prev.map(a => a.id === detail.id ? { ...a, categoria: e.target.value } : a));
                    }}>
                    {CATEGORIE.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>

                {/* Tags */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Tag</label>
                  <div className="flex gap-1 flex-wrap mt-1.5">
                    {TAGS.map(t => (
                      <button key={t} onClick={() => toggleTag(detail.id, t)}
                        className="text-[9px] px-2 py-0.5 rounded-full font-semibold transition-all"
                        style={{
                          background: detail.tags.includes(t) ? '#8B5CF6' : 'hsl(var(--muted))',
                          color: detail.tags.includes(t) ? '#fff' : 'hsl(var(--skorpio-text-tertiary))',
                        }}>{t}</button>
                    ))}
                  </div>
                </div>

                {/* Note */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Note</label>
                  <textarea className="sk-input w-full text-xs mt-1" rows={2} defaultValue={detail.descrizione}
                    onBlur={async e => {
                      await supabase.from('client_assets').update({ descrizione: e.target.value }).eq('id', detail.id);
                      setDetail(prev => prev ? { ...prev, descrizione: e.target.value } : null);
                    }} placeholder="Aggiungi note…" />
                </div>

                <div className="text-[9px] pt-2 border-t" style={{ color: 'hsl(var(--skorpio-text-tertiary))', borderColor: 'hsl(var(--border))' }}>
                  <p>Caricato da {detail.caricato_da} · {new Date(detail.created_at).toLocaleDateString('it-IT')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ══════════════════════════════════════════════════════════════════
        // BRAND KIT VIEW
        // ══════════════════════════════════════════════════════════════════
        <BrandKitEditor clienteId={sel.id} clienteNome={sel.nome} brandKit={kit} onReload={load} />
      )}
    </div>
  );
}

// ── Brand Kit Editor ─────────────────────────────────────────────────────────
function BrandKitEditor({ clienteId, clienteNome, brandKit, onReload }: {
  clienteId: string; clienteNome: string; brandKit: BrandKit | null; onReload: () => void;
}) {
  const { addToast } = useApp();
  const [k, setK] = useState<BrandKit>(brandKit || emptyKit(clienteId, clienteNome));
  const [saving, setSaving] = useState(false);
  const [newDo, setNewDo] = useState('');
  const [newDont, setNewDont] = useState('');
  const [newHash, setNewHash] = useState('');

  const s = (field: string, val: any) => setK(prev => ({ ...prev, [field]: val }));
  const toggleMood = (t: string) => s('mood_tags', (k.mood_tags || []).includes(t) ? k.mood_tags.filter(x => x !== t) : [...(k.mood_tags || []), t]);

  const save = async () => {
    setSaving(true);
    const payload = { ...k, cliente_id: clienteId, cliente_nome: clienteNome };
    delete (payload as any).id;
    if (brandKit?.id) {
      await supabase.from('brand_kit').update(payload).eq('id', brandKit.id);
    } else {
      await supabase.from('brand_kit').insert(payload);
    }
    setSaving(false);
    addToast('✅ Brand Kit salvato!', 'success');
    onReload();
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎨 Brand Kit</h2>
            <p className="text-[11px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Identità visiva di {clienteNome}</p>
          </div>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #EC4899, #8B5CF6)' }}>
            {saving ? '⏳…' : '💾 Salva'}
          </button>
        </div>

        {/* Palette */}
        <section className="rounded-2xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#EC4899' }}>🎨 Palette Colori</h3>
          <div className="flex gap-4 justify-center mb-4">
            {([['colore_primario', 'Primario'], ['colore_secondario', 'Secondario'], ['colore_accento', 'Accento'], ['colore_sfondo', 'Sfondo'], ['colore_testo', 'Testo']] as const).map(([key, label]) => (
              <div key={key} className="text-center">
                <label className="block cursor-pointer">
                  <input type="color" value={(k as any)[key] || '#000'} onChange={e => s(key, e.target.value)}
                    className="w-14 h-14 rounded-2xl cursor-pointer border-2 p-0.5" style={{ borderColor: 'hsl(var(--border))' }} />
                </label>
                <p className="text-[9px] mt-1 font-semibold" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>{label}</p>
                <p className="text-[8px] font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{(k as any)[key]}</p>
              </div>
            ))}
          </div>
          {/* Live preview */}
          <div className="rounded-xl overflow-hidden border" style={{ background: k.colore_sfondo, borderColor: k.colore_secondario + '30' }}>
            <div className="p-5">
              <p className="text-xl mb-1" style={{ color: k.colore_primario, fontWeight: Number(k.font_peso_titoli) }}>{clienteNome}</p>
              <p className="text-sm" style={{ color: k.colore_testo }}>Anteprima testo con i colori e font selezionati per il brand.</p>
              <div className="flex gap-2 mt-3">
                <span className="text-xs px-3 py-1 rounded-full text-white font-semibold" style={{ background: k.colore_accento }}>Accento</span>
                <span className="text-xs px-3 py-1 rounded-full text-white font-semibold" style={{ background: k.colore_secondario }}>Secondario</span>
              </div>
            </div>
          </div>
        </section>

        {/* Tipografia */}
        <section className="rounded-2xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#EC4899' }}>🔤 Tipografia</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sk-label">Font titoli</label><input className="sk-input w-full text-sm" value={k.font_primario} onChange={e => s('font_primario', e.target.value)} /></div>
            <div><label className="sk-label">Font corpo</label><input className="sk-input w-full text-sm" value={k.font_secondario} onChange={e => s('font_secondario', e.target.value)} /></div>
          </div>
        </section>

        {/* Mood */}
        <section className="rounded-2xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#EC4899' }}>✨ Mood & Stile</h3>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {MOODS.map(t => (
              <button key={t} onClick={() => toggleMood(t)}
                className="text-xs px-3 py-1 rounded-full font-semibold transition-all"
                style={{ background: (k.mood_tags || []).includes(t) ? '#EC4899' : 'hsl(var(--muted))', color: (k.mood_tags || []).includes(t) ? '#fff' : 'hsl(var(--skorpio-text-secondary))' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sk-label">Stile foto</label><textarea className="sk-input w-full text-xs" rows={2} value={k.stile_foto} onChange={e => s('stile_foto', e.target.value)} placeholder="es. luminose, naturali" /></div>
            <div><label className="sk-label">Stile video</label><textarea className="sk-input w-full text-xs" rows={2} value={k.stile_video} onChange={e => s('stile_video', e.target.value)} placeholder="es. transizioni morbide" /></div>
          </div>
          <div className="mt-3"><label className="sk-label">Tono di voce</label><input className="sk-input w-full text-sm" value={k.tono_voce} onChange={e => s('tono_voce', e.target.value)} placeholder="es. professionale ma accessibile" /></div>
        </section>

        {/* Regole */}
        <section className="rounded-2xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#EC4899' }}>📋 Regole</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold" style={{ color: '#22C55E' }}>✅ DO</label>
              <div className="space-y-1 mt-1">
                {(k.regole_do || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs p-1.5 rounded-lg" style={{ background: '#22C55E08' }}>
                    <span className="flex-1">{r}</span>
                    <button onClick={() => s('regole_do', k.regole_do.filter((_, j) => j !== i))} className="text-[10px] text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
                <div className="flex gap-1"><input className="sk-input flex-1 text-xs" value={newDo} onChange={e => setNewDo(e.target.value)} placeholder="Nuova regola…"
                  onKeyDown={e => { if (e.key === 'Enter' && newDo.trim()) { s('regole_do', [...(k.regole_do || []), newDo.trim()]); setNewDo(''); } }} />
                  <button onClick={() => { if (newDo.trim()) { s('regole_do', [...(k.regole_do || []), newDo.trim()]); setNewDo(''); } }} className="text-xs px-2 rounded-lg" style={{ background: '#22C55E15', color: '#22C55E' }}>+</button></div>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold" style={{ color: '#EF4444' }}>❌ DON'T</label>
              <div className="space-y-1 mt-1">
                {(k.regole_dont || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs p-1.5 rounded-lg" style={{ background: '#EF444408' }}>
                    <span className="flex-1">{r}</span>
                    <button onClick={() => s('regole_dont', k.regole_dont.filter((_, j) => j !== i))} className="text-[10px] text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
                <div className="flex gap-1"><input className="sk-input flex-1 text-xs" value={newDont} onChange={e => setNewDont(e.target.value)} placeholder="Nuova regola…"
                  onKeyDown={e => { if (e.key === 'Enter' && newDont.trim()) { s('regole_dont', [...(k.regole_dont || []), newDont.trim()]); setNewDont(''); } }} />
                  <button onClick={() => { if (newDont.trim()) { s('regole_dont', [...(k.regole_dont || []), newDont.trim()]); setNewDont(''); } }} className="text-xs px-2 rounded-lg" style={{ background: '#EF444415', color: '#EF4444' }}>+</button></div>
              </div>
            </div>
          </div>
        </section>

        {/* Hashtag */}
        <section className="rounded-2xl border p-5" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#EC4899' }}># Hashtag fissi</h3>
          <div className="flex gap-1.5 flex-wrap">
            {(k.hashtag_fissi || []).map((h, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: '#3B82F615', color: '#3B82F6' }}>
                #{h}<button onClick={() => s('hashtag_fissi', k.hashtag_fissi.filter((_, j) => j !== i))} className="text-[10px] hover:text-red-500">✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-2"><input className="sk-input flex-1 text-xs" value={newHash}
            onChange={e => setNewHash(e.target.value.replace(/[^a-zA-Z0-9àèéìòù_]/g, ''))} placeholder="Nuovo hashtag…"
            onKeyDown={e => { if (e.key === 'Enter' && newHash.trim()) { s('hashtag_fissi', [...(k.hashtag_fissi || []), newHash.trim()]); setNewHash(''); } }} />
            <button onClick={() => { if (newHash.trim()) { s('hashtag_fissi', [...(k.hashtag_fissi || []), newHash.trim()]); setNewHash(''); } }}
              className="text-xs px-3 rounded-lg" style={{ background: '#3B82F615', color: '#3B82F6' }}>#</button></div>
        </section>

        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg, #EC4899, #8B5CF6)' }}>
          {saving ? '⏳ Salvataggio…' : '💾 Salva Brand Kit'}
        </button>
      </div>
    </div>
  );
}
