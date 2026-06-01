"use client";

import { usePathname } from "next/navigation";

export function CockpitHeader({ workspaceSlug }: { workspaceSlug: string }) {
  const path = usePathname();
  const segments = path.split("/").filter(Boolean);

  // /dashboard/<x>/<y> → cockpit / <x> / <y>
  const crumbs = ["cockpit", ...segments.slice(1)].map((s) => s.replace(/-/g, " "));

  return (
    <header className="border-b border-line h-12 px-5 flex items-center justify-between bg-bg">
      <div className="flex items-center gap-2 font-mono text-xs text-fg-dim">
        <span className="text-fg">{workspaceSlug}</span>
        <span>·</span>
        {crumbs.map((c, i) => (
          <span key={i} className={i === crumbs.length - 1 ? "text-fg" : "text-fg-dim"}>
            {c}
            {i < crumbs.length - 1 && <span className="mx-1.5 text-fg-dim">/</span>}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 font-mono text-xs text-fg-dim">
        <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded border border-line">
          ⌕ jump · <kbd className="text-money">cmd-k</kbd>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="led" /> live
        </span>
      </div>
    </header>
  );
}
