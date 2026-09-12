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
/**
 * Tag affiliato per canale: legge AMAZON_TAG_<CANALE> (WEB, IG, TT, YT, PIN, NL) con fallback ad AMAZON_TAG.
 * Serve ad attribuire le vendite al canale che le ha generate senza toccare i link del sito.
 */
export const TAG_CHANNELS = ['web', 'ig', 'tt', 'yt', 'pin', 'nl'];
const CHANNEL_ALIASES = { instagram: 'ig', reel: 'ig', reels: 'ig', story: 'ig', tiktok: 'tt', youtube: 'yt', shorts: 'yt', short: 'yt', pinterest: 'pin', newsletter: 'nl', email: 'nl', site: 'web', sito: 'web' };
export function amazonTagFor(channel = 'web') {
  const raw = String(channel || 'web').trim().toLowerCase();
  const key = (CHANNEL_ALIASES[raw] || raw).replace(/[^a-z0-9]/g, '').toUpperCase();
  return (key && process.env[`AMAZON_TAG_${key}`]) || process.env.AMAZON_TAG || process.env.PUBLIC_AMAZON_TAG || AMAZON_TAG;
}
export function amazonLink(p, channel = 'web') {
  const tag = amazonTagFor(channel);
  if (p.asin) return `https://www.amazon.it/dp/${p.asin}?tag=${tag}&linkCode=ll1`;
  return `https://www.amazon.it/s?k=${encodeURIComponent(p.amazonQuery)}&tag=${tag}&linkCode=ll2`;
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

/** Tronca a max caratteri senza spezzare a metà parola quando possibile. */
function clamp(s, max) {
  const t = String(s == null ? '' : s).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}
const hashtag = (s) => `#${slugify(s).replace(/-/g, '')}`;
/** n hashtag del pack, senza duplicati: brand, attività, categoria, tag editoriali. */
export function packHashtags(pack, n = 5) {
  const d = pack.data;
  const cat = categoryOf(pack);
  const out = [];
  for (const s of ['mystarterpack', 'starterpack', d.activity, cat.slug, 'principianti', ...(d.tags || [])]) {
    const t = hashtag(s || '');
    if (t.length > 1 && !out.includes(t)) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/** Caption Instagram standard del brand. `channel` finisce nel parametro ?src= del link. */
export function buildCaption(pack, channel = 'ig') {
  const d = pack.data;
  const cat = categoryOf(pack);
  const lines = [
    d.video.hook,
    '',
    `Le 5 cose per iniziare: ${d.activity.toLowerCase()} 👇`,
    ...d.products.map((p, i) => `${i + 1}. ${p.role.replace(/^(le|la|il|lo|i|gli|l')\s+/i, (m) => m)} → ${p.name} (${p.priceRange})`),
    '',
    'Salva questo reel e mandalo a chi vuole iniziare 👉',
    `💶 Budget totale: ${d.budgetTotal}`,
    `🔗 Link e guida completa: ${SITE_URL}/pack/${pack.slug}?src=${channel}`,
    '',
    'Le 5 cose per iniziare. Punto.',
    '',
    '#adv #affiliazione #mystarterpack #starterpack',
    `#${slugify(d.activity).replace(/-/g, '')} #${cat.slug.replace(/-/g, '')} #principianti #comeiniziare #consigliacquisti #amazonfinds #amazonitalia`,
    ...(d.tags || []).slice(0, 5).map((t) => `#${slugify(t).replace(/-/g, '')}`),
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Descrizione del Pin Pinterest: max 500 caratteri, disclosure inclusa. */
export function buildPinDescription(pack) {
  const MAX = 500;
  const d = pack.data;
  const url = `${SITE_URL}/pack/${pack.slug}?src=pin`;
  const tail = [`Guida completa e link: ${url}`, `#adv #affiliazione ${packHashtags(pack, 5).join(' ')}`];
  const hook = clamp(d.video?.hook || d.title, 120);
  const items = (d.products || []).slice(0, 5);
  const line = (p, i, per) => {
    const prefix = `${i + 1}. `;
    const price = ` ${p.priceRange}`;
    return prefix + clamp(`${p.role}: ${p.name}`, Math.max(14, per - prefix.length - price.length)) + price;
  };
  const budget = Math.max(1, MAX - tail.join('\n').length - hook.length - (items.length + 3));
  let per = Math.floor(budget / Math.max(1, items.length));
  let text = '';
  for (;;) {
    text = [hook, ...items.map((p, i) => line(p, i, per)), ...tail].join('\n');
    if (text.length <= MAX || per <= 18) break;
    per -= 2;
  }
  if (text.length > MAX) text = [hook, ...tail].join('\n');
  return text.length > MAX ? clamp(text, MAX) : text;
}

/** Caption breve per TikTok / YouTube Shorts: max 300 caratteri, con disclosure. */
export function buildShortCaption(pack, channel = 'tt') {
  const MAX = 300;
  const d = pack.data;
  const url = `${SITE_URL}/pack/${pack.slug}?src=${channel}`;
  const tail = `${url}\n#adv #affiliazione ${packHashtags(pack, 3).join(' ')}`;
  const head = clamp(d.video?.hook || d.title, 110);
  const budget = `Budget: ${d.budgetTotal}`;
  const roles = (d.products || []).map((p) => p.role.replace(/^(?:(?:le|la|il|lo|i|gli)\s+|l'\s*)/i, '')).join(' · ');
  const join = (...parts) => parts.filter(Boolean).join('\n');
  const room = MAX - head.length - budget.length - tail.length - 3;
  let mid = roles ? `Le 5 cose: ${roles}` : '';
  if (mid && mid.length > room) mid = room >= 28 ? clamp(mid, room) : '';
  const text = join(head, mid, budget, tail);
  return text.length > MAX ? join(clamp(head, Math.max(20, head.length - (text.length - MAX) - 1)), mid, budget, tail) : text;
}
