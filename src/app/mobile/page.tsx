import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { IosHome } from "@/components/mobile/ios-home";
import { IosApprove } from "@/components/mobile/ios-approve";
import { IosWallet } from "@/components/mobile/ios-wallet";
import { IosProject } from "@/components/mobile/ios-project";
import { AndroidFleet } from "@/components/mobile/android-fleet";
import { AndroidBrain } from "@/components/mobile/android-brain";
import { AndroidActivity } from "@/components/mobile/android-activity";

export const metadata = {
  title: "gituas · mobile cockpit preview",
};

export default async function MobilePreviewPage() {
  const session = await auth();

  // Pull real data when signed in; otherwise the mockups use stub numbers.
  let projects: { id: string; name: string; status: string }[] = [];
  let walletDollars = "1204.22";
  let pendingApprovals = 12;
  let recentLogs: { actor: string; action: string; createdAt: Date; projectName: string | null; reasoning: string | null }[] = [];

  if (session?.user?.id) {
    const tenant = await db.tenant.findFirst({
      where: { ownerId: session.user.id },
      select: { id: true },
    });
    if (tenant) {
      const [ps, wallet, pending, logs] = await Promise.all([
        db.project.findMany({
          where: { tenantId: tenant.id },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, status: true },
        }),
        db.wallet.findUnique({ where: { tenantId: tenant.id }, select: { balanceCents: true } }),
        db.approvalRequest.count({ where: { status: "PENDING", project: { tenantId: tenant.id } } }),
        db.auditLog.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { project: { select: { name: true } } },
        }),
      ]);
      projects = ps;
      if (wallet) walletDollars = (wallet.balanceCents / 100).toFixed(2);
      pendingApprovals = pending;
      recentLogs = logs.map((l) => ({
        actor: l.actor,
        action: l.action,
        createdAt: l.createdAt,
        projectName: l.project?.name ?? null,
        reasoning: l.reasoning,
      }));
    }
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            href={session ? "/dashboard" : "/"}
            className="inline-flex items-center gap-2 text-sm text-fg-dim hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>back</span>
          </Link>
          <div className="font-mono text-xs text-money">
            / / mobile cockpit · v0.9.4 preview
          </div>
          <span className="font-mono text-xs text-fg-dim">{session ? "live data" : "stub data"}</span>
        </div>
      </header>

      {/* iOS row */}
      <section className="border-b border-line">
        <div className="max-w-[1600px] mx-auto px-6 py-12">
          <div className="font-mono text-xs text-money mb-2">/ 07 · ios · cockpit</div>
          <h2 className="text-3xl font-light tracking-tight">give it to us and sleep — <span className="text-money">on your phone.</span></h2>
          <p className="mt-3 text-fg-dim text-sm max-w-2xl">
            mobile is a cockpit — review · approve · glance — not a mini-dashboard.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-8 lg:gap-12">
            <PhoneFrame label="01 · home">
              <IosHome
                walletDollars={walletDollars}
                pendingApprovals={pendingApprovals}
                projects={projects}
              />
            </PhoneFrame>
            <PhoneFrame label="02 · swipe to approve">
              <IosApprove />
            </PhoneFrame>
            <PhoneFrame label="03 · wallet · withdraw">
              <IosWallet walletDollars={walletDollars} />
            </PhoneFrame>
            <PhoneFrame label="04 · project detail">
              <IosProject project={projects[0] ?? null} />
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* Android row */}
      <section>
        <div className="max-w-[1600px] mx-auto px-6 py-12">
          <div className="font-mono text-xs text-money mb-2">/ 08 · android · material 3 cockpit</div>
          <h2 className="text-3xl font-light tracking-tight">lowercase, terminal-fluent, <span className="text-money">material 3.</span></h2>

          <div className="mt-10 flex flex-wrap justify-center gap-8 lg:gap-12">
            <PhoneFrame label="fleet" android>
              <AndroidFleet projects={projects} />
            </PhoneFrame>
            <PhoneFrame label="ask the brain" android>
              <AndroidBrain />
            </PhoneFrame>
            <PhoneFrame label="activity" android>
              <AndroidActivity logs={recentLogs} />
            </PhoneFrame>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="max-w-7xl mx-auto px-6 py-6 font-mono text-xs text-fg-dim flex justify-between">
          <span>© 2026 GITUAS LABS</span>
          <span>v0.9.4 · static preview</span>
        </div>
      </footer>
    </div>
  );
}

function PhoneFrame({ label, android, children }: { label: string; android?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div
        className={`relative bg-bg rounded-[44px] border-[10px] ${android ? "border-line" : "border-fg-dim/30"} shadow-money-lg overflow-hidden`}
        style={{ width: 320, height: 660 }}
      >
        {/* notch / status bar background */}
        {!android && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 h-6 w-28 rounded-full bg-bg z-10" />
        )}
        <div className="w-full h-full overflow-y-auto bg-panel">{children}</div>
      </div>
    </div>
  );
}
