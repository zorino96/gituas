// Metadata and structured data (JSON-LD) of the public pages. Everything stated here is also visible on the page:
// search engines penalise markup for things a visitor cannot see, and answer engines quote what is written.

import type { Metadata } from "next";

import { CONTENT_UPDATED } from "./content";
import { DOC_LANG, HREFLANG, OG_LOCALE, SITE_LANGS, SITE_ORIGIN, siteUrl, type SitePath, type SiteLang } from "./langs";
import type { PlanRow } from "./pricing";
import type { Guide, Landing, Qa } from "./types";

export const SITE_NAME = "Gituas";
export const LOGO_URL = `${SITE_ORIGIN}/brand/gituas-mark-512.png`;
export const OG_IMAGE = { url: `${SITE_ORIGIN}/og/gituas-1200x630.png`, width: 1200, height: 630, alt: "Gituas: AI replies, orders and video ads for shops in Kurdistan and Iraq" };

/** Canonical + hreflang alternates for one page in every language (x-default is English). */
export function alternatesFor(lang: SiteLang, path: SitePath): { canonical: string; languages: Record<string, string> } {
  return {
    canonical: siteUrl(lang, path),
    languages: {
      ...Object.fromEntries(SITE_LANGS.map((l) => [HREFLANG[l], siteUrl(l, path)])),
      "x-default": siteUrl("en", path),
    },
  };
}

export function pageMetadata(o: { lang: SiteLang; path: SitePath; title: string; description: string; type?: "website" | "article" }): Metadata {
  const url = siteUrl(o.lang, o.path);
  return {
    title: { absolute: o.title },
    description: o.description,
    alternates: alternatesFor(o.lang, o.path),
    openGraph: {
      type: o.type ?? "website",
      url,
      siteName: SITE_NAME,
      title: o.title,
      description: o.description,
      locale: OG_LOCALE[o.lang],
      alternateLocale: SITE_LANGS.filter((l) => l !== o.lang).map((l) => OG_LOCALE[l]),
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, images: [OG_IMAGE.url] },
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  };
}

type Json = Record<string, unknown>;

export const organization = (): Json => ({
  "@type": "Organization",
  "@id": `${SITE_ORIGIN}/#organization`,
  name: SITE_NAME,
  url: SITE_ORIGIN,
  logo: LOGO_URL,
  alternateName: "گیتواس",
  description: "Gituas is an AI assistant for shops and businesses that sell on Facebook and Instagram in Kurdistan and Iraq.",
  areaServed: [
    { "@type": "AdministrativeArea", name: "Kurdistan Region of Iraq" },
    { "@type": "Country", name: "Iraq" },
  ],
});

export const website = (): Json => ({
  "@type": "WebSite",
  "@id": `${SITE_ORIGIN}/#website`,
  url: SITE_ORIGIN,
  name: SITE_NAME,
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  inLanguage: SITE_LANGS.map((l) => DOC_LANG[l]),
});

export function softwareApplication(lang: SiteLang, landing: Landing, plans: PlanRow[]): Json {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_ORIGIN}/#software`,
    name: SITE_NAME,
    url: siteUrl(lang),
    description: landing.definition,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: SITE_LANGS.map((l) => DOC_LANG[l]),
    featureList: landing.features.map((f) => f.title),
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    offers: plans.map((p) => ({
      "@type": "Offer",
      name: p.plan,
      price: String(p.price),
      priceCurrency: "IQD",
      priceSpecification: { "@type": "UnitPriceSpecification", price: String(p.price), priceCurrency: "IQD", billingDuration: "P30D", unitText: "shop" },
      availability: "https://schema.org/InStock",
      url: siteUrl(lang, "/pricing"),
    })),
  };
}

export const faqPage = (faq: Qa[]): Json => ({
  "@type": "FAQPage",
  mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

export const breadcrumbs = (items: { name: string; url: string }[]): Json => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
});

export function article(lang: SiteLang, g: Guide): Json {
  const url = siteUrl(lang, `/guides/${g.slug}`);
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: g.title,
    description: g.metaDescription,
    inLanguage: DOC_LANG[lang],
    datePublished: CONTENT_UPDATED,
    dateModified: CONTENT_UPDATED,
    mainEntityOfPage: url,
    author: { "@id": `${SITE_ORIGIN}/#organization` },
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  };
}

export const howTo = (lang: SiteLang, g: Guide): Json | null =>
  g.steps?.length
    ? {
        "@type": "HowTo",
        name: g.title,
        inLanguage: DOC_LANG[lang],
        step: g.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text })),
      }
    : null;

/** One <script type="application/ld+json"> payload for a page: a @graph of the given nodes. */
export const graph = (...nodes: (Json | null)[]): string =>
  JSON.stringify({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) }).replace(/</g, "\\u003c");
