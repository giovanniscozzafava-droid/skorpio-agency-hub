/**
 * Test per checkAutoPubblica — la funzione di auto-pubblicazione CLP.
 *
 * Questa funzione gira OGNI 60 SECONDI in produzione (da AppContext).
 * Se si rompe:
 *   - i CLP programmati NON vengono pubblicati quando scatta l'ora
 *   - le notifiche di auto-pubblicazione NON arrivano a Elisa e Giovanni
 *   - il task Cleanup NON viene creato dopo la pubblicazione
 *
 * Flusso verificato:
 *   1. SELECT candidati: CLP in fase 'Programmato' con data_pubblicazione <= oggi
 *   2. FILTRO JS: scarta quelli con orario ancora futuro
 *   3. PUBBLICA: per ogni candidato pronto chiama cambiaFaseCLP con
 *      source='workflow', userId='auto-publish', oldFase='Programmato'
 *   4. CLEANUP: completa i task Programmazione/Pubblicazione e crea task Cleanup
 *   5. NOTIFICA: invia notifica a Elisa (Programmazione) e Giovanni (Scrittura script)
 *   6. RETURN: il numero di CLP pubblicati
 *
 * Edge cases critici:
 *   - ora_pubblicazione null → default '10:00'
 *   - ora in formato 'HH:mm' → esteso a 'HH:mm:ss'
 *   - CLP futuro (oggi + data coerente ma ora non ancora passata) → NON pubblica
 *   - Errore durante cleanup NON blocca la pubblicazione degli altri CLP
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock dei moduli dipendenti ────────────────────────────────────────────────

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
  getRealtimeChannel: vi.fn(),
}));

vi.mock('../services/faseService', () => ({
  cambiaFaseCLP: vi.fn(() =>
    Promise.resolve({ success: true, oldFase: 'Programmato', newFase: 'Pubblicato', errors: [] })
  ),
}));

// ── Import DOPO i mock (hoisting di vi.mock) ──────────────────────────────────
import { checkAutoPubblica } from './clpWorkflow';
import { supabase } from './supabase';
import { cambiaFaseCLP } from '../services/faseService';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Query builder chainable con risultato finale configurabile. */
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
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

/** Configurazione standard del mock supabase "permissivo". */
function setupSupabaseMock(options: {
  candidatiProgrammati?: Array<{ id: string; data_pubblicazione: string; ora_pubblicazione: string | null }>;
  contenutoDettaglio?: Record<string, unknown> | null;
  teamData?: Array<{ id: string; nome: string }>;
} = {}) {
  const {
    candidatiProgrammati = [],
    contenutoDettaglio = null,
    teamData = [{ id: 't1', nome: 'Elisa' }, { id: 't2', nome: 'Giovanni' }],
  } = options;

  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contenuti') {
      // La PRIMA chiamata a contenuti.select restituisce candidati;
      // chiamate successive con .single() restituiscono il dettaglio.
      const b = makeBuilder({
        data: candidatiProgrammati,
        error: null,
      });
      // Override single per restituire il dettaglio
      b.single = vi.fn(() =>
        Promise.resolve({
          data: contenutoDettaglio,
          error: null,
        })
      );
      return b;
    }
    if (table === 'task') {
      // Per completaTaskPerContenuto: select+update.
      // Per creaTaskCleanup: select (restituisce vuoto per "non esiste già") + insert.
      return makeBuilder({ data: [], error: null });
    }
    if (table === 'team') {
      return makeBuilder({ data: teamData, error: null });
    }
    if (table === 'notifiche') {
      return makeBuilder({ data: null, error: null });
    }
    return makeBuilder({ data: null, error: null });
  });

  // generate_display_id per creaTaskCleanup
  (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: 'TSK9999',
    error: null,
  });
}

// ── Setup globale ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Tempo di sistema fisso: giovedì 16 aprile 2026, ore 12:00 Europe/Rome.
  vi.setSystemTime(new Date('2026-04-16T12:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. NESSUN CLP DA PUBBLICARE
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — nessun candidato', () => {
  it('nessun CLP in fase Programmato → ritorna 0 senza chiamare cambiaFaseCLP', async () => {
    setupSupabaseMock({ candidatiProgrammati: [] });

    const n = await checkAutoPubblica();

    expect(n).toBe(0);
    expect(cambiaFaseCLP).not.toHaveBeenCalled();
  });

  it('candidati=null (DB error silenzioso) → ritorna 0', async () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() =>
      makeBuilder({ data: null, error: null })
    );

    const n = await checkAutoPubblica();

    expect(n).toBe(0);
    expect(cambiaFaseCLP).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. FILTRO TEMPORALE — isProntoPerPubblicazione
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — filtro orario', () => {
  it('CLP con orario già passato → pubblica', async () => {
    // Oggi è 2026-04-16 12:00. CLP schedulato per oggi alle 10:00 → pronto.
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'Test', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
    expect(cambiaFaseCLP).toHaveBeenCalledTimes(1);
  });

  it('CLP con orario ancora futuro (oggi alle 15:00) → NON pubblica', async () => {
    // Oggi 12:00. Schedulato per oggi alle 15:00 → futuro, non pubblica.
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '15:00:00' },
      ],
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(0);
    expect(cambiaFaseCLP).not.toHaveBeenCalled();
  });

  it('CLP di ieri → pubblica (data <= oggi + ora passata)', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-15', ora_pubblicazione: '10:00:00' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });

  it('esattamente ora corrente → pubblica (now >= scheduled)', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '12:00:00' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });

  it('1 secondo dopo la scheduled → pubblica', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '11:59:59' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });

  it('1 secondo prima della scheduled → NON pubblica', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '12:00:01' },
      ],
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ORA NULL → DEFAULT 10:00
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — gestione ora_pubblicazione', () => {
  it('ora_pubblicazione=null → usa default 10:00 e pubblica (oggi 12:00 > 10:00)', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: null },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });

  it('ora_pubblicazione=null con data FUTURA (domani) → NON pubblica', async () => {
    // Domani 2026-04-17, default 10:00 → non ancora scattato.
    // In realtà questo caso non dovrebbe arrivare al filtro JS perché
    // lte('data_pubblicazione', oggi) esclude già il futuro — ma verifichiamo
    // che anche se arrivasse, il filtro JS lo rigetta.
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-17', ora_pubblicazione: null },
      ],
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(0);
  });

  it("ora in formato 'HH:mm' (senza secondi) → estesa a 'HH:mm:00' e pubblica", async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '11:30' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });

  it("ora in formato 'HH:mm:ss' → usata direttamente", async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '11:45:30' },
      ],
      contenutoDettaglio: { id: 'clp-1', id_display: 'CLP0001', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. CONTRATTO cambiaFaseCLP
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — contratto cambiaFaseCLP', () => {
  it('chiama cambiaFaseCLP con parametri esatti per auto-publish', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-auto-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' },
      ],
      contenutoDettaglio: { id: 'clp-auto-1', id_display: 'CLP', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    await checkAutoPubblica();

    expect(cambiaFaseCLP).toHaveBeenCalledWith({
      contenutoId: 'clp-auto-1',
      nuovaFase: 'Pubblicato',
      source: 'workflow',
      userId: 'auto-publish',
      oldFase: 'Programmato',
    });
  });

  it('con N candidati pronti, chiama cambiaFaseCLP N volte e ritorna N', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' },
        { id: 'clp-2', data_pubblicazione: '2026-04-16', ora_pubblicazione: '11:00:00' },
        { id: 'clp-3', data_pubblicazione: '2026-04-15', ora_pubblicazione: '14:00:00' },
      ],
      contenutoDettaglio: { id: 'x', id_display: 'CLP', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(3);
    expect(cambiaFaseCLP).toHaveBeenCalledTimes(3);
  });

  it('con mix pronti/non-pronti, pubblica solo i pronti', async () => {
    setupSupabaseMock({
      candidatiProgrammati: [
        { id: 'clp-pronto-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' },
        { id: 'clp-futuro',   data_pubblicazione: '2026-04-16', ora_pubblicazione: '15:00:00' },
        { id: 'clp-pronto-2', data_pubblicazione: '2026-04-15', ora_pubblicazione: '09:00:00' },
      ],
      contenutoDettaglio: { id: 'x', id_display: 'CLP', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
    });

    const n = await checkAutoPubblica();

    expect(n).toBe(2);
    expect(cambiaFaseCLP).toHaveBeenCalledTimes(2);
    // Verifica che i due chiamati siano i pronti, non il futuro
    const calls = (cambiaFaseCLP as ReturnType<typeof vi.fn>).mock.calls;
    const ids = calls.map((c) => c[0].contenutoId);
    expect(ids).toContain('clp-pronto-1');
    expect(ids).toContain('clp-pronto-2');
    expect(ids).not.toContain('clp-futuro');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. NOTIFICHE POST-PUBBLICAZIONE
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — notifiche', () => {
  it('dopo pubblicazione, inserisce 2 notifiche: per Elisa (Programmazione) e Giovanni (Scrittura script)', async () => {
    const notificheInsert = vi.fn(() => ({
      then: (cb: (v: { error: null }) => unknown) => Promise.resolve(cb({ error: null })),
    }));

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'contenuti') {
        const b = makeBuilder({
          data: [{ id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' }],
          error: null,
        });
        b.single = vi.fn(() =>
          Promise.resolve({
            data: { id: 'clp-1', id_display: 'CLP0001', titolo: 'Reel Pasqua', tipo: 'Reel', cliente_nome: 'Kalea' },
            error: null,
          })
        );
        return b;
      }
      if (table === 'task') return makeBuilder({ data: [], error: null });
      if (table === 'team') return makeBuilder({ data: [], error: null });
      if (table === 'notifiche') {
        const b = makeBuilder({ data: null, error: null });
        b.insert = notificheInsert;
        return b;
      }
      return makeBuilder({ data: null, error: null });
    });
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'TSK9999', error: null });

    await checkAutoPubblica();

    // 2 notifiche: Elisa (Programmazione) + Giovanni (Scrittura script)
    expect(notificheInsert).toHaveBeenCalledTimes(2);
    const notificheCalls = notificheInsert.mock.calls.map((c) => c[0]);
    const destinatari = notificheCalls.map((n) => n.destinatario);
    expect(destinatari).toContain('Elisa');
    expect(destinatari).toContain('Giovanni');
  });

  it("messaggio notifica include id_display, titolo e ora", async () => {
    const notificheInsert = vi.fn(() => ({
      then: (cb: (v: { error: null }) => unknown) => Promise.resolve(cb({ error: null })),
    }));

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'contenuti') {
        const b = makeBuilder({
          data: [{ id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:30:00' }],
          error: null,
        });
        b.single = vi.fn(() =>
          Promise.resolve({
            data: { id: 'clp-1', id_display: 'CLP0042', titolo: 'Reel Promo', tipo: 'Reel', cliente_nome: 'Saturday' },
            error: null,
          })
        );
        return b;
      }
      if (table === 'task') return makeBuilder({ data: [], error: null });
      if (table === 'team') return makeBuilder({ data: [], error: null });
      if (table === 'notifiche') {
        const b = makeBuilder({ data: null, error: null });
        b.insert = notificheInsert;
        return b;
      }
      return makeBuilder({ data: null, error: null });
    });
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'TSK', error: null });

    await checkAutoPubblica();

    const firstNotifica = notificheInsert.mock.calls[0][0];
    expect(firstNotifica.messaggio).toContain('CLP0042');
    expect(firstNotifica.messaggio).toContain('Reel Promo');
    expect(firstNotifica.messaggio).toContain('10:30');
    expect(firstNotifica.tipo).toBe('auto_pubblicazione');
    expect(firstNotifica.titolo).toContain('Pubblicato automaticamente');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. RESILIENZA — errori nel cleanup non bloccano la pubblicazione
// ══════════════════════════════════════════════════════════════════════════════

describe('checkAutoPubblica — resilienza', () => {
  it('errore nel recupero dettaglio contenuto post-publish NON rompe il return', async () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'contenuti') {
        const b = makeBuilder({
          data: [{ id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' }],
          error: null,
        });
        // .single() rigetta simulando network glitch
        b.single = vi.fn(() => Promise.reject(new Error('db timeout')));
        return b;
      }
      if (table === 'task') return makeBuilder({ data: [], error: null });
      return makeBuilder({ data: null, error: null });
    });
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'TSK', error: null });

    // La pubblicazione è già avvenuta (cambiaFaseCLP chiamato).
    // Il cleanup fallisce ma è in try/catch → return il count corretto.
    const n = await checkAutoPubblica();

    expect(n).toBe(1);
    expect(cambiaFaseCLP).toHaveBeenCalledTimes(1);
  });

  it('con 3 CLP, se il cleanup del primo fallisce, gli altri 2 vengono comunque pubblicati', async () => {
    let singleCallCount = 0;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'contenuti') {
        const b = makeBuilder({
          data: [
            { id: 'clp-1', data_pubblicazione: '2026-04-16', ora_pubblicazione: '09:00:00' },
            { id: 'clp-2', data_pubblicazione: '2026-04-16', ora_pubblicazione: '10:00:00' },
            { id: 'clp-3', data_pubblicazione: '2026-04-16', ora_pubblicazione: '11:00:00' },
          ],
          error: null,
        });
        b.single = vi.fn(() => {
          singleCallCount++;
          if (singleCallCount === 1) return Promise.reject(new Error('db glitch'));
          return Promise.resolve({
            data: { id: 'x', id_display: 'CLP', titolo: 'T', tipo: 'Reel', cliente_nome: 'X' },
            error: null,
          });
        });
        return b;
      }
      if (table === 'task') return makeBuilder({ data: [], error: null });
      if (table === 'team') return makeBuilder({ data: [], error: null });
      return makeBuilder({ data: null, error: null });
    });
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'TSK', error: null });

    const n = await checkAutoPubblica();

    // Tutti e 3 pubblicati (return counta cambiaFaseCLP calls, non cleanup)
    expect(n).toBe(3);
    expect(cambiaFaseCLP).toHaveBeenCalledTimes(3);
  });
});
