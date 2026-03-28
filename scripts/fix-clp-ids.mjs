import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const DRY = process.argv.includes('--dry');
if (DRY) console.log('=== DRY RUN ===\n');

// 1. Get all tasks with CLP-style id_contenuto
const { data: tasks, error: tErr } = await s.from('task').select('id,id_display,id_contenuto,descrizione,stato');
if (tErr) { console.error('Error fetching tasks:', tErr.message); process.exit(1); }

const clpTasks = tasks.filter(t => t.id_contenuto && /^CLP\d+$/i.test(t.id_contenuto));
console.log(`Found ${clpTasks.length} tasks with CLP-style id_contenuto\n`);

// 2. Get all contenuti to build CLP → UUID map
const { data: contenuti, error: cErr } = await s.from('contenuti').select('id,id_display');
if (cErr) { console.error('Error fetching contenuti:', cErr.message); process.exit(1); }

const clpToUuid = new Map();
for (const c of contenuti) {
  if (c.id_display) clpToUuid.set(c.id_display, c.id);
}

let migrated = 0, archived = 0, errors = 0;

for (const t of clpTasks) {
  const uuid = clpToUuid.get(t.id_contenuto);

  if (uuid) {
    console.log(`[FIX1] ${t.id_display}: ${t.id_contenuto} → ${uuid}`);
    if (!DRY) {
      const { error } = await s.from('task').update({ id_contenuto: uuid }).eq('id', t.id);
      if (error) { console.error(`  ERROR: ${error.message}`); errors++; continue; }
    }
    migrated++;
  } else {
    console.log(`[FIX1] ${t.id_display}: ${t.id_contenuto} → NOT FOUND — archiving (stato: ${t.stato})`);
    if (!DRY) {
      const { error } = await s.from('task').update({ stato: 'Archiviato' }).eq('id', t.id);
      if (error) { console.error(`  ERROR: ${error.message}`); errors++; continue; }
    }
    archived++;
  }
}

console.log(`\n=== RISULTATO ${DRY ? '(DRY RUN)' : ''} ===`);
console.log(`Migrati: ${migrated}, Archiviati: ${archived}, Errori: ${errors}`);
