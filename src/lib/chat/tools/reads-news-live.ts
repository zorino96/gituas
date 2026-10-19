// The news desk's numbers over a period: what the desk itself did (its own tables) and, held to the request's deadline, what Facebook,
// Instagram and YouTube say about its Pages. The shop's version (reads-live.ts readInsights) counts buyers, orders and WhatsApp taps,
// which a desk does not have; this one counts stories, drafts, posts and videos. A live part that fails or runs out of time is a value
// (see withinDeadline), never a throw: the others still arrive.

import { loadConnections, loadInsights, loadPosts, loadYouTube, type InsightsResult } from "@/app/app/data";
import { db } from "@/lib/db";
import type { MPost } from "@/lib/merchant/types";
import type { YouTubeBlock } from "@/lib/merchant/youtube-insights";
import { postedTo, type DeskCounts, type DeskInsightsRead } from "./reads-news-shape";
import { withinDeadline, type Live } from "./reads-shared";

const DAY = 86_400_000;
const metaConnected = (c: { META_FACEBOOK: { connected: boolean }; META_INSTAGRAM: { connected: boolean } }): boolean => c.META_FACEBOOK.connected || c.META_INSTAGRAM.connected;

/** The desk's own counts over `days` days. */
export async function readDeskCounts(tenantId: string, days: number): Promise<DeskCounts> {
  const since = new Date(Date.now() - days * DAY);
  const [received, drafted, byAutopilot, published, videos, recent] = await Promise.all([
    db.newsItem.count({ where: { tenantId, createdAt: { gt: since } } }),
    db.newsDraft.count({ where: { tenantId, createdAt: { gt: since } } }),
    db.newsDraft.count({ where: { tenantId, createdAt: { gt: since }, auto: true } }),
    db.newsDraft.count({ where: { tenantId, publishedAt: { gt: since } } }),
    db.newsVideo.count({ where: { tenantId, createdAt: { gt: since }, status: { in: ["RENDERED", "POSTING", "POSTED"] } } }),
    // Where each draft went is stored on the draft (a failed platform stays as a failed result).
    db.newsDraft.findMany({ where: { tenantId, updatedAt: { gt: since } }, select: { results: true }, take: 2000 }),
  ]);
  const failed: Record<string, number> = {};
  for (const d of recent) for (const r of postedTo(d.results)) if (!r.ok) failed[r.target] = (failed[r.target] ?? 0) + 1;
  return { received, drafted, byAutopilot, published, videos, failed };
}

/** The desk's numbers: its own counts always, the Meta and Google parts each when they can be had in time. */
export async function readDeskInsights(tenantId: string, deadline: number, days: number): Promise<{ own: DeskCounts } & DeskInsightsRead> {
  const conns = await loadConnections(tenantId);
  const [own, account, youtube, posts] = await Promise.all([
    readDeskCounts(tenantId, days),
    metaConnected(conns) ? withinDeadline(deadline, () => loadInsights(tenantId, conns)) : Promise.resolve<Live<InsightsResult>>({ ok: false, reason: "failed" }),
    conns.YOUTUBE.connected ? withinDeadline(deadline, () => loadYouTube(tenantId, conns)) : Promise.resolve<Live<YouTubeBlock | null>>({ ok: true, value: null }),
    metaConnected(conns) ? withinDeadline(deadline, async () => (await loadPosts(tenantId, conns)).posts) : Promise.resolve<Live<MPost[]>>({ ok: true, value: [] }),
  ]);
  return { own, connections: { FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected, YT: conns.YOUTUBE.connected }, account, youtube, posts };
}
