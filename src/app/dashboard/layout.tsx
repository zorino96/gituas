import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/dashboard/sidebar";
import { CockpitHeader } from "@/components/dashboard/cockpit-header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true, slug: true, plan: true, name: true },
  });
  const wallet = tenant
    ? await db.wallet.findUnique({ where: { tenantId: tenant.id }, select: { balanceCents: true } })
    : null;
  const pendingApprovals = tenant
    ? await db.approvalRequest.count({
        where: { status: "PENDING", project: { tenantId: tenant.id } },
      })
    : 0;
  const projects = tenant
    ? await db.project.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, status: true },
      })
    : [];

  void Link;

  return (
    <div className="min-h-screen flex bg-bg text-fg">
      <Sidebar
        userHandle={session.user.name ?? "operator"}
        userImage={session.user.image ?? null}
        plan={tenant?.plan ?? "MANUAL"}
        walletDollars={((wallet?.balanceCents ?? 0) / 100).toFixed(2)}
        pendingApprovals={pendingApprovals}
        projects={projects}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <CockpitHeader workspaceSlug={tenant?.slug ?? "workspace"} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
