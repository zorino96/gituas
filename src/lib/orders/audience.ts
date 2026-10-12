import { db } from "@/lib/db";
import { buyerProfile, type BuyerProfile } from "./stats";

const WINDOW_MS = 60 * 86_400_000;

/**
 * Who buys from this workspace, from the last 60 days of buyer messages and orders. With a store id,
 * only that business (one workspace can hold several Pages, each its own store).
 */
export async function loadBuyerProfile(tenantId: string, storeId?: string | null): Promise<BuyerProfile> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [orders, messages] = await Promise.all([
    db.order.findMany({ where: { tenantId, ...(storeId ? { storeId } : {}), createdAt: { gt: since } }, select: { city: true, productName: true, status: true } }),
    db.conversationMessage.findMany({
      where: { store: { tenantId }, ...(storeId ? { storeId } : {}), direction: "INBOUND", commentType: { in: ["ORDER", "QUESTION"] }, createdAt: { gt: since } },
      select: { createdAt: true, language: true },
      take: 5000,
    }),
  ]);
  return buyerProfile(messages, orders);
}

/**
 * The autopilot's two signals, counted by the database so a few rows travel instead of thousands
 * (it runs every minute, and the free database allows ~5 GB of transfer a month): the Baghdad
 * hours buyers write most, and the products ordered most — the same rules as buyerProfile.
 */
export async function loadAutopilotSignals(tenantId: string): Promise<{ hours: number[]; products: string[]; cities: string[] }> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [hourRows, productRows, cityRows] = await Promise.all([
    db.$queryRaw<{ h: number; n: bigint }[]>`
      SELECT ((EXTRACT(HOUR FROM m."createdAt")::int + 3) % 24) AS h, COUNT(*) AS n
      FROM "ConversationMessage" m JOIN "Store" s ON s."id" = m."storeId"
      WHERE s."tenantId" = ${tenantId} AND m."direction" = 'INBOUND' AND m."commentType" IN ('ORDER', 'QUESTION') AND m."createdAt" > ${since}
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 4`,
    db.order.groupBy({
      by: ["productName"],
      where: { tenantId, createdAt: { gt: since }, status: { notIn: ["CANCELLED", "RETURNED"] }, productName: { not: "" } },
      _count: { productName: true },
      orderBy: { _count: { productName: "desc" } },
      take: 3,
    }),
    db.order.groupBy({
      by: ["city"],
      where: { tenantId, createdAt: { gt: since }, status: { notIn: ["CANCELLED", "RETURNED"] }, city: { not: null } },
      _count: { city: true },
      orderBy: { _count: { city: "desc" } },
      take: 3,
    }),
  ]);
  return {
    hours: hourRows.map((r) => Number(r.h)).sort((a, b) => a - b),
    products: productRows.map((r) => r.productName),
    cities: cityRows.map((r) => r.city).filter((c): c is string => !!c),
  };
}

/** How many orders came from comments on each of these posts in the last 90 days. */
export async function ordersByPost(tenantId: string, postIds: string[]): Promise<Record<string, number>> {
  if (!postIds.length) return {};
  const orders = await db.order.findMany({
    where: { tenantId, sourceMessageId: { not: null }, createdAt: { gt: new Date(Date.now() - 90 * 86_400_000) } },
    select: { sourceMessageId: true },
    take: 2000,
  });
  const ids = orders.map((o) => o.sourceMessageId!).filter(Boolean);
  if (!ids.length) return {};
  const msgs = await db.conversationMessage.findMany({ where: { id: { in: ids }, externalThreadId: { in: postIds } }, select: { externalThreadId: true } });
  const out: Record<string, number> = {};
  for (const m of msgs) if (m.externalThreadId) out[m.externalThreadId] = (out[m.externalThreadId] ?? 0) + 1;
  return out;
}
