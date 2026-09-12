#!/usr/bin/env node
/**
 * Reel 1080x1920 in motion graphics: HTML → frame per frame con Chromium → MP4 con ffmpeg.
 * Uso: node render-video.mjs <slug> [--fps 30] [--silent]   (--silent usa audio muto se manca GEMINI_API_KEY)
 * Output: out/<slug>/reel.mp4, cover.jpg, caption.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { readPack, outDir, categoryOf, buildCaption, SITE_DIR } from './lib/packs.mjs';
import { wavToPcm, pcmToWav, silence } from './lib/wav.mjs';
import { ttsForPack } from './tts.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) { console.error('uso: node render-video.mjs <slug> [--fps 30] [--silent]'); process.exit(1); }
const fps = Number(args[args.indexOf('--fps') + 1]) || 30;
const silent = args.includes('--silent') || !process.env.GEMINI_API_KEY;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const here = path.dirname(new URL(import.meta.url).pathname);
const MARK = 'file://' + path.join(here, '..', 'brand', 'logo', 'logo-mark-negative.svg');

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { const d = fs.readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().pop(); if (d) return path.join(base, d, 'chrome-linux', 'chrome'); } catch {}
  return undefined; // playwright-core cercherà il browser del sistema (channel)
}

function productImage(pack, i) {
  const p = pack.data.products[i];
  const candidates = [p.image, `/images/products/${pack.slug}/${i + 1}.png`].filter(Boolean);
  for (const c of candidates) { const abs = path.join(SITE_DIR, 'public', c); if (fs.existsSync(abs)) return 'file://' + abs; }
  return null;
}

function buildHtml(pack, timing) {
  const d = pack.data; const cat = categoryOf(pack);
  const L = timing.lines; const total = timing.total + 0.3;
  const scene = (i) => `--t0:${L[i].start.toFixed(3)}s;--dur:${(L[i].duration + (i === 0 ? 0.6 : 0.45)).toFixed(3)}s`;
  const cap = (t) => `<div class="caption"><span>${esc(t)}</span></div>`;
  const hookSub = `${d.activity} · ${d.products.length} prodotti · ${esc(d.budgetTotal)}`;
  let html = `<div class="progress"><i style="--total:${total.toFixed(3)}s"></i></div>`;
  html += `<section class="scene hook" style="${scene(0)}"><div class="quincunx"></div><div class="brand display"><img class="mark" src="${MARK}" alt="">my<b>starterpack</b><i>.</i></div><div class="emoji">${d.emoji}</div><h1 class="display">${esc(d.video.hook).replace(/(\d+|cinque|5)/i, '<em>$1</em>')}</h1><div class="sub">${hookSub}</div></section>`;
  d.products.forEach((p, i) => {
    const img = productImage(pack, i);
    html += `<section class="scene product" style="${scene(i + 1)};--tint:${cat.color}"><div class="top"><div class="pic">${img ? `<img src="${img}" alt="">` : `<span>${d.emoji}</span>`}</div><div class="chip display">${i + 1}</div><div class="counter display">${i + 1} / 5</div></div><div class="body"><div class="role display">${esc(p.role)}</div><h2 class="display">${esc(p.name)}</h2><div class="why">${esc(p.why.split(/(?<=[.!?])\s/)[0])}</div></div><div class="price display">${esc(p.priceRange)}</div>${cap(L[i + 1].text)}</section>`;
  });
  const last = L.length - 1;
  html += `<section class="scene outro" style="${scene(last)}"><div class="quincunx"></div><div class="brand display"><img class="mark" src="${MARK}" alt="">my<b>starterpack</b><i>.</i></div><div class="label">Budget totale</div><div class="total display">${esc(d.budgetTotal)}</div><ol>${d.products.map((p, i) => `<li style="--i:${i}"><b class="display">${i + 1}</b>${esc(p.role)} · ${esc(p.name)}</li>`).join('')}</ol><div class="url display">mystarterpack<i>.</i>it<small>/pack/${pack.slug}</small></div><div class="claim display">Le 5 cose per iniziare. Punto.</div></section>`;
  const tpl = fs.readFileSync(path.join(here, 'templates', 'reel.html'), 'utf8');
  return { html: tpl.replace('<!--SCENES-->', html), total };
}

function mixAudio(dir, timing) {
  const chunks = []; let cursor = 0;
  for (const l of timing.lines) {
    if (l.start > cursor) { chunks.push(silence(l.start - cursor)); cursor = l.start; }
    const pcm = wavToPcm(fs.readFileSync(path.join(dir, 'audio', `${l.name}.wav`)));
    chunks.push(pcm); cursor += l.duration;
  }
  chunks.push(silence(0.5));
  const out = path.join(dir, 'voice.wav'); fs.writeFileSync(out, pcmToWav(Buffer.concat(chunks))); return out;
}

async function main() {
  const pack = readPack(slug); const dir = outDir(slug);
  let timing;
  const timingFile = path.join(dir, 'audio', 'timing.json');
  if (fs.existsSync(timingFile) && !args.includes('--retts')) timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
  else timing = await ttsForPack(slug, { silent });
  const { html, total } = buildHtml(pack, timing);
  fs.writeFileSync(path.join(dir, 'reel.html'), html);
  const framesDir = path.join(dir, 'frames'); fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir);

  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(dir, 'reel.html'));
  await page.waitForFunction('window.__ready === true');
  await page.evaluate(() => document.fonts.ready);
  const nFrames = Math.ceil(total * fps);
  console.log(`🎬 ${nFrames} frame a ${fps} fps (${total.toFixed(1)}s)`);
  for (let f = 0; f < nFrames; f++) {
    await page.evaluate((ms) => window.__setTime(ms), (f / fps) * 1000);
    await page.screenshot({ path: path.join(framesDir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
    if (f % (fps * 5) === 0) process.stdout.write(`  ${Math.round((f / nFrames) * 100)}%\r`);
  }
  // Cover: metà della prima scena prodotto
  await page.evaluate((ms) => window.__setTime(ms), (timing.lines[1].start + 1.2) * 1000);
  await page.screenshot({ path: path.join(dir, 'cover.jpg'), type: 'jpeg', quality: 92 });
  await browser.close();

  const voice = mixAudio(dir, timing);
  const mp4 = path.join(dir, 'reel.mp4');
  execFileSync(ffmpegPath, ['-y', '-framerate', String(fps), '-i', path.join(framesDir, '%05d.jpg'), '-i', voice, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', mp4], { stdio: 'pipe' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'caption.txt'), buildCaption(pack));
  const size = (fs.statSync(mp4).size / 1e6).toFixed(1);
  console.log(`✅ ${mp4} (${size} MB, ${total.toFixed(1)}s) + cover.jpg + caption.txt`);
}
main().catch((e) => { console.error(e); process.exit(1); });
