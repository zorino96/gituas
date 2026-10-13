// The website's written content, by language. The JSON files are written once and reviewed (not generated at
// request time): every claim in them comes from the product's fact pack.

import g1 from "./content/guides/automatic-replies-facebook-instagram-comments.json";
import g2 from "./content/guides/sell-on-social-media-iraq-kurdistan.json";
import g3 from "./content/guides/kurdish-ai-video-ads.json";
import g4 from "./content/guides/boost-which-post-and-audience.json";
import g5 from "./content/guides/kurdish-voice-notes-and-orders.json";
import g6 from "./content/guides/ai-replies-without-inventing-prices.json";
import landingJson from "./content/landing.json";
import type { SiteLang } from "./langs";
import type { Guide, Landing } from "./types";

const landing = landingJson as unknown as Record<SiteLang, Landing>;
const guides = [g1, g2, g3, g4, g5, g6] as unknown as { slug: string; en: Guide; ku: Guide; ar: Guide }[];

/** The date the content was last reviewed (ISO), shown on guides and given to search engines. */
export const CONTENT_UPDATED = "2026-10-14";
/** The date the first version went live (kept when the content is reviewed again). */
export const CONTENT_PUBLISHED = "2026-10-14";

export const landingFor = (lang: SiteLang): Landing => landing[lang];

export const guideSlugs = (): string[] => guides.map((g) => g.slug);

export const guideFor = (lang: SiteLang, slug: string): Guide | null => guides.find((g) => g.slug === slug)?.[lang] ?? null;

export const guidesFor = (lang: SiteLang): Guide[] => guides.map((g) => g[lang]);
