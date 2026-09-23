"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Home, MessageCircle, MessagesSquare, SquarePlus } from "lucide-react";

const TABS = [
  { href: "/app", label: "ئەمڕۆ", Icon: Home },
  { href: "/app/comments", label: "کۆمێنت", Icon: MessagesSquare },
  { href: "/app/messages", label: "نامە", Icon: MessageCircle },
  { href: "/app/publish", label: "بڵاوکردنەوە", Icon: SquarePlus },
  { href: "/app/insights", label: "ئامار", Icon: BarChart3 },
] as const;

export function Tabs() {
  const path = usePathname();
  return (
    <div className="gm-tabs">
      <nav aria-label="بەشەکان">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/app" ? path === "/app" : path.startsWith(href);
          return (
            <Link key={href} href={href} className="gm-tab" aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
