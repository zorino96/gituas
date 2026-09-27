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
  X,
  type LucideIcon,
} from "lucide-react";

import { Pending } from "@/app/app/nav";
import { activeItem, NAV, NAV_GROUPS, type NavKey } from "@/lib/newsroom/nav";

const ICONS: Record<NavKey, LucideIcon> = {
  news: Newspaper,
  publish: SquarePlus,
  comments: MessagesSquare,
  messages: MessageCircle,
  insights: BarChart3,
  settings: Settings,
  guide: BookOpen,
};

function signOutOfNewsroom() {
  void signOut({ callbackUrl: "/login?next=/newsroom/news" });
}

function Brand() {
  return (
    <p className="nr-brand kufi">
      <span className="nr-live" aria-hidden="true" />
      گیتواس نیوزڕووم
    </p>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const current = activeItem(usePathname());
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <div key={g.key} className="nr-group">
          <p className="nr-group-label">{g.label}</p>
          {NAV.filter((i) => i.group === g.key).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="nr-link" aria-current={on ? "page" : undefined} onClick={onNavigate}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {i.label}
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
  return (
    <button type="button" className="nr-link" onClick={signOutOfNewsroom}>
      <LogOut aria-hidden="true" strokeWidth={1.8} />
      چوونەدەرەوە
    </button>
  );
}

/** Desktop sidebar (hidden under 960px by CSS). */
export function SideNav() {
  return (
    <aside className="nr-side">
      <Brand />
      <nav aria-label="بەشەکانی نیوزڕووم" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <NavLinks />
      </nav>
      <div className="nr-foot">
        <SignOutButton />
      </div>
    </aside>
  );
}

/** Phone bar: four sections plus "more", which opens every section in a sheet (hidden from 960px by CSS). */
export function BottomNav() {
  const current = activeItem(usePathname());
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="gm-tabs">
        <nav aria-label="بەشەکان">
          {NAV.filter((i) => i.mobile).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="gm-tab" aria-current={on ? "page" : undefined}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {i.label}
                <Pending />
              </Link>
            );
          })}
          <button type="button" className="gm-tab nr-more" aria-expanded={open} aria-controls="nr-sheet" onClick={() => setOpen(true)}>
            <Menu aria-hidden="true" strokeWidth={1.8} />
            زیاتر
          </button>
        </nav>
      </div>
      {open && (
        <>
          <div className="nr-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <div id="nr-sheet" className="nr-sheet" role="dialog" aria-modal="true" aria-label="هەموو بەشەکان">
            <div className="nr-sheet-head">
              <Brand />
              <button ref={closeRef} type="button" className="nr-help" aria-label="داخستن" onClick={() => setOpen(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="هەموو بەشەکان" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
            <div className="nr-foot">
              <SignOutButton />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** "?" in the top bar: opens the guide at the section for the current screen. */
export function HelpLink() {
  const item = activeItem(usePathname());
  return (
    <Link href={`/newsroom/guide#${item?.guide ?? "start"}`} className="nr-help" aria-label="ڕێنمایی ئەم بەشە" title="ڕێنمایی">
      <CircleHelp size={17} aria-hidden="true" />
    </Link>
  );
}
