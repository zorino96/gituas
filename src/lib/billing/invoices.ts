import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { extendPaidUntil, PLAN_LABEL, priceFor, type BillingProduct } from "./prices";
import { createLink, getLink, PAID_STATUS, waylConfigured, waylEnv } from "./wayl";

const DAY = 86_400_000;
/** Pending invoices older than this are expired by the daily cron. */
export const INVOICE_TTL_MS = 3 * DAY;

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Create an invoice and its Wayl link. The amount always comes from priceFor(),
 * never from the caller. `origin` is where the buyer returns (gituas.com or hawalnoos.com).
 */
export async function startCheckout(i: {
  tenantId: string;
  product: BillingProduct;
  plan: string;
  storeId: string | null;
  origin: string;
  returnPath: string;
}): Promise<CheckoutResult> {
  if (!waylConfigured()) return { ok: false, error: "پارەدان هێشتا ئامادە نییە." };
  const amount = priceFor(i.product, i.plan);
  if (!amount) return { ok: false, error: "پلانەکە دروست نییە." };
  if (i.product === "SHOP") {
    if (!i.storeId || !(await db.store.findFirst({ where: { id: i.storeId, tenantId: i.tenantId }, select: { id: true } }))) {
      return { ok: false, error: "دووکانەکە نەدۆزرایەوە." };
    }
  }
  const secret = randomBytes(24).toString("hex");
  const inv = await db.invoice.create({
    data: { tenantId: i.tenantId, storeId: i.product === "SHOP" ? i.storeId : null, product: i.product, plan: i.plan, amountIqd: amount, env: waylEnv(), webhookSecret: secret },
    select: { id: true },
  });
  const r = await createLink({
    referenceId: inv.id,
    total: amount,
    label: `Gituas — ${PLAN_LABEL[i.plan] ?? i.plan}`,
    webhookUrl: `${SHOP_ORIGIN}/api/billing/wayl`,
    webhookSecret: secret,
    redirectionUrl: `${i.origin}${i.returnPath}?invoice=${inv.id}`,
  });
  if (!r.ok) {
    await db.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", lastError: r.error } });
    console.error("[billing] Wayl link failed:", r.error);
    return { ok: false, error: "دروستکردنی لینکی پارەدان سەرکەوتوو نەبوو. دواتر هەوڵ بدەرەوە." };
  }
  await db.invoice.update({ where: { id: inv.id }, data: { waylLinkId: r.link.id, url: r.link.url } });
  return { ok: true, url: r.link.url! };
}

/**
 * Ask Wayl whether the invoice is paid; if so, mark it PAID once and apply the plan.
 * Safe to call from the webhook and the return page at the same time.
 */
export async function confirmInvoice(invoiceId: string): Promise<"paid" | "pending" | "missing"> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return "missing";
  if (inv.status === "PAID") return "paid";
  if (inv.status !== "PENDING") return "missing";
  const link = await getLink(inv.id);
  if (!link || link.status !== PAID_STATUS) return "pending";
  if (link.total != null && link.total !== inv.amountIqd) {
    await db.invoice.update({ where: { id: inv.id }, data: { lastError: `amount mismatch: ${link.total}` } });
    return "pending";
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "PAID", paidAt: now } });
    if (claimed.count !== 1) return;
    if (inv.product === "SHOP" && inv.storeId) {
      const s = await tx.store.findUnique({ where: { id: inv.storeId }, select: { planPaidUntil: true } });
      if (s) await tx.store.update({ where: { id: inv.storeId }, data: { plan: inv.plan as "MERCHANT" | "PRO", planPaidUntil: extendPaidUntil(s.planPaidUntil, now) } });
    } else if (inv.product === "NEWS") {
      const t = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { planPaidUntil: true } });
      if (t) await tx.tenant.update({ where: { id: inv.tenantId }, data: { plan: inv.plan as "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE", planPaidUntil: extendPaidUntil(t.planPaidUntil, now) } });
    }
    await tx.auditLog.create({
      data: { tenantId: inv.tenantId, actor: "SYSTEM", action: "billing.paid", reasoning: `Paid ${inv.amountIqd} IQD for ${inv.product} ${inv.plan}.`, metadata: { invoiceId: inv.id, env: inv.env } },
    });
  });
  return "paid";
}

/** Daily: lapsed plans drop back, stale pending invoices expire. */
export async function expireOverdue(now = new Date()): Promise<{ stores: number; tenants: number; invoices: number }> {
  const [stores, tenants, invoices] = await Promise.all([
    db.store.updateMany({ where: { planPaidUntil: { lt: now }, NOT: { plan: "FREE" } }, data: { plan: "FREE" } }),
    db.tenant.updateMany({ where: { kind: "NEWS", planPaidUntil: { lt: now }, NOT: { plan: "LITE" } }, data: { plan: "LITE" } }),
    db.invoice.updateMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - INVOICE_TTL_MS) } }, data: { status: "EXPIRED" } }),
  ]);
  return { stores: stores.count, tenants: tenants.count, invoices: invoices.count };
}
