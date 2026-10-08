"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Home, MessageCircle, MessagesSquare, Newspaper, Package, Phone, Settings, SquarePlus } from "lucide-react";

import { useT } from "@/lib/i18n/client";

type Kind = "MERCHANT" | "NEWS";

// Kept local (not imported from "./data") so this client component never
// pulls in data.ts's server-only imports (@/lib/db, @/auth).
function baseFor(kind: Kind): "/app" | "/newsroom" {
  return kind === "NEWS" ? "/newsroom" : "/app";
}

/** The sections, in order, each marked active when the current path is inside it. */
function useSections(kind: Kind) {
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
      ? [{ href: base, label: t.nav.today, Icon: Home }, { href: `${base}/automation`, label: t.nav.automation, Icon: Bot }, { href: `${base}/orders`, label: t.nav.orders, Icon: Package }, { href: `${base}/whatsapp`, label: t.wa.nav, Icon: Phone }, ...shared]
      : [{ href: `${base}/news`, label: t.nav.news, Icon: Newspaper }, ...shared];
  return tabs.map((tab) => ({ ...tab, active: tab.href === base ? path === base : path.startsWith(tab.href) }));
}

/** Phone bar along the bottom (hidden from 960px by CSS, where SideNav takes over). */
export function Tabs({ kind }: { kind: Kind }) {
  const t = useT();
  const sections = useSections(kind);

  return (
    <div className="gm-tabs">
      <nav aria-label={t.nav.label}>
        {sections.map(({ href, label, Icon, active }) => (
          <Link key={href} href={href} className="gm-tab" aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
            {label}
            <Pending />
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Desktop sidebar (hidden under 960px by CSS): brand and shop name, the sections, settings at the bottom. */
export function SideNav({ kind, workspace }: { kind: Kind; workspace: string }) {
  const t = useT();
  const path = usePathname();
  const sections = useSections(kind);
  const settingsHref = `${baseFor(kind)}/settings`;
  const onSettings = path.startsWith(settingsHref);

  return (
    <aside className="gm-side">
      <div className="gm-side-brand">
        <span className="gm-mark" aria-hidden="true" />
        <div>
          <p className="kufi">{t.brand}</p>
          <small>{workspace}</small>
        </div>
      </div>
      <nav aria-label={t.nav.label} className="gm-side-nav">
        {sections.map(({ href, label, Icon, active }) => (
          <Link key={href} href={href} className="gm-navlink" aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
            {label}
            <Pending />
          </Link>
        ))}
      </nav>
      <div className="gm-side-foot">
        <Link href={settingsHref} className="gm-navlink" aria-current={onSettings ? "page" : undefined}>
          <Settings aria-hidden="true" strokeWidth={onSettings ? 2.2 : 1.8} />
          {t.layout.settings}
          <Pending />
        </Link>
      </div>
    </aside>
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
