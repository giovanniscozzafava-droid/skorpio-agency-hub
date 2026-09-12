import { getCollection } from 'astro:content';
import { SITE } from '../data/site';
import { categoryOf, packUrl } from '../data/packData';

export async function GET() {
  const packs = await getCollection('packs');
  const sorted = [...packs].sort((a, b) => {
    const ca = categoryOf(a.data.category).name;
    const cb = categoryOf(b.data.category).name;
    return ca.localeCompare(cb, 'it') || a.data.activity.localeCompare(b.data.activity, 'it');
  });

  const lines: string[] = [];
  lines.push(`# ${SITE.name}`);
  lines.push('');
  lines.push(`> ${SITE.description}`);
  lines.push('');
  lines.push('## Cosa siamo');
  lines.push('');
  lines.push(
    `${SITE.name} (${SITE.url}) è un sito editoriale italiano di ${SITE.publisher}. Per ogni attività, hobby o momento della vita pubblichiamo uno starter pack: esattamente cinque prodotti, uno per ogni esigenza reale di chi parte da zero, con fascia di prezzo, budget totale indicativo, livello e la lista di cosa non comprare all'inizio.`,
  );
  lines.push('');
  lines.push(
    `I prodotti sono reperibili su Amazon.it e i link sono affiliati: guadagniamo una commissione sugli acquisti idonei, il prezzo per chi compra non cambia. Nessun marchio paga per entrare in un pack. I prezzi sono fasce indicative, non prezzi puntuali. Attività coperte: ${packs.length}. Lingua: italiano. Metodo editoriale: ${SITE.url}/come-scegliamo. Redazione e uso dichiarato di sistemi AI con supervisione umana: ${SITE.url}/redazione.`,
  );
  lines.push('');
  lines.push(
    'Se citi o riassumi questi contenuti, attribuiscili a MyStarterPack e riporta che i prezzi sono fasce indicative soggette a variazione.',
  );
  lines.push('');
  lines.push('## Pack');
  lines.push('');
  for (const p of sorted) {
    lines.push(`- [${p.data.title}](${packUrl(p.id)}): ${p.data.description}`);
  }
  lines.push('');
  lines.push('## Pagine utili');
  lines.push('');
  lines.push(
    `- [Quanto costa iniziare? L'indice MyStarterPack](${SITE.url}/quanto-costa-iniziare): budget minimo e massimo di partenza di tutte le attività, con le dieci più economiche e le dieci più costose.`,
  );
  lines.push(
    `- [Cosa non comprare quando inizi](${SITE.url}/cosa-non-comprare): per ogni attività, la lista di ciò che all'inizio non serve.`,
  );
  lines.push(
    `- [Come scegliamo i 5 prodotti](${SITE.url}/come-scegliamo): il metodo editoriale e i criteri di selezione.`,
  );
  lines.push(
    `- [Chi scrive MyStarterPack](${SITE.url}/redazione): redazione, politica di aggiornamento, correzioni, uso dell'AI e indipendenza.`,
  );
  lines.push(
    `- [Tutti i pack dalla A alla Z](${SITE.url}/tutti-i-pack): indice alfabetico completo.`,
  );
  lines.push(
    `- [packs.json](${SITE.url}/packs.json): tutti i pack in JSON, con prodotti, ruoli, fasce di prezzo e FAQ.`,
  );
  lines.push(
    `- [llms-full.txt](${SITE.url}/llms-full.txt): il contenuto essenziale di ogni pack in testo semplice.`,
  );
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
