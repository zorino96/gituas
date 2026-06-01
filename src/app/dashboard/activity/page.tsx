import { auth } from "@/auth";
import { db } from "@/lib/db";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; actor?: string; window?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { projectId, actor, window: w } = await searchParams;
  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const since = (() => {
    const ms =
      w === "1h" ? 3_600_000 :
      w === "24h" ? 86_400_000 :
      w === "7d" ? 7 * 86_400_000 :
      w === "30d" ? 30 * 86_400_000 :
      null;
    return ms ? new Date(Date.now() - ms) : null;
  })();

  const logs = await db.auditLog.findMany({
    where: {
      tenantId: tenant.id,
      ...(projectId ? { projectId } : {}),
      ...(actor && actor !== "all" ? { actor: actor as "AI_CLAUDE" | "AI_GEMINI" | "AI_ROUTER" | "USER" | "SYSTEM" } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { project: { select: { id: true, name: true } } },
  });

  const actorCounts = await db.auditLog.groupBy({
    by: ["actor"],
    where: { tenantId: tenant.id },
    _count: { _all: true },
  });
  const actorTotal = actorCounts.reduce((s, g) => s + g._count._all, 0);

  const projects = await db.project.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">audit log</div>
          <div className="mt-1 font-mono text-3xl">
            <span className="text-money">{logs.length.toLocaleString()}</span>
            <span className="text-fg-dim text-base ml-2">events</span>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="led red" />
          <span className="text-money">recording</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr] gap-5 items-start">
        {/* Filters */}
        <aside className="space-y-4">
          <FilterBlock heading={`actor · ${actorTotal}`}>
            <FilterLink href="/dashboard/activity" active={!actor || actor === "all"}>
              all <span className="text-fg-dim">{actorTotal}</span>
            </FilterLink>
            {actorCounts.map((g) => (
              <FilterLink
                key={g.actor}
                href={`/dashboard/activity?actor=${g.actor}${projectId ? `&projectId=${projectId}` : ""}${w ? `&window=${w}` : ""}`}
                active={actor === g.actor}
              >
                ✓ {handleFor(g.actor)} <span className="text-fg-dim">{g._count._all}</span>
              </FilterLink>
            ))}
          </FilterBlock>

          <FilterBlock heading={`project · ${projects.length}`}>
            <FilterLink href="/dashboard/activity" active={!projectId}>all</FilterLink>
            {projects.map((p) => (
              <FilterLink
                key={p.id}
                href={`/dashboard/activity?projectId=${p.id}${actor ? `&actor=${actor}` : ""}${w ? `&window=${w}` : ""}`}
                active={projectId === p.id}
              >
                {p.name}
              </FilterLink>
            ))}
          </FilterBlock>

          <FilterBlock heading="window">
            <div className="flex flex-wrap gap-1">
              {["1h", "24h", "7d", "30d", "all"].map((win) => (
                <a
                  key={win}
                  href={`/dashboard/activity?${new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(actor ? { actor } : {}), ...(win !== "all" ? { window: win } : {}) }).toString()}`}
                  className={`px-2 py-1 rounded font-mono text-[10px] ${
                    (w ?? "all") === win
                      ? "bg-money text-bg"
                      : "border border-line text-fg-dim hover:text-fg"
                  }`}
                >
                  {win}
                </a>
              ))}
            </div>
          </FilterBlock>
        </aside>

        {/* Stream */}
        <div className="rounded-xl border border-line bg-panel overflow-hidden">
          {logs.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-fg-dim">
              no events in this filter — try widening the window.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {logs.map((l) => (
                <li key={l.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-3 font-mono text-xs">
                    <span className="text-fg-dim">
                      {new Date(l.createdAt).toLocaleString("en-GB", { hour12: false })}
                    </span>
                    <span className={actorColor(l.actor)}>{handleFor(l.actor)}</span>
                    {l.project && (
                      <span className="text-fg-dim">{l.project.name}</span>
                    )}
                    <span className={`px-1.5 rounded text-[10px] ${severityClass(l.action)}`}>
                      {severity(l.action)}
                    </span>
                    <span className="text-fg lowercase">{l.action.replace(/_/g, " ")}</span>
                  </div>
                  {l.reasoning && (
                    <div className="mt-1.5 pl-3 text-sm text-fg-dim leading-relaxed">
                      <span className="text-money">↳</span> {l.reasoning}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterBlock({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-2">{heading}</div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}
function FilterLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        className={`block px-2 py-1 rounded text-xs ${
          active ? "bg-line text-fg" : "text-fg-dim hover:bg-line hover:text-fg"
        }`}
      >
        <span className="lowercase">{children}</span>
      </a>
    </li>
  );
}
function handleFor(actor: string): string {
  switch (actor) {
    case "AI_CLAUDE": return "@claude";
    case "AI_GEMINI": return "@gemini";
    case "AI_ROUTER": return "@router";
    case "USER": return "@founder";
    case "SYSTEM": return "@operator";
    default: return `@${actor.toLowerCase()}`;
  }
}
function actorColor(actor: string): string {
  switch (actor) {
    case "AI_CLAUDE": return "text-money";
    case "AI_GEMINI": return "text-mint";
    case "AI_ROUTER": return "text-amber";
    case "USER": return "text-fg";
    case "SYSTEM": return "text-fg-dim";
    default: return "text-fg-dim";
  }
}
function severity(action: string): string {
  if (action.includes("error") || action.includes("rejected")) return "WARN";
  if (action.includes("deposit") || action.includes("withdraw")) return "SENSITIVE";
  if (action.includes("pause") || action.includes("hibernat")) return "WARN";
  return "INFO";
}
function severityClass(action: string): string {
  const s = severity(action);
  if (s === "WARN") return "bg-amber/10 text-amber";
  if (s === "SENSITIVE") return "bg-mint/10 text-mint";
  return "bg-line text-fg-dim";
}
