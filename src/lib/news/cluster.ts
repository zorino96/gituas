import { jaccard, words } from "./text";

const WINDOW_MS = 48 * 60 * 60 * 1000;
const THRESHOLD = 0.6;

interface Titled {
  title: string;
  lang: string | null;
  publishedAt: Date;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function titleWords(title: string): string[] {
  return words(title).filter((w) => w.length > 1);
}

/**
 * The cluster an item belongs to: the key of a recent item in the same
 * language, within 48 hours, whose title shares at least 60% of its words;
 * otherwise a new key from the item's URL. Cross-language duplicates stay
 * separate in phase 1.
 */
export function clusterKeyFor(item: Titled & { url: string }, recent: Array<Titled & { clusterKey: string }>): string {
  const mine = titleWords(item.title);
  for (const r of recent) {
    if (r.lang !== item.lang) continue;
    if (Math.abs(r.publishedAt.getTime() - item.publishedAt.getTime()) > WINDOW_MS) continue;
    if (jaccard(mine, titleWords(r.title)) >= THRESHOLD) return r.clusterKey;
  }
  return `c${fnv1a(item.url)}`;
}

/** One row per story, in input order: the first item seen is the lead. */
export function groupByCluster<T extends { clusterKey: string }>(items: T[]): Array<{ lead: T; count: number }> {
  const groups = new Map<string, { lead: T; count: number }>();
  for (const it of items) {
    const g = groups.get(it.clusterKey);
    if (g) g.count++;
    else groups.set(it.clusterKey, { lead: it, count: 1 });
  }
  return [...groups.values()];
}
