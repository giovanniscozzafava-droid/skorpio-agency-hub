import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

interface ErrorLog {
  id: string;
  tipo: string;
  messaggio: string;
  stack: string | null;
  component: string | null;
  url: string | null;
  user_nome: string | null;
  contesto: string | null;
  risolto: boolean;
  created_at: string;
}

const TIPO_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  react_error: { bg: '#FEE2E2', text: '#DC2626', icon: '💥' },
  window_error: { bg: '#FEE2E2', text: '#DC2626', icon: '🪟' },
  unhandled_rejection: { bg: '#FEF3C7', text: '#D97706', icon: '⚠️' },
  edge_function_error: { bg: '#E0E7FF', text: '#4F46E5', icon: '☁️' },
  network_error: { bg: '#FCE7F3', text: '#BE185D', icon: '📡' },
  asset_upload_error: { bg: '#DBEAFE', text: '#1E40AF', icon: '⬆️' },
  asset_library_folder_error: { bg: '#DBEAFE', text: '#1E40AF', icon: '📂' },
  generic: { bg: '#F1F5F9', text: '#475569', icon: '❓' },
};

const getTipoStyle = (tipo: string) => TIPO_COLORS[tipo] || TIPO_COLORS.generic;

export function DebugTab() {
  const { utente, addToast } = useApp();
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [timeRange, setTimeRange] = useState<'hour' | 'today' | 'week' | 'all'>('week');
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [groupBy, setGroupBy] = useState<'none' | 'messaggio' | 'tipo' | 'user'>('messaggio');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('error_log').select('*').order('created_at', { ascending: false }).limit(500);
    const now = new Date();
    if (timeRange === 'hour') q = q.gte('created_at', new Date(now.getTime() - 3600000).toISOString());
    else if (timeRange === 'today') q = q.gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
    else if (timeRange === 'week') q = q.gte('created_at', new Date(now.getTime() - 7 * 86400000).toISOString());

    const { data, error } = await q;
    if (error) console.error('[Debug] load error:', error);
    setErrors((data as ErrorLog[]) || []);
    setLoading(false);
  }, [timeRange]);

  useEffect(() => { load(); }, [load]);

  // Realtime — nuovi errori in arrivo
  useEffect(() => {
    const ch = supabase
      .channel('error_log_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'error_log' }, (payload) => {
        const newErr = payload.new as ErrorLog;
        setErrors(prev => [newErr, ...prev].slice(0, 500));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggleResolved = async (id: string, current: boolean) => {
    await supabase.from('error_log').update({ risolto: !current }).eq('id', id);
    setErrors(prev => prev.map(e => e.id === id ? { ...e, risolto: !current } : e));
    if (selectedError?.id === id) setSelectedError(prev => prev ? { ...prev, risolto: !current } : null);
    addToast(current ? '↩️ Marcato come non risolto' : '✅ Marcato come risolto', 'info');
  };

  const deleteError = async (id: string) => {
    if (!confirm('Eliminare definitivamente questo errore?')) return;
    await supabase.from('error_log').delete().eq('id', id);
    setErrors(prev => prev.filter(e => e.id !== id));
    setSelectedError(null);
  };

  const clearResolved = async () => {
    if (!confirm('Eliminare TUTTI gli errori risolti?')) return;
    await supabase.from('error_log').delete().eq('risolto', true);
    setErrors(prev => prev.filter(e => !e.risolto));
    addToast('🗑️ Errori risolti eliminati', 'success');
  };

  // Filter
  const filtered = useMemo(() => {
    let list = errors;
    if (filter === 'unresolved') list = list.filter(e => !e.risolto);
    if (filter === 'resolved') list = list.filter(e => e.risolto);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.messaggio.toLowerCase().includes(q) ||
        e.tipo.toLowerCase().includes(q) ||
        (e.user_nome || '').toLowerCase().includes(q) ||
        (e.component || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [errors, filter, search]);

  // Group
  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'Tutti', items: filtered }];
    const map = new Map<string, ErrorLog[]>();
    for (const e of filtered) {
      let key = '';
      if (groupBy === 'messaggio') key = e.messaggio.slice(0, 100);
      else if (groupBy === 'tipo') key = e.tipo;
      else if (groupBy === 'user') key = e.user_nome || 'anonimo';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [filtered, groupBy]);

  const stats = useMemo(() => ({
    total: errors.length,
    unresolved: errors.filter(e => !e.risolto).length,
    resolved: errors.filter(e => e.risolto).length,
    lastHour: errors.filter(e => new Date(e.created_at).getTime() > Date.now() - 3600000).length,
  }), [errors]);

  if (utente?.ruolo !== 'Admin') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <span className="text-5xl block mb-4">🔒</span>
          <p className="text-sm font-semibold" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>Accesso riservato</p>
          <p className="text-xs mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Solo gli Admin possono vedere il tab Debug</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
              🔧 Debug Console
              {stats.unresolved > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EF4444', color: '#fff' }}>
                  {stats.unresolved} da risolvere
                </span>
              )}
            </h1>
            <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              Tutti gli errori raccolti da SKORPIO per debugging
            </p>
          </div>
          <button onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all hover:scale-105"
            style={{ background: 'hsl(var(--muted))' }}>
            🔄 Aggiorna
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <StatCard label="Totali" value={stats.total} color="#64748B" />
          <StatCard label="Da risolvere" value={stats.unresolved} color="#EF4444" />
          <StatCard label="Risolti" value={stats.resolved} color="#22C55E" />
          <StatCard label="Ultima ora" value={stats.lastHour} color="#F59E0B" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'hsl(var(--muted))' }}>
            {(['unresolved', 'resolved', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="text-[10px] px-2.5 py-1 rounded-md font-bold transition-all"
                style={{ background: filter === f ? '#8B5CF6' : 'transparent', color: filter === f ? '#fff' : 'hsl(var(--skorpio-text-tertiary))' }}>
                {f === 'unresolved' ? 'Da risolvere' : f === 'resolved' ? 'Risolti' : 'Tutti'}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'hsl(var(--muted))' }}>
            {(['hour', 'today', 'week', 'all'] as const).map(f => (
              <button key={f} onClick={() => setTimeRange(f)}
                className="text-[10px] px-2.5 py-1 rounded-md font-bold transition-all"
                style={{ background: timeRange === f ? '#3B82F6' : 'transparent', color: timeRange === f ? '#fff' : 'hsl(var(--skorpio-text-tertiary))' }}>
                {f === 'hour' ? 'Ora' : f === 'today' ? 'Oggi' : f === 'week' ? 'Settimana' : 'Tutto'}
              </button>
            ))}
          </div>
          <select className="sk-select text-[10px] py-1" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
            <option value="messaggio">Raggruppa per messaggio</option>
            <option value="tipo">Raggruppa per tipo</option>
            <option value="user">Raggruppa per utente</option>
            <option value="none">Non raggruppare</option>
          </select>
          <input className="sk-input text-[10px] py-1 flex-1 min-w-[150px]" placeholder="🔍 Cerca…" value={search} onChange={e => setSearch(e.target.value)} />
          {stats.resolved > 0 && (
            <button onClick={clearResolved}
              className="text-[10px] px-2 py-1 rounded-lg font-semibold"
              style={{ background: '#EF444415', color: '#EF4444' }}>
              🗑️ Pulisci risolti
            </button>
          )}
        </div>
      </div>

      {/* List + Detail */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="text-center py-16 text-sm text-muted-foreground">Caricamento…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-5xl block mb-3 opacity-30">🎉</span>
              <p className="font-semibold" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                {errors.length === 0 ? 'Nessun errore registrato' : 'Nessun errore con questi filtri'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                {errors.length === 0 ? 'SKORPIO sta girando liscio!' : 'Cambia filtri per vedere altro'}
              </p>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.key}>
                {groupBy !== 'none' && (
                  <div className="flex items-center gap-2 mb-2 px-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                      {group.key}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                      ×{group.items.length}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
                  </div>
                )}
                <div className="space-y-1.5">
                  {group.items.map(e => {
                    const style = getTipoStyle(e.tipo);
                    const age = Math.floor((Date.now() - new Date(e.created_at).getTime()) / 60000);
                    const ageLabel = age < 60 ? `${age}m fa` : age < 1440 ? `${Math.floor(age / 60)}h fa` : `${Math.floor(age / 1440)}g fa`;
                    return (
                      <div key={e.id} onClick={() => setSelectedError(e)}
                        className="rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md"
                        style={{
                          background: selectedError?.id === e.id ? style.bg : 'hsl(var(--card))',
                          borderColor: selectedError?.id === e.id ? style.text : 'hsl(var(--border))',
                          opacity: e.risolto ? 0.5 : 1,
                        }}>
                        <div className="flex items-start gap-2">
                          <span className="text-base flex-shrink-0">{style.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: style.bg, color: style.text }}>
                                {e.tipo}
                              </span>
                              {e.risolto && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: '#22C55E15', color: '#22C55E' }}>✅ Risolto</span>}
                              <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{ageLabel}</span>
                            </div>
                            <p className="text-xs font-medium truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                              {e.messaggio}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                              {e.user_nome && <span>👤 {e.user_nome}</span>}
                              {e.component && <span className="truncate">📍 {e.component}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        {selectedError && (
          <div className="w-96 border-l flex-shrink-0 overflow-y-auto" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
            <div className="sticky top-0 z-10 px-4 py-3 border-b flex items-center justify-between backdrop-blur-md" style={{ background: 'hsl(var(--card) / 0.95)', borderColor: 'hsl(var(--border))' }}>
              <span className="text-xs font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Dettaglio errore</span>
              <button onClick={() => setSelectedError(null)} className="w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-[hsl(var(--muted))]">✕</button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <button onClick={() => toggleResolved(selectedError.id, selectedError.risolto)}
                  className="flex-1 text-xs py-2 rounded-xl font-bold text-white transition-all hover:scale-[1.02]"
                  style={{ background: selectedError.risolto ? '#64748B' : '#22C55E' }}>
                  {selectedError.risolto ? '↩️ Riapri' : '✅ Marca come risolto'}
                </button>
                <button onClick={() => deleteError(selectedError.id)}
                  className="text-xs px-3 py-2 rounded-xl font-bold"
                  style={{ background: '#EF444415', color: '#EF4444' }}>
                  🗑️
                </button>
              </div>

              <Row label="Tipo" value={selectedError.tipo} />
              <Row label="Quando" value={new Date(selectedError.created_at).toLocaleString('it-IT')} />
              <Row label="Utente" value={selectedError.user_nome || 'anonimo'} />
              {selectedError.component && <Row label="Componente" value={selectedError.component} />}
              {selectedError.url && <Row label="URL" value={selectedError.url} mono />}

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Messaggio</p>
                <pre className="text-xs p-2 rounded-lg whitespace-pre-wrap break-all" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-primary))' }}>{selectedError.messaggio}</pre>
              </div>

              {selectedError.stack && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Stack trace</p>
                  <pre className="text-[10px] p-2 rounded-lg overflow-auto max-h-60 font-mono" style={{ background: '#0F172A', color: '#94A3B8' }}>{selectedError.stack}</pre>
                </div>
              )}

              {selectedError.contesto && (() => {
                let parsed: any = null;
                try { parsed = JSON.parse(selectedError.contesto); } catch {}
                const screenshotUrl = parsed?.screenshot_url;
                return (
                  <>
                    {screenshotUrl && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>📸 Screenshot</p>
                        <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border hover:ring-2 hover:ring-purple-400 transition-all" style={{ borderColor: 'hsl(var(--border))' }}>
                          <img src={screenshotUrl} alt="Screenshot dell'errore" className="w-full max-h-60 object-contain" style={{ background: '#0F172A' }} />
                        </a>
                        <p className="text-[9px] mt-1 text-center" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Click per ingrandire in una nuova scheda</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Contesto</p>
                      <pre className="text-[10px] p-2 rounded-lg overflow-auto max-h-40 font-mono" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {parsed ? JSON.stringify(parsed, null, 2) : selectedError.contesto}
                      </pre>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-2.5 border" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{label}</p>
      <p className="text-xl font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{label}</p>
      <p className="text-xs mt-0.5 break-all" style={{ color: 'hsl(var(--skorpio-text-primary))', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</p>
    </div>
  );
}
