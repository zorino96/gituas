import { IosStatusBar, MobileTabBar } from "./status-bar";

interface Props {
  project: { id: string; name: string; status: string } | null;
}

const AGENTS = [
  { handle: "@claude", glyph: "C", action: "merged PR #284 · checkout v2", time: "18m" },
  { handle: "@gemini", glyph: "G", action: "queued tiktok caption", time: "4m" },
  { handle: "@higgsfield", glyph: "H", action: "render 6s promo · 47%", time: "now" },
  { handle: "@router", glyph: "R", action: "paused google-ads #44 · cpa>ltv", time: "22m" },
];

export function IosProject({ project }: Props) {
  const name = project?.name ?? "merch-mage";
  const mark = (name[0] ?? "?").toUpperCase();
  const isAuto = project?.status === "ACTIVE";

  return (
    <div className="relative h-full">
      <IosStatusBar />

      <div className="px-5 pt-2 pb-24">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-sm bg-money/10 text-money grid place-items-center font-mono text-xs">{mark}</span>
          <div className="flex-1 min-w-0">
            <div className="text-base lowercase truncate">{name}</div>
            <div className="font-mono text-[10px] text-fg-dim">
              {isAuto ? "live · 4 agents awake" : "manual"}
            </div>
          </div>
          <button className="font-mono text-[10px] text-fg-dim px-2 py-1 rounded border border-line">⋯</button>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel-2 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">30d gross</div>
          <div className="mt-1 font-mono text-2xl">
            <span className="text-money">$28,420</span>
            <span className="text-fg-dim text-xs ml-2">↑ 31%</span>
          </div>
          <div className="mt-3 flex items-end gap-1 h-12">
            {Array.from({ length: 16 }).map((_, i) => {
              const h = 20 + ((i * 7) % 70);
              return <span key={i} className="flex-1 bg-money/30 rounded-sm" style={{ height: `${h}%` }} />;
            })}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="customers" value="1,428" />
          <MiniStat label="churn" value="2.1%" />
          <MiniStat label="roas · 7d" value="4.2x" money />
        </div>

        <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
            <span className="text-fg-dim">agents · last 24h</span>
            <span className="text-money">4 awake</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {AGENTS.map((a) => (
              <li key={a.handle} className="flex items-center gap-2">
                <span className="h-6 w-6 grid place-items-center rounded bg-line text-money font-mono text-xs">{a.glyph}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-money">{a.handle}</div>
                  <div className="text-[11px] text-fg-dim lowercase truncate">{a.action}</div>
                </div>
                <span className="font-mono text-[10px] text-fg-dim">{a.time}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">wallet · this project</div>
          <div className="mt-1 font-mono text-xl text-fg">$420.10</div>
        </div>
      </div>

      <MobileTabBar active="home" />
    </div>
  );
}

function MiniStat({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 p-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${money ? "text-money" : "text-fg"}`}>{value}</div>
    </div>
  );
}
