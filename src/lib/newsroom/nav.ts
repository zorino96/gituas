// The newsroom's sections, in one list for the sidebar, the phone bar and the
// "?" help link. Later parts add entries here (team, monitor, review, calendar).
// Labels are in the dictionaries: t.nr.shell.nav.items[key] and .groups[key].

import type { GuideId } from "./guide";

export type NavKey = "news" | "publish" | "videos" | "comments" | "messages" | "insights" | "sources" | "autopilot" | "videoSetup" | "brand" | "assistant" | "chatHistory" | "team" | "settings" | "guide";
export type NavGroup = "desk" | "audience" | "setup" | "account";

export interface NavItem {
  key: NavKey;
  href: string;
  group: NavGroup;
  /** Shown in the phone bar; the rest live in the "more" sheet. */
  mobile: boolean;
  /** The guide section the "?" link opens on this screen. */
  guide: GuideId;
}

export const NAV_GROUPS: readonly { key: NavGroup }[] = [{ key: "desk" }, { key: "audience" }, { key: "setup" }, { key: "account" }];

export const NAV: readonly NavItem[] = [
  { key: "news", href: "/newsroom/news", group: "desk", mobile: true, guide: "stories" },
  { key: "publish", href: "/newsroom/publish", group: "desk", mobile: true, guide: "publish" },
  { key: "videos", href: "/newsroom/videos", group: "desk", mobile: false, guide: "publish" },
  { key: "comments", href: "/newsroom/comments", group: "audience", mobile: true, guide: "comments" },
  { key: "messages", href: "/newsroom/messages", group: "audience", mobile: false, guide: "comments" },
  { key: "insights", href: "/newsroom/insights", group: "audience", mobile: true, guide: "insights" },
  // The desk's own setup, each in its own screen (they used to be one long Settings page).
  { key: "sources", href: "/newsroom/sources", group: "setup", mobile: false, guide: "sources" },
  { key: "autopilot", href: "/newsroom/autopilot", group: "setup", mobile: false, guide: "publish" },
  { key: "videoSetup", href: "/newsroom/video-setup", group: "setup", mobile: false, guide: "publish" },
  { key: "brand", href: "/newsroom/brand", group: "setup", mobile: false, guide: "brand" },
  { key: "assistant", href: "/newsroom/assistant", group: "account", mobile: false, guide: "start" },
  { key: "team", href: "/newsroom/team", group: "account", mobile: false, guide: "team" },
  { key: "settings", href: "/newsroom/settings", group: "account", mobile: false, guide: "connect" },
  { key: "guide", href: "/newsroom/guide", group: "account", mobile: false, guide: "start" },
];

/**
 * The sections as the sidebar and the phone sheet list them. With the desk's chat on, the Assistant (the chat) is where most work
 * starts, so it is the first entry of the main group; with it off it keeps its old place in "account" and opens the older assistant.
 * The phone bar's four tabs are not touched (they are pinned by tests/newsroom/nav.test.ts).
 */
export function navFor(chatOn: boolean): readonly NavItem[] {
  const assistant = NAV.find((i) => i.key === "assistant");
  if (!chatOn || !assistant) return NAV;
  // The chat's history sits right under it (a menu entry that is not a section of its own: the chat frame shows the same list).
  const history: NavItem = { key: "chatHistory", href: "/newsroom/assistant/history", group: "desk", mobile: false, guide: "start" };
  return [{ ...assistant, group: "desk" }, history, ...NAV.filter((i) => i.key !== "assistant")];
}

/** The section a path belongs to: its own href or anything below it. */
export function activeItem(path: string): NavItem | undefined {
  return NAV.find((i) => path === i.href || path.startsWith(`${i.href}/`));
}
