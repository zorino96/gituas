import { IosStatusBar, MobileTabBar } from "./status-bar";

interface Props {
  walletDollars: string;
  pendingApprovals: number;
  projects: { id: string; name: string; status: string }[];
}

const STUB_PROJECTS = [
  { id: "1", name: "merch-mage", status: "ACTIVE", delta: "+18%", rev: "$1,204" },
  { id: "2", name: "nicely-typed", status: "ACTIVE", delta: "+24%", rev: "$842" },
  { id: "3", name: "vibedb", status: "ACTIVE", delta: "+6%", rev: "$640" },
  { id: "4", name: "moodboard.exe", status: "ACTIVE", delta: "render 47%", rev: "$502" },
];

export function IosHome({ walletDollars, pendingApprovals, projects }: Props) {
  const list = projects.length > 0
    ? projects.slice(0, 4).map((p, i) => ({
        ...p,
        delta: i === 0 ? "+18%" : i === 1 ? "+24%" : i === 2 ? "+6%" : "—",
        rev: i === 0 ? "$1,204" : i === 1 ? "$842" : i === 2 ? "$640" : "$0",
      }))
    : STUB_PROJECTS;

  return (
    <div className="relative h-full">
      <IosStatusBar />

      <div className="px-5 pt-2 pb-24">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-5 w-5 rounded-sm bg-money grid place-items-center text-bg font-bold text-[10px]">G</span>
            <span className="lowercase tracking-tight">gituas</span>
          </div>
          <span className="font-mono text-[10px] text-fg-dim">all awake · N</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="earned today" value="$3,840" />
          <Stat label="spent today" value="$264" muted />
        </div>

        <div className="mt-4 rounded-xl border border-money/40 bg-money/10 p-3">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-fg">needs you · {pendingApprovals}</span>
            <span className="text-amber">auto in 14m</span>
          </div>
          <div className="mt-1.5 text-xs">
            <span className="text-money">@gemini</span> wants to publish a TikTok promo for merch-mage
          </div>
          <div className="mt-2 flex gap-2 font-mono text-[10px]">
            <button className="px-2 py-1 rounded bg-money text-bg">review →</button>
            <button className="px-2 py-1 rounded border border-line text-fg-dim">snooze</button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          <span>fleet · {list.length} projects</span>
          <span className="text-money">↑ 18% wow</span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {list.map((p) => {
            const mark = (p.name[0] ?? "?").toUpperCase();
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-2">
                <span className="h-7 w-7 rounded-sm bg-money/10 text-money grid place-items-center font-mono text-xs">{mark}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm lowercase truncate">{p.name}</div>
                  <div className="text-[10px] text-fg-dim font-mono">
                    {p.status === "HIBERNATING" ? "hibernated · " : "live · "}
                    <span className="text-money">{p.delta}</span>
                  </div>
                </div>
                <span className="font-mono text-sm">{p.rev}</span>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 rounded-xl border border-line bg-panel-2 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">wallet · niko</div>
          <div className="mt-1 font-mono text-2xl text-money">${walletDollars}</div>
          <div className="mt-2 flex gap-2 font-mono text-[10px]">
            <button className="flex-1 px-2 py-1.5 rounded border border-line text-fg-dim">+ deposit</button>
            <button className="flex-1 px-2 py-1.5 rounded bg-money text-bg">withdraw</button>
          </div>
        </div>
      </div>

      <MobileTabBar active="home" />
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-1 font-mono text-lg ${muted ? "text-fg" : "text-money"}`}>{value}</div>
    </div>
  );
}
