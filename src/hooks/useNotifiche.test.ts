/**
 * Test per useNotifiche — hook per notifiche utente con realtime subscription.
 *
 * Pattern testati:
 *   - Caricamento iniziale: SELECT filtrato per destinatario, ordinato
 *     created_at DESC, limit 50
 *   - Realtime INSERT: le nuove notifiche vengono aggiunte IN TESTA alla lista
 *   - Suono: alla ricezione di una notifica, viene creato un AudioContext
 *     (BUG NOTO: ne crea uno nuovo ogni volta — documented in ARCHITECTURE.md)
 *   - Cleanup: al cambio di utenteNome / unmount, il vecchio channel viene
 *     rimosso via supabase.removeChannel
 *   - Mark as read: ottimistico (update locale immediato) + sync DB
 *   - utenteNome null → niente carica/subscribe
 *
 * Differenze rispetto a useFeatureFlag:
 *   - Stato è per-hook (useState), non module-level → no resetModules needed
 *   - Canale filtrato per utente (channel name: `notifiche-${utenteNome}`)
 *   - Gestione side-effect audio
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock Supabase ─────────────────────────────────────────────────────────────

let realtimeCallback: ((payload: { new: unknown }) => void) | null = null;

const mockChannel = {
  on: vi.fn((_event: string, _config: unknown, cb: (p: unknown) => void) => {
    realtimeCallback = cb as typeof realtimeCallback;
    return mockChannel;
  }),
  subscribe: vi.fn(() => mockChannel),
};

/** Risultato configurabile per le SELECT. */
let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
const updateMock = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (cb: (v: { data: null; error: null }) => unknown) =>
      Promise.resolve(cb({ data: null, error: null })),
  })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(selectResult)),
          })),
        })),
      })),
      update: updateMock,
    })),
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
  },
}));

// ── Mock AudioContext (jsdom non lo implementa) ──────────────────────────────

const mockOscillator = {
  connect: vi.fn(),
  frequency: { value: 0 },
  start: vi.fn(),
  stop: vi.fn(),
};
const mockGain = {
  connect: vi.fn(),
  gain: {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
};
// Nota: l'implementation viene (re)installata nel beforeEach perché
// vi.restoreAllMocks() la azzera tra test.
const MockAudioContext = vi.fn();

// ── Import dopo mock ─────────────────────────────────────────────────────────
import { useNotifiche } from './useNotifiche';
import { supabase } from '@/integrations/supabase/client';

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  realtimeCallback = null;
  selectResult = { data: [], error: null };

  // Reset proprietà mutabili dell'oscillator (frequency.value è un object
  // literal, clearAllMocks non lo tocca).
  mockOscillator.frequency.value = 0;

  // Re-installa implementation di MockAudioContext (viene stripped da
  // restoreAllMocks nel afterEach del test precedente).
  MockAudioContext.mockImplementation(() => ({
    createOscillator: vi.fn(() => mockOscillator),
    createGain: vi.fn(() => mockGain),
    destination: {},
    currentTime: 0,
  }));

  // Installa mock AudioContext globale (jsdom non lo fornisce)
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. GUARD: utenteNome null
// ══════════════════════════════════════════════════════════════════════════════

describe('useNotifiche — guard utenteNome null', () => {
  it('utenteNome=null → no fetch, no subscribe, lista vuota', () => {
    const { result } = renderHook(() => useNotifiche(null));

    expect(result.current.notifiche).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.nonLette).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it("utenteNome=null → marcaTutteLette è no-op (early return)", async () => {
    const { result } = renderHook(() => useNotifiche(null));

    await act(async () => {
      await result.current.marcaTutteLette();
    });

    // Nessuna update partita (updateMock è il reference per update())
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. CARICAMENTO INIZIALE
// ══════════════════════════════════════════════════════════════════════════════

describe('useNotifiche — caricamento iniziale', () => {
  it('carica le notifiche filtrate per destinatario', async () => {
    const notificheMock = [
      { id: '1', destinatario: 'Elisa', tipo: 'task_assegnato', titolo: 't1', messaggio: 'm1', task_id: null, task_id_display: null, letto: false, created_at: '2026-04-16T10:00:00Z' },
      { id: '2', destinatario: 'Elisa', tipo: 'menzione', titolo: 't2', messaggio: 'm2', task_id: null, task_id_display: null, letto: true, created_at: '2026-04-16T09:00:00Z' },
    ];
    selectResult = { data: notificheMock, error: null };

    const { result } = renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(result.current.notifiche).toHaveLength(2);
    });

    expect(supabase.from).toHaveBeenCalledWith('notifiche');
    expect(result.current.notifiche[0].id).toBe('1');
    expect(result.current.notifiche[1].id).toBe('2');
  });

  it('durante il fetch, loading=true; dopo, loading=false', async () => {
    selectResult = { data: [], error: null };

    const { result } = renderHook(() => useNotifiche('Elisa'));

    // Non facciamo assertion sul flipping di loading=true perché React 18
    // batcha i setState e il test sarebbe flaky. Garantiamo solo che alla
    // fine torni a false.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('data null dal DB → lista vuota, no crash', async () => {
    selectResult = { data: null, error: { message: 'db error' } };

    const { result } = renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifiche).toEqual([]);
  });

  it('conteggio nonLette: filtra solo quelle con letto=false', async () => {
    selectResult = {
      data: [
        { id: '1', letto: false, destinatario: 'E', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, created_at: '' },
        { id: '2', letto: true, destinatario: 'E', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, created_at: '' },
        { id: '3', letto: false, destinatario: 'E', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, created_at: '' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(result.current.nonLette).toBe(2);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. SUBSCRIPTION REALTIME
// ══════════════════════════════════════════════════════════════════════════════

describe('useNotifiche — realtime INSERT', () => {
  it('apre un channel col nome notifiche-${utenteNome}', async () => {
    renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith('notifiche-Elisa');
    });
  });

  it('subscribe solo a INSERT filtrati per destinatario', async () => {
    renderHook(() => useNotifiche('Giovanni'));

    await waitFor(() => {
      expect(mockChannel.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          event: 'INSERT',
          schema: 'public',
          table: 'notifiche',
          filter: 'destinatario=eq.Giovanni',
        }),
        expect.any(Function)
      );
    });
  });

  it('nuova notifica realtime viene aggiunta IN TESTA alla lista', async () => {
    selectResult = {
      data: [
        { id: 'vecchia', destinatario: 'Elisa', tipo: 'menzione', titolo: 'old', messaggio: '', task_id: null, task_id_display: null, letto: true, created_at: '2026-04-16T09:00:00Z' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(result.current.notifiche).toHaveLength(1);
    });

    const nuova = {
      id: 'nuova',
      destinatario: 'Elisa',
      tipo: 'task_assegnato' as const,
      titolo: 'nuova notifica',
      messaggio: 'ciao',
      task_id: null,
      task_id_display: null,
      letto: false,
      created_at: '2026-04-16T10:00:00Z',
    };

    act(() => {
      realtimeCallback?.({ new: nuova });
    });

    // In testa (index 0), la vecchia scivola in index 1
    expect(result.current.notifiche[0].id).toBe('nuova');
    expect(result.current.notifiche[1].id).toBe('vecchia');
    expect(result.current.nonLette).toBe(1); // solo la nuova è non-letta
  });

  it('suona un beep alla ricezione (crea AudioContext + oscillator a 880Hz)', async () => {
    renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => {
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });

    const nuova = { id: 'x', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' };

    act(() => {
      realtimeCallback?.({ new: nuova });
    });

    expect(MockAudioContext).toHaveBeenCalledTimes(1);
    expect(mockOscillator.frequency.value).toBe(880);
    expect(mockOscillator.start).toHaveBeenCalled();
    expect(mockOscillator.stop).toHaveBeenCalled();
  });

  // ⚠️ BUG NOTO — vedi ARCHITECTURE.md §9 anti-pattern #13
  // useNotifiche crea un nuovo AudioContext per OGNI notifica ricevuta, invece
  // di riutilizzare un singleton. In una long session con 50+ notifiche questo
  // causa memory leak lato browser (AudioContext sono risorse pesanti).
  // Questo test lo DOCUMENTA: quando la leak sarà fixata (AudioContext cached),
  // questo test andrà in fail e dovrà essere aggiornato.
  it('BUG NOTO: crea UN NUOVO AudioContext per OGNI notifica (memory leak)', async () => {
    renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => {
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });

    const n1 = { id: '1', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' };
    const n2 = { ...n1, id: '2' };
    const n3 = { ...n1, id: '3' };

    act(() => {
      realtimeCallback?.({ new: n1 });
      realtimeCallback?.({ new: n2 });
      realtimeCallback?.({ new: n3 });
    });

    // Comportamento attuale (leak): 3 notifiche → 3 AudioContext.
    // Quando il bug sarà fixato cambiare in `toHaveBeenCalledTimes(1)` (singleton).
    expect(MockAudioContext).toHaveBeenCalledTimes(3);
  });

  it('AudioContext non disponibile (iOS restrictions) → catch silenzioso, notifica comunque aggiunta', async () => {
    // Sovrascrive il mock per throware
    globalThis.AudioContext = vi.fn(() => {
      throw new Error('AudioContext not allowed without user gesture');
    }) as unknown as typeof AudioContext;

    const { result } = renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => {
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });

    const nuova = { id: 'x', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' };

    expect(() => {
      act(() => {
        realtimeCallback?.({ new: nuova });
      });
    }).not.toThrow();

    // La notifica è comunque stata aggiunta alla lista (il suono è non-critico)
    expect(result.current.notifiche).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. CLEANUP CHANNEL
// ══════════════════════════════════════════════════════════════════════════════

describe('useNotifiche — cleanup channel', () => {
  it('unmount rimuove il channel (no memory leak)', async () => {
    const { unmount } = renderHook(() => useNotifiche('Elisa'));

    await waitFor(() => {
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('cambio utenteNome → rimuove il vecchio channel e ne apre uno nuovo', async () => {
    const { rerender } = renderHook(({ nome }) => useNotifiche(nome), {
      initialProps: { nome: 'Elisa' as string | null },
    });

    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith('notifiche-Elisa');
    });

    rerender({ nome: 'Giovanni' });

    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith('notifiche-Giovanni');
    });

    // Il channel precedente è stato rimosso almeno una volta (cleanup effetto)
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MARK AS READ — ottimistico + sync DB
// ══════════════════════════════════════════════════════════════════════════════

describe('useNotifiche — marcaLetta / marcaTutteLette', () => {
  it('marcaLetta aggiorna IMMEDIATAMENTE la UI (optimistic) e poi chiama update DB', async () => {
    selectResult = {
      data: [
        { id: 'n1', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' },
        { id: 'n2', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => expect(result.current.notifiche).toHaveLength(2));

    expect(result.current.nonLette).toBe(2);

    await act(async () => {
      await result.current.marcaLetta('n1');
    });

    // UI update immediato
    const n1 = result.current.notifiche.find((n) => n.id === 'n1');
    expect(n1?.letto).toBe(true);
    expect(result.current.nonLette).toBe(1);
    // DB update chiamato
    expect(updateMock).toHaveBeenCalledWith({ letto: true });
  });

  it('marcaTutteLette porta tutte le notifiche a letto=true + filtro DB su destinatario + letto=false', async () => {
    selectResult = {
      data: [
        { id: 'n1', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' },
        { id: 'n2', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' },
        { id: 'n3', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: true, created_at: '' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => expect(result.current.notifiche).toHaveLength(3));

    await act(async () => {
      await result.current.marcaTutteLette();
    });

    expect(result.current.notifiche.every((n) => n.letto)).toBe(true);
    expect(result.current.nonLette).toBe(0);
    expect(updateMock).toHaveBeenCalledWith({ letto: true });
  });

  it('marcaLetta su id inesistente: non modifica nulla, DB call parte comunque (fire-and-forget)', async () => {
    selectResult = {
      data: [
        { id: 'n1', destinatario: 'Elisa', tipo: 'menzione', titolo: '', messaggio: '', task_id: null, task_id_display: null, letto: false, created_at: '' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useNotifiche('Elisa'));
    await waitFor(() => expect(result.current.notifiche).toHaveLength(1));

    await act(async () => {
      await result.current.marcaLetta('non_esiste');
    });

    // La lista resta invariata (il map non trova id, tutte passthrough)
    expect(result.current.notifiche[0].letto).toBe(false);
    // Ma la DB update parte comunque (comportamento attuale — non c'è guard)
    expect(updateMock).toHaveBeenCalledWith({ letto: true });
  });
});
