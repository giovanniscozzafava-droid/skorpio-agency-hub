import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const DRY = process.argv.includes('--dry');
if (DRY) console.log('=== DRY RUN ===\n');

const activeStates = ['Da fare', 'In lavorazione', 'In revisione'];

const { data: tasks, error: tErr } = await s.from('task').select('id,id_display,descrizione,tipo,stato,scadenza,ora,assegnato_a,cliente_nome,id_contenuto');
if (tErr) { console.error('Error:', tErr.message); process.exit(1); }

const activeTasks = tasks.filter(t => activeStates.includes(t.stato) && t.scadenza);

const { data: cal, error: calErr } = await s.from('calendario').select('descrizione');
if (calErr) { console.error('Error:', calErr.message); process.exit(1); }

// Build set of task IDs already in calendario
const calTaskIds = new Set();
for (const e of cal) {
  if (e.descrizione) {
    const m = e.descrizione.match(/TASK:([0-9a-f-]{36})/i);
    if (m) calTaskIds.add(m[1]);
  }
}

const missing = activeTasks.filter(t => !calTaskIds.has(t.id));
console.log(`Active tasks with scadenza: ${activeTasks.length}`);
console.log(`Already synced: ${activeTasks.length - missing.length}`);
console.log(`Missing from calendario: ${missing.length}\n`);

// Check if id_contenuto is a valid UUID
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let created = 0, errors = 0;

for (const t of missing) {
  const contentTipi = ['Premontaggio', 'Montaggio', 'Upload esportato', 'Revisione montaggio', 'Programmazione', 'Pre montato', 'Montato'];
  const tipo = contentTipi.includes(t.tipo) ? 'contenuto' : 'appuntamento';

  const event = {
    tipo,
    descrizione: (t.descrizione || t.tipo) + ' [TASK:' + t.id + ']',
    data: t.scadenza,
    ora: t.ora || null,
    persona: t.assegnato_a || null,
    cliente_nome: t.cliente_nome || null,
  };

  if (t.id_contenuto && uuidRe.test(t.id_contenuto)) {
    event.contenuto_id = t.id_contenuto;
  }

  console.log(`[FIX3] ${t.id_display} "${t.descrizione?.substring(0, 50)}" → ${event.data} tipo=${tipo}`);

  if (!DRY) {
    const { error } = await s.from('calendario').insert(event);
    if (error) { console.error(`  ERROR: ${error.message}`); errors++; continue; }
  }
  created++;
}

console.log(`\n=== RISULTATO ${DRY ? '(DRY RUN)' : ''} ===`);
console.log(`Creati: ${created}, Errori: ${errors}`);
