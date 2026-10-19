// Read-backs of the news desk's changes. After a change, the stored state is read again (never the tool's own answer) and compared with
// the arguments that were asked for. A check says PROBLEM only on a clear mismatch (a row is missing, a value differs, a post is marked
// failed); when it cannot tell it returns null, and it never says "checked" for something it did not compare.
//
// Every query is scoped by ctx.tenantId (a desk is a Tenant), at most three run per check, and nothing here writes. The words for the
// person are in ctx.lang with no ids and no code; the English `fix` is for the model. A story's headline comes from a third-party
// feed: no sentence here quotes it, so nothing a feed wrote reaches the model through a read-back.

import { db } from "@/lib/db";
import { num as digits } from "@/lib/i18n/num";
import { baghdadLocalToUtc } from "@/lib/merchant/schedule";
import { catalogEntry } from "@/lib/news/catalog";
import { cleanFocusPrompt } from "@/lib/news/focus-shared";
import { normalizeChoice } from "@/lib/news/taxonomy";
import { cleanVoiceNote } from "@/lib/news/voice";
import { cleanSpeed } from "@/lib/voice/voices";
import { clip, say, words, type Say, type Words } from "../tools/writes-common";
import type { ToolCtx, VerifyFn, VerifyReport } from "../types";

// ---------------------------------------------------------------------------------------------------------------------
// Words

/** The English names, for the model-facing `fix` only. */
const P = { FB: "Facebook", IG: "Instagram" } as const;
type Platform = keyof typeof P;
/** The names the person reads (the app's own: the Sorani and Arabic sentences carry no Latin letters). */
const PLATFORM: Record<Platform, Words> = {
  FB: words("فەیسبووک", "فيسبوك", "Facebook"),
  IG: words("ئینستاگرام", "إنستغرام", "Instagram"),
};

/** The nouns of the settings a check compares, as the person reads them in a list. */
const F = {
  mode: words("دۆخی ئۆتۆپایلۆت", "وضع النشر التلقائي", "the autopilot mode"),
  platforms: words("پلاتفۆرمەکان", "المنصات", "the platforms"),
  accounts: words("ئەکاونتەکان", "الحسابات", "the accounts"),
  dailyMax: words("سنووری ڕۆژانەی پۆست", "الحد اليومي للمنشورات", "the daily post limit"),
  minGap: words("ماوەی نێوان دوو پۆست", "الفاصل بين منشورين", "the gap between posts"),
  quiet: words("کاتی بێدەنگی", "ساعات الهدوء", "the quiet hours"),
  filterMode: words("جۆری فلتەر", "نوع الفلتر", "the filter mode"),
  focus: words("ئەوەی مێزەکە دەیەوێت", "ما يريده المكتب", "what the desk wants"),
  exclude: words("ئەوەی مێزەکە نایەوێت", "ما لا يريده المكتب", "what the desk never wants"),
  broad: words("جۆری گونجان", "نوع المطابقة", "the matching"),
  keywordFilter: words("فلتەری وشە سەرەکییەکان", "فلتر الكلمات المفتاحية", "the keyword filter"),
  sourceImages: words("وێنەی سەرچاوە", "صور المصدر", "the source pictures"),
  photoCardsOnly: words("تەنها کارتی وێنەدار", "بطاقات الصور فقط", "photo cards only"),
  aiPictures: words("وێنەی AI", "صور الذكاء الاصطناعي", "the AI pictures"),
  videoMode: words("ڤیدیۆی خۆکار", "الفيديو التلقائي", "the automatic video"),
  videoStyle: words("شێوازی ڤیدیۆ", "نمط الفيديو", "the video style"),
  videoTopics: words("بابەتەکانی ڤیدیۆ", "مواضيع الفيديو", "the video topics"),
  videoDailyMax: words("سنووری ڕۆژانەی ڤیدیۆ", "الحد اليومي للفيديو", "the daily video limit"),
  videoVoice: words("دەنگی ڤیدیۆ", "صوت الفيديو", "the video voice"),
  videoSpeed: words("خێرایی خوێندنەوە", "سرعة القراءة", "the reading speed"),
  videoPrompt: words("پرۆمپتی ڤیدیۆ", "الأخبار التي تصبح فيديو", "the video prompt"),
  writingStyle: words("شێوازی نووسین", "أسلوب الكتابة", "the writing style"),
  primary: words("ڕەنگی سەرەکی", "اللون الرئيسي", "the main colour"),
  accent: words("ڕەنگی لاوەکی", "لون التمييز", "the accent colour"),
  textColour: words("ڕەنگی دەق", "لون النص", "the text colour"),
  headingFont: words("فۆنتی ناونیشان", "خط العناوين", "the heading font"),
  framePosition: words("شوێنی ناونیشان لەسەر چوارچێوە", "موضع العنوان على الإطار", "the headline position on the frame"),
  logoCorner: words("لۆگۆ لە گۆشەی کارت", "الشعار في زاوية البطاقة", "the logo corner"),
  designPrompt: words("وشەکانی دیزاینی گرافیک", "وصف التصميم", "the words about the graphics"),
  headline: words("ناونیشان", "العنوان", "the headline"),
  body: words("دەق", "النص", "the text"),
  cardKind: words("جۆری کارت", "نوع البطاقة", "the card type"),
  stat: words("ژمارە", "الرقم", "the figure"),
  quote: words("وتە", "الاقتباس", "the quote"),
  speaker: words("خاوەنی وتە", "قائل الاقتباس", "the speaker"),
};

const V = {
  noStory: words("هەواڵەکە لە لیستی ئەم مێزەدا نەدۆزرایەوە.", "لم أجد الخبر في قائمة هذا المكتب.", "The story is not in this desk's list."),
  noDraft: words("ڕەشنووسی ئەم هەواڵە نەدۆزرایەوە.", "لم أجد مسودة لهذا الخبر.", "There is no draft for this story."),
  noSettings: words("ڕێکخستنەکانی ئەم مێزە نەدۆزرانەوە.", "لم أجد إعدادات هذا المكتب.", "The desk's settings were not found."),
  noKit: words("ڕەنگ و دیزاینی کارتەکان نەدۆزرانەوە.", "لم أجد ألوان وتصميم البطاقات.", "The card look was not found."),
  savedOk: say(
    (l: string) => `پاشەکەوتکراوە وەک داواکرا: ${l}.`,
    (l: string) => `محفوظ كما طُلب: ${l}.`,
    (l: string) => `Saved as asked: ${l}.`,
  ),
  savedDiffers: say(
    (l: string) => `وەک داواکرا پاشەکەوت نەکراون: ${l}.`,
    (l: string) => `لم يُحفظ كما طُلب: ${l}.`,
    (l: string) => `Not saved as asked: ${l}.`,
  ),

  // Publishing
  publishedOn: say(
    (l: string) => `هەواڵەکە وەک بڵاوکراو تۆمار کراوە لە ${l}.`,
    (l: string) => `تم تسجيل نشر الخبر على ${l}.`,
    (l: string) => `The story is recorded as published on ${l}.`,
  ),
  processingOn: say(
    (l: string) => `${l}: هێشتا کاردەکرێت؛ بە خۆی لە چەند خولەکێکدا دەردەکەوێت.`,
    (l: string) => `${l}: ما زال قيد المعالجة وسيظهر تلقائياً خلال دقائق.`,
    (l: string) => `${l} is still processing and will appear by itself within minutes.`,
  ),
  failedOn: say(
    (l: string) => `بڵاوکردنەوە لە ${l} سەرنەکەوتووە.`,
    (l: string) => `فشل النشر على ${l}.`,
    (l: string) => `The post failed on ${l}.`,
  ),
  noRecordOn: say(
    (l: string) => `هیچ تۆمارێک نییە کە هەواڵەکە لە ${l} بڵاوکرابێتەوە.`,
    (l: string) => `لا يوجد سجل بأن الخبر نُشر على ${l}.`,
    (l: string) => `There is no record that the story went out on ${l}.`,
  ),
  markedPublished: words("هەواڵەکە لە لیستی هەواڵەکان وەک «بڵاوکراو» نیشانکراوە.", "الخبر معلّم على أنه «منشور» في قائمة الأخبار.", "The story is marked as published in the story list."),
  notMarkedPublished: words("هەواڵەکە لە لیستی هەواڵەکان هێشتا وەک «بڵاوکراو» نیشان نەکراوە.", "الخبر لم يُعلّم على أنه «منشور» في قائمة الأخبار.", "The story is not marked as published in the story list."),

  // Scheduling
  schedMissing: words("پۆستی خشتەکراو لە لیستی خشتەکراوەکان نەدۆزرایەوە.", "لم أجد المنشور المجدول في قائمة المنشورات المجدولة.", "The scheduled post is not in the scheduled list."),
  schedNotWaiting: words("پۆستی خشتەکراو چاوەڕێی کاتەکەی نییە.", "المنشور المجدول لا ينتظر موعده.", "The scheduled post is not waiting for its time."),
  schedTime: say(
    (stored: string, asked: string) => `پۆستەکە بۆ ${stored} خشتە کراوە، نەک بۆ ${asked} (بە کاتی بەغدا).`,
    (stored: string, asked: string) => `المنشور مجدول في ${stored} وليس في ${asked} (بتوقيت بغداد).`,
    (stored: string, asked: string) => `The post is scheduled for ${stored}, not ${asked} (Baghdad time).`,
  ),
  schedPlatforms: words("پلاتفۆرمەکانی پۆستی خشتەکراو جیاوازن لەوەی داواکرا.", "منصات المنشور المجدول تختلف عمّا طُلب.", "The platforms of the scheduled post differ from what was asked."),
  schedAccounts: words("ئەکاونتەکانی پۆستی خشتەکراو جیاوازن لەوەی داواکرا.", "حسابات المنشور المجدول تختلف عمّا طُلب.", "The accounts of the scheduled post differ from what was asked."),
  schedStory: words("پۆستی خشتەکراو بۆ هەواڵێکی تر پەیوەستە.", "المنشور المجدول مرتبط بخبر آخر.", "The scheduled post belongs to another story."),
  scheduledFor: say(
    (l: string, when: string) => `بۆ ${l} لە ${when} (بە کاتی بەغدا) خشتەکراوە.`,
    (l: string, when: string) => `مجدول للنشر على ${l} في ${when} (بتوقيت بغداد).`,
    (l: string, when: string) => `Scheduled for ${l} at ${when} (Baghdad time).`,
  ),

  // Dismissing
  dismissedOk: say(
    (n: number) => (n === 1 ? "هەواڵەکە وەک فڕێدراو تۆمار کراوە." : `${digits(n)} هەواڵ وەک فڕێدراو تۆمار کراون.`),
    (n: number) => (n === 1 ? "تم تسجيل الخبر كمستبعد." : n === 2 ? "تم تسجيل الخبرين كمستبعدين." : `${digits(n)} من الأخبار مسجّلة كمستبعدة.`),
    (n: number) => `${n} ${n === 1 ? "story is" : "stories are"} recorded as dismissed.`,
  ),
  // Only the count: a story's headline is third-party text and is never quoted here.
  notDismissed: say(
    (n: number) => (n === 1 ? "هەواڵەکە هێشتا فڕێنەدراوە." : `${digits(n)} هەواڵ هێشتا فڕێنەدراون.`),
    (n: number) => (n === 1 ? "الخبر لم يُستبعد بعد." : n === 2 ? "الخبران لم يُستبعدا بعد." : `${digits(n)} من الأخبار لم تُستبعد بعد.`),
    (n: number) => `${n} ${n === 1 ? "story is" : "stories are"} not dismissed yet.`,
  ),

  // The card, the video, the frames
  cardAttached: words("کارتەکە بە ڕەشنووسی هەواڵەکەوە پەیوەستە.", "البطاقة مرتبطة بمسودة الخبر.", "The card is attached to the story's draft."),
  cardNotAttached: words("کارتەکە بە ڕەشنووسی هەواڵەکەوە پەیوەست نەکراوە.", "لم تُربط البطاقة بمسودة الخبر.", "The card is not attached to the story's draft."),
  videoQueued: words("ڤیدیۆی هەواڵەکە لە ڕیزی دروستکردندایە.", "فيديو الخبر في قائمة الإنشاء.", "The story video is queued."),
  videoFailed: words("دروستکردنی ڤیدیۆی هەواڵەکە سەرنەکەوتووە.", "فشل إنشاء فيديو الخبر.", "Making the story video failed."),
  videoMissing: words("ڤیدیۆی هەواڵەکە لە لیستی ڤیدیۆکان نەدۆزرایەوە.", "لم أجد فيديو الخبر في قائمة الفيديوهات.", "The story video is not in the video list."),
  noFrame: words("ئەم بەشە چوارچێوەی تایبەتی خۆی نییە.", "ليس لهذا القسم إطار خاص به.", "This section has no frame of its own."),
  frameGone: words("ئەم بەشە ئیتر چوارچێوەی تایبەتی خۆی نییە و چوارچێوەی سەرەکی بەکاردەهێنێت.", "لم يعد لهذا القسم إطار خاص وهو يستخدم الإطار الرئيسي.", "This section no longer has its own frame; it uses the main frame."),
  frameStays: words("ئەم بەشە هێشتا چوارچێوەی تایبەتی خۆی هەیە.", "ما زال لهذا القسم إطاره الخاص.", "This section still has its own frame."),
  frameSaved: words("چوارچێوەی نوێی ئەم بەشە پاشەکەوت کراوە.", "تم حفظ إطار جديد لهذا القسم.", "A new frame is saved for this section."),
  frameNotSaved: words("چوارچێوەیەکی نوێ بۆ ئەم بەشە پاشەکەوت نەکراوە.", "لم يُحفظ إطار جديد لهذا القسم.", "No new frame was saved for this section."),
  photoOk: say(
    (l: string) => `وێنەکە («${l}») لە کتێبخانەی وێنەکاندایە.`,
    (l: string) => `الصورة («${l}») موجودة في مكتبة الصور.`,
    (l: string) => `The photo (“${l}”) is in the library.`,
  ),
  photoMissing: words("وێنەکە لە کتێبخانەی وێنەکاندا نەدۆزرایەوە.", "لم أجد الصورة في مكتبة الصور.", "The photo is not in the library."),
  photoGeneral: words("نیشانەی «گشتی»ی وێنەکە وەک داواکرا نییە.", "علامة «عامة» للصورة ليست كما طُلب.", "The photo's “fits any story” flag is not as asked."),

  // Sources
  sourceLabel: {
    ckb: (n: string) => (n ? `سەرچاوەی «${n}»` : "سەرچاوەکە"),
    ar: (n: string) => (n ? `المصدر «${n}»` : "المصدر"),
    en: (n: string) => (n ? `The source “${n}”` : "The source"),
  },
  sourceOn: say(
    (s: string) => `${s} چالاکە.`,
    (s: string) => `${s} مفعّل.`,
    (s: string) => `${s} is switched on.`,
  ),
  sourceOff: say(
    (s: string) => `${s} کوژاوەتەوە.`,
    (s: string) => `${s} متوقف.`,
    (s: string) => `${s} is switched off.`,
  ),
  sourceNotOn: say(
    (s: string) => `${s} چالاک نەکراوە.`,
    (s: string) => `${s} غير مفعّل.`,
    (s: string) => `${s} is not switched on.`,
  ),
  sourceStillOn: say(
    (s: string) => `${s} هێشتا چالاکە.`,
    (s: string) => `${s} ما زال مفعّلاً.`,
    (s: string) => `${s} is still switched on.`,
  ),
  feedOk: say(
    (n: string) => `RSS «${n}» لە سەرچاوەکاندایە و چالاکە.`,
    (n: string) => `خلاصة RSS «${n}» موجودة في المصادر ومفعّلة.`,
    (n: string) => `The RSS feed “${n}” is in the sources and switched on.`,
  ),
  feedMissing: say(
    (n: string) => `RSS «${n}» لە سەرچاوەکاندا نەدۆزرایەوە.`,
    (n: string) => `لم أجد خلاصة RSS «${n}» في المصادر.`,
    (n: string) => `The RSS feed “${n}” is not in the sources.`,
  ),
  feedOff: say(
    (n: string) => `RSS «${n}» هەیە بەڵام چالاک نییە.`,
    (n: string) => `خلاصة RSS «${n}» موجودة لكنها غير مفعّلة.`,
    (n: string) => `The RSS feed “${n}” is there but switched off.`,
  ),
  feedGone: words("RSSەکە ئیتر لە سەرچاوەکاندا نییە.", "خلاصة RSS لم تعد في المصادر.", "The RSS feed is no longer in the sources."),
  feedStays: say(
    (n: string) => `RSS «${n}» هێشتا لە سەرچاوەکاندایە.`,
    (n: string) => `خلاصة RSS «${n}» ما زالت في المصادر.`,
    (n: string) => `The RSS feed “${n}” is still in the sources.`,
  ),

  // Keywords and categories
  kwAdded: say(
    (l: string) => `وشە زیادکراوەکان لە لیستەکەدان: ${l}.`,
    (l: string) => `الكلمات المضافة موجودة في القائمة: ${l}.`,
    (l: string) => `The added words are in the list: ${l}.`,
  ),
  kwRemoved: say(
    (l: string) => `وشە لابراوەکان ئیتر لە لیستەکەدا نین: ${l}.`,
    (l: string) => `الكلمات المحذوفة لم تعد في القائمة: ${l}.`,
    (l: string) => `The removed words are no longer in the list: ${l}.`,
  ),
  kwMissing: say(
    (l: string) => `ئەم وشانە لە لیستەکەدا نین: ${l}.`,
    (l: string) => `هذه الكلمات غير موجودة في القائمة: ${l}.`,
    (l: string) => `These words are not in the list: ${l}.`,
  ),
  kwStill: say(
    (l: string) => `ئەم وشانە هێشتا لە لیستەکەدان: ${l}.`,
    (l: string) => `هذه الكلمات ما زالت في القائمة: ${l}.`,
    (l: string) => `These words are still in the list: ${l}.`,
  ),
  catAdded: words("بەشە زیادکراوەکان لە لیستی بەشەکاندان.", "الأقسام المضافة موجودة في قائمة الأقسام.", "The added categories are in the list."),
  catRemoved: words("بەشە لابراوەکان ئیتر لە لیستەکەدا نین.", "الأقسام المحذوفة لم تعد في القائمة.", "The removed categories are no longer in the list."),
  catAddMissing: words("هەندێک لە بەشە زیادکراوەکان لە لیستەکەدا نین.", "بعض الأقسام المضافة غير موجودة في القائمة.", "Some of the added categories are not in the list."),
  catRemoveLeft: words("هەندێک لە بەشە لابراوەکان هێشتا لە لیستەکەدان.", "بعض الأقسام المحذوفة ما زالت في القائمة.", "Some of the removed categories are still in the list."),
};

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers. The arguments reach a check already parsed by the tool's schema, but they are read defensively all the same.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const argsOf = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
/** Did the call ask for any of these fields? A check with nothing asked has nothing to compare, and does not even read. */
const asked = (a: Obj, ...keys: string[]): boolean => keys.some((k) => a[k] !== undefined);

/** At most `max` characters, cut on a character boundary. */
const cut = (s: string, max: number): string => Array.from(s).slice(0, max).join("");
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const sameWord = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const listSep = (ctx: ToolCtx): string => (ctx.lang === "en" ? ", " : "، ");
const joinNames = (ctx: ToolCtx, ws: readonly Words[]): string => ws.map((w) => w[ctx.lang]).join(listSep(ctx));
/** A value for the model's `fix` (English): strings quoted and cut short, nothing in it is an instruction. */
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "none" : Array.isArray(v) ? `[${v.map(show).join(", ")}]` : typeof v === "string" ? JSON.stringify(cut(v, 50)) : String(v));
/** The Baghdad wall clock of an instant, "2026-10-20 19:30". */
const baghdadTime = (d: Date): string => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

const problemOf = (ctx: ToolCtx, w: Words, fix: string): VerifyReport => ({ status: "problem", checked: [], problems: [w[ctx.lang]], fix: cut(fix, 300) });

/** A sentence with one value in it, written out in all three languages (the value is the same in each). */
const fill = (s: Say<[string]>, value: string): Words => ({ ckb: s.ckb(value), ar: s.ar(value), en: s.en(value) });
/** A sentence about something named, where the name is itself a phrase of each language. */
const withLabel = (s: Say<[string]>, label: Words): Words => ({ ckb: s.ckb(label.ckb), ar: s.ar(label.ar), en: s.en(label.en) });

/** A settings check: each field asked for is compared, the ones that match and the ones that do not are reported as two lists. */
class Tally {
  private same: Words[] = [];
  private diffs: { key: string; name: Words; want: unknown; got: unknown }[] = [];

  add(key: string, name: Words, isSame: boolean, want: unknown, got: unknown): void {
    if (isSame) this.same.push(name);
    else this.diffs.push({ key, name, want, got });
  }

  report(ctx: ToolCtx, tool: string, about = ""): VerifyReport | null {
    if (!this.same.length && !this.diffs.length) return null;
    const checked = this.same.length ? [V.savedOk[ctx.lang](joinNames(ctx, this.same))] : [];
    if (!this.diffs.length) return { status: "ok", checked, problems: [] };
    const detail = this.diffs.map((d) => `${d.key} is ${show(d.got)}, asked ${show(d.want)}`).join("; ");
    const fix = `Stored: ${detail}. Call ${tool}${about ? ` (${about})` : ""} again with the asked value(s); if it still differs, tell the person plainly and do not call it saved.`;
    return { status: "problem", checked, problems: [V.savedDiffers[ctx.lang](joinNames(ctx, this.diffs.map((d) => d.name)))], fix: cut(fix, 300) };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stories

/** publish_story: the draft's stored results say what happened to each asked place, and the story is marked published. */
const publishStory: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const story = str(a.story);
  const targets = [...new Set(strs(a.targets) ?? [])].filter((t): t is Platform => t === "FB" || t === "IG");
  if (!story || !targets.length) return null;
  const item = await db.newsItem.findFirst({
    where: { id: story, tenantId: ctx.tenantId },
    select: { status: true, draft: { select: { id: true, results: true } } },
  });
  if (!item) return problemOf(ctx, V.noStory, "The story is not on this desk any more. Tell the person; do not publish again.");
  if (!item.draft) return problemOf(ctx, V.noDraft, "The story has no draft any more. Tell the person; do not publish again.");

  type Row = { target?: unknown; ok?: unknown; pending?: unknown; accountId?: unknown; accountName?: unknown };
  const rows: Row[] = Array.isArray(item.draft.results) ? (item.draft.results as unknown[]).filter(isObj) : [];

  // The Pages asked for, per platform. A bare id is placed by the row that carries it; if no row does, it can only be placed when one platform was asked.
  const wanted: Record<Platform, string[]> = { FB: [], IG: [] };
  for (const raw of strs(a.accounts) ?? []) {
    const m = /^(?:(FB|IG):)?([0-9]{3,40})$/.exec(raw.trim());
    if (!m) continue;
    if (m[1]) {
      if (targets.includes(m[1] as Platform)) wanted[m[1] as Platform].push(m[2]);
      continue;
    }
    const hit = rows.find((r) => r.accountId === m[2] && (r.target === "FB" || r.target === "IG") && targets.includes(r.target));
    if (hit) wanted[hit.target as Platform].push(m[2]);
    else if (targets.length === 1) wanted[targets[0]].push(m[2]);
    else return null;
  }

  // A place the story went to, as recorded: the platform and, when a Page was named, its name (the person's own, cut short).
  type Place = { p: Platform; account: string };
  const place = (p: Platform, r: Row): Place => ({ p, account: typeof r.accountName === "string" && r.accountName.trim() ? clip(r.accountName, 30) : "" });
  const good: Place[] = [];
  let waiting: Place[] = [];
  const failed: Place[] = [];
  const missing = new Set<Platform>();
  for (const p of targets) {
    const mine = rows.filter((r) => r.target === p);
    const picked: (Row | null)[] = wanted[p].length ? wanted[p].map((id) => mine.find((r) => r.accountId === id) ?? null) : mine.length ? mine : [null];
    for (const r of picked) {
      if (!r) missing.add(p);
      else if (r.ok === true) good.push(place(p, r));
      else if (r.pending === true) waiting.push(place(p, r));
      else failed.push(place(p, r));
    }
  }

  // An Instagram post that was still processing is finished by the every-minute job; if that gave up, it is a failure. Only the draft's
  // newest parked post counts: an older one that gave up is history (a post parked since then is the one that is waiting).
  const stuck = waiting.filter((w) => w.p === "IG");
  if (stuck.length) {
    const newest = await db.igPending.findFirst({ where: { tenantId: ctx.tenantId, draftId: item.draft.id }, orderBy: { createdAt: "desc" }, select: { status: true } });
    if (newest?.status === "FAILED") {
      failed.push(...stuck);
      waiting = waiting.filter((w) => w.p !== "IG");
    }
  }

  const l = ctx.lang;
  const sep = listSep(ctx);
  const named = (x: Place) => (x.account ? `${PLATFORM[x.p][l]} · ${x.account}` : PLATFORM[x.p][l]);
  const join = (xs: readonly Place[]) => xs.map(named).join(sep);
  const checked: string[] = [];
  const problems: string[] = [];
  if (good.length) {
    checked.push(V.publishedOn[l](join(good)));
    if (item.status === "PUBLISHED") checked.push(V.markedPublished[l]);
    else problems.push(V.notMarkedPublished[l]);
  }
  if (waiting.length) checked.push(V.processingOn[l](join(waiting)));
  if (failed.length) problems.push(V.failedOn[l](join(failed)));
  if (missing.size) problems.push(V.noRecordOn[l]([...missing].map((p) => PLATFORM[p][l]).join(sep)));
  if (!problems.length) return checked.length ? { status: "ok", checked, problems: [] } : null;
  // The model's fix names them in English.
  const bad = [...failed.map((x) => (x.account ? `${P[x.p]} · ${x.account}` : P[x.p])), ...[...missing].map((p) => P[p])].join(", ");
  return {
    status: "problem",
    checked,
    problems,
    fix: cut(
      `Do not call publish_story again for ${bad || "this story"}: it may post twice. Read get_story for this story, tell the person plainly which place failed or has no record${item.status === "PUBLISHED" ? "" : " (the story is not marked published)"}, and let them decide whether to retry.`,
      300,
    ),
  };
};

/** schedule_story: the scheduled row is waiting, at the asked time, for the asked platforms and accounts, and carries this story's draft. */
const scheduleStory: VerifyFn = async (ctx, args, done) => {
  const a = argsOf(args);
  const story = str(a.story);
  const when = str(a.when);
  const id = str(argsOf(done.data).scheduledPost);
  const targets = [...new Set(strs(a.targets) ?? [])].filter((t): t is Platform => t === "FB" || t === "IG");
  if (!story || !when || !id || !targets.length) return null;
  const wantAt = baghdadLocalToUtc(when);
  if (Number.isNaN(wantAt.getTime())) return null;
  const [row, draft] = await Promise.all([
    db.scheduledPost.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true, runAt: true, input: true } }),
    db.newsDraft.findFirst({ where: { itemId: story, tenantId: ctx.tenantId }, select: { id: true } }),
  ]);
  const l = ctx.lang;
  const asked = when.replace("T", " ");
  const again = `Tell the person; then offer schedule_story again with the same story, targets, accounts and when ("${asked}").`;
  if (!row) return problemOf(ctx, V.schedMissing, `The scheduled post is not in the list. ${again}`);

  const input = argsOf(row.input);
  const problems: string[] = [];
  const notes: string[] = [];
  if (String(row.status) !== "PENDING") {
    problems.push(V.schedNotWaiting[l]);
    notes.push(`status is ${String(row.status)}`);
  }
  if (row.runAt.getTime() !== wantAt.getTime()) {
    problems.push(V.schedTime[l](baghdadTime(row.runAt), asked));
    notes.push(`time is ${baghdadTime(row.runAt)}`);
  }
  const storedTargets = strs(input.targets);
  if (!storedTargets || !sameSet(storedTargets, targets)) {
    problems.push(V.schedPlatforms[l]);
    notes.push(`platforms are ${show(storedTargets)}`);
  }
  const storedAccounts = argsOf(input.accounts);
  const accountsOk = (strs(a.accounts) ?? []).every((raw) => {
    const m = /^(?:(FB|IG):)?([0-9]{3,40})$/.exec(raw.trim());
    if (!m) return true;
    const lists = m[1] ? [strs(storedAccounts[m[1]])] : [strs(storedAccounts.FB), strs(storedAccounts.IG)];
    return lists.some((x) => !!x?.includes(m[2]));
  });
  if (!accountsOk) {
    problems.push(V.schedAccounts[l]);
    notes.push("accounts differ");
  }
  if (draft && input.newsDraftId !== draft.id) {
    problems.push(V.schedStory[l]);
    notes.push("it carries another draft");
  }
  if (!problems.length) return { status: "ok", checked: [V.scheduledFor[l](targets.map((p) => PLATFORM[p][l]).join(listSep(ctx)), asked)], problems: [] };
  return { status: "problem", checked: [], problems, fix: cut(`The scheduled post does not match (${notes.join("; ")}). Do not schedule a second one: cancel_scheduled_post for it first (the person confirms), then ${again}`, 300) };
};

/** edit_draft: the stored draft has each text that was asked. */
const editDraft: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const story = str(a.story);
  if (!story || !asked(a, "headline", "body", "cardKind", "stat", "quote", "speaker")) return null;
  const d = await db.newsDraft.findFirst({
    where: { itemId: story, tenantId: ctx.tenantId },
    select: { headline: true, body: true, cardKind: true, stat: true, quote: true, speaker: true },
  });
  if (!d) return problemOf(ctx, V.noDraft, `The draft is not saved. Call edit_draft again for story ${story} with the same headline and body.`);
  const t = new Tally();
  // The action stores the headline and body trimmed, and the three short fields cut to their length with an empty one cleared.
  for (const k of ["headline", "body"] as const) {
    const v = str(a[k]);
    if (v !== undefined) t.add(k, F[k], v.trim() === d[k], v.trim(), d[k]);
  }
  const kind = str(a.cardKind);
  if (kind !== undefined) t.add("cardKind", F.cardKind, kind === d.cardKind, kind, d.cardKind);
  for (const [k, max] of [["stat", 30], ["quote", 200], ["speaker", 60]] as const) {
    const v = str(a[k]);
    if (v !== undefined) t.add(k, F[k], cut(v.trim(), max) === (d[k] ?? ""), cut(v.trim(), max), d[k] ?? "");
  }
  return t.report(ctx, "edit_draft", `story ${story}`);
};

/** make_story_card: the draft has a card address and file. */
const makeStoryCard: VerifyFn = async (ctx, args) => {
  const story = str(argsOf(args).story);
  if (!story) return null;
  const d = await db.newsDraft.findFirst({ where: { itemId: story, tenantId: ctx.tenantId }, select: { cardUrl: true, cardPath: true } });
  if (!d) return problemOf(ctx, V.noDraft, "The story has no draft any more. Tell the person.");
  if (d.cardUrl && d.cardPath) return { status: "ok", checked: [V.cardAttached[ctx.lang]], problems: [] };
  return problemOf(ctx, V.cardNotAttached, `The draft has no card (the text may have changed while it was made). Call make_story_card again for story ${story}, on its own.`);
};

/** dismiss_stories: each of the stories is marked dismissed (one that is gone is not counted: nothing can be said about it). */
const dismissStories: VerifyFn = async (ctx, args) => {
  const ids = [...new Set(strs(argsOf(args).stories) ?? [])];
  if (!ids.length) return null;
  // No title is read: a feed's headline is third-party text and never goes into a read-back, only the ids and the count do.
  const rows = await db.newsItem.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId }, select: { id: true, status: true } });
  if (!rows.length) return null;
  const left = rows.filter((r) => r.status !== "DISMISSED");
  if (!left.length) return { status: "ok", checked: [V.dismissedOk[ctx.lang](rows.length)], problems: [] };
  return {
    status: "problem",
    checked: rows.length > left.length ? [V.dismissedOk[ctx.lang](rows.length - left.length)] : [],
    problems: [V.notDismissed[ctx.lang](left.length)],
    fix: cut(`Call dismiss_stories again for ${left.map((r) => r.id).join(", ")}. A story that became published cannot be dismissed: then tell the person.`, 300),
  };
};

/** make_story_video: a video row for the story was made in the last half hour and has not failed. */
const makeStoryVideo: VerifyFn = async (ctx, args) => {
  const story = str(argsOf(args).story);
  if (!story) return null;
  const v = await db.newsVideo.findFirst({
    where: { tenantId: ctx.tenantId, itemId: story, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!v) return problemOf(ctx, V.videoMissing, `No video was queued for story ${story}. Tell the person; offer make_story_video again.`);
  if (v.status === "FAILED") return problemOf(ctx, V.videoFailed, `The video job for story ${story} is marked failed. Tell the person; offer make_story_video again.`);
  return { status: "ok", checked: [V.videoQueued[ctx.lang]], problems: [] };
};

// ---------------------------------------------------------------------------------------------------------------------
// The autopilot, the filter, the keywords, the categories and the options

const setNewsAutopilot: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  if (!asked(a, "mode", "targets", "accounts", "dailyMax", "minGapMin", "quietFrom", "quietTo", "quietOff")) return null;
  const s = await db.newsSettings.findUnique({
    where: { tenantId: ctx.tenantId },
    select: { autoMode: true, autoTargets: true, autoAccounts: true, autoDailyMax: true, autoMinGapMin: true, autoQuietFrom: true, autoQuietTo: true },
  });
  if (!s) return problemOf(ctx, V.noSettings, "The autopilot settings are not saved. Call set_news_autopilot again with the asked values.");
  const t = new Tally();
  const mode = str(a.mode);
  if (mode !== undefined) t.add("mode", F.mode, s.autoMode === mode, mode, s.autoMode);
  const targets = strs(a.targets);
  if (targets !== undefined) t.add("targets", F.platforms, sameSet(s.autoTargets, [...new Set(targets)]), targets, s.autoTargets);
  const accounts = strs(a.accounts);
  if (accounts !== undefined) {
    // "FB:123" must be stored as it is; a bare "123" matches whichever platform stored it.
    const matches = (asked: string, have: string) => (asked.includes(":") ? asked === have : have.endsWith(`:${asked}`));
    const same = accounts.every((x) => s.autoAccounts.some((h) => matches(x, h))) && s.autoAccounts.every((h) => accounts.some((x) => matches(x, h)));
    t.add("accounts", F.accounts, same, accounts, s.autoAccounts);
  }
  const dailyMax = num(a.dailyMax);
  if (dailyMax !== undefined) t.add("dailyMax", F.dailyMax, s.autoDailyMax === dailyMax, dailyMax, s.autoDailyMax);
  const minGap = num(a.minGapMin);
  if (minGap !== undefined) t.add("minGapMin", F.minGap, s.autoMinGapMin === minGap, minGap, s.autoMinGapMin);
  const from = num(a.quietFrom);
  const to = num(a.quietTo);
  if (a.quietOff === true) t.add("quiet hours", F.quiet, s.autoQuietFrom === null && s.autoQuietTo === null, "none", `${show(s.autoQuietFrom)}-${show(s.autoQuietTo)}`);
  else if (from !== undefined || to !== undefined) {
    t.add("quiet hours", F.quiet, (from === undefined || s.autoQuietFrom === from) && (to === undefined || s.autoQuietTo === to), `${show(from)}-${show(to)}`, `${show(s.autoQuietFrom)}-${show(s.autoQuietTo)}`);
  }
  return t.report(ctx, "set_news_autopilot");
};

const setNewsFilter: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  if (!asked(a, "mode", "focus", "exclude", "broad")) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { filterMode: true, focusPrompt: true, excludePrompt: true, focusBroad: true } });
  const t = new Tally();
  const mode = str(a.mode);
  if (mode !== undefined) t.add("mode", F.filterMode, (s?.filterMode ?? "KEYWORDS") === mode, mode, s?.filterMode ?? "KEYWORDS");
  // The prompts are stored on one line and cut to their length, an empty one cleared (cleanFocusPrompt, the action's own).
  for (const [k, field, name] of [["focus", "focusPrompt", F.focus], ["exclude", "excludePrompt", F.exclude]] as const) {
    const v = str(a[k]);
    if (v !== undefined) t.add(k, name, (cleanFocusPrompt(v) ?? "") === (s?.[field] ?? ""), cleanFocusPrompt(v) ?? "", s?.[field] ?? "");
  }
  const broad = bool(a.broad);
  if (broad !== undefined) t.add("broad", F.broad, (s?.focusBroad ?? false) === broad, broad, s?.focusBroad ?? false);
  return t.report(ctx, "set_news_filter");
};

const setNewsKeywords: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const add = strs(a.add) ?? [];
  const remove = strs(a.remove) ?? [];
  if (!add.length && !remove.length) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { keywords: true } });
  const have = s?.keywords ?? [];
  const l = ctx.lang;
  const list = (ws: string[]) => ws.slice(0, 6).map((w) => clip(w, 20)).join(listSep(ctx));
  const notThere = add.filter((w) => !have.some((k) => sameWord(k, w)));
  // A word that is removed and added again in the same call (a new case, a re-add) is expected to be there, so it is not compared as removed.
  const compared = remove.filter((w) => !add.some((x) => sameWord(x, w)));
  const stillThere = compared.filter((w) => have.some((k) => sameWord(k, w)));
  const checked: string[] = [];
  const problems: string[] = [];
  const fixes: string[] = [];
  if (add.length) {
    if (notThere.length) {
      problems.push(V.kwMissing[l](list(notThere)));
      fixes.push(`not in the list: ${show(notThere)}`);
    }
    if (add.length > notThere.length) checked.push(V.kwAdded[l](list(add.filter((w) => !notThere.includes(w)))));
  }
  if (compared.length) {
    if (stillThere.length) {
      problems.push(V.kwStill[l](list(stillThere)));
      fixes.push(`still in the list: ${show(stillThere)}`);
    }
    if (compared.length > stillThere.length) checked.push(V.kwRemoved[l](list(compared.filter((w) => !stillThere.includes(w)))));
  }
  if (!problems.length) return { status: "ok", checked, problems: [] };
  return { status: "problem", checked, problems, fix: cut(`Stored keywords: ${show(have)}; ${fixes.join("; ")}. Call set_news_keywords again with those words, and tell the person plainly if it still differs.`, 300) };
};

const setNewsCategories: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const add = strs(a.add) ?? [];
  const remove = strs(a.remove) ?? [];
  if (!add.length && !remove.length) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { categories: true } });
  const have = normalizeChoice(s?.categories ?? []);
  const topic = (c: string) => c.split("/")[0];
  // A part is covered when its whole topic is kept (the stored list never holds both).
  const missingAdd = add.filter((c) => !have.includes(c) && !(c.includes("/") && have.includes(topic(c))));
  // A removed category that was asked to be added again in the same call is not expected to be gone, so it is not compared.
  const readded = (r: string) => add.includes(r) || add.includes(topic(r)) || (!r.includes("/") && add.some((c) => c.startsWith(`${r}/`)));
  const compared = remove.filter((r) => !readded(r));
  const leftRemove = compared.filter((r) => have.some((c) => c === r || (!r.includes("/") && c.startsWith(`${r}/`))));
  const l = ctx.lang;
  const checked: string[] = [];
  const problems: string[] = [];
  if (add.length) {
    if (missingAdd.length) problems.push(V.catAddMissing[l]);
    if (add.length > missingAdd.length) checked.push(V.catAdded[l]);
  }
  if (compared.length) {
    if (leftRemove.length) problems.push(V.catRemoveLeft[l]);
    if (compared.length > leftRemove.length) checked.push(V.catRemoved[l]);
  }
  if (!problems.length) return { status: "ok", checked, problems: [] };
  const notes = [missingAdd.length ? `not kept: ${show(missingAdd)}` : "", leftRemove.length ? `still kept: ${show(leftRemove)}` : ""].filter(Boolean).join("; ");
  return { status: "problem", checked, problems, fix: cut(`Stored categories: ${show(have)}; ${notes}. Call set_news_categories again for those, and tell the person plainly if it still differs.`, 300) };
};

const setNewsOptions: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  if (!asked(a, "keywordFilter", "sourceImages", "photoCardsOnly", "aiPictures")) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { keywordFilter: true, sourceImages: true, photoCardsOnly: true, aiPictures: true } });
  const t = new Tally();
  for (const k of ["keywordFilter", "sourceImages", "photoCardsOnly", "aiPictures"] as const) {
    const v = bool(a[k]);
    if (v !== undefined) t.add(k, F[k], (s?.[k] ?? false) === v, v, s?.[k] ?? false);
  }
  return t.report(ctx, "set_news_options");
};

// ---------------------------------------------------------------------------------------------------------------------
// Sources

const catalogName = (id: string): string => {
  try {
    return catalogEntry(id)?.name ?? "";
  } catch {
    return "";
  }
};

const toggleNewsSource: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const source = str(a.source);
  const enabled = bool(a.enabled);
  if (!source || enabled === undefined) return null;
  const row = await db.newsSource.findUnique({ where: { tenantId_catalogId: { tenantId: ctx.tenantId, catalogId: source } }, select: { enabled: true, name: true } });
  const name = clip(row?.name ?? catalogName(source), 40);
  const label = fill(V.sourceLabel, name);
  const on = row?.enabled === true;
  const fix = `Call toggle_news_source with source "${cut(source, 60)}" and enabled ${enabled} again; if the plan's source limit is reached, tell the person.`;
  if (enabled && !on) return problemOf(ctx, withLabel(V.sourceNotOn, label), fix);
  if (!enabled && on) return problemOf(ctx, withLabel(V.sourceStillOn, label), fix);
  return { status: "ok", checked: [withLabel(enabled ? V.sourceOn : V.sourceOff, label)[ctx.lang]], problems: [] };
};

const addNewsFeed: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const url = str(a.url);
  const name = clip(str(a.name) ?? "", 40);
  if (!url) return null;
  const row = await db.newsSource.findFirst({ where: { tenantId: ctx.tenantId, rssUrl: url }, select: { enabled: true, name: true } });
  const shownName = clip(row?.name ?? name, 40);
  if (!row) return problemOf(ctx, fill(V.feedMissing, shownName), "The feed was not added. Call add_news_feed again with the same address and name, or tell the person.");
  if (!row.enabled) return problemOf(ctx, fill(V.feedOff, shownName), "The feed is there but switched off. Tell the person; they can switch it on in the sources.");
  return { status: "ok", checked: [V.feedOk[ctx.lang](shownName)], problems: [] };
};

const removeNewsFeed: VerifyFn = async (ctx, args) => {
  const id = str(argsOf(args).id);
  if (!id) return null;
  const row = await db.newsSource.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { name: true } });
  if (!row) return { status: "ok", checked: [V.feedGone[ctx.lang]], problems: [] };
  return problemOf(ctx, fill(V.feedStays, clip(row.name, 40)), `The feed is still in the sources. Call remove_news_feed again with id "${cut(id, 60)}", or tell the person.`);
};

// ---------------------------------------------------------------------------------------------------------------------
// Automatic video, the writing style, the card look, the library and the frames

const setNewsVideoSettings: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  if (!asked(a, "mode", "style", "topics", "dailyMax", "voice", "speed", "prompt")) return null;
  const s = await db.newsSettings.findUnique({
    where: { tenantId: ctx.tenantId },
    select: { videoMode: true, videoStyle: true, videoTopics: true, videoDailyMax: true, videoVoice: true, videoSpeed: true, videoPrompt: true },
  });
  if (!s) return problemOf(ctx, V.noSettings, "The video settings are not saved. Call set_news_video_settings again with the asked values.");
  const t = new Tally();
  const mode = str(a.mode);
  if (mode !== undefined) t.add("mode", F.videoMode, s.videoMode === mode, mode, s.videoMode);
  const style = str(a.style);
  if (style !== undefined) t.add("style", F.videoStyle, s.videoStyle === style, style, s.videoStyle);
  const topics = strs(a.topics);
  if (topics !== undefined) t.add("topics", F.videoTopics, sameSet(normalizeChoice(topics), normalizeChoice(s.videoTopics)), normalizeChoice(topics), normalizeChoice(s.videoTopics));
  const dailyMax = num(a.dailyMax);
  if (dailyMax !== undefined) t.add("dailyMax", F.videoDailyMax, s.videoDailyMax === dailyMax, dailyMax, s.videoDailyMax);
  const voice = str(a.voice);
  if (voice !== undefined) t.add("voice", F.videoVoice, s.videoVoice === voice, voice, s.videoVoice);
  const speed = num(a.speed);
  if (speed !== undefined) t.add("speed", F.videoSpeed, Math.abs(cleanSpeed(speed) - s.videoSpeed) < 1e-6, cleanSpeed(speed), s.videoSpeed);
  const prompt = str(a.prompt);
  if (prompt !== undefined) t.add("prompt", F.videoPrompt, (cleanFocusPrompt(prompt) ?? "") === (s.videoPrompt ?? ""), cleanFocusPrompt(prompt) ?? "", s.videoPrompt ?? "");
  return t.report(ctx, "set_news_video_settings");
};

const setVoiceNote: VerifyFn = async (ctx, args) => {
  const text = str(argsOf(args).text);
  if (text === undefined) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { voiceNote: true } });
  const want = cleanVoiceNote(text) ?? "";
  const got = cleanVoiceNote(s?.voiceNote) ?? "";
  const t = new Tally();
  t.add("text", F.writingStyle, want === got, want, got);
  return t.report(ctx, "set_voice_note");
};

const setBrandLook: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  if (!asked(a, "primary", "accent", "text", "headingFont", "frameText", "logoCorner")) return null;
  const kit = await db.brandKit.findUnique({ where: { tenantId: ctx.tenantId }, select: { primary: true, accent: true, text: true, headingFont: true, frameText: true, logoCorner: true } });
  if (!kit) return problemOf(ctx, V.noKit, "The card look is not saved. Call set_brand_look again with the asked values.");
  const t = new Tally();
  for (const [k, name] of [["primary", F.primary], ["accent", F.accent], ["text", F.textColour]] as const) {
    const v = str(a[k]);
    if (v !== undefined) t.add(k, name, v.toLowerCase() === kit[k].toLowerCase(), v.toLowerCase(), kit[k].toLowerCase());
  }
  for (const [k, name] of [["headingFont", F.headingFont], ["frameText", F.framePosition], ["logoCorner", F.logoCorner]] as const) {
    const v = str(a[k]);
    if (v !== undefined) t.add(k, name, v === kit[k], v, kit[k]);
  }
  return t.report(ctx, "set_brand_look");
};

/** The design prompt as the action stores it: control characters (except tab and line breaks) taken out, trimmed, at most 1200 characters. */
const cleanDesignPrompt = (raw: string): string => {
  const kept = Array.from(raw).filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return !(c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31));
  });
  return cut(kept.join("").trim(), 1_200);
};

const setDesignPrompt: VerifyFn = async (ctx, args) => {
  const text = str(argsOf(args).text);
  if (text === undefined) return null;
  const s = await db.newsSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { designPrompt: true } });
  const want = cleanDesignPrompt(text);
  const got = cleanDesignPrompt(s?.designPrompt ?? "");
  const t = new Tally();
  t.add("text", F.designPrompt, want === got, want, got);
  return t.report(ctx, "set_design_prompt");
};

const setFrameText: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const section = str(a.section);
  const position = str(a.position);
  if (!section || !position) return null;
  const row = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId: ctx.tenantId, section } }, select: { frameText: true } });
  if (!row) return problemOf(ctx, V.noFrame, `The section "${cut(section, 30)}" has no frame of its own. Tell the person; design_section_frame can make one.`);
  const t = new Tally();
  t.add("position", F.framePosition, row.frameText === position, position, row.frameText);
  return t.report(ctx, "set_frame_text", `section ${cut(section, 30)}`);
};

const removeSectionFrame: VerifyFn = async (ctx, args) => {
  const section = str(argsOf(args).section);
  if (!section) return null;
  const row = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId: ctx.tenantId, section } }, select: { id: true } });
  if (!row) return { status: "ok", checked: [V.frameGone[ctx.lang]], problems: [] };
  return problemOf(ctx, V.frameStays, `The section "${cut(section, 30)}" still has its own frame. Call remove_section_frame again for it, or tell the person.`);
};

/** design_section_frame: the section's frame row was saved a moment ago (and sits where the headline was asked to go). */
const designSectionFrame: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const section = str(a.section);
  if (!section || section === "main") return null;
  const row = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId: ctx.tenantId, section } }, select: { framePath: true, frameText: true, updatedAt: true } });
  const fresh = !!row && !!row.framePath && Date.now() - row.updatedAt.getTime() < 15 * 60_000;
  if (!row || !fresh) return problemOf(ctx, V.frameNotSaved, `No new frame was saved for "${cut(section, 30)}". Tell the person; do not claim a frame was made.`);
  const position = str(a.position);
  if (position !== undefined && row.frameText !== position) {
    return problemOf(ctx, withLabel(V.savedDiffers, F.framePosition), `The frame was saved but the headline sits at ${show(row.frameText)}, asked ${show(position)}. Call set_frame_text for section "${cut(section, 30)}" with the asked position.`);
  }
  return { status: "ok", checked: [V.frameSaved[ctx.lang]], problems: [] };
};

const addLibraryPhoto: VerifyFn = async (ctx, args) => {
  const a = argsOf(args);
  const label = str(a.label)?.replace(/\s+/g, " ").trim();
  const attachment = str(a.attachment);
  if (!label) return null;
  const file = ctx.attachments.find((f) => f.id === attachment);
  const photo = await db.newsPhoto.findFirst({
    where: { tenantId: ctx.tenantId, label, ...(file ? { pathname: file.pathname } : {}) },
    orderBy: { createdAt: "desc" },
    select: { general: true },
  });
  if (!photo) return problemOf(ctx, V.photoMissing, "The photo is not in the library. Call add_library_photo again with the same attachment and label, or tell the person.");
  const general = bool(a.general);
  if (general !== undefined && photo.general !== general) {
    return problemOf(ctx, V.photoGeneral, `The photo is in the library but its "fits any story" flag is ${photo.general}, asked ${general}. Tell the person; do not add it a second time.`);
  }
  return { status: "ok", checked: [V.photoOk[ctx.lang](clip(label, 40))], problems: [] };
};

// ---------------------------------------------------------------------------------------------------------------------

export const NEWS_VERIFIERS: Record<string, VerifyFn> = {
  publish_story: publishStory,
  schedule_story: scheduleStory,
  edit_draft: editDraft,
  make_story_card: makeStoryCard,
  make_story_video: makeStoryVideo,
  dismiss_stories: dismissStories,
  set_news_autopilot: setNewsAutopilot,
  set_news_filter: setNewsFilter,
  set_news_keywords: setNewsKeywords,
  set_news_categories: setNewsCategories,
  set_news_options: setNewsOptions,
  toggle_news_source: toggleNewsSource,
  add_news_feed: addNewsFeed,
  remove_news_feed: removeNewsFeed,
  set_news_video_settings: setNewsVideoSettings,
  set_voice_note: setVoiceNote,
  set_brand_look: setBrandLook,
  set_design_prompt: setDesignPrompt,
  set_frame_text: setFrameText,
  remove_section_frame: removeSectionFrame,
  design_section_frame: designSectionFrame,
  add_library_photo: addLibraryPhoto,
};
