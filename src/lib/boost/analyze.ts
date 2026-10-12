// Analyse ONE published post for boosting: the AI sees the post itself (picture or video and its
// caption) and how people reacted — likes, comments, buyer messages about its product, and the
// buyers who already ordered from it — next to the shop's product, brand and buyer cities.
// Names, numbers and @handles are scrubbed from every text before it reaches the AI.

import { db } from "@/lib/db";
import { scrub } from "@/lib/orders/ai-audience";
import { adviseForPost, type PostAdvice } from "@/lib/orders/post-advice";
import { fetchPageCommentThreads, fetchPagePost } from "@/lib/publishers/facebook-engage";
import { fetchComments, fetchMediaItem } from "@/lib/publishers/instagram-engage";
import { BOOST_DAYS, postSignals, type BoostPlatform } from "./posts";
import type { SavedAnalysis } from "./cache";

const SAMPLE = 25;

/** Up to `max` distinct, non-empty, scrubbed lines. */
export function sampleLines(texts: (string | null | undefined)[], max = SAMPLE): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const s = scrub(String(t ?? ""));
    if (s.length < 2 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** The reaction block the AI reads as evidence. */
export function evidenceLines(e: { createdAt: string | null; likes: number | null; comments: string[]; commentCount: number; messages: string[]; messageCount: number; orders: number; cities: string[]; productName: string | null }): string[] {
  const block = (title: string, lines: string[]) => (lines.length ? [title, ...lines.map((l) => `- ${l}`)] : []);
  return [
    `PUBLISHED: ${e.createdAt ?? "unknown"}; LIKES: ${e.likes ?? "unknown"}; COMMENTS: ${e.commentCount}`,
    e.productName ? `LINKED PRODUCT: ${e.productName}` : "LINKED PRODUCT: none (the shop has not linked a product to this post)",
    ...block(`COMMENTS (sample of ${e.comments.length}, newest first):`, e.comments),
    `BUYER MESSAGES ABOUT THIS PRODUCT (last ${BOOST_DAYS} days): ${e.messageCount}`,
    ...block("MESSAGES (sample):", e.messages),
    `ORDERS FROM THIS POST OR ITS PRODUCT (last ${BOOST_DAYS} days): ${e.orders}${e.cities.length ? `; buyer cities: ${e.cities.join(", ")}` : ""}`,
  ];
}

export async function analyzePost(tenantId: string, platform: BoostPlatform, postId: string): Promise<{ ok: true; analysis: SavedAnalysis } | { ok: false; error: "not_found" | "ai" }> {
  let caption = "";
  let mediaUrl: string | null = null;
  let mediaType: "IMAGE" | "VIDEO" | null = null;
  let likes: number | null = null;
  let commentCount = 0;
  let createdAt: string | null = null;
  let comments: string[] = [];

  if (platform === "IG") {
    const m = await fetchMediaItem(tenantId, postId);
    if (!m.ok || !m.data) {
      console.error("[boost] IG post not read:", (m.error ?? "").slice(0, 200));
      return { ok: false, error: "not_found" };
    }
    caption = m.data.caption ?? "";
    mediaType = m.data.media_type === "VIDEO" ? "VIDEO" : "IMAGE";
    mediaUrl = m.data.media_url ?? m.data.thumbnail_url ?? null;
    likes = m.data.like_count ?? null;
    commentCount = m.data.comments_count ?? 0;
    createdAt = m.data.timestamp ?? null;
    // The shop's own replies are not buyer reaction: matched by id or, across id spaces, by username.
    const own = m.data.igUserId;
    const ownName = m.data.username?.toLowerCase();
    const c = commentCount ? await fetchComments(tenantId, postId) : null;
    comments = sampleLines(
      (c?.data ?? []).filter((x) => x.from?.id !== own && (!ownName || (x.username ?? x.from?.username)?.toLowerCase() !== ownName)).map((x) => x.text),
    );
  } else {
    const p = await fetchPagePost(tenantId, postId);
    if (!p.ok || !p.data) {
      console.error("[boost] FB post not read:", (p.error ?? "").slice(0, 200));
      return { ok: false, error: "not_found" };
    }
    caption = p.data.message ?? "";
    mediaType = p.data.full_picture ? "IMAGE" : null;
    mediaUrl = p.data.full_picture ?? null;
    likes = p.data.likes_count ?? null;
    commentCount = p.data.comments_count ?? 0;
    createdAt = p.data.created_time ?? null;
    const own = p.data.pageId;
    const c = commentCount ? await fetchPageCommentThreads(tenantId, postId) : null;
    comments = sampleLines((c?.data ?? []).filter((x) => x.authorId !== own).map((x) => x.message));
  }

  const since = new Date(Date.now() - BOOST_DAYS * 86_400_000);
  const link = await db.postAutomation.findFirst({ where: { store: { tenantId }, externalPostId: postId, productId: { not: null } }, select: { productId: true } });
  const productId = link?.productId ?? null;
  // Comments on this post that opened an order: there is no relation, so their ids are listed first.
  const postComments = await db.conversationMessage.findMany({ where: { store: { tenantId }, externalThreadId: postId, channelType: "COMMENT" }, select: { id: true }, take: 2000 });
  const commentIds = postComments.map((m) => m.id);
  const [signals, dms, buyers] = await Promise.all([
    postSignals(tenantId, [postId]),
    productId
      ? db.conversationMessage.findMany({
          where: { store: { tenantId }, direction: "INBOUND", channelType: "DM", boundProductId: productId, createdAt: { gt: since } },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { content: true },
        })
      : Promise.resolve([]),
    db.order.findMany({
      where: { tenantId, createdAt: { gt: since }, OR: [...(productId ? [{ productId }] : []), ...(commentIds.length ? [{ sourceMessageId: { in: commentIds } }] : [])] },
      select: { city: true },
      take: 500,
    }),
  ]);
  const s = signals[postId] ?? { messages: 0, orders: 0, productName: null };
  const cityCount = new Map<string, number>();
  for (const b of buyers) if (b.city) cityCount.set(b.city, (cityCount.get(b.city) ?? 0) + 1);
  const cities = [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);

  const advice: PostAdvice | null = await adviseForPost({
    tenantId,
    caption,
    mediaUrl,
    mediaType,
    productId,
    remoteMedia: true,
    evidence: evidenceLines({ createdAt, likes, comments, commentCount, messages: sampleLines(dms.map((d) => d.content), 20), messageCount: s.messages, orders: s.orders, cities, productName: s.productName }),
  });
  if (!advice) return { ok: false, error: "ai" };
  return { ok: true, analysis: { at: new Date().toISOString(), advice, basedOn: { likes, comments: commentCount, messages: s.messages, orders: s.orders } } };
}
