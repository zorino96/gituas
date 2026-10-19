// The shortcut buttons: each one is a fixed list of read tools. No model is called for them.

import type { ChatKind, QuickId } from "./types";

export const QUICK_PLAN: Record<QuickId, { tool: string; args: Record<string, unknown> }[]> = {
  today: [
    { tool: "orders_summary", args: { range: "today" } },
    { tool: "list_comments", args: { unanswered: true, limit: 5 } },
    { tool: "list_conversations", args: { unanswered: true, limit: 5 } },
    { tool: "list_scheduled_posts", args: {} },
  ],
  orders: [{ tool: "list_orders", args: { limit: 10 } }],
  comments: [{ tool: "list_comments", args: { unanswered: true, limit: 10 } }],
  messages: [{ tool: "list_conversations", args: { unanswered: true, limit: 10 } }],
  scheduled: [{ tool: "list_scheduled_posts", args: {} }],
  coach: [{ tool: "get_coach_note", args: {} }],
};

/** The desk's shortcut buttons (tools of the news desk; the three shared ones accept both kinds). */
export const NEWS_QUICK_PLAN: Record<string, { tool: string; args: Record<string, unknown> }[]> = {
  today: [
    { tool: "list_stories", args: { tab: "new", limit: 5 } },
    { tool: "list_stories", args: { tab: "ready", limit: 5 } },
    { tool: "list_comments", args: { unanswered: true, limit: 5 } },
    { tool: "list_scheduled_posts", args: {} },
  ],
  stories: [{ tool: "list_stories", args: { tab: "new", limit: 10 } }],
  ready: [{ tool: "list_stories", args: { tab: "ready", limit: 10 } }],
  comments: [{ tool: "list_comments", args: { unanswered: true, limit: 10 } }],
  messages: [{ tool: "list_conversations", args: { unanswered: true, limit: 10 } }],
  scheduled: [{ tool: "list_scheduled_posts", args: {} }],
};

export const quickPlanOf = (kind: ChatKind, id: string): { tool: string; args: Record<string, unknown> }[] =>
  (kind === "news" ? NEWS_QUICK_PLAN : (QUICK_PLAN as Record<string, { tool: string; args: Record<string, unknown> }[]>))[id] ?? [];

