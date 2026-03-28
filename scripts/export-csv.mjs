#!/usr/bin/env node
/**
 * Export Supabase data to CSV files in /tmp/skorpio-export/
 * Run: node scripts/export-csv.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

// Parse .env manually (no dotenv dependency)
const envContent = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^(\w+)\s*=\s*"?(.*?)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key);
const OUT = '/tmp/skorpio-export';
mkdirSync(OUT, { recursive: true });

function toCsv(rows, columns) {
  if (!rows || rows.length === 0) return columns.join(',') + '\n';
  const header = columns.join(',');
  const lines = rows.map(r =>
    columns.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

async function exportTable(table, columns, filename) {
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
  if (error) {
    console.error(`Error fetching ${table}:`, error.message);
    return 0;
  }
  const csv = toCsv(data, columns);
  writeFileSync(`${OUT}/${filename}`, csv, 'utf8');
  console.log(`✅ ${filename}: ${data.length} rows`);
  return data.length;
}

console.log('Exporting data from Supabase...\n');

await exportTable('contenuti',
  ['id', 'id_display', 'titolo', 'fase', 'cliente_nome', 'cliente_id', 'data_pubblicazione', 'ora_pubblicazione', 'tipo', 'canale', 'data_ripresa', 'assegnato_riprese', 'assegnato_montaggio', 'created_at', 'updated_at'],
  'contenuti.csv'
);

await exportTable('task',
  ['id', 'id_display', 'descrizione', 'stato', 'tipo', 'assegnato_a', 'assegnato_da', 'id_contenuto', 'cliente_id', 'cliente_nome', 'priorita', 'scadenza', 'ora', 'posizione', 'created_at', 'updated_at'],
  'task.csv'
);

await exportTable('calendario',
  ['id', 'tipo', 'descrizione', 'data', 'ora', 'ora_fine', 'persona', 'contenuto_id', 'id_contenuto_display', 'canale', 'tipo_contenuto', 'cliente_id', 'cliente_nome', 'stato', 'ricorrenza', 'ricorrenza_parent_id', 'created_at'],
  'calendario.csv'
);

await exportTable('clienti',
  ['id', 'id_display', 'nome', 'stato', 'pacchetto', 'reel_quota', 'reel_fatti', 'grafiche_quota', 'grafiche_fatte', 'referente', 'email', 'created_at'],
  'clienti.csv'
);

console.log(`\n📁 Files saved to ${OUT}/`);
