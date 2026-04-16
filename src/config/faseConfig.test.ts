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
 *   - Scartata → valido SOLO se in FASE_TRANSITIONS['Scartata'] (= solo Idea)
 *   - fase sconosciuta → invalido
 *
 * Politica backward del progetto (attuale, liberale):
 *   Le fasi di lavorazione (Pre montato in poi) permettono rollback profondo
 *   fino a Girato/Script per supportare richieste di modifiche da parte della
 *   revisione. Da Pubblicato si può solo andare a Scartata.
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

  // ── BACKWARD TRANSITIONS PERMESSE ────────────────────────────────────────
  // Le fasi di lavorazione permettono rollback profondo per supportare
  // richieste di modifiche da parte della revisione.
  describe('backward transitions esplicitamente permesse', () => {
    it('Script → Idea è valido (riscrittura brief)', () => {
      expect(isTransitionValid('Script', 'Idea')).toBe(true);
    });

    it('Girato → Script è valido (ri-stesura dopo shooting)', () => {
      expect(isTransitionValid('Girato', 'Script')).toBe(true);
    });

    it('Girato → Idea è valido (restart da zero dopo shooting)', () => {
      expect(isTransitionValid('Girato', 'Idea')).toBe(true);
    });

    it('Pre montato → Girato è valido (re-shoot)', () => {
      expect(isTransitionValid('Pre montato', 'Girato')).toBe(true);
    });

    it('Montato → Pre montato è valido (revisione pre-montaggio)', () => {
      expect(isTransitionValid('Montato', 'Pre montato')).toBe(true);
    });

    it('Montato → Girato è valido (rollback profondo)', () => {
      expect(isTransitionValid('Montato', 'Girato')).toBe(true);
    });

    it('Uploadato → Montato è valido (richiesta modifiche da Elisa)', () => {
      expect(isTransitionValid('Uploadato', 'Montato')).toBe(true);
    });

    it('Uploadato → Pre montato è valido', () => {
      expect(isTransitionValid('Uploadato', 'Pre montato')).toBe(true);
    });

    it('Uploadato → Girato è valido (rollback profondo)', () => {
      expect(isTransitionValid('Uploadato', 'Girato')).toBe(true);
    });

    it('Revisionato → Montato è valido (seconda revisione)', () => {
      expect(isTransitionValid('Revisionato', 'Montato')).toBe(true);
    });

    it('Revisionato → Pre montato è valido', () => {
      expect(isTransitionValid('Revisionato', 'Pre montato')).toBe(true);
    });

    it('Revisionato → Girato è valido (rollback profondo)', () => {
      expect(isTransitionValid('Revisionato', 'Girato')).toBe(true);
    });

    it('Programmato → Revisionato è valido (rollback pre-pubblicazione)', () => {
      expect(isTransitionValid('Programmato', 'Revisionato')).toBe(true);
    });

    it('Programmato → Montato è valido', () => {
      expect(isTransitionValid('Programmato', 'Montato')).toBe(true);
    });

    it('Programmato → Pre montato è valido', () => {
      expect(isTransitionValid('Programmato', 'Pre montato')).toBe(true);
    });

    it('Programmato → Girato è valido (rollback totale pre-pubblicazione)', () => {
      expect(isTransitionValid('Programmato', 'Girato')).toBe(true);
    });

    it('Scartata → Idea è valido (unico recupero da exit state)', () => {
      expect(isTransitionValid('Scartata', 'Idea')).toBe(true);
    });
  });

  // ── BACKWARD TRANSITIONS NON PERMESSE ────────────────────────────────────
  // Le transizioni backward NON dichiarate esplicitamente in FASE_TRANSITIONS
  // sono bloccate. In particolare Pubblicato è quasi immutabile.
  describe('backward transitions NON permesse', () => {
    it('Pre montato → Script NON è valido (backward non dichiarata)', () => {
      expect(isTransitionValid('Pre montato', 'Script')).toBe(false);
    });

    it('Pre montato → Idea NON è valido', () => {
      expect(isTransitionValid('Pre montato', 'Idea')).toBe(false);
    });

    it('Montato → Script NON è valido', () => {
      expect(isTransitionValid('Montato', 'Script')).toBe(false);
    });

    it('Montato → Idea NON è valido', () => {
      expect(isTransitionValid('Montato', 'Idea')).toBe(false);
    });

    it('Uploadato → Script NON è valido', () => {
      expect(isTransitionValid('Uploadato', 'Script')).toBe(false);
    });

    it('Uploadato → Idea NON è valido', () => {
      expect(isTransitionValid('Uploadato', 'Idea')).toBe(false);
    });

    it('Revisionato → Script NON è valido', () => {
      expect(isTransitionValid('Revisionato', 'Script')).toBe(false);
    });

    it('Revisionato → Idea NON è valido', () => {
      expect(isTransitionValid('Revisionato', 'Idea')).toBe(false);
    });

    it('Programmato → Script NON è valido', () => {
      expect(isTransitionValid('Programmato', 'Script')).toBe(false);
    });

    it('Programmato → Idea NON è valido', () => {
      expect(isTransitionValid('Programmato', 'Idea')).toBe(false);
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

    // Scartata è un exit state: si può solo tornare a Idea per recuperare.
    // Dopo il fix in isTransitionValid che gestisce 'from === Scartata' prima
    // del check forward, queste transizioni sono correttamente bloccate.
    it('Scartata → Script NON è valido (da Scartata si torna solo a Idea)', () => {
      expect(isTransitionValid('Scartata', 'Script')).toBe(false);
    });

    it('Scartata → Montato NON è valido', () => {
      expect(isTransitionValid('Scartata', 'Montato')).toBe(false);
    });

    it('Scartata → Pubblicato NON è valido', () => {
      expect(isTransitionValid('Scartata', 'Pubblicato')).toBe(false);
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
