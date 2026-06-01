import { AndroidStatusBar, MobileTabBar } from "./status-bar";

interface Log {
  actor: string;
  action: string;
  createdAt: Date;
  projectName: string | null;
  reasoning: string | null;
}

const STUB: Log[] = [
  { actor: "AI_HIGGSFIELD", action: "video render 47%. ETA 4m20s.", createdAt: new Date(Date.now() - 60_000), projectName: "moodboard.exe", reasoning: null },
  { actor: "AI_GEMINI", action: "TikTok promo ready for your review.", createdAt: new Date(Date.now() - 4 * 60_000), projectName: "merch-mage", reasoning: null },
  { actor: "AI_CLAUDE", action: "merged PR #284 · checkout v2 live.", createdAt: new Date(Date.now() - 18 * 60_000), projectName: "merch-mage", reasoning: null },
  { actor: "AI_ROUTER", action: "paused google-ads #44 · cpa exceeded ltv.", createdAt: new Date(Date.now() - 22 * 60_000), projectName: "merch-mage", reasoning: null },
  { actor: "AI_CLAUDE", action: "opened issue #312 · stripe webhook 429s.", createdAt: new Date(Date.now() - 60 * 60_000), projectName: "vibedb", reasoning: null },
  { actor: "SYSTEM", action: "14 new customers · +$266.00 to wallet.", createdAt: new Date(Date.now() - 2 * 3600_000), projectName: "merch-mage", reasoning: null },
];

export function AndroidActivity({ logs }: { logs: Log[] }) {
  const list = logs.length > 0 ? logs : STUB;

  return (
    <div className="relative h-full">
      <AndroidStatusBar />

      <div className="px-4 pt-3 pb-20">
        <div className="flex items-center justify-between">
          <button className="font-mono text-base text-fg">≡</button>
          <span className="font-mono lowercase text-sm">gituas</span>
          <button className="font-mono text-fg-dim text-sm">⌕ N</button>
        </div>

        <h1 className="mt-5 text-2xl font-light tracking-tight lowercase">activity</h1>

        <div className="mt-3 flex gap-1.5 text-[10px] font-mono overflow-x-auto pb-1">
          <Chip active>all</Chip>
          <Chip>needs you · 3</Chip>
          <Chip>wins</Chip>
          <Chip>alerts</Chip>
        </div>

        <ul className="mt-4 space-y-2.5">
          {list.map((l, i) => (
            <li key={i} className="rounded-xl border border-line bg-panel-2 p-3">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className={actorColor(l.actor)}>
                  {handleFor(l.actor).toUpperCase()}{l.projectName && ` · ${l.projectName.toUpperCase()}`}
                </span>
                <span className="text-fg-dim">{relative(l.createdAt)}</span>
              </div>
              <div className="mt-1 text-[12px] lowercase leading-snug">{l.action.replace(/_/g, " ")}</div>
              {l.reasoning && (
                <div className="mt-1.5 text-[11px] text-fg-dim leading-snug">
                  <span className="text-money">↳</span> {l.reasoning}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <MobileTabBar android active="audit" />
    </div>
  );
}

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`px-2.5 py-1 rounded-full border whitespace-nowrap lowercase ${active ? "bg-money text-bg border-money" : "border-line text-fg-dim"}`}>
      {children}
    </span>
  );
}

function handleFor(actor: string): string {
  switch (actor) {
    case "AI_CLAUDE": return "@claude";
    case "AI_GEMINI": return "@gemini";
    case "AI_ROUTER": return "@router";
    case "AI_HIGGSFIELD": return "@higgsfield";
    case "USER": return "@founder";
    case "SYSTEM": return "@stripe";
    default: return `@${actor.toLowerCase()}`;
  }
}
function actorColor(actor: string): string {
  switch (actor) {
    case "AI_CLAUDE": return "text-money";
    case "AI_GEMINI": return "text-mint";
    case "AI_ROUTER": return "text-amber";
    case "AI_HIGGSFIELD": return "text-mint";
    case "USER": return "text-fg";
    case "SYSTEM": return "text-fg-dim";
    default: return "text-fg-dim";
  }
}
function relative(d: Date): string {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
