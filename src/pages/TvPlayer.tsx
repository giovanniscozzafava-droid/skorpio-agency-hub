import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────
interface Monitor {
  id: string; nome: string; slug: string; cliente_nome: string;
  orientamento: string; durata_immagine: number; transizione: string; attivo: boolean;
}
interface Contenuto {
  id: string; titolo: string; tipo: string;
  drive_url: string | null; thumbnail_url: string | null; durata_secondi: number;
}
interface Fascia {
  id: string; nome_fascia: string; giorni: string[];
  ora_inizio: string; ora_fine: string; contenuti_ids: string[]; attivo: boolean;
}

const GIORNO_MAP: Record<number, string> = { 0: 'dom', 1: 'lun', 2: 'mar', 3: 'mer', 4: 'gio', 5: 'ven', 6: 'sab' };

export default function TvPlayer() {
  const { slug } = useParams<{ slug: string }>();
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [fasce, setFasce] = useState<Fascia[]>([]);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeContenuti, setActiveContenuti] = useState<Contenuto[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [fasciaAttiva, setFasciaAttiva] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load monitor data ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!slug) return;
    const { data: m } = await supabase.from('monitor').select('*').eq('slug', slug).eq('attivo', true).single();
    if (!m) { setError('Monitor non trovato o disattivato'); return; }
    setMonitor(m as Monitor);

    const [{ data: c }, { data: f }] = await Promise.all([
      supabase.from('monitor_contenuti').select('*').eq('monitor_id', m.id).eq('attivo', true).order('ordine'),
      supabase.from('monitor_fasce').select('*').eq('monitor_id', m.id).eq('attivo', true).order('ora_inizio'),
    ]);
    setContenuti((c as Contenuto[]) || []);
    setFasce((f as Fascia[]) || []);
  }, [slug]);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh data every 5 minutes
  useEffect(() => {
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Determine active fascia based on current day/time ──────────────────────
  useEffect(() => {
    const updateFascia = () => {
      const now = new Date();
      const giorno = GIORNO_MAP[now.getDay()];
      const oraCorrente = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const fascia = fasce.find(f =>
        f.giorni.includes(giorno) &&
        f.ora_inizio <= oraCorrente &&
        f.ora_fine > oraCorrente
      );

      if (fascia) {
        const ids = fascia.contenuti_ids;
        const active = ids.map(id => contenuti.find(c => c.id === id)).filter(Boolean) as Contenuto[];
        if (active.length > 0) {
          setActiveContenuti(active);
          setFasciaAttiva(fascia.nome_fascia);
          return;
        }
      }

      // No active fascia — show all contenuti as fallback
      if (contenuti.length > 0) {
        setActiveContenuti(contenuti);
        setFasciaAttiva('');
      }
    };

    updateFascia();
    const interval = setInterval(updateFascia, 60 * 1000); // Check every minute
    return () => clearInterval(interval);
  }, [fasce, contenuti]);

  // ── Content rotation ───────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (activeContenuti.length <= 1) return;
    const trans = monitor?.transizione || 'fade';
    if (trans !== 'taglio') setTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(prev => (prev + 1) % activeContenuti.length);
      if (trans !== 'taglio') setTimeout(() => setTransitioning(false), 50);
    }, trans === 'taglio' ? 0 : 500);
  }, [activeContenuti.length, monitor?.transizione]);

  // Schedule next content
  useEffect(() => {
    if (activeContenuti.length === 0) return;
    const current = activeContenuti[currentIndex % activeContenuti.length];
    if (!current) return;

    // For video: wait for it to end
    if (current.tipo === 'video' && videoRef.current) {
      const handleEnded = () => goNext();
      const vid = videoRef.current;
      vid.addEventListener('ended', handleEnded);
      vid.play().catch(() => {});
      return () => vid.removeEventListener('ended', handleEnded);
    }

    // For images: use duration
    const dur = current.durata_secondi || monitor?.durata_immagine || 10;
    timerRef.current = setTimeout(goNext, dur * 1000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentIndex, activeContenuti, goNext, monitor?.durata_immagine]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ background: '#000', color: '#333', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, fontFamily: 'sans-serif' }}>{error}</p>
      </div>
    );
  }

  if (!monitor || activeContenuti.length === 0) {
    return (
      <div style={{ background: '#000', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: '3px solid #333', borderTopColor: '#666', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: '#444', fontSize: 12, fontFamily: 'sans-serif' }}>{monitor ? 'Nessun contenuto programmato' : 'Caricamento…'}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const current = activeContenuti[currentIndex % activeContenuti.length];
  const trans = monitor.transizione;
  const opacity = transitioning ? 0 : 1;
  const transform = transitioning && trans === 'slide' ? 'translateX(100%)' : 'translateX(0)';

  return (
    <div style={{ background: '#000', width: '100vw', height: '100vh', overflow: 'hidden', cursor: 'none', position: 'relative' }}>
      {/* Content */}
      <div style={{
        width: '100%', height: '100%',
        opacity, transform,
        transition: trans === 'taglio' ? 'none' : `opacity 0.5s ease, transform 0.5s ease`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {current.tipo === 'video' ? (
          <video
            ref={videoRef}
            key={current.id + '-' + currentIndex}
            src={current.drive_url || ''}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <img
            key={current.id + '-' + currentIndex}
            src={current.drive_url || current.thumbnail_url || ''}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            referrerPolicy="no-referrer"
          />
        )}
      </div>

      {/* Debug overlay — only visible with ?debug=1 */}
      {new URLSearchParams(window.location.search).get('debug') === '1' && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, right: 8,
          background: 'rgba(0,0,0,0.7)', color: '#aaa', padding: '8px 12px',
          borderRadius: 8, fontSize: 11, fontFamily: 'monospace',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>🖥️ {monitor.nome} · {monitor.cliente_nome}</span>
          <span>{fasciaAttiva && `📅 ${fasciaAttiva} · `}{currentIndex + 1}/{activeContenuti.length} · {current.titolo}</span>
          <span>{new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </div>
  );
}
