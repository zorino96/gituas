// The numbers behind the growth coach: what the shop's own records say about the last 7 days against the 7 before. Everything here is
// counted by the database; no buyer's words, names, phone numbers or order notes are read (every query lists the columns it takes, and
// none of them is a free-text column). The weekly note and the chat tool get_business_picture are both built from this one list.
//
// What the numbers do NOT say: an order is what a buyer asked for in Gituas, not money collected, and "no order recorded" is not "a
// sale lost" (the buyer may have ordered by phone or on another account). The texts that use these facts keep those two rules.

import { db } from "@/lib/db";
import { isCityCode } from "@/lib/orders/cities";
import { marketSignals } from "@/lib/orders/market";
import { buyerProfile, weekReport } from "@/lib/orders/stats";
import { exponentOf } from "@/lib/shop/money";
import { loadProfiles, profileLines, type Goal } from "@/lib/shop/profile";
import { weekWindows, isoWeekKey } from "./week";

const DAY = 86_400_000;
/** The interest in products (asks, haggling) is read over this many days: a week alone is too few messages to say anything. */
export const INTEREST_DAYS = 28;
/** Fewer than this many asks plus haggles about a product, and a share of them is noise. */
const MIN_SHARE_BASE = 10;
/** A percentage change is only given when the week before had at least this many orders. */
const MIN_PCT_BASE = 10;

export type NoteLang = "ckb" | "ar" | "en";

export interface CoachFacts {
  v: 1;
  /** The Baghdad ISO week, "2026-W43". */
  week: string;
  /** The owner's goal with Gituas, in their own choice and words (null when they did not answer). */
  goal: { kind: Goal | null; text: string | null };
  /** The language an AI wording is written in: the profile's, else Sorani. */
  lang: "ckb" | "ar";
  /** What the owner said about their work (owner-side lines from the setup interview). The owner's words, never a buyer's. */
  profile: string[];
  orders: {
    /** Orders recorded this week that count (not cancelled, not returned). */
    week: number;
    before: number;
    cancelled: number;
    /** Ordered value by currency, in the currency's main unit (25000 IQD). What buyers ordered, not money collected. */
    sales: Record<string, number>;
    salesBefore: Record<string, number>;
    /** This week against the week before in percent; only when the week before had 10 orders or more. */
    changePct: number | null;
    byStatus: Record<string, number>;
    /** The products with most orders this week (names from the product list). */
    top: { name: string; orders: number }[];
  };
  /** Per product, over the last 28 days: how many asked, how many ordered, how many bargained. Best-asked first, at most 3. */
  interest: { name: string; asks: number; orders: number; haggles: number; haggleSharePct: number | null }[];
  messages: { dm: number; dmBefore: number; comments: number; commentsBefore: number };
  /** Buyer messages the assistant left for the owner this week ("needs you"). */
  waiting: number;
  posts: { published: number; byAutopilot: number };
  /** Where and when buyers are, over the last 28 days. */
  buyers: { cities: string[]; hours: number[]; messages: number; orders: number };
}

const toMajor = (minor: number, currency: string): number => minor / 10 ** exponentOf(currency);
const majorMap = (minor: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(minor).map(([c, m]) => [c, toMajor(m, c)]));

/** Money by currency of the orders that count, in a half-open time window. */
function salesIn(rows: readonly { createdAt: Date; amountMinor: number; currency: string; status: string }[], from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of rows) {
    const t = o.createdAt.getTime();
    if (t < from || t >= to || o.status === "CANCELLED" || o.status === "RETURNED") continue;
    out[o.currency] = (out[o.currency] ?? 0) + o.amountMinor;
  }
  return out;
}

export async function collectFacts(tenantId: string, now = Date.now()): Promise<CoachFacts> {
  const w = weekWindows(now);
  const since = (days: number) => new Date(now - days * DAY);
  const inbound = { store: { tenantId }, direction: "INBOUND" as const };

  const [stores, orders, products, signalMessages, dmRows, dm, dmBefore, comments, commentsBefore, waiting, published, byAutopilot] = await Promise.all([
    db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: 15, select: { id: true } }),
    // The orders of the last 28 days: the columns are numbers, codes and ids only (no name, phone, address or note).
    db.order.findMany({
      where: { tenantId, createdAt: { gt: since(INTEREST_DAYS) } },
      select: { createdAt: true, amountMinor: true, currency: true, status: true, productId: true, city: true },
      // If a very busy shop hits the cap, it is the oldest rows that are left out.
      orderBy: { createdAt: "desc" },
      take: 6_000,
    }),
    db.product.findMany({ where: { store: { tenantId } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
    // Which product a buyer asked about and what kind of message it was: labels the shop's own classifier gave, not the buyer's words.
    db.conversationMessage.findMany({
      where: { ...inbound, createdAt: { gt: since(INTEREST_DAYS) }, commentType: { in: ["QUESTION", "ORDER", "NEGOTIATION"] } },
      select: { boundProductId: true, commentType: true, intent: true },
      orderBy: { createdAt: "desc" },
      take: 5_000,
    }),
    db.conversationMessage.findMany({
      where: { ...inbound, channelType: "DM", createdAt: { gt: since(INTEREST_DAYS) } },
      select: { createdAt: true, language: true },
      orderBy: { createdAt: "desc" },
      take: 3_000,
    }),
    db.conversationMessage.count({ where: { ...inbound, channelType: "DM", createdAt: { gt: new Date(w.thisStart) } } }),
    db.conversationMessage.count({ where: { ...inbound, channelType: "DM", createdAt: { gt: new Date(w.beforeStart), lte: new Date(w.thisStart) } } }),
    db.conversationMessage.count({ where: { ...inbound, channelType: "COMMENT", createdAt: { gt: new Date(w.thisStart) } } }),
    db.conversationMessage.count({ where: { ...inbound, channelType: "COMMENT", createdAt: { gt: new Date(w.beforeStart), lte: new Date(w.thisStart) } } }),
    db.conversationMessage.count({ where: { ...inbound, outcome: "FLAGGED", createdAt: { gt: new Date(w.thisStart) } } }),
    // One row per platform a post reached; the autopilot's own rows are counted apart.
    db.auditLog.count({ where: { tenantId, action: "app.publish", createdAt: { gt: new Date(w.thisStart) } } }),
    db.auditLog.count({ where: { tenantId, action: "shop.autopilot_publish", createdAt: { gt: new Date(w.thisStart) } } }),
  ]);

  const names: Record<string, string> = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null): string => (id ? (names[id] ?? "") : "");
  const withNames = orders.map((o) => ({ ...o, productName: nameOf(o.productId) }));

  // Orders: the week report (this week, the week before, cancelled, ordered value) the shop's weekly report already uses.
  const report = weekReport(withNames, now);
  const live = withNames.filter((o) => o.status !== "CANCELLED" && o.status !== "RETURNED");
  const thisWeek = withNames.filter((o) => o.createdAt.getTime() >= w.thisStart);
  const byProduct = new Map<string, number>();
  for (const o of live) if (o.createdAt.getTime() >= w.thisStart && o.productName) byProduct.set(o.productName, (byProduct.get(o.productName) ?? 0) + 1);
  const top = [...byProduct.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, n]) => ({ name, orders: n }));
  const byStatus: Record<string, number> = {};
  for (const o of thisWeek) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  // Interest in products over 28 days: asks, bargains, orders.
  const signals = marketSignals(
    signalMessages.map((m) => ({ boundProductId: m.boundProductId, commentType: m.commentType, intent: null })),
    orders.map((o) => ({ productId: o.productId, status: o.status })),
    names,
  );
  const interest = signals.products.slice(0, 3).map((p) => ({
    name: p.name,
    asks: p.asks,
    orders: p.orders,
    haggles: p.haggles,
    haggleSharePct: p.asks + p.haggles >= MIN_SHARE_BASE ? Math.round((p.haggles / (p.asks + p.haggles)) * 100) : null,
  }));

  // Who buys: the cities of the orders, the hours and languages of the direct messages.
  const buyers = buyerProfile(dmRows, withNames.map((o) => ({ city: o.city, productName: o.productName, status: o.status })));

  // What the owner told us about their work (their own words); several shops: the first one that answered.
  const profiles = await loadProfiles(stores.map((s) => s.id));
  let goal: CoachFacts["goal"] = { kind: null, text: null };
  let lang: CoachFacts["lang"] = "ckb";
  const lines: string[] = [];
  let first = true;
  for (const s of stores) {
    const p = profiles.get(s.id);
    if (!p) continue;
    if (first && (p.goal || p.goalText)) {
      goal = { kind: p.goal, text: p.goalText };
      first = false;
    }
    if (p.language && lines.length === 0) lang = p.language;
    for (const l of profileLines(p, { lang: "en", audience: "owner" })) if (!lines.includes(l)) lines.push(l);
  }

  return {
    v: 1,
    week: isoWeekKey(now),
    goal,
    lang,
    profile: lines.slice(0, 12),
    orders: {
      week: report.orders,
      before: report.prevOrders,
      cancelled: report.cancelled,
      sales: majorMap(report.totals),
      salesBefore: majorMap(salesIn(withNames, w.beforeStart, w.thisStart)),
      changePct: report.prevOrders >= MIN_PCT_BASE ? Math.round(((report.orders - report.prevOrders) / report.prevOrders) * 100) : null,
      byStatus,
      top,
    },
    interest,
    messages: { dm, dmBefore, comments, commentsBefore },
    waiting,
    posts: { published, byAutopilot },
    buyers: {
      cities: buyers.cities.filter(isCityCode),
      hours: buyers.hours,
      messages: buyers.messages,
      orders: buyers.orders,
    },
  };
}

/** The numbers of the facts as text: the set a wording may use. The week key and the schema version are not facts to quote. */
export function factsText(f: CoachFacts): string {
  return JSON.stringify({ goal: f.goal, profile: f.profile, ...numbersOf(f) });
}

/** The counted part of the facts (what a wording is given as FACTS): no week key, no language, no owner's words. */
export function numbersOf(f: CoachFacts) {
  return { orders: f.orders, interest: f.interest, messages: f.messages, waiting: f.waiting, posts: f.posts, buyers: f.buyers };
}

/** Whether the shop has done anything Gituas can count this week or the week before. */
export function hasActivity(f: CoachFacts): boolean {
  return (
    f.orders.week + f.orders.before + f.orders.cancelled > 0 ||
    f.messages.dm + f.messages.dmBefore + f.messages.comments + f.messages.commentsBefore > 0 ||
    f.posts.published > 0 ||
    f.waiting > 0
  );
}
