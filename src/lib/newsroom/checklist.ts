// First-run steps for a new desk, computed from what the desk really has — so
// the card disappears on its own once the channel is set up.

import { nrNewsCkb, type NrNewsText } from "@/lib/i18n/nr/news.ckb";

export interface ChecklistState {
  pagesConnected: number;
  logoSet: boolean;
  keywords: number;
  rssFeeds: number;
  cardsMade: number;
  postsPublished: number;
}

export type ChecklistKey = "connect" | "brand" | "sources" | "card" | "publish";

export interface ChecklistStep {
  key: ChecklistKey;
  label: string;
  href: string;
  done: boolean;
}

export function checklist(s: ChecklistState, t: Pick<NrNewsText, "checklist"> = nrNewsCkb): ChecklistStep[] {
  const label = t.checklist.steps;
  return [
    { key: "connect", label: label.connect, href: "/newsroom/settings", done: s.pagesConnected > 0 },
    { key: "brand", label: label.brand, href: "/newsroom/settings", done: s.logoSet },
    { key: "sources", label: label.sources, href: "/newsroom/settings", done: s.keywords > 0 || s.rssFeeds > 0 },
    { key: "card", label: label.card, href: "/newsroom/news", done: s.cardsMade > 0 },
    { key: "publish", label: label.publish, href: "/newsroom/news?tab=ready", done: s.postsPublished > 0 },
  ];
}

export function checklistDone(steps: readonly ChecklistStep[]): boolean {
  return steps.every((s) => s.done);
}
