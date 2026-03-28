import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const DRY = process.argv.includes('--dry');
if (DRY) console.log('=== DRY RUN ===\n');

// Get contenuti with data_pubblicazione
const { data: contenuti, error: cErr } = await s.from('contenuti').select('id,id_display,titolo,tipo,fase,data_pubblicazione,ora_pubblicazione,cliente_id,cliente_nome,assegnato_montaggio,assegnato_riprese');
if (cErr) { console.error('Error:', cErr.message); process.exit(1); }

const withDate = contenuti.filter(c => c.data_pubblicazione);

// Get calendario events with contenuto_id
const { data: cal, error: calErr } = await s.from('calendario').select('contenuto_id');
if (calErr) { console.error('Error:', calErr.message); process.exit(1); }

const calContIds = new Set(cal.filter(e => e.contenuto_id).map(e => e.contenuto_id));

const onlySynthetic = withDate.filter(c => !calContIds.has(c.id));
console.log(`Found ${onlySynthetic.length} contenuti with date but no real calendario event\n`);

let created = 0, errors = 0;

for (const c of onlySynthetic) {
  const persona = c.assegnato_montaggio || c.assegnato_riprese || null;
  const event = {
    tipo: 'pubblicazione',
    descrizione: `Pubblicazione ${c.id_display} – ${c.titolo}`,
    data: c.data_pubblicazione,
    ora: c.ora_pubblicazione || null,
    cliente_id: c.cliente_id || null,
    cliente_nome: c.cliente_nome || null,
    contenuto_id: c.id,
    id_contenuto_display: c.id_display,
    tipo_contenuto: c.tipo || null,
    persona: persona,
  };

  console.log(`[FIX6] Creating event: "${event.descrizione}" on ${event.data}`);

  if (!DRY) {
    const { error } = await s.from('calendario').insert(event);
    if (error) {
      console.error(`  ERROR: ${error.message}`);
      // Try without fields that may not exist
      const minimal = { tipo: event.tipo, descrizione: event.descrizione, data: event.data, ora: event.ora, contenuto_id: event.contenuto_id };
      if (event.cliente_id) minimal.cliente_id = event.cliente_id;
      if (event.cliente_nome) minimal.cliente_nome = event.cliente_nome;
      if (event.persona) minimal.persona = event.persona;
      const { error: e2 } = await s.from('calendario').insert(minimal);
      if (e2) { console.error(`  RETRY ERROR: ${e2.message}`); errors++; continue; }
    }
  }
  created++;
}

console.log(`\n=== RISULTATO ${DRY ? '(DRY RUN)' : ''} ===`);
console.log(`Creati: ${created}, Errori: ${errors}`);
