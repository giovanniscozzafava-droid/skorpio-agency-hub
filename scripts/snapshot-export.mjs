import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const s = createClient(
  'https://njmcbrappisqwcugbaxb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbWNicmFwcGlzcXdjdWdiYXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODQzNjcsImV4cCI6MjA4OTg2MDM2N30.uSclmK-uZuF1NwTRU_ghYMYIubXNyo1dMgjMdUXaxvo'
);

const tables = ['contenuti', 'task', 'calendario', 'log_riprese', 'clienti', 'marketing_calendar'];

console.log('══════════════════════════');
console.log('SNAPSHOT ' + new Date().toISOString());
console.log('══════════════════════════');

for (const t of tables) {
  const { count, error } = await s.from(t).select('*', { count: 'exact', head: true });
  console.log(t.padEnd(20), error ? 'ERROR: ' + error.message : count);
}

console.log('');

for (const t of tables) {
  const { data, error } = await s.from(t).select('*').order('created_at', { ascending: false }).limit(10000);
  if (error) { console.log(t, 'EXPORT ERROR:', error.message); continue; }
  if (!data || data.length === 0) { console.log(t, 'EMPTY'); continue; }
  const cols = Object.keys(data[0]);
  const lines = [cols.join(',')];
  for (const r of data) {
    const row = cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      const str = String(v).replace(/"/g, '""');
      return '"' + str + '"';
    });
    lines.push(row.join(','));
  }
  writeFileSync('/tmp/skorpio-export/' + t + '.csv', lines.join('\n'));
  console.log(t.padEnd(20), data.length, 'rows -> /tmp/skorpio-export/' + t + '.csv');
}

console.log('');
console.log('Done.');
