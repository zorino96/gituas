import { redirect } from "next/navigation";

import { currentWorkspace } from "@/app/app/data";
import { BillingClient } from "@/app/app/billing/billing-client";
import { loadInvoices, settleReturn } from "@/app/app/billing/load";
import { waylConfigured, waylEnv } from "@/lib/billing/wayl";
import { db } from "@/lib/db";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";

export const dynamic = "force-dynamic";

export default async function NewsroomBillingPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (ws.kind !== "NEWS") redirect("/newsroom");
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{NOT_ALLOWED}</p>;

  const sp = await searchParams;
  // Confirm first, so the plan and invoices below already show the payment.
  const result = await settleReturn(ws.id, sp.invoice);
  const [tenant, invoices] = await Promise.all([
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true, planPaidUntil: true } }),
    loadInvoices(ws.id),
  ]);

  return (
    <BillingClient
      product="NEWS"
      configured={waylConfigured()}
      env={waylEnv()}
      result={result}
      targets={[
        {
          id: ws.id,
          name: ws.name,
          plan: tenant?.plan ?? "MANUAL",
          paidUntil: tenant?.planPaidUntil ? tenant.planPaidUntil.toISOString() : null,
        },
      ]}
      invoices={invoices}
    />
  );
}
