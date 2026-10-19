// The read tools that talk to Meta and Google: comments, messages and the account's insights. They use the same loaders as the
// shop screens (src/app/app/data.ts), each held to the request's deadline: a call that cannot finish in time is not started, and
// a slow or failed one becomes a reason the tool turns into a note, never a throw.

import {
  loadAccountLists,
  loadConnections,
  loadConversations,
  loadInsights,
  loadPosts,
  loadYouTube,
  type Connections,
  type InsightsResult,
  type PostsResult,
} from "@/app/app/data";
import { db } from "@/lib/db";
import type { YouTubeBlock } from "@/lib/merchant/youtube-insights";
import type { MConversation, MPost } from "@/lib/merchant/types";
import { scopedAccount } from "@/lib/oauth/account-scope";
import { marketSignals } from "@/lib/orders/market";
import { loadCommentOutcomes } from "@/lib/shop/state";
import { commentItems, type AccountsRead, type CommentItem } from "./reads-shape";
import { withinDeadline, type Live } from "./reads-shared";

const DAY = 86_400_000;

export type Unreadable = "not_connected" | "no_time" | "timeout" | "failed";

const metaConnected = (c: Connections): boolean => c.META_FACEBOOK.connected || c.META_INSTAGRAM.connected;

/**
 * The account each platform's live read covered, for a platform that has several connected (see AccountsRead). `chosen` is set when
 * the person chose that account in the chat (the whole turn runs inside their choice, see lib/chat/accounts.ts); without a choice the
 * read covered the newest account.
 */
async function accountsRead(tenantId: string, conns: Connections): Promise<AccountsRead> {
  const lists = await loadAccountLists(tenantId).catch(() => null);
  if (!lists) return {};
  const out: AccountsRead = {};
  const one = (platform: "FB" | "IG", provider: "META_FACEBOOK" | "META_INSTAGRAM", list: { id: string; name: string }[]) => {
    const conn = conns[provider];
    if (!conn.connected || list.length < 2) return;
    const name = conn.name ?? list.find((a) => a.id === conn.accountId)?.name ?? conn.accountId ?? "";
    out[platform] = { name, others: list.length - 1, ...(scopedAccount(provider) ? { chosen: true } : {}) };
  };
  one("FB", "META_FACEBOOK", lists.META_FACEBOOK);
  one("IG", "META_INSTAGRAM", lists.META_INSTAGRAM);
  return out;
}

/** The customers' comments on the latest posts of the connected Page and Instagram account, with what the automation did with each. */
export async function readComments(
  tenantId: string,
  deadline: number,
): Promise<{ ok: true; items: CommentItem[]; errors: PostsResult["errors"]; posts: MPost[]; accounts: AccountsRead } | { ok: false; reason: Unreadable }> {
  const conns = await loadConnections(tenantId);
  if (!metaConnected(conns)) return { ok: false, reason: "not_connected" };
  const [accounts, live] = await Promise.all([accountsRead(tenantId, conns), withinDeadline(deadline, () => loadPosts(tenantId, conns))]);
  if (!live.ok) return { ok: false, reason: live.reason };
  const { posts, errors } = live.value;
  const outcomes = await loadCommentOutcomes(
    tenantId,
    posts.flatMap((p) => p.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)])),
  );
  return { ok: true, items: commentItems(posts, outcomes), errors, posts, accounts };
}

export interface ConversationsRead {
  conversations: MConversation[];
  unreadable: number;
  errors: { platform: "FB" | "IG"; message: string }[];
  /** Per buyer id: why the assistant left their last message for the person ("needs_you" or "unclear"). */
  flags: Record<string, string>;
  /** Buyers with an open order. */
  orderBuyers: Set<string>;
  /** The account each platform's conversations were read from, where the shop has more than one. */
  accounts: AccountsRead;
}

/** The latest direct-message threads of the connected accounts, with the assistant's flags and which buyers have an open order. */
export async function readConversations(tenantId: string, deadline: number): Promise<({ ok: true } & ConversationsRead) | { ok: false; reason: Unreadable }> {
  const conns = await loadConnections(tenantId);
  if (!metaConnected(conns)) return { ok: false, reason: "not_connected" };
  const [accounts, live] = await Promise.all([accountsRead(tenantId, conns), withinDeadline(deadline, () => loadConversations(tenantId, conns))]);
  if (!live.ok) return { ok: false, reason: live.reason };
  const { conversations, unreadable, errors } = live.value;
  const ids = conversations.map((c) => c.participantId).filter((id): id is string => !!id);
  const orderBuyers = new Set<string>();
  const flags: Record<string, string> = {};
  if (ids.length) {
    const [orders, rows] = await Promise.all([
      db.order.findMany({ where: { tenantId, buyerKey: { in: ids }, status: { in: ["NEW", "CONFIRMED"] } }, select: { buyerKey: true } }),
      db.conversationMessage.findMany({
        where: { store: { tenantId }, channelType: "DM", direction: "INBOUND", authorId: { in: ids }, createdAt: { gt: new Date(Date.now() - 3 * DAY) } },
        orderBy: { createdAt: "desc" },
        select: { authorId: true, outcomeReason: true },
        take: 400,
      }),
    ]);
    for (const o of orders) if (o.buyerKey) orderBuyers.add(o.buyerKey);
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.authorId || seen.has(r.authorId)) continue;
      seen.add(r.authorId);
      // Only the buyer's latest message counts: once a later one was answered, the chat is out of the pile.
      if (r.outcomeReason === "unclear" || r.outcomeReason === "needs_you") flags[r.authorId] = r.outcomeReason;
    }
  }
  return { ok: true, conversations, unreadable, errors, flags, orderBuyers, accounts };
}

export interface InsightsRead {
  /** The shop's own numbers over `days`, from what Gituas already receives. */
  own: { dms: number; comments: number; orders: number };
  waTaps7d: number;
  market: ReturnType<typeof marketSignals>;
  connections: { FB: boolean; IG: boolean; YT: boolean };
  /** Each live part is its own result: the others still arrive when one fails. */
  account: Live<InsightsResult>;
  youtube: Live<YouTubeBlock | null>;
  posts: Live<MPost[]>;
}

/** The numbers behind the Insights screen. The database parts are always there; the Meta and Google parts each may be missing. */
export async function readInsights(tenantId: string, deadline: number, days: number): Promise<InsightsRead> {
  const since = new Date(Date.now() - days * DAY);
  const conns = await loadConnections(tenantId);
  const inbound = { store: { tenantId }, direction: "INBOUND" as const, createdAt: { gt: since } };
  const [dms, comments, orders, waTaps7d, products, messages, recentOrders, account, youtube, posts] = await Promise.all([
    db.conversationMessage.count({ where: { ...inbound, channelType: "DM" } }),
    db.conversationMessage.count({ where: { ...inbound, channelType: "COMMENT" } }),
    db.order.count({ where: { tenantId, createdAt: { gt: since }, status: { notIn: ["CANCELLED", "RETURNED"] } } }),
    db.auditLog.count({ where: { tenantId, action: "wa.tap", createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
    db.product.findMany({ where: { active: true, store: { tenantId } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.conversationMessage.findMany({
      where: { ...inbound, commentType: { in: ["QUESTION", "ORDER", "NEGOTIATION"] } },
      select: { boundProductId: true, commentType: true, intent: true },
      take: 5000,
    }),
    db.order.findMany({ where: { tenantId, createdAt: { gt: since } }, select: { productId: true, status: true } }),
    // Meta and Google answer in their own time: each part is held to the deadline on its own.
    metaConnected(conns) ? withinDeadline(deadline, () => loadInsights(tenantId, conns)) : Promise.resolve<Live<InsightsResult>>({ ok: false, reason: "failed" }),
    conns.YOUTUBE.connected ? withinDeadline(deadline, () => loadYouTube(tenantId, conns)) : Promise.resolve<Live<YouTubeBlock | null>>({ ok: true, value: null }),
    metaConnected(conns) ? withinDeadline(deadline, async () => (await loadPosts(tenantId, conns)).posts) : Promise.resolve<Live<MPost[]>>({ ok: true, value: [] }),
  ]);
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
  return {
    own: { dms, comments, orders },
    waTaps7d,
    market: marketSignals(messages, recentOrders, names),
    connections: { FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected, YT: conns.YOUTUBE.connected },
    account,
    youtube,
    posts,
  };
}
