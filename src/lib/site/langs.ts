// The public website's languages: one URL per language (/en, /ku, /ar) so search engines and AI answer engines
// can index, cite and cross-link each of them (hreflang). The app itself keeps the gm_lang cookie.

import type { Lang } from "@/lib/i18n/lang";

export const SITE_LANGS = ["en", "ku", "ar"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

export const SITE_ORIGIN = "https://gituas.com";

/** The URL segment of a site language and the app language it shows. */
export const SITE_TO_LANG: Record<SiteLang, Lang> = { en: "en", ku: "ckb", ar: "ar" };
export const LANG_TO_SITE: Record<Lang, SiteLang> = { en: "en", ckb: "ku", ar: "ar" };

/** Each language named in itself, for the switch. */
export const SITE_LANG_NAMES: Record<SiteLang, string> = { en: "English", ku: "کوردی", ar: "العربية" };

export const isSiteLang = (v: unknown): v is SiteLang => typeof v === "string" && (SITE_LANGS as readonly string[]).includes(v);

/** Language tags: hreflang for links, the document language, and Open Graph's locale. */
export const HREFLANG: Record<SiteLang, string> = { en: "en", ku: "ku", ar: "ar" };
export const DOC_LANG: Record<SiteLang, string> = { en: "en", ku: "ckb", ar: "ar" };
export const OG_LOCALE: Record<SiteLang, string> = { en: "en_US", ku: "cb_IQ", ar: "ar_IQ" };

export type SitePath = "" | "/pricing" | "/guides" | "/about" | `/guides/${string}`;

export const sitePath = (lang: SiteLang, path: SitePath = ""): string => `/${lang}${path}`;
export const siteUrl = (lang: SiteLang, path: SitePath = ""): string => `${SITE_ORIGIN}${sitePath(lang, path)}`;
