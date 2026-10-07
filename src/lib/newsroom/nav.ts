// The newsroom's sections, in one list for the sidebar, the phone bar and the
// "?" help link. Later parts add entries here (team, monitor, review, calendar).
// Labels are in the dictionaries: t.nr.shell.nav.items[key] and .groups[key].

import type { GuideId } from "./guide";

export type NavKey = "news" | "publish" | "videos" | "comments" | "messages" | "insights" | "team" | "settings" | "guide";
export type NavGroup = "desk" | "audience" | "account";

export interface NavItem {
  key: NavKey;
  href: string;
  group: NavGroup;
  /** Shown in the phone bar; the rest live in the "more" sheet. */
  mobile: boolean;
  /** The guide section the "?" link opens on this screen. */
  guide: GuideId;
}

export const NAV_GROUPS: readonly { key: NavGroup }[] = [{ key: "desk" }, { key: "audience" }, { key: "account" }];

export const NAV: readonly NavItem[] = [
  { key: "news", href: "/newsroom/news", group: "desk", mobile: true, guide: "stories" },
  { key: "publish", href: "/newsroom/publish", group: "desk", mobile: true, guide: "publish" },
  { key: "videos", href: "/newsroom/videos", group: "desk", mobile: false, guide: "publish" },
  { key: "comments", href: "/newsroom/comments", group: "audience", mobile: true, guide: "comments" },
  { key: "messages", href: "/newsroom/messages", group: "audience", mobile: false, guide: "comments" },
  { key: "insights", href: "/newsroom/insights", group: "audience", mobile: true, guide: "insights" },
  { key: "team", href: "/newsroom/team", group: "account", mobile: false, guide: "team" },
  { key: "settings", href: "/newsroom/settings", group: "account", mobile: false, guide: "connect" },
  { key: "guide", href: "/newsroom/guide", group: "account", mobile: false, guide: "start" },
];

/** The section a path belongs to: its own href or anything below it. */
export function activeItem(path: string): NavItem | undefined {
  return NAV.find((i) => path === i.href || path.startsWith(`${i.href}/`));
}
