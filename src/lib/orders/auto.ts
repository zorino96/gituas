import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface AutoOrderMessage {
  id: string;
  /** The buyer's id on the platform (the DM sender's id). */
  authorId?: string | null;
  /** For a DM, the conversation, which is the buyer; for a comment it is the post. */
  externalThreadId?: string | null;
  authorHandle: string | null;
  channelType: string;
  store: { id: string; tenantId: string };
}

interface AutoOrderProduct {
  id: string;
  name: string;
  variants: { label: string; amountMinor: number; currency: string; inStock: boolean }[];
}

/** A buyer who orders the same product again within this long is asking about the same order. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Who the buyer is, or null when the message does not say. */
export function buyerKeyOf(msg: AutoOrderMessage): string | null {
  return msg.authorId || (msg.channelType === "DM" ? msg.externalThreadId : null) || null;
}

/** An order still open, from this buyer for this product (or for no product), in the last day. */
export function duplicateOrderWhere(
  o: { tenantId: string; buyerKey: string; productId?: string | null },
  now: Date,
): Prisma.OrderWhereInput {
  return {
    tenantId: o.tenantId,
    buyerKey: o.buyerKey,
    productId: o.productId ?? null,
    status: { in: ["NEW", "CONFIRMED"] },
    createdAt: { gt: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
  };
}

/**
 * The order opened for a buyer's ORDER comment or DM. It is priced at the
 * product's first in-stock variant (variants come in the merchant's order),
 * with that variant's label and currency so the amount means something. With
 * no bound product, or none in stock, the amount stays 0 for the merchant to fill.
 */
export function autoOrderData(msg: AutoOrderMessage, product: AutoOrderProduct | null): Prisma.OrderUncheckedCreateInput {
  const variant = product?.variants.find((v) => v.inStock);
  return {
    tenantId: msg.store.tenantId,
    storeId: msg.store.id,
    customerName: msg.authorHandle ?? "",
    productId: product?.id ?? null,
    productName: product?.name ?? "",
    variantLabel: variant?.label ?? "",
    amountMinor: variant?.amountMinor ?? 0,
    currency: variant?.currency ?? "IQD",
    source: msg.channelType === "DM" ? "DM" : "COMMENT",
    sourceMessageId: msg.id,
    buyerKey: buyerKeyOf(msg),
    status: "NEW",
  };
}

/**
 * Opens an order for one message. Keyed by the message, so processing it again
 * never opens a second one, and an existing order (which the merchant may
 * already have edited) is left exactly as it is. A buyer who already has an open
 * order for the same product from the last day gets no second one: their
 * follow-up messages are the same order. Never throws: replying to the buyer
 * matters more than the bookkeeping.
 */
export async function openOrder(msg: AutoOrderMessage, product: AutoOrderProduct | null): Promise<void> {
  try {
    const data = autoOrderData(msg, product);
    if (data.buyerKey) {
      const dup = await db.order.findFirst({
        where: duplicateOrderWhere({ tenantId: data.tenantId, buyerKey: data.buyerKey, productId: data.productId }, new Date()),
        select: { id: true },
      });
      if (dup) return;
    }
    await db.order.upsert({ where: { sourceMessageId: msg.id }, create: data, update: {} });
  } catch (e) {
    console.error("[shop] open order failed:", e instanceof Error ? e.message : "unknown error");
  }
}
