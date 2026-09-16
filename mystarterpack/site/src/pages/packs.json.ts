import { getCollection } from 'astro:content';
import { serializePack } from '../data/packData';

export async function GET() {
  const packs = await getCollection('packs');
  const out = packs
    .map(serializePack)
    .sort((a, b) => a.activity.localeCompare(b.activity, 'it'));
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
