import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const DRY = process.argv.includes('--dry');
if (DRY) console.log('=== DRY RUN ===\n');

const { data: tasks, error } = await s.from('task').select('id,id_display,tipo,stato,id_contenuto,created_at').order('created_at', { ascending: false });
if (error) { console.error('Error:', error.message); process.exit(1); }

// Find duplicates: same id_contenuto + tipo + stato = 'Da fare'
const daFare = tasks.filter(t => t.stato === 'Da fare' && t.id_contenuto);
const groups = new Map();
for (const t of daFare) {
  const key = `${t.id_contenuto}|${t.tipo}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}

let archived = 0, errors = 0;
const dupeGroups = [...groups.entries()].filter(([, v]) => v.length > 1);

console.log(`Found ${dupeGroups.length} duplicate groups\n`);

for (const [key, group] of dupeGroups) {
  // Keep most recent (first in array since sorted desc by created_at)
  const keep = group[0];
  const toArchive = group.slice(1);

  for (const t of toArchive) {
    console.log(`[FIX2] Archiviato ${t.id_display} (duplicato di ${keep.id_display}) — tipo=${t.tipo}`);
    if (!DRY) {
      const { error } = await s.from('task').update({ stato: 'Archiviato' }).eq('id', t.id);
      if (error) { console.error(`  ERROR: ${error.message}`); errors++; continue; }
    }
    archived++;
  }
}

console.log(`\n=== RISULTATO ${DRY ? '(DRY RUN)' : ''} ===`);
console.log(`Archiviati: ${archived}, Errori: ${errors}`);
