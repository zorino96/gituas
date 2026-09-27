// The newsroom's sections, in one list for the sidebar, the phone bar and the
// "?" help link. Later parts add entries here (team, monitor, review, calendar).

import type { GuideId } from "./guide";

export type NavKey = "news" | "publish" | "comments" | "messages" | "insights" | "team" | "settings" | "guide";
export type NavGroup = "desk" | "audience" | "account";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  group: NavGroup;
  /** Shown in the phone bar; the rest live in the "more" sheet. */
  mobile: boolean;
  /** The guide section the "?" link opens on this screen. */
  guide: GuideId;
}

export const NAV_GROUPS: readonly { key: NavGroup; label: string }[] = [
  { key: "desk", label: "مێزی هەواڵ" },
  { key: "audience", label: "بینەران" },
  { key: "account", label: "کەناڵ" },
];

export const NAV: readonly NavItem[] = [
  { key: "news", href: "/newsroom/news", label: "هەواڵەکان", group: "desk", mobile: true, guide: "stories" },
  { key: "publish", href: "/newsroom/publish", label: "بڵاوکردنەوە", group: "desk", mobile: true, guide: "publish" },
  { key: "comments", href: "/newsroom/comments", label: "کۆمێنت", group: "audience", mobile: true, guide: "comments" },
  { key: "messages", href: "/newsroom/messages", label: "نامە", group: "audience", mobile: false, guide: "comments" },
  { key: "insights", href: "/newsroom/insights", label: "ئامار", group: "audience", mobile: true, guide: "insights" },
  { key: "team", href: "/newsroom/team", label: "تیم", group: "account", mobile: false, guide: "team" },
  { key: "settings", href: "/newsroom/settings", label: "ڕێکخستن", group: "account", mobile: false, guide: "connect" },
  { key: "guide", href: "/newsroom/guide", label: "ڕێنمایی", group: "account", mobile: false, guide: "start" },
];

/** The section a path belongs to: its own href or anything below it. */
export function activeItem(path: string): NavItem | undefined {
  return NAV.find((i) => path === i.href || path.startsWith(`${i.href}/`));
}
