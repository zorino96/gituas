import { confirmInvoice } from "@/lib/billing/invoices";
import { db } from "@/lib/db";
import type { InvoiceRow } from "./billing-client";

/**
 * The buyer comes back from Wayl with ?invoice=<id>. Ask Wayl about it, but only when the
 * invoice belongs to this workspace, so one workspace cannot poke another's invoices.
 */
export async function settleReturn(tenantId: string, invoiceId: unknown): Promise<"paid" | "pending" | null> {
  if (typeof invoiceId !== "string" || !invoiceId) return null;
  const own = await db.invoice.findFirst({ where: { id: invoiceId, tenantId }, select: { id: true } });
  if (!own) return null;
  const r = await confirmInvoice(own.id);
  return r === "missing" ? null : r;
}

/** The workspace's last 10 invoices, newest first. */
export async function loadInvoices(tenantId: string): Promise<InvoiceRow[]> {
  const rows = await db.invoice.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, plan: true, amountIqd: true, status: true, createdAt: true, paidAt: true, storeId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    plan: r.plan,
    amountIqd: r.amountIqd,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    storeId: r.storeId,
  }));
}
