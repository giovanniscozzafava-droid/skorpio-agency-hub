export const SITE = {
  name: 'MyStarterPack',
  domain: 'mystarterpack.it',
  url: 'https://mystarterpack.it',
  tagline: 'Le 5 cose per iniziare. Punto.',
  description:
    'Per ogni attività, hobby o momento della vita: i 5 prodotti giusti per iniziare, scelti e spiegati. Senza liste infinite, senza sprechi.',
  instagram: 'https://instagram.com/mystarterpack.it',
  tiktok: 'https://tiktok.com/@mystarterpack.it',
  publisher: 'Fuyue Digital Agency',
  // Tag Amazon Associates Italia (formato: nome-21). Sovrascrivibile via env PUBLIC_AMAZON_TAG.
  amazonTag: import.meta.env.PUBLIC_AMAZON_TAG || 'mystarterpack-21',
};

/** Link affiliato Amazon.it: usa l'ASIN se presente, altrimenti una ricerca. */
export function amazonLink(p: { asin?: string; amazonQuery: string }): string {
  const tag = SITE.amazonTag;
  if (p.asin) return `https://www.amazon.it/dp/${p.asin}?tag=${tag}&linkCode=ll1`;
  const q = encodeURIComponent(p.amazonQuery);
  return `https://www.amazon.it/s?k=${q}&tag=${tag}&linkCode=ll2`;
}
