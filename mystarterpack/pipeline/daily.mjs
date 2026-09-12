#!/usr/bin/env node
/**
 * Ciclo giornaliero autonomo: nuovo pack → immagini → voce → reel → Instagram.
 * Uso: node daily.mjs [--slug <esistente>] [--no-publish] [--no-images] [--count 1]
 * Senza --slug genera un pack nuovo dalla coda topics.json. Con GEMINI_API_KEY assente si ferma con errore chiaro.
 * Idempotente: i pack con video.status = published non vengono ripubblicati.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { generatePack, nextTopic } from './generate-pack.mjs';
import { readPack, listPacks } from './lib/packs.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const here = path.dirname(new URL(import.meta.url).pathname);
const run = (script, ...a) => execFileSync(process.execPath, [path.join(here, script), ...a], { stdio: 'inherit' });

async function main() {
  const count = Number(opt('--count') || 1);
  let slugs = opt('--slug') ? [opt('--slug')] : [];
  if (!slugs.length) {
    for (let i = 0; i < count; i++) {
      const job = nextTopic();
      if (!job) { console.log('Coda argomenti vuota.'); break; }
      console.log(`✍️  nuovo pack: ${job.topic} (${job.category})`);
      const r = await generatePack(job); slugs.push(r.slug);
    }
    // In più: recupera pack con video ancora "pending" (max 1 per run) per smaltire l'arretrato
    const pending = listPacks().filter((p) => p.data.video.status === 'pending' && !slugs.includes(p.slug)).sort((a, b) => new Date(a.data.publishedAt) - new Date(b.data.publishedAt));
    if (pending.length && slugs.length < count + 1) slugs.push(pending[0].slug);
  }
  for (const slug of slugs) {
    const pack = readPack(slug);
    if (pack.data.video.status === 'published') { console.log(`↩︎  ${slug} già pubblicato`); continue; }
    if (!args.includes('--no-images')) { try { run('product-image.mjs', slug); } catch { console.warn('immagini saltate'); } }
    run('render-video.mjs', slug, '--retts');
    if (!args.includes('--no-publish')) run('publish-instagram.mjs', slug);
  }
  console.log(`✅ daily completato: ${slugs.join(', ') || 'nessun pack'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
