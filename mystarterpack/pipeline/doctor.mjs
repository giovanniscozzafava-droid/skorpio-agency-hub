#!/usr/bin/env node
/**
 * Controllo di prontezza della pipeline: dice cosa è configurato e cosa manca, e prova le API.
 * Uso: node doctor.mjs            (solo verifica delle variabili)
 *      node doctor.mjs --live     (prova davvero Gemini testo, Gemini TTS e Instagram)
 */
import fs from 'node:fs';
import path from 'node:path';
import { listPacks, AMAZON_TAG, SITE_URL, amazonTagFor } from './lib/packs.mjs';

const live = process.argv.includes('--live');
const ok = (s) => `✅ ${s}`, ko = (s) => `❌ ${s}`, warn = (s) => `⚠️  ${s}`;
const has = (k) => Boolean(process.env[k] && process.env[k].trim());
const mask = (k) => (has(k) ? `${process.env[k].slice(0, 4)}…${process.env[k].slice(-3)} (${process.env[k].length} car.)` : '');
const lines = [];
let blocking = 0;

function check(key, { required = false, what }) {
  if (has(key)) lines.push(ok(`${key} — ${what}: ${mask(key)}`));
  else { lines.push((required ? ko : warn)(`${key} mancante — ${what}`)); if (required) blocking++; }
}

lines.push('## Contenuti');
const packs = listPacks();
const pending = packs.filter((p) => p.data.video.status === 'pending').length;
lines.push(ok(`${packs.length} pack, ${pending} senza reel pubblicato`));
lines.push(ok(`Sito: ${SITE_URL} · tag Amazon: ${AMAZON_TAG}`));
for (const c of ['ig', 'tt', 'yt', 'pin', 'nl']) {
  const t = amazonTagFor(c);
  lines.push(t === AMAZON_TAG ? warn(`tag canale ${c}: usa quello generico (${t})`) : ok(`tag canale ${c}: ${t}`));
}

lines.push('\n## Generazione (testo, voce, immagini)');
const GEMINI_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY', 'GOOGLE_GENAI_API_KEY', 'GEMINI_API'];
const geminiKey = GEMINI_KEYS.find(has);
if (geminiKey) lines.push(ok(`${geminiKey} — Gemini: testi dei pack, voce dei reel, immagini prodotto: ${mask(geminiKey)}`));
else { lines.push(ko(`chiave Gemini mancante (cercata come: ${GEMINI_KEYS.join(', ')})`)); blocking++; }

lines.push('\n## Pubblicazione Instagram');
check('IG_USER_ID', { what: 'ID account Instagram Business' });
check('IG_ACCESS_TOKEN', { what: 'token Graph API (scade ogni 60 giorni)' });
check('SUPABASE_URL', { what: 'hosting pubblico del video per la Graph API' });
check('SUPABASE_SERVICE_ROLE_KEY', { what: 'upload del video nel bucket' });

lines.push('\n## Indicizzazione e newsletter');
check('INDEXNOW_KEY', { what: 'ping a Bing e ChatGPT Search dopo la pubblicazione' });
if (has('INDEXNOW_KEY')) {
  const f = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'site', 'public', `${process.env.INDEXNOW_KEY}.txt`);
  lines.push(fs.existsSync(f) ? ok('file di verifica IndexNow presente in site/public') : warn('manca il file di verifica: esegui node indexnow.mjs --write-key'));
}
check('RESEND_API_KEY', { what: 'newsletter (configurata su Vercel, non serve alla pipeline)' });

async function liveChecks() {
  lines.push('\n## Prove sulle API');
  if (!has('GEMINI_API_KEY')) { lines.push(ko('Gemini non provato: chiave assente')); return; }
  try {
    const { gemini, TEXT_MODEL } = await import('./lib/gemini.mjs');
    const r = await gemini().models.generateContent({ model: TEXT_MODEL, contents: 'Rispondi solo con: pronto' });
    lines.push(ok(`Gemini testo (${TEXT_MODEL}): "${(r.text || '').trim().slice(0, 20)}"`));
  } catch (e) { lines.push(ko(`Gemini testo: ${e.message}`)); blocking++; }
  try {
    const { synthesizeLine } = await import('./tts.mjs');
    const pcm = await synthesizeLine('Prova voce.', process.env.TTS_VOICE || 'Kore');
    lines.push(ok(`Gemini voce: ${(pcm.length / 2 / 24000).toFixed(1)} s di audio generati`));
  } catch (e) { lines.push(ko(`Gemini voce: ${e.message}`)); blocking++; }
  if (has('IG_USER_ID') && has('IG_ACCESS_TOKEN')) {
    try {
      const u = `https://graph.facebook.com/v21.0/${process.env.IG_USER_ID}?fields=username,followers_count&access_token=${process.env.IG_ACCESS_TOKEN}`;
      const j = await (await fetch(u)).json();
      lines.push(j.error ? ko(`Instagram: ${j.error.message}`) : ok(`Instagram: @${j.username}, ${j.followers_count ?? '?'} follower`));
    } catch (e) { lines.push(ko(`Instagram: ${e.message}`)); }
  }
}

if (live) await liveChecks();
console.log(lines.join('\n'));
console.log(blocking ? `\n${ko(`${blocking} ${blocking === 1 ? 'problema bloccante' : 'problemi bloccanti'}: il ciclo giornaliero non può girare. Vedi docs/SETUP.md`)}` : `\n${ok('Pipeline pronta a girare.')}`);
process.exit(blocking ? 1 : 0);
