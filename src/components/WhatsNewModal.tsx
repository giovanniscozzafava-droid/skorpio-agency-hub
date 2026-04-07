import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ── FEATURES: aggiungi qui ogni volta che implementi qualcosa ──
// Cambia CURRENT_VERSION per far riapparire il tour
const CURRENT_VERSION = '2026-04-07';

export interface Feature {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
  version: string;
}

export const FEATURES: Feature[] = [
  {
    id: 'daily-priority',
    icon: '📋',
    title: 'Daily Priority',
    description: 'Ogni mattina e alle 17:00 appare un popup con le tue priorità del giorno. Puoi completare i task direttamente dal popup, minimizzarlo a icona, e cliccare un task per vedere i dettagli.',
    color: '#6C5CE7',
    version: '2026-04-07',
  },
  {
    id: 'priority-click',
    icon: '🔴',
    title: 'Priorità cliccabile',
    description: 'Il pallino colorato nella card del Kanban ora è cliccabile. Cliccalo per cambiare la priorità: Rosso (Alta) → Giallo (Media) → Verde (Bassa). I task si riordinano automaticamente.',
    color: '#EF4444',
    version: '2026-04-07',
  },
  {
    id: 'urgency-sort',
    icon: '⏱️',
    title: 'Ordinamento per urgenza',
    description: 'I task nel Kanban sono ordinati per data di pubblicazione del CLP. Chi scade prima sta in cima. I task scaduti sono sempre in cima con badge rosso.',
    color: '#F59E0B',
    version: '2026-04-07',
  },
  {
    id: 'supervisione',
    icon: '🔄',
    title: 'Supervisione Giovanni',
    description: 'In fase di Revisione, Elisa può attivare "Supervisione Giovanni". Il CLP passa a Giovanni per approvazione finale prima della programmazione.',
    color: '#3B82F6',
    version: '2026-04-07',
  },
  {
    id: 'clip-download',
    icon: '📎',
    title: 'Download clip nel Premontaggio',
    description: 'Nel pannello task di Premontaggio trovi i link per scaricare le clip girate. Non serve più cercarle su Drive.',
    color: '#22C55E',
    version: '2026-04-07',
  },
  {
    id: 'pub-date-visible',
    icon: '📡',
    title: 'Data pubblicazione visibile',
    description: 'Ogni card mostra il countdown alla data di pubblicazione del CLP con l\'icona 📡, anche se il task non ha una scadenza propria.',
    color: '#8B5CF6',
    version: '2026-04-07',
  },
];

// ── Salva nel DB che l'utente ha visto una feature ──
async function markSeen(feature: Feature, userName: string) {
  await supabase.from('feature_learning').upsert({
    feature_id: feature.id,
    feature_title: feature.title,
    user_name: userName,
    version: feature.version,
    seen_at: new Date().toISOString(),
  }, { onConflict: 'feature_id,user_name' });
}

// ── MODAL PRINCIPALE ──
interface Props {
  userName: string;
  onClose: () => void;
}

export function WhatsNewModal({ userName, onClose }: Props) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [seenSlides, setSeenSlides] = useState<Set<number>>(new Set([0]));

  const feature = FEATURES[currentSlide];
  const isLast = currentSlide === FEATURES.length - 1;
  const isFirst = currentSlide === 0;

  // Segna come vista quando arrivi sulla slide
  useEffect(() => {
    if (!seenSlides.has(currentSlide)) {
      setSeenSlides(prev => new Set(prev).add(currentSlide));
    }
    markSeen(FEATURES[currentSlide], userName);
  }, [currentSlide, userName]);

  const next = () => { if (isLast) { onClose(); } else setCurrentSlide(s => s + 1); };
  const prev = () => { if (!isFirst) setCurrentSlide(s => s - 1); };

  const skip = () => {
    // Segna TUTTE come viste
    FEATURES.forEach(f => markSeen(f, userName));
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', zIndex: 99998, backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl shadow-2xl" style={{ background: 'hsl(var(--background))' }}>

        {/* Header colorato */}
        <div className="relative p-8 pb-12 text-center" style={{ background: `linear-gradient(135deg, ${feature.color}, ${feature.color}CC)` }}>
          <button onClick={skip} className="absolute top-4 right-4 text-white/50 hover:text-white text-xs cursor-pointer">
            Salta tutto
          </button>
          <div className="text-5xl mb-3">{feature.icon}</div>
          <h2 className="text-white text-xl font-bold">{feature.title}</h2>
          <p className="text-white/50 text-[10px] mt-2">Aggiunto il {feature.version}</p>
        </div>

        {/* Contenuto */}
        <div className="px-6 pt-6 pb-4">
          <p className="text-sm leading-relaxed" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {feature.description}
          </p>
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {FEATURES.map((_, i) => (
            <div key={i} className="rounded-full transition-all cursor-pointer"
              onClick={() => setCurrentSlide(i)}
              style={{
                width: i === currentSlide ? 20 : 6,
                height: 6,
                background: i === currentSlide ? feature.color : 'hsl(var(--border))',
              }} />
          ))}
        </div>

        {/* Bottoni */}
        <div className="flex gap-3 px-6 pb-6">
          {!isFirst && (
            <button onClick={prev}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border cursor-pointer"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}>
              Indietro
            </button>
          )}
          <button onClick={next}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer"
            style={{ background: feature.color }}>
            {isLast ? 'Ho capito!' : `Avanti (${currentSlide + 1}/${FEATURES.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Hook: mostra solo se ci sono novità non viste ──
export function useWhatsNew(userName: string | null) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userName) return;
    const key = 'skorpio_whatsnew_' + userName;
    const seen = localStorage.getItem(key);
    if (seen !== CURRENT_VERSION) {
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [userName]);

  const close = () => {
    if (!userName) return;
    localStorage.setItem('skorpio_whatsnew_' + userName, CURRENT_VERSION);
    setShow(false);
  };

  return { show, close };
}

// ── PANNELLO ADMIN: chi ha imparato cosa ──
interface AdminProps {
  team: { nome: string }[];
}

export function FeatureLearningAdmin({ team }: AdminProps) {
  const [data, setData] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('feature_learning').select('*');
    const map: Record<string, Set<string>> = {};
    (rows || []).forEach((r: any) => {
      if (!map[r.user_name]) map[r.user_name] = new Set();
      map[r.user_name].add(r.feature_id);
    });
    setData(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-center py-4 text-xs text-muted-foreground">Caricamento...</div>;

  const teamNames = team.map(t => t.nome);
  const totalFeatures = FEATURES.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
          Formazione Team
        </h3>
        <button onClick={load} className="text-[10px] px-2 py-1 rounded-lg cursor-pointer"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
          Aggiorna
        </button>
      </div>

      {/* Progress per persona */}
      {teamNames.map(name => {
        const seen = data[name]?.size || 0;
        const pct = Math.round(seen / totalFeatures * 100);
        return (
          <div key={name} className="rounded-xl p-3" style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{name}</span>
              <span className="text-xs font-bold" style={{ color: pct === 100 ? '#22C55E' : pct >= 50 ? '#F59E0B' : '#EF4444' }}>
                {seen}/{totalFeatures} ({pct}%)
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--border))' }}>
              <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: pct === 100 ? '#22C55E' : pct >= 50 ? '#F59E0B' : '#EF4444' }} />
            </div>
          </div>
        );
      })}

      {/* Matrice dettagliata */}
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid hsl(var(--border))' }}>
        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="text-left px-3 py-2 font-semibold" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>Funzione</th>
              {teamNames.map(n => (
                <th key={n} className="px-2 py-2 text-center font-semibold" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                  {n.split(' ')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map(f => (
              <tr key={f.id}>
                <td className="px-3 py-2 font-medium" style={{ borderTop: '1px solid hsl(var(--border))', color: 'hsl(var(--skorpio-text-primary))' }}>
                  {f.icon} {f.title}
                </td>
                {teamNames.map(n => {
                  const seen = data[n]?.has(f.id);
                  return (
                    <td key={n} className="px-2 py-2 text-center" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                      {seen ? <span style={{ color: '#22C55E' }}>✓</span> : <span style={{ color: '#EF444480' }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
