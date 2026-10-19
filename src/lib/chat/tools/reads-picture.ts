// get_business_picture: the shop's own numbers in one look, for advice. COUNTS AND SUMS ONLY: no buyer's name, message, comment, order
// note, phone number or address is read or returned (see collectFacts in src/lib/coach/facts.ts: every query lists its columns and
// none of them is free text), so the result is NOT marked untrusted and a turn that uses it can still change things. The detailed
// tools (list_orders, list_conversations, get_insights) stay for when the owner needs a buyer's actual words.

import { z } from "zod";

import { collectFacts, type CoachFacts } from "@/lib/coach/facts";
import { cityLabel } from "@/lib/orders/cities";
import { exponentOf, formatMoney } from "@/lib/shop/money";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";
import { defineRead, type ReadTool, type ViewBlock } from "../types";
import { compact, isolateLtr, modelText } from "./reads-shared";

/** Words only this tool needs; the rest come from the app's dictionary. */
const WORDS: Record<Lang, { working: string; orderedValue: string; hours: string; asked: string; empty: string; goal: string }> = {
  ckb: {
    working: "ژمارەکانی دووکانەکەت کۆدەکەمەوە…",
    orderedValue: "بەهای داواکراو",
    hours: "کاتژمێرە زۆرەکانی نامە",
    asked: "پرسیار",
    empty: "هێشتا گیتواس هیچ داواکاری و نامە و پۆستێکی تۆمار نەکردووە بۆ ئەم ماوەیە.",
    goal: "ئامانجی خاوەن",
  },
  ar: {
    working: "أجمع أرقام متجرك…",
    orderedValue: "قيمة المطلوب",
    hours: "ساعات أكثر الرسائل",
    asked: "سؤال",
    empty: "لم يسجّل Gituas بعد أي طلبات أو رسائل أو منشورات في هذه المدة.",
    goal: "هدف المالك",
  },
  en: {
    working: "Gathering your shop's numbers…",
    orderedValue: "Ordered value",
    hours: "Busiest message hours",
    asked: "asked",
    empty: "Gituas has not recorded any orders, messages or posts for this period yet.",
    goal: "Owner's goal",
  },
};

/** What the model reads. English keys; names cut and scrubbed; the numbers exactly as counted. */
export function pictureForModel(f: CoachFacts): Record<string, unknown> {
  const o = f.orders;
  const owner = compact({ goal: f.goal.kind ?? undefined, goalInTheirWords: f.goal.text ?? undefined, aboutTheirWork: f.profile.length ? f.profile : undefined });
  return compact({
    window: "Orders, messages and posts: the last 7 days against the 7 days before (Baghdad time). Product interest, cities and hours: the last 28 days.",
    orders: compact({
      thisWeek: o.week,
      weekBefore: o.before,
      cancelledOrReturned: o.cancelled,
      changePercent: o.changePct ?? undefined,
      orderedValue: Object.keys(o.sales).length ? o.sales : undefined,
      orderedValueWeekBefore: Object.keys(o.salesBefore).length ? o.salesBefore : undefined,
      byStatus: o.byStatus,
      topProducts: o.top.map((p) => ({ name: modelText(p.name, 80), orders: p.orders })),
    }),
    productInterest: f.interest.map((p) =>
      compact({ product: modelText(p.name, 80), asked: p.asks, ordered: p.orders, bargained: p.haggles, bargainSharePercent: p.haggleSharePct ?? undefined }),
    ),
    buyers: compact({
      topCities: f.buyers.cities.map((c) => cityLabel(c, "en")).filter(Boolean),
      busiestHoursBaghdad: f.buyers.hours,
      basedOnMessages: f.buyers.messages,
      basedOnOrders: f.buyers.orders,
    }),
    messages: {
      buyerMessagesThisWeek: f.messages.dm,
      buyerMessagesWeekBefore: f.messages.dmBefore,
      commentsThisWeek: f.messages.comments,
      commentsWeekBefore: f.messages.commentsBefore,
      waitingForOwner: f.waiting,
    },
    posts: { publishedThisWeek: f.posts.published, ofThemByAutopilot: f.posts.byAutopilot },
    owner: Object.keys(owner).length ? owner : undefined,
    notes: [
      "These are the shop's own numbers from Gituas, not market data. Predict nothing and promise nothing.",
      "An order is what a buyer asked for in Gituas, not money collected.",
      "'No order recorded' is not a lost sale: the buyer may have ordered another way.",
      "A percentage is only given when its base is big enough; otherwise quote the counts.",
      "If the numbers cannot speak to the owner's goal, say what is missing.",
    ],
  });
}

/** What the owner sees: tiles, the best sellers, what buyers ask about, where and when they are. */
export function pictureView(f: CoachFacts, lang: Lang): ViewBlock[] {
  const t = dict(lang);
  const w = WORDS[lang];
  const mk = t.insights.market;
  const o = f.orders;
  const empty = o.week + o.before + o.cancelled + f.messages.dm + f.messages.comments + f.messages.dmBefore + f.messages.commentsBefore + f.posts.published === 0;
  if (empty) return [{ kind: "note", text: w.empty }];
  const value = Object.entries(o.sales)
    .filter(([, v]) => v > 0)
    .map(([cur, v]) => formatMoney(Math.round(v * 10 ** exponentOf(cur)), cur, lang));
  const blocks: ViewBlock[] = [
    {
      kind: "stats",
      title: t.coach.ordersTitle,
      items: [
        { label: t.orders.week.orders, value: `${t.fmt.num(o.week)} (${t.fmt.num(o.before)})` },
        ...(value.length ? [{ label: w.orderedValue, value: value.join(t.fmt.listSep) }] : []),
        { label: t.orders.week.cancelled, value: t.fmt.num(o.cancelled) },
        { label: t.home.waitingMessages, value: t.fmt.num(f.waiting) },
        { label: t.home.postsThisWeek, value: t.fmt.num(f.posts.published) },
      ],
      href: "/app/orders",
    },
  ];
  if (o.top.length) blocks.push({ kind: "list", title: t.orders.week.top, items: o.top.map((p) => ({ title: p.name, badge: t.fmt.num(p.orders) })) });
  if (f.interest.length) {
    blocks.push({
      kind: "list",
      title: mk.sec,
      items: f.interest.map((p) => ({ title: p.name, sub: `${w.asked} ${t.fmt.num(p.asks)} · ${mk.orders} ${t.fmt.num(p.orders)} · ${mk.haggles} ${t.fmt.num(p.haggles)}` })),
    });
  }
  const where = f.buyers.cities.map((c) => cityLabel(c, lang)).filter(Boolean);
  const when = f.buyers.hours.map((h) => t.fmt.digits(`${String(h).padStart(2, "0")}:00`));
  if (where.length || when.length) {
    blocks.push({
      kind: "stats",
      items: [
        ...(where.length ? [{ label: t.orders.byCity, value: where.join(t.fmt.listSep) }] : []),
        ...(when.length ? [{ label: w.hours, value: isolateLtr(when.join(t.fmt.listSep)) }] : []),
      ],
    });
  }
  return blocks;
}

const get_business_picture = defineRead({
  name: "get_business_picture",
  description:
    "The shop's own numbers in one look, counts and sums only (no customer words): this week's orders and ordered value set against the week before (by status and currency), the products most ordered, which products buyers ask about, bargain over or rarely order (last 28 days), the cities and hours buyers come from, the messages waiting for the owner, the posts published this week, and what the owner said about their goal and their work. Use it BEFORE advising on how to sell more, what to post or how the week went, and quote only numbers that it or another tool returned. These are not market prices and say nothing about the future; an order is what a buyer asked for, not money collected, and 'no order recorded' is not a lost sale. It takes no arguments.",
  schema: z.object({}).strict(),
  kinds: ["shop"] as const,
  permission: "configure",
  risk: "read",
  label: (lang) => WORDS[lang].working,
  async run(ctx) {
    const facts = await collectFacts(ctx.tenantId);
    return { data: pictureForModel(facts), view: pictureView(facts, ctx.lang) };
  },
});

export const PICTURE_TOOLS: ReadTool[] = [get_business_picture];
