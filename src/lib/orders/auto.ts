import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface AutoOrderMessage {
  id: string;
  authorHandle: string | null;
  channelType: string;
  store: { id: string; tenantId: string };
}

interface AutoOrderProduct {
  id: string;
  name: string;
  variants: { label: string; amountMinor: number; currency: string; inStock: boolean }[];
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
    status: "NEW",
  };
}

/**
 * Opens an order for one message. Keyed by the message, so processing it again
 * never opens a second one, and an existing order (which the merchant may
 * already have edited) is left exactly as it is. Never throws: replying to the
 * buyer matters more than the bookkeeping.
 */
export async function openOrder(msg: AutoOrderMessage, product: AutoOrderProduct | null): Promise<void> {
  try {
    await db.order.upsert({ where: { sourceMessageId: msg.id }, create: autoOrderData(msg, product), update: {} });
  } catch (e) {
    console.error("[shop] open order failed:", e instanceof Error ? e.message : "unknown error");
  }
}
