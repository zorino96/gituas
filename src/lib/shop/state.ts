import { db } from "@/lib/db";
import { newestFirst, unexpired } from "@/lib/oauth/pick";
import type { MetaPlatform } from "./meta-client";
import { startOfUtcDay } from "./pipeline";
import { dailyCap, SHOP_LIMITS, type StorePlan } from "./plans";
import { aiVaryUsed } from "./quota";

const DAY = 86_400_000;

/** Everything the automation and products pages show for one store of a workspace.
 *  With no (or an unknown) `storeId`, the store of a connected account comes first (`preferAccountIds`), then the oldest. */
export async function loadShopState(tenantId: string, storeId?: string, preferAccountIds: string[] = []) {
  const stores = await db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const isPreferred = (s: (typeof stores)[number]) => (!!s.fbPageId && preferAccountIds.includes(s.fbPageId)) || (!!s.igUserId && preferAccountIds.includes(s.igUserId));
  const store = stores.find((s) => s.id === storeId) ?? stores.find(isPreferred) ?? stores[0] ?? null;
  if (!store) return { stores, store: null } as const;
  const now = new Date();
  const [templates, products, posts, activePosts, sentToday, aiUsed] = await Promise.all([
    db.automationTemplate.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "asc" } }),
    db.product.findMany({ where: { storeId: store.id, active: true }, include: { variants: { orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" } }),
    db.postAutomation.findMany({ where: { storeId: store.id }, orderBy: { postCreatedAt: "desc" }, take: 60 }),
    db.postAutomation.count({ where: { storeId: store.id, enabled: true, activeUntil: { gt: now } } }),
    db.outboxJob.count({ where: { storeId: store.id, status: "SENT", kind: { in: ["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"] }, updatedAt: { gte: startOfUtcDay(now) } } }),
    aiVaryUsed(store.id),
  ]);
  const plan = store.plan as StorePlan;
  return {
    stores,
    store,
    templates,
    products,
    posts,
    usage: { plan, activePosts, postSlots: SHOP_LIMITS[plan].posts, sentToday, cap: dailyCap(plan, store.dailyCap), aiUsed, aiLimit: SHOP_LIMITS[plan].aiVaryPerMonth },
  } as const;
}

/** Automation outcome per comment id, for badges on the comments page. Workspaces without a store get {}. */
export async function loadCommentOutcomes(tenantId: string, commentIds: string[]): Promise<Record<string, { outcome: string | null; reason: string | null }>> {
  if (!commentIds.length) return {};
  const rows = await db.conversationMessage.findMany({
    where: { store: { tenantId }, channelType: "COMMENT", externalMessageId: { in: commentIds } },
    select: { externalMessageId: true, outcome: true, outcomeReason: true },
  });
  return Object.fromEntries(rows.map((r) => [r.externalMessageId!, { outcome: r.outcome, reason: r.outcomeReason }]));
}

/** After publishing from the composer with a product chosen: tag the new post so its first comment already has the card. */
export async function tagPublishedPost(tenantId: string, platform: MetaPlatform, externalPostId: string, productId: string): Promise<void> {
  // The store of the account that published — a Facebook post id starts with its Page id; Instagram uses the credential the publisher picked.
  let store: { id: string; expiryDays: number } | null = null;
  const select = { id: true, expiryDays: true } as const;
  if (platform === "META_FACEBOOK") {
    const fbPageId = externalPostId.split("_")[0];
    if (fbPageId) store = await db.store.findFirst({ where: { tenantId, fbPageId }, select });
  } else {
    const cred = await db.oAuthCredential.findFirst({
      where: { tenantId, provider: "META_INSTAGRAM", ...unexpired() },
      orderBy: newestFirst,
      select: { providerAccountId: true },
    });
    if (cred) store = await db.store.findFirst({ where: { tenantId, igUserId: cred.providerAccountId }, select });
  }
  if (!store) return;
  const product = await db.product.findFirst({ where: { id: productId, storeId: store.id, active: true }, select: { id: true } });
  if (!product) return;
  const now = new Date();
  await db.postAutomation.upsert({
    where: { storeId_platform_externalPostId: { storeId: store.id, platform, externalPostId } },
    create: { storeId: store.id, platform, externalPostId, postCreatedAt: now, activeUntil: new Date(now.getTime() + store.expiryDays * DAY), productId: product.id },
    update: { productId: product.id, enabled: true },
  });
}
