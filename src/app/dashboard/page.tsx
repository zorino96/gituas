import Link from "next/link";

import { auth } from "@/auth";
import { db } from "@/lib/db";

export default async function FleetPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const [projects, recentLogs] = await Promise.all([
    db.project.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: "desc" },
      include: {
        mode: true,
        personality: { select: { updatedAt: true } },
        adCampaigns: { select: { spentCents: true } },
        contentPosts: { select: { id: true } },
      },
    }),
    db.auditLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { project: { select: { name: true } } },
    }),
  ]);

  const awake = projects.filter((p) => p.status === "ACTIVE").length;
  const hibernating = projects.filter((p) => p.status === "HIBERNATING").length;
  const queued = projects.filter((p) => p.status === "PAUSED").length;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">fleet revenue · today</div>
          <div className="mt-1 font-mono text-4xl text-money">$0.00</div>
          <div className="mt-1 font-mono text-xs text-fg-dim">
            ↑ 0% wow · {awake} awake · {hibernating} hibernating · {queued} queued
          </div>
        </div>
        <Link
          href="/dashboard/projects"
          className="px-4 py-2 rounded-md bg-money text-bg font-mono text-sm hover:opacity-90"
        >
          + adopt project
        </Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <MiniStat label="ad spend · 24h" value="$0.00" sub="no ads connected" />
        <MiniStat label="ai api · 24h" value="$0.00" sub="gemini 100%" />
        <MiniStat label="infra · 24h" value="$0.00" sub="not deployed" />
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
            projects under management · {projects.length}
          </h2>
          <span className="font-mono text-xs text-money">
            {awake} awake · {hibernating} hibernating · {queued} queued
          </span>
        </div>

        <div className="rounded-xl border border-line bg-panel overflow-hidden">
          {projects.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-fg-dim">
              no projects yet — adopt your first repo to wake the orchestrator.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-panel-2 border-b border-line font-mono text-[10px] uppercase tracking-wider text-fg-dim">
                <tr>
                  <Th>project</Th>
                  <Th>status</Th>
                  <Th>today</Th>
                  <Th>30d gross</Th>
                  <Th>wallet</Th>
                  <Th>cpa / ltv</Th>
                  <Th>agents</Th>
                  <Th>last action</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const m = p.name[0]?.toUpperCase() ?? "?";
                  const statusLed =
                    p.status === "HIBERNATING" ? "dim" :
                    p.status === "PAUSED" ? "amber" : "";
                  const isAuto = p.mode?.masterMode === "AUTO";
                  return (
                    <tr key={p.id} className="border-b border-line hover:bg-panel-2 transition-colors">
                      <Td>
                        <Link href={`/dashboard/projects/${p.id}`} className="inline-flex items-center gap-2 hover:text-money">
                          <span className="h-6 w-6 rounded-sm bg-money/10 text-money grid place-items-center font-mono text-xs">{m}</span>
                          <span className="lowercase">{p.name}</span>
                        </Link>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-dim">
                          <span className={`led ${statusLed}`} />
                          {p.status.toLowerCase()}
                          {isAuto && <span className="text-money ml-1">· auto</span>}
                        </span>
                      </Td>
                      <Td mono>—</Td>
                      <Td mono>—</Td>
                      <Td mono>$0.00</Td>
                      <Td mono>— / —</Td>
                      <Td>
                        <AgentDots project={p} />
                      </Td>
                      <Td>
                        <LastAction projectId={p.id} fallback={p.updatedAt} />
                      </Td>
                      <Td>›</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-dim mb-3 flex items-center gap-2">
          orchestrator firehose · live
          <span className="led" />
          <span className="text-money normal-case">recording</span>
        </h2>
        <div className="rounded-xl border border-line bg-panel p-5 font-mono text-xs">
          {recentLogs.length === 0 ? (
            <div className="text-fg-dim">no events yet — trigger the cron at /api/cron/run-agents to seed activity.</div>
          ) : (
            <ul className="space-y-2">
              {recentLogs.map((l) => (
                <li key={l.id} className="flex gap-3">
                  <span className="text-fg-dim w-20 shrink-0">
                    {new Date(l.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                  <span className={`shrink-0 ${actorColor(l.actor)}`}>{handleFor(l.actor)}</span>
                  {l.project && (
                    <span className="text-fg-dim shrink-0">{l.project.name}</span>
                  )}
                  <span className="text-fg lowercase truncate">{l.action.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-normal px-4 py-2.5">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-3 ${mono ? "font-mono" : ""}`}>{children}</td>;
}
function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className="mt-2 font-mono text-xl text-fg">{value}</div>
      <div className="text-xs text-fg-dim mt-0.5">{sub}</div>
    </div>
  );
}
function AgentDots({ project }: { project: { mode: { contentMode: string; adsMode: string; replyMode: string; commentMode: string; scalingMode: string } | null } }) {
  if (!project.mode) return <span className="text-fg-dim">—</span>;
  const codes = [
    ["C", project.mode.contentMode],
    ["A", project.mode.adsMode],
    ["R", project.mode.replyMode],
    ["M", project.mode.commentMode],
    ["S", project.mode.scalingMode],
  ];
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      {codes.map(([code, mode]) => (
        <span key={code} className={
          mode === "AUTO" ? "text-money" :
          mode === "MANUAL" ? "text-mint" :
          "text-fg-dim opacity-40"
        }>{code}</span>
      ))}
    </span>
  );
}
function LastAction({ projectId, fallback }: { projectId: string; fallback: Date }) {
  void projectId;
  return <span className="text-fg-dim text-xs">{relative(fallback)}</span>;
}
function relative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
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
