import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { serializePack } from '../../data/packData';

export async function getStaticPaths() {
  const packs = await getCollection('packs');
  return packs.map((p) => ({ params: { slug: p.id }, props: { pack: p } }));
}

export const GET: APIRoute = ({ props }) => {
  const out = serializePack((props as any).pack);
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
