import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const DRY = process.argv.includes('--dry');
if (DRY) console.log('=== DRY RUN ===\n');

const { data: contenuti, error } = await s.from('contenuti').select('id,id_display,titolo,fase,data_pubblicazione,ora_pubblicazione');
if (error) { console.error('Error:', error.message); process.exit(1); }

const noOra = contenuti.filter(c => c.data_pubblicazione && !c.ora_pubblicazione);
console.log(`Found ${noOra.length} contenuti with data but no ora\n`);

let updated = 0, errors = 0;
const needManual = [];

for (const c of noOra) {
  if (c.fase === 'Pubblicato' || c.fase === 'Scartata') {
    console.log(`[FIX5] ${c.id_display} "${c.titolo}" (${c.fase}) → ora=10:00:00`);
    if (!DRY) {
      const { error } = await s.from('contenuti').update({ ora_pubblicazione: '10:00:00' }).eq('id', c.id);
      if (error) { console.error(`  ERROR: ${error.message}`); errors++; continue; }
    }
    updated++;
  } else {
    needManual.push(c);
  }
}

if (needManual.length > 0) {
  console.log(`\nSERVE ORA MANUALE (non pubblicati):`);
  for (const c of needManual) {
    console.log(`  - ${c.id_display} "${c.titolo}" — data: ${c.data_pubblicazione} — fase: ${c.fase}`);
  }
}

console.log(`\n=== RISULTATO ${DRY ? '(DRY RUN)' : ''} ===`);
console.log(`Aggiornati: ${updated}, Da valutare: ${needManual.length}, Errori: ${errors}`);
