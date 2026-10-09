import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { nextPaidUntil, PLAN_LABEL, priceFor, type BillingProduct } from "./prices";
import { createLink, getLink, invalidateIfPending, PAID_STATUS, waylConfigured, waylEnv } from "./wayl";

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

/** Tenants allowed to get a real plan from a test-mode payment (comma-separated ids in WAYL_TEST_TENANTS); empty by default. */
function testTenants(): string[] {
  return (process.env.WAYL_TEST_TENANTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Ask Wayl whether the invoice is paid; if so, mark it PAID once and apply the plan.
 * Safe to call from the webhook and the return page at the same time. An EXPIRED invoice can
 * still settle, so a late payment is never lost. "error" means Wayl could not be reached: retry.
 * A test-mode payment is recorded but only grants a plan to tenants in WAYL_TEST_TENANTS ("paid_test").
 */
export async function confirmInvoice(invoiceId: string): Promise<"paid" | "paid_test" | "pending" | "missing" | "error"> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return "missing";
  if (inv.status === "PAID") return "paid";
  if (inv.status !== "PENDING" && inv.status !== "EXPIRED") return "missing";
  const link = await getLink(inv.id);
  if (!link) return "error";
  if (link.status !== PAID_STATUS) return "pending";
  if (link.total == null || link.total !== inv.amountIqd) {
    await db.invoice.update({ where: { id: inv.id }, data: { lastError: `amount mismatch: ${link.total}` } });
    return "pending";
  }
  const applyPlan = inv.env === "live" || testTenants().includes(inv.tenantId);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: inv.id, status: { in: ["PENDING", "EXPIRED"] } }, data: { status: "PAID", paidAt: now } });
    if (claimed.count !== 1) return;
    let applied = false;
    if (applyPlan) {
      if (inv.product === "SHOP" && inv.storeId) {
        // Lock the row so two payments at the same moment both count.
        await tx.$queryRaw`SELECT 1 FROM "Store" WHERE "id" = ${inv.storeId} FOR UPDATE`;
        const s = await tx.store.findUnique({ where: { id: inv.storeId }, select: { plan: true, planPaidUntil: true } });
        if (s) {
          await tx.store.update({
            where: { id: inv.storeId },
            data: { plan: inv.plan as "MERCHANT" | "PRO", planPaidUntil: nextPaidUntil(inv.product as BillingProduct, { plan: s.plan, paidUntil: s.planPaidUntil }, inv.plan, now) },
          });
          applied = true;
        }
      } else if (inv.product === "NEWS") {
        await tx.$queryRaw`SELECT 1 FROM "Tenant" WHERE "id" = ${inv.tenantId} FOR UPDATE`;
        const t = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { plan: true, planPaidUntil: true } });
        if (t) {
          await tx.tenant.update({
            where: { id: inv.tenantId },
            data: { plan: inv.plan as "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE", planPaidUntil: nextPaidUntil(inv.product as BillingProduct, { plan: t.plan, paidUntil: t.planPaidUntil }, inv.plan, now) },
          });
          applied = true;
        }
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId: inv.tenantId,
        actor: "SYSTEM",
        action: applyPlan && !applied ? "billing.paid_not_applied" : "billing.paid",
        // Money arrived but its store is gone: someone has to apply or refund it by hand.
        reasoning: `Paid ${inv.amountIqd} IQD for ${inv.product} ${inv.plan}.${applyPlan && !applied ? " The plan could not be applied (its store no longer exists): apply it or refund by hand." : ""}`,
        metadata: { invoiceId: inv.id, env: inv.env, applied },
      },
    });
  });
  return applyPlan ? "paid" : "paid_test";
}

/**
 * Daily: lapsed shop plans drop back, stale pending invoices are re-checked with Wayl (a paid one
 * settles), and only a still-unpaid one is invalidated at Wayl and expired. If Wayl cannot be
 * reached the invoice is left alone and retried tomorrow.
 */
export async function expireOverdue(now = new Date()): Promise<{ stores: number; invoices: number }> {
  // A lapsed newsroom plan is not downgraded here: freezing is computed from its dates (newsroomAccess).
  const stores = await db.store.updateMany({ where: { planPaidUntil: { lt: now }, NOT: { plan: "FREE" } }, data: { plan: "FREE" } });
  const stale = await db.invoice.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - INVOICE_TTL_MS) } },
    select: { id: true },
    take: 20,
  });
  let invoices = 0;
  for (const { id } of stale) {
    const r = await confirmInvoice(id);
    if (r !== "pending") continue; // paid (settled), or Wayl unreachable (retry tomorrow)
    await invalidateIfPending(id);
    const expired = await db.invoice.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } });
    invoices += expired.count;
  }
  return { stores: stores.count, invoices };
}
