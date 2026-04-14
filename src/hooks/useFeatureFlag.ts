import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Cache in memory — shared across all hooks
let flagCache: Record<string, boolean> = {};
let cacheLoaded = false;
let loading = false;
const listeners = new Set<() => void>();

async function loadAll() {
  if (loading) return;
  loading = true;
  const { data } = await supabase.from('feature_flags').select('id, attivo');
  if (data) {
    flagCache = Object.fromEntries(data.map(f => [f.id, f.attivo]));
    cacheLoaded = true;
  }
  loading = false;
  listeners.forEach(fn => fn());
}

// Realtime subscription — update cache on changes
let subActive = false;
function ensureSub() {
  if (subActive) return;
  subActive = true;
  supabase
    .channel('feature_flags_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, (payload: any) => {
      if (payload.new) {
        flagCache[payload.new.id] = payload.new.attivo;
        listeners.forEach(fn => fn());
      }
    })
    .subscribe();
}

/**
 * Check if a feature flag is active.
 * Returns `true` by default while loading (features start ON).
 */
export function useFeatureFlag(flagId: string): boolean {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1);
    listeners.add(fn);
    if (!cacheLoaded) loadAll();
    ensureSub();
    return () => { listeners.delete(fn); };
  }, []);

  // Default to true while loading (don't break existing features)
  if (!cacheLoaded) return true;
  return flagCache[flagId] ?? true;
}

/**
 * Check multiple flags at once.
 */
export function useFeatureFlags(flagIds: string[]): Record<string, boolean> {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1);
    listeners.add(fn);
    if (!cacheLoaded) loadAll();
    ensureSub();
    return () => { listeners.delete(fn); };
  }, []);

  const result: Record<string, boolean> = {};
  for (const id of flagIds) {
    result[id] = cacheLoaded ? (flagCache[id] ?? true) : true;
  }
  return result;
}
