"use client";

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CalendarClock,
  Clapperboard,
  Ellipsis,
  Home,
  LifeBuoy,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Package,
  Phone,
  Settings,
  ShoppingBag,
  Sparkles,
  SquarePlus,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";

import { useT } from "@/lib/i18n/client";

type Kind = "MERCHANT" | "NEWS";
type Group = "main" | "inbox" | "create" | "automate" | "grow";

interface Section {
  href: string;
  label: string;
  Icon: LucideIcon;
  group: Group;
  /** Shown in the phone's bottom bar; the rest wait behind "More". */
  primary: boolean;
  active: boolean;
}

// Kept local (not imported from "./data") so this client component never
// pulls in data.ts's server-only imports (@/lib/db, @/auth).
function baseFor(kind: Kind): "/app" | "/newsroom" {
  return kind === "NEWS" ? "/newsroom" : "/app";
}

/** The sections, in order, each marked active when the current path is inside it. */
function useSections(kind: Kind, studio: boolean, video: boolean): Section[] {
  const path = usePathname();
  const t = useT();
  const base = baseFor(kind);
  const s = (href: string, label: string, Icon: LucideIcon, group: Group, primary = false) => ({ href, label, Icon, group, primary });
  const tabs =
    kind === "MERCHANT"
      ? [
          s(base, t.nav.today, Home, "main", true),
          s(`${base}/assistant`, t.nav.assistant, LifeBuoy, "main"),
          s(`${base}/comments`, t.nav.comments, MessagesSquare, "inbox", true),
          s(`${base}/messages`, t.nav.messages, MessageCircle, "inbox", true),
          s(`${base}/orders`, t.nav.orders, Package, "inbox", true),
          s(`${base}/whatsapp`, t.wa.nav, Phone, "inbox"),
          s(`${base}/publish`, t.nav.publish, SquarePlus, "create"),
          ...(video ? [s(`${base}/video`, t.nav.video, Clapperboard, "create")] : []),
          ...(studio ? [s(`${base}/studio`, t.studio.nav, Sparkles, "create")] : []),
          s(`${base}/automation`, t.nav.automation, Bot, "automate"),
          s(`${base}/products`, t.nav.products, ShoppingBag, "automate"),
          s(`${base}/autopilot`, t.nav.autopilot, CalendarClock, "automate"),
          s(`${base}/boost`, t.nav.boost, Target, "grow"),
          s(`${base}/insights`, t.nav.insights, BarChart3, "grow"),
        ]
      : [
          s(`${base}/news`, t.nav.news, Newspaper, "main", true),
          s(`${base}/comments`, t.nav.comments, MessagesSquare, "main", true),
          s(`${base}/messages`, t.nav.messages, MessageCircle, "main", true),
          s(`${base}/publish`, t.nav.publish, SquarePlus, "main", true),
          s(`${base}/insights`, t.nav.insights, BarChart3, "main", true),
        ];
  return tabs.map((tab) => ({ ...tab, active: tab.href === base ? path === base : path.startsWith(tab.href) }));
}

/**
 * Phone bar along the bottom (hidden from 960px by CSS, where SideNav takes over): the sections
 * used every day, then "More" with everything else. Eleven tabs on a phone were unreadable.
 * `studio`: show the Studio only once it can make pictures (src/lib/studio/ready.ts).
 */
export function Tabs({ kind, studio = false, video = false }: { kind: Kind; studio?: boolean; video?: boolean }) {
  const t = useT();
  const path = usePathname();
  const sections = useSections(kind, studio, video);
  const [open, setOpen] = useState(false);
  const primary = sections.filter((s) => s.primary);
  const rest = sections.filter((s) => !s.primary);
  const settingsHref = `${baseFor(kind)}/settings`;
  const onSettings = path.startsWith(settingsHref);
  const restActive = rest.some((s) => s.active) || onSettings;

  // Opening a section closes the sheet.
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <div className="gm-tabs">
        <nav aria-label={t.nav.label}>
          {primary.map(({ href, label, Icon, active }) => (
            <Link key={href} href={href} className="gm-tab" aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
              {label}
              <Pending />
            </Link>
          ))}
          <button type="button" className="gm-tab" aria-haspopup="dialog" aria-expanded={open} aria-current={restActive ? "page" : undefined} onClick={() => setOpen(true)}>
            <Ellipsis aria-hidden="true" strokeWidth={restActive ? 2.2 : 1.8} />
            {t.nav.more}
          </button>
        </nav>
      </div>
      {open && (
        <div className="gm-sheet-scrim" onClick={() => setOpen(false)}>
          <div className="gm-sheet" role="dialog" aria-modal="true" aria-label={t.nav.more} onClick={(e) => e.stopPropagation()}>
            <div className="gm-sheet-head">
              <b>{t.nav.more}</b>
              <button type="button" className="gm-btn quiet small" onClick={() => setOpen(false)} aria-label={t.nav.close}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="gm-sheet-grid">
              {[...rest, { href: settingsHref, label: t.layout.settings, Icon: Settings, active: onSettings }].map(({ href, label, Icon, active }) => (
                <Link key={href} href={href} className="gm-sheet-item" aria-current={active ? "page" : undefined}>
                  <Icon aria-hidden="true" strokeWidth={1.8} />
                  <span>{label}</span>
                  <Pending />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Desktop sidebar (hidden under 960px by CSS): brand and shop name, the sections in groups, settings at the bottom. */
export function SideNav({ kind, workspace, studio = false, video = false }: { kind: Kind; workspace: string; studio?: boolean; video?: boolean }) {
  const t = useT();
  const path = usePathname();
  const sections = useSections(kind, studio, video);
  const settingsHref = `${baseFor(kind)}/settings`;
  const onSettings = path.startsWith(settingsHref);
  const groups: { group: Group; label: string | null }[] = [
    { group: "main", label: null },
    { group: "inbox", label: t.nav.groups.inbox },
    { group: "create", label: t.nav.groups.create },
    { group: "automate", label: t.nav.groups.automate },
    { group: "grow", label: t.nav.groups.grow },
  ];

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
        {groups.map(({ group, label }) => {
          const items = sections.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="gm-navgroup">
              {label && kind === "MERCHANT" && <p className="gm-navlabel">{label}</p>}
              {items.map(({ href, label: text, Icon, active }) => (
                <Link key={href} href={href} className="gm-navlink" aria-current={active ? "page" : undefined}>
                  <Icon aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
                  {text}
                  <Pending />
                </Link>
              ))}
            </div>
          );
        })}
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
