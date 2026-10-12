// The Boost section's post list: the shop's recent Facebook and Instagram posts with what each one
// already brought — likes and comments (from Meta), and from Gituas' own records the messages about
// its product and the orders it led to. One Graph call per platform; comments are read only when a
// post is analysed (./analyze.ts).

import { db } from "@/lib/db";
import { fetchPagePosts } from "@/lib/publishers/facebook-engage";
import { fetchMedia } from "@/lib/publishers/instagram-engage";
import type { Connections } from "@/app/app/data";

export type BoostPlatform = "FB" | "IG";

export interface BoostPost {
  platform: BoostPlatform;
  id: string;
  caption: string;
  thumbUrl: string | null;
  permalink: string | null;
  createdAt: string | null;
  mediaType: "IMAGE" | "VIDEO";
  likes: number | null;
  comments: number;
  /** Buyer messages about the product this post sells (last 90 days), when the post has one. */
  messages: number;
  /** Orders that came from this post's comments, plus orders of its product (last 90 days). */
  orders: number;
  productName: string | null;
}

export const BOOST_DAYS = 90;

export async function loadBoostPosts(tenantId: string, conns: Connections, perPlatform = 12): Promise<{ posts: BoostPost[]; errors: { platform: BoostPlatform; message: string }[] }> {
  const errors: { platform: BoostPlatform; message: string }[] = [];
  const [ig, fb] = await Promise.all([
    conns.META_INSTAGRAM.connected ? fetchMedia(tenantId, perPlatform) : Promise.resolve(null),
    conns.META_FACEBOOK.connected ? fetchPagePosts(tenantId, perPlatform) : Promise.resolve(null),
  ]);
  const posts: Omit<BoostPost, "messages" | "orders" | "productName">[] = [];
  if (ig && !ig.ok) errors.push({ platform: "IG", message: ig.error ?? "Instagram failed" });
  for (const m of ig?.data ?? []) {
    posts.push({
      platform: "IG",
      id: m.id,
      caption: m.caption ?? "",
      thumbUrl: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) ?? null,
      permalink: m.permalink ?? null,
      createdAt: m.timestamp ?? null,
      mediaType: m.media_type === "VIDEO" ? "VIDEO" : "IMAGE",
      likes: m.like_count ?? null,
      comments: m.comments_count ?? 0,
    });
  }
  if (fb && !fb.ok) errors.push({ platform: "FB", message: fb.error ?? "Facebook failed" });
  for (const p of fb?.data ?? []) {
    posts.push({
      platform: "FB",
      id: p.id,
      caption: p.message ?? "",
      thumbUrl: p.full_picture ?? null,
      permalink: p.permalink_url ?? null,
      createdAt: p.created_time ?? null,
      mediaType: "IMAGE",
      likes: p.likes_count ?? null,
      comments: p.comments_count ?? 0,
    });
  }
  posts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const signals = await postSignals(tenantId, posts.map((p) => p.id));
  return { posts: posts.map((p) => ({ ...p, ...(signals[p.id] ?? { messages: 0, orders: 0, productName: null }) })), errors };
}

/**
 * For each post: the product the shop linked to it (automation settings), the buyer messages about
 * that product and the orders from the post or the product, all in the last 90 days. Counted in the
 * database, never read row by row.
 */
export async function postSignals(tenantId: string, postIds: string[]): Promise<Record<string, { messages: number; orders: number; productName: string | null }>> {
  if (!postIds.length) return {};
  const since = new Date(Date.now() - BOOST_DAYS * 86_400_000);
  const links = await db.postAutomation.findMany({
    where: { store: { tenantId }, externalPostId: { in: postIds }, productId: { not: null } },
    select: { externalPostId: true, productId: true },
  });
  const productOf = new Map(links.map((l) => [l.externalPostId, l.productId!]));
  const productIds = [...new Set(productOf.values())];
  const [products, dms, productOrders, commentOrders] = await Promise.all([
    productIds.length ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    productIds.length
      ? db.conversationMessage.groupBy({
          by: ["boundProductId"],
          where: { store: { tenantId }, direction: "INBOUND", channelType: "DM", boundProductId: { in: productIds }, createdAt: { gt: since } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? db.order.groupBy({ by: ["productId"], where: { tenantId, productId: { in: productIds }, createdAt: { gt: since } }, _count: { _all: true } })
      : Promise.resolve([]),
    // Orders opened from a comment on the post itself (the comment's thread is the post).
    db.$queryRaw<{ post: string; n: bigint }[]>`
      SELECT m."externalThreadId" AS post, COUNT(*)::bigint AS n
      FROM "Order" o JOIN "ConversationMessage" m ON m.id = o."sourceMessageId"
      WHERE o."tenantId" = ${tenantId} AND o."createdAt" > ${since} AND m."externalThreadId" = ANY(${postIds})
      GROUP BY m."externalThreadId"`,
  ]);
  const name = new Map(products.map((p) => [p.id, p.name]));
  const dmBy = new Map(dms.map((d) => [d.boundProductId, d._count._all]));
  const ordersBy = new Map(productOrders.map((o) => [o.productId, o._count._all]));
  const fromComments = new Map(commentOrders.map((r) => [r.post, Number(r.n)]));
  const out: Record<string, { messages: number; orders: number; productName: string | null }> = {};
  for (const id of postIds) {
    const pid = productOf.get(id) ?? null;
    out[id] = {
      messages: pid ? (dmBy.get(pid) ?? 0) : 0,
      // A comment order is also an order of the product: count the larger, never both.
      orders: Math.max(fromComments.get(id) ?? 0, pid ? (ordersBy.get(pid) ?? 0) : 0),
      productName: pid ? (name.get(pid) ?? null) : null,
    };
  }
  return out;
}
