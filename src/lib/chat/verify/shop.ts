// Read-backs of the shop's changes. After a post, a product, an order status or a setting is changed from the chat, the change is read
// again from the stored data and compared with what was asked. Read-only, always inside the workspace (tenantId), at most one or two
// queries per check. A check that cannot tell returns null; a problem is only a clear mismatch (the row is missing, a value differs).
//
// Where each change lands (the same actions the app's own screens use):
//   post_now                      AuditLog "app.publish" / "app.publish_failed", one row per platform (metadata.target)
//   schedule_post / cancel        ScheduledPost (input = the post, runAt, status)
//   the four settings tools       Store columns (automationEnabled, autoMode, videoAutoMode, ...)
//   add / update / archive        Product + ProductVariant
//   set_whatsapp_number           Tenant.whatsappNumber
//   set_order_status              Order.status
// hide_comment, reply_to_comment and send_message have no check on purpose: the only thing stored is the AuditLog row that the action itself
// writes after the platform said yes, so a "check" would only repeat that the run was ok and could never fail.

import { db } from "@/lib/db";
import { videoLangOf } from "@/lib/advideo/lang";
import { parseVideoAutoPlan, type VideoAutoPlan } from "@/lib/advideo/plan";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { Lang } from "@/lib/i18n/lang";
import { num } from "@/lib/i18n/num";
import { normalizePhone } from "@/lib/merchant/phone";
import { baghdadLocalToUtc } from "@/lib/merchant/schedule";
import { effectiveMode } from "@/lib/shop/autopilot-plan";
import { parsePrice, toWesternDigits } from "@/lib/shop/forms";
import { formatMoney } from "@/lib/shop/money";
import { attachmentsOf, clip, say, words, type Say, type Words } from "../tools/writes-common";
import type { ToolCtx, VerifyFn, VerifyReport } from "../types";

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers

/** How far back a record of "this just happened" may be: the check runs right after the change, so a few minutes is plenty. */
const RECENT_MS = 5 * 60_000;
/** A row that the change created (a product, a scheduled post) must be this new. */
const CREATED_MS = 10 * 60_000;
const since = (ms: number) => new Date(Date.now() - ms);

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** A text as the app stores it: trimmed, cut to the field's length. */
const norm = (s: string, max: number): string => Array.from(s.trim()).slice(0, max).join("");
/** The id of a record as the app makes them (cuid); anything else is a name the person or the model typed. */
const ID_SHAPE = /^c[a-z0-9]{20,}$/;

const plain = (s: string): Words => words(s, s, s);
/** A number: Arabic-Indic digits for Sorani and Arabic (as the rest of the app and the money show them), Latin for English. */
const count = (n: number): Words => words(num(n), num(n), String(n));
/** A sentence with one value in it, in the three languages at once. */
const fill = (s: Say<[string]>, v: string | Words): Words => words(s.ckb(typeof v === "string" ? v : v.ckb), s.ar(typeof v === "string" ? v : v.ar), s.en(typeof v === "string" ? v : v.en));
const targetsOf = (v: unknown): ("FB" | "IG")[] => (Array.isArray(v) ? [...new Set(v.filter((t): t is "FB" | "IG" => t === "FB" || t === "IG"))] : []);

// ---------------------------------------------------------------------------------------------------------------------
// The person's words (Sorani, Arabic, English). Arabic does not use Kurdish-only letters.

const EMPTY = words("بەتاڵ", "فارغ", "empty");
const NONE = words("نییە", "لا يوجد", "none");
const ON = words("چالاک", "مفعّل", "on");
const OFF = words("ڕاگیراو", "متوقف", "off");
const onOff = (v: boolean): Words => (v ? ON : OFF);
const IN_STOCK = words("بەردەستە", "متوفر", "in stock");
const OUT_OF_STOCK = words("بەردەست نییە", "غير متوفر", "out of stock");
const stock = (v: boolean): Words => (v ? IN_STOCK : OUT_OF_STOCK);

const PLATFORM = {
  FB: words("فەیسبووک", "فيسبوك", "Facebook"),
  IG: words("ئینستاگرام", "إنستغرام", "Instagram"),
};

const YES = words("بەڵێ", "نعم", "yes");
const NO = words("نەخێر", "لا", "no");
const yesNo = (v: boolean): Words => (v ? YES : NO);
const STORY_KIND = words("چیرۆک", "قصة", "story");
const AD_KIND = words("ڕیکلام", "إعلان", "ad");
const SHAPE_WIDE = words("پان 16:9", "عريض 16:9", "wide 16:9");
const SHAPE_VERTICAL = words("ستوونی 9:16", "طولي 9:16", "vertical 9:16");
const NOWHERE = words("هیچ شوێنێک (ڕەشنووس)", "لا مكان (مسودة)", "nowhere (a draft)");
const PRIVACY: Record<string, Words> = { public: words("گشتی", "عام", "public"), unlisted: words("تەنها بە لینک", "غير مدرج", "unlisted"), private: words("تایبەت", "خاص", "private") };
const PLATFORM_NAME: Record<string, Words> = { ...PLATFORM, YT: words("یوتیوب", "يوتيوب", "YouTube") };
/** The platforms of a plan as one phrase, in the order the plan keeps them (nothing: it is only kept as a draft). */
const whereOf = (targets: readonly string[]): Words => (targets.length ? words(...(["ckb", "ar", "en"] as const).map((l) => targets.map((t) => PLATFORM_NAME[t]?.[l] ?? t).join(" + ")) as [string, string, string]) : NOWHERE);

const MODES = ["OFF", "DRAFT", "PUBLISH"];
/** The mode of the automatic posts and of the daily video. Noun phrases (English and Arabic), so they fit after "Label: " and after "not ". */
const POST_MODE: Record<string, Words> = {
  OFF,
  DRAFT: words("پۆست ئامادە دەکات بۆ پێداچوونەوە", "تحضير المنشورات للمراجعة", "preparing posts for review"),
  PUBLISH: words("خۆی بڵاوی دەکاتەوە", "النشر التلقائي", "publishing by itself"),
};
const VIDEO_MODE: Record<string, Words> = {
  OFF,
  DRAFT: words("ڤیدیۆ دروست دەکات بۆ پێداچوونەوە", "إنتاج الفيديو للمراجعة", "making the video for review"),
  PUBLISH: words("ڤیدیۆ دروست دەکات و خۆی بڵاوی دەکاتەوە", "إنتاج الفيديو ونشره تلقائياً", "making the video and publishing it by itself"),
};

/** The names of the video languages, from the app's own dictionary. */
const videoLanguage = (code: string): Words => {
  const name = (d: typeof ckb) => (d.assistant.fields.languages as Record<string, string>)[code] ?? code;
  return words(name(ckb), name(ar), name(en));
};

/** The names of the order statuses, from the app's own dictionary. */
const ORDER_STATUS: Record<Lang, Record<string, string>> = {
  ckb: ckb.orders.status as Record<string, string>,
  ar: ar.orders.status as Record<string, string>,
  en: en.orders.status as Record<string, string>,
};
const orderStatus = (s: string): Words => words(ORDER_STATUS.ckb[s] ?? s, ORDER_STATUS.ar[s] ?? s, ORDER_STATUS.en[s] ?? s);

const L = {
  autoReplies: words("وەڵامدانەوەی خۆکار", "الردود التلقائية", "Automatic replies"),
  autopilot: words("پۆستی خۆکار", "المنشورات التلقائية", "Automatic posts"),
  perDay: words("ژمارەی پۆست لە ڕۆژێکدا", "عدد المنشورات في اليوم", "Posts per day"),
  dailyVideo: words("ڤیدیۆی ڕۆژانە", "الفيديو اليومي", "The daily video"),
  videoHour: words("کاتژمێری ڤیدیۆی ڕۆژانە", "ساعة الفيديو اليومي", "Hour of the daily video"),
  videoLang: words("زمانی ڤیدیۆ", "لغة الفيديو", "The video language"),
  dailyIdea: words("بیرۆکەی ڤیدیۆی ڕۆژانە", "فكرة الفيديو اليومي", "The idea of the daily video"),
  dailyKind: words("جۆری ڤیدیۆی ڕۆژانە", "نوع الفيديو اليومي", "The kind of the daily video"),
  dailyShape: words("شێوەی ڤیدیۆی ڕۆژانە", "شكل الفيديو اليومي", "The shape of the daily video"),
  dailyReview: words("باشترکردنی بیرۆکە پێشوەخت", "تحسين الفكرة أولاً", "Improving the idea first"),
  dailyPhotos: words("وێنەکانی ڤیدیۆی ڕۆژانە", "صور الفيديو اليومي", "Photographs in the daily video"),
  dailyWhere: words("شوێنی بڵاوکردنەوەی ڤیدیۆی ڕۆژانە", "مكان نشر الفيديو اليومي", "Where the daily video is posted"),
  dailyYtWho: words("یوتیوب: کێ دەتوانێت ببینێت", "يوتيوب: من يستطيع المشاهدة", "YouTube: who can watch"),
  dailyYtKids: words("یوتیوب: بۆ منداڵان", "يوتيوب: موجّه للأطفال", "YouTube: made for kids"),
  likeComments: words("لایککردنی کۆمێنتەکان", "الإعجاب بالتعليقات", "Liking comments"),
  autoHideSpam: words("شاردنەوەی خۆکاری سپام", "إخفاء الرسائل المزعجة تلقائياً", "Hiding spam"),
  aiReplies: words("وەڵامی زیرەک بە AI", "الردود الذكية بالذكاء الاصطناعي", "Smart AI replies"),
  expiryDays: words("ماوەی وەڵامدانەوەی پۆست (ڕۆژ)", "مدة الرد على المنشور (أيام)", "Days a post keeps getting replies"),
  defaultDm: words("نامەی تایبەتی ئاسایی", "الرسالة الخاصة الافتراضية", "The default private message"),
  deliveryFee: words("نرخی گەیاندن", "سعر التوصيل", "The delivery fee"),
  deliveryTime: words("ماوەی گەیاندن", "مدة التوصيل", "The delivery time"),
  aiBrief: words("ڕێنماییەکانی AI", "تعليمات الذكاء الاصطناعي", "The AI instructions"),
  whatsapp: words("ژمارەی واتسئەپ", "رقم واتساب", "The WhatsApp number"),
  orderStatus: words("دۆخی داواکاری", "حالة الطلب", "The order status"),
  scheduledAt: words("کاتی خشتەکراو (بەغدا)", "موعد النشر (بتوقيت بغداد)", "Scheduled time (Baghdad)"),
  platforms: words("پلاتفۆرمەکان", "المنصات", "Platforms"),
  stock: words("بەردەستبوون", "التوفر", "Availability"),
  photos: words("وێنەکان", "الصور", "Photos"),
  productName: (name: string): Words => words(`ناوی «${name}»`, `اسم «${name}»`, `The name of “${name}”`),
  productPrice: (name: string): Words => words(`نرخی «${name}»`, `سعر «${name}»`, `The price of “${name}”`),
  productStock: (name: string): Words => words(`بەردەستبوونی «${name}»`, `توفر «${name}»`, `Availability of “${name}”`),
  productDesc: (name: string): Words => words(`وەسفی «${name}»`, `وصف «${name}»`, `The description of “${name}”`),
  productPhotos: (name: string): Words => words(`وێنەکانی «${name}»`, `صور «${name}»`, `Photos of “${name}”`),
};

/** "Label: value" for what matches. */
const OK = say(
  (l: string, v: string) => `${l}: ${v}`,
  (l: string, v: string) => `${l}: ${v}`,
  (l: string, v: string) => `${l}: ${v}`,
);
/** "Label: found, not what you asked" for what does not. */
const BAD = say(
  (l: string, got: string, want: string) => `${l}: ${got}، نەک ${want} وەک داوات کردبوو.`,
  (l: string, got: string, want: string) => `${l}: ${got}، وليس ${want} كما طلبت.`,
  (l: string, got: string, want: string) => `${l}: ${got}, not ${want} as you asked.`,
);

// ---------------------------------------------------------------------------------------------------------------------
// One comparison, and the report made of them

interface Cmp {
  label: Words;
  same: boolean;
  got: Words;
  want: Words;
  /** For the model: the arguments that would put this one right (for example `price=25000`). */
  fix: string;
}

const cmp = (label: Words, same: boolean, got: Words, want: Words, fix: string): Cmp => ({ label, same, got, want, fix });

/** A text for a line: cut to 40 characters, or "empty". */
const shown = (s: string | null | undefined): Words => (s ? plain(clip(s, 40)) : EMPTY);

/** The longest text that is written into a `fix` whole. */
const FIX_TEXT_MAX = 60;
/**
 * A free-text argument for a `fix` (for the model, so that it can put the change right). A text is never cut and never gets an ellipsis
 * there: following a cut text would overwrite the stored one with a stub. It is written out only when it fits whole; otherwise the
 * field alone is named and the model is told to use the person's own words, or to ask for them again.
 */
function textFix(key: string, value: string): string {
  if (!value) return `${key}=""`;
  if (Array.from(value).length <= FIX_TEXT_MAX && value === value.replace(/\s+/g, " ").trim()) return `${key}=${JSON.stringify(value)}`;
  return `${key} (the person's exact full text; if you lost it, ask them to send it again)`;
}

function report(lang: Lang, cmps: Cmp[], opts: { ok?: string[]; bad?: string[]; fix?: (bad: Cmp[]) => string } = {}): VerifyReport | null {
  const bad = cmps.filter((c) => !c.same);
  const checked = [...(opts.ok ?? []), ...cmps.filter((c) => c.same).map((c) => OK[lang](c.label[lang], c.got[lang]))];
  const problems = [...(opts.bad ?? []), ...bad.map((c) => BAD[lang](c.label[lang], c.got[lang], c.want[lang]))];
  if (!checked.length && !problems.length) return null;
  if (!problems.length) return { status: "ok", checked, problems: [] };
  const fix = opts.fix ? opts.fix(bad) : bad.map((c) => c.fix).join(" ");
  return { status: "problem", checked, problems, ...(fix ? { fix: clip(fix, 299) } : {}) };
}

/** A report that only says one thing, found right or found wrong. */
const found = (lang: Lang, line: Words): VerifyReport => ({ status: "ok", checked: [line[lang]], problems: [] });
const lacking = (lang: Lang, line: Words, fix: string): VerifyReport => ({ status: "problem", checked: [], problems: [line[lang]], fix: clip(fix, 299) });

// ---------------------------------------------------------------------------------------------------------------------
// Settings: the Store columns

const STORE_PICK = {
  id: true,
  updatedAt: true,
  automationEnabled: true,
  autoMode: true,
  autoPerDay: true,
  videoAutoMode: true,
  videoAutoHour: true,
  videoLang: true,
  plan: true,
  pausedReason: true,
  fbPageId: true,
  igUserId: true,
  likeComments: true,
  autoHideSpam: true,
  aiReplies: true,
  expiryDays: true,
  defaultDm: true,
  deliveryFeeMinor: true,
  deliveryTime: true,
  aiBrief: true,
} as const;

/**
 * The shop the change was for. With one shop there is no doubt. With several, the arguments do not say which one the change went to
 * (the app picks by the connected account), so it is the one shop that was saved in the last minutes; if that is not one single shop,
 * the check cannot tell and says nothing.
 */
async function theStore(ctx: ToolCtx) {
  const rows = await db.store.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" }, take: 15, select: STORE_PICK });
  if (rows.length === 1) return rows[0];
  const recent = rows.filter((r) => Date.now() - r.updatedAt.getTime() < RECENT_MS);
  return recent.length === 1 ? recent[0] : null;
}

const setAutoReplies: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  if (!a || typeof a.on !== "boolean") return null;
  const s = await theStore(ctx);
  if (!s) return null;
  return report(ctx.lang, [cmp(L.autoReplies, s.automationEnabled === a.on, onOff(s.automationEnabled), onOff(a.on), `on=${a.on}`)], {
    fix: (bad) => `Call set_auto_replies with ${bad[0].fix}.`,
  });
};

/**
 * A mode that is saved but that the engine will not carry out as asked. The checks follow the engine itself: runShopAutopilot
 * (shop/autopilot.ts) skips a paused shop and turns PUBLISH into DRAFT on the free plan (effectiveMode), and with no Facebook page or
 * Instagram account it only prepares the post; runVideoAutomation (advideo/auto.ts) takes no free or paused shop, and posts the video
 * only to the connected accounts. The plan is the stored one: a lapsed plan is set back to FREE by the billing cron.
 */
interface NotHonoured {
  /** For the person: what really happens. */
  line: Words;
  /** For the model: tell the person, do not run the same tool again. */
  fix: string;
}

const NO_ACCOUNT = "No Facebook page or Instagram account is connected";
const REPAIR_PAUSED = "The shop is paused because its page access has expired, so nothing runs. Do not call the tool again: tell the person to connect the page again.";

const POSTS_PAUSED = words(
  "پاشەکەوت کرا، بەڵام دەستپێگەیشتنی پەیجەکە بەسەرچووە، بۆیە هیچ پۆستێک ئامادە ناکرێت تا پەیجەکە دووبارە پەیوەست بکرێتەوە.",
  "تم الحفظ، لكن صلاحية الصفحة انتهت، فلن تُحضَّر منشورات حتى تُربط الصفحة من جديد.",
  "Saved, but the page's access has expired, so no posts are prepared until the page is connected again.",
);
const POSTS_FREE_PLAN = words(
  "پاشەکەوت کرا، بەڵام لە پلانی بەخۆڕایی پۆستەکان تەنها بۆ پێداچوونەوە ئامادە دەکرێن؛ بڵاوکردنەوەی خۆکار پلانێکی پارەدار دەوێت.",
  "تم الحفظ، لكن في الباقة المجانية تُحضَّر المنشورات للمراجعة فقط؛ النشر التلقائي يحتاج إلى باقة مدفوعة.",
  "Saved, but on the free plan the posts are only prepared for review; publishing by itself needs a paid plan.",
);
const POSTS_NO_ACCOUNT = words(
  "پاشەکەوت کرا، بەڵام هیچ پەیجێکی فەیسبووک یان ئینستاگرام پەیوەست نەکراوە، بۆیە پۆستەکان تەنها ئامادە دەکرێن و خۆیان بڵاو نابنەوە.",
  "تم الحفظ، لكن لا توجد صفحة فيسبوك أو إنستغرام مربوطة، فتُحضَّر المنشورات فقط ولا تُنشر بنفسها.",
  "Saved, but no Facebook or Instagram page is connected, so the posts are only prepared and do not go out by themselves.",
);

function postsNotHonoured(s: { autoMode: string; plan: string; pausedReason: string | null; fbPageId: string | null; igUserId: string | null }): NotHonoured | null {
  if (s.autoMode !== "DRAFT" && s.autoMode !== "PUBLISH") return null;
  if (s.pausedReason) return { line: POSTS_PAUSED, fix: REPAIR_PAUSED };
  if (s.autoMode !== "PUBLISH") return null;
  if (effectiveMode(s.autoMode, s.plan) !== "PUBLISH") {
    return { line: POSTS_FREE_PLAN, fix: "The free plan cannot publish by itself: the engine only prepares drafts. Do not call set_autopilot with PUBLISH again. Tell the person; offer mode=DRAFT (prepares posts for review) or a paid plan." };
  }
  if (!s.fbPageId && !s.igUserId) return { line: POSTS_NO_ACCOUNT, fix: `${NO_ACCOUNT}, so PUBLISH only prepares drafts. Do not call set_autopilot again: tell the person to connect a page first.` };
  return null;
}

const VIDEO_FREE_PLAN = words(
  "پاشەکەوت کرا، بەڵام پلانی بەخۆڕایی ڤیدیۆی ڕۆژانەی تێدا نییە، بۆیە هیچ ڤیدیۆیەک دروست ناکرێت تا پلانێکی پارەدار چالاک نەکرێت.",
  "تم الحفظ، لكن الباقة المجانية لا تشمل الفيديو اليومي، فلن يُنتج أي فيديو قبل تفعيل باقة مدفوعة.",
  "Saved, but the free plan has no daily video, so no video is made until a paid plan is active.",
);
const VIDEO_PAUSED = words(
  "پاشەکەوت کرا، بەڵام دەستپێگەیشتنی پەیجەکە بەسەرچووە، بۆیە هیچ ڤیدیۆیەک دروست ناکرێت تا پەیجەکە دووبارە پەیوەست بکرێتەوە.",
  "تم الحفظ، لكن صلاحية الصفحة انتهت، فلن يُنتج أي فيديو حتى تُربط الصفحة من جديد.",
  "Saved, but the page's access has expired, so no video is made until the page is connected again.",
);
const VIDEO_NO_ACCOUNT = words(
  "پاشەکەوت کرا، بەڵام هیچ پەیجێکی فەیسبووک یان ئینستاگرام پەیوەست نەکراوە، بۆیە ڤیدیۆکە دروست دەکرێت بەڵام بڵاو ناکرێتەوە.",
  "تم الحفظ، لكن لا توجد صفحة فيسبوك أو إنستغرام مربوطة، فيُنتج الفيديو دون أن يُنشر.",
  "Saved, but no Facebook or Instagram page is connected, so the video is made but not posted.",
);

function videoNotHonoured(s: { videoAutoMode: string; plan: string; pausedReason: string | null; fbPageId: string | null; igUserId: string | null }, plan?: VideoAutoPlan | null): NotHonoured | null {
  if (s.videoAutoMode !== "DRAFT" && s.videoAutoMode !== "PUBLISH") return null;
  if (s.plan === "FREE") {
    return { line: VIDEO_FREE_PLAN, fix: "The free plan makes no daily video, so nothing will be made. Do not call set_daily_video again. Tell the person; offer a paid plan, or mode=OFF to switch it off." };
  }
  if (s.pausedReason) return { line: VIDEO_PAUSED, fix: REPAIR_PAUSED };
  // A plan that posts to YouTube has somewhere to post without a Page or an Instagram account.
  if (s.videoAutoMode === "PUBLISH" && !s.fbPageId && !s.igUserId && !plan?.targets.includes("YT")) {
    return { line: VIDEO_NO_ACCOUNT, fix: `${NO_ACCOUNT}, so the video is made but not posted. Do not call set_daily_video again: tell the person to connect a page first, or offer mode=DRAFT.` };
  }
  return null;
}

const setAutopilot: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const mode = str(a?.mode);
  if (!a || !mode || !MODES.includes(mode)) return null;
  const s = await theStore(ctx);
  if (!s) return null;
  // Only when the stored mode is the asked one: a different mode is already a problem of its own.
  const note = s.autoMode === mode ? postsNotHonoured(s) : null;
  const cmps: Cmp[] = note ? [] : [cmp(L.autopilot, s.autoMode === mode, POST_MODE[s.autoMode] ?? plain(s.autoMode), POST_MODE[mode], `mode=${mode}`)];
  if (typeof a.perDay === "number") cmps.push(cmp(L.perDay, s.autoPerDay === a.perDay, count(s.autoPerDay), count(a.perDay), `perDay=${a.perDay}`));
  return report(ctx.lang, cmps, {
    bad: note ? [note.line[ctx.lang]] : [],
    fix: (bad) => [bad.length ? `Call set_autopilot with ${bad.map((c) => c.fix).join(" and ")}.` : "", note?.fix ?? ""].filter(Boolean).join(" "),
  });
};

/** The arguments of set_daily_video that make up the daily plan (see app/video/daily-plan.ts). */
const PLAN_ASKED = ["idea", "kind", "format", "review", "photos", "publishTo", "youtubePrivacy", "youtubeMadeForKids"] as const;
const PLAN_MISSING = words(
  "پاشەکەوت کرا، بەڵام پلانی ڤیدیۆی ڕۆژانە لە ڕێکخستنەکاندا نەدۆزرایەوە.",
  "تم الحفظ، لكن خطة الفيديو اليومي لم تُوجد في الإعدادات.",
  "Saved, but the daily video's plan was not found in the settings.",
);
const PLAN_UNREADABLE = words(
  "نەتوانرا بپشکنرێت کە پلانی ڤیدیۆی ڕۆژانە پاشەکەوت کراوە.",
  "تعذّر التحقق من حفظ خطة الفيديو اليومي.",
  "Could not check that the daily video's plan was saved.",
);

/** The stored plan of a shop, read on its own (never throws; null = none saved, undefined = could not be read). */
async function storedPlan(storeId: string): Promise<VideoAutoPlan | null | undefined> {
  try {
    const row = await db.store.findUnique({ where: { id: storeId }, select: { videoAutoPlan: true } });
    if (!row) return undefined;
    return parseVideoAutoPlan(row.videoAutoPlan);
  } catch {
    return undefined;
  }
}

/** What the daily plan asked for, against the plan the shop really holds. One comparison per thing asked; nothing for what was left out. */
function planComparisons(a: Record<string, unknown>, stored: VideoAutoPlan): Cmp[] {
  const out: Cmp[] = [];
  if (typeof a.idea === "string") {
    const want = norm(a.idea, 600);
    out.push(cmp(L.dailyIdea, stored.brief === want, shown(stored.brief), shown(want), textFix("idea", want)));
  }
  if (a.kind === "story" || a.kind === "ad") out.push(cmp(L.dailyKind, stored.kind === a.kind, stored.kind === "story" ? STORY_KIND : AD_KIND, a.kind === "story" ? STORY_KIND : AD_KIND, `kind=${a.kind}`));
  // The shape is only a story's: an ad is always vertical.
  if ((a.format === "wide" || a.format === "vertical") && stored.kind === "story") {
    const storedWide = stored.format === "wide";
    out.push(cmp(L.dailyShape, storedWide === (a.format === "wide"), storedWide ? SHAPE_WIDE : SHAPE_VERTICAL, a.format === "wide" ? SHAPE_WIDE : SHAPE_VERTICAL, `format=${a.format}`));
  }
  if (typeof a.review === "boolean") out.push(cmp(L.dailyReview, stored.review === a.review, yesNo(stored.review), yesNo(a.review), `review=${a.review}`));
  if (typeof a.photos === "boolean" && stored.kind === "story") out.push(cmp(L.dailyPhotos, stored.photos === a.photos, yesNo(stored.photos), yesNo(a.photos), `photos=${a.photos}`));
  if (Array.isArray(a.publishTo)) {
    const want = (["FB", "IG", "YT"] as const).filter((t) => (a.publishTo as unknown[]).includes(t));
    out.push(cmp(L.dailyWhere, stored.targets.join(",") === want.join(","), whereOf(stored.targets), whereOf(want), `publishTo=${JSON.stringify(want)}`));
  }
  if (stored.youtube && typeof a.youtubePrivacy === "string") {
    out.push(cmp(L.dailyYtWho, stored.youtube.privacy === a.youtubePrivacy, PRIVACY[stored.youtube.privacy] ?? plain(stored.youtube.privacy), PRIVACY[a.youtubePrivacy] ?? plain(a.youtubePrivacy), `youtubePrivacy=${a.youtubePrivacy}`));
  }
  if (stored.youtube && typeof a.youtubeMadeForKids === "boolean") {
    out.push(cmp(L.dailyYtKids, stored.youtube.madeForKids === a.youtubeMadeForKids, yesNo(stored.youtube.madeForKids), yesNo(a.youtubeMadeForKids), `youtubeMadeForKids=${a.youtubeMadeForKids}`));
  }
  return out;
}

const setDailyVideo: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  if (!a) return null;
  // A mode left out means the call changed only the language or the hour: the daily video stays on or off as it was, so there is no mode
  // to read back. A mode that is given but is not one of the three is no request at all.
  const mode = str(a.mode);
  if (a.mode !== undefined && (!mode || !MODES.includes(mode))) return null;
  const language = a.language === "ckb" || a.language === "ar" || a.language === "en" ? a.language : undefined;
  const planAsked = PLAN_ASKED.some((k) => a[k] !== undefined);
  if (!mode && typeof a.hour !== "number" && !language && !planAsked) return null;
  const s = await theStore(ctx);
  if (!s) return null;
  // The daily plan, when the call carried one: read back on its own (a plan that is not there is the one clear mismatch; one that cannot be read says so).
  const planBad: string[] = [];
  let planCmps: Cmp[] = [];
  let stored: VideoAutoPlan | null | undefined;
  if (planAsked) {
    stored = await storedPlan(s.id);
    if (stored === undefined) planBad.push(PLAN_UNREADABLE[ctx.lang]);
    else if (stored === null) planBad.push(PLAN_MISSING[ctx.lang]);
    else planCmps = planComparisons(a, stored);
  }
  const note = mode && s.videoAutoMode === mode ? videoNotHonoured(s, stored) : null;
  const cmps: Cmp[] = !mode || note ? [] : [cmp(L.dailyVideo, s.videoAutoMode === mode, VIDEO_MODE[s.videoAutoMode] ?? plain(s.videoAutoMode), VIDEO_MODE[mode], `mode=${mode}`)];
  if (typeof a.hour === "number") {
    const hour = Math.round(a.hour);
    cmps.push(cmp(L.videoHour, s.videoAutoHour === hour, count(s.videoAutoHour), count(hour), `hour=${hour}`));
  }
  // The video language is compared only when it was asked (left out, the saved one stays and there is nothing to read back).
  if (language) {
    const saved = videoLangOf(s.videoLang);
    cmps.push(cmp(L.videoLang, saved === language, videoLanguage(saved), videoLanguage(language), `language=${language}`));
  }
  cmps.push(...planCmps);
  return report(ctx.lang, cmps, {
    bad: [...(note ? [note.line[ctx.lang]] : []), ...planBad],
    fix: (bad) =>
      [
        bad.length ? `Call set_daily_video with ${bad.map((c) => c.fix).join(" and ")}.` : "",
        stored === null ? "The plan was not saved: call set_daily_video again with the owner's whole plan (idea, kind, review, publishTo and the YouTube answers)." : "",
        note?.fix ?? "",
      ]
        .filter(Boolean)
        .join(" "),
  });
};

/** The delivery fee as the app stores it: nothing for an empty text, 0 for zeros, else the price in IQD (null when it cannot be read). */
function feeMinor(raw: string): number | null | undefined {
  const fee = toWesternDigits(raw).trim();
  if (!fee) return null;
  if (/^0+$/.test(fee)) return 0;
  return parsePrice(fee, "IQD") ?? undefined;
}

const OPTION_KINDS = { likeComments: "boolean", autoHideSpam: "boolean", aiReplies: "boolean", expiryDays: "number", defaultDm: "string", deliveryFee: "string", deliveryTime: "string", aiBrief: "string" } as const;

const setShopOptions: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  // Nothing was asked that can be compared: no need to read anything.
  if (!a || !Object.entries(OPTION_KINDS).some(([k, kind]) => typeof a[k] === kind)) return null;
  const s = await theStore(ctx);
  if (!s) return null;
  const lang = ctx.lang;
  const cmps: Cmp[] = [];
  for (const k of ["likeComments", "autoHideSpam", "aiReplies"] as const) {
    const want = a[k];
    if (typeof want === "boolean") cmps.push(cmp(L[k], s[k] === want, onOff(s[k]), onOff(want), `${k}=${want}`));
  }
  if (typeof a.expiryDays === "number") {
    const days = Math.round(a.expiryDays);
    cmps.push(cmp(L.expiryDays, s.expiryDays === days, count(s.expiryDays), count(days), `expiryDays=${days}`));
  }
  for (const [k, max] of [["defaultDm", 1000], ["deliveryTime", 60], ["aiBrief", 1500]] as const) {
    const raw = str(a[k]);
    if (raw === undefined) continue;
    const want = norm(raw, max);
    const got = s[k] ?? "";
    cmps.push(cmp(L[k], got === want, shown(got), shown(want), textFix(k, want)));
  }
  const rawFee = str(a.deliveryFee);
  if (rawFee !== undefined) {
    const want = feeMinor(rawFee);
    if (want !== undefined) {
      const money = (m: number | null): Words => (m === null ? NONE : plain(formatMoney(m, "IQD", lang)));
      cmps.push(cmp(L.deliveryFee, s.deliveryFeeMinor === want, money(s.deliveryFeeMinor), money(want), `deliveryFee=${JSON.stringify(rawFee.trim())}`));
    }
  }
  return report(lang, cmps, { fix: (bad) => `Call set_shop_options with ${bad.map((c) => c.fix).join(", ")}.` });
};

const setWhatsappNumber: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const number = str(a?.number);
  if (!number) return null;
  const want = normalizePhone(number);
  if (!want.ok) return null;
  const t = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { whatsappNumber: true } });
  if (!t) return null;
  const phone = (d: string | null): Words => (d ? plain(`+${d}`) : NONE);
  return report(ctx.lang, [cmp(L.whatsapp, t.whatsappNumber === want.digits, phone(t.whatsappNumber), phone(want.digits), `number="${want.digits}"`)], {
    fix: (bad) => `Call set_whatsapp_number with ${bad[0].fix}.`,
  });
};

// ---------------------------------------------------------------------------------------------------------------------
// Products

const SAVED = say(
  (n: string) => `بەرهەمی «${n}» پاشەکەوت کراوە`,
  (n: string) => `تم حفظ المنتج «${n}»`,
  (n: string) => `Product “${n}” is saved`,
);
const SAVED_AT = say(
  (n: string, price: string) => `بەرهەمی «${n}» بە نرخی ${price} پاشەکەوت کراوە`,
  (n: string, price: string) => `تم حفظ المنتج «${n}» بسعر ${price}`,
  (n: string, price: string) => `Product “${n}” is saved at ${price}`,
);
const NOT_ADDED = say(
  (n: string) => `هیچ بەرهەمێکی چالاک بە ناوی «${n}» لە دووکانەکەدا نەدۆزرایەوە.`,
  (n: string) => `لم أجد أي منتج فعّال باسم «${n}» في المتجر.`,
  (n: string) => `I found no active product named “${n}” in the shop.`,
);
const PRODUCT_GONE = words("بەرهەمەکە چیتر لە دووکانەکەدا نەدۆزرایەوە.", "لم أعد أجد المنتج في المتجر.", "I can no longer find the product in the shop.");
const REMOVED = say(
  (n: string) => `بەرهەمی «${n}» لە دووکانەکە لابرا`,
  (n: string) => `تمت إزالة المنتج «${n}» من المتجر`,
  (n: string) => `Product “${n}” is removed from the shop`,
);
const STILL_THERE = say(
  (n: string) => `بەرهەمی «${n}» هێشتا لە دووکانەکەدایە.`,
  (n: string) => `المنتج «${n}» ما زال في المتجر.`,
  (n: string) => `Product “${n}” is still in the shop.`,
);

const VARIANT_PICK = { orderBy: { position: "asc" as const }, take: 3, select: { amountMinor: true, currency: true, inStock: true } };

/**
 * The one product of this workspace that the arguments name: by its id (what a card pins), else by a name only one product has.
 * "gone" is a product the id of which no longer exists; null is anything the check cannot decide.
 */
async function readProduct(ctx: ToolCtx, hint: string) {
  const rows = await db.product.findMany({
    where: { store: { tenantId: ctx.tenantId }, OR: [{ id: hint }, { name: { equals: hint, mode: "insensitive" } }] },
    take: 3,
    select: { id: true, name: true, description: true, active: true, variants: VARIANT_PICK },
  });
  const byId = rows.filter((r) => r.id === hint);
  if (byId.length === 1) return byId[0];
  if (!byId.length && rows.length === 1) return rows[0];
  if (!rows.length && ID_SHAPE.test(hint)) return "gone" as const;
  return null;
}

const addProduct: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const rawName = str(a?.name);
  if (!a || !rawName) return null;
  const name = norm(rawName, 80);
  if (!name) return null;
  const lang = ctx.lang;
  const rows = await db.product.findMany({
    where: { active: true, name, store: { tenantId: ctx.tenantId } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, name: true, description: true, photos: true, createdAt: true, variants: VARIANT_PICK },
  });
  if (!rows.length) return lacking(lang, fill(NOT_ADDED, clip(name, 40)), `Call add_product again with ${textFix("name", name)}, the price and photos as asked. Check list_products first so it is not added twice.`);
  const p = rows[0];
  // A product of that name that is not new says nothing about the one just added: the check cannot tell.
  if (Date.now() - p.createdAt.getTime() > CREATED_MS) return null;

  const shortName = clip(p.name, 40);
  const cmps: Cmp[] = [];
  const checked: string[] = [];
  const v = p.variants.length === 1 ? p.variants[0] : null;
  const wantPrice = typeof a.price === "string" ? parsePrice(a.price, "IQD") : null;
  if (v && wantPrice !== null) {
    if (v.amountMinor === wantPrice && v.currency === "IQD") checked.push(SAVED_AT[lang](shortName, formatMoney(v.amountMinor, v.currency, lang)));
    else {
      checked.push(SAVED[lang](shortName));
      cmps.push(cmp(L.productPrice(shortName), false, plain(formatMoney(v.amountMinor, v.currency, lang)), plain(formatMoney(wantPrice, "IQD", lang)), `price=${wantPrice}`));
    }
  } else checked.push(SAVED[lang](shortName));
  if (v) {
    const wantStock = a.inStock !== false;
    cmps.push(cmp(L.productStock(shortName), v.inStock === wantStock, stock(v.inStock), stock(wantStock), `inStock=${wantStock}`));
  }
  const desc = str(a.description) ? norm(str(a.description)!, 500) : "";
  if (desc) cmps.push(cmp(L.productDesc(shortName), (p.description ?? "") === desc, shown(p.description), shown(desc), textFix("description", desc)));
  // The photos the run could use: attached pictures only, at most five (the same rule as the run).
  const have = attachmentsOf(ctx);
  const ids = Array.isArray(a.photos) ? a.photos : [];
  const wantPhotos = ids.map((id) => have.find((x) => x.id === id)).filter((x) => x?.kind === "image").slice(0, 5).length;
  if (wantPhotos > 0) cmps.push(cmp(L.productPhotos(shortName), p.photos.length === wantPhotos, count(p.photos.length), count(wantPhotos), ""));

  return report(lang, cmps, {
    ok: checked,
    fix: (bad) => {
      const parts = bad.map((c) => c.fix).filter(Boolean);
      const photoBad = bad.some((c) => !c.fix);
      return [
        parts.length ? `Call update_product with product=${p.id} and ${parts.join(", ")}.` : "",
        photoBad ? "Photos cannot be changed from the chat: tell the person to edit the product in the Products screen." : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  });
};

const updateProduct: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const hint = str(a?.product)?.trim();
  if (!a || !hint) return null;
  const p = await readProduct(ctx, hint);
  if (p === "gone") return lacking(ctx.lang, PRODUCT_GONE, `The product ${hint} no longer exists. Tell the person; if they still want it, call add_product.`);
  if (!p) return null;
  const shortName = clip(p.name, 40);
  const cmps: Cmp[] = [];
  const name = str(a.name) ? norm(str(a.name)!, 80) : "";
  if (name) cmps.push(cmp(L.productName(shortName), p.name === name, shown(p.name), shown(name), textFix("name", name)));
  const desc = str(a.description) ? norm(str(a.description)!, 500) : "";
  if (desc) cmps.push(cmp(L.productDesc(shortName), (p.description ?? "") === desc, shown(p.description), shown(desc), textFix("description", desc)));
  const v = p.variants.length === 1 ? p.variants[0] : null;
  if (v && v.currency === "IQD" && typeof a.price === "string") {
    const want = parsePrice(a.price, "IQD");
    if (want !== null) cmps.push(cmp(L.productPrice(shortName), v.amountMinor === want, plain(formatMoney(v.amountMinor, "IQD", ctx.lang)), plain(formatMoney(want, "IQD", ctx.lang)), `price=${want}`));
  }
  if (v && typeof a.inStock === "boolean") cmps.push(cmp(L.productStock(shortName), v.inStock === a.inStock, stock(v.inStock), stock(a.inStock), `inStock=${a.inStock}`));
  return report(ctx.lang, cmps, { fix: (bad) => `Call update_product with product=${p.id} and ${bad.map((c) => c.fix).join(", ")}.` });
};

const archiveProduct: VerifyFn = async (ctx, args) => {
  const hint = str(rec(args)?.product)?.trim();
  if (!hint) return null;
  const p = await readProduct(ctx, hint);
  if (!p || p === "gone") return null;
  const name = clip(p.name, 40);
  if (!p.active) return found(ctx.lang, fill(REMOVED, name));
  return lacking(ctx.lang, fill(STILL_THERE, name), `Call archive_product with product=${p.id}.`);
};

// ---------------------------------------------------------------------------------------------------------------------
// Orders

const ORDER_GONE = words("داواکارییەکە چیتر نەدۆزرایەوە.", "لم أعد أجد الطلب.", "I can no longer find the order.");

const setOrderStatus: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const id = str(a?.order);
  const status = str(a?.status);
  if (!id || !status) return null;
  const row = await db.order.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true } });
  if (!row) return lacking(ctx.lang, ORDER_GONE, `The order ${id.slice(0, 60)} was not found in this workspace any more. Tell the person; check list_orders.`);
  return report(ctx.lang, [cmp(L.orderStatus, row.status === status, orderStatus(row.status), orderStatus(status), `order=${id.slice(0, 60)} and status=${status}`)], {
    fix: (bad) => `Call set_order_status with ${bad[0].fix}.`,
  });
};

// ---------------------------------------------------------------------------------------------------------------------
// Posts: published now, scheduled, cancelled

const POST_OK = say(
  (p: string) => `پۆستەکە لە ${p} وەک بڵاوکراو تۆمار کراوە`,
  (p: string) => `تم تسجيل نشر المنشور على ${p}`,
  (p: string) => `The post on ${p} is on record as published`,
);
const POST_FAILED = say(
  (p: string) => `${p}: پۆستەکە وەک شکستخواردوو تۆمار کراوە.`,
  (p: string) => `${p}: سُجِّل أن نشر المنشور فشل.`,
  (p: string) => `${p}: the post is on record as failed.`,
);
const POST_NO_RECORD = say(
  (p: string) => `${p}: هیچ تۆمارێکی بڵاوکردنەوە نەدۆزرایەوە.`,
  (p: string) => `${p}: لم أجد أي سجل لنشر المنشور.`,
  (p: string) => `${p}: I found no record of the post going out.`,
);

/** What Instagram says while it is still preparing a video: the post is not a failure, it goes out by itself in minutes. */
const IG_PROCESSING = [ckb, ar, en].map((d) => d.actions.publish.igProcessing);

const postNow: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const targets = targetsOf(a?.targets);
  if (!targets.length) return null;
  const rows = await db.auditLog.findMany({
    where: { tenantId: ctx.tenantId, action: { in: ["app.publish", "app.publish_failed"] }, createdAt: { gte: since(RECENT_MS) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { action: true, metadata: true },
  });
  const lang = ctx.lang;
  const checked: string[] = [];
  const problems: string[] = [];
  const fixes: string[] = [];
  for (const t of targets) {
    const name = PLATFORM[t][lang];
    const row = rows.find((r) => rec(r.metadata)?.target === t);
    if (!row) {
      problems.push(POST_NO_RECORD[lang](name));
      fixes.push(`No record of the ${PLATFORM[t].en} post was found. Do not post again blindly: ask the person to look at the ${PLATFORM[t].en} page; if it is not there, offer post_now with targets=["${t}"].`);
    } else if (row.action === "app.publish") {
      checked.push(POST_OK[lang](name));
    } else {
      const err = str(rec(row.metadata)?.error) ?? "";
      if (t === "IG" && IG_PROCESSING.includes(err)) continue; // still being prepared: neither right nor wrong yet
      problems.push(POST_FAILED[lang](name));
      fixes.push(`The ${PLATFORM[t].en} post is on record as failed${err ? ` (${clip(err, 80)})` : ""}. Tell the person; offer post_now with targets=["${t}"] and the same caption and media only if they want to try again.`);
    }
  }
  if (!checked.length && !problems.length) return null;
  return problems.length ? { status: "problem", checked, problems, fix: clip(fixes.join(" "), 299) } : { status: "ok", checked, problems: [] };
};

/** A stored time, as Baghdad wall-clock "YYYY-MM-DD HH:mm". */
const baghdad = (d: Date): string => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const minute = (d: Date): number => Math.floor(d.getTime() / 60_000);
const sorted = (xs: readonly string[]): string => [...xs].sort().join(",");

const SCHEDULE_MISSING = words(
  "پۆستە خشتەکراوەکەم لە لیستی پۆستە خشتەکراوەکان نەدۆزییەوە.",
  "لم أجد المنشور المجدول في قائمة المنشورات المجدولة.",
  "I could not find the scheduled post in your scheduled list.",
);

const schedulePost: VerifyFn = async (ctx, args) => {
  const a = rec(args);
  const when = str(a?.when);
  const targets = targetsOf(a?.targets);
  if (!a || !when || !targets.length) return null;
  const runAt = baghdadLocalToUtc(when);
  if (Number.isNaN(runAt.getTime())) return null;
  const caption = (str(a.caption) ?? "").trim();
  const rows = await db.scheduledPost.findMany({
    where: { tenantId: ctx.tenantId, status: "PENDING", createdAt: { gte: since(CREATED_MS) } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { runAt: true, input: true },
  });
  const mine = rows.filter((r) => (str(rec(r.input)?.caption) ?? "").trim() === caption);
  const row = mine.find((r) => minute(r.runAt) === minute(runAt)) ?? mine[0];
  const fixAgain = `Look at list_scheduled_posts. If it is wrong or missing, schedule_post with when="${when}", targets=${JSON.stringify(targets)} and the same caption and media (cancel_scheduled_post the wrong one first), after the person agrees.`;
  if (!row) return lacking(ctx.lang, SCHEDULE_MISSING, fixAgain);
  const stored = rec(row.input)?.targets;
  const storedTargets = Array.isArray(stored) ? stored.map(String) : [];
  const names = (ts: readonly string[]): Words => plain(ts.map((t) => PLATFORM[t as "FB" | "IG"]?.[ctx.lang] ?? t).join(" + ") || "—");
  return report(
    ctx.lang,
    [
      cmp(L.scheduledAt, minute(row.runAt) === minute(runAt), plain(baghdad(row.runAt)), plain(when.replace("T", " ")), ""),
      cmp(L.platforms, sorted(storedTargets) === sorted(targets), names(storedTargets), names(targets), ""),
    ],
    { fix: () => fixAgain },
  );
};

const CANCELLED = words(
  "پۆستی خشتەکراو هەڵوەشێنراوەتەوە و ناچێتە دەرەوە",
  "تم إلغاء المنشور المجدول ولن يُنشر",
  "The scheduled post is cancelled and will not go out",
);
const NOT_CANCELLED = words(
  "پۆستی خشتەکراو هێشتا چاوەڕێی کاتی خۆیەتی و هەڵنەوەشێنراوەتەوە.",
  "المنشور المجدول ما زال بانتظار موعده ولم يُلغَ.",
  "The scheduled post is still waiting and was not cancelled.",
);

const cancelScheduledPost: VerifyFn = async (ctx, args) => {
  const id = str(rec(args)?.post);
  if (!id) return null;
  const row = await db.scheduledPost.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true } });
  if (!row) return null;
  if (row.status === "CANCELLED") return found(ctx.lang, CANCELLED);
  if (row.status === "PENDING") return lacking(ctx.lang, NOT_CANCELLED, `Call cancel_scheduled_post with post=${id.slice(0, 60)}.`);
  return null;
};

export const SHOP_VERIFIERS: Record<string, VerifyFn> = {
  post_now: postNow,
  schedule_post: schedulePost,
  set_auto_replies: setAutoReplies,
  set_autopilot: setAutopilot,
  set_daily_video: setDailyVideo,
  set_shop_options: setShopOptions,
  add_product: addProduct,
  archive_product: archiveProduct,
  set_whatsapp_number: setWhatsappNumber,
  set_order_status: setOrderStatus,
  cancel_scheduled_post: cancelScheduledPost,
  update_product: updateProduct,
};
