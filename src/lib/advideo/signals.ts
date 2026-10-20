// What the daily plan is allowed to look at: the calendar, the shop's own products, questions,
// orders and videos, and the owner's notes about the market. Everything here is the shop's own data
// or a date: there is no live market feed behind it, and the plan says so when the data is thin.

import { db } from "@/lib/db";
import { loadBuyerProfile, ordersByPost } from "@/lib/orders/audience";
import { brandNameOf } from "@/lib/shop/brand-name";
import { priceLineOf, usablePhotos } from "./brief";
import { describeCalendar, marketCalendar, type MarketCalendar } from "./calendar";
import { lookKey, type AdLook } from "./spec";

const DAY = 86_400_000;

export interface ProductSignal {
  id: string;
  name: string;
  priceLine: string | null;
  inStock: boolean;
  hasPhoto: boolean;
  /** Days since the product was added. */
  ageDays: number;
  /** Buyer messages that were about this product in the last 14 days. */
  asked14: number;
  /** Orders for it in the last 30 days. */
  orders30: number;
  /** Days since a video of it was made; null = never. */
  videoDaysAgo: number | null;
}

export interface VideoSignal {
  daysAgo: number;
  objective: string | null;
  product: string | null;
  look: AdLook | null;
  hook: string | null;
  posted: boolean;
  /** Comments and orders that came from the post, when it could be counted. */
  comments: number | null;
  orders: number | null;
}

export interface Signals {
  calendar: MarketCalendar;
  shop: { name: string; tagline: string | null; cities: string[]; hours: number[]; languages: string[]; orders60: number; messages60: number; hasPhone: boolean };
  products: ProductSignal[];
  /** What buyers asked about in the last 14 days: price, delivery, size_colour, availability ... */
  intents: Record<string, number>;
  recentVideos: VideoSignal[];
  /** The owner's own words about what is going on in their market. */
  notes: string;
}

interface SpecLike {
  look?: AdLook;
  plan?: { objective?: string };
  scenes?: { type?: string; text?: string }[];
}

/**
 * The post ids a rendered video's publish results carry. Instagram: the media id. Facebook: a video is
 * answered with its bare id, while the comments on it arrive under "<pageId>_<id>", so both are listed.
 */
export function postIdsOf(results: unknown, fbPageId?: string | null): string[] {
  if (!Array.isArray(results)) return [];
  const out = new Set<string>();
  for (const r of results) {
    const item = (r ?? {}) as { publishId?: unknown; target?: unknown };
    const id = item.publishId;
    if (typeof id !== "string" || id.length <= 3) continue;
    out.add(id);
    if (item.target === "FB" && fbPageId && !id.includes("_")) out.add(`${fbPageId}_${id}`);
  }
  return [...out];
}

export async function gatherSignals(storeId: string, notes: string, now = Date.now()): Promise<Signals | null> {
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { id: true, tenantId: true, name: true, igUsername: true, fbPageId: true, igUserId: true, tenant: { select: { whatsappNumber: true } } },
  });
  if (!store) return null;
  const since14 = new Date(now - 14 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const [kit, products, asked, orders, intents, profile, videos] = await Promise.all([
    db.brandKit.findUnique({ where: { tenantId: store.tenantId }, select: { tagline: true } }),
    db.product.findMany({
      where: { storeId, active: true },
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: { id: true, name: true, photos: true, createdAt: true, variants: { select: { amountMinor: true, currency: true, inStock: true } } },
    }),
    db.conversationMessage.groupBy({
      by: ["boundProductId"],
      // Questions and orders are demand; praise and spam are not.
      where: { storeId, direction: "INBOUND", boundProductId: { not: null }, commentType: { in: ["QUESTION", "ORDER"] }, createdAt: { gt: since14 } },
      _count: { boundProductId: true },
    }),
    db.order.groupBy({
      by: ["productId"],
      where: { storeId, productId: { not: null }, createdAt: { gt: since30 }, status: { notIn: ["CANCELLED", "RETURNED"] } },
      _count: { productId: true },
    }),
    db.conversationMessage.groupBy({
      by: ["intent"],
      where: { storeId, direction: "INBOUND", intent: { not: null, notIn: ["none"] }, createdAt: { gt: since14 } },
      _count: { intent: true },
    }),
    loadBuyerProfile(store.tenantId, storeId),
    db.adVideo.findMany({
      // Only videos that were really made: a failed or queued one says nothing about what works.
      where: { storeId, status: { in: ["RENDERED", "POSTING", "POSTED"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, productId: true, spec: true, status: true, postedAt: true, results: true, createdAt: true },
    }),
  ]);

  const askedBy = new Map(asked.map((r) => [r.boundProductId as string, r._count.boundProductId]));
  const ordersBy = new Map(orders.map((r) => [r.productId as string, r._count.productId]));
  const lastVideo = new Map<string, number>();
  for (const v of videos) if (v.productId) lastVideo.set(v.productId, Math.max(lastVideo.get(v.productId) ?? 0, v.createdAt.getTime()));

  // Demand first, then the most recently edited: the strategist sees what buyers want, not just what was touched last.
  const productSignals: ProductSignal[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceLine: priceLineOf(p.variants),
      inStock: p.variants.length === 0 || p.variants.some((v) => v.inStock),
      // A photo the renderer can actually use (the shop's own JPEG), not just any link.
      hasPhoto: usablePhotos(p.photos, store.tenantId).length > 0,
      ageDays: Math.floor((now - p.createdAt.getTime()) / DAY),
      asked14: askedBy.get(p.id) ?? 0,
      orders30: ordersBy.get(p.id) ?? 0,
      videoDaysAgo: lastVideo.has(p.id) ? Math.floor((now - lastVideo.get(p.id)!) / DAY) : null,
    }))
    .sort((a, b) => b.orders30 * 3 + b.asked14 - (a.orders30 * 3 + a.asked14))
    .slice(0, 20);
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  // How each recent video did, as far as the comments and orders on its post can tell.
  const idsOf = new Map(videos.map((v) => [v.id, v.postedAt ? postIdsOf(v.results, store.fbPageId) : []]));
  const allIds = [...new Set([...idsOf.values()].flat())];
  const commentsBy = new Map<string, number>();
  let ordersBy2: Record<string, number> = {};
  let counted = false;
  if (allIds.length) {
    try {
      const rows = await db.conversationMessage.groupBy({
        by: ["externalThreadId"],
        where: { storeId, channelType: "COMMENT", externalThreadId: { in: allIds } },
        _count: { _all: true },
      });
      for (const r of rows) if (r.externalThreadId) commentsBy.set(r.externalThreadId, r._count._all);
      ordersBy2 = await ordersByPost(store.tenantId, allIds);
      counted = true;
    } catch {
      /* counts are a bonus */
    }
  }
  const recent: VideoSignal[] = [];
  for (const v of videos) {
    const spec = (v.spec ?? {}) as SpecLike;
    const ids = idsOf.get(v.id) ?? [];
    const comments: number | null = counted && ids.length ? ids.reduce((n, id) => n + (commentsBy.get(id) ?? 0), 0) : null;
    const orderCount: number | null = counted && ids.length ? ids.reduce((n, id) => n + (ordersBy2[id] ?? 0), 0) : null;
    recent.push({
      daysAgo: Math.floor((now - v.createdAt.getTime()) / DAY),
      objective: spec.plan?.objective ?? null,
      product: v.productId ? nameOf.get(v.productId) ?? null : null,
      look: spec.look ?? null,
      hook: spec.scenes?.find((s) => s.type === "hook")?.text ?? null,
      posted: !!v.postedAt,
      comments,
      orders: orderCount,
    });
  }

  return {
    calendar: marketCalendar(now),
    shop: {
      name: (await brandNameOf(store)) || (store.igUsername ? `@${store.igUsername}` : "shop"),
      tagline: kit?.tagline ?? null,
      cities: profile.cities,
      hours: profile.hours,
      languages: profile.languages,
      orders60: profile.orders,
      messages60: profile.messages,
      hasPhone: !!store.tenant.whatsappNumber?.replace(/\D/g, ""),
    },
    products: productSignals,
    intents: Object.fromEntries(intents.map((r) => [r.intent as string, r._count.intent])),
    recentVideos: recent,
    notes: notes.trim(),
  };
}

/** The signals as the compact text the plan is written from. */
export function signalsText(s: Signals): string {
  const lines: string[] = [];
  lines.push(`Today: ${describeCalendar(s.calendar)}`);
  lines.push(`Shop: ${s.shop.name}${s.shop.tagline ? ` (${s.shop.tagline})` : ""}. Last 60 days: ${s.shop.orders60} orders, ${s.shop.messages60} buyer messages about buying.`);
  if (s.shop.cities.length) lines.push(`Cities that order most: ${s.shop.cities.join(", ")}. Busiest hours (Baghdad): ${s.shop.hours.join(", ") || "unknown"}. Languages: ${s.shop.languages.join(", ") || "unknown"}.`);
  const intents = Object.entries(s.intents).sort((a, b) => b[1] - a[1]);
  if (intents.length) lines.push(`What buyers asked in the last 14 days: ${intents.map(([k, n]) => `${k} ${n}`).join(", ")}.`);
  lines.push("Products (id | name | price | stock | photo | age in days | asked about (14 d) | orders (30 d) | last video):");
  for (const p of s.products.slice(0, 12)) {
    lines.push(`- ${p.id} | ${p.name} | ${p.priceLine ?? "no price"} | ${p.inStock ? "in stock" : "SOLD OUT"} | ${p.hasPhoto ? "photo" : "no photo"} | ${p.ageDays} | ${p.asked14} | ${p.orders30} | ${p.videoDaysAgo === null ? "never" : `${p.videoDaysAgo} d ago`}`);
  }
  if (!s.products.length) lines.push("- (the shop has no products yet)");
  if (s.recentVideos.length) {
    lines.push("Recent videos (newest first):");
    for (const v of s.recentVideos) {
      const result = v.posted ? ` — posted; ${v.comments ?? "?"} comments, ${v.orders ?? "?"} orders from the post` : " — not posted";
      lines.push(`- ${v.daysAgo} d ago: ${v.objective ?? "?"}${v.product ? `, ${v.product}` : ""}, look ${v.look ? lookKey(v.look) : "?"}, hook "${v.hook ?? "?"}"${result}`);
    }
  } else {
    lines.push("No video has been made for this shop yet.");
  }
  lines.push(`Owner's notes about the market right now: ${s.notes || "none"}`);
  return lines.join("\n");
}
