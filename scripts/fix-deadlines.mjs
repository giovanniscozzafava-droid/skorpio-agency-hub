/**
 * Analisi + Fix scadenze task workflow errate + dedup calendario
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://njmcbrappisqwcugbaxb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Lead times standard (giorni prima della pubblicazione)
const LEAD_TIMES = {
  'Scrittura script': 7,
  'Premontaggio': 5,
  'Montaggio': 3,
  'Upload esportato': 2,
  'Revisione montaggio': 2,
  'Programmazione': 1,
  'Cleanup': 0,
  'Pubblicazione': 0,
  'Supervisione': 2,
};

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  // 1. ANALISI: trova task con scadenza == data_pubblicazione del contenuto
  // ══════════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════');
  console.log('1. ANALISI — Task con scadenza errata');
  console.log('═══════════════════════════════════════════════════════\n');

  // Get all contenuti with data_pubblicazione
  const { data: contenuti } = await supabase
    .from('contenuti')
    .select('id, id_display, titolo, cliente_nome, data_pubblicazione, tipo')
    .not('data_pubblicazione', 'is', null);

  const contenutiMap = Object.fromEntries(contenuti.map(c => [c.id, c]));

  // Get all open workflow tasks linked to contenuti
  const { data: tasks } = await supabase
    .from('task')
    .select('id, id_display, tipo, scadenza, id_contenuto, stato, descrizione')
    .not('id_contenuto', 'is', null)
    .neq('stato', 'Archiviato');

  let errati = [];
  let corretti = 0;

  for (const task of tasks) {
    const contenuto = contenutiMap[task.id_contenuto];
    if (!contenuto || !contenuto.data_pubblicazione || !task.scadenza) continue;

    const leadTime = LEAD_TIMES[task.tipo];
    if (leadTime === undefined || leadTime === 0) continue; // skip Cleanup, Pubblicazione

    const expectedScadenza = addDays(contenuto.data_pubblicazione, -leadTime);

    // Check if scadenza is wrong (== data_pubblicazione or not matching expected)
    if (task.scadenza === contenuto.data_pubblicazione) {
      errati.push({
        task_id: task.id,
        task_display: task.id_display,
        clp_display: contenuto.id_display,
        titolo: contenuto.titolo,
        cliente: contenuto.cliente_nome,
        tipo_task: task.tipo,
        stato: task.stato,
        scadenza_attuale: task.scadenza,
        data_pub: contenuto.data_pubblicazione,
        lead_time: leadTime,
        scadenza_corretta: expectedScadenza,
      });
    }
  }

  console.log(`Trovati ${errati.length} task con scadenza == data_pubblicazione:\n`);

  if (errati.length === 0) {
    console.log('  (nessun task con scadenza errata)');
  } else {
    console.log('CLP          | Titolo                         | Tipo task             | Scadenza attuale | Data pub     | Lead | Scadenza corretta');
    console.log('─'.repeat(140));
    for (const e of errati) {
      console.log(
        `${(e.clp_display || '').padEnd(12)} | ` +
        `${(e.titolo || '').slice(0, 30).padEnd(30)} | ` +
        `${(e.tipo_task || '').padEnd(21)} | ` +
        `${e.scadenza_attuale}       | ` +
        `${e.data_pub}  | ` +
        `${String(e.lead_time).padEnd(4)} | ` +
        `${e.scadenza_corretta}`
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. FIX SCADENZE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('2. FIX SCADENZE — Ricalcolo con lead times');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const e of errati) {
    // Update task scadenza
    const { error: taskErr } = await supabase
      .from('task')
      .update({ scadenza: e.scadenza_corretta })
      .eq('id', e.task_id);

    if (taskErr) {
      console.log(`  ❌ Errore update task ${e.task_display}: ${taskErr.message}`);
      continue;
    }

    corretti++;
    console.log(`  ✅ ${e.clp_display} → ${e.tipo_task}: ${e.scadenza_attuale} → ${e.scadenza_corretta} (-${e.lead_time}gg)`);

    // Try to update linked calendar event (search by task description pattern)
    const { data: calEvents } = await supabase
      .from('calendario')
      .select('id, titolo, data')
      .eq('data', e.scadenza_attuale)
      .ilike('titolo', `%${e.clp_display || ''}%`);

    if (calEvents) {
      for (const ev of calEvents) {
        // Only update if it matches this task type
        const isMatch = ev.titolo && (
          ev.titolo.includes(e.tipo_task) ||
          ev.titolo.includes('Premontaggio') && e.tipo_task === 'Premontaggio' ||
          ev.titolo.includes('Montaggio') && e.tipo_task === 'Montaggio' ||
          ev.titolo.includes('Upload') && e.tipo_task === 'Upload esportato' ||
          ev.titolo.includes('Revisione') && e.tipo_task === 'Revisione montaggio' ||
          ev.titolo.includes('Programmazione') && e.tipo_task === 'Programmazione' ||
          ev.titolo.includes('Scrittura') && e.tipo_task === 'Scrittura script'
        );
        if (isMatch) {
          await supabase.from('calendario').update({ data: e.scadenza_corretta }).eq('id', ev.id);
          console.log(`     📅 Calendario aggiornato: "${ev.titolo}" → ${e.scadenza_corretta}`);
        }
      }
    }
  }

  console.log(`\n  Totale task corretti: ${corretti}/${errati.length}`);

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DEDUPLICAZIONE CALENDARIO
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('3. DEDUP CALENDARIO — Rimozione duplicati');
  console.log('═══════════════════════════════════════════════════════\n');

  const { data: allCal } = await supabase
    .from('calendario')
    .select('id, titolo, data, tipo, contenuto_id, created_at')
    .order('created_at', { ascending: true });

  // Group by (data, contenuto_id, tipo)
  const groups = {};
  let duplicatiRimossi = 0;

  for (const ev of allCal || []) {
    const key = `${ev.data}|${ev.contenuto_id || ''}|${ev.tipo || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  }

  // Also group by (data, titolo) for events without contenuto_id
  const titleGroups = {};
  for (const ev of allCal || []) {
    if (ev.contenuto_id) continue; // already handled above
    const key = `${ev.data}|${ev.titolo}`;
    if (!titleGroups[key]) titleGroups[key] = [];
    titleGroups[key].push(ev);
  }

  const idsToDelete = new Set();

  // Dedup by (data, contenuto_id, tipo)
  for (const [key, events] of Object.entries(groups)) {
    if (events.length <= 1) continue;
    // Keep first, delete rest
    for (let i = 1; i < events.length; i++) {
      idsToDelete.add(events[i].id);
      console.log(`  🗑️ Duplicato: "${events[i].titolo}" (${events[i].data}) [${events[i].tipo || 'no-tipo'}]`);
    }
  }

  // Dedup by (data, titolo) for non-contenuto events
  for (const [key, events] of Object.entries(titleGroups)) {
    if (events.length <= 1) continue;
    for (let i = 1; i < events.length; i++) {
      idsToDelete.add(events[i].id);
      console.log(`  🗑️ Duplicato (titolo): "${events[i].titolo}" (${events[i].data})`);
    }
  }

  if (idsToDelete.size > 0) {
    const deleteIds = Array.from(idsToDelete);
    // Delete in batches of 50
    for (let i = 0; i < deleteIds.length; i += 50) {
      const batch = deleteIds.slice(i, i + 50);
      const { error } = await supabase.from('calendario').delete().in('id', batch);
      if (error) console.log(`  ❌ Errore cancellazione batch: ${error.message}`);
    }
    duplicatiRimossi = idsToDelete.size;
  }

  console.log(`\n  Duplicati rimossi: ${duplicatiRimossi}`);

  // ══════════════════════════════════════════════════════════════════════════
  // RIEPILOGO
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('RIEPILOGO');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Task con scadenza errata trovati: ${errati.length}`);
  console.log(`  Task scadenze corrette:           ${corretti}`);
  console.log(`  Eventi calendario duplicati:       ${duplicatiRimossi}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(console.error);
