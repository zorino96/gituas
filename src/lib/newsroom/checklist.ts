// First-run steps for a new desk, computed from what the desk really has — so
// the card disappears on its own once the channel is set up.

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

export function checklist(s: ChecklistState): ChecklistStep[] {
  return [
    { key: "connect", label: "پەیجێکی فەیسبووک، ئینستاگرام یان تیکتۆک ببەستەوە", href: "/newsroom/settings", done: s.pagesConnected > 0 },
    { key: "brand", label: "لۆگۆی کەناڵەکەت دابنێ", href: "/newsroom/settings", done: s.logoSet },
    { key: "sources", label: "وشە سەرەکییەکان یان RSSێک دابنێ", href: "/newsroom/settings", done: s.keywords > 0 || s.rssFeeds > 0 },
    { key: "card", label: "یەکەم کارتت دروست بکە", href: "/newsroom/news", done: s.cardsMade > 0 },
    { key: "publish", label: "یەکەم هەواڵت بڵاو بکەرەوە", href: "/newsroom/news?tab=ready", done: s.postsPublished > 0 },
  ];
}

export function checklistDone(steps: readonly ChecklistStep[]): boolean {
  return steps.every((s) => s.done);
}
