import { getCollection } from 'astro:content';
import categories from '../data/categories.json';
export async function GET() {
  const packs = await getCollection('packs');
  const out = packs.map((p) => ({ slug: p.id, activity: p.data.activity, title: p.data.title, description: p.data.description, emoji: p.data.emoji, budget: p.data.budgetTotal, tags: p.data.tags,
    category: p.data.category, categoryName: categories.find((c) => c.slug === p.data.category)?.name ?? p.data.category, products: p.data.products.map((x) => x.name) }));
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
}
