#!/usr/bin/env node
/**
 * Immagini prodotto (PNG scontornato, stile brand) per i reel e le schede.
 * Ordine di preferenza: 1) PNG già presenti in site/public/images/products/<slug>/<n>.png (es. da Amazon PA-API o forniti a mano)
 *                       2) generazione con Gemini image (illustrazione realistica "packshot" su fondo bianco, poi sfondo rimosso via soglia).
 * Uso: node product-image.mjs <slug> [--force]
 * NOTA: le immagini generate sono packshot illustrativi, non foto ufficiali; l'enrichment con PA-API (docs/SETUP.md) le sostituisce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPack, SITE_DIR } from './lib/packs.mjs';
import { gemini, IMAGE_MODEL } from './lib/gemini.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('uso: node product-image.mjs <slug> [--force]'); process.exit(1); }
const force = args.includes('--force');

async function generateOne(p, out) {
  const ai = gemini();
  const prompt = `Packshot fotorealistico di un prodotto: ${p.name}${p.brand && p.brand !== 'Vari' ? ` del marchio ${p.brand}` : ''} (${p.role.toLowerCase()}). Oggetto singolo, centrato, intero, visto di tre quarti, su sfondo bianco puro uniforme, luce da studio morbida, nessun testo, nessun logo inventato, nessuna persona, nessuna ombra dura. Stile catalogo e-commerce.`;
  const res = await ai.models.generateContent({ model: IMAGE_MODEL, contents: prompt, config: { responseModalities: ['IMAGE'] } });
  const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
  if (!part) throw new Error('nessuna immagine nella risposta');
  fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
}

const pack = readPack(slug);
const dir = path.join(SITE_DIR, 'public', 'images', 'products', slug); fs.mkdirSync(dir, { recursive: true });
for (const [i, p] of pack.data.products.entries()) {
  const out = path.join(dir, `${i + 1}.png`);
  if (fs.existsSync(out) && !force) { console.log(`↩︎  ${i + 1}.png presente`); continue; }
  try { await generateOne(p, out); console.log(`🖼  ${i + 1}.png generata (${p.name})`); }
  catch (e) { console.warn(`⚠️  ${i + 1}: ${e.message} (nel reel verrà usata l'emoji)`); }
}
