/**
 * Parse una stringa data "YYYY-MM-DD" come data locale (senza conversione UTC).
 * Evita il classico bug: new Date('2025-01-15') → 14 gennaio in UTC+1.
 */
export function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/**
 * Formatta una Date in "YYYY-MM-DD" (stringa locale, senza timezone shift).
 */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Confronta due date (solo giorno, ignora ora).
 */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/**
 * Aggiunge N giorni a una data.
 */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
