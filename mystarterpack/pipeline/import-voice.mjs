#!/usr/bin/env node
/**
 * Importa una traccia voce prodotta fuori dalla pipeline (ElevenLabs, vidIQ, una voce registrata,
 * un export dal Mac) e la trasforma in quello che serve al renderer: un file per riga + timing.json.
 * Serve quando GEMINI_API_KEY non è disponibile o quando si vuole una voce specifica.
 *
 * Uso: node import-voice.mjs <slug> <file audio o URL> [--split silence|proporzionale]
 * Il file deve contenere, nell'ordine, l'hook e le righe di video.script separate da una pausa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { readPack, outDir } from './lib/packs.mjs';
import { pcmToWav, SAMPLE_RATE } from './lib/wav.mjs';
import { loadOverride } from './tts.mjs';

const args = process.argv.slice(2);
const [slug, source] = args.filter((a) => !a.startsWith('--'));
if (!slug || !source) { console.error('uso: node import-voice.mjs <slug> <file.mp3|URL> [--split silence|proporzionale]'); process.exit(1); }
const mode = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'silence';

const ff = (...a) => execFileSync(ffmpegPath, a, { stdio: ['ignore', 'pipe', 'pipe'] });

/** Intervalli di silenzio nella traccia, in secondi. */
function silences(wav, noiseDb = -33, minDur = 0.22) {
  let out = '';
  try { ff('-hide_banner', '-i', wav, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'); }
  catch (e) { out = String(e.stderr || ''); }
  const res = [];
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) res.push({ start: starts[i], end: ends[i], dur: ends[i] - starts[i] });
  return res;
}

async function fetchIfUrl(src, dir) {
  if (!/^https?:\/\//.test(src)) return src;
  const dest = path.join(dir, 'voice-source' + (src.includes('.wav') ? '.wav' : '.mp3'));
  const res = await fetch(src);
  if (!res.ok) throw new Error(`download fallito: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`⬇️  scaricato ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
  return dest;
}

async function main() {
  const pack = readPack(slug);
  const ov = loadOverride(slug);
  const lines = [ov.hook || pack.data.video.hook, ...(ov.script || pack.data.video.script)];
  const dir = path.join(outDir(slug), 'audio'); fs.mkdirSync(dir, { recursive: true });

  const src = await fetchIfUrl(source, outDir(slug));
  const norm = path.join(dir, 'voice-full.wav');
  ff('-y', '-i', src, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', norm);
  const pcm = fs.readFileSync(norm).subarray(44);
  const total = pcm.length / 2 / SAMPLE_RATE;
  console.log(`🎧 traccia: ${total.toFixed(1)}s, ${lines.length} righe da ricavare`);

  // Confini tra una riga e l'altra: i silenzi più lunghi, in ordine di tempo.
  let cuts = [];
  const sil = silences(norm).filter((s) => s.start > 0.3 && s.end < total - 0.3);
  if (mode !== 'proporzionale' && sil.length >= lines.length - 1) {
    cuts = sil.sort((a, b) => b.dur - a.dur).slice(0, lines.length - 1).sort((a, b) => a.start - b.start);
    console.log(`✂️  ${cuts.length} pause usate come confini (silenzi trovati: ${sil.length})`);
  } else {
    const chars = lines.map((l) => l.length); const sum = chars.reduce((a, b) => a + b, 0);
    let t = 0;
    cuts = chars.slice(0, -1).map((c) => { t += (c / sum) * total; return { start: t, end: t, dur: 0 }; });
    console.log(`✂️  divisione proporzionale ai caratteri (silenzi trovati: ${sil.length}, insufficienti)`);
  }

  const bounds = [{ from: 0 }, ...cuts.map((c) => ({ from: c.end, cutAt: c.start }))];
  const timing = [];
  for (let i = 0; i < lines.length; i++) {
    const start = bounds[i].from;
    const end = i < cuts.length ? cuts[i].start : total;
    const name = i === 0 ? '00-hook' : String(i).padStart(2, '0') + (i === lines.length - 1 ? '-outro' : `-p${i}`);
    const slice = pcm.subarray(Math.round(start * SAMPLE_RATE) * 2, Math.round(end * SAMPLE_RATE) * 2);
    fs.writeFileSync(path.join(dir, `${name}.wav`), pcmToWav(slice));
    timing.push({ index: i, name, text: lines[i], start, duration: Math.max(0.3, end - start) });
    console.log(`   ${name} ${start.toFixed(2)}s → ${end.toFixed(2)}s (${(end - start).toFixed(2)}s)`);
  }
  const meta = { slug, voice: 'esterna', silent: false, source: path.basename(src), sampleRate: SAMPLE_RATE, total: total + 0.4, lines: timing };
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(meta, null, 2));
  console.log(`✅ timing.json pronto: ora esegui node render-video.mjs ${slug}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
