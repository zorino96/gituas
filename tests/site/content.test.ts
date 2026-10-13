import { describe, expect, it } from "vitest";

import guidesJson from "@/lib/site/content/guides.json";
import landingJson from "@/lib/site/content/landing.json";
import { SITE_LANGS, type SiteLang } from "@/lib/site/langs";
import type { Guide, Landing } from "@/lib/site/types";

const landing = landingJson as unknown as Record<SiteLang, Landing>;
const guides = guidesJson as unknown as { slug: string; en: Guide; ku: Guide; ar: Guide }[];

/** All the visible text of a page's content, one string. */
const textOf = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(textOf).join("\n") : v && typeof v === "object" ? Object.values(v).map(textOf).join("\n") : "");

const everything: { where: string; lang: SiteLang; text: string }[] = [
  ...SITE_LANGS.map((lang) => ({ where: `landing/${lang}`, lang, text: textOf(landing[lang]) })),
  ...guides.flatMap((g) => SITE_LANGS.map((lang) => ({ where: `${g.slug}/${lang}`, lang, text: textOf(g[lang]) }))),
];

describe("website content", () => {
  it("has every language for the landing page and every guide, with the same slug and links", () => {
    for (const lang of SITE_LANGS) expect(landing[lang], lang).toBeTruthy();
    const slugs = guides.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of guides) {
      for (const lang of SITE_LANGS) {
        expect(g[lang].slug, `${g.slug}/${lang}`).toBe(g.slug);
        expect(g[lang].related, `${g.slug}/${lang}`).toEqual(g.en.related);
        for (const r of g[lang].related) expect(slugs, `${g.slug}/${lang} related ${r}`).toContain(r);
        expect(g[lang].sections.length).toBeGreaterThanOrEqual(5);
        expect(g[lang].faq.length).toBeGreaterThanOrEqual(3);
        expect(g[lang].keyPoints.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is complete: no empty field anywhere", () => {
    for (const { where, text } of everything) {
      expect(text.length, where).toBeGreaterThan(300);
      expect(text, where).not.toMatch(/undefined|null|TODO|lorem/i);
    }
    for (const lang of SITE_LANGS) {
      const l = landing[lang];
      expect(l.steps).toHaveLength(3);
      expect(l.features).toHaveLength(12);
      expect(l.audience).toHaveLength(4);
      expect(l.faq.length).toBeGreaterThanOrEqual(8);
      for (const v of [l.metaTitle, l.metaDescription, l.h1, l.lead, l.definition, l.market.title, l.pricing.title, l.pricing.intro, l.closing.title]) expect(v.trim().length, lang).toBeGreaterThan(5);
    }
  });

  it("keeps titles and descriptions inside what search results show", () => {
    for (const lang of SITE_LANGS) {
      expect(landing[lang].metaTitle.length, `landing/${lang} title`).toBeLessThanOrEqual(64);
      expect(landing[lang].metaDescription.length, `landing/${lang} description`).toBeLessThanOrEqual(160);
      for (const g of guides) {
        expect(g[lang].metaTitle.length, `${g.slug}/${lang} title`).toBeLessThanOrEqual(64);
        expect(g[lang].metaDescription.length, `${g.slug}/${lang} description`).toBeLessThanOrEqual(160);
      }
    }
  });

  it("uses each script as it should: no Kurdish-only letters in Arabic, no Arabic-only letters in Sorani", () => {
    // Quoted examples («نرخی چەندە؟»), hashtags and URLs may carry the other script on purpose.
    const bare = (t: string) => t.replace(/«[^»]*»/g, " ").replace(/#\S+/g, " ").replace(/\(([^)]*[ێۆڕڵە][^)]*)\)/g, " ");
    for (const { where, lang, text } of everything) {
      if (lang === "ar") expect(bare(text), where).not.toMatch(/[ێۆڕڵەۋ]/);
      if (lang === "ku") expect(bare(text), where).not.toMatch(/[يكى]/);
    }
  });

  /** The sentences of a text that do not deny what they mention ("results are not guaranteed" is fine). */
  const affirmed = (t: string) =>
    t
      .split(/(?<=[.!?])\s+|\n/)
      .filter((x) => !x.trim().endsWith("?") && !/\b(not|no|never|cannot|can't|doesn't|isn't|aren't|without)\b/i.test(x))
      .join("\n");

  it("makes no claims the product cannot back", () => {
    const banned = /\b(best|number one|#1|world.?class|revolutionary|game.?chang|guarantee[sd]?|unlimited|100%|risk.?free|testimonial|award|thousands of (shops|customers|users)|first (in|ever)|only (tool|app|platform))\b/i;
    for (const { where, lang, text } of everything.filter((e) => e.lang === "en")) {
      expect(affirmed(text), where).not.toMatch(banned);
    }
  });

  it("states only the plan numbers the product really has", () => {
    // every figure of 1,000 or more written in the English text must be one of the product's own numbers
    const allowed = new Set(["1,000", "5,000", "15,000", "25,000", "59,000", "1,500", "2,000"]);
    for (const { where, lang, text } of everything.filter((e) => e.lang === "en")) {
      for (const m of text.match(/\d{1,3}(,\d{3})+/g) ?? []) expect(allowed.has(m), `${where}: ${m}`).toBe(true);
    }
    for (const { where, text } of everything.filter((e) => e.lang === "en")) {
      // a price is only ever one of the three
      for (const m of text.matchAll(/(\d[\d,]*)\s*(IQD|Iraqi dinar)/g)) expect(["0", "15,000", "25,000", "59,000"], `${where}: ${m[0]}`).toContain(m[1]);
    }
  });

  it("does not promise WhatsApp automatic replies", () => {
    for (const { where, lang, text } of everything.filter((e) => e.lang === "en")) {
      expect(affirmed(text), where).not.toMatch(/WhatsApp[^.]{0,60}(automatic|auto-?repl|answers? (automatically|for you))/i);
    }
  });
});
