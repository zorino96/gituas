"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n/client";
import { NAV } from "@/lib/newsroom/nav";

/** The desk's setup screens as tabs: one tap between sources, automatic publishing, video and brand. */
export function SetupTabs({ current }: { current?: string }) {
  const nav = useT().nr.shell.nav;
  const tabs = NAV.filter((i) => i.group === "setup");
  return (
    <div className="gm-row" role="navigation" aria-label={nav.groups.setup} style={{ flexWrap: "wrap", marginBottom: 14 }}>
      {tabs.map((i) => (
        <Link key={i.key} href={i.href} className={`gm-btn small ${i.key === current ? "" : "quiet"}`} aria-current={i.key === current ? "page" : undefined}>
          {nav.items[i.key]}
        </Link>
      ))}
    </div>
  );
}
