// Turns rows (database or platform) into the two things a read tool returns: `data` for the MODEL (small, no phone numbers, no street
// addresses, no emails, customer text cut) and `view` blocks for the PERSON (their own data in full, in their language).
// Pure: the tools in reads.ts do the reading and call these, so the privacy rules are tested without a database.

import { ago, kuDateTime } from "@/app/app/format";
import { planLabel } from "@/lib/billing/prices";
import type { Dict } from "@/lib/i18n/ckb";
import type { Lang } from "@/lib/i18n/lang";
import { commentState } from "@/lib/merchant/state";
import type { CommentState, MConversation, MPost, Platform } from "@/lib/merchant/types";
import { cityLabel } from "@/lib/orders/cities";
import { ordersByCity } from "@/lib/orders/stats";
import { effectiveMode } from "@/lib/shop/autopilot-plan";
import { needsYou } from "@/lib/shop/forms";
import { formatMoney } from "@/lib/shop/money";
import { baseOf } from "../kinds";
import type { ChatKind, ViewBlock } from "../types";
import { baghdadIso, clip, compact, countBy, isolateLtr, majorUnits, modelText, VIEW_TEXT_MAX } from "./reads-shared";
import { words } from "./reads-words";

const statusName = (t: Dict, s: string): string => (t.orders.status as Record<string, string>)[s] ?? s;
// WhatsApp is not one of the dictionary's social platforms: its name is the WhatsApp screen's.
const platformName = (t: Dict, p: string): string => (t.platform as Record<string, string>)[p] ?? (p === "WA" ? t.wa.nav : p);
const phoneShown = (phone: string | null): string => (phone ? isolateLtr(`+${phone}`) : "—");

// ---------------------------------------------------------------------------------------------------------------------
// Orders

export interface OrderRow {
  id: string;
  customerName: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  productName: string;
  variantLabel: string;
  amountMinor: number;
  currency: string;
  deliveryFeeMinor: number | null;
  cod: boolean;
  status: string;
  source: string;
  note: string | null;
  collect: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const productOf = (o: Pick<OrderRow, "productName" | "variantLabel">): string => [o.productName, o.variantLabel].filter(Boolean).join(" - ");

/** One order for the model: who, what, how much, where in the country, when. No phone number, no street address. */
export function orderForModel(o: OrderRow): Record<string, unknown> {
  return compact({
    id: o.id,
    status: o.status,
    customer: modelText(o.customerName, 80),
    product: modelText(productOf(o), 120),
    amount: majorUnits(o.amountMinor, o.currency),
    currency: o.currency,
    deliveryFee: o.deliveryFeeMinor === null ? undefined : majorUnits(o.deliveryFeeMinor, o.currency),
    cod: o.cod,
    city: cityLabel(o.city, "en") || undefined,
    source: o.source,
    createdAt: baghdadIso(o.createdAt),
    note: o.note ? modelText(o.note) : undefined,
  });
}

/** The same with a little more: whether a phone and an address are on file (not what they are), the amount to collect, the bot's stage. */
export function orderDetailForModel(o: OrderRow): Record<string, unknown> {
  const due = o.cod ? majorUnits(o.amountMinor + (o.deliveryFeeMinor ?? 0), o.currency) : undefined;
  return {
    ...orderForModel(o),
    ...compact({ amountToCollect: due, detailsStage: o.collect ?? undefined, updatedAt: baghdadIso(o.updatedAt) }),
    hasPhone: !!o.phone,
    hasAddress: !!o.address,
  };
}

/** The orders as a table the person reads: name, phone, address, total, status, date. */
export function ordersView(rows: OrderRow[], total: number, lang: Lang, t: Dict): ViewBlock[] {
  const w = words(lang);
  if (!rows.length) return [{ kind: "note", text: w.noOrders }];
  return [
    {
      kind: "table",
      title: t.orders.title,
      columns: [w.customer, w.phone, w.address, w.product, w.total, w.status, w.date],
      rows: rows.map((o) => [
        o.customerName || "—",
        phoneShown(o.phone),
        [cityLabel(o.city, lang), o.address].filter(Boolean).join(t.fmt.listSep) || "—",
        productOf(o) || "—",
        formatMoney(o.amountMinor + (o.deliveryFeeMinor ?? 0), o.currency, lang),
        statusName(t, o.status),
        kuDateTime(o.createdAt.toISOString(), t),
      ]),
      more: total > rows.length ? total - rows.length : undefined,
      href: "/app/orders",
    },
  ];
}

/** One order in full: every field the person entered or the bot collected. */
export function orderView(o: OrderRow, lang: Lang, t: Dict): ViewBlock[] {
  const w = words(lang);
  const items: { label: string; value: string }[] = [
    { label: t.orders.customerName, value: o.customerName || "—" },
    { label: t.orders.phone, value: phoneShown(o.phone) },
    { label: t.orders.city, value: cityLabel(o.city, lang) || "—" },
    { label: t.orders.address, value: o.address || "—" },
    { label: t.orders.product, value: productOf(o) || "—" },
    { label: t.orders.price, value: formatMoney(o.amountMinor, o.currency, lang) },
    ...(o.deliveryFeeMinor !== null ? [{ label: t.orders.deliveryFee, value: formatMoney(o.deliveryFeeMinor, o.currency, lang) }] : []),
    { label: w.payment, value: o.cod ? t.orders.cod : w.paid },
    { label: w.status, value: statusName(t, o.status) },
    { label: w.date, value: kuDateTime(o.createdAt.toISOString(), t) },
    { label: w.source, value: (t.orders.source as Record<string, string>)[o.source] ?? w.byHand },
  ];
  if (o.note) items.push({ label: t.orders.note, value: clip(o.note, VIEW_TEXT_MAX) });
  return [{ kind: "stats", title: t.orders.title, items, href: "/app/orders" }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders: the numbers over a period

export interface SummaryOrder {
  createdAt: Date;
  amountMinor: number;
  currency: string;
  status: string;
  productName: string;
  city: string | null;
}

const isLost = (status: string): boolean => status === "CANCELLED" || status === "RETURNED";

export interface Summary {
  /** Orders that count (not cancelled, not returned). */
  orders: number;
  /** Every status counted, lost ones too. */
  byStatus: Record<string, number>;
  /** Cancelled and returned. */
  lost: number;
  /** Currency to minor units. Dinars and dollars are never added together. */
  salesMinor: Record<string, number>;
  topProducts: { name: string; orders: number }[];
}

/** The numbers of a period. A cancelled or returned order never happened as far as sales go (the same rule as the Orders screen). */
export function summarise(orders: readonly SummaryOrder[]): Summary {
  const live = orders.filter((o) => !isLost(o.status));
  const salesMinor: Record<string, number> = {};
  for (const o of live) salesMinor[o.currency] = (salesMinor[o.currency] ?? 0) + o.amountMinor;
  const byProduct = countBy(
    live.filter((o) => o.productName),
    (o) => o.productName,
  );
  const topProducts = Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, count]) => ({ name: modelText(name, 80), orders: count }));
  return {
    orders: live.length,
    byStatus: countBy(orders, (o) => o.status),
    lost: orders.length - live.length,
    salesMinor,
    topProducts,
  };
}

/** What the model reads for orders_summary. */
export function summaryForModel(range: string, from: Date, to: Date, now: Summary, before: number, cities: { city: string; orders: number }[]): Record<string, unknown> {
  return {
    range,
    from: baghdadIso(from),
    to: baghdadIso(to),
    orders: now.orders,
    sales: Object.fromEntries(Object.entries(now.salesMinor).map(([c, minor]) => [c, majorUnits(minor, c)])),
    byStatus: now.byStatus,
    cancelledOrReturned: now.lost,
    ordersInThePeriodBefore: before,
    topProducts: now.topProducts,
    topCities: cities,
  };
}

/** The same numbers for the person: tiles, the best sellers and the cities. */
export function summaryView(
  range: "today" | "week" | "month",
  all: readonly SummaryOrder[],
  now: Summary,
  before: number,
  lang: Lang,
  t: Dict,
): ViewBlock[] {
  const w = words(lang);
  const title = range === "today" ? w.today : w.last(w.days(range === "week" ? 7 : 30));
  const sales = Object.entries(now.salesMinor).map(([c, minor]) => formatMoney(minor, c, lang));
  const stats: ViewBlock = {
    kind: "stats",
    title,
    items: [
      { label: t.orders.week.orders, value: `${t.fmt.num(now.orders)} (${w.before}: ${t.fmt.num(before)})` },
      { label: t.orders.week.total, value: sales.length ? sales.join(t.fmt.listSep) : t.fmt.num(0) },
      ...(["NEW", "CONFIRMED", "SENT", "DELIVERED"] as const).map((s) => ({ label: statusName(t, s), value: t.fmt.num(now.byStatus[s] ?? 0) })),
      { label: t.orders.week.cancelled, value: t.fmt.num(now.lost) },
    ],
    href: "/app/orders",
  };
  const blocks: ViewBlock[] = [stats];
  if (now.topProducts.length) {
    blocks.push({ kind: "list", title: t.orders.week.top, items: now.topProducts.map((p) => ({ title: p.name, badge: t.fmt.num(p.orders) })) });
  }
  const cities = ordersByCity(all.map((o) => ({ city: o.city, amountMinor: o.amountMinor, status: o.status })), lang).slice(0, 5);
  if (cities.length) {
    blocks.push({ kind: "table", title: t.orders.byCity, columns: [t.orders.city, w.orderCount], rows: cities.map((c) => [c.city, t.fmt.num(c.count)]) });
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------------
// Products

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  photos: string[];
  variants: { label: string; amountMinor: number; currency: string; inStock: boolean }[];
  shop?: string;
}

/** A product for the model. `id` and `name` are both what the product tools take. */
export function productForModel(p: ProductRow): Record<string, unknown> {
  return compact({
    id: p.id,
    name: modelText(p.name, 80),
    prices: p.variants.map((v) => compact({ label: modelText(v.label, 40), price: majorUnits(v.amountMinor, v.currency), currency: v.currency, inStock: v.inStock })),
    description: p.description ? clip(p.description, 200) : undefined,
    photos: p.photos.length,
    shop: p.shop ? modelText(p.shop, 60) : undefined,
  });
}

export function productsView(rows: ProductRow[], total: number, lang: Lang, t: Dict): ViewBlock[] {
  const w = words(lang);
  if (!rows.length) return [{ kind: "note", text: w.noProducts }];
  return [
    {
      kind: "list",
      title: t.products.title,
      items: rows.map((p) => ({
        title: p.name,
        sub: p.variants.map((v) => `${v.label ? `${v.label}: ` : ""}${formatMoney(v.amountMinor, v.currency, lang)}`).join(" · ") || undefined,
        badge: p.variants.length > 0 && p.variants.every((v) => !v.inStock) ? w.outOfStock : undefined,
      })),
      more: total > rows.length ? total - rows.length : undefined,
      href: "/app/products",
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Scheduled posts

export interface ScheduledRow {
  id: string;
  runAt: Date;
  /** The composer's PublishInput as stored. */
  input: unknown;
  status: string;
  lastError: string | null;
}

function postInput(row: ScheduledRow): { caption: string; targets: string[]; hasMedia: boolean } {
  const i = (row.input ?? {}) as { caption?: unknown; targets?: unknown; media?: unknown };
  return {
    caption: typeof i.caption === "string" ? i.caption : "",
    targets: Array.isArray(i.targets) ? i.targets.filter((x): x is string => typeof x === "string") : [],
    hasMedia: !!i.media,
  };
}

/** `id` is what cancelling a scheduled post takes. */
export function scheduledForModel(row: ScheduledRow): Record<string, unknown> {
  const p = postInput(row);
  return compact({
    id: row.id,
    runAt: baghdadIso(row.runAt),
    status: row.status,
    targets: p.targets,
    caption: clip(p.caption, 120),
    hasMedia: p.hasMedia,
    error: row.lastError ? clip(row.lastError, 160) : undefined,
  });
}

export function scheduledView(rows: ScheduledRow[], lang: Lang, t: Dict, kind: ChatKind = "shop"): ViewBlock[] {
  const w = words(lang);
  if (!rows.length) return [{ kind: "note", text: w.noScheduled }];
  const badge: Record<string, string> = { PENDING: w.pending, RUNNING: w.running, FAILED: w.failed };
  return [
    {
      kind: "list",
      title: t.publish.scheduledSec,
      items: rows.map((r) => {
        const p = postInput(r);
        return {
          title: clip(p.caption, 120) || (p.hasMedia ? w.withPhoto : "—"),
          sub: [kuDateTime(r.runAt.toISOString(), t), p.targets.map((x) => platformName(t, x)).join(" + ")].filter(Boolean).join(" · "),
          badge: badge[r.status] ?? r.status,
        };
      }),
      href: `${baseOf(kind)}/publish`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// AI video jobs

export interface VideoRow {
  id: string;
  status: string;
  source: string;
  tier: string;
  topic: string | null;
  caption: string | null;
  productName: string | null;
  createdAt: Date;
  postedAt: Date | null;
  /** Already turned into something an owner may read (ownerJobError), or null. */
  problem: string | null;
  videoUrl: string | null;
}

/** The video exists to watch only once it is rendered; before that the file address means nothing. */
const watchable = (v: Pick<VideoRow, "status" | "videoUrl">): string | undefined =>
  v.videoUrl && v.videoUrl.startsWith("https://") && ["RENDERED", "POSTING", "POSTED"].includes(v.status) ? v.videoUrl : undefined;

export function videoForModel(v: VideoRow): Record<string, unknown> {
  return compact({
    id: v.id,
    status: v.status,
    source: v.source,
    tier: v.tier,
    topic: v.topic ? modelText(v.topic, 120) : undefined,
    product: v.productName ? modelText(v.productName, 80) : undefined,
    caption: v.caption ? clip(v.caption, 120) : undefined,
    createdAt: baghdadIso(v.createdAt),
    postedAt: baghdadIso(v.postedAt),
    ready: !!watchable(v),
    problem: v.problem ?? undefined,
  });
}

export function videosView(rows: VideoRow[], lang: Lang, t: Dict): ViewBlock[] {
  if (!rows.length) return [{ kind: "note", text: t.video.empty }];
  return [
    {
      kind: "list",
      title: t.video.listSec,
      items: rows.map((v) => ({
        title: clip(v.topic || v.caption || v.productName || t.video.wholeShop, 120),
        sub: [v.productName, kuDateTime(v.createdAt.toISOString(), t), v.problem].filter(Boolean).join(" · "),
        badge: (t.video.status as Record<string, string>)[v.status] ?? v.status,
        href: watchable(v),
      })),
      href: "/app/video",
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Comments

export interface CommentItem {
  id: string;
  platform: Platform;
  author: string;
  text: string;
  createdAt?: string;
  state: CommentState;
  replies: number;
  postCaption: string;
  /** Why the automation left it for the person (outcomeReason), when it did. */
  reason: string | null;
  autoReplied: boolean;
}

/** The customers' comments of the loaded posts, newest first. The shop's own comments are not a customer waiting, so they are left out. */
export function commentItems(posts: MPost[], outcomes: Record<string, { outcome: string | null; reason: string | null }>): CommentItem[] {
  const out: CommentItem[] = [];
  for (const p of posts) {
    for (const c of p.comments) {
      if (c.fromUs) continue;
      const o = outcomes[c.id];
      out.push({
        id: c.id,
        platform: c.platform,
        author: c.author,
        text: c.text,
        createdAt: c.createdAt,
        state: commentState(c),
        replies: c.replies.length,
        postCaption: p.caption,
        reason: o?.reason && needsYou(o.reason) ? o.reason : null,
        autoReplied: o?.outcome === "AUTO_REPLIED",
      });
    }
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** `id` with `platform` is what replying to or hiding a comment takes. */
export function commentForModel(c: CommentItem): Record<string, unknown> {
  return compact({
    id: c.id,
    platform: c.platform,
    from: modelText(c.author, 60),
    text: modelText(c.text),
    at: baghdadIso(c.createdAt),
    state: c.state,
    replies: c.replies || undefined,
    onPost: c.postCaption ? clip(c.postCaption, 60) : undefined,
    needsYou: c.reason ?? undefined,
    autoReplied: c.autoReplied || undefined,
  });
}

export function commentsView(rows: CommentItem[], total: number, onlyWaiting: boolean, lang: Lang, t: Dict, kind: ChatKind = "shop"): ViewBlock[] {
  const w = words(lang);
  if (!rows.length) return [{ kind: "note", text: onlyWaiting ? w.noCommentsWaiting : w.noComments }];
  const badge: Record<CommentState, string> = { unanswered: t.comments.badgeUnanswered, answered: t.comments.badgeAnswered, hidden: t.comments.badgeHidden };
  return [
    {
      kind: "list",
      title: t.comments.title,
      items: rows.map((c) => ({
        title: clip(c.text, VIEW_TEXT_MAX) || t.common.noText,
        sub: [platformName(t, c.platform), c.author, ago(c.createdAt, t), c.replies ? w.repliesCount(t.fmt.num(c.replies)) : ""].filter(Boolean).join(" · "),
        badge: [badge[c.state], c.reason ? (t.comments.reasons as Record<string, string>)[c.reason] : ""].filter(Boolean).join(" · "),
      })),
      more: total > rows.length ? total - rows.length : undefined,
      href: `${baseOf(kind)}/comments`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Accounts

/**
 * Which Page or Instagram account a live read covered, for each platform that has more than one connected. A shop's chat reads the
 * account the person chose in it (the Accounts button; `chosen`), else the newest account of the platform, and must say which: an empty
 * answer from one Page is not an answer for the others. A news desk's chat has no such choice: its screens switch.
 */
export type AccountsRead = Partial<Record<"FB" | "IG", { name: string; others: number; chosen?: boolean }>>;

/** The notes that tell the person which Page or account a read covered, for each platform that has several (or only the one asked for). */
export function accountNotes(accounts: AccountsRead, screen: "comments" | "messages", only: "FB" | "IG" | undefined, lang: Lang, t: Dict, kind: ChatKind = "shop"): ViewBlock[] {
  const w = words(lang);
  // The desk's sections have their own names (t.nr.shell.nav.items); the shop's are t.nav.
  const names = kind === "news" ? t.nr.shell.nav.items : t.nav;
  const screenName = screen === "comments" ? names.comments : names.messages;
  return (["FB", "IG"] as const).flatMap((p) => {
    const a = accounts[p];
    if (!a || (only && only !== p)) return [];
    const platform = platformName(t, p);
    const others = t.fmt.num(a.others);
    // A shop chooses in the chat itself (no screen is named); a desk's accounts are switched in its own screens.
    const text = kind === "news" ? w.severalAccounts(platform, a.name, others, screenName) : a.chosen ? w.chosenAccount(platform, a.name, others) : w.newestAccount(platform, a.name, others);
    return [{ kind: "note" as const, text }];
  });
}

/** The same for the model: the account that was read, whether the person chose it in the chat, and how many others were not. Nothing when every platform has one account. */
export function accountsForModel(accounts: AccountsRead, only: "FB" | "IG" | undefined): Record<string, { account: string; otherAccountsNotRead: number; chosenInChat?: true }> | undefined {
  const out: Record<string, { account: string; otherAccountsNotRead: number; chosenInChat?: true }> = {};
  for (const p of ["FB", "IG"] as const) {
    const a = accounts[p];
    if (a && (!only || only === p)) out[p] = { account: clip(a.name, 60), otherAccountsNotRead: a.others, ...(a.chosen ? { chosenInChat: true as const } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conversations

export interface ConversationItem {
  /** For WhatsApp an opaque reference ("wa_..."), never the buyer's number. */
  id: string;
  /** "WA" is WhatsApp (reads-wa-shape.ts). */
  platform: Platform | "WA";
  name: string;
  lastText: string;
  /** WhatsApp only: the last line worded for the person (media labels in their language); lastText is the model's. */
  lastView?: string;
  lastFromUs: boolean;
  at?: string;
  /** Meta only lets a business answer within 24 hours of the buyer's last message (WhatsApp: the same, and not after a STOP). */
  canReply: boolean;
  /** WhatsApp only: the buyer's newest message is a STOP. */
  stop?: boolean;
  /** WhatsApp only: the owner answered this chat on the phone (the bot was paused after the buyer's last line), so it is not waiting. */
  answeredOnPhone?: boolean;
  /** WhatsApp only: when the 24 hours end (Baghdad time), while they are still running. */
  windowEndsAt?: string;
  /** WhatsApp only: the buyer's number. For the person's view; conversationForModel never reads it. */
  phone?: string;
  /** Why the assistant left the chat for the person: "needs_you" or "unclear". */
  flag?: string;
  /** The buyer has an open order. */
  orderOpen: boolean;
  /** The last message is the buyer's: nobody answered yet. */
  unanswered: boolean;
}

export function conversationItems(convs: MConversation[], flags: Record<string, string>, orderBuyers: ReadonlySet<string>): ConversationItem[] {
  return convs.map((c) => {
    const last = c.messages[c.messages.length - 1];
    return {
      id: c.id,
      platform: c.platform,
      name: c.participantName ?? "",
      lastText: last?.text ?? "",
      lastFromUs: !!last?.fromUs,
      at: last?.createdAt ?? c.updatedAt,
      canReply: c.withinWindow,
      flag: c.participantId ? flags[c.participantId] : undefined,
      orderOpen: !!c.participantId && orderBuyers.has(c.participantId),
      unanswered: !!last && !last.fromUs,
    };
  });
}

/** Who spoke last, for the model: the shop and its buyers, or the desk and its viewers. */
const sides = (kind: ChatKind): { us: string; them: string } => (kind === "news" ? { us: "desk", them: "visitor" } : { us: "shop", them: "buyer" });

/** `id` is the conversation id: what get_conversation and send_message take, together with `platform`. */
export function conversationForModel(c: ConversationItem, kind: ChatKind = "shop"): Record<string, unknown> {
  return compact({
    id: c.id,
    platform: c.platform,
    with: modelText(c.name, 60),
    lastFrom: c.lastFromUs ? sides(kind).us : sides(kind).them,
    last: modelText(c.lastText),
    at: baghdadIso(c.at),
    canReply: c.canReply,
    askedToStop: c.stop || undefined,
    answeredOnPhone: c.answeredOnPhone || undefined,
    windowClosesAt: c.windowEndsAt,
    needsYou: c.flag,
    openOrder: c.orderOpen || undefined,
  });
}

export function conversationsView(rows: ConversationItem[], total: number, onlyWaiting: boolean, lang: Lang, t: Dict, kind: ChatKind = "shop"): ViewBlock[] {
  const w = words(lang);
  if (!rows.length) return [{ kind: "note", text: onlyWaiting ? w.noConversationsWaiting : w.noConversations }];
  return [
    {
      kind: "list",
      title: t.messages.title,
      items: rows.map((c) => ({
        // A WhatsApp chat has no page to open: the person tells chats apart by name and number (their own data, on their own screen).
        title: c.phone ? [c.name, isolateLtr(`+${c.phone}`)].filter(Boolean).join(" · ") : c.name || (kind === "news" ? t.messages.viewer : t.messages.customer),
        sub: `${c.lastFromUs ? t.messages.youPrefix : ""}${clip(c.lastView ?? c.lastText, 160) || t.common.mediaOrFile}`,
        badge:
          [
            platformName(t, c.platform),
            c.flag === "needs_you" ? t.messages.needsYou : c.flag === "unclear" ? t.messages.tabs.unclear : "",
            c.stop ? w.askedToStop : c.canReply ? "" : t.messages.outsideWindow,
            c.answeredOnPhone ? w.answeredOnPhone : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      })),
      more: total > rows.length ? total - rows.length : undefined,
      // Without WhatsApp chats the list belongs to the Messages screen, as before; chats of WhatsApp live on their own screen.
      href: rows.length && rows.every((c) => c.platform === "WA") ? `${baseOf(kind)}/whatsapp` : `${baseOf(kind)}/messages`,
    },
  ];
}

/** The last messages of one conversation: who said it, what, when. */
export function messagesForModel(c: MConversation, max = 12, kind: ChatKind = "shop"): Record<string, unknown>[] {
  const side = sides(kind);
  return c.messages.slice(-max).map((m) => compact({ from: m.fromUs ? side.us : side.them, text: modelText(m.text), at: baghdadIso(m.createdAt) }));
}

export function conversationView(c: MConversation, lang: Lang, t: Dict, kind: ChatKind = "shop"): ViewBlock[] {
  const who = kind === "news" ? t.messages.viewer : t.messages.customer;
  const messages = c.messages.slice(-12);
  if (!messages.length) return [{ kind: "note", text: t.messages.noMessages }];
  const blocks: ViewBlock[] = [
    {
      kind: "list",
      title: [platformName(t, c.platform), c.participantName ?? who].join(" · "),
      items: messages.map((m) => ({
        title: clip(m.text, VIEW_TEXT_MAX) || t.common.mediaOrFile,
        sub: [m.fromUs ? t.messages.youPrefix.replace(/[:：]\s*$/, "") : who, ago(m.createdAt, t)].filter(Boolean).join(" · "),
      })),
      href: `${baseOf(kind)}/messages`,
    },
  ];
  if (!c.withinWindow) blocks.push({ kind: "note", tone: "warn", text: t.messages.windowClosed(who) });
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings

export type SettingsArea = "replies" | "autopilot" | "video" | "shop" | "whatsapp";

export interface StoreRow {
  id: string;
  name: string;
  igUsername: string | null;
  plan: string;
  planPaidUntil: Date | null;
  fbPageId: string | null;
  igUserId: string | null;
  automationEnabled: boolean;
  pausedReason: string | null;
  aiReplies: boolean;
  aiBrief: string | null;
  likeComments: boolean;
  autoHideSpam: boolean;
  expiryDays: number;
  stopBefore: Date | null;
  defaultDm: string | null;
  deliveryFeeMinor: number | null;
  deliveryCurrency: string;
  deliveryTime: string | null;
  deliveryCityFees: unknown;
  autoMode: string;
  autoPerDay: number;
  autoLastAt: Date | null;
  videoAutoMode: string;
  videoAutoTier: string;
  videoAutoHour: number;
  videoAutoLastAt: Date | null;
  waPhoneNumberId: string | null;
}

/** The plan a store really works on: a plan whose days ran out works as Free from that day. */
export function livePlan(s: Pick<StoreRow, "plan" | "planPaidUntil">, now: number): string {
  return s.plan !== "FREE" && s.planPaidUntil && s.planPaidUntil.getTime() < now ? "FREE" : s.plan;
}

/** The shop whose settings the app opens on: the one of a connected account, else the oldest (the same rule as the shop screens). */
export function primaryStoreId(stores: readonly Pick<StoreRow, "id" | "fbPageId" | "igUserId">[], connectedIds: readonly string[]): string | undefined {
  const preferred = stores.find((s) => (!!s.fbPageId && connectedIds.includes(s.fbPageId)) || (!!s.igUserId && connectedIds.includes(s.igUserId)));
  return (preferred ?? stores[0])?.id;
}

const storeName = (s: Pick<StoreRow, "name" | "igUsername">): string => s.name || (s.igUsername ? `@${s.igUsername}` : "—");

/** The argument names are the ones set_shop_options takes (likeComments, autoHideSpam, aiReplies, expiryDays, defaultDm, deliveryFee, deliveryTime, aiBrief). */
export function settingsForModel(s: StoreRow, areas: readonly SettingsArea[], opts: { primary: boolean; videoAvailable: boolean; now: number }): Record<string, unknown> {
  const out: Record<string, unknown> = compact({ id: s.id, name: modelText(storeName(s), 60), primary: opts.primary || undefined, plan: livePlan(s, opts.now) });
  if (areas.includes("replies")) {
    out.replies = compact({
      automaticReplies: !s.automationEnabled ? "off" : s.pausedReason ? "paused" : "on",
      pausedReason: s.pausedReason ?? undefined,
      aiReplies: s.aiReplies,
      aiBrief: s.aiBrief ? clip(s.aiBrief, 300) : undefined,
      likeComments: s.likeComments,
      autoHideSpam: s.autoHideSpam,
      expiryDays: s.expiryDays,
      stopBefore: s.stopBefore ? baghdadIso(s.stopBefore)?.slice(0, 10) : undefined,
      defaultDm: s.defaultDm ? clip(s.defaultDm, 300) : undefined,
    });
  }
  if (areas.includes("autopilot")) {
    out.autopilot = compact({ mode: s.autoMode, worksAs: effectiveMode(s.autoMode, livePlan(s, opts.now)), postsPerDay: s.autoPerDay, lastPostAt: baghdadIso(s.autoLastAt) });
  }
  if (areas.includes("video")) {
    out.dailyVideo = compact({
      available: opts.videoAvailable,
      mode: s.videoAutoMode,
      tier: s.videoAutoTier,
      afterHourBaghdad: s.videoAutoHour,
      lastAt: baghdadIso(s.videoAutoLastAt),
    });
  }
  if (areas.includes("shop")) {
    const cityFees = s.deliveryCityFees && typeof s.deliveryCityFees === "object" ? Object.keys(s.deliveryCityFees as object).length : 0;
    out.shop = compact({
      facebookPageConnected: !!s.fbPageId,
      instagramConnected: !!s.igUserId,
      deliveryFee: s.deliveryFeeMinor === null ? undefined : majorUnits(s.deliveryFeeMinor, s.deliveryCurrency),
      deliveryTime: s.deliveryTime ? clip(s.deliveryTime, 60) : undefined,
      citiesWithTheirOwnDeliveryFee: cityFees || undefined,
    });
  }
  if (areas.includes("whatsapp")) out.whatsapp = { messagingAccountConnected: !!s.waPhoneNumberId };
  return out;
}

/** The owner's order-link WhatsApp number as the model sees it: whether it is set and its last four digits, never the number. */
export function whatsappNumberForModel(number: string | null): { set: boolean; endsWith?: string } {
  return number ? { set: true, endsWith: number.slice(-4) } : { set: false };
}

/** The settings as stats cards, one per shop. */
export function settingsView(
  stores: readonly StoreRow[],
  areas: readonly SettingsArea[],
  tenantWhatsapp: string | null,
  primaryId: string | undefined,
  lang: Lang,
  t: Dict,
  now: number,
): ViewBlock[] {
  const w = words(lang);
  if (!stores.length) return [{ kind: "note", text: w.noShop, tone: "warn" }];
  const yn = (b: boolean) => (b ? w.on : w.off);
  const mode = (m: string) => (t.automation.autoModes as Record<string, string>)[m] ?? m;
  const videoMode = (m: string) => (m === "DRAFT" ? t.video.autoDraft : m === "PUBLISH" ? t.video.autoPublish : t.video.autoOff);
  const blocks: ViewBlock[] = stores.map((s) => {
    const items: { label: string; value: string }[] = [{ label: t.billing.current, value: planLabel(livePlan(s, now), lang) }];
    if (areas.includes("replies")) {
      items.push({ label: t.automation.switchLabel, value: !s.automationEnabled ? t.automation.switchOff : s.pausedReason ? t.automation.paused : t.automation.switchOn });
      items.push({ label: t.automation.smartSec, value: yn(s.aiReplies) });
      if (s.aiBrief) items.push({ label: t.automation.smartBrief, value: clip(s.aiBrief, 300) });
      items.push({ label: t.automation.likeComments, value: yn(s.likeComments) });
      items.push({ label: t.automation.hideSpam, value: yn(s.autoHideSpam) });
      items.push({ label: t.automation.expiryDays, value: t.fmt.num(s.expiryDays) });
      if (s.defaultDm) items.push({ label: t.automation.defaultDm, value: clip(s.defaultDm, 300) });
    }
    if (areas.includes("autopilot")) {
      items.push({ label: w.autopilot, value: `${mode(effectiveMode(s.autoMode, livePlan(s, now)))} · ${w.perDay(t.fmt.num(s.autoPerDay))}` });
    }
    if (areas.includes("video")) {
      items.push({ label: t.video.autoSec, value: `${videoMode(s.videoAutoMode)} · ${w.atHour(t.fmt.digits(`${String(s.videoAutoHour).padStart(2, "0")}:00`))}` });
    }
    if (areas.includes("shop")) {
      items.push({ label: t.orders.deliveryFee, value: s.deliveryFeeMinor === null ? w.notSet : formatMoney(s.deliveryFeeMinor, s.deliveryCurrency, lang) });
      items.push({ label: w.deliveryTime, value: s.deliveryTime || w.notSet });
      items.push({ label: platformName(t, "FB"), value: s.fbPageId ? w.connected : w.notConnected });
      items.push({ label: platformName(t, "IG"), value: s.igUserId ? w.connected : w.notConnected });
    }
    if (areas.includes("whatsapp")) items.push({ label: w.whatsappCloud, value: s.waPhoneNumberId ? w.connected : w.notConnected });
    return { kind: "stats", title: `${storeName(s)}${s.id === primaryId && stores.length > 1 ? ` · ${w.primaryShop}` : ""}`, items, href: "/app/settings" } as ViewBlock;
  });
  if (areas.includes("whatsapp")) {
    blocks.push({ kind: "stats", title: w.whatsappTitle, items: [{ label: w.whatsappNumber, value: tenantWhatsapp ? phoneShown(tenantWhatsapp) : w.notSet }], href: "/app/settings" });
  }
  return blocks;
}
