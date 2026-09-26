import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { clusterKeyFor } from "./cluster";
import { fetchGdelt } from "./sources/gdelt";
import { fetchNewsdata } from "./sources/newsdata";
import { fetchFeed } from "./sources/rss";
import { matchesKeywords } from "./text";
import type { RawItem } from "./types";

const THROTTLE_MS = 5 * 60 * 1000;
const TTL = { rss: 5 * 60 * 1000, gdelt: 10 * 60 * 1000, newsdata: 15 * 60 * 1000 };
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_NEW_PER_FETCH = 100;

type Stored = Omit<RawItem, "publishedAt"> & { publishedAt: string };

const toJson = (items: RawItem[]): Prisma.InputJsonValue =>
  items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() })) as unknown as Prisma.InputJsonValue;
const fromJson = (v: unknown): RawItem[] => ((v as Stored[]) ?? []).map((i) => ({ ...i, publishedAt: new Date(i.publishedAt) }));

/**
 * A source's items, shared across tenants: fetched at most once per TTL.
 * When a fetch fails, the last good result is served rather than nothing.
 */
async function cached(key: string, ttl: number, load: () => Promise<RawItem[]>): Promise<RawItem[]> {
  const hit = await db.sourceCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttl) return fromJson(hit.items);
  try {
    const items = await load();
    const data = { items: toJson(items), fetchedAt: new Date() };
    await db.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    return items;
  } catch (e) {
    if (hit) return fromJson(hit.items);
    throw e;
  }
}

export interface IngestResult {
  added: number;
  failed: string[];
  skipped: boolean;
}

/** Fetch every enabled source of a news page and store the new stories. */
export async function ingest(tenantId: string, { force = false } = {}): Promise<IngestResult> {
  const settings = await db.newsSettings.upsert({ where: { tenantId }, create: { tenantId, keywords: [] }, update: {} });
  if (!force && settings.lastFetchedAt && Date.now() - settings.lastFetchedAt.getTime() < THROTTLE_MS) {
    return { added: 0, failed: [], skipped: true };
  }
  // Claim the fetch first, so two tabs opening the desk don't both fetch.
  await db.newsSettings.update({ where: { tenantId }, data: { lastFetchedAt: new Date() } });

  const keywords = settings.keywords;
  const kwKey = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).sort().join("|");
  const sources = await db.newsSource.findMany({ where: { tenantId, enabled: true } });

  const fetched = await Promise.all(
    sources.map(async (s) => {
      try {
        let items: RawItem[] = [];
        if (s.catalogId === "gdelt") items = await cached(`gdelt:${kwKey}`, TTL.gdelt, () => fetchGdelt(keywords));
        else if (s.catalogId === "newsdata") items = await cached(`newsdata:${kwKey}`, TTL.newsdata, () => fetchNewsdata(keywords));
        else if (s.rssUrl) {
          const all = await cached(`rss:${s.rssUrl}`, TTL.rss, () => fetchFeed(s.rssUrl!, s.name));
          items = all.filter((i) => matchesKeywords(`${i.title} ${i.snippet}`, keywords)).map((i) => ({ ...i, sourceName: s.name }));
        }
        if (s.lastError) await db.newsSource.update({ where: { id: s.id }, data: { lastError: null } });
        return { items, failed: null as string | null };
      } catch (e) {
        await db.newsSource.update({ where: { id: s.id }, data: { lastError: (e instanceof Error ? e.message : String(e)).slice(0, 200) } });
        return { items: [] as RawItem[], failed: s.name };
      }
    }),
  );

  const now = Date.now();
  const fresh = fetched
    .flatMap((f) => f.items)
    .filter((i) => now - i.publishedAt.getTime() < MAX_AGE_MS)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, MAX_NEW_PER_FETCH);

  const recent = await db.newsItem.findMany({
    where: { tenantId, publishedAt: { gte: new Date(now - CLUSTER_WINDOW_MS) } },
    select: { title: true, lang: true, publishedAt: true, clusterKey: true },
  });

  let added = 0;
  for (const it of fresh) {
    const clusterKey = clusterKeyFor(it, recent);
    const r = await db.newsItem.createMany({
      data: [
        {
          tenantId,
          sourceName: it.sourceName.slice(0, 120),
          url: it.url,
          title: it.title.slice(0, 500),
          snippet: it.snippet,
          lang: it.lang,
          publishedAt: it.publishedAt,
          clusterKey,
        },
      ],
      skipDuplicates: true,
    });
    if (r.count) {
      added++;
      recent.push({ title: it.title, lang: it.lang, publishedAt: it.publishedAt, clusterKey });
    }
  }
  return { added, failed: fetched.flatMap((f) => (f.failed ? [f.failed] : [])), skipped: false };
}
