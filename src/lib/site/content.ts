// The website's written content, by language. The JSON files are written once and reviewed (not generated at
// request time): every claim in them comes from the product's fact pack.

import guidesJson from "./content/guides.json";
import landingJson from "./content/landing.json";
import type { SiteLang } from "./langs";
import type { Guide, Landing } from "./types";

const landing = landingJson as unknown as Record<SiteLang, Landing>;
const guides = guidesJson as unknown as { slug: string; en: Guide; ku: Guide; ar: Guide }[];

/** The date the content was last reviewed (ISO), shown on guides and given to search engines. */
export const CONTENT_UPDATED = "2026-10-14";

export const landingFor = (lang: SiteLang): Landing => landing[lang];

export const guideSlugs = (): string[] => guides.map((g) => g.slug);

export const guideFor = (lang: SiteLang, slug: string): Guide | null => guides.find((g) => g.slug === slug)?.[lang] ?? null;

export const guidesFor = (lang: SiteLang): Guide[] => guides.map((g) => g[lang]);
