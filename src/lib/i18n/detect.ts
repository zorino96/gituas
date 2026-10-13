// Which language a visitor who has not chosen one gets: the world reads English by default, Kurdish and Arabic
// browsers get their own language, and Iraq keeps Sorani (the product's home). Pure, so it is easy to test.
//
//   In Iraq (Vercel's x-vercel-ip-country is IQ): Sorani, as before. An Erbil shop owner with an English or Arabic
//   Windows keeps the Sorani app; the switch is one tap and the choice is remembered.
//   Anywhere else, Accept-Language decides when it names a language we have, in the visitor's own order of
//   preference: ku / ckb → Sorani, ar → Arabic, en → English. Nothing we have (German, Turkish, Persian...) → English.
//   With no country at all (a local run, a bot that sends nothing) the product's default, Sorani, is kept; a crawler
//   from the USA has a country, so it reads English.

import type { Lang } from "./lang";

export interface LangHints {
  /** The Accept-Language header. */
  acceptLanguage?: string | null;
  /** ISO 3166-1 alpha-2, upper or lower case. */
  country?: string | null;
  /**
   * Public pages only: in Iraq a browser whose first language is Arabic gets Arabic (Baghdad, Basra, Mosul read
   * the website in Arabic). The app keeps Sorani for everyone in Iraq so nobody's screen changes under them.
   */
  arabicInIraq?: boolean;
}

/** The base languages of an Accept-Language header, best first (q-weights respected, ties keep their order). */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith("q="))?.slice(2) ?? "1");
      return { base: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 1, i };
    })
    .filter((x) => x.base && x.base !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.base);
}

/** The site language for a visitor with no saved choice. */
export function detectLang({ acceptLanguage, country, arabicInIraq }: LangHints): Lang {
  if (country?.toUpperCase() === "IQ") return arabicInIraq && acceptedLanguages(acceptLanguage)[0] === "ar" ? "ar" : "ckb";
  const named = acceptedLanguages(acceptLanguage).find((l) => l === "ku" || l === "ckb" || l === "ar" || l === "en");
  if (named === "ku" || named === "ckb") return "ckb";
  if (named === "ar") return "ar";
  if (named === "en") return "en";
  return country ? "en" : "ckb";
}
