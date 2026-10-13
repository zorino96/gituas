// The shapes of the website's written content (src/lib/site/content/*.json), one object per language.

export interface TitleBody {
  title: string;
  body: string;
}

export interface Qa {
  q: string;
  a: string;
}

export interface Landing {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lead: string;
  /** The one-sentence definition of the product, quoted by answer engines. */
  definition: string;
  steps: TitleBody[];
  features: TitleBody[];
  audience: TitleBody[];
  market: { title: string; paragraphs: string[] };
  pricing: { title: string; intro: string; note: string };
  faq: Qa[];
  closing: { title: string; body: string };
}

export interface GuideSection {
  h2: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  /** The direct answer to the page's question. */
  answer: string;
  keyPoints: string[];
  sections: GuideSection[];
  steps?: { name: string; text: string }[];
  faq: Qa[];
  related: string[];
}
