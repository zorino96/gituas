// The sources Gituas offers every news page.
// - The two APIs search by the page's keywords. GDELT is free, and its terms
//   ask for a citation wherever its data is shown.
// - The outlet feeds bring everything they publish, and the page's category
//   choice decides what it keeps. Each one was checked working on 2026-09-28.
//   Kurdish outlets with no public RSS (Rudaw, NRT, Kurdsat, …) aren't here.
// A page can still add any other feed itself, and is responsible for it (/terms).

export type SourceGroup = "api" | "world" | "region" | "kurdistan" | "official";
export type SourceLang = "ar" | "en" | "tr" | "ckb";

export interface CatalogSource {
  id: string;
  name: string;
  group: SourceGroup;
  /** The language an outlet publishes in; the APIs cover many. */
  lang: SourceLang | null;
  /** APIs only: one line of Kurdish about what it does. */
  description?: string;
  /** Outlet feeds only. */
  rss?: string;
  /** Environment variable the source needs, if any. */
  needsEnv?: string;
  /** Citation the source's terms require wherever its data is shown. */
  attribution?: { label: string; url: string };
}

export const GROUPS: readonly { id: SourceGroup; label: string }[] = [
  { id: "api", label: "گەڕان بە وشە سەرەکییەکان" },
  { id: "world", label: "جیهانی" },
  { id: "region", label: "ڕۆژهەڵاتی ناوەڕاست" },
  { id: "kurdistan", label: "کوردستان" },
  { id: "official", label: "فەرمی" },
];

export const LANG_LABEL: Record<SourceLang, string> = { ar: "عەرەبی", en: "ئینگلیزی", tr: "تورکی", ckb: "کوردی" };

const feed = (id: string, name: string, group: SourceGroup, lang: SourceLang, rss: string): CatalogSource => ({ id, name, group, lang, rss });

export const CATALOG: CatalogSource[] = [
  {
    id: "gdelt",
    name: "GDELT",
    group: "api",
    lang: null,
    description: "هەواڵی جیهان بە +٦٥ زمان، بەپێی وشە سەرەکییەکانت. بەخۆڕایی.",
    attribution: { label: "GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "newsdata",
    name: "NewsData.io",
    group: "api",
    lang: null,
    description: "هەواڵی عەرەبی و ئینگلیزی بەپێی وشە سەرەکییەکانت. ١٢ کاتژمێر دواکەوتوو.",
    needsEnv: "NEWSDATA_API_KEY",
    attribution: { label: "NewsData.io", url: "https://newsdata.io/" },
  },
  feed("bbc-ar", "BBC عربي", "world", "ar", "https://feeds.bbci.co.uk/arabic/rss.xml"),
  feed("bbc-en", "BBC News — Middle East", "world", "en", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
  feed("aljazeera-ar", "الجزيرة نت", "world", "ar", "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9"),
  feed("aljazeera-en", "Al Jazeera English", "world", "en", "https://www.aljazeera.com/xml/rss/all.xml"),
  feed("france24-ar", "فرانس 24", "world", "ar", "https://www.france24.com/ar/rss"),
  feed("france24-en", "France 24 — Middle East", "world", "en", "https://www.france24.com/en/middle-east/rss"),
  feed("dw-ar", "DW عربية", "world", "ar", "https://rss.dw.com/xml/rss-ar-all"),
  feed("dw-en", "DW", "world", "en", "https://rss.dw.com/xml/rss-en-all"),
  feed("skynews-ar", "سكاي نيوز عربية", "world", "ar", "https://www.skynewsarabia.com/rss"),
  feed("euronews-ar", "يورونيوز", "world", "ar", "https://arabic.euronews.com/rss"),
  feed("euronews-en", "Euronews", "world", "en", "https://www.euronews.com/rss"),
  feed("guardian-world", "The Guardian — World", "world", "en", "https://www.theguardian.com/world/rss"),
  feed("aa-ar", "الأناضول", "region", "ar", "https://www.aa.com.tr/ar/rss/default?cat=guncel"),
  feed("aa-en", "Anadolu Agency", "region", "en", "https://www.aa.com.tr/en/rss/default?cat=guncel"),
  feed("aa-tr", "Anadolu Ajansı", "region", "tr", "https://www.aa.com.tr/tr/rss/default?cat=guncel"),
  feed("aawsat", "الشرق الأوسط", "region", "ar", "https://aawsat.com/feed"),
  feed("independent-ar", "اندبندنت عربية", "region", "ar", "https://www.independentarabia.com/rss.xml"),
  feed("shafaq-ar", "شفق نيوز", "region", "ar", "https://shafaq.com/rss/ar"),
  feed("shafaq-en", "Shafaq News", "region", "en", "https://shafaq.com/rss/en"),
  feed("alsumaria", "السومرية نيوز", "region", "ar", "https://www.alsumaria.tv/Rss/iraq-latest-news/ar"),
  feed("almada", "المدى", "region", "ar", "https://almadapaper.net/feed/"),
  feed("k24-ckb", "کوردستان٢٤", "kurdistan", "ckb", "https://www.kurdistan24.net/ckb/rss.xml"),
  feed("k24-ar", "كوردستان 24", "kurdistan", "ar", "https://www.kurdistan24.net/ar/rss.xml"),
  feed("k24-en", "Kurdistan24", "kurdistan", "en", "https://www.kurdistan24.net/en/rss.xml"),
  feed("shafaq-ku", "شەفەق نیوز", "kurdistan", "ckb", "https://shafaq.com/rss/ku"),
  feed("esta", "ئێستا", "kurdistan", "ckb", "https://esta.krd/feed/"),
  feed("un-ar", "أخبار الأمم المتحدة", "official", "ar", "https://news.un.org/feed/subscribe/ar/news/all/rss.xml"),
  feed("un-en", "UN News — Middle East", "official", "en", "https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml"),
];

export function catalogAvailable(): CatalogSource[] {
  return CATALOG.filter((c) => !c.needsEnv || !!process.env[c.needsEnv]);
}

export function catalogEntry(id: string): CatalogSource | undefined {
  return catalogAvailable().find((c) => c.id === id);
}
