import { db } from "@/lib/db";
import { buyerProfile, type BuyerProfile } from "./stats";

const WINDOW_MS = 60 * 86_400_000;

/** Who buys from this workspace, from the last 60 days of buyer messages and orders. */
export async function loadBuyerProfile(tenantId: string): Promise<BuyerProfile> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [orders, messages] = await Promise.all([
    db.order.findMany({ where: { tenantId, createdAt: { gt: since } }, select: { city: true, productName: true, status: true } }),
    db.conversationMessage.findMany({
      where: { store: { tenantId }, direction: "INBOUND", commentType: { in: ["ORDER", "QUESTION"] }, createdAt: { gt: since } },
      select: { createdAt: true, language: true },
      take: 5000,
    }),
  ]);
  return buyerProfile(messages, orders);
}
