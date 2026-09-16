#!/usr/bin/env node
/**
 * IndexNow: segnala a Bing/Yandex/Seznam (e ai motori che ne leggono il feed) le URL nuove o aggiornate.
 * Uso:
 *   node indexnow.mjs                          → pack con publishedAt/updatedAt negli ultimi 2 giorni + home + /quanto-costa-iniziare
 *   node indexnow.mjs <slug|url> [...]         → solo queste URL (gli slug diventano SITE_URL/pack/<slug>)
 *   node indexnow.mjs --write-key              → scrive site/public/<INDEXNOW_KEY>.txt e esce
 *   node indexnow.mjs --dry-run                → stampa il payload senza inviarlo
 * Env: INDEXNOW_KEY (obbligatoria: senza, lo script stampa un avviso ed esce con 0), SITE_URL.
 *
 * ⚠️  Prerequisito: il file di verifica `site/public/<INDEXNOW_KEY>.txt` deve esistere nel repo e
 * contenere esattamente la chiave; viene servito come https://mystarterpack.it/<INDEXNOW_KEY>.txt
 * (keyLocation) e senza di esso l'API risponde 403. Crealo una volta con `node indexnow.mjs --write-key`
 * e committalo: la chiave IndexNow è pubblica per definizione, non è un segreto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listPacks, SITE_URL } from './lib/packs.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC_DIR = path.join(here, '..', 'site', 'public');
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const KEY = (process.env.INDEXNOW_KEY || '').trim();
const DAYS = 2;

const packUrl = (slug) => `${SITE_URL}/pack/${slug}`;
const toUrl = (a) => (/^https?:\/\//i.test(a) ? a : packUrl(a.replace(/^\/?pack\//, '').replace(/^\//, '')));

/** Pack toccati (publishedAt o updatedAt) negli ultimi `days` giorni. */
export function recentPackUrls(days = DAYS) {
  const limit = Date.now() - days * 86400e3;
  const at = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };
  return listPacks()
    .filter((p) => Math.max(at(p.data.publishedAt), at(p.data.updatedAt)) >= limit)
    .map((p) => packUrl(p.slug));
}

/** Scrive il file di verifica in site/public/. */
export function writeKeyFile() {
  if (!KEY) throw new Error('INDEXNOW_KEY non impostata');
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const file = path.join(PUBLIC_DIR, `${KEY}.txt`);
  fs.writeFileSync(file, KEY + '\n');
  return file;
}

export async function submit(urls, { dry = false } = {}) {
  const urlList = [...new Set(urls.filter(Boolean))];
  if (!KEY) { console.warn('⚠️  INDEXNOW_KEY non impostata: invio saltato (docs/SETUP.md).'); return { skipped: true, urlList }; }
  if (!urlList.length) { console.log('IndexNow: nessuna URL da segnalare.'); return { skipped: true, urlList }; }
  const host = new URL(SITE_URL).host;
  const body = { host, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList };
  if (dry) { console.log('[dry-run] POST ' + ENDPOINT + '\n' + JSON.stringify(body, null, 2)); return { dry: true, urlList }; }
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`IndexNow ${res.status} ${res.statusText} ${text}`.trim());
  console.log(`✅ IndexNow: ${urlList.length} URL segnalate (${res.status})`);
  for (const u of urlList) console.log(`   · ${u}`);
  return { status: res.status, urlList };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--write-key')) {
    if (!KEY) { console.warn('⚠️  INDEXNOW_KEY non impostata: niente file di verifica da scrivere.'); return; }
    console.log(`✅ chiave scritta in ${writeKeyFile()} — committala: deve essere raggiungibile su ${SITE_URL}/${KEY}.txt`);
    return;
  }
  const explicit = args.filter((a) => !a.startsWith('--'));
  const urls = explicit.length ? explicit.map(toUrl) : [...recentPackUrls(), `${SITE_URL}/`, `${SITE_URL}/quanto-costa-iniziare`];
  await submit(urls, { dry: args.includes('--dry-run') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
