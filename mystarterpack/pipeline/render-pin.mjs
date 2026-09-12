#!/usr/bin/env node
/**
 * Creative statiche del pack, renderizzate con Chromium dal template templates/pin.html:
 *   - out/<slug>/pin.jpg         1000x1500  → Pinterest (Pin standard 2:3)
 *   - out/<slug>/cover-post.jpg  1080x1350  → cover del post/reel Instagram e immagine OG (4:5)
 *   - out/<slug>/pin.txt         descrizione pronta per Pinterest (max 500 caratteri, con disclosure)
 * Uso: node render-pin.mjs <slug> [--only pin|cover]
 * Niente rete: il logo è letto da brand/logo/logo-horizontal.svg via file://.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { readPack, outDir, categoryOf, buildPinDescription } from './lib/packs.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const TEMPLATE = path.join(here, 'templates', 'pin.html');
const LOGO = 'file://' + path.join(here, '..', 'brand', 'logo', 'logo-horizontal.svg');
const DESIGN_W = 1000; // larghezza della superficie di disegno: i formati sono scalati con zoom

/** Formati prodotti. width/height = pixel finali dell'immagine. */
export const FORMATS = {
  pin: { name: 'pin', file: 'pin.jpg', width: 1000, height: 1500, quality: 90 },
  cover: { name: 'cover', file: 'cover-post.jpg', width: 1080, height: 1350, quality: 90 },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { const d = fs.readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().pop(); if (d) return path.join(base, d, 'chrome-linux', 'chrome'); } catch {}
  return undefined; // playwright-core cercherà il browser del sistema (channel)
}

/** Ruolo del prodotto in maiuscoletto, senza articolo iniziale ("Le scarpe" → "SCARPE"). */
const roleLabel = (p) => p.role.replace(/^(?:(?:le|la|il|lo|i|gli)\s+|l'\s*)/i, '').trim();
/** Nome prodotto compatto: via gli incisi tra parentesi, che su una creativa non aggiungono nulla. */
const nameLabel = (p) => p.name.replace(/\s*\([^()]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
/** Primo valore della scala la cui soglia è >= len (attività e nomi prodotto variano molto). */
const pick = (len, scale) => (scale.find(([max]) => len <= max) || scale[scale.length - 1])[1];

function buildHtml(pack, fmt) {
  const d = pack.data;
  const cat = categoryOf(pack);
  const products = d.products.slice(0, 5);
  const items = products.map((p, i) => (
    `<li><b class="chip display">${i + 1}</b>` +
    `<div class="txt"><div class="role">${esc(roleLabel(p))}</div><div class="name display">${esc(nameLabel(p))}</div></div>` +
    `<span class="price display">${esc(p.priceRange)}</span></li>`
  )).join('');
  // Titolo e nomi prodotto si adattano alla lunghezza del testo: niente overflow, niente troncature brutte.
  const k = fmt.name === 'cover' ? 0.88 : 1;
  const titleFs = pick(d.activity.length, [[14, 88], [20, 78], [28, 68], [40, 56], [Infinity, 46]]);
  const nameFs = pick(Math.max(...products.map((p) => nameLabel(p).length)), [[26, 41], [36, 38], [48, 35], [Infinity, 32]]);
  const stageStyle = `--titleFs:${Math.round(titleFs * k)}px;--nameFs:${Math.round(nameFs * k)}px`;
  const scale = fmt.width / DESIGN_W;
  const vars = {
    FORMAT: fmt.name,
    W: String(fmt.width),
    H: String(fmt.height),
    SCALE: String(Number(scale.toFixed(4))),
    STAGE_H: String(Math.round(fmt.height / scale)),
    TINT: cat.color,
    LOGO,
    EMOJI: esc(d.emoji || cat.emoji),
    TITLE: `Starter pack ${esc(d.activity)}`,
    ACTIVITY: esc(d.activity),
    SUBTITLE: 'Le 5 cose per iniziare',
    BUDGET: esc(d.budgetTotal),
    ITEMS: items,
    STAGE_STYLE: stageStyle,
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export async function renderPin(slug, { only } = {}) {
  const pack = readPack(slug);
  const dir = outDir(slug);
  const formats = Object.values(FORMATS).filter((f) => !only || f.name === only);
  if (!formats.length) throw new Error(`formato sconosciuto: ${only} (pin|cover)`);

  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: formats[0].width, height: formats[0].height }, deviceScaleFactor: 1 });
  // Document URL su file:// così il logo caricato con file:// è consentito dopo setContent.
  await page.goto('file://' + path.join(here, 'templates') + '/');
  const written = [];
  try {
    for (const fmt of formats) {
      await page.setViewportSize({ width: fmt.width, height: fmt.height });
      await page.setContent(buildHtml(pack, fmt), { waitUntil: 'load' });
      await page.evaluate(() => Promise.all([
        document.fonts.ready,
        ...[...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
      ]));
      const out = path.join(dir, fmt.file);
      await page.screenshot({ path: out, type: 'jpeg', quality: fmt.quality, clip: { x: 0, y: 0, width: fmt.width, height: fmt.height } });
      written.push(out);
      console.log(`🖼️  ${out} (${fmt.width}×${fmt.height}, ${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
    }
  } finally {
    await browser.close();
  }
  const descFile = path.join(dir, 'pin.txt');
  fs.writeFileSync(descFile, buildPinDescription(pack) + '\n');
  written.push(descFile);
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) { console.error('uso: node render-pin.mjs <slug> [--only pin|cover]'); process.exit(1); }
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  renderPin(slug, { only }).catch((e) => { console.error(e); process.exit(1); });
}
