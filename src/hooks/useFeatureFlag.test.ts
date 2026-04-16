/**
 * Test per useFeatureFlag — hook feature flag con cache module-level condivisa
 * e subscription realtime singleton.
 *
 * Pattern da testare (non banale):
 *   - La cache (`flagCache`), il lock (`loading`) e il flag `cacheLoaded` sono
 *     variabili a livello di modulo, NON di componente. Questo significa che
 *     tutti i componenti che usano l'hook condividono la stessa cache.
 *   - La subscription realtime è singleton: una volta attivata, resta tale per
 *     tutta la durata della sessione.
 *   - Durante il caricamento iniziale, l'hook ritorna `true` come default
 *     difensivo (feature start ON) per evitare di disabilitare feature mentre
 *     la cache si popola.
 *   - Quando arriva un update via realtime, la cache in memoria viene
 *     aggiornata e TUTTI i listener (= tutti gli hook montati) ricevono un
 *     forceUpdate → i componenti ri-renderizzano con il nuovo valore.
 *
 * Strategia test:
 *   Ogni test resetta i moduli (vi.resetModules) per partire da cache vuota.
 *   Questo permette di testare lo stato iniziale in modo deterministico e
 *   evita ordering dependencies tra test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock condiviso tra tutti i test ──────────────────────────────────────────
// Catturerò il callback passato a .on() per poter simulare eventi realtime.
let realtimeCallback: ((payload: { new?: { id: string; attivo: boolean } }) => void) | null = null;

const mockChannel = {
  on: vi.fn((_event: string, _config: unknown, cb: (p: unknown) => void) => {
    realtimeCallback = cb as typeof realtimeCallback;
    return mockChannel;
  }),
  subscribe: vi.fn(() => mockChannel),
};

const selectResult = { data: [] as Array<{ id: string; attivo: boolean }>, error: null };

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve(selectResult)),
    })),
    channel: vi.fn(() => mockChannel),
  },
  getRealtimeChannel: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Carica l'hook con module fresco (cache vuota). Deve essere chiamato dentro
 * ogni test che vuole partire da zero.
 */
async function loadHookFresh(flags: Array<{ id: string; attivo: boolean }> = []) {
  selectResult.data = flags;
  vi.resetModules();
  // Re-import dopo reset: rebuilds module-level state (flagCache, cacheLoaded, loading, subActive)
  const mod = await import('./useFeatureFlag');
  return mod;
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  realtimeCallback = null;
  selectResult.data = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. DEFAULT-ON DURANTE LOADING
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — default durante loading', () => {
  it('primo render con cache vuota: restituisce true (default-on difensivo)', async () => {
    const { useFeatureFlag } = await loadHookFresh([]);

    const { result } = renderHook(() => useFeatureFlag('any_flag'));

    // Il primissimo render ha cacheLoaded=false, deve restituire true.
    expect(result.current).toBe(true);
  });

  it('default-on vale anche per flag che in DB sono false, finché la cache non si carica', async () => {
    const { useFeatureFlag } = await loadHookFresh([{ id: 'feat_x', attivo: false }]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));

    // Al primo render la cache non è ancora arrivata → default true.
    // (Il risultato potrebbe passare a false dopo il load, ma quello è un
    // altro test. Qui verifichiamo solo il default iniziale.)
    expect(result.current).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. CACHE CARICATA DAL DB
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — cache caricata', () => {
  it('dopo load, restituisce il valore reale dal DB (true)', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('dopo load, flag in DB come false → restituisce false', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: false },
    ]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flag NON presente nel DB → default true (?? true)', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'altro_flag', attivo: false },
    ]);

    const { result } = renderHook(() => useFeatureFlag('non_esistente'));

    await waitFor(() => {
      // Dopo il load, cacheLoaded=true ma flag non c'è → ?? true
      expect(result.current).toBe(true);
    });
  });

  it('multipli flag nello stesso cache, si leggono indipendentemente', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_a', attivo: true },
      { id: 'feat_b', attivo: false },
      { id: 'feat_c', attivo: true },
    ]);

    const { result: rA } = renderHook(() => useFeatureFlag('feat_a'));
    const { result: rB } = renderHook(() => useFeatureFlag('feat_b'));
    const { result: rC } = renderHook(() => useFeatureFlag('feat_c'));

    await waitFor(() => {
      expect(rA.current).toBe(true);
      expect(rB.current).toBe(false);
      expect(rC.current).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. REALTIME UPDATE
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — realtime update', () => {
  it('update realtime cambia il valore e triggera re-render', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));

    // Aspetta che la cache sia caricata
    await waitFor(() => expect(result.current).toBe(true));

    // Simula un cambio realtime: il flag passa da true a false
    act(() => {
      realtimeCallback?.({ new: { id: 'feat_x', attivo: false } });
    });

    expect(result.current).toBe(false);
  });

  it('update realtime su flag diverso NON cambia il flag osservato', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
      { id: 'feat_y', attivo: true },
    ]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));
    await waitFor(() => expect(result.current).toBe(true));

    // Cambio feat_y, non feat_x
    act(() => {
      realtimeCallback?.({ new: { id: 'feat_y', attivo: false } });
    });

    expect(result.current).toBe(true); // invariato
  });

  it('update realtime aggiorna TUTTI gli hook che osservano quel flag', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const { result: r1 } = renderHook(() => useFeatureFlag('feat_x'));
    const { result: r2 } = renderHook(() => useFeatureFlag('feat_x'));
    const { result: r3 } = renderHook(() => useFeatureFlag('feat_x'));

    await waitFor(() => {
      expect(r1.current).toBe(true);
      expect(r2.current).toBe(true);
      expect(r3.current).toBe(true);
    });

    // Un solo evento realtime → tutti e 3 devono vedere il nuovo valore
    act(() => {
      realtimeCallback?.({ new: { id: 'feat_x', attivo: false } });
    });

    expect(r1.current).toBe(false);
    expect(r2.current).toBe(false);
    expect(r3.current).toBe(false);
  });

  it('payload realtime senza .new viene ignorato (no crash)', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const { result } = renderHook(() => useFeatureFlag('feat_x'));
    await waitFor(() => expect(result.current).toBe(true));

    // Evento DELETE tipicamente ha payload.old ma non payload.new
    act(() => {
      realtimeCallback?.({});
    });

    // Nessun crash, valore invariato
    expect(result.current).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. CLEANUP LISTENER (evita memory leak)
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — cleanup listener', () => {
  it('unmount rimuove il listener: un update realtime dopo unmount non crasha', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const { result, unmount } = renderHook(() => useFeatureFlag('feat_x'));
    await waitFor(() => expect(result.current).toBe(true));

    unmount();

    // Dopo l'unmount, un update realtime non deve esplodere (il componente
    // non è più in DOM, non deve tentare setState su uno unmounted).
    expect(() => {
      realtimeCallback?.({ new: { id: 'feat_x', attivo: false } });
    }).not.toThrow();
  });

  it('dopo unmount di uno dei 2 hook sullo stesso flag, l\'altro continua a funzionare', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);

    const h1 = renderHook(() => useFeatureFlag('feat_x'));
    const h2 = renderHook(() => useFeatureFlag('feat_x'));
    await waitFor(() => expect(h1.result.current).toBe(true));

    // Unmount solo h1
    h1.unmount();

    // h2 riceve ancora gli update realtime
    act(() => {
      realtimeCallback?.({ new: { id: 'feat_x', attivo: false } });
    });

    expect(h2.result.current).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. SUBSCRIPTION SINGLETON
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — subscription singleton', () => {
  it('N hook montati → UNA sola subscription attiva (supabase.channel chiamato 1 volta)', async () => {
    const { useFeatureFlag } = await loadHookFresh([
      { id: 'feat_x', attivo: true },
    ]);
    const { supabase } = await import('../lib/supabase');

    renderHook(() => useFeatureFlag('feat_x'));
    renderHook(() => useFeatureFlag('feat_y'));
    renderHook(() => useFeatureFlag('feat_z'));

    await waitFor(() => {
      // supabase.channel deve essere stato invocato UNA sola volta totale
      expect(supabase.channel).toHaveBeenCalledTimes(1);
    });
  });

  it('N hook montati → UNA sola loadAll (evita N fetch paralleli)', async () => {
    const flags = [{ id: 'feat_x', attivo: true }];
    selectResult.data = flags;
    vi.resetModules();
    const mod = await import('./useFeatureFlag');
    const { useFeatureFlag } = mod;
    const { supabase } = await import('../lib/supabase');

    const fromSpy = supabase.from as ReturnType<typeof vi.fn>;
    const fromCallsBefore = fromSpy.mock.calls.length;

    renderHook(() => useFeatureFlag('feat_x'));
    renderHook(() => useFeatureFlag('feat_y'));
    renderHook(() => useFeatureFlag('feat_z'));

    await waitFor(() => {
      // from('feature_flags') invocato 1 sola volta grazie al lock `loading`
      const fromCallsAfter = fromSpy.mock.calls.length;
      expect(fromCallsAfter - fromCallsBefore).toBe(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. useFeatureFlags (plurale) — wrapper multi-flag
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlags — lettura multipla', () => {
  it('restituisce un record con tutti i flag richiesti', async () => {
    const { useFeatureFlags } = await loadHookFresh([
      { id: 'feat_a', attivo: true },
      { id: 'feat_b', attivo: false },
    ]);

    const { result } = renderHook(() => useFeatureFlags(['feat_a', 'feat_b']));

    await waitFor(() => {
      expect(result.current).toEqual({ feat_a: true, feat_b: false });
    });
  });

  it('flag inesistenti → default true (?? true anche nel plurale)', async () => {
    const { useFeatureFlags } = await loadHookFresh([
      { id: 'feat_a', attivo: false },
    ]);

    const { result } = renderHook(() => useFeatureFlags(['feat_a', 'missing_1', 'missing_2']));

    await waitFor(() => {
      expect(result.current).toEqual({
        feat_a: false,
        missing_1: true,
        missing_2: true,
      });
    });
  });

  it('durante loading iniziale, tutti i flag sono true (default-on)', async () => {
    const { useFeatureFlags } = await loadHookFresh([
      { id: 'feat_a', attivo: false },
      { id: 'feat_b', attivo: false },
    ]);

    const { result } = renderHook(() => useFeatureFlags(['feat_a', 'feat_b']));

    // Primissimo render: cache non ancora caricata → tutti true
    expect(result.current).toEqual({ feat_a: true, feat_b: true });
  });

  it('update realtime aggiorna il record restituito dal plurale', async () => {
    const { useFeatureFlags } = await loadHookFresh([
      { id: 'feat_a', attivo: true },
      { id: 'feat_b', attivo: true },
    ]);

    const { result } = renderHook(() => useFeatureFlags(['feat_a', 'feat_b']));
    await waitFor(() => expect(result.current.feat_a).toBe(true));

    act(() => {
      realtimeCallback?.({ new: { id: 'feat_a', attivo: false } });
    });

    expect(result.current).toEqual({ feat_a: false, feat_b: true });
  });
});
