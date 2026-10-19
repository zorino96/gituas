// The desk's story inbox as a query: the three tabs of the News screen (src/app/newsroom/(desk)/news/page.tsx), without the page. The
// chat's story tools read the inbox through this, so what they list is what the desk sees: the same statuses, the same topic choice, the
// same news-by-prompt rule, newest first, and one row per cluster of stories about the same event.
//
// This is a copy of the page's query on purpose (the page is not changed); if the page's rules change, change them here too.

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { groupByCluster } from "./cluster";
import { focusVisible, loadActiveFocus, type ActiveFocus } from "./focus";
import { categoryWhere } from "./taxonomy";

/** The tabs of the News screen and the story statuses each one shows. */
export const INBOX_TABS = [
  { key: "new", statuses: ["NEW"] },
  { key: "ready", statuses: ["DRAFTED"] },
  { key: "done", statuses: ["PUBLISHED"] },
] as const;
export type InboxTab = (typeof INBOX_TABS)[number]["key"];
export const INBOX_TAB_KEYS = INBOX_TABS.map((t) => t.key) as [InboxTab, ...InboxTab[]];

/** How many of the newest stories of a tab are loaded and grouped (the page loads the same number). */
export const INBOX_TAKE = 150;

/** The chip filters of the page; each is a single value. */
export interface InboxFilter {
  category?: string;
  region?: string;
  lang?: string;
  source?: string;
}

/** One story as the inbox lists it: the item and, when it has one, the few fields of its draft the list needs. */
export interface InboxItem {
  id: string;
  title: string;
  snippet: string;
  sourceName: string;
  url: string;
  lang: string | null;
  publishedAt: Date;
  clusterKey: string;
  status: string;
  category: string | null;
  subcategory: string | null;
  region: string | null;
  imageUrl: string | null;
  draft: { id: string; auto: boolean; cardPath: string | null } | null;
}

export interface InboxGroup {
  /** The newest story of the cluster, the one the list shows. */
  lead: InboxItem;
  /** How many sources wrote about it. */
  count: number;
}

/** What hides stories from the desk's lists: its topic choice and, when it uses news by prompt, the AI's keep-or-hide verdicts. */
async function visibility(tenantId: string): Promise<{ categories: string[]; focus: ActiveFocus | null }> {
  const [settings, focus] = await Promise.all([db.newsSettings.findUnique({ where: { tenantId }, select: { categories: true } }), loadActiveFocus(tenantId)]);
  return { categories: settings?.categories ?? [], focus };
}

function baseWhere(tenantId: string, tab: InboxTab, v: { categories: string[]; focus: ActiveFocus | null }): Prisma.NewsItemWhereInput {
  const statuses = INBOX_TABS.find((t) => t.key === tab)!.statuses;
  return {
    tenantId,
    status: { in: [...statuses] },
    AND: [categoryWhere(v.categories) as Prisma.NewsItemWhereInput, ...(v.focus ? [focusVisible(Date.now())] : [])],
  };
}

/** The stories of one tab, grouped by event: the newest INBOX_TAKE stories, one row per cluster, and how many stories the tab holds. */
export async function loadInbox(tenantId: string, tab: InboxTab, filter: InboxFilter = {}): Promise<{ groups: InboxGroup[]; loaded: number; total: number }> {
  const v = await visibility(tenantId);
  const base = baseWhere(tenantId, tab, v);
  const where: Prisma.NewsItemWhereInput = {
    ...base,
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.region ? { region: filter.region } : {}),
    ...(filter.lang ? { lang: filter.lang } : {}),
    ...(filter.source ? { sourceName: filter.source } : {}),
  };
  const [items, total] = await Promise.all([
    db.newsItem.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: INBOX_TAKE,
      include: { draft: { select: { id: true, auto: true, cardPath: true } } },
    }),
    db.newsItem.count({ where }),
  ]);
  return { groups: groupByCluster(items as InboxItem[]), loaded: items.length, total };
}

/** How many stories each tab holds (before the chip filters), for the desk's overview. */
export async function inboxCounts(tenantId: string): Promise<Record<InboxTab, number>> {
  const v = await visibility(tenantId);
  const [n, r, d] = await Promise.all(INBOX_TABS.map((t) => db.newsItem.count({ where: baseWhere(tenantId, t.key, v) })));
  return { new: n, ready: r, done: d };
}
