#!/usr/bin/env node
/**
 * Pubblica il reel su Instagram (Graph API, Content Publishing) e aggiorna il pack.
 * Uso: node publish-instagram.mjs <slug> [--dry-run]
 * Env: IG_USER_ID, IG_ACCESS_TOKEN (long-lived, permessi instagram_business_content_publish),
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (hosting pubblico del video, bucket "mystarterpack") oppure VIDEO_PUBLIC_URL.
 * Facoltativo: TIKTOK_* non gestito qui (vedi docs/SETUP.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPack, writePack, outDir, buildCaption } from './lib/packs.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run');
if (!slug) { console.error('uso: node publish-instagram.mjs <slug> [--dry-run]'); process.exit(1); }
const GRAPH = 'https://graph.facebook.com/v21.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hostVideo(slug, file, cover) {
  if (process.env.VIDEO_PUBLIC_URL) return { videoUrl: process.env.VIDEO_PUBLIC_URL, coverUrl: process.env.COVER_PUBLIC_URL };
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Serve SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o VIDEO_PUBLIC_URL) per ospitare il video');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key);
  const bucket = process.env.SUPABASE_BUCKET || 'mystarterpack';
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === bucket)) await sb.storage.createBucket(bucket, { public: true, fileSizeLimit: '200MB' });
  const stamp = Date.now();
  const up = async (name, p, type) => {
    const { error } = await sb.storage.from(bucket).upload(name, fs.readFileSync(p), { contentType: type, upsert: true });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(name).data.publicUrl;
  };
  return { videoUrl: await up(`reels/${slug}-${stamp}.mp4`, file, 'video/mp4'), coverUrl: cover ? await up(`covers/${slug}-${stamp}.jpg`, cover, 'image/jpeg') : undefined };
}

async function graph(pathname, params, method = 'POST') {
  const token = process.env.IG_ACCESS_TOKEN;
  const u = new URL(`${GRAPH}/${pathname}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET' ? await fetch(`${u}?${body}`) : await fetch(u, { method, body });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Graph API ${pathname}: ${JSON.stringify(j.error || j)}`);
  return j;
}

export async function publishReel(slug, { dry = false } = {}) {
  const pack = readPack(slug); const dir = outDir(slug);
  const mp4 = path.join(dir, 'reel.mp4'); const cover = path.join(dir, 'cover.jpg');
  if (!fs.existsSync(mp4)) throw new Error(`manca ${mp4}: esegui prima render-video.mjs`);
  const caption = fs.existsSync(path.join(dir, 'caption.txt')) ? fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8') : buildCaption(pack);
  if (dry) { console.log('[dry-run] caption:\n' + caption); return { dry: true }; }
  const igUser = process.env.IG_USER_ID;
  if (!igUser || !process.env.IG_ACCESS_TOKEN) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN mancanti (docs/SETUP.md, sezione Instagram)');
  const { videoUrl, coverUrl } = await hostVideo(slug, mp4, fs.existsSync(cover) ? cover : null);
  console.log(`☁️  video: ${videoUrl}`);
  const container = await graph(`${igUser}/media`, { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true', ...(coverUrl ? { cover_url: coverUrl } : {}) });
  for (let i = 0; i < 40; i++) {
    const st = await graph(container.id, { fields: 'status_code,status' }, 'GET');
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error(`container in errore: ${st.status}`);
    await sleep(15000);
  }
  const pub = await graph(`${igUser}/media_publish`, { creation_id: container.id });
  const media = await graph(pub.id, { fields: 'permalink' }, 'GET');
  pack.data.video.status = 'published'; pack.data.video.instagramUrl = media.permalink; pack.data.updatedAt = new Date().toISOString().slice(0, 10);
  writePack(slug, pack.data, pack.content);
  console.log(`✅ pubblicato: ${media.permalink}`);
  return { id: pub.id, permalink: media.permalink };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  publishReel(slug, { dry }).catch((e) => { console.error(e.message); process.exit(1); });
}
