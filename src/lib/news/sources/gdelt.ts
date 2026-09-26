// GDELT DOC 2.0: free, keyless, commercial use allowed with a citation and a
// link to gdeltproject.org (shown on the news desk). It answers bursts with
// HTTP 429, so callers go through the shared cache in ingest.ts.
import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export class RateLimited extends Error {}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

const LANG: Record<string, string> = { arabic: "ar", english: "en", kurdish: "ku", persian: "fa", turkish: "tr" };

export function gdeltUrl(keywords: string[], opts: { timespan?: string; max?: number } = {}): string {
  const terms = keywords
    .map((k) => k.trim().replace(/"/g, ""))
    .filter(Boolean)
    .map((k) => (/\s/.test(k) ? `"${k}"` : k));
  const query = terms.length > 1 ? `(${terms.join(" OR ")})` : (terms[0] ?? "");
  const p = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(opts.max ?? 50),
    timespan: opts.timespan ?? "24h",
    sort: "datedesc",
  });
  return `${BASE}?${p}`;
}

function parseSeen(s?: string): Date {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date();
}

export function parseGdelt(json: unknown): RawItem[] {
  const articles = ((json as { articles?: GdeltArticle[] } | null)?.articles ?? []).filter((a) => a.url && a.title);
  return articles.map((a) => {
    const title = stripHtml(a.title!);
    return {
      url: a.url!,
      title,
      snippet: "",
      publishedAt: parseSeen(a.seendate),
      lang: LANG[(a.language ?? "").toLowerCase()] ?? guessLang(title),
      sourceName: a.domain || new URL(a.url!).hostname,
    };
  });
}

export async function fetchGdelt(keywords: string[]): Promise<RawItem[]> {
  if (!keywords.some((k) => k.trim())) return [];
  const res = await fetch(gdeltUrl(keywords), { signal: AbortSignal.timeout(8000) });
  if (res.status === 429) throw new RateLimited("GDELT asked us to slow down");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  // A bad query comes back as a plain-text sentence, not JSON.
  try {
    return parseGdelt(JSON.parse(body));
  } catch {
    throw new Error(body.slice(0, 160) || "empty answer");
  }
}
