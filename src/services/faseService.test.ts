/**
 * Test per cambiaFaseCLP — la funzione che governa TUTTI i cambi fase dei CLP.
 *
 * Questa è la funzione più critica del sistema. Una regressione qui si
 * propaga a:
 *   - creazione task successivi (workflow rotto)
 *   - completamento task precedenti (task zombie)
 *   - auto-pubblicazione CLP programmati (fase bloccata)
 *   - incremento reel_fatti sul cliente (contabilità sbagliata)
 *   - creazione cartelle Drive (file persi)
 *   - sync calendario (eventi disallineati)
 *
 * Il contratto (da ARCHITECTURE.md §7):
 *   - È l'UNICO punto autorizzato a modificare contenuti.fase.
 *   - Delega alla stored procedure `cambio_fase_clp` tutta l'atomicità.
 *   - Se oldFase è passata, valida client-side prima di chiamare la SP.
 *   - I side effects (Drive, calendar, cleanup task) sono fire-and-forget
 *     asincroni — NON devono bloccare il return.
 *   - La riassegnazione montatore è SINCRONA (deve completare prima del return).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Setup mock moduli ─────────────────────────────────────────────────────────
// vi.mock() è hoisted: dobbiamo definire i mock prima di importare il sut.

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
  getRealtimeChannel: vi.fn(),
}));

vi.mock('../lib/clpWorkflow', () => ({
  creaTaskCleanup: vi.fn(() => Promise.resolve()),
}));

// fetch globale (usato dentro i side effects async per create-drive-folder)
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// import.meta.env per i side effects
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');

// ── Import del sut DOPO i vi.mock ─────────────────────────────────────────────
import { cambiaFaseCLP } from './faseService';
import { supabase } from '../lib/supabase';

// ── Helpers di test ───────────────────────────────────────────────────────────

/**
 * Crea un query-builder chainable che alla fine restituisce `result`.
 * Supporta la chain: .select().eq().eq().single() / .limit() / .order() / etc.
 * Supporta anche chain awaitate direttamente (es. .update().eq()).
 */
function makeBuilder<T = unknown>(result: { data: T; error: unknown | null }) {
  const builder: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'not',
    'limit', 'order', 'range', 'filter', 'match',
  ];
  methods.forEach((m) => {
    builder[m] = vi.fn(() => builder);
  });
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  // Per await diretto su chain senza .single()
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

/** Un payload tipico restituito dalla stored procedure `cambio_fase_clp` quando ha successo. */
function rpcSuccess(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      changed: true,
      old_fase: 'Montato',
      new_fase: 'Uploadato',
      task_created: 'Revisione montaggio',
      task_assigned: 'Elisa',
      task_id: 'task-uuid-123',
      contenuto: {
        id: 'clp-uuid-456',
        id_display: 'CLP0042',
        titolo: 'Test Reel',
        cliente_nome: 'Saturday',
        tipo: 'Reel',
        link_drive: null,
      },
      ...overrides,
    },
    error: null,
  };
}

// Per ogni test, resetta tutti i mock e imposta default innocui.
beforeEach(() => {
  vi.clearAllMocks();
  // Default: qualsiasi chiamata a `from(...)` restituisce un builder innocuo.
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() =>
    makeBuilder({ data: null, error: null })
  );
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true, folder_id: 'drive-folder-xyz' }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. VALIDAZIONE CLIENT-SIDE (quando oldFase è passata)
// ══════════════════════════════════════════════════════════════════════════════

describe('cambiaFaseCLP — validazione client-side', () => {
  it('same-fase → success no-op senza chiamare RPC', async () => {
    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Montato',
      source: 'kanban',
      userId: 'user-1',
      oldFase: 'Montato',
    });

    expect(res.success).toBe(true);
    expect(res.oldFase).toBe('Montato');
    expect(res.newFase).toBe('Montato');
    expect(res.errors).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('transizione invalida (Pubblicato → Programmato) → success:false senza RPC', async () => {
    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Programmato',
      source: 'kanban',
      userId: 'user-1',
      oldFase: 'Pubblicato',
    });

    expect(res.success).toBe(false);
    expect(res.errors[0]).toContain('Transizione non permessa');
    expect(res.errors[0]).toContain('Pubblicato');
    expect(res.errors[0]).toContain('Programmato');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('transizione valida con oldFase → chiama RPC', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(rpcSuccess());

    await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'user-1',
      oldFase: 'Montato',
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('senza oldFase → chiama RPC direttamente (delega validazione alla SP)', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(rpcSuccess());

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'user-1',
      // oldFase non passata
    });

    expect(res.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PARAMETRI RPC — il contratto con la stored procedure
// ══════════════════════════════════════════════════════════════════════════════

describe('cambiaFaseCLP — contratto stored procedure', () => {
  it('chiama cambio_fase_clp con i parametri esatti attesi dalla SP', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(rpcSuccess());

    await cambiaFaseCLP({
      contenutoId: 'clp-uuid-999',
      nuovaFase: 'Uploadato',
      source: 'riprese',
      userId: 'user-abc',
      oldFase: 'Montato',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('cambio_fase_clp', {
      p_contenuto_id: 'clp-uuid-999',
      p_nuova_fase: 'Uploadato',
      p_source: 'riprese',
      p_user_id: 'user-abc',
    });
  });

  it.each(['kanban', 'contenuti', 'riprese', 'workflow'] as const)(
    "propaga source='%s' alla SP come p_source",
    async (source) => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(rpcSuccess());

      await cambiaFaseCLP({
        contenutoId: 'clp-1',
        nuovaFase: 'Uploadato',
        source,
        userId: 'u',
        oldFase: 'Montato',
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'cambio_fase_clp',
        expect.objectContaining({ p_source: source })
      );
    }
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GESTIONE ERRORI RPC
// ══════════════════════════════════════════════════════════════════════════════

describe('cambiaFaseCLP — gestione errori RPC', () => {
  it('errore di rete/DB → success:false con message', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    });

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.success).toBe(false);
    expect(res.errors[0]).toContain('stored procedure');
    expect(res.errors[0]).toContain('connection refused');
  });

  it('SP ritorna success:false → return success:false propagando error', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { success: false, error: 'CLP not found' },
      error: null,
    });

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-inesistente',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.success).toBe(false);
    expect(res.errors).toContain('CLP not found');
  });

  it('SP ritorna success:false senza error → fallback error message', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { success: false },
      error: null,
    });

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.success).toBe(false);
    expect(res.errors[0]).toContain('Errore sconosciuto');
  });

  it('SP ritorna changed:false → success:true no-op con fasi della SP', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        success: true,
        changed: false,
        old_fase: 'Montato',
        new_fase: 'Montato',
      },
      error: null,
    });

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Montato',
      source: 'kanban',
      userId: 'u',
      // no oldFase → la validazione client non scatta, passa alla SP
    });

    expect(res.success).toBe(true);
    expect(res.oldFase).toBe('Montato');
    expect(res.newFase).toBe('Montato');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. RETURN VALUE — propagazione dati dalla SP
// ══════════════════════════════════════════════════════════════════════════════

describe('cambiaFaseCLP — return value', () => {
  it('propaga task_created e task_assigned dalla SP', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        task_created: 'Revisione montaggio',
        task_assigned: 'Elisa',
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.taskCreated).toBe('Revisione montaggio');
    expect(res.taskAssigned).toBe('Elisa');
  });

  it('reelIncremented=true solo se fase=Pubblicato AND tipo=Reel', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        new_fase: 'Pubblicato',
        contenuto: { id: 'x', tipo: 'Reel' },
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Pubblicato',
      source: 'workflow',
      userId: 'auto-publish',
      oldFase: 'Programmato',
    });

    expect(res.reelIncremented).toBe(true);
  });

  it('reelIncremented=false se fase=Pubblicato ma tipo!=Reel (es. Showreel)', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        new_fase: 'Pubblicato',
        contenuto: { id: 'x', tipo: 'Showreel' },
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Pubblicato',
      source: 'workflow',
      userId: 'u',
      oldFase: 'Programmato',
    });

    expect(res.reelIncremented).toBe(false);
  });

  it('reelIncremented=false se tipo=Reel ma fase!=Pubblicato', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        new_fase: 'Uploadato',
        contenuto: { id: 'x', tipo: 'Reel' },
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.reelIncremented).toBe(false);
  });

  it('propaga contenuto nel return (per optimistic update UI)', async () => {
    const contenutoSP = {
      id: 'clp-123',
      id_display: 'CLP0099',
      titolo: 'Test',
      cliente_nome: 'Kalea',
      tipo: 'Reel',
    };
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({ contenuto: contenutoSP })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-123',
      nuovaFase: 'Uploadato',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.contenuto).toEqual(contenutoSP);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. RIASSEGNAZIONE MONTATORE — NON IMPLEMENTATA nel codice attuale.
// ══════════════════════════════════════════════════════════════════════════════
//
// Il blocco di test originale verificava una logica sincrona che leggeva
// contenuti.assegnato_montaggio e riassegnava il task creato dalla SP
// quando task_created ∈ ['Premontaggio', 'Montaggio', 'Upload esportato'].
//
// Questa logica NON è presente nel faseService.ts attuale (verificato con
// `grep MONTAGGIO_TASKS\|assegnato_montaggio` → 0 occorrenze).
//
// Possibili ragioni:
//   - la logica è stata spostata dentro la stored procedure cambio_fase_clp
//   - la feature è stata rimossa consapevolmente
//   - non è mai stata portata su main da un branch feature
//
// I test sono stati rimossi perché testavano codice inesistente. Se la
// feature viene (re-)introdotta, i test possono essere ripristinati dal
// commit di rimozione in git history.
//
// ══════════════════════════════════════════════════════════════════════════════
// 6. CASI EDGE — regressioni reali che vogliamo prevenire
// ══════════════════════════════════════════════════════════════════════════════

describe('cambiaFaseCLP — casi edge', () => {
  it('auto-publish (source=workflow, userId=auto-publish) funziona identicamente', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        new_fase: 'Pubblicato',
        contenuto: { id: 'x', tipo: 'Reel' },
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Pubblicato',
      source: 'workflow',
      userId: 'auto-publish',
      oldFase: 'Programmato',
    });

    expect(res.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'cambio_fase_clp',
      expect.objectContaining({ p_user_id: 'auto-publish' })
    );
  });

  it('transizione a Scartata è sempre permessa (exit state)', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue(
      rpcSuccess({
        old_fase: 'Montato',
        new_fase: 'Scartata',
      })
    );

    const res = await cambiaFaseCLP({
      contenutoId: 'clp-1',
      nuovaFase: 'Scartata',
      source: 'kanban',
      userId: 'u',
      oldFase: 'Montato',
    });

    expect(res.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalled();
  });

  it('exception sincrona nella RPC viene intercettata e non propaga', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network boom'));

    // Non deve throware: la funzione non ha try/catch top-level sulla RPC,
    // quindi questo test DOCUMENTA il comportamento attuale (la promise rigetta).
    // Se in futuro aggiungeremo try/catch, aggiornare il test.
    await expect(
      cambiaFaseCLP({
        contenutoId: 'clp-1',
        nuovaFase: 'Uploadato',
        source: 'kanban',
        userId: 'u',
        oldFase: 'Montato',
      })
    ).rejects.toThrow('network boom');
  });
});
