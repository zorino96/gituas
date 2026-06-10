import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ApprovalShortcuts } from "./approval-shortcuts";
import { ApprovalActions } from "./approval-actions";

// Instagram publishing polls the media container for up to ~45s before going
// live — keep the approve action's serverless window wide enough for it.
export const maxDuration = 60;

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const requests = await db.approvalRequest.findMany({
    where: {
      status: "PENDING",
      project: { tenantId: tenant.id },
    },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { id: true, name: true } } },
  });

  const weeklyStats = await db.approvalRequest.groupBy({
    by: ["status"],
    where: {
      project: { tenantId: tenant.id },
      createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    _count: { _all: true },
  });
  const statBy = (s: string) => weeklyStats.find((g) => g.status === s)?._count._all ?? 0;
  const total7d = weeklyStats.reduce((s, g) => s + g._count._all, 0);

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">queue</div>
          <div className="mt-1 font-mono text-3xl">
            <span className="text-money">{requests.length}</span>
            <span className="text-fg-dim text-base ml-2">waiting · auto in 14m</span>
          </div>
        </div>
        <div className="font-mono text-xs text-fg-dim">
          shortcuts:
          <span className="ml-2"><Kbd>A</Kbd> approve</span>
          <span className="ml-3"><Kbd>R</Kbd> reject</span>
          <span className="ml-3"><Kbd>E</Kbd> edit</span>
          <span className="ml-3"><Kbd>J</Kbd>/<Kbd>K</Kbd> nav</span>
        </div>
      </div>

      <ApprovalShortcuts ids={requests.map((r) => r.id)} />

      <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center text-sm text-fg-dim">
              no approvals pending — everything else is running on autopilot.
            </div>
          ) : (
            requests.map((r) => {
              const payload = r.payload as { preview?: string; platform?: string; name?: string; budget?: number };
              const mark = (r.project.name[0] ?? "?").toUpperCase();
              return (
                <div key={r.id} className="rounded-xl border border-line bg-panel p-5">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <div className="flex items-center gap-3">
                      <span className="h-6 w-6 grid place-items-center rounded-sm bg-money/10 text-money">{mark}</span>
                      <span className="text-fg lowercase">{actorFor(r.kind)}</span>
                      <span className="text-fg-dim">·</span>
                      <span className="text-fg-dim lowercase">{r.project.name}</span>
                      {payload.platform && (
                        <>
                          <span className="text-fg-dim">·</span>
                          <span className="text-fg-dim lowercase">{payload.platform.toLowerCase().replace(/_/g, " ")}</span>
                        </>
                      )}
                    </div>
                    <span className="text-money">
                      {payload.budget ? `$${payload.budget}` : kindBadge(r.kind)}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-dim">
                    {r.kind.toLowerCase().replace(/_/g, " ")}
                  </div>
                  {payload.preview && (
                    <p className="mt-3 text-sm leading-relaxed">{payload.preview}</p>
                  )}
                  {payload.name && !payload.preview && (
                    <p className="mt-3 text-sm font-medium">{payload.name}</p>
                  )}
                  <ApprovalActions approvalId={r.id} />
                </div>
              );
            })
          )}
        </div>

        <aside className="space-y-4">
          <SideBlock heading="this week's queue">
            <Row left="actions" right={String(total7d)} />
            <Row left="approved" right={String(statBy("APPROVED"))} accent />
            <Row left="rejected" right={String(statBy("REJECTED"))} />
            <Row left="expired" right={String(statBy("EXPIRED"))} />
          </SideBlock>

          <SideBlock heading="auto-approval rules">
            <Row left="x · replies" right="< 280 chars" />
            <Row left="ig · static" right="all" />
            <Row left="tiktok video" right="manual" />
            <Row left="any spend" right="> $25 manual" />
            <Row left="claude · merge" right="manual" />
          </SideBlock>
        </aside>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-line text-money border border-line">{children}</span>;
}
function SideBlock({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">{heading}</div>
      <ul className="space-y-1.5 text-xs">{children}</ul>
    </div>
  );
}
function Row({ left, right, accent }: { left: string; right: string; accent?: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-fg-dim lowercase">{left}</span>
      <span className={`font-mono ${accent ? "text-money" : "text-fg"}`}>{right}</span>
    </li>
  );
}
function actorFor(kind: string): string {
  if (kind === "CONTENT_POST") return "@gemini";
  if (kind === "AD_CAMPAIGN") return "@router";
  if (kind === "REPLY") return "@gemini";
  if (kind === "COMMENT_ACTION") return "@gemini";
  if (kind === "DEPLOY") return "@claude";
  return "@operator";
}
function kindBadge(kind: string): string {
  if (kind === "DEPLOY") return "MERGE";
  if (kind === "AD_CAMPAIGN") return "$ AD";
  return "$0";
}
