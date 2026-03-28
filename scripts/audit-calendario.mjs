import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabase = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const now = new Date().toISOString();
const log = [];
function L(s) { log.push(s); console.log(s); }

// ─── 1. MARKETING CALENDAR ───
L('\n══════════════════════════════════════');
L('1. MARKETING CALENDAR AUDIT');
L('══════════════════════════════════════');

const { data: mktCal, error: mktErr } = await supabase.from('marketing_calendar').select('*').order('data');
if (mktErr) { L(`  ERROR: ${mktErr.message}`); }
else {
  L(`  Total events: ${mktCal.length}`);

  const cats = {};
  mktCal.forEach(e => { cats[e.categoria] = (cats[e.categoria] || 0) + 1; });
  L(`  Categories: ${JSON.stringify(cats)}`);

  const years = {};
  mktCal.forEach(e => {
    const y = e.data ? e.data.substring(0, 4) : 'NULL';
    years[y] = (years[y] || 0) + 1;
  });
  L(`  Year distribution: ${JSON.stringify(years)}`);

  const seen = new Map();
  const dupes = [];
  mktCal.forEach(e => {
    const key = `${e.titolo}|${e.data}`;
    if (seen.has(key)) dupes.push({ titolo: e.titolo, data: e.data });
    else seen.set(key, e.id);
  });
  L(`  Duplicates (same title+date): ${dupes.length}`);
  dupes.forEach(d => L(`    - "${d.titolo}" on ${d.data}`));

  if (mktCal.length > 0) {
    const cols = Object.keys(mktCal[0]);
    const csv = [cols.join(','), ...mktCal.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    writeFileSync('/tmp/skorpio-export/marketing_calendar.csv', csv);
    L(`  Exported to /tmp/skorpio-export/marketing_calendar.csv`);
  }
}

// ─── 2. CALENDARIO EVENTI ───
L('\n══════════════════════════════════════');
L('2. CALENDARIO EVENTI AUDIT');
L('══════════════════════════════════════');

const { data: cal, error: calErr } = await supabase.from('calendario').select('*').order('data');
if (calErr) { L(`  ERROR: ${calErr.message}`); }
else {
  L(`  Total events: ${cal.length}`);

  const withCont = cal.filter(e => e.contenuto_id);
  const standalone = cal.filter(e => !e.contenuto_id);
  L(`  With contenuto_id: ${withCont.length}`);
  L(`  Standalone: ${standalone.length}`);

  const taskPattern = /TASK:([0-9a-f-]{36})/i;
  const withTask = cal.filter(e => e.descrizione && taskPattern.test(e.descrizione));
  L(`  Events with TASK:uuid in description: ${withTask.length}`);

  if (withTask.length > 0) {
    const taskIds = withTask.map(e => e.descrizione.match(taskPattern)[1]);
    const uniqueTaskIds = [...new Set(taskIds)];
    const { data: existingTasks } = await supabase.from('task').select('id').in('id', uniqueTaskIds);
    const existingSet = new Set((existingTasks || []).map(t => t.id));
    const orphanTasks = uniqueTaskIds.filter(id => !existingSet.has(id));
    L(`    Unique task IDs referenced: ${uniqueTaskIds.length}`);
    L(`    Tasks that still exist: ${existingSet.size}`);
    L(`    ORPHAN task refs (task deleted): ${orphanTasks.length}`);
    orphanTasks.forEach(id => {
      const ev = withTask.find(e => e.descrizione.includes(id));
      L(`      - TASK:${id} in event "${ev?.titolo}" on ${ev?.data}`);
    });
  }

  const today = now.substring(0, 10);
  const past = cal.filter(e => e.data && e.data < today);
  const future = cal.filter(e => e.data && e.data >= today);
  const nullDate = cal.filter(e => !e.data);
  L(`  Past events: ${past.length}`);
  L(`  Future events: ${future.length}`);
  L(`  NULL date: ${nullDate.length}`);
  nullDate.forEach(e => L(`    - id=${e.id} titolo="${e.titolo}"`));

  const calSeen = new Map();
  const calDupes = [];
  cal.forEach(e => {
    const key = `${e.descrizione || e.titolo}|${e.data}|${e.tipo}`;
    if (calSeen.has(key)) calDupes.push({ titolo: e.titolo, desc: e.descrizione, data: e.data, tipo: e.tipo });
    else calSeen.set(key, e.id);
  });
  L(`  Duplicates (same desc+date+tipo): ${calDupes.length}`);
  calDupes.slice(0, 10).forEach(d => L(`    - "${d.titolo || d.desc}" on ${d.data} tipo=${d.tipo}`));
  if (calDupes.length > 10) L(`    ... and ${calDupes.length - 10} more`);
}

// ─── 3. CONTENUTI CON DATE ───
L('\n══════════════════════════════════════');
L('3. CONTENUTI CON DATE AUDIT');
L('══════════════════════════════════════');

const { data: contenuti, error: contErr } = await supabase.from('contenuti').select('id,titolo,fase,data_pubblicazione,ora_pubblicazione,cliente_id').order('data_pubblicazione');
if (contErr) { L(`  ERROR: ${contErr.message}`); }
else {
  const withDate = contenuti.filter(c => c.data_pubblicazione);
  const withoutDate = contenuti.filter(c => !c.data_pubblicazione);
  L(`  Total contenuti: ${contenuti.length}`);
  L(`  With data_pubblicazione: ${withDate.length}`);
  L(`  Without data_pubblicazione: ${withoutDate.length}`);

  const today = now.substring(0, 10);
  const pastNotPub = withDate.filter(c => c.data_pubblicazione < today && c.fase !== 'Pubblicato' && c.fase !== 'Scartata');
  L(`\n  ANOMALY: Past date but fase != Pubblicato/Scartata: ${pastNotPub.length}`);
  pastNotPub.forEach(c => L(`    - "${c.titolo}" fase=${c.fase} data=${c.data_pubblicazione}`));

  const futPub = withDate.filter(c => c.data_pubblicazione >= today && c.fase === 'Pubblicato');
  L(`\n  ANOMALY: Future date but fase = Pubblicato: ${futPub.length}`);
  futPub.forEach(c => L(`    - "${c.titolo}" data=${c.data_pubblicazione}`));

  const noOra = withDate.filter(c => !c.ora_pubblicazione);
  L(`\n  Missing ora_pubblicazione (has date but no time): ${noOra.length}`);
  noOra.forEach(c => L(`    - "${c.titolo}" data=${c.data_pubblicazione} fase=${c.fase}`));

  L(`\n  Synthetic vs Real events check:`);
  if (cal) {
    const calContIds = new Set(cal.filter(e => e.contenuto_id).map(e => e.contenuto_id));
    const hasReal = withDate.filter(c => calContIds.has(c.id));
    const onlySynthetic = withDate.filter(c => !calContIds.has(c.id));
    L(`    Contenuti with real calendario event: ${hasReal.length}`);
    L(`    Contenuti with ONLY synthetic event (no real calendario row): ${onlySynthetic.length}`);
    onlySynthetic.slice(0, 15).forEach(c => L(`      - "${c.titolo}" data=${c.data_pubblicazione} fase=${c.fase}`));
    if (onlySynthetic.length > 15) L(`      ... and ${onlySynthetic.length - 15} more`);
  }
}

// ─── 4. TASK CON SCADENZA ───
L('\n══════════════════════════════════════');
L('4. TASK CON SCADENZA AUDIT');
L('══════════════════════════════════════');

const { data: tasks, error: taskErr } = await supabase.from('task').select('id,titolo,tipo,stato,scadenza,contenuto_id').order('scadenza');
if (taskErr) { L(`  ERROR: ${taskErr.message}`); }
else {
  const withScad = tasks.filter(t => t.scadenza);
  const withoutScad = tasks.filter(t => !t.scadenza);
  L(`  Total tasks: ${tasks.length}`);
  L(`  With scadenza: ${withScad.length}`);
  L(`  Without scadenza: ${withoutScad.length}`);

  if (cal) {
    let matched = 0, unmatched = 0;
    const unmatchedList = [];
    for (const t of withScad) {
      const found = cal.find(e => e.descrizione && e.descrizione.includes(`TASK:${t.id}`));
      if (found) matched++;
      else { unmatched++; unmatchedList.push(t); }
    }
    L(`  Tasks with scadenza AND matching calendario event: ${matched}`);
    L(`  Tasks with scadenza but NO calendario event: ${unmatched}`);
    unmatchedList.slice(0, 10).forEach(t => L(`    - "${t.titolo}" scadenza=${t.scadenza} tipo=${t.tipo} stato=${t.stato}`));
    if (unmatchedList.length > 10) L(`    ... and ${unmatchedList.length - 10} more`);
  }
}

// ─── 5. CONSISTENZA DATE ───
L('\n══════════════════════════════════════');
L('5. CONSISTENZA DATE (CONTENUTI + TASK)');
L('══════════════════════════════════════');

if (contenuti && tasks) {
  const today = now.substring(0, 10);
  const withDate = contenuti.filter(c => c.data_pubblicazione);

  const pubFuture = withDate.filter(c => c.fase === 'Pubblicato' && c.data_pubblicazione > today);
  L(`  Pubblicato with future date: ${pubFuture.length}`);
  pubFuture.forEach(c => L(`    - "${c.titolo}" data=${c.data_pubblicazione}`));

  const progPast = withDate.filter(c => c.fase === 'Programmato' && c.data_pubblicazione < today);
  L(`  Programmato with past date (should have been published): ${progPast.length}`);
  progPast.forEach(c => L(`    - "${c.titolo}" data=${c.data_pubblicazione}`));

  L(`\n  Workflow task date consistency:`);
  const TASK_ORDER = ['Premontaggio', 'Montaggio', 'Upload esportato', 'Revisione montaggio', 'Programmazione'];
  const contentIds = [...new Set(tasks.filter(t => t.contenuto_id).map(t => t.contenuto_id))];
  let orderIssues = 0;
  const issuesList = [];

  for (const cid of contentIds) {
    const ctasks = tasks.filter(t => t.contenuto_id === cid && t.scadenza);
    if (ctasks.length < 2) continue;

    const sorted = ctasks
      .map(t => ({ ...t, orderIdx: TASK_ORDER.indexOf(t.tipo) }))
      .filter(t => t.orderIdx >= 0)
      .sort((a, b) => a.orderIdx - b.orderIdx);

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].scadenza < sorted[i - 1].scadenza) {
        orderIssues++;
        const cont = contenuti.find(c => c.id === cid);
        issuesList.push({
          contenuto: cont?.titolo || cid,
          before: `${sorted[i - 1].tipo} (${sorted[i - 1].scadenza})`,
          after: `${sorted[i].tipo} (${sorted[i].scadenza})`,
        });
      }
    }
  }
  L(`  Task date order violations: ${orderIssues}`);
  issuesList.slice(0, 10).forEach(i => L(`    - "${i.contenuto}": ${i.before} > ${i.after}`));
  if (issuesList.length > 10) L(`    ... and ${issuesList.length - 10} more`);
}

// ─── FASE DISTRIBUTION ───
L('\n══════════════════════════════════════');
L('BONUS: FASE DISTRIBUTION');
L('══════════════════════════════════════');
if (contenuti) {
  const fasi = {};
  contenuti.forEach(c => { fasi[c.fase] = (fasi[c.fase] || 0) + 1; });
  Object.entries(fasi).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => L(`  ${f}: ${n}`));
}

L('\n══════════════════════════════════════');
L('AUDIT COMPLETE');
L('══════════════════════════════════════');

writeFileSync('/tmp/skorpio-export/audit-report.txt', log.join('\n'));
