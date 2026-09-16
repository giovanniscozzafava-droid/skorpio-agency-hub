import { getCollection } from 'astro:content';
import { SITE, amazonLink } from '../data/site';
import { answerCapsule, categoryOf, packUrl, itDate } from '../data/packData';

export async function GET() {
  const packs = await getCollection('packs');
  const sorted = [...packs].sort((a, b) => a.data.activity.localeCompare(b.data.activity, 'it'));

  const out: string[] = [];
  out.push(`# ${SITE.name} - contenuto completo`);
  out.push('');
  out.push(`> ${SITE.description}`);
  out.push('');
  out.push(
    `Sito: ${SITE.url}. Editore: ${SITE.publisher}. Lingua: italiano. Pack disponibili: ${packs.length}. I link ad Amazon.it sono affiliati; i prezzi sono fasce indicative e possono variare. Metodo: ${SITE.url}/come-scegliamo. Redazione: ${SITE.url}/redazione.`,
  );
  out.push('');

  for (const p of sorted) {
    const d = p.data;
    const cat = categoryOf(d.category);
    const modified = d.updatedAt ?? d.publishedAt;
    out.push('---');
    out.push('');
    out.push(`## ${d.title}`);
    out.push('');
    out.push(`URL: ${packUrl(p.id)}`);
    out.push(`Attività: ${d.activity}`);
    out.push(`Categoria: ${cat.name}`);
    out.push(`Livello: ${d.level}`);
    out.push(`Budget totale indicativo: ${d.budgetTotal}`);
    out.push(`Aggiornato: ${itDate(modified)}`);
    out.push('');
    out.push('### In breve');
    out.push('');
    out.push(answerCapsule(d));
    out.push('');
    out.push('### I 5 prodotti');
    out.push('');
    d.products.forEach((x, i) => {
      out.push(`${i + 1}. ${x.role}: ${x.name}${x.brand && x.brand !== 'Vari' ? ` (${x.brand})` : ''} - ${x.priceRange}`);
      out.push(`   Perché: ${x.why}`);
      out.push(`   Link: ${amazonLink(x)}`);
    });
    out.push('');
    if (d.faq.length > 0) {
      out.push('### Domande frequenti');
      out.push('');
      for (const f of d.faq) {
        out.push(`D: ${f.q}`);
        out.push(`R: ${f.a}`);
        out.push('');
      }
    }
  }

  return new Response(out.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
