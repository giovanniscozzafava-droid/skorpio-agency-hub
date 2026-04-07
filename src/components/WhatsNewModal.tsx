import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

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
    description: 'Ogni mattina appare un popup con le tue priorita. Puoi completarle, minimizzare a icona, o cliccare per i dettagli.',
    color: '#6C5CE7',
    version: '2026-04-07',
  },
  {
    id: 'priority-click',
    icon: '🔴',
    title: 'Priorita cliccabile',
    description: 'Clicca il pallino colorato nella card per cambiare priorita. I task si riordinano in automatico.',
    color: '#EF4444',
    version: '2026-04-07',
  },
  {
    id: 'urgency-sort',
    icon: '⏱️',
    title: 'Ordinamento urgenza',
    description: 'I task sono ordinati per scadenza. Chi scade prima sta in cima. Scaduti sempre in testa.',
    color: '#F59E0B',
    version: '2026-04-07',
  },
  {
    id: 'supervisione',
    icon: '🔄',
    title: 'Supervisione Giovanni',
    description: 'Elisa puo attivare la supervisione in Revisione. Il CLP va a Giovanni prima della programmazione.',
    color: '#3B82F6',
    version: '2026-04-07',
  },
  {
    id: 'clip-download',
    icon: '📎',
    title: 'Download clip',
    description: 'Nel pannello Premontaggio trovi i link per scaricare le clip. Non serve piu cercarle su Drive.',
    color: '#22C55E',
    version: '2026-04-07',
  },
  {
    id: 'pub-date-visible',
    icon: '📡',
    title: 'Countdown pubblicazione',
    description: 'Ogni card mostra il countdown alla data di pubblicazione del CLP.',
    color: '#8B5CF6',
    version: '2026-04-07',
  },
];

async function markSeen(feature: Feature, userName: string) {
  await supabase.from('feature_learning').upsert({
    feature_id: feature.id,
    feature_title: feature.title,
    user_name: userName,
    version: feature.version,
    seen_at: new Date().toISOString(),
  }, { onConflict: 'feature_id,user_name' });
}

// ── POST-IT NOTES ──
interface Props {
  userName: string;
  onClose: () => void;
}

const POSITIONS = [
  { top: '70px', left: '24px' },
  { top: '70px', right: '24px' },
  { top: '280px', left: '24px' },
  { top: '280px', right: '24px' },
  { bottom: '120px', left: '24px' },
  { bottom: '120px', right: '24px' },
];

const ROTATIONS = [-3, 2, -2, 3, -1, 2];

export function WhatsNewModal({ userName, onClose }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    setTimeout(() => setEntering(false), 100);
  }, []);

  const dismiss = (feature: Feature) => {
    markSeen(feature, userName);
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(feature.id);
      if (next.size === FEATURES.length) {
        setTimeout(onClose, 300);
      }
      return next;
    });
  };

  const dismissAll = () => {
    FEATURES.forEach(f => markSeen(f, userName));
    onClose();
  };

  const remaining = FEATURES.filter(f => !dismissed.has(f.id));

  return (
    <div className="fixed inset-0" style={{ zIndex: 99998, pointerEvents: 'none' }}>
      {/* Sfondo leggero */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.15)', pointerEvents: 'auto' }} />

      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full shadow-lg text-xs font-bold"
        style={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--skorpio-text-primary))', pointerEvents: 'auto', zIndex: 99999 }}>
        {remaining.length > 0
          ? `${remaining.length} novita da leggere — clicca "Ho capito" su ognuna`
          : 'Tutto letto!'}
      </div>

      {/* Post-it notes */}
      {FEATURES.map((f, i) => {
        if (dismissed.has(f.id)) return null;
        const pos = POSITIONS[i % POSITIONS.length];
        const rot = ROTATIONS[i % ROTATIONS.length];
        return (
          <div key={f.id}
            className="absolute w-72 rounded-xl shadow-2xl transition-all duration-500"
            style={{
              ...pos,
              transform: `rotate(${rot}deg)${entering ? ' scale(0.8) translateY(20px)' : ' scale(1) translateY(0)'}`,
              opacity: entering ? 0 : 1,
              transitionDelay: `${i * 100}ms`,
              pointerEvents: 'auto',
              zIndex: 99999,
            }}>
            {/* Puntina */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full shadow-md"
              style={{ background: f.color, border: '2px solid white' }} />

            <div className="rounded-xl overflow-hidden" style={{ background: f.color + '12', border: `2px solid ${f.color}40`, backdropFilter: 'blur(12px)' }}>
              {/* Header */}
              <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                <span className="text-lg">{f.icon}</span>
                <span className="text-xs font-bold flex-1" style={{ color: f.color }}>{f.title}</span>
                
              </div>
              {/* Body */}
              <div className="px-3 pb-3">
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                  {f.description}
                </p>
              </div>
              <div className="px-3 pb-3 pt-1">
                <button onClick={() => dismiss(f)}
                  className="w-full py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all hover:brightness-110"
                  style={{ background: f.color, color: 'white' }}>
                  Ho capito
                </button>
              </div>
            </div>
          </div>
        );
      })}


    </div>
  );
}

// ── Hook ──
export function useWhatsNew(userName: string | null) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userName) return;
    const key = 'skorpio_whatsnew_' + userName;
    const seen = localStorage.getItem(key);
    if (seen !== CURRENT_VERSION) {
      const timer = setTimeout(() => setShow(true), 2500);
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

// ── PANNELLO ADMIN ──
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
        <h3 className="text-sm font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Formazione Team</h3>
        <button onClick={load} className="text-[10px] px-2 py-1 rounded-lg cursor-pointer"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>Aggiorna</button>
      </div>

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
                {teamNames.map(n => (
                  <td key={n} className="px-2 py-2 text-center" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                    {data[n]?.has(f.id) ? <span style={{ color: '#22C55E' }}>✓</span> : <span style={{ color: '#EF444480' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
