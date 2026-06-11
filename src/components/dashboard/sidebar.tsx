import Link from "next/link";

interface Props {
  userHandle: string;
  userImage: string | null;
  plan: string;
  walletDollars: string;
  pendingApprovals: number;
  projects: { id: string; name: string; status: string }[];
}

const NAV = [
  { href: "/dashboard", label: "fleet", glyph: "▣" },
  { href: "/dashboard/wallet", label: "wallet", glyph: "$" },
  { href: "/dashboard/approvals", label: "approvals", glyph: "✓", badge: true },
  { href: "/dashboard/engagement", label: "engagement", glyph: "✦" },
  { href: "/dashboard/activity", label: "audit log", glyph: "≡" },
  { href: "/dashboard/agents", label: "agents", glyph: "◉" },
];
const BOTTOM = [
  { href: "/dashboard/integrations", label: "integrations", glyph: "⌬" },
  { href: "/dashboard/settings", label: "settings", glyph: "⚙" },
];

function mark(name: string): string {
  // First letter, uppercase, for the M·N·V·B style project marks
  return (name[0] ?? "?").toUpperCase();
}
function statusLabel(s: string): string {
  if (s === "HIBERNATING") return "·zz·";
  if (s === "PAUSED") return "·||·";
  return "";
}

export function Sidebar({ userHandle, userImage, plan, walletDollars, pendingApprovals, projects }: Props) {
  return (
    <aside className="w-60 shrink-0 border-r border-line flex flex-col bg-panel">
      <Link href="/" className="px-5 pt-5 pb-3 flex items-center gap-2 font-semibold">
        <span className="inline-block h-6 w-6 rounded-sm bg-money grid place-items-center text-bg font-bold text-xs">G</span>
        <span className="lowercase tracking-tight">gituas</span>
      </Link>

      <div className="px-5 pb-4 border-b border-line">
        <div className="flex items-center gap-2 text-xs">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt="" className="h-6 w-6 rounded-full border border-line" />
          ) : (
            <span className="h-6 w-6 rounded-full bg-line grid place-items-center font-mono">
              {userHandle[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <span className="font-mono text-fg">@{userHandle.toLowerCase().replace(/[^a-z0-9]+/g, "")}</span>
          <span className="text-fg-dim">·</span>
          <span className="font-mono text-fg-dim lowercase">{plan.toLowerCase()} plan</span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-mono text-fg-dim text-xs">$</span>
          <span className="font-mono text-money text-lg">{walletDollars}</span>
          <span className="font-mono text-[10px] text-fg-dim">wallet</span>
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        <ul className="space-y-0.5">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-fg-dim hover:text-fg hover:bg-line"
              >
                <span className="font-mono text-money w-4 text-center">{n.glyph}</span>
                <span className="lowercase flex-1">{n.label}</span>
                {n.badge && pendingApprovals > 0 && (
                  <span className="font-mono text-[10px] px-1.5 rounded bg-amber/10 text-amber">{pendingApprovals}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-6 px-3 font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          projects · {projects.length}
        </div>
        <ul className="mt-2 space-y-0.5">
          {projects.slice(0, 20).map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/projects/${p.id}`}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-fg-dim hover:text-fg hover:bg-line"
              >
                <span className="font-mono w-4 text-center text-money">{mark(p.name)}</span>
                <span className="lowercase flex-1 truncate">{p.name}</span>
                {statusLabel(p.status) && (
                  <span className="font-mono text-[10px] text-fg-dim">{statusLabel(p.status)}</span>
                )}
              </Link>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-fg-dim italic">no projects yet</li>
          )}
        </ul>
      </nav>

      <div className="px-2 py-3 border-t border-line">
        <ul className="space-y-0.5">
          {BOTTOM.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-fg-dim hover:text-fg hover:bg-line"
              >
                <span className="font-mono text-money w-4 text-center">{n.glyph}</span>
                <span className="lowercase">{n.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
