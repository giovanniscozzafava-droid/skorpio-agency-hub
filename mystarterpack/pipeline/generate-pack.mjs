#!/usr/bin/env node
/**
 * Genera un nuovo starter pack con Gemini (testo) e lo salva in site/src/content/packs/<slug>.md.
 * Uso: node generate-pack.mjs                       → prende il primo argomento della coda (topics.json) non ancora pubblicato
 *      node generate-pack.mjs --topic "Apicoltura" --category giardino-faidate [--slug apicoltura]
 * Richiede GEMINI_API_KEY. Le regole editoriali sono in docs/WRITER-BRIEF.md e vengono passate al modello.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gemini, TEXT_MODEL } from './lib/gemini.mjs';
import { CATEGORIES, ROOT, packExists, slugify, validatePack, writePack, listPacks } from './lib/packs.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const here = path.dirname(new URL(import.meta.url).pathname);

export function nextTopic() {
  const queue = JSON.parse(fs.readFileSync(path.join(here, 'topics.json'), 'utf8'));
  for (const t of queue) { const s = t.slug || slugify(t.topic); if (!packExists(s)) return { ...t, slug: s }; }
  return null;
}

const SCHEMA = {
  type: 'object', required: ['title', 'activity', 'emoji', 'description', 'level', 'budgetTotal', 'tags', 'products', 'video', 'faq', 'body'],
  properties: {
    title: { type: 'string' }, activity: { type: 'string' }, emoji: { type: 'string' }, description: { type: 'string' },
    level: { type: 'string', enum: ['principiante', 'intermedio'] }, budgetTotal: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    products: { type: 'array', items: { type: 'object', required: ['name', 'brand', 'role', 'why', 'priceRange', 'amazonQuery', 'pros', 'cons', 'tip'],
      properties: { name: { type: 'string' }, brand: { type: 'string' }, role: { type: 'string' }, why: { type: 'string' }, priceRange: { type: 'string' }, amazonQuery: { type: 'string' },
        pros: { type: 'array', items: { type: 'string' } }, cons: { type: 'array', items: { type: 'string' } }, tip: { type: 'string' } } } },
    video: { type: 'object', required: ['hook', 'script'], properties: { hook: { type: 'string' }, script: { type: 'array', items: { type: 'string' } } } },
    faq: { type: 'array', items: { type: 'object', required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } } },
    body: { type: 'string' },
  },
};

export async function generatePack({ topic, category, slug }) {
  slug ||= slugify(topic);
  if (packExists(slug)) throw new Error(`esiste già: ${slug}`);
  const cat = CATEGORIES.find((c) => c.slug === category);
  if (!cat) throw new Error(`categoria sconosciuta: ${category}`);
  const brief = fs.readFileSync(path.join(ROOT, 'docs', 'WRITER-BRIEF.md'), 'utf8');
  const example = fs.readFileSync(path.join(ROOT, 'site', 'src', 'content', 'packs', 'escursionismo.md'), 'utf8');
  const existing = listPacks().map((p) => p.data.activity).join(', ');
  const prompt = `Sei il redattore di MyStarterPack.it. Scrivi lo starter pack per l'attività: "${topic}" (categoria ${cat.name}, slug ${slug}).

REGOLE EDITORIALI (vincolanti):
${brief}

ESEMPIO DI RIFERIMENTO (stesso livello di qualità e concretezza; NON copiare i prodotti):
${example}

Pack già pubblicati (non duplicare l'attività): ${existing}

Rispondi SOLO con un JSON che rispetta lo schema fornito. Il campo "body" è il markdown del corpo (250-450 parole) con le sezioni "## Perché proprio questi 5", "## Come usare il pack ..." e "## Il prossimo passo". Nel campo video.script: 6 righe, numeri in lettere, nessuna cifra. description: 60-200 caratteri.`;
  const ai = gemini();
  const res = await ai.models.generateContent({ model: TEXT_MODEL, contents: prompt, config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.8 } });
  const j = JSON.parse(res.text);
  const data = {
    title: j.title, activity: j.activity || topic, category: cat.slug, emoji: j.emoji, description: j.description, level: j.level || 'principiante',
    budgetTotal: j.budgetTotal, publishedAt: new Date().toISOString().slice(0, 10), tags: j.tags?.slice(0, 6) || [],
    products: j.products.slice(0, 5).map((p) => ({ name: p.name, brand: p.brand || 'Vari', role: p.role, why: p.why, priceRange: p.priceRange, amazonQuery: p.amazonQuery, asin: '', pros: p.pros.slice(0, 4), cons: (p.cons || []).slice(0, 3), tip: p.tip || '' })),
    video: { hook: j.video.hook, script: j.video.script.slice(0, 8), status: 'pending' },
    faq: j.faq.slice(0, 4),
  };
  data.video.script = data.video.script.map((l) => l.replace(/\d+/g, (n) => numToWords(Number(n))));
  const errors = validatePack(data);
  if (errors.length) throw new Error('pack non valido:\n- ' + errors.join('\n- '));
  const file = writePack(slug, data, j.body);
  return { slug, file, data };
}

const UNITS = ['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici','tredici','quattordici','quindici','sedici','diciassette','diciotto','diciannove'];
const TENS = ['','','venti','trenta','quaranta','cinquanta','sessanta','settanta','ottanta','novanta'];
export function numToWords(n) {
  if (n < 20) return UNITS[n];
  if (n < 100) { const t = TENS[Math.floor(n / 10)], u = n % 10; if (u === 0) return t; if (u === 1 || u === 8) return t.slice(0, -1) + UNITS[u]; return t + UNITS[u]; }
  if (n < 1000) { const h = Math.floor(n / 100), r = n % 100; return (h === 1 ? 'cento' : UNITS[h] + 'cento') + (r ? numToWords(r) : ''); }
  if (n < 1000000) { const k = Math.floor(n / 1000), r = n % 1000; return (k === 1 ? 'mille' : numToWords(k) + 'mila') + (r ? numToWords(r) : ''); }
  return String(n);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const topic = opt('--topic');
  const job = topic ? { topic, category: opt('--category'), slug: opt('--slug') } : nextTopic();
  if (!job) { console.log('Coda vuota: aggiungi argomenti a pipeline/topics.json'); process.exit(0); }
  if (!job.category) { console.error('--category obbligatoria'); process.exit(1); }
  generatePack(job).then((r) => console.log(`✅ ${r.file}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
