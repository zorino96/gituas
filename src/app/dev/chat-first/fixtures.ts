// Made-up data for /dev/chat-first: a shop's chat in all three languages, with every kind of block and a card in every state,
// and a pretend server (threads, a streamed answer, Confirm and Cancel) so the screen can be tried with no session and no database.

import type { AccountPlatform, ChatAccountsResult, ChatAccountsState } from "@/app/app/assistant/account-actions";
import type { AccountsApi } from "@/app/app/assistant/chat-accounts";
import type { ChatApi } from "@/app/app/assistant/chat-shell";
import type { ChatTransport } from "@/app/app/assistant/chat-transport";
import type { ChatEvent, ChatRequest, MessageDto, RunDecisionResponse, RunDto, ThreadSummary, ViewBlock } from "@/lib/chat/types";
import type { Lang } from "@/lib/i18n/lang";
import { NEWS_PICTURE, NEWS_WORDS } from "./fixtures-news";

export type Scenario = "thread" | "runs" | "long" | "empty" | "connect" | "classic" | "classic-off" | "settings" | "frozen";
export const SCENARIOS: readonly Scenario[] = ["thread", "runs", "long", "empty", "connect", "classic", "classic-off", "settings", "frozen"];

/** Which workspace the preview pretends to be: a shop (the default) or a news desk (?kind=news). */
export type DevKind = "shop" | "news";

export interface Words {
  shop: string;
  title: string;
  userOrders: string;
  replyOrders: string;
  stats: ViewBlock;
  table: ViewBlock;
  list: ViewBlock;
  userPost: string;
  replyPost: string;
  cardLines: { label: string; value: string }[];
  titles: { schedule: string; picture: string; setting: string; reply: string; price: string; failed: string; remove: string };
  results: { done: string; auto: string; failed: string; cancelled: string };
  warn: string;
  long: string;
  status: [string, string];
  final: string;
  quick: string;
  threads: string[];
}

const ckb: Words = {
  shop: "پێڵاوی ئاسۆ",
  title: "داواکارییەکانی ئەمڕۆ",
  userOrders: "ئەمڕۆ چەند داواکاری هاتووە؟",
  replyOrders: "ئەمڕۆ ٣ داواکاری هاتووە و کۆی گشتییان ٢٨٥,٠٠٠ دینارە. ٢ داواکاریان چاوەڕێی پشتڕاستکردنەوەن.",
  stats: {
    kind: "stats",
    title: "کورتەی ئەمڕۆ",
    items: [
      { label: "داواکاری", value: "٣" },
      { label: "کۆی فرۆشتن", value: "٢٨٥,٠٠٠ دینار" },
      { label: "چاوەڕێی پشتڕاستکردنەوە", value: "٢" },
      { label: "گەیەندراو", value: "١" },
    ],
    href: "/app/orders",
  },
  table: {
    kind: "table",
    title: "نوێترین داواکارییەکان",
    columns: ["کڕیار", "بەرهەم", "شار", "نرخ", "دۆخ"],
    rows: [
      ["ئارام کەریم", "پێڵاوی وەرزشی ٤٢", "هەولێر", "٩٥,٠٠٠", "نوێ"],
      ["Sara Ahmed", "Nike Air Max 270 Triple Black", "سلێمانی", "١٢٠,٠٠٠", "پشتڕاستکراوە"],
      ["دڵشاد", "کۆڵەپشتی", "دهۆک", "٧٠,٠٠٠", "گەیەندرا"],
    ],
    more: 4,
    href: "/app/orders",
  },
  list: {
    kind: "list",
    title: "کۆمێنتی بێ وەڵام",
    items: [
      { title: "نرخی ئەم پێڵاوە چەندە؟", sub: "ئینستاگرام · ٢ کاتژمێر لەمەوبەر", badge: "نوێ", href: "/app/comments" },
      { title: "گەیاندن بۆ کەرکوک هەیە؟", sub: "فەیسبووک · ٥ کاتژمێر لەمەوبەر", href: "/app/comments" },
    ],
  },
  userPost: "ئەمشەو کاتژمێر ٩ پۆستێک بکە بۆ پێڵاوە نوێیەکە لە ئینستاگرام و فەیسبووک",
  replyPost: "ئەمە پۆستەکەیە. ئەگەر دروستە «پەسەندکردن» بکە:",
  cardLines: [
    { label: "لە کوێ", value: "ئینستاگرام، فەیسبووک" },
    { label: "کەی (کاتی بەغدا)", value: "ئەمشەو ٩:٠٠" },
    { label: "کاپشن", value: "پێڵاوی وەرزشیی نوێ گەیشت 🔥 قەبارە ٣٩ تا ٤٤ · گەیاندن بۆ هەموو عێراق #پێڵاو #هەولێر #erbil" },
  ],
  titles: { schedule: "خشتەکردنی پۆست", picture: "دروستکردنی وێنە", setting: "وەڵامی خۆکار", reply: "وەڵامی کۆمێنت", price: "گۆڕینی نرخ", failed: "بڵاوکردنەوە ئێستا", remove: "سڕینەوەی بەرهەم" },
  results: { done: "پۆستەکە خشتە کرا بۆ ئەمشەو ٩:٠٠.", auto: "وەڵامی خۆکار چالاک کرا.", failed: "ئینستاگرام پۆستەکەی وەرنەگرت: بەستنەوەکە بەسەرچووە.", cancelled: "هەڵوەشێنرایەوە" },
  warn: "چاوەڕێی کڕیارێک مەکە: ئەم نرخانە لە نامەکانی کڕیارانەوە خوێندرانەوە.",
  long: "ئەمە نموونەیەکی زۆر درێژە بۆ تاقیکردنەوەی دابەشبوونی دێڕەکان: https://gituas.com/app/orders?status=pending&city=erbil&sort=newest&page=2&utm_source=assistant ، و وشەیەکی بێ بۆشایی SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nپاراگرافی دووەم: ژمارە و ناوی لاتینی وەک Nike، iPhone 15 Pro Max و 0750 123 4567 نابێت دیزاینەکە تێکبدەن.",
  status: ["سەیری داواکارییەکان دەکەم…", "کۆی ژمارەکان حیساب دەکەم…"],
  final: "ئەمڕۆ ٣ داواکاری هاتووە. ئەمە نوێترینەکانن:",
  quick: "ئەمانە نوێترین داواکارییەکانتن:",
  threads: ["داواکارییەکانی ئەمڕۆ", "پۆستی هاوین", "وێنەی پێڵاوی نوێ", "وەڵامی کۆمێنتەکان", "نرخی کۆڵەپشتی", "ڤیدیۆی ڕیکلام", "گەیاندن بۆ سلێمانی", "ئامارەکانی هەفتە", "Instagram caption ideas", "خشتەکردنی پۆستەکانی هەفتە", "چۆن وەڵامی خۆکار بکەمەوە", "نرخی گەیاندن", "داواکاریی بەرزترین", "هاشتاگی هەولێر", "کۆمێنتی سپام", "ژمارەی واتسئەپ", "بەرهەمی نوێ زیاد بکە", "قەبارەی ٤٢", "ئۆفەری جەژن", "کڕیاری نیگەران"],
};

const ar: Words = {
  shop: "حذاء آسو",
  title: "طلبات اليوم",
  userOrders: "كم طلبًا وصل اليوم؟",
  replyOrders: "وصل اليوم 3 طلبات ومجموعها 285,000 دينار. طلبان منها ينتظران التأكيد.",
  stats: {
    kind: "stats",
    title: "ملخص اليوم",
    items: [
      { label: "الطلبات", value: "٣" },
      { label: "إجمالي المبيعات", value: "٢٨٥,٠٠٠ دينار" },
      { label: "بانتظار التأكيد", value: "٢" },
      { label: "تم التسليم", value: "١" },
    ],
    href: "/app/orders",
  },
  table: {
    kind: "table",
    title: "آخر الطلبات",
    columns: ["الزبون", "المنتج", "المدينة", "السعر", "الحالة"],
    rows: [
      ["آرام كريم", "حذاء رياضي 42", "أربيل", "٩٥,٠٠٠", "جديد"],
      ["Sara Ahmed", "Nike Air Max 270 Triple Black", "السليمانية", "١٢٠,٠٠٠", "مؤكد"],
      ["دلشاد", "حقيبة ظهر", "دهوك", "٧٠,٠٠٠", "تم التسليم"],
    ],
    more: 4,
    href: "/app/orders",
  },
  list: {
    kind: "list",
    title: "تعليقات بلا رد",
    items: [
      { title: "كم سعر هذا الحذاء؟", sub: "إنستغرام · قبل ساعتين", badge: "جديد", href: "/app/comments" },
      { title: "هل التوصيل إلى كركوك متاح؟", sub: "فيسبوك · قبل 5 ساعات", href: "/app/comments" },
    ],
  },
  userPost: "انشر الليلة الساعة 9 منشورًا عن الحذاء الجديد على إنستغرام وفيسبوك",
  replyPost: "هذا هو المنشور. إن كان صحيحًا اضغط «موافقة»:",
  cardLines: [
    { label: "أين", value: "إنستغرام، فيسبوك" },
    { label: "متى (بتوقيت بغداد)", value: "الليلة 9:00" },
    { label: "النص", value: "وصل الحذاء الرياضي الجديد 🔥 المقاسات 39 إلى 44 · توصيل لكل العراق #حذاء #أربيل #erbil" },
  ],
  titles: { schedule: "جدولة منشور", picture: "إنشاء صورة", setting: "الرد التلقائي", reply: "الرد على تعليق", price: "تغيير السعر", failed: "النشر الآن", remove: "حذف منتج" },
  results: { done: "تمت جدولة المنشور الليلة 9:00.", auto: "تم تفعيل الرد التلقائي.", failed: "رفض إنستغرام المنشور: انتهت صلاحية الربط.", cancelled: "أُلغي" },
  warn: "لا تنتظر زبونًا: قُرئت هذه الأسعار من رسائل الزبائن.",
  long: "هذا مثال طويل جدًا لاختبار التفاف الأسطر: https://gituas.com/app/orders?status=pending&city=erbil&sort=newest&page=2&utm_source=assistant ، وكلمة بلا فراغات SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nالفقرة الثانية: أسماء لاتينية وأرقام مثل Nike وiPhone 15 Pro Max و0750 123 4567 يجب ألا تكسر التصميم.",
  status: ["أنظر في الطلبات…", "أحسب المجاميع…"],
  final: "وصل اليوم 3 طلبات. هذه آخرها:",
  quick: "هذه آخر طلباتك:",
  threads: ["طلبات اليوم", "منشور الصيف", "صورة الحذاء الجديد", "الرد على التعليقات", "سعر حقيبة الظهر", "فيديو إعلاني", "التوصيل إلى السليمانية", "إحصاءات الأسبوع", "Instagram caption ideas", "جدولة منشورات الأسبوع", "كيف أشغّل الرد التلقائي", "أجور التوصيل", "أعلى طلب", "هاشتاغ أربيل", "تعليقات مزعجة", "رقم واتساب", "أضف منتجًا جديدًا", "المقاس 42", "عرض العيد", "زبون غاضب"],
};

const en: Words = {
  shop: "Aso Shoes",
  title: "Today's orders",
  userOrders: "How many orders came in today?",
  replyOrders: "3 orders came in today, 285,000 IQD in total. 2 of them are waiting to be confirmed.",
  stats: {
    kind: "stats",
    title: "Today at a glance",
    items: [
      { label: "Orders", value: "3" },
      { label: "Total sales", value: "285,000 IQD" },
      { label: "Waiting to confirm", value: "2" },
      { label: "Delivered", value: "1" },
    ],
    href: "/app/orders",
  },
  table: {
    kind: "table",
    title: "Latest orders",
    columns: ["Customer", "Product", "City", "Price", "Status"],
    rows: [
      ["Aram Karim", "Sport shoes 42", "Erbil", "95,000", "New"],
      ["Sara Ahmed", "Nike Air Max 270 Triple Black", "Sulaymaniyah", "120,000", "Confirmed"],
      ["Dilshad", "Backpack", "Duhok", "70,000", "Delivered"],
    ],
    more: 4,
    href: "/app/orders",
  },
  list: {
    kind: "list",
    title: "Comments without a reply",
    items: [
      { title: "How much are these shoes?", sub: "Instagram · 2 hours ago", badge: "New", href: "/app/comments" },
      { title: "Do you deliver to Kirkuk?", sub: "Facebook · 5 hours ago", href: "/app/comments" },
    ],
  },
  userPost: "Post about the new shoes tonight at 9 on Instagram and Facebook",
  replyPost: "Here is the post. If it is right, press Confirm:",
  cardLines: [
    { label: "Where", value: "Instagram, Facebook" },
    { label: "When (Baghdad time)", value: "Tonight 9:00 PM" },
    { label: "Caption", value: "The new sport shoes are here 🔥 Sizes 39 to 44 · delivery across Iraq #shoes #erbil #sneakers" },
  ],
  titles: { schedule: "Schedule a post", picture: "Make a picture", setting: "Auto replies", reply: "Reply to a comment", price: "Change a price", failed: "Post now", remove: "Remove a product" },
  results: { done: "The post is scheduled for tonight at 9:00 PM.", auto: "Auto replies are on.", failed: "Instagram did not take the post: the connection has expired.", cancelled: "Cancelled" },
  warn: "Do not wait for a customer: these prices were read from customers' messages.",
  long: "This is a very long example to test how lines wrap: https://gituas.com/app/orders?status=pending&city=erbil&sort=newest&page=2&utm_source=assistant , and a word with no spaces SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nSecond paragraph: Kurdish names like ئارام and numbers like 0750 123 4567 must not break the layout.",
  status: ["Looking at the orders…", "Adding up the totals…"],
  final: "3 orders came in today. These are the latest:",
  quick: "Here are your latest orders:",
  threads: ["Today's orders", "Summer post", "Picture of the new shoes", "Replying to comments", "Backpack price", "Ad video", "Delivery to Sulaymaniyah", "This week's numbers", "Instagram caption ideas", "Schedule the week's posts", "How to turn on auto replies", "Delivery fee", "Biggest order", "Erbil hashtags", "Spam comments", "WhatsApp number", "Add a new product", "Size 42", "Eid offer", "Unhappy customer"],
};

const WORDS: Record<Lang, Words> = { ckb, ar, en };
const wordsOf = (lang: Lang, kind: DevKind): Words => (kind === "news" ? NEWS_WORDS : WORDS)[lang];
/** The name of the pretend shop, or of the pretend desk. */
export const shopName = (lang: Lang, kind: DevKind = "shop") => wordsOf(lang, kind).shop;

const T0 = Date.now();
const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * 60_000).toISOString();

function run(id: string, w: Words, over: Partial<RunDto> = {}): RunDto {
  return {
    id,
    tool: "schedule_post",
    risk: "public",
    title: w.titles.schedule,
    lines: w.cardLines,
    status: "PROPOSED",
    decidedBy: null,
    tainted: false,
    expiresAt: new Date(T0 + 14 * 60_000).toISOString(),
    long: false,
    ...over,
  };
}

const PICTURE = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#9fd3ff"/><stop offset="1" stop-color="#1d3f7a"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="370" font-size="300" text-anchor="middle">👟</text></svg>`,
  )}`,
  pathname: "merchant/dev/chat/picture.jpg",
  kind: "image" as const,
  name: "AI picture",
};

function msg(id: string, seq: number, role: "user" | "assistant", text: string, over: Partial<MessageDto> = {}): MessageDto {
  return { id, seq, role, text, blocks: [], runs: [], followups: [], attachments: [], createdAt: iso(60 - seq), ...over };
}

export function fixtureThread(lang: Lang, scenario: Scenario, kind: DevKind = "shop"): { thread: ThreadSummary | null; messages: MessageDto[] } {
  const w = wordsOf(lang, kind);
  const picture = kind === "news" ? NEWS_PICTURE : PICTURE;
  if (scenario === "empty" || scenario === "connect" || scenario === "classic" || scenario === "classic-off" || scenario === "settings" || scenario === "frozen") return { thread: null, messages: [] };
  const thread: ThreadSummary = { id: "t-demo", title: w.title, pinned: false, lastMessageAt: iso(1) };

  if (scenario === "long") {
    return {
      thread: { ...thread, title: `${w.title} · ${w.long.slice(0, 40)}` },
      messages: [msg("m1", 1, "user", w.long), msg("m2", 2, "assistant", w.long, { blocks: [{ kind: "note", text: w.warn, tone: "warn" }, { kind: "note", text: w.long }] })],
    };
  }

  if (scenario === "runs") {
    const states: RunDto[] = [
      run("r-proposed", w),
      run("r-tainted", w, { tainted: true, title: w.titles.price, risk: "public", tool: "update_product" }),
      run("r-running", w, { status: "RUNNING", decidedBy: "CONFIRMED", title: w.titles.picture, risk: "money", tool: "make_picture", long: true }),
      run("r-done", w, { status: "DONE", decidedBy: "CONFIRMED", resultText: w.results.done }),
      run("r-auto", w, { status: "DONE", decidedBy: "AUTO", title: w.titles.setting, risk: "standing", tool: "set_auto_replies", lines: [{ label: w.titles.setting, value: "ON" }], resultText: w.results.auto }),
      run("r-picture", w, { status: "DONE", decidedBy: "CONFIRMED", title: w.titles.picture, risk: "money", tool: "make_picture", lines: [], resultText: w.results.done, media: picture, long: true }),
      run("r-failed", w, { status: "FAILED", decidedBy: "CONFIRMED", title: w.titles.failed, tool: "post_now", error: w.results.failed }),
      run("r-cancelled", w, { status: "CANCELLED" }),
      run("r-expired", w, { status: "EXPIRED", expiresAt: iso(30) }),
      run("r-outbound", w, { title: w.titles.reply, risk: "outbound", tool: "reply_to_comment", lines: [{ label: w.cardLines[0].label, value: "@sara.ahmed" }] }),
      run("r-destructive", w, { title: w.titles.remove, risk: "destructive", tool: "archive_product", lines: [{ label: w.cardLines[0].label, value: w.table.kind === "table" ? w.table.rows[0][1] : "" }] }),
    ];
    return { thread, messages: [msg("m1", 1, "user", w.userPost), ...states.map((r, i) => msg(`m${i + 2}`, i + 2, "assistant", i === 0 ? w.replyPost : "", { runs: [r] }))] };
  }

  return {
    thread,
    messages: [
      msg("m1", 1, "user", w.userOrders),
      msg("m2", 2, "assistant", w.replyOrders, { blocks: [w.stats, w.table] }),
      msg("m3", 3, "user", w.userPost, { attachments: [{ id: "a1", url: picture.url, pathname: picture.pathname, kind: "image", name: picture.name }] }),
      msg("m4", 4, "assistant", w.replyPost, { runs: [run("r-open", w)] }),
      msg("m5", 5, "assistant", "", { blocks: [w.list] }),
      msg("m6", 6, "assistant", "", { blocks: [{ kind: "accounts" }] }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The pretend server.

export function fixtureThreads(lang: Lang, kind: DevKind = "shop"): ThreadSummary[] {
  const titles = wordsOf(lang, kind).threads;
  // Pinned two, today a few, then spread back over months, so every group of the sidebar has rows.
  const ages = [5, 40, 90, 300, 1500, 1700, 2900, 4400, 5800, 8700, 11000, 14500, 20000, 28000, 40000, 55000, 75000, 99000, 130000, 160000];
  return titles.map((title, i) => ({ id: `t-${i}`, title, pinned: i === 4 || i === 7, lastMessageAt: iso(ages[i] ?? 200000) }));
}

/**
 * The title the pretend server gives a new chat a few seconds after its first answer (the real one is written by the AI, title.ts). The
 * history list returns it from then on, so the screen's second read of the list (about four seconds after the first answer) shows it.
 */
const betterTitles = new Map<string, string>();

/** The pretend accounts of the Accounts sheet: two Pages, two Instagram accounts and a YouTube channel. A desk can only connect. */
function fixtureAccounts(kind: DevKind): AccountsApi {
  const wait = () => new Promise((r) => setTimeout(r, 250));
  const lists: ChatAccountsState["lists"] = {
    FB: [{ id: "fb-1", name: "Sunrise Bakery", avatarUrl: null }, { id: "fb-2", name: "Sunrise Cafe", avatarUrl: null }],
    IG: [{ id: "ig-1", name: "@sunrise.bakery", avatarUrl: null }, { id: "ig-2", name: "@sunrise.cafe", avatarUrl: null }],
    TT: [],
    YT: [{ id: "yt-1", name: "Sunrise TV", avatarUrl: null }],
  };
  let selected: ChatAccountsState["selected"] = { FB: "fb-2", IG: "ig-1", TT: null, YT: "yt-1" };
  const state = (): ChatAccountsResult => ({
    ok: true,
    kind: kind === "news" ? "news" : "shop",
    lists,
    selected: kind === "news" ? { FB: null, IG: null, TT: null, YT: null } : selected,
    canConfigure: true,
  });
  return {
    async list() {
      await wait();
      return state();
    },
    async choose({ platform, id }: { platform: AccountPlatform; id: string }) {
      await wait();
      if (kind === "news") return { ok: false, code: "forbidden" };
      if (!lists[platform].some((a) => a.id === id)) return { ok: false, code: "not_found" };
      selected = { ...selected, [platform]: id };
      return state();
    },
  };
}

export function fixtureApi(lang: Lang, kind: DevKind = "shop"): ChatApi {
  let threads =[{ id: "t-demo", title: wordsOf(lang, kind).title, pinned: false, lastMessageAt: iso(1) }, ...fixtureThreads(lang, kind)];
  const wait = () => new Promise((r) => setTimeout(r, 250));
  return {
    async list(input) {
      await wait();
      const q = input?.q?.trim().toLowerCase();
      // A chat made in this preview joins the list the first time the server is asked after its first answer, with the better title.
      const made = [...betterTitles].filter(([id]) => !threads.some((t) => t.id === id)).map(([id, title]) => ({ id, title, pinned: false, lastMessageAt: new Date().toISOString() }));
      const all = [...made, ...threads];
      return { ok: true, threads: q ? all.filter((t) => t.title.toLowerCase().includes(q)) : all };
    },
    async rename({ id, title }) {
      threads = threads.map((t) => (t.id === id ? { ...t, title } : t));
      return { ok: true };
    },
    async pin({ id, pinned }) {
      threads = threads.map((t) => (t.id === id ? { ...t, pinned } : t));
      return { ok: true };
    },
    async remove({ id }) {
      threads = threads.filter((t) => t.id !== id);
      return { ok: true };
    },
    accounts: fixtureAccounts(kind),
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Answers the way /api/chat does: newline-delimited events, with the pauses of a real turn. A message with "limit" is refused (turns used up), "busy" is refused, "fail" breaks after the message was kept. */
export function fakeTransport(lang: Lang, kind: DevKind = "shop"): ChatTransport {
  const w = wordsOf(lang, kind);
  let seq = 100;
  return {
    async send(req: ChatRequest, signal: AbortSignal) {
      const enc = new TextEncoder();
      const events = async (emit: (e: ChatEvent) => void) => {
        // Refused before anything is kept (as the real route does): the message goes back to the box.
        if (/limit/i.test(req.text)) return emit({ t: "error", code: "limit_day", message: "" });
        if (/busy/i.test(req.text)) return emit({ t: "error", code: "busy", message: "" });
        const threadId = req.threadId ?? "t-new";
        emit({ t: "thread", id: threadId, title: req.threadId ? w.title : req.text.slice(0, 40), isNew: !req.threadId });
        if (!req.threadId) setTimeout(() => betterTitles.set(threadId, `(AI title) ${req.text.slice(0, 24)}`), 1500);
        emit({ t: "message", message: msg(`u${++seq}`, ++seq, "user", req.text, { attachments: req.attachments ?? [] }) });
        // The turn broke after the message was kept: the message stays.
        if (/fail/i.test(req.text)) {
          await sleep(500, signal);
          return emit({ t: "error", code: "unavailable", message: "", contact: true });
        }
        if (req.quick) {
          await sleep(250, signal);
          emit({ t: "message", message: msg(`a${++seq}`, ++seq, "assistant", w.quick, { blocks: [w.table] }) });
          return emit({ t: "done", remaining: { day: 7, month: 120 }, ms: 250 });
        }
        await sleep(700, signal);
        emit({ t: "status", text: w.status[0] });
        await sleep(1100, signal);
        emit({ t: "status", text: w.status[1] });
        await sleep(1100, signal);
        emit({ t: "message", message: msg(`a${++seq}`, ++seq, "assistant", w.final, { blocks: [w.stats, w.table] }) });
        await sleep(400, signal);
        emit({ t: "message", message: msg(`a${++seq}`, ++seq, "assistant", w.replyPost, { runs: [run(`r${++seq}`, w)] }) });
        emit({ t: "done", remaining: { day: 6, month: 119 }, ms: 3300 });
      };
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (e: ChatEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
          try {
            await events(emit);
          } catch {
            /* stopped */
          }
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      });
      return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    },

    async decide(runId, body): Promise<RunDecisionResponse> {
      await sleep(body.action === "confirm" ? 1600 : 300);
      const done = body.action === "confirm";
      return {
        ok: true,
        run: run(runId, w, { status: done ? "DONE" : "CANCELLED", decidedBy: done ? "CONFIRMED" : null, resultText: done ? w.results.done : undefined }),
      };
    },
  };
}

export const fakePut = async (pathname: string, file: File) => ({ url: URL.createObjectURL(file), pathname });
