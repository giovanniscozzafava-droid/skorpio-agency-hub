import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../data/site';
export async function GET(context: { site: URL }) {
  const packs = (await getCollection('packs')).sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());
  return rss({ title: SITE.name, description: SITE.description, site: context.site,
    items: packs.map((p) => ({ title: p.data.title, description: p.data.description, pubDate: p.data.publishedAt, link: `/pack/${p.id}` })) });
}
