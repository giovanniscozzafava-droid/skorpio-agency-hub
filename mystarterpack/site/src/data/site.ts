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
  email: 'ciao@mystarterpack.it',
  // Tag Amazon Associates Italia (formato: nome-21). Sovrascrivibile via env PUBLIC_AMAZON_TAG.
  amazonTag: import.meta.env.PUBLIC_AMAZON_TAG || 'mystarterpack-21',
};

/** Canali di attribuzione usati dai link /go/. */
export const AMAZON_CHANNELS = ['web', 'ig', 'tt', 'yt', 'pin', 'nl'] as const;
export type AmazonChannel = (typeof AMAZON_CHANNELS)[number];

// Gli accessi a import.meta.env devono essere letterali: vengono sostituiti in build.
const CHANNEL_TAGS: Record<string, string | undefined> = {
  web: import.meta.env.PUBLIC_AMAZON_TAG_WEB,
  ig: import.meta.env.PUBLIC_AMAZON_TAG_IG,
  tt: import.meta.env.PUBLIC_AMAZON_TAG_TT,
  yt: import.meta.env.PUBLIC_AMAZON_TAG_YT,
  pin: import.meta.env.PUBLIC_AMAZON_TAG_PIN,
  nl: import.meta.env.PUBLIC_AMAZON_TAG_NL,
};

/** Tag affiliato del canale richiesto, con fallback al tag generale del sito. */
export function amazonTagFor(channel: string): string {
  const key = String(channel || '').toLowerCase();
  return CHANNEL_TAGS[key] || SITE.amazonTag;
}

/** Link affiliato Amazon.it: usa l'ASIN se presente, altrimenti una ricerca. */
export function amazonLink(p: { asin?: string; amazonQuery: string }, tag: string = SITE.amazonTag): string {
  if (p.asin) return `https://www.amazon.it/dp/${p.asin}?tag=${tag}&linkCode=ll1`;
  const q = encodeURIComponent(p.amazonQuery);
  return `https://www.amazon.it/s?k=${q}&tag=${tag}&linkCode=ll2`;
}
