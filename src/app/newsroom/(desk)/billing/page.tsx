import { redirect } from "next/navigation";

import { currentWorkspace } from "@/app/app/data";
import { BillingClient } from "@/app/app/billing/billing-client";
import { workspaceChips } from "@/app/app/billing/chips";
import { loadAccounts, loadInvoices, settleReturn } from "@/app/app/billing/load";
import { newsroomAccess } from "@/lib/billing/trial";
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
  const [tenant, invoices, accounts] = await Promise.all([
    db.tenant.findUnique({ where: { id: ws.id }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } }),
    loadInvoices(ws.id),
    loadAccounts(ws.id),
  ]);

  const access = tenant ? newsroomAccess(tenant, new Date()) : null;

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
          chips: workspaceChips(accounts),
          trialDaysLeft: access?.reason === "trial" ? access.daysLeft : null,
        },
      ]}
      invoices={invoices}
    />
  );
}
