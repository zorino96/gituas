import { AndroidStatusBar, MobileTabBar } from "./status-bar";

const STUB = [
  { name: "merch-mage", delta: "↑ 18%", rev: "$1,204" },
  { name: "nicely-typed", delta: "↑ 24%", rev: "$842" },
  { name: "vibedb", delta: "↑ 6%", rev: "$640" },
  { name: "moodboard.exe", delta: "render 47%", rev: "$502" },
  { name: "tiny-rss", delta: "scaled 4d", rev: "$320" },
];

export function AndroidFleet({ projects }: { projects: { id: string; name: string; status: string }[] }) {
  const list = projects.length > 0
    ? projects.map((p, i) => ({
        name: p.name,
        delta: i === 0 ? "↑ 18%" : i === 1 ? "↑ 24%" : i === 2 ? "↑ 6%" : "—",
        rev: i === 0 ? "$1,204" : i === 1 ? "$842" : i === 2 ? "$640" : "$0",
      }))
    : STUB;

  return (
    <div className="relative h-full">
      <AndroidStatusBar />

      <div className="px-4 pt-3 pb-24">
        <div className="flex items-center justify-between">
          <button className="font-mono text-base text-fg">≡</button>
          <span className="font-mono lowercase text-sm">gituas</span>
          <button className="font-mono text-fg-dim text-sm">⌕ N</button>
        </div>

        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">fleet revenue · today</div>
          <div className="mt-1 font-mono text-3xl text-money">$3,840.22</div>
          <div className="font-mono text-[10px] text-fg-dim mt-1">↑ 18.4% wow · 7 projects awake</div>
          <div className="mt-3 flex items-end gap-1 h-10">
            {[35, 50, 40, 65, 55, 70, 80].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <span className="w-full bg-money rounded-sm" style={{ height: `${h}%` }} />
                <span className="font-mono text-[8px] text-fg-dim">{["m", "t", "w", "t", "f", "s", "s"][i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex gap-1 font-mono text-[10px]">
          <Chip active>all · {list.length}</Chip>
          <Chip>live · {list.length - 1}</Chip>
          <Chip>queued · 1</Chip>
          <Chip>hibernating · 1</Chip>
        </div>

        <ul className="mt-3 space-y-2">
          {list.map((p) => {
            const mark = (p.name[0] ?? "?").toUpperCase();
            return (
              <li key={p.name} className="rounded-xl border border-line bg-panel-2 p-3 flex items-center gap-3">
                <span className="h-8 w-8 rounded-md bg-money/10 text-money grid place-items-center font-mono text-sm">{mark}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm lowercase truncate">{p.name}</div>
                  <div className="font-mono text-[10px] text-money">{p.delta}</div>
                </div>
                <span className="font-mono text-base">{p.rev}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <MobileTabBar android active="fleet" />
    </div>
  );
}

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full border lowercase ${
        active ? "bg-money text-bg border-money" : "border-line text-fg-dim"
      }`}
    >
      {children}
    </span>
  );
}
