import { waylConfigured, waylEnv } from "@/lib/billing/wayl";
import { db } from "@/lib/db";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { currentWorkspace } from "../data";
import { BillingClient } from "./billing-client";
import { storeChips } from "./chips";
import { loadAccounts, loadInvoices, settleReturn } from "./load";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{NOT_ALLOWED}</p>;

  const sp = await searchParams;
  // Confirm first, so the stores and invoices below already show the payment.
  const result = await settleReturn(ws.id, sp.invoice);
  const [stores, invoices, accounts] = await Promise.all([
    db.store.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, fbPageId: true, igUserId: true, igUsername: true, plan: true, planPaidUntil: true } }),
    loadInvoices(ws.id),
    loadAccounts(ws.id),
  ]);

  return (
    <BillingClient
      product="SHOP"
      configured={waylConfigured()}
      env={waylEnv()}
      result={result}
      targets={stores.map((s) => ({
        id: s.id,
        name: s.name || (s.igUsername ? `@${s.igUsername}` : "—"),
        plan: s.plan,
        paidUntil: s.planPaidUntil ? s.planPaidUntil.toISOString() : null,
        chips: storeChips(s, accounts),
      }))}
      invoices={invoices}
    />
  );
}
