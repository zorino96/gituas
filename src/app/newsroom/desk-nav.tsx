"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  BookOpen,
  CircleHelp,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Settings,
  SquarePlus,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";

import { Pending } from "@/app/app/nav";
import { useT } from "@/lib/i18n/client";
import { activeItem, NAV, NAV_GROUPS, type NavKey } from "@/lib/newsroom/nav";

const ICONS: Record<NavKey, LucideIcon> = {
  news: Newspaper,
  publish: SquarePlus,
  videos: Video,
  comments: MessagesSquare,
  messages: MessageCircle,
  insights: BarChart3,
  team: Users,
  settings: Settings,
  guide: BookOpen,
};

function signOutOfNewsroom() {
  void signOut({ callbackUrl: "/login?next=/newsroom/news" });
}

function Brand() {
  const t = useT().nr.shell;
  return (
    <p className="nr-brand kufi">
      <span className="nr-live" aria-hidden="true" />
      {t.name}
    </p>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const current = activeItem(usePathname());
  const t = useT().nr.shell.nav;
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <div key={g.key} className="gm-navgroup">
          <p className="gm-navlabel">{t.groups[g.key]}</p>
          {NAV.filter((i) => i.group === g.key).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="gm-navlink" aria-current={on ? "page" : undefined} onClick={() => onNavigate?.(i.href)}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {t.items[i.key]}
                <Pending />
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SignOutButton() {
  const t = useT().nr.shell;
  return (
    <button type="button" className="gm-navlink" onClick={signOutOfNewsroom}>
      <LogOut aria-hidden="true" strokeWidth={1.8} />
      {t.signOut}
    </button>
  );
}

/** Desktop sidebar (hidden under 960px by CSS). */
export function SideNav() {
  const t = useT().nr.shell.nav;
  return (
    <aside className="gm-side">
      <div className="gm-side-brand">
        <Brand />
      </div>
      <nav aria-label={t.sideLabel} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <NavLinks />
      </nav>
      <div className="gm-side-foot">
        <SignOutButton />
      </div>
    </aside>
  );
}

/** Phone bar: four sections plus "more", which opens every section in a sheet (hidden from 960px by CSS). */
export function BottomNav() {
  const path = usePathname();
  const current = activeItem(path);
  const t = useT().nr.shell.nav;
  // The sheet belongs to the page it was opened on: after a link is tapped it
  // stays up, showing that link's loading bar, until the route changes.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const sheetRef = useRef<HTMLDialogElement>(null);

  // A native modal dialog traps focus, makes the page behind it inert, closes
  // on Escape and hands focus back to "more" — closing always ends in onClose.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
  }, [open]);

  return (
    <>
      <div className="gm-tabs">
        <nav aria-label={t.barLabel}>
          {NAV.filter((i) => i.mobile).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="gm-tab" aria-current={on ? "page" : undefined}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {t.items[i.key]}
                <Pending />
              </Link>
            );
          })}
          <button type="button" className="gm-tab nr-more" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpenAt(path)}>
            <Menu aria-hidden="true" strokeWidth={1.8} />
            {t.more}
          </button>
        </nav>
      </div>
      <dialog
        ref={sheetRef}
        className="nr-sheet"
        aria-label={t.all}
        onClose={(e) => {
          // The close event is queued; ignore a late one that lands after the sheet was reopened.
          if (!e.currentTarget.open) setOpenAt(null);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpenAt(null); // the backdrop
        }}
      >
        <div className="nr-sheet-body">
          <div className="nr-sheet-head">
            <Brand />
            <button type="button" className="nr-help" aria-label={t.close} onClick={() => setOpenAt(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label={t.all} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <NavLinks onNavigate={(href) => href === path && setOpenAt(null)} />
          </nav>
          <div className="gm-side-foot">
            <SignOutButton />
          </div>
        </div>
      </dialog>
    </>
  );
}

/** "?" in the top bar: opens the guide at the section for the current screen. */
export function HelpLink() {
  const item = activeItem(usePathname());
  const t = useT().nr.shell.nav;
  return (
    <Link href={`/newsroom/guide#${item?.guide ?? "start"}`} className="nr-help" aria-label={t.help} title={t.helpTitle}>
      <CircleHelp size={17} aria-hidden="true" />
    </Link>
  );
}
