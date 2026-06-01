import { auth } from "@/auth";
import { db } from "@/lib/db";

const AGENTS = [
  { handle: "@claude", role: "code · bug-fix prs", color: "text-money" },
  { handle: "@gemini", role: "research · plans · drafting", color: "text-mint" },
  { handle: "@router", role: "picks the right model per task", color: "text-amber" },
  { handle: "@operator", role: "hibernation · scaling · housekeeping", color: "text-fg-dim" },
];

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const counts = await db.auditLog.groupBy({
    by: ["actor"],
    where: { tenantId: tenant.id, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    _count: { _all: true },
  });
  const countFor = (h: string): number => {
    const map: Record<string, string> = {
      "@claude": "AI_CLAUDE",
      "@gemini": "AI_GEMINI",
      "@router": "AI_ROUTER",
      "@operator": "SYSTEM",
    };
    const actor = map[h];
    return counts.find((g) => g.actor === actor)?._count._all ?? 0;
  };

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">agents · last 24h</div>
        <div className="mt-1 font-mono text-3xl">
          <span className="text-money">{counts.reduce((s, g) => s + g._count._all, 0)}</span>
          <span className="text-fg-dim text-base ml-2">actions</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {AGENTS.map((a) => {
          const n = countFor(a.handle);
          return (
            <div key={a.handle} className="rounded-xl border border-line bg-panel p-5">
              <div className={`font-mono text-lg ${a.color}`}>{a.handle}</div>
              <div className="text-xs text-fg-dim mt-1">{a.role}</div>
              <div className="mt-4 font-mono text-3xl">{n}</div>
              <div className="text-[10px] uppercase tracking-wider text-fg-dim font-mono mt-1">last 24h</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-line bg-panel p-5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">
          ask the brain · ↳ routes to gemini or claude
        </div>
        <div className="rounded-md border border-line bg-bg p-4 font-mono text-sm text-fg-dim">
          coming soon · the @router will take natural-language questions ("why did sales drop tuesday?") and stitch together logs, stripe, ads, and analytics to answer them.
        </div>
      </div>
    </div>
  );
}
