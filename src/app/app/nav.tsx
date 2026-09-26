"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Home, MessageCircle, MessagesSquare, Newspaper, SquarePlus } from "lucide-react";

const SHARED = [
  { href: "/app/comments", label: "کۆمێنت", Icon: MessagesSquare },
  { href: "/app/messages", label: "نامە", Icon: MessageCircle },
  { href: "/app/publish", label: "بڵاوکردنەوە", Icon: SquarePlus },
  { href: "/app/insights", label: "ئامار", Icon: BarChart3 },
] as const;

const TABS = {
  MERCHANT: [{ href: "/app", label: "ئەمڕۆ", Icon: Home }, ...SHARED],
  NEWS: [{ href: "/app/news", label: "هەواڵ", Icon: Newspaper }, ...SHARED],
} as const;

export function Tabs({ kind }: { kind: "MERCHANT" | "NEWS" }) {
  const path = usePathname();
  return (
    <div className="gm-tabs">
      <nav aria-label="بەشەکان">
        {TABS[kind].map(({ href, label, Icon }) => {
          const active = href === "/app" ? path === "/app" : path.startsWith(href);
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
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="gm-pending" role="status" aria-label="چاوەڕێ بکە" /> : null;
}
