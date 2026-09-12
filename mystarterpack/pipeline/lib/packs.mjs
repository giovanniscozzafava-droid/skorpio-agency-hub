import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const SITE_DIR = path.join(ROOT, 'site');
export const PACKS_DIR = path.join(SITE_DIR, 'src', 'content', 'packs');
export const OUT_DIR = path.join(ROOT, 'pipeline', 'out');
export const CATEGORIES = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'src', 'data', 'categories.json'), 'utf8'));
export const AMAZON_TAG = process.env.AMAZON_TAG || process.env.PUBLIC_AMAZON_TAG || 'mystarterpack-21';
export const SITE_URL = process.env.SITE_URL || 'https://mystarterpack.it';

export function listPacks() {
  return fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.md')).map((f) => readPack(f.replace(/\.md$/, '')));
}
export function readPack(slug) {
  const file = path.join(PACKS_DIR, `${slug}.md`);
  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  return { slug, file, data, content };
}
export function writePack(slug, data, content) {
  const file = path.join(PACKS_DIR, `${slug}.md`);
  fs.writeFileSync(file, matter.stringify(content.trim() + '\n', data, { lineWidth: 0 }));
  return file;
}
export function packExists(slug) { return fs.existsSync(path.join(PACKS_DIR, `${slug}.md`)); }
export function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function amazonLink(p) {
  if (p.asin) return `https://www.amazon.it/dp/${p.asin}?tag=${AMAZON_TAG}&linkCode=ll1`;
  return `https://www.amazon.it/s?k=${encodeURIComponent(p.amazonQuery)}&tag=${AMAZON_TAG}&linkCode=ll2`;
}
export function categoryOf(pack) { return CATEGORIES.find((c) => c.slug === pack.data.category) || CATEGORIES[0]; }
export function outDir(slug) { const d = path.join(OUT_DIR, slug); fs.mkdirSync(d, { recursive: true }); return d; }

/** Validazione editoriale minima (stesse regole del brief). Ritorna lista errori. */
export function validatePack(data) {
  const e = [];
  if (!data.title || data.title.length > 110) e.push('title mancante o > 110 caratteri');
  if (!data.description || data.description.length < 60 || data.description.length > 200) e.push('description fuori da 60-200 caratteri');
  if (!CATEGORIES.some((c) => c.slug === data.category)) e.push(`category sconosciuta: ${data.category}`);
  if (!Array.isArray(data.products) || data.products.length !== 5) e.push('servono esattamente 5 prodotti');
  for (const [i, p] of (data.products || []).entries()) {
    for (const k of ['name', 'role', 'why', 'priceRange', 'amazonQuery']) if (!p[k]) e.push(`prodotto ${i + 1}: manca ${k}`);
    if (!Array.isArray(p.pros) || p.pros.length < 1 || p.pros.length > 4) e.push(`prodotto ${i + 1}: pros 1-4`);
    if (p.asin && !/^[A-Z0-9]{10}$/.test(p.asin)) e.push(`prodotto ${i + 1}: ASIN non valido`);
  }
  if (!data.video?.hook) e.push('video.hook mancante');
  if (!Array.isArray(data.video?.script) || data.video.script.length < 5 || data.video.script.length > 8) e.push('video.script deve avere 5-8 righe');
  for (const [i, line] of (data.video?.script || []).entries()) if (/\d/.test(line)) e.push(`script riga ${i + 1}: contiene cifre (scrivile in lettere)`);
  if (!Array.isArray(data.faq) || data.faq.length < 2) e.push('servono almeno 2 FAQ');
  return e;
}

/** Caption Instagram standard del brand. */
export function buildCaption(pack) {
  const d = pack.data;
  const cat = categoryOf(pack);
  const lines = [
    d.video.hook,
    '',
    `Le 5 cose per iniziare: ${d.activity.toLowerCase()} 👇`,
    ...d.products.map((p, i) => `${i + 1}. ${p.role.replace(/^(le|la|il|lo|i|gli|l')\s+/i, (m) => m)} → ${p.name} (${p.priceRange})`),
    '',
    `💶 Budget totale: ${d.budgetTotal}`,
    `🔗 Link e guida completa: ${SITE_URL}/pack/${pack.slug}`,
    '',
    'Le 5 cose per iniziare. Punto.',
    '',
    '#adv #affiliazione #mystarterpack #starterpack',
    `#${slugify(d.activity).replace(/-/g, '')} #${cat.slug.replace(/-/g, '')} #principianti #comeiniziare #consigliacquisti #amazonfinds #amazonitalia`,
    ...(d.tags || []).slice(0, 5).map((t) => `#${slugify(t).replace(/-/g, '')}`),
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
