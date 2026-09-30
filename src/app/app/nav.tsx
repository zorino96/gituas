"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Home, MessageCircle, MessagesSquare, Newspaper, Package, SquarePlus } from "lucide-react";

import { useT } from "@/lib/i18n/client";

type Kind = "MERCHANT" | "NEWS";

// Kept local (not imported from "./data") so this client component never
// pulls in data.ts's server-only imports (@/lib/db, @/auth).
function baseFor(kind: Kind): "/app" | "/newsroom" {
  return kind === "NEWS" ? "/newsroom" : "/app";
}

export function Tabs({ kind }: { kind: Kind }) {
  const path = usePathname();
  const t = useT();
  const base = baseFor(kind);
  const shared = [
    { href: `${base}/comments`, label: t.nav.comments, Icon: MessagesSquare },
    { href: `${base}/messages`, label: t.nav.messages, Icon: MessageCircle },
    { href: `${base}/publish`, label: t.nav.publish, Icon: SquarePlus },
    { href: `${base}/insights`, label: t.nav.insights, Icon: BarChart3 },
  ];
  const tabs =
    kind === "MERCHANT"
      ? [{ href: base, label: t.nav.today, Icon: Home }, { href: `${base}/automation`, label: t.nav.automation, Icon: Bot }, { href: `${base}/orders`, label: t.nav.orders, Icon: Package }, ...shared]
      : [{ href: `${base}/news`, label: t.nav.news, Icon: Newspaper }, ...shared];

  return (
    <div className="gm-tabs">
      <nav aria-label={t.nav.label}>
        {tabs.map(({ href, label, Icon }) => {
          const active = href === base ? path === base : path.startsWith(href);
          return (
            <Link key={href} href={href} className="gm-tab" aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
              {label}
              <Pending />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Screens load live data from Facebook and Instagram, which takes a few
 * seconds. Instead of a streamed loading screen — which left a hidden second
 * copy of every page in the document — the tapped tab shows it is working.
 */
export function Pending() {
  const { pending } = useLinkStatus();
  const t = useT();
  return pending ? <span className="gm-pending" role="status" aria-label={t.common.wait} /> : null;
}
