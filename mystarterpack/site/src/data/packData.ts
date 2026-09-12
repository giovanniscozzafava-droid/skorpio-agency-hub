import categories from './categories.json';
import { SITE, amazonLink } from './site';

export type Category = { slug: string; name: string; emoji: string; tagline: string; color: string };

/** Categoria di un pack, con fallback se lo slug non è in elenco. */
export function categoryOf(slug: string): Category {
  return (
    (categories as Category[]).find((c) => c.slug === slug) ?? {
      slug,
      name: slug,
      emoji: '📦',
      tagline: '',
      color: '#1B1F3B',
    }
  );
}

export function packUrl(id: string): string {
  return `${SITE.url}/pack/${id}`;
}

/** Minuscola solo l'iniziale, così sigle e nomi propri restano intatti (PC, Nintendo Switch, IVA). */
export function lowerFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/\s+/)[0];
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const VERB_START = /^(?:[a-zà-ù]+)(?:are|ere|ire|arsi|ersi|irsi)$/i;

/**
 * Apertura della capsula: "Per andare al lavoro in bici…" se l'attività inizia con un verbo,
 * "Per iniziare con l'escursionismo…" (senza articolo forzato) negli altri casi.
 */
export function startPhrase(activity: string): string {
  const low = lowerFirst(activity);
  const first = low.split(/\s+/)[0] ?? '';
  return VERB_START.test(first) ? `Per ${low}` : `Per iniziare con ${low}`;
}

/** "le scarpe, lo zaino, i bastoncini, la giacca antipioggia e la sicurezza" */
export function rolesSentence(roles: string[]): string {
  const items = roles.map(lowerFirst);
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : text).trim().replace(/[.!?]+$/, '');
}

type FaqItem = { q: string; a: string };

/** La FAQ "Cosa NON comprare", se presente. */
export function notBuyFaq(faq: FaqItem[]): FaqItem | undefined {
  return faq.find((f) => /non\s+comprare/i.test(f.q));
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const FILLERS = [
  "Ogni prodotto copre un'esigenza diversa, senza doppioni.",
  'I prezzi sono fasce indicative su Amazon.it e cambiano spesso.',
  'Il pack è pensato per chi parte davvero da zero.',
];

type CapsuleInput = {
  activity: string;
  level: string;
  budgetTotal: string;
  products: { role: string }[];
  faq: FaqItem[];
};

/** Paragrafo sintetico (40-60 parole) usato nella answer capsule e in llms-full.txt. */
export function answerCapsule(d: CapsuleInput): string {
  const head = `${startPhrase(d.activity)} ti servono cinque cose: ${rolesSentence(d.products.map((p) => p.role))}.`;
  const meta = ` Budget totale indicativo: ${d.budgetTotal}. Livello: ${d.level}.`;
  const nb = notBuyFaq(d.faq);
  let notBuyItems = nb ? firstSentence(nb.a).split(/\s*,\s*/).filter(Boolean) : [];

  const assemble = (items: string[], extra: string[]) =>
    head + meta + (items.length ? ` Non ti serve: ${lowerFirst(items.join(', '))}.` : '') + extra.map((x) => ` ${x}`).join('');

  // Troppo lungo: accorcio la lista di cosa non serve, tenendone almeno due voci.
  let text = assemble(notBuyItems, []);
  while (countWords(text) > 60 && notBuyItems.length > 2) {
    notBuyItems = notBuyItems.slice(0, -1);
    text = assemble(notBuyItems, []);
  }
  // Troppo corto: aggiungo una frase di contesto alla volta.
  const extra: string[] = [];
  for (const f of FILLERS) {
    if (countWords(text) >= 40) break;
    extra.push(f);
    text = assemble(notBuyItems, extra);
  }
  return text;
}

export function parseBudget(budgetTotal: string): { min: number; max: number } {
  const nums = (budgetTotal.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  if (nums.length === 0) return { min: 0, max: 0 };
  return { min: nums[0], max: nums[nums.length - 1] };
}

export function euro(n: number): string {
  return `${Math.round(n)} €`;
}

export function itDate(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

type PackLike = { id: string; data: any };

/** Oggetto machine-readable condiviso da /packs.json e /pack/[slug].json. */
export function serializePack(p: PackLike) {
  const d = p.data;
  const cat = categoryOf(d.category);
  return {
    slug: p.id,
    url: packUrl(p.id),
    title: d.title,
    activity: d.activity,
    category: d.category,
    categoryName: cat.name,
    description: d.description,
    level: d.level,
    budgetTotal: d.budgetTotal,
    publishedAt: d.publishedAt.toISOString(),
    updatedAt: (d.updatedAt ?? d.publishedAt).toISOString(),
    products: d.products.map((x: any) => ({
      name: x.name,
      brand: x.brand,
      role: x.role,
      priceRange: x.priceRange,
      amazonUrl: amazonLink(x),
    })),
    faq: d.faq.map((f: FaqItem) => ({ q: f.q, a: f.a })),
    video: { hook: d.video.hook },
  };
}
