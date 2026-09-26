// NewsData.io free tier: commercial use allowed, snippets only, 12-hour delay.
// Unavailable (returns nothing) until NEWSDATA_API_KEY is set.
import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

interface NdResult {
  title?: string;
  link?: string;
  description?: string | null;
  pubDate?: string;
  language?: string;
  source_name?: string;
  source_id?: string;
}

const LANG: Record<string, string> = { arabic: "ar", english: "en", kurdish: "ku", ar: "ar", en: "en", ku: "ku" };

export function newsdataConfigured(): boolean {
  return !!process.env.NEWSDATA_API_KEY;
}

export function newsdataUrl(key: string, keywords: string[]): string {
  const q = keywords.map((k) => k.trim()).filter(Boolean).join(" OR ").slice(0, 100);
  return `https://newsdata.io/api/1/latest?${new URLSearchParams({ apikey: key, q, language: "ar,en" })}`;
}

export function parseNewsdata(json: unknown): RawItem[] {
  const results = ((json as { results?: NdResult[] } | null)?.results ?? []).filter((r) => r.title && r.link);
  return results.map((r) => {
    const title = stripHtml(r.title!);
    const snippet = stripHtml(r.description ?? "").slice(0, 500);
    const t = Date.parse(`${(r.pubDate ?? "").replace(" ", "T")}Z`);
    return {
      url: r.link!,
      title,
      snippet,
      publishedAt: Number.isFinite(t) ? new Date(t) : new Date(),
      lang: LANG[(r.language ?? "").toLowerCase()] ?? guessLang(title),
      sourceName: r.source_name || r.source_id || new URL(r.link!).hostname,
    };
  });
}

export async function fetchNewsdata(keywords: string[]): Promise<RawItem[]> {
  const key = process.env.NEWSDATA_API_KEY;
  if (!key || !keywords.some((k) => k.trim())) return [];
  const res = await fetch(newsdataUrl(key, keywords), { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status === "error") {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(body?.results ?? body ?? "").slice(0, 160)}`);
  }
  return parseNewsdata(body);
}
