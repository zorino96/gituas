// The curated sources Gituas offers every news page. An outlet's RSS feed is
// added here only after its terms are read and allow this use; until then a
// page adds feeds itself and is responsible for them (see /terms).
export type CatalogId = "gdelt" | "newsdata";

export interface CatalogSource {
  id: CatalogId;
  name: string;
  description: string;
  /** Environment variable the source needs, if any. */
  needsEnv?: string;
  /** Citation the source's terms require wherever its data is shown. */
  attribution: { label: string; url: string };
}

export const CATALOG: CatalogSource[] = [
  {
    id: "gdelt",
    name: "GDELT",
    description: "هەواڵی جیهان بە +٦٥ زمان، بەپێی وشە سەرەکییەکانت. بەخۆڕایی.",
    attribution: { label: "GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "newsdata",
    name: "NewsData.io",
    description: "هەواڵی عەرەبی و ئینگلیزی بەپێی وشە سەرەکییەکانت. ١٢ کاتژمێر دواکەوتوو.",
    needsEnv: "NEWSDATA_API_KEY",
    attribution: { label: "NewsData.io", url: "https://newsdata.io/" },
  },
];

export function catalogAvailable(): CatalogSource[] {
  return CATALOG.filter((c) => !c.needsEnv || !!process.env[c.needsEnv]);
}
