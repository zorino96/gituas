"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Home, MessageCircle, MessagesSquare, Newspaper, SquarePlus } from "lucide-react";

type Kind = "MERCHANT" | "NEWS";

// Kept local (not imported from "./data") so this client component never
// pulls in data.ts's server-only imports (@/lib/db, @/auth).
function baseFor(kind: Kind): "/app" | "/newsroom" {
  return kind === "NEWS" ? "/newsroom" : "/app";
}

export function Tabs({ kind }: { kind: Kind }) {
  const path = usePathname();
  const base = baseFor(kind);
  const shared = [
    { href: `${base}/comments`, label: "کۆمێنت", Icon: MessagesSquare },
    { href: `${base}/messages`, label: "نامە", Icon: MessageCircle },
    { href: `${base}/publish`, label: "بڵاوکردنەوە", Icon: SquarePlus },
    { href: `${base}/insights`, label: "ئامار", Icon: BarChart3 },
  ];
  const tabs =
    kind === "MERCHANT"
      ? [{ href: base, label: "ئەمڕۆ", Icon: Home }, { href: `${base}/automation`, label: "ئۆتۆمەیشن", Icon: Bot }, ...shared]
      : [{ href: `${base}/news`, label: "هەواڵ", Icon: Newspaper }, ...shared];

  return (
    <div className="gm-tabs">
      <nav aria-label="بەشەکان">
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
  return pending ? <span className="gm-pending" role="status" aria-label="چاوەڕێ بکە" /> : null;
}
