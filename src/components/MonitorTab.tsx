import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

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

interface Monitor { id: string; cliente_id: string | null; cliente_nome: string; nome: string; slug: string; orientamento: 'orizzontale' | 'verticale'; risoluzione: string; durata_immagine: number; transizione: 'fade' | 'slide' | 'taglio'; attivo: boolean; drive_monitor_folder_id: string | null; created_at: string; }
interface MonitorContenuto { id: string; monitor_id: string; cliente_id: string | null; titolo: string; tipo: 'immagine' | 'video'; drive_file_id: string | null; drive_url: string | null; thumbnail_url: string | null; durata_secondi: number; ordine: number; attivo: boolean; }
interface MonitorFascia { id: string; monitor_id: string; nome_fascia: string; giorni: string[]; ora_inizio: string; ora_fine: string; contenuti_ids: string[]; transizione: string | null; attivo: boolean; }
interface Cliente { id: string; nome: string; logo_url?: string | null; }
interface DriveFile { id: string; name: string; mimeType: string; size?: string; thumbnailLink?: string; }

const GIORNI_LABELS: Record<string, string> = { lun: 'Lun', mar: 'Mar', mer: 'Mer', gio: 'Gio', ven: 'Ven', sab: 'Sab', dom: 'Dom' };
const GIORNI_ALL = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

export function MonitorTab({ clienti }: { clienti: Cliente[] }) {
  const { utente, addToast } = useApp();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<Monitor | null>(null);
  const [contenuti, setContenuti] = useState<MonitorContenuto[]>([]);
  const [fasce, setFasce] = useState<MonitorFascia[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const loadMonitors = useCallback(async () => { const { data } = await supabase.from('monitor').select('*').order('cliente_nome'); setMonitors((data as Monitor[]) || []); setLoading(false); }, []);
  useEffect(() => { loadMonitors(); }, [loadMonitors]);

  const loadDetails = useCallback(async (mid: string) => {
    const [{ data: c }, { data: f }] = await Promise.all([supabase.from('monitor_contenuti').select('*').eq('monitor_id', mid).order('ordine'), supabase.from('monitor_fasce').select('*').eq('monitor_id', mid).order('ora_inizio')]);
    setContenuti((c as MonitorContenuto[]) || []); setFasce((f as MonitorFascia[]) || []);
  }, []);
  useEffect(() => { if (selected) loadDetails(selected.id); }, [selected, loadDetails]);

  if (!selected) return (
    <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🖥️ Palinsesto Monitor</h1><p className="text-sm mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Gestione contenuti monitor pubblicitari</p></div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>+ Nuovo Monitor</button>
      </div>
      {loading ? <p className="text-sm text-center py-12" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Caricamento…</p> : monitors.length === 0 ? (
        <div className="text-center py-16"><span className="text-5xl block mb-4">🖥️</span><p className="text-sm" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessun monitor configurato</p><button onClick={() => setShowNew(true)} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>+ Aggiungi il primo</button></div>
      ) : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{monitors.map(m => <button key={m.id} onClick={() => setSelected(m)} className="rounded-xl border p-4 text-left hover:shadow-lg transition-all" style={{ background: 'hsl(var(--card))', borderColor: m.attivo ? '#3B82F640' : 'hsl(var(--border))' }}>
        <div className="flex items-center gap-3 mb-3"><div className="text-3xl">{m.orientamento === 'orizzontale' ? '🖥️' : '📱'}</div><div className="flex-1 min-w-0"><p className="text-sm font-bold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{m.nome}</p><p className="text-xs truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{m.cliente_nome}</p></div><div className={`w-2.5 h-2.5 rounded-full ${m.attivo ? 'animate-pulse' : ''}`} style={{ background: m.attivo ? '#22C55E' : '#94A3B8' }} /></div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}><span className="px-1.5 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>{m.orientamento === 'orizzontale' ? '⬛ 16:9' : '⬜ 9:16'}</span><span className="px-1.5 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>{m.transizione}</span>{m.drive_monitor_folder_id && <span className="px-1.5 py-0.5 rounded" style={{ background: '#22C55E20', color: '#22C55E' }}>📂 Drive</span>}</div>
        <div className="mt-3 text-[10px] font-mono truncate" style={{ color: '#3B82F6' }}>/tv/{m.slug}</div>
      </button>)}</div>}
      {showNew && <NewMonitorModal clienti={clienti} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); loadMonitors(); addToast('✅ Monitor creato!', 'success'); }} />}
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => setSelected(null)} className="text-sm px-3 py-1.5 rounded-lg" style={{ background: 'hsl(var(--muted))' }}>← Indietro</button>
        <div className="flex-1 min-w-0"><h1 className="text-lg font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{selected.orientamento === 'orizzontale' ? '🖥️' : '📱'} {selected.nome}</h1><p className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{selected.cliente_nome} · /tv/{selected.slug}</p></div>
        <div className={`w-3 h-3 rounded-full ${selected.attivo ? 'animate-pulse' : ''}`} style={{ background: selected.attivo ? '#22C55E' : '#94A3B8' }} />
        <a href={`/tv/${selected.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: '#7C3AED' }}>👁️ Preview TV</a>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ContenutiPanel monitor={selected} contenuti={contenuti} onReload={() => { loadDetails(selected.id); loadMonitors(); }} />
        <FascePanel monitorId={selected.id} fasce={fasce} contenuti={contenuti} onReload={() => loadDetails(selected.id)} />
      </div>
    </div>
  );
}

function NewMonitorModal({ clienti, onClose, onCreated }: { clienti: Cliente[]; onClose: () => void; onCreated: () => void }) {
  const { utente, addToast } = useApp();
  const [clienteId, setClienteId] = useState(''); const [nome, setNome] = useState('Reception'); const [slug, setSlug] = useState(''); const [orient, setOrient] = useState<'orizzontale' | 'verticale'>('orizzontale'); const [saving, setSaving] = useState(false);
  const clienteNome = clienti.find(c => c.id === clienteId)?.nome || '';
  useEffect(() => { if (clienteNome) setSlug(clienteNome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }, [clienteNome]);

  const handleCreate = async () => {
    if (!clienteId || !slug.trim()) return; setSaving(true);
    let driveFolderId: string | null = null;
    try {
      const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
      const tid = dt?.[0]?.id || utente?.id;
      if (tid) { const r = await invokeEdge('create-drive-folder', { contenuto_id: `monitor_${slug}`, titolo: `MONITOR_${clienteNome}`, cliente_nome: clienteNome, tipo: 'Monitor', id_display: `MON_${slug}`, team_id: tid }); if (r.success && r.folder_id) { driveFolderId = r.folder_id; addToast(`📂 Cartella Drive creata`, 'success'); } }
    } catch { addToast('⚠️ Cartella Drive non creata', 'warn'); }
    const { error } = await supabase.from('monitor').insert({ cliente_id: clienteId, cliente_nome: clienteNome, nome: nome.trim() || 'Reception', slug: slug.trim(), orientamento: orient, risoluzione: orient === 'orizzontale' ? '1920x1080' : '1080x1920', drive_monitor_folder_id: driveFolderId });
    setSaving(false);
    if (error) alert('Errore: ' + (error.message.includes('duplicate') ? 'Slug già in uso' : error.message)); else onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl border shadow-2xl p-5 w-full max-w-md" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🖥️ Nuovo Monitor</h2>
        <div className="space-y-3">
          <div><label className="sk-label">Cliente</label><select className="sk-select w-full text-sm" value={clienteId} onChange={e => setClienteId(e.target.value)}><option value="">— Seleziona —</option>{clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
          <div><label className="sk-label">Nome monitor</label><input className="sk-input w-full text-sm" value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Reception" /></div>
          <div><label className="sk-label">Slug (URL)</label><div className="flex items-center gap-1"><span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>/tv/</span><input className="sk-input flex-1 text-sm font-mono" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></div></div>
          <div><label className="sk-label">Orientamento</label><div className="flex gap-2">{(['orizzontale','verticale'] as const).map(o => <button key={o} onClick={() => setOrient(o)} className="flex-1 py-2 rounded-lg text-sm font-semibold border" style={{ background: orient===o ? (o==='orizzontale'?'#3B82F620':'#8B5CF620') : 'transparent', borderColor: orient===o ? (o==='orizzontale'?'#3B82F6':'#8B5CF6') : 'hsl(var(--border))', color: orient===o ? (o==='orizzontale'?'#3B82F6':'#8B5CF6') : 'hsl(var(--skorpio-text-secondary))' }}>{o==='orizzontale'?'⬛ Orizzontale (16:9)':'⬜ Verticale (9:16)'}</button>)}</div></div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-sm" style={{ background: 'hsl(var(--muted))' }}>Annulla</button>
          <button onClick={handleCreate} disabled={!clienteId||!slug.trim()||saving} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: '#3B82F6' }}>{saving ? '⏳ Creo monitor + Drive…' : '✅ Crea monitor'}</button>
        </div>
      </div>
    </div>
  );
}

function ContenutiPanel({ monitor, contenuti, onReload }: { monitor: Monitor; contenuti: MonitorContenuto[]; onReload: () => void }) {
  const { utente, addToast } = useApp();
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]); const [loadingDrive, setLoadingDrive] = useState(false); const [showDrive, setShowDrive] = useState(false); const [saving, setSaving] = useState(false);
  const [folderId, setFolderId] = useState(monitor.drive_monitor_folder_id);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const getTeamId = async () => {
    const { data: dt } = await supabase.from('team').select('id').eq('google_drive_connected', true).limit(1);
    return dt?.[0]?.id || utente?.id || '';
  };

  const ensureDriveFolder = async (): Promise<string | null> => {
    if (folderId) return folderId;
    addToast('📂 Creo cartella Monitor su Drive…', 'info');
    try {
      const tid = await getTeamId();
      if (!tid) { addToast('⚠️ Nessun utente con Drive connesso', 'warn'); return null; }
      const r = await invokeEdge('create-drive-folder', {
        contenuto_id: `monitor_${monitor.slug}`,
        titolo: `MONITOR_${monitor.cliente_nome}`,
        cliente_nome: monitor.cliente_nome,
        tipo: 'Monitor',
        id_display: `MON_${monitor.slug}`,
        team_id: tid,
      });
      if (r.success && r.folder_id) {
        await supabase.from('monitor').update({ drive_monitor_folder_id: r.folder_id }).eq('id', monitor.id);
        setFolderId(r.folder_id);
        addToast(`✅ Cartella Drive creata!`, 'success');
        return r.folder_id;
      }
    } catch (e: any) { addToast(`❌ Errore Drive: ${e.message}`, 'error'); }
    return null;
  };

  const loadDriveFiles = async () => {
    setLoadingDrive(true); setShowDrive(true);
    const driveFolder = await ensureDriveFolder();
    if (!driveFolder) { setLoadingDrive(false); return; }
    try {
      const tid = await getTeamId();
      const result = await invokeEdge('google-drive-list-files', { folderId: driveFolder, teamId: tid });
      setDriveFiles(result.files || []);
    } catch (e: any) { addToast(`❌ Drive: ${e.message}`, 'error'); }
    setLoadingDrive(false);
  };

  // ── Upload file to Drive ───────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset input

    const driveFolder = await ensureDriveFolder();
    if (!driveFolder) return;

    setUploading(true); setUploadProgress(0);
    try {
      const tid = await getTeamId();
      const mimeType = file.type || 'application/octet-stream';

      // Init resumable upload
      const initRes = await invokeEdge('google-drive-upload-init', {
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        teamId: tid,
        clientName: monitor.cliente_nome,
        zone: 'monitor',
        contenutoId: `monitor_${monitor.slug}`,
        idDisplay: `MON_${monitor.slug}`,
        titolo: `MONITOR_${monitor.cliente_nome}`,
        folderId: driveFolder,
      });

      const uploadUrl = initRes.uploadUrl;
      if (!uploadUrl) throw new Error('Nessun uploadUrl ricevuto');

      // Chunked upload
      const CHUNK = 4 * 1024 * 1024;
      let uploaded = 0;
      let fileId = '';

      while (uploaded < file.size) {
        const end = Math.min(uploaded + CHUNK, file.size);
        const chunk = file.slice(uploaded, end);
        const contentRange = `bytes ${uploaded}-${end - 1}/${file.size}`;

        const chunkRes = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-upload-chunk`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'x-upload-url': uploadUrl,
            'x-content-range': contentRange,
            'x-content-type': mimeType,
            'Content-Type': 'application/octet-stream',
          },
          body: chunk,
        });

        if (!chunkRes.ok) {
          const err = await chunkRes.json().catch(() => ({ error: `HTTP ${chunkRes.status}` }));
          throw new Error(err?.error || 'Upload chunk fallito');
        }

        const chunkData = await chunkRes.json();
        uploaded = end;
        setUploadProgress(Math.round((uploaded / file.size) * 100));

        if (chunkData.fileId) fileId = chunkData.fileId;
      }

      if (!fileId) throw new Error('Upload completato ma nessun fileId');

      // Auto-add to monitor contenuti
      const isVideo = mimeType.startsWith('video/');
      const thumb = `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
      const streamUrl = `${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${encodeURIComponent(fileId)}&teamId=${encodeURIComponent(tid)}`;

      await supabase.from('monitor_contenuti').insert({
        monitor_id: monitor.id, cliente_id: monitor.cliente_id,
        titolo: file.name.replace(/\.[^/.]+$/, ''),
        tipo: isVideo ? 'video' : 'immagine',
        drive_file_id: fileId, drive_url: streamUrl, thumbnail_url: thumb,
        durata_secondi: isVideo ? 0 : monitor.durata_immagine,
        ordine: contenuti.length,
      });

      onReload();
      addToast(`✅ "${file.name}" caricato e aggiunto al monitor!`, 'success');

      // Refresh Drive files list if open
      if (showDrive) loadDriveFiles();

    } catch (e: any) {
      addToast(`❌ Upload fallito: ${e.message}`, 'error');
    }
    setUploading(false); setUploadProgress(0);
  };

  const addFromDrive = async (file: DriveFile) => {
    setSaving(true);
    const isVideo = file.mimeType.startsWith('video/');
    const thumb = file.thumbnailLink || `https://drive.google.com/thumbnail?id=${file.id}&sz=w640`;
    const tid = await getTeamId();
    const streamUrl = `${SUPABASE_URL}/functions/v1/google-drive-stream?fileId=${encodeURIComponent(file.id)}&teamId=${encodeURIComponent(tid)}`;
    await supabase.from('monitor_contenuti').insert({ monitor_id: monitor.id, cliente_id: monitor.cliente_id, titolo: file.name.replace(/\.[^/.]+$/, ''), tipo: isVideo ? 'video' : 'immagine', drive_file_id: file.id, drive_url: streamUrl, thumbnail_url: thumb, durata_secondi: isVideo ? 0 : monitor.durata_immagine, ordine: contenuti.length });
    setSaving(false); onReload(); addToast(`✅ "${file.name}" aggiunto`, 'success');
  };

  const isAdded = (fid: string) => contenuti.some(c => c.drive_file_id === fid);
  const handleDelete = async (id: string) => { await supabase.from('monitor_contenuti').delete().eq('id', id); onReload(); addToast('🗑️ Rimosso', 'info'); };
  const toggleAttivo = async (id: string, cur: boolean) => { await supabase.from('monitor_contenuti').update({ attivo: !cur }).eq('id', id); onReload(); };

  return (
    <div className="rounded-xl border" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🎬 Contenuti ({contenuti.length})</span>
        <div className="flex gap-1.5">
          <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="text-xs px-3 py-1 rounded-lg font-semibold text-white" style={{ background: '#3B82F6' }}>
            {uploading ? `⏳ ${uploadProgress}%` : '⬆️ Carica'}
          </button>
          <button onClick={loadDriveFiles} disabled={loadingDrive} className="text-xs px-3 py-1 rounded-lg font-semibold text-white" style={{ background: '#22C55E' }}>{loadingDrive ? '⏳…' : '📂 Sfoglia Drive'}</button>
        </div>
      </div>
      {/* Upload progress bar */}
      {uploading && (
        <div className="px-4 pb-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
            <div className="h-full rounded-full transition-all" style={{ background: '#3B82F6', width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}
      <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto">
        {contenuti.length === 0 ? <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessun contenuto. Clicca "⬆️ Carica" o "📂 Sfoglia Drive"!</p> : contenuti.map(c => (
          <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: c.attivo ? 'hsl(var(--muted)/0.3)' : 'hsl(0 0% 50%/0.05)', opacity: c.attivo ? 1 : 0.5 }}>
            <div className="w-12 h-8 rounded overflow-hidden flex-shrink-0" style={{ background: '#1E293B' }}>{c.thumbnail_url ? <img src={c.thumbnail_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-sm">{c.tipo==='video'?'🎥':'🖼️'}</div>}</div>
            <div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.titolo}</p><p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{c.tipo==='video'?'🎥 Video':`🖼️ ${c.durata_secondi}s`}</p></div>
            <button onClick={() => toggleAttivo(c.id, c.attivo)} className="text-xs">{c.attivo ? '🟢' : '⚪'}</button>
            <button onClick={() => handleDelete(c.id)} className="text-xs hover:bg-red-100 rounded px-1">🗑️</button>
          </div>
        ))}
      </div>
      {showDrive && <div className="border-t p-3" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(160 40% 97%)' }}>
        <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold" style={{ color: '#16A34A' }}>📂 Google Drive</span><button onClick={() => setShowDrive(false)} className="text-xs px-2 py-0.5 rounded" style={{ background: 'hsl(var(--muted))' }}>✕</button></div>
        {loadingDrive ? <p className="text-xs text-center py-4" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>⏳ Caricamento…</p> : driveFiles.length === 0 ? <p className="text-xs text-center py-4" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Cartella vuota. Carica file su Drive nella cartella MONITOR.</p> : <div className="space-y-1.5 max-h-[200px] overflow-y-auto">{driveFiles.map(f => {
          const added = isAdded(f.id); const isV = f.mimeType.startsWith('video/');
          return <div key={f.id} className="flex items-center gap-2 p-1.5 rounded-lg" style={{ background: added?'#22C55E10':'white', border: added?'1px solid #22C55E40':'1px solid hsl(var(--border))' }}>
            <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0" style={{ background: '#1E293B' }}>{f.thumbnailLink ? <img src={f.thumbnailLink} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-sm">{isV?'🎥':'🖼️'}</div>}</div>
            <div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate">{f.name}</p><p className="text-[9px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{isV?'🎥 Video':'🖼️ Immagine'}{f.size ? ` · ${(Number(f.size)/1048576).toFixed(1)}MB`:''}</p></div>
            {added ? <span className="text-[10px] font-semibold" style={{ color: '#22C55E' }}>✅</span> : <button onClick={() => addFromDrive(f)} disabled={saving} className="text-[10px] px-2 py-1 rounded-lg font-semibold text-white" style={{ background: '#3B82F6' }}>{saving?'⏳':'+ Aggiungi'}</button>}
          </div>;
        })}</div>}
        <button onClick={loadDriveFiles} className="mt-2 text-[10px] px-2 py-1 rounded" style={{ color: '#16A34A' }}>🔄 Ricarica</button>
      </div>}
    </div>
  );
}

function FascePanel({ monitorId, fasce, contenuti, onReload }: { monitorId: string; fasce: MonitorFascia[]; contenuti: MonitorContenuto[]; onReload: () => void }) {
  const { addToast } = useApp();
  const [showAdd, setShowAdd] = useState(false); const [nomeFascia, setNomeFascia] = useState(''); const [giorni, setGiorni] = useState<string[]>(['lun','mar','mer','gio','ven']); const [oraInizio, setOraInizio] = useState('09:00'); const [oraFine, setOraFine] = useState('18:00'); const [selCont, setSelCont] = useState<string[]>([]); const [saving, setSaving] = useState(false);
  const tg = (g: string) => setGiorni(p => p.includes(g)?p.filter(x=>x!==g):[...p,g]);
  const tc = (id: string) => setSelCont(p => p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const handleAdd = async () => {
    if (!nomeFascia.trim()||giorni.length===0||selCont.length===0) return; setSaving(true);
    await supabase.from('monitor_fasce').insert({ monitor_id: monitorId, nome_fascia: nomeFascia.trim(), giorni, ora_inizio: oraInizio, ora_fine: oraFine, contenuti_ids: selCont });
    setSaving(false); setShowAdd(false); setNomeFascia(''); setSelCont([]); onReload(); addToast('✅ Fascia creata', 'success');
  };
  const del = async (id: string) => { await supabase.from('monitor_fasce').delete().eq('id', id); onReload(); addToast('🗑️ Rimossa', 'info'); };
  const tog = async (id: string, cur: boolean) => { await supabase.from('monitor_fasce').update({ attivo: !cur }).eq('id', id); onReload(); };

  return (
    <div className="rounded-xl border" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>📅 Palinsesto ({fasce.length})</span>
        <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1 rounded-lg font-semibold text-white" style={{ background: '#8B5CF6' }}>+ Fascia</button>
      </div>
      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {fasce.length===0 ? <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Nessuna fascia. Crea il palinsesto!</p> : fasce.map(f => <div key={f.id} className="rounded-lg border p-3" style={{ borderColor: f.attivo?'#8B5CF640':'hsl(var(--border))', opacity: f.attivo?1:0.5 }}>
          <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-bold" style={{ color: '#8B5CF6' }}>{f.nome_fascia}</span><div className="flex gap-1"><button onClick={() => tog(f.id, f.attivo)} className="text-xs">{f.attivo?'🟢':'⚪'}</button><button onClick={() => del(f.id)} className="text-xs hover:bg-red-100 rounded px-1">🗑️</button></div></div>
          <div className="flex items-center gap-2 mb-1.5"><span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>🕐 {f.ora_inizio.slice(0,5)} – {f.ora_fine.slice(0,5)}</span><div className="flex gap-0.5">{GIORNI_ALL.map(g => <span key={g} className="text-[9px] px-1 py-0.5 rounded font-medium" style={{ background: f.giorni.includes(g)?'#8B5CF620':'transparent', color: f.giorni.includes(g)?'#8B5CF6':'hsl(var(--skorpio-text-tertiary))' }}>{GIORNI_LABELS[g]}</span>)}</div></div>
          <p className="text-[10px] truncate" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>🎬 {f.contenuti_ids.length} contenut{f.contenuti_ids.length===1?'o':'i'}: {f.contenuti_ids.map(id => contenuti.find(c=>c.id===id)?.titolo||'?').join(', ')}</p>
        </div>)}
      </div>
      {showAdd && <div className="p-3 border-t space-y-3" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted)/0.2)' }}>
        <input className="sk-input w-full text-sm" placeholder="Nome fascia…" value={nomeFascia} onChange={e => setNomeFascia(e.target.value)} />
        <div><label className="sk-label">Giorni</label><div className="flex gap-1 flex-wrap">{GIORNI_ALL.map(g => <button key={g} onClick={() => tg(g)} className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: giorni.includes(g)?'#8B5CF6':'hsl(var(--muted))', color: giorni.includes(g)?'white':'hsl(var(--skorpio-text-secondary))' }}>{GIORNI_LABELS[g]}</button>)}</div></div>
        <div className="flex gap-2"><div className="flex-1"><label className="sk-label">Inizio</label><input type="time" className="sk-input w-full text-sm" value={oraInizio} onChange={e => setOraInizio(e.target.value)} /></div><div className="flex-1"><label className="sk-label">Fine</label><input type="time" className="sk-input w-full text-sm" value={oraFine} onChange={e => setOraFine(e.target.value)} /></div></div>
        <div><label className="sk-label">Contenuti</label><div className="space-y-1 max-h-32 overflow-y-auto">{contenuti.filter(c=>c.attivo).map(c => <button key={c.id} onClick={() => tc(c.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs" style={{ background: selCont.includes(c.id)?'#8B5CF615':'transparent', border: selCont.includes(c.id)?'1px solid #8B5CF640':'1px solid transparent' }}><span>{selCont.includes(c.id)?'☑️':'⬜'}</span><span className="truncate">{c.tipo==='video'?'🎥':'🖼️'} {c.titolo}</span></button>)}{contenuti.filter(c=>c.attivo).length===0 && <p className="text-[10px] text-center py-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Aggiungi prima contenuti da Drive</p>}</div></div>
        <div className="flex gap-2"><button onClick={() => setShowAdd(false)} className="flex-1 py-1.5 rounded-lg text-xs" style={{ background: 'hsl(var(--muted))' }}>Annulla</button><button onClick={handleAdd} disabled={!nomeFascia.trim()||giorni.length===0||selCont.length===0||saving} className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{ background: '#8B5CF6' }}>{saving?'⏳…':'✅ Crea fascia'}</button></div>
      </div>}
    </div>
  );
}
