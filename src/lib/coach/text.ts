// The words of the growth coach, with no model in them: the rules-only note (a fixed table of sentences with the numbers filled in,
// in Sorani, Arabic and English), the label line, the phrases a note may never contain, and the check an AI wording must pass.
//
// The rules are the ones the plan sets: the goal is the owner's own (Gituas never judges what an account is for), nothing is predicted
// or promised, an order is what a buyer asked for and not money collected, and "no order recorded" is never "a sale lost".
// Pure: facts in, text out.

import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { num } from "@/lib/i18n/num";
import { cleanOutbound, foldForMatch } from "@/lib/chat/guard";
import { ungroundedNumbers } from "@/lib/chat/numbers";
import { cityLabel } from "@/lib/orders/cities";
import { exponentOf, formatMoney } from "@/lib/shop/money";
import { cleanLine } from "@/lib/shop/profile-shared";
import { factsText, hasActivity, type CoachFacts, type NoteLang } from "./facts";

export interface NotePoint {
  /** The bucket the sentence belongs to ("orders_up", "waiting" ...). An AI wording may reword a point but never invent a key. */
  key: string;
  text: string;
}

export interface NoteBody {
  headline: string;
  points: NotePoint[];
  tryThis: string[];
}

/** What is stored in CoachNote.body: the note and the language it is written in. */
export interface StoredBody extends NoteBody {
  lang: NoteLang;
}

/** The label line under every note: "AI reading of your own shop numbers. Not live market prices. No prediction." */
export const LABEL: Record<NoteLang, string> = { ckb: ckb.coach.label, ar: ar.coach.label, en: en.coach.label };
/** The same for a note that fixed rules wrote (no AI took part). */
export const LABEL_RULES: Record<NoteLang, string> = { ckb: ckb.coach.labelRules, ar: ar.coach.labelRules, en: en.coach.labelRules };

export const labelFor = (source: "ai" | "rules", lang: NoteLang): string => (source === "ai" ? LABEL[lang] : LABEL_RULES[lang]);

// ---------------------------------------------------------------------------------------------------------------------
// Formatting

const INDIC = "٠١٢٣٤٥٦٧٨٩";
const indic = (s: string): string => s.replace(/\d/g, (d) => INDIC[Number(d)]);

interface Fmt {
  n(x: number): string;
  hour(h: number): string;
  money(major: number, currency: string): string;
  city(code: string): string;
  sep: string;
}

function fmtFor(lang: NoteLang): Fmt {
  const latin = lang === "en";
  return {
    n: (x) => (latin ? x.toLocaleString("en-US") : num(x)),
    hour: (h) => {
      const s = `${String(h).padStart(2, "0")}:00`;
      return latin ? s : indic(s);
    },
    money: (major, currency) => formatMoney(Math.round(major * 10 ** exponentOf(currency)), currency, lang),
    city: (code) => cityLabel(code, lang) || code,
    sep: latin ? ", " : "، ",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The table

interface Words {
  headline: { noData: string; ordersNone: string; ordersUp: string; ordersDown: string; ordersSame: string; activity: string };
  noData: string;
  ordersNone: string;
  ordersUp(f: Fmt, week: number, before: number, pct: number | null): string;
  ordersDown(f: Fmt, week: number, before: number, pct: number | null): string;
  ordersSame(f: Fmt, week: number): string;
  ordersValue(sales: string): string;
  ordersLost(f: Fmt, n: number): string;
  topProduct(f: Fmt, name: string, n: number): string;
  asksFewOrders(f: Fmt, name: string, asks: number, orders: number): string;
  haggle(f: Fmt, name: string, pct: number): string;
  waiting(f: Fmt, n: number): string;
  postsNone: string;
  postsSome(f: Fmt, n: number): string;
  messages(f: Fmt, dm: number, dmBefore: number, comments: number, commentsBefore: number): string;
  buyersWhere(cities: string): string;
  buyersWhen(hours: string): string;
  goalMissing: string;
  tryReply: string;
  tryPost: string;
  tryAsk(name: string): string;
  tryPrice(name: string): string;
  tryHours: string;
  tryStart: string;
}

const WORDS: Record<NoteLang, Words> = {
  en: {
    headline: {
      noData: "Not enough numbers yet this week",
      ordersNone: "No orders recorded this week",
      ordersUp: "Orders are up on last week",
      ordersDown: "Orders are down on last week",
      ordersSame: "Orders are the same as last week",
      activity: "Your week in posts, comments and messages",
    },
    noData: "Gituas has not recorded any orders, messages or posts this week or the week before.",
    ordersNone: "No order was recorded in Gituas this week or the week before.",
    ordersUp: (f, w, b, pct) => `${f.n(w)} ${w === 1 ? "order was" : "orders were"} recorded this week, ${f.n(b)} the week before${pct !== null ? ` (${f.n(pct)}% more)` : ""}.`,
    ordersDown: (f, w, b, pct) => `${f.n(w)} ${w === 1 ? "order was" : "orders were"} recorded this week, ${f.n(b)} the week before${pct !== null ? ` (${f.n(Math.abs(pct))}% fewer)` : ""}.`,
    ordersSame: (f, w) => `${f.n(w)} ${w === 1 ? "order was" : "orders were"} recorded this week, the same as the week before.`,
    ordersValue: (s) => `Orders recorded this week are worth ${s}. This is what buyers ordered, not money you have collected.`,
    ordersLost: (f, n) => `${f.n(n)} ${n === 1 ? "order was" : "orders were"} cancelled or returned this week.`,
    topProduct: (f, name, n) => `The product with the most orders this week: ${name} (${f.n(n)}).`,
    asksFewOrders: (f, name, asks, orders) => `Buyers asked about ${name} ${f.n(asks)} times in the last 28 days, and ${f.n(orders)} ${orders === 1 ? "order is" : "orders are"} recorded in Gituas.`,
    haggle: (f, name, pct) => `Of the buyers who wrote about ${name}, ${f.n(pct)}% bargained over the price.`,
    waiting: (f, n) => `${f.n(n)} ${n === 1 ? "message is" : "messages are"} waiting for you under “Needs you”.`,
    postsNone: "No post was published through Gituas this week.",
    postsSome: (f, n) => `${f.n(n)} ${n === 1 ? "post was" : "posts were"} published through Gituas this week (counted once for each platform).`,
    messages: (f, dm, dmB, c, cB) => `Buyers wrote ${f.n(dm)} ${dm === 1 ? "message" : "messages"} and ${f.n(c)} ${c === 1 ? "comment" : "comments"} this week (the week before: ${f.n(dmB)} and ${f.n(cB)}).`,
    buyersWhere: (cities) => `The cities with most of your recorded orders: ${cities}.`,
    buyersWhen: (hours) => `Buyers write most around these hours: ${hours}.`,
    goalMissing: "Your goal is your own, so this note only counts posts, comments and messages. Follower numbers are in Insights.",
    tryReply: "Open “Needs you” and answer those messages first.",
    tryPost: "Prepare one post for your best product. Auto posts can prepare one every day.",
    tryAsk: (name) => `Look at ${name}: check its price, its photos and the replies buyers get.`,
    tryPrice: (name) => `Check whether the price of ${name} suits your buyers, or say in the post what the price includes.`,
    tryHours: "Plan your posts around the hours buyers write most.",
    tryStart: "Post a product with a clear price and how to order it.",
  },
  ar: {
    headline: {
      noData: "لا توجد أرقام كافية لهذا الأسبوع بعد",
      ordersNone: "لم يُسجَّل أي طلب هذا الأسبوع",
      ordersUp: "الطلبات أكثر من الأسبوع الماضي",
      ordersDown: "الطلبات أقل من الأسبوع الماضي",
      ordersSame: "الطلبات مثل الأسبوع الماضي",
      activity: "أسبوعك في المنشورات والتعليقات والرسائل",
    },
    noData: "لم يسجّل Gituas أي طلبات أو رسائل أو منشورات هذا الأسبوع ولا الأسبوع الذي قبله.",
    ordersNone: "لم يُسجَّل أي طلب في Gituas هذا الأسبوع ولا في الأسبوع الذي قبله.",
    ordersUp: (f, w, b, pct) => `الطلبات المسجّلة هذا الأسبوع: ${f.n(w)}، وفي الأسبوع الذي قبله: ${f.n(b)}${pct !== null ? ` (بزيادة ${f.n(pct)}%)` : ""}.`,
    ordersDown: (f, w, b, pct) => `الطلبات المسجّلة هذا الأسبوع: ${f.n(w)}، وفي الأسبوع الذي قبله: ${f.n(b)}${pct !== null ? ` (بنقص ${f.n(Math.abs(pct))}%)` : ""}.`,
    ordersSame: (f, w) => `الطلبات المسجّلة هذا الأسبوع: ${f.n(w)}، مثل الأسبوع الذي قبله.`,
    ordersValue: (s) => `قيمة الطلبات المسجّلة هذا الأسبوع: ${s}. هذا ما طلبه المشترون وليس مالاً استلمته.`,
    ordersLost: (f, n) => `الطلبات الملغاة أو المعادة هذا الأسبوع: ${f.n(n)}.`,
    topProduct: (f, name, n) => `المنتج الأكثر طلباً هذا الأسبوع: ${name} (${f.n(n)}).`,
    asksFewOrders: (f, name, asks, orders) => `سؤال المشترين عن «${name}» خلال آخر ${f.n(28)} يوماً: ${f.n(asks)} مرة، والطلبات المسجّلة في Gituas: ${f.n(orders)}.`,
    haggle: (f, name, pct) => `من بين من كتبوا عن «${name}»، ساوم ${f.n(pct)}% منهم على السعر.`,
    waiting: (f, n) => `الرسائل التي تنتظرك في قسم «يحتاج إليك»: ${f.n(n)}.`,
    postsNone: "لم يُنشر أي منشور عبر Gituas هذا الأسبوع.",
    postsSome: (f, n) => `المنشورات عبر Gituas هذا الأسبوع: ${f.n(n)} (تُحسب مرة لكل منصة).`,
    messages: (f, dm, dmB, c, cB) => `رسائل المشترين هذا الأسبوع: ${f.n(dm)}، وتعليقاتهم: ${f.n(c)} (الأسبوع الذي قبله: ${f.n(dmB)} و${f.n(cB)}).`,
    buyersWhere: (cities) => `أكثر المدن في طلباتك المسجّلة: ${cities}.`,
    buyersWhen: (hours) => `يكتب المشترون أكثر في هذه الساعات: ${hours}.`,
    goalMissing: "هدفك من اختيارك أنت، لذلك تعدّ هذه الملاحظة المنشورات والتعليقات والرسائل فقط. أرقام المتابعين في قسم «الإحصائيات».",
    tryReply: "افتح قسم «يحتاج إليك» وأجب عن تلك الرسائل أولاً.",
    tryPost: "جهّز منشوراً لأفضل منتجاتك. يمكن للنشر التلقائي أن يجهّز واحداً كل يوم.",
    tryAsk: (name) => `راجع «${name}»: سعره وصوره والردود التي يتلقاها المشترون.`,
    tryPrice: (name) => `تحقق هل يناسب سعر «${name}» زبائنك، أو اكتب في المنشور ما يشمله السعر.`,
    tryHours: "اجعل منشوراتك قرب الساعات التي يكتب فيها المشترون أكثر.",
    tryStart: "انشر منتجاً بسعر واضح وطريقة الطلب.",
  },
  ckb: {
    headline: {
      noData: "هێشتا ژمارەی پێویست نییە بۆ ئەم هەفتەیە",
      ordersNone: "ئەم هەفتەیە هیچ داواکارییەک تۆمار نەکراوە",
      ordersUp: "داواکاری لە هەفتەی ڕابردوو زیاترە",
      ordersDown: "داواکاری لە هەفتەی ڕابردوو کەمترە",
      ordersSame: "داواکاری وەک هەفتەی ڕابردووە",
      activity: "هەفتەکەت لە پۆست و کۆمێنت و نامەدا",
    },
    noData: "ئەم هەفتەیە و هەفتەی پێشتر گیتواس هیچ داواکاری و نامە و پۆستێکی تۆمار نەکردووە.",
    ordersNone: "لەم هەفتەیە و هەفتەی پێشتریشدا هیچ داواکارییەک لە گیتواسدا تۆمار نەکراوە.",
    ordersUp: (f, w, b, pct) => `${f.n(w)} داواکاری لەم هەفتەیەدا تۆمارکراوە، ${f.n(b)} لە هەفتەی پێشتر${pct !== null ? ` (${f.n(pct)}% زیاتر)` : ""}.`,
    ordersDown: (f, w, b, pct) => `${f.n(w)} داواکاری لەم هەفتەیەدا تۆمارکراوە، ${f.n(b)} لە هەفتەی پێشتر${pct !== null ? ` (${f.n(Math.abs(pct))}% کەمتر)` : ""}.`,
    ordersSame: (f, w) => `${f.n(w)} داواکاری لەم هەفتەیەدا تۆمارکراوە، هەمان ژمارەی هەفتەی پێشتر.`,
    ordersValue: (s) => `بەهای داواکارییەکانی ئەم هەفتەیە: ${s}. ئەمە ئەوەیە کڕیاران داویانکردووە، نەک ئەو پارەیەی وەرتگرتووە.`,
    ordersLost: (f, n) => `${f.n(n)} داواکاری ئەم هەفتەیە هەڵوەشێنراوەتەوە یان گەڕێنراوەتەوە.`,
    topProduct: (f, name, n) => `بەرهەمی زۆرترین داواکاری ئەم هەفتەیە: ${name} (${f.n(n)}).`,
    asksFewOrders: (f, name, asks, orders) => `لە ${f.n(28)} ڕۆژی ڕابردوودا کڕیاران ${f.n(asks)} جار دەربارەی «${name}» پرسیاریان کردووە، و ${f.n(orders)} داواکاری لە گیتواسدا تۆمارکراوە.`,
    haggle: (f, name, pct) => `لەو کڕیارانەی دەربارەی «${name}» نووسیویانە، ${f.n(pct)}% لەسەر نرخ گفتوگۆیان کردووە.`,
    waiting: (f, n) => `${f.n(n)} نامە لە بەشی «پێویستی بە تۆیە» چاوەڕێی تۆیە.`,
    postsNone: "ئەم هەفتەیە هیچ پۆستێک بە گیتواس بڵاونەکراوەتەوە.",
    postsSome: (f, n) => `${f.n(n)} پۆست ئەم هەفتەیە بە گیتواس بڵاوکراونەتەوە (بۆ هەر پلاتفۆرمێک جارێک دەژمێردرێت).`,
    messages: (f, dm, dmB, c, cB) => `کڕیاران ئەم هەفتەیە ${f.n(dm)} نامە و ${f.n(c)} کۆمێنتیان نووسیوە (هەفتەی پێشتر: ${f.n(dmB)} و ${f.n(cB)}).`,
    buyersWhere: (cities) => `ئەو شارانەی زۆرترین داواکاریی تۆمارکراوی تۆیان لێوەیە: ${cities}.`,
    buyersWhen: (hours) => `کڕیاران زۆرتر لە نزیکەی ئەم کاتژمێرانەدا دەنووسن: ${hours}.`,
    goalMissing: "ئامانجەکەت هی خۆتە، بۆیە ئەم تێبینییە تەنها ژمارەی پۆست و کۆمێنت و نامە دەژمێرێت. ژمارەی فۆڵۆوەر لە بەشی «ئامار»دایە.",
    tryReply: "بەشی «پێویستی بە تۆیە» بکەرەوە و سەرەتا وەڵامی ئەو نامانە بدەرەوە.",
    tryPost: "پۆستێک بۆ باشترین بەرهەمەکەت ئامادە بکە. پۆستی خۆکار دەتوانێت ڕۆژانە یەکێک ئامادە بکات.",
    tryAsk: (name) => `تەماشای «${name}» بکە: نرخ و وێنەکانی و ئەو وەڵامانەی کڕیاران وەریدەگرن بپشکنە.`,
    tryPrice: (name) => `بپشکنە ئایا نرخی «${name}» لەگەڵ کڕیارانت دەگونجێت، یان لە پۆستەکەدا بنووسە نرخەکە چی دەگرێتەوە.`,
    tryHours: "پۆستەکانت بخەرە نزیک ئەو کاتژمێرانەی کڕیاران زۆرتر دەنووسن.",
    tryStart: "بەرهەمێک بڵاوبکەرەوە بە نرخێکی ڕوون و ڕێگەی داواکردنەوە.",
  },
};

/** The sentence a bucket has in a language, for the languages' words that are plain strings (used by the tests and the AI draft). */
export const WORDS_BY_LANG = WORDS;

// ---------------------------------------------------------------------------------------------------------------------
// The rules-only note

/** An ask is "many with few orders" at this many asks and fewer than 5 orders in 100 (the Insights screen's own rule). */
const MANY_ASKS = 10;
const FEW_ORDERS_RATIO = 0.05;
/** A share of buyers who bargain is worth a word from this percentage. */
const HAGGLE_PCT = 20;
/** A hint about where and when buyers are needs this many messages (or orders) behind it. */
const MIN_SAMPLE = 10;
const MAX_POINTS = 8;
const MAX_TRY = 3;

/**
 * The note for these facts in this language, with no model: one sentence per thing the numbers show, in a fixed order, and up to three
 * things to try. For a goal of growing an audience (or "something else") the orders are left out: only posts, comments and messages are
 * counted, and the note says so.
 */
export function renderRules(facts: CoachFacts, lang: NoteLang): NoteBody {
  const W = WORDS[lang];
  const f = fmtFor(lang);
  if (!hasActivity(facts)) return { headline: W.headline.noData, points: [{ key: "no_data", text: W.noData }], tryThis: [] };

  const talksOrders = facts.goal.kind !== "grow" && facts.goal.kind !== "other";
  const o = facts.orders;
  const m = facts.messages;
  const b = facts.buyers;
  const points: NotePoint[] = [];
  const add = (key: string, text: string) => void points.push({ key, text });
  // The things to try, kept apart so that they come out in a fixed order of importance whatever order the points are written in.
  const tries: Partial<Record<"ask" | "price" | "reply" | "hours" | "post" | "start", string>> = {};

  // The headline, and the first points: what happened to the orders (only for a goal that is about orders).
  let headline = W.headline.activity;
  if (talksOrders) {
    if (o.week === 0 && o.before === 0) {
      headline = W.headline.ordersNone;
      add("orders_none", W.ordersNone);
      tries.start = W.tryStart;
    } else if (o.week > o.before) {
      headline = W.headline.ordersUp;
      add("orders_up", W.ordersUp(f, o.week, o.before, o.changePct));
    } else if (o.week < o.before) {
      headline = W.headline.ordersDown;
      add("orders_down", W.ordersDown(f, o.week, o.before, o.changePct));
    } else {
      headline = W.headline.ordersSame;
      add("orders_same", W.ordersSame(f, o.week));
    }
    const value = Object.entries(o.sales)
      .filter(([, v]) => v > 0)
      .map(([cur, v]) => f.money(v, cur));
    if (value.length) add("orders_value", W.ordersValue(value.join(f.sep)));
  }

  // What needs the owner now.
  if (facts.waiting > 0) {
    add("waiting", W.waiting(f, facts.waiting));
    tries.reply = W.tryReply;
  }

  // What the buyers' questions show (selling goals).
  if (talksOrders) {
    const unsold = facts.interest.find((p) => p.asks >= MANY_ASKS && p.orders / p.asks < FEW_ORDERS_RATIO);
    if (unsold) {
      add("asks_few_orders", W.asksFewOrders(f, unsold.name, unsold.asks, unsold.orders));
      tries.ask = W.tryAsk(unsold.name);
    }
    const haggled = facts.interest.find((p) => p.haggleSharePct !== null && p.haggleSharePct >= HAGGLE_PCT);
    if (haggled && haggled.haggleSharePct !== null) {
      add("haggle", W.haggle(f, haggled.name, haggled.haggleSharePct));
      tries.price = W.tryPrice(haggled.name);
    }
    const top = o.top[0];
    if (top && top.orders >= 2) add("top_product", W.topProduct(f, top.name, top.orders));
    if (o.cancelled > 0) add("orders_lost", W.ordersLost(f, o.cancelled));
  }

  // Messages and posts.
  if (m.dm + m.dmBefore + m.comments + m.commentsBefore > 0) add("messages", W.messages(f, m.dm, m.dmBefore, m.comments, m.commentsBefore));
  if (facts.posts.published > 0) add("posts_some", W.postsSome(f, facts.posts.published));
  else {
    add("posts_none", W.postsNone);
    tries.post = W.tryPost;
  }

  // Where and when the buyers are, with enough behind it.
  if (talksOrders && b.orders >= MIN_SAMPLE && b.cities.length) add("buyers_where", W.buyersWhere(b.cities.slice(0, 3).map(f.city).join(f.sep)));
  if (b.messages >= MIN_SAMPLE && b.hours.length) {
    add("buyers_when", W.buyersWhen(b.hours.slice(0, 3).map(f.hour).join(f.sep)));
    tries.hours = W.tryHours;
  }
  if (!talksOrders) add("goal_missing", W.goalMissing);

  const tryThis = (["ask", "price", "reply", "hours", "post", "start"] as const).map((k) => tries[k]).filter((t): t is string => !!t);
  return { headline, points: points.slice(0, MAX_POINTS), tryThis: tryThis.slice(0, MAX_TRY) };
}

// ---------------------------------------------------------------------------------------------------------------------
// What a note may never say

/** Prediction, promise, guarantee; English. */
const PREDICTION_EN = /\b(will|won't|wouldn't|you'll|it'll|they'll|going to|gonna|guarantee[ds]?|guaranteeing|promise[ds]?|predict\w*|forecast\w*|expect\w*|certain\w*|definitely|surely|for sure|sure to|bound to|projected|projection)\b/i;
/** A promise in the present tense: "posting more often brings more orders", "this helps you sell more", "replying fast boosts your sales". */
const PROMISE_EN =
  /\b(?:brings?|bringing|leads? to|results? in|resulted? in)\s+(?:you\s+)?(?:many\s+)?(?:more|extra|better|higher|new)\b|\b(?:helps?|helping)\s+you\s+(?:to\s+)?(?:sell|get|win|earn|grow|reach|make)\s+(?:more|better|higher)\b|\b(?:boosts?|increases?|raises?|doubles?)\s+(?:your\s+)?(?:sales|orders|revenue|buyers|followers|profit)\b/i;
/** Judging what an account is for, or how its owner is doing. */
const JUDGEMENT_EN =
  /\b(not (really )?(for|meant for|made for|suited to) (selling|business)|(isn't|is not|aren't|are not) (for|meant for|made for) (selling|business)|doesn't sell|does not sell|waste of|wasting|pointless|useless|worthless|failing|failure|failed|you should (stop|quit|give up|not use)|stop using|give up|bad (at|business|seller|shop)|good (job|work|seller|shop)|great (job|work|shop)|well done|doing (very )?(well|badly|great|poorly|terrible|terribly))\b/i;

// Arabic and Sorani. Both lists are matched on text made comparable (foldBan): diacritics, the stretching letter and invisible
// characters out, and the letters that are written in more than one way (alif with or without hamza, the two yehs, the two kafs, the
// heh and Sorani ae, ta marbuta) made one. The lists below are written naturally; fragments are folded the same way when they are
// compared. They are a net, not a promise: a blocklist can never be complete, so a native-speaker review of both lists is wanted
// (see the review request that goes with this change).

/** Words that begin a future or a promise in Arabic ("will", "you will get", "I promise"); matched at the start of a word, with one of the joining letters (wa, fa, li, bi) allowed before. */
const WORDS_AR = [
  // future: "will increase / rise / grow / help / bring / get / earn / reach / improve / see"
  "سوف", "سيزيد", "ستزيد", "سيزداد", "ستزداد", "سيرتفع", "سترتفع", "سينمو", "ستنمو", "سيتضاعف", "ستتضاعف", "سيضاعف", "ستضاعف", "سيتحسن", "ستتحسن",
  "سيساعد", "ستساعد", "سيؤدي", "ستؤدي", "سيجلب", "ستجلب", "سيجذب", "ستجذب", "سيحقق", "ستحقق", "سينجح", "ستنجح", "سيصبح", "ستصبح",
  "سيبيع", "ستبيع", "سيربح", "ستربح", "سيكسب", "ستكسب", "ستجني", "ستحصد", "سيحصل", "ستحصل", "سيصل", "ستصل", "ستتمكن", "سيتمكن", "سترى", "ستلاحظ",
  "سينخفض", "ستنخفض", "سيقل", "ستقل", "سيعود", "ستعود",
  // promise and certainty
  "أعدك", "اعدك", "نعدك", "وعد", "ضمان", "نضمن", "أضمن", "اضمن", "مضمون", "مؤكد", "بالتأكيد", "بكل تأكيد", "من المؤكد", "حتما", "حتماً", "لا شك", "بلا شك", "دون شك", "بدون شك", "يقينا", "يقيناً",
  // prediction
  "تنبؤ", "نتوقع", "أتوقع", "اتوقع", "توقعات", "توقع",
  // a promise in the present tense
  "تبيع أكثر", "تبيع المزيد", "تحصل على المزيد", "تحصل على طلبات", "يجلب لك", "يزيد مبيعاتك", "يزيد طلباتك", "يزيد من مبيعاتك", "يزيد من طلباتك", "يساعدك على البيع", "يساعدك في البيع",
];
/** Other Arabic phrases (judgements), matched anywhere. */
const FRAGMENTS_AR = [
  "لا يصلح للبيع", "غير مخصص للبيع", "لا يبيع", "فاشل", "فشل", "ضياع للوقت", "مضيعة", "أحسنت", "عمل رائع", "عمل ممتاز", "أداء ممتاز", "أداء سيئ",
];
/** Sorani: matched anywhere. Mostly whole forms of a verb ("will receive", "will increase", "helps you", "can sell more"), a promise or a judgement. */
const FRAGMENTS_CKB = [
  // prediction, promise, certainty
  "گەرەنتی", "دڵنیام", "دڵنیایی", "دڵنیابە", "دڵنیا بە", "بێگومان", "حەتمەن", "بەڵێن", "پێشبینی",
  // "will be / will go up / will go down / becomes"
  "دەفرۆشرێت", "زیاد دەبێت", "زیاد دەبن", "زیاتر دەبێت", "زیاتر دەبن", "باشتر دەبێت", "باشتر دەبن", "باشتر دەبیت", "کەمتر دەبێت", "کەمتر دەبن", "زۆرتر دەبێت", "بەرزتر دەبێت", "بەرز دەبێتەوە", "دابەزێت", "دەبێتە", "دەگەیتە",
  // "increases / you will receive / you will sell more / you can sell more / helps you"
  "زیاد دەکات", "زیاد دەکەن", "زیاد دەکەیت", "وەردەگریت", "وەردەگرێت", "زیاتر دەفرۆشیت", "زیاتر دەفرۆشێت", "دەتوانیت زیاتر بفرۆشیت", "یارمەتیت دەدات", "یارمەتیتان دەدات",
  // judgement
  "سەرکەوتوو دەبیت", "شکست", "بێسوود", "بۆ فرۆشتن نییە", "بۆ فرۆشتن نین", "کاتت بەفیڕۆ", "باش کارت کردووە", "کارێکی نایاب", "کارێکی باش", "خراپ کارت",
];

// Built from code points so that no invisible character is ever written into this source file.
const BAN_DROP = /[\u{64b}-\u{65f}\u{670}\u{640}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}\u{feff}]/gu;
/** Text made comparable for the Arabic and Sorani lists. */
export function foldBan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(BAN_DROP, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[يىی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/[هەةہھ]/g, "ە")
    .replace(/\s+/g, " ");
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORDS_AR_RE = new RegExp(`(?<![\\p{L}\\p{M}])(?:[وفلب]?(?:ال)?)(?:${WORDS_AR.map((w) => escapeRe(foldBan(w))).join("|")})`, "u");
const FOLDED_AR = FRAGMENTS_AR.map(foldBan);
const FOLDED_CKB = FRAGMENTS_CKB.map(foldBan);

/** The first phrase a note may not contain, or null when the text is clean. */
export function bannedPhrase(text: string): string | null {
  const en = PREDICTION_EN.exec(text) ?? PROMISE_EN.exec(text) ?? JUDGEMENT_EN.exec(text);
  if (en) return en[0];
  const folded = foldBan(text);
  const word = WORDS_AR_RE.exec(folded);
  if (word) return word[0];
  for (const frag of [...FOLDED_AR, ...FOLDED_CKB]) if (folded.includes(frag)) return frag;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking an AI wording

export const LIMITS = { headline: 100, point: 280, tryThis: 220, points: 6, tries: 3 } as const;

/**
 * A link, an e-mail address, a domain, an @handle or a phone number in a line. The chat's own cleaner decides (it knows that a value
 * like 1,250,000 IQD is a price and not a phone number, which matters here: a week's orders easily reach seven digits).
 */
export function hasContact(text: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  // Clock times are not phone numbers, even several in a row ("20:00, 21:00, 22:00" has as many digits as a phone number). Digits of any script
  // are made plain first, so the Arabic-Indic hours of a Sorani note are read the same way.
  const plain = foldForMatch(text).replace(/(?<![0-9])\d{1,2}:\d{2}(?![0-9])/g, "T");
  return squash(cleanOutbound(plain, "")) !== squash(plain);
}

/** A line the AI wrote, cleaned, or null when it may not be shown: empty, too long, a link or a phone number, a banned phrase, a number nobody gave. */
export function acceptLine(raw: unknown, max: number, allowedText: string): string | null {
  const text = cleanLine(raw, max + 40);
  if (!text || Array.from(text).length > max) return null;
  if (hasContact(text) || bannedPhrase(text)) return null;
  if (ungroundedNumbers(text, allowedText).length) return null;
  return text;
}

/**
 * The AI's answer made into a note, or null when nothing of it can be used. Every number in a line must be in the facts (or in the draft
 * the rules wrote); a line that fails is dropped, not repaired; a point's key must be one the rules draft has; a failed headline or a
 * missing "try this" is taken from the rules draft. The AI can reword and drop, never invent a topic or a number.
 */
export function validateAiNote(raw: unknown, o: { facts: CoachFacts; rules: NoteBody }): NoteBody | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // The windows the numbers cover (7 days, 28 days) may be named even when the draft does not.
  const allowedText = [factsText(o.facts), "windows: 7 days, 28 days", o.rules.headline, ...o.rules.points.map((p) => p.text), ...o.rules.tryThis].join("\n");
  const keys = new Set(o.rules.points.map((p) => p.key));

  const points: NotePoint[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(r.points) ? r.points.slice(0, 20) : []) {
    if (!p || typeof p !== "object") continue;
    const key = (p as { key?: unknown }).key;
    if (typeof key !== "string" || !keys.has(key) || seen.has(key)) continue;
    const text = acceptLine((p as { text?: unknown }).text, LIMITS.point, allowedText);
    if (!text) continue;
    seen.add(key);
    points.push({ key, text });
    if (points.length >= LIMITS.points) break;
  }
  if (!points.length) return null;

  const headline = acceptLine(r.headline, LIMITS.headline, allowedText) ?? o.rules.headline;
  const tries = (Array.isArray(r.tryThis) ? r.tryThis.slice(0, 10) : [])
    .map((t) => acceptLine(t, LIMITS.tryThis, allowedText))
    .filter((t): t is string => !!t)
    .slice(0, LIMITS.tries);
  return { headline, points, tryThis: tries.length ? tries : o.rules.tryThis };
}
