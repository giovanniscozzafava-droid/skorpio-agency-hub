#!/usr/bin/env node
/**
 * Voce con Gemini 2.5 TTS. Un file WAV per riga di script + timing.json.
 * Uso: node tts.mjs <slug> [--voice Kore] [--silent]
 * --silent: nessuna chiamata API, genera silenzio con durata stimata (solo per test del render).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPack, outDir, categoryOf } from './lib/packs.mjs';
import { pcmToWav, silence, pcmDuration, SAMPLE_RATE } from './lib/wav.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('uso: node tts.mjs <slug> [--voice Kore] [--silent]'); process.exit(1); }
const silent = args.includes('--silent');
const voiceArg = args[args.indexOf('--voice') + 1];

const ENERGETIC = new Set(['sport-outdoor', 'fitness-corpo', 'gaming-streaming', 'auto-moto-bici']);

/** Override opzionale per i format alternativi ("Non comprare questo", "Quanto costa iniziare", "Starter pack di [persona]"):
 *  out/<slug>/override.json = { "format": "quanto-costa", "hook": "...", "script": ["...", ...], "voice": "Kore" } */
export function loadOverride(slug) {
  const f = path.join(outDir(slug), 'override.json');
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; } catch { return {}; }
}

export async function synthesizeLine(text, voice) {
  const { gemini, TTS_MODELS } = await import('./lib/gemini.mjs');
  const ai = gemini();
  let lastErr;
  for (const model of TTS_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `Leggi in italiano, con tono naturale, chiaro e leggermente energico, come un creator che spiega a un amico. Non aggiungere nulla:\n${text}` }] }],
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('nessun audio nella risposta');
      return Buffer.from(part.inlineData.data, 'base64'); // PCM s16le 24kHz mono
    } catch (err) { lastErr = err; console.warn(`TTS ${model} fallito: ${err.message}`); }
  }
  throw lastErr;
}

export async function ttsForPack(slug, { voice, silent = false } = {}) {
  const pack = readPack(slug);
  const cat = categoryOf(pack);
  const override = loadOverride(slug);
  voice ||= override.voice || process.env.TTS_VOICE || (ENERGETIC.has(cat.slug) ? 'Puck' : 'Kore');
  const dir = path.join(outDir(slug), 'audio'); fs.mkdirSync(dir, { recursive: true });
  const lines = [override.hook || pack.data.video.hook, ...(override.script || pack.data.video.script)];
  const timing = [];
  let t = 0;
  for (const [i, text] of lines.entries()) {
    const name = i === 0 ? '00-hook' : String(i).padStart(2, '0') + (i === lines.length - 1 ? '-outro' : `-p${i}`);
    let pcm;
    if (silent) pcm = silence(Math.max(2.5, text.split(/\s+/).length / 2.6)); // ~2.6 parole/secondo
    else pcm = await synthesizeLine(text, voice);
    fs.writeFileSync(path.join(dir, `${name}.wav`), pcmToWav(pcm));
    const dur = pcmDuration(pcm);
    timing.push({ index: i, name, text, start: t, duration: dur });
    t += dur + (i === 0 ? 0.6 : 0.45);
    console.log(`🎙  ${name} ${dur.toFixed(2)}s`);
  }
  const meta = { slug, voice, silent, sampleRate: SAMPLE_RATE, total: t, lines: timing };
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(meta, null, 2));
  return meta;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  ttsForPack(slug, { voice: voiceArg, silent }).then((m) => console.log(`✅ audio ${m.total.toFixed(1)}s (${m.voice}${m.silent ? ', silent' : ''})`)).catch((e) => { console.error(e); process.exit(1); });
}
