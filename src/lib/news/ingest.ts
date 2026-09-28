import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { catalogEntry } from "./catalog";
import { classifyPending } from "./classify";
import { clusterKeyFor } from "./cluster";
import { fetchGdelt } from "./sources/gdelt";
import { fetchNewsdata } from "./sources/newsdata";
import { fetchFeed } from "./sources/rss";
import { matchesKeywords } from "./text";
import type { RawItem } from "./types";

const THROTTLE_MS = 5 * 60 * 1000;
const TTL = { rss: 5 * 60 * 1000, gdelt: 10 * 60 * 1000, newsdata: 15 * 60 * 1000 };
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_NEW_PER_FETCH = 100;
/** Newest stories taken from one source per run, so one busy feed can't crowd out the rest. */
const PER_SOURCE = 40;
/** After a fetch fails, a source's cache is retried at most this often. */
const BACKOFF_MS = 60 * 1000;

type Stored = Omit<RawItem, "publishedAt"> & { publishedAt: string };

const toJson = (items: RawItem[]): Prisma.InputJsonValue =>
  items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() })) as unknown as Prisma.InputJsonValue;
const fromJson = (v: unknown): RawItem[] => ((v as Stored[]) ?? []).map((i) => ({ ...i, publishedAt: new Date(i.publishedAt) }));

export interface CachedResult {
  items: RawItem[];
  error: string | null;
}

/**
 * A source's items, shared across tenants: fetched at most once per TTL.
 * When a fetch fails and a cached row already exists, the stale items are
 * returned together with the error message, and the row's fetchedAt is
 * bumped just enough that the dead upstream is retried at most once per
 * BACKOFF_MS instead of on every refresh. A failure with nothing cached
 * throws.
 */
export async function cached(key: string, ttl: number, load: () => Promise<RawItem[]>): Promise<CachedResult> {
  const hit = await db.sourceCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttl) return { items: fromJson(hit.items), error: null };
  try {
    const items = await load();
    const data = { items: toJson(items), fetchedAt: new Date() };
    await db.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { items, error: null };
  } catch (e) {
    if (!hit) throw e;
    const message = e instanceof Error ? e.message : String(e);
    await db.sourceCache.update({ where: { key }, data: { fetchedAt: new Date(Date.now() - ttl + BACKOFF_MS) } });
    return { items: fromJson(hit.items), error: message };
  }
}

export interface IngestResult {
  added: number;
  failed: string[];
  skipped: boolean;
}

/**
 * The candidates worth storing: fresh enough (within MAX_AGE_MS), not
 * already stored for this tenant, deduped by URL (first occurrence wins),
 * newest first, capped at `cap`.
 */
export function pickNew(candidates: RawItem[], storedUrls: Set<string>, now: number, cap: number): RawItem[] {
  const seen = new Set<string>();
  const out: RawItem[] = [];
  for (const c of candidates) {
    if (now - c.publishedAt.getTime() >= MAX_AGE_MS) continue;
    if (storedUrls.has(c.url) || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, cap);
}

/** Fetch every enabled source of a news page and store the new stories. */
export async function ingest(tenantId: string, { force = false } = {}): Promise<IngestResult> {
  const settings = await db.newsSettings.upsert({ where: { tenantId }, create: { tenantId, keywords: [] }, update: {} });
  if (force) {
    // Claim the fetch first, so two tabs opening the desk don't both fetch.
    await db.newsSettings.update({ where: { tenantId }, data: { lastFetchedAt: new Date() } });
  } else {
    // A conditional claim: only the caller that actually flips a stale (or
    // never-fetched) row wins the fetch, so two tabs racing here can't both proceed.
    const claim = await db.newsSettings.updateMany({
      where: { tenantId, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - THROTTLE_MS) } }] },
      data: { lastFetchedAt: new Date() },
    });
    if (claim.count === 0) return { added: 0, failed: [], skipped: true };
  }

  const keywords = settings.keywords;
  const kwKey = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).sort().join("|");
  const sources = await db.newsSource.findMany({ where: { tenantId, enabled: true } });

  const fetched = await Promise.all(
    sources.map(async (s) => {
      try {
        let items: RawItem[] = [];
        let error: string | null = null;
        if (s.catalogId === "gdelt") {
          const r = await cached(`gdelt:${kwKey}`, TTL.gdelt, () => fetchGdelt(keywords));
          items = r.items;
          error = r.error;
        } else if (s.catalogId === "newsdata") {
          const r = await cached(`newsdata:${kwKey}`, TTL.newsdata, () => fetchNewsdata(keywords));
          items = r.items;
          error = r.error;
        } else {
          // An outlet feed from the catalog, or a feed the page added itself.
          const entry = s.catalogId ? catalogEntry(s.catalogId) : undefined;
          const url = entry?.rss ?? s.rssUrl;
          if (url) {
            const r = await cached(`rss:${url}`, TTL.rss, () => fetchFeed(url, s.name));
            items = r.items
              .filter((i) => !settings.keywordFilter || matchesKeywords(`${i.title} ${i.snippet}`, keywords))
              .map((i) => ({ ...i, sourceName: s.name }));
            error = r.error;
          }
        }
        items = [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, PER_SOURCE);
        // updateMany rather than update: a source deleted mid-fetch (by id,
        // no longer a match) must not throw here.
        if (error) {
          await db.newsSource.updateMany({ where: { id: s.id }, data: { lastError: error.slice(0, 200) } });
          return { items, failed: s.name as string | null };
        }
        if (s.lastError) await db.newsSource.updateMany({ where: { id: s.id }, data: { lastError: null } });
        return { items, failed: null as string | null };
      } catch (e) {
        await db.newsSource.updateMany({ where: { id: s.id }, data: { lastError: (e instanceof Error ? e.message : String(e)).slice(0, 200) } });
        return { items: [] as RawItem[], failed: s.name as string | null };
      }
    }),
  );

  const now = Date.now();
  const candidates = fetched.flatMap((f) => f.items);
  const urls = [...new Set(candidates.map((c) => c.url))];
  const storedRows = urls.length ? await db.newsItem.findMany({ where: { tenantId, url: { in: urls } }, select: { url: true } }) : [];
  const storedUrls = new Set(storedRows.map((r) => r.url));
  const fresh = pickNew(candidates, storedUrls, now, MAX_NEW_PER_FETCH);

  // A 72-hour look-back (same as MAX_AGE_MS) so a story near that age can
  // still find and join a slightly older cluster-mate.
  const recent = await db.newsItem.findMany({
    where: { tenantId, publishedAt: { gte: new Date(now - MAX_AGE_MS) } },
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
  // Sort what came in (and anything left from earlier runs) into categories.
  await classifyPending(tenantId);
  return { added, failed: fetched.flatMap((f) => (f.failed ? [f.failed] : [])), skipped: false };
}
