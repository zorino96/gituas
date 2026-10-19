// The shortcut buttons: each one is a fixed list of read tools. No model is called for them.

import type { QuickId } from "./types";

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
};
