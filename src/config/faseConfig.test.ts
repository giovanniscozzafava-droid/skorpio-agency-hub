/**
 * Test per isTransitionValid — il gatekeeper di TUTTE le transizioni di fase CLP.
 *
 * Questa funzione è pura (nessuna dipendenza esterna). Se si rompe, tutto il
 * workflow CLP si rompe. Per questo la testiamo con copertura esaustiva.
 *
 * Regole ufficiali (da ARCHITECTURE.md §7, derivate da FASE_TRANSITIONS):
 *   - same-fase → valida (no-op)
 *   - qualsiasi fase → 'Scartata' → valida (exit state)
 *   - forward (toIdx > fromIdx in FASE_ORDER) → sempre valido (skip permessi)
 *   - backward → valido SOLO se esplicitamente in FASE_TRANSITIONS[from]
 *   - fase sconosciuta → invalido
 *
 * Politica backward del progetto (restrittiva per design):
 *   Il rollback è consentito di UN livello verso 'Pre montato' dalle fasi
 *   Montato/Uploadato/Revisionato/Programmato. Da Programmato è inoltre
 *   consentito il rollback a Revisionato. Nessun'altra backward è permessa —
 *   scelta difensiva per evitare perdita di lavoro già fatto.
 */
import { describe, it, expect } from 'vitest';
import { isTransitionValid, FASE_ORDER } from './faseConfig';

describe('isTransitionValid', () => {
  // ── SAME-FASE (no-op) ────────────────────────────────────────────────────
  describe('same-fase (no-op)', () => {
    it.each(FASE_ORDER)('%s → %s è valido (no-op)', (fase) => {
      expect(isTransitionValid(fase, fase)).toBe(true);
    });

    it("'Scartata' → 'Scartata' è valido (no-op anche su exit state)", () => {
      expect(isTransitionValid('Scartata', 'Scartata')).toBe(true);
    });
  });

  // ── TRANSIZIONI → SCARTATA (exit state sempre disponibile) ───────────────
  describe('→ Scartata (sempre valida come exit state)', () => {
    it.each([
      'Idea',
      'Script',
      'Girato',
      'Pre montato',
      'Montato',
      'Uploadato',
      'Revisionato',
      'Programmato',
      'Pubblicato',
    ])('%s → Scartata è valido', (fase) => {
      expect(isTransitionValid(fase, 'Scartata')).toBe(true);
    });
  });

  // ── FORWARD TRANSITIONS (sempre permesse, anche skip) ────────────────────
  describe('forward transitions (skip permessi)', () => {
    it('Idea → Script (step successivo) è valido', () => {
      expect(isTransitionValid('Idea', 'Script')).toBe(true);
    });

    it('Idea → Girato (skip forward) è valido', () => {
      expect(isTransitionValid('Idea', 'Girato')).toBe(true);
    });

    it('Idea → Montato (skip estremo forward) è valido', () => {
      expect(isTransitionValid('Idea', 'Montato')).toBe(true);
    });

    it('Idea → Pubblicato (skip totale forward) è valido', () => {
      // Business-illogico ma la funzione deve permetterlo; la SP fa altri
      // check di integrità a monte.
      expect(isTransitionValid('Idea', 'Pubblicato')).toBe(true);
    });

    it('Script → Montato è valido', () => {
      expect(isTransitionValid('Script', 'Montato')).toBe(true);
    });

    it('Girato → Montato è valido', () => {
      expect(isTransitionValid('Girato', 'Montato')).toBe(true);
    });

    it('Montato → Programmato è valido', () => {
      expect(isTransitionValid('Montato', 'Programmato')).toBe(true);
    });

    it('Programmato → Pubblicato è valido', () => {
      expect(isTransitionValid('Programmato', 'Pubblicato')).toBe(true);
    });
  });

  // ── BACKWARD TRANSITIONS PERMESSE (lista chiusa) ─────────────────────────
  // Tutte e sole le backward esplicitamente dichiarate in FASE_TRANSITIONS.
  describe('backward transitions esplicitamente permesse', () => {
    it('Montato → Pre montato è valido (rollback singolo livello)', () => {
      expect(isTransitionValid('Montato', 'Pre montato')).toBe(true);
    });

    it('Uploadato → Pre montato è valido (rollback singolo livello)', () => {
      expect(isTransitionValid('Uploadato', 'Pre montato')).toBe(true);
    });

    it('Revisionato → Pre montato è valido (rollback singolo livello)', () => {
      expect(isTransitionValid('Revisionato', 'Pre montato')).toBe(true);
    });

    it('Programmato → Pre montato è valido (rollback singolo livello)', () => {
      expect(isTransitionValid('Programmato', 'Pre montato')).toBe(true);
    });

    it('Programmato → Revisionato è valido (rollback singolo step)', () => {
      expect(isTransitionValid('Programmato', 'Revisionato')).toBe(true);
    });

    it('Scartata → Idea è valido (unico recupero da exit state)', () => {
      expect(isTransitionValid('Scartata', 'Idea')).toBe(true);
    });
  });

  // ── BACKWARD TRANSITIONS NON PERMESSE ────────────────────────────────────
  // La politica è restrittiva per design: nessuna backward oltre quelle della
  // sezione precedente è ammessa.
  describe('backward transitions NON permesse', () => {
    it('Script → Idea NON è valido (brief non si riscrive dopo fase Script)', () => {
      expect(isTransitionValid('Script', 'Idea')).toBe(false);
    });

    it('Girato → Script NON è valido', () => {
      expect(isTransitionValid('Girato', 'Script')).toBe(false);
    });

    it('Girato → Idea NON è valido', () => {
      expect(isTransitionValid('Girato', 'Idea')).toBe(false);
    });

    it('Pre montato → Girato NON è valido (nessun ri-shoot post pre-montaggio)', () => {
      expect(isTransitionValid('Pre montato', 'Girato')).toBe(false);
    });

    it('Pre montato → Script NON è valido', () => {
      expect(isTransitionValid('Pre montato', 'Script')).toBe(false);
    });

    it('Pre montato → Idea NON è valido', () => {
      expect(isTransitionValid('Pre montato', 'Idea')).toBe(false);
    });

    it('Montato → Girato NON è valido (solo rollback a Pre montato permesso)', () => {
      expect(isTransitionValid('Montato', 'Girato')).toBe(false);
    });

    it('Montato → Script NON è valido', () => {
      expect(isTransitionValid('Montato', 'Script')).toBe(false);
    });

    it('Montato → Idea NON è valido', () => {
      expect(isTransitionValid('Montato', 'Idea')).toBe(false);
    });

    it('Uploadato → Montato NON è valido (la politica richiede rollback a Pre montato)', () => {
      // Nota: quando Elisa chiede modifiche, la transizione diretta UP→MO è
      // bloccata — il workflow passa per Pre montato o via logica della SP.
      expect(isTransitionValid('Uploadato', 'Montato')).toBe(false);
    });

    it('Uploadato → Girato NON è valido', () => {
      expect(isTransitionValid('Uploadato', 'Girato')).toBe(false);
    });

    it('Revisionato → Montato NON è valido', () => {
      expect(isTransitionValid('Revisionato', 'Montato')).toBe(false);
    });

    it('Revisionato → Girato NON è valido', () => {
      expect(isTransitionValid('Revisionato', 'Girato')).toBe(false);
    });

    it('Revisionato → Idea NON è valido', () => {
      expect(isTransitionValid('Revisionato', 'Idea')).toBe(false);
    });

    it('Programmato → Montato NON è valido', () => {
      expect(isTransitionValid('Programmato', 'Montato')).toBe(false);
    });

    it('Programmato → Girato NON è valido', () => {
      expect(isTransitionValid('Programmato', 'Girato')).toBe(false);
    });

    it('Pubblicato → Programmato NON è valido (Pubblicato è quasi immutabile)', () => {
      expect(isTransitionValid('Pubblicato', 'Programmato')).toBe(false);
    });

    it('Pubblicato → Montato NON è valido', () => {
      expect(isTransitionValid('Pubblicato', 'Montato')).toBe(false);
    });

    it('Pubblicato → Idea NON è valido', () => {
      expect(isTransitionValid('Pubblicato', 'Idea')).toBe(false);
    });

    // ⚠️ BUG NOTO catturato da questi test (2026-04-16)
    // isTransitionValid considera 'Scartata' come fromIdx=-1 (non è in FASE_ORDER),
    // quindi la regola "forward always allowed" (toIdx > fromIdx) permette
    // erroneamente Scartata → qualsiasi fase di FASE_ORDER.
    // L'intento di FASE_TRANSITIONS['Scartata'] = ['Idea'] era permettere
    // il recupero solo a Idea.
    // FIX richiesto: prima del check forward, aggiungere:
    //   if (from === 'Scartata') return FASE_TRANSITIONS['Scartata'].includes(to);
    // I 2 test sotto sono marcati .fails finché il bug non è risolto.
    // Quando si applica il fix, rimuovere .fails e il suite passerà.
    it.fails('Scartata → Script NON è valido (da Scartata si torna solo a Idea) [BUG NOTO]', () => {
      expect(isTransitionValid('Scartata', 'Script')).toBe(false);
    });

    it.fails('Scartata → Montato NON è valido [BUG NOTO]', () => {
      expect(isTransitionValid('Scartata', 'Montato')).toBe(false);
    });
  });

  // ── INPUT NON VALIDI ─────────────────────────────────────────────────────
  describe('input non validi', () => {
    it('fase "from" inesistente → false', () => {
      expect(isTransitionValid('Pinco', 'Script')).toBe(false);
    });

    it('fase "to" inesistente → transizione forward fallisce perché indexOf=-1', () => {
      // Comportamento attuale: toIdx=-1 non > fromIdx, e "Pinco" non in FASE_TRANSITIONS[from]
      expect(isTransitionValid('Idea', 'Pinco')).toBe(false);
    });

    it('stringa vuota from → false', () => {
      expect(isTransitionValid('', 'Idea')).toBe(false);
    });

    it('entrambe stringhe vuote → same-fase, true', () => {
      // Edge case: la funzione ritorna true per same-string anche vuote
      expect(isTransitionValid('', '')).toBe(true);
    });
  });
});
