// Every sentence the rule tools say to the person, in Sorani, Arabic and English. What the model reads (refusals, data) is English
// and lives in the tool files. Arabic must not use Kurdish-only letters; Sorani must not use Arabic-only ones (tests check both).

import { num } from "@/lib/shop/rules/render";
import type { Lang } from "@/lib/i18n/lang";

export type Words = Record<Lang, string>;
const w = (ckb: string, ar: string, en: string): Words => ({ ckb, ar, en });
type Say<A extends unknown[]> = Record<Lang, (...a: A) => string>;
const say = <A extends unknown[]>(ckb: (...a: A) => string, ar: (...a: A) => string, en: (...a: A) => string): Say<A> => ({ ckb, ar, en });

/** A piece of text in quotation marks, the way each language writes them. */
export function quoted(s: string, lang: Lang): string {
  if (lang === "en") return /[“”]/u.test(s) ? `"${s}"` : `“${s}”`;
  return /[«»]/u.test(s) ? `“${s}”` : `«${s}»`;
}

/** The names of the rule tools (the main agent hides them while owner rules are switched off). */
export const RULE_TOOL_NAMES = ["list_rules", "get_rule", "preview_rule", "list_rule_runs", "create_rule", "pause_rule", "resume_rule", "delete_rule"] as const;

/** "Reading your rules…": what the person reads while a tool works. */
export const LABEL = {
  listRules: w("یاساکانت دەخوێنمەوە…", "أقرأ قواعدك…", "Reading your rules…"),
  getRule: w("یاساکە دەخوێنمەوە…", "أقرأ القاعدة…", "Reading the rule…"),
  previewRule: w("یاساکە تاقی دەکەمەوە…", "أجرّب القاعدة…", "Trying the rule out…"),
  listRuns: w("تۆماری یاساکان دەخوێنمەوە…", "أقرأ سجل القواعد…", "Reading what the rules did…"),
  createRule: w("یاساکە ئامادە دەکەم…", "أجهّز القاعدة…", "Getting the rule ready…"),
  pauseRule: w("وەستاندنی یاساکە ئامادە دەکەم…", "أجهّز إيقاف القاعدة…", "Getting the pause ready…"),
  resumeRule: w("دووبارە چالاککردنی یاساکە ئامادە دەکەم…", "أجهّز إعادة تشغيل القاعدة…", "Getting the restart ready…"),
  deleteRule: w("سڕینەوەی یاساکە ئامادە دەکەم…", "أجهّز حذف القاعدة…", "Getting the deletion ready…"),
};

export const TITLE = {
  create: w("یاسای خۆکاری نوێ", "قاعدة تلقائية جديدة", "New automatic rule"),
  pause: w("وەستاندنی یاسایەک", "إيقاف قاعدة مؤقتًا", "Pause a rule"),
  resume: w("دووبارە چالاککردنی یاسایەک", "إعادة تشغيل قاعدة", "Switch a rule back on"),
  delete: w("سڕینەوەی یاسایەک", "حذف قاعدة", "Delete a rule"),
};

export const FIELD = {
  shop: w("دووکان", "المتجر", "Shop"),
  name: w("ناو", "الاسم", "Name"),
  rule: w("یاسا", "القاعدة", "Rule"),
  limits: w("سنوورەکان", "الحدود", "Limits"),
  status: w("دۆخ", "الحالة", "Status"),
  example: w("نموونە", "مثال", "Example"),
  warning: w("ئاگاداری", "تنبيه", "Heads up"),
  note: w("تێبینی", "ملاحظة", "Note"),
  /** The label of each of a reply's texts. */
  text: {
    default: w("دەقی سەرەکی", "النص الأساسي", "Main text"),
    ckb: w("دەقی سۆرانی", "النص بالسورانية", "Sorani text"),
    kmr: w("دەقی بادینی", "النص بالبهدينانية", "Badini text"),
    ar: w("دەقی عەرەبی", "النص بالعربية", "Arabic text"),
    ku_latn: w("دەقی کوردی بە پیتی لاتینی", "النص الكردي بالأحرف اللاتينية", "Kurdish text in Latin letters"),
    en: w("دەقی ئینگلیزی", "النص بالإنجليزية", "English text"),
  } as Record<"default" | "ckb" | "kmr" | "ar" | "ku_latn" | "en", Words>,
};

/** One example run through the matcher: what the rule does when a customer writes that. */
export const EXAMPLE = {
  sends: say(
    (x: string, y: string) => `ئەگەر کڕیار بنووسێت ${quoted(x, "ckb")}: دەنێرێت ${quoted(y, "ckb")}`,
    (x: string, y: string) => `إذا كتب العميل ${quoted(x, "ar")}: يرسل ${quoted(y, "ar")}`,
    (x: string, y: string) => `If a customer writes ${quoted(x, "en")}: it sends ${quoted(y, "en")}`,
  ),
  flags: say(
    (x: string) => `ئەگەر کڕیار بنووسێت ${quoted(x, "ckb")}: نامەکە دەخرێتە لیستی «پێویستی بە تۆیە»`,
    (x: string) => `إذا كتب العميل ${quoted(x, "ar")}: توضع الرسالة في قائمة «تحتاج إليك»`,
    (x: string) => `If a customer writes ${quoted(x, "en")}: the message goes to your “Needs you” list`,
  ),
  nothing: say(
    (x: string) => `ئەگەر کڕیار بنووسێت ${quoted(x, "ckb")}: هیچ ناکات`,
    (x: string) => `إذا كتب العميل ${quoted(x, "ar")}: لا يحدث شيء`,
    (x: string) => `If a customer writes ${quoted(x, "en")}: nothing happens`,
  ),
};

export const NOTE = {
  startsNow: w(
    "کاتێک پشتڕاستی دەکەیتەوە یاساکە دەستبەجێ کار دەکات. هەر کاتێک بڵێیت «یاساکە بوەستێنە» دەوەستێت.",
    "بمجرد التأكيد تعمل القاعدة فورًا. وفي أي وقت قل «أوقف القاعدة» لتتوقف.",
    "Once you confirm, the rule works straight away. Say “pause the rule” at any time to stop it.",
  ),
  autoOff: w(
    "وەڵامدانەوەی خۆکار بۆ ئەم دووکانە کوژاوەتەوە، بۆیە یاساکە هیچ نانێرێت هەتا دایبگیرسێنیتەوە.",
    "الردود التلقائية متوقفة لهذا المتجر، لذلك لن ترسل القاعدة شيئًا حتى تشغّلها.",
    "Automatic replies are switched off for this shop, so the rule will send nothing until you switch them on.",
  ),
  commentScope: say(
    () => `یاسای کۆمێنت تەنها لەسەر ئەو پۆستانە کار دەکات کە وەڵامدانەوەی خۆکار دەیانگرێتەوە، و نامەی تایبەت تەنها تا ${num(7, "ckb")} ڕۆژ دوای کۆمێنتەکە دەنێردرێت.`,
    () => `تعمل قاعدة التعليقات فقط على المنشورات التي تشملها الردود التلقائية، وتُرسل الرسالة الخاصة خلال ${num(7, "ar")} أيام فقط من التعليق.`,
    () => "A comment rule only works on the posts that automatic replies cover, and a private message can be sent only within 7 days of the comment.",
  ),
  chatScope: say(
    () => `یاسای نامەی تایبەت تەنها وەڵامی ئەو کەسە دەداتەوە کە نووسیویەتی، و تەنها لە ماوەی ${num(24, "ckb")} کاتژمێر دوای نامەکەی.`,
    () => `تردّ قاعدة الرسائل الخاصة على من كتب فقط، وخلال ${num(24, "ar")} ساعة من رسالته.`,
    () => "A private-message rule answers only the person who wrote, within 24 hours of their message.",
  ),
  textsRule: w(
    "هەر کڕیارێک دەقی زمانی خۆی وەردەگرێت؛ ئەوانی تر دەقی سەرەکی وەردەگرن.",
    "كل مشترٍ يحصل على النص بلغته؛ والباقون يحصلون على النص الأساسي.",
    "Each buyer gets the text for their own language; everyone else gets the main text.",
  ),
  testMode: w(
    "Gituas هێشتا لە دۆخی تاقیکردنەوەدایە: یاساکە تۆمار دەکات چی دەکرد، بەڵام هیچ نانێرێت.",
    "ما زال Gituas في وضع التجربة: يسجّل ما كانت القاعدة ستفعله لكنه لا يرسل شيئًا.",
    "Gituas is still in test mode: it records what the rule would do, but sends nothing yet.",
  ),
  pause: w(
    "یاساکە دەوەستێت و هیچ نانێرێت هەتا دووبارە چالاکی بکەیتەوە.",
    "تتوقف القاعدة ولا ترسل شيئًا حتى تعيد تشغيلها.",
    "The rule stops and sends nothing until you switch it back on.",
  ),
  resume: w("یاساکە دووبارە دەست دەکات بە کارکردن.", "تعود القاعدة إلى العمل.", "The rule starts working again."),
  delete: say(
    () => `یاساکە دەوەستێت و لە ئەپەکەوە ناگەڕێتەوە؛ تۆمارەکەی ${num(90, "ckb")} ڕۆژ دەمێنێتەوە.`,
    () => `تتوقف القاعدة ولا يمكن استرجاعها من التطبيق؛ يبقى سجلّها ${num(90, "ar")} يومًا.`,
    () => "The rule stops and cannot be brought back from the app; its log stays for 90 days.",
  ),
  backtest: say(
    (n: number, m: number, p: number) => `لەسەر ${num(n, "ckb")} نامەی پێشووی دووکانەکەت، یاساکە ${num(m, "ckb")} جار کاری دەکرد (${num(p, "ckb")}٪).`,
    (n: number, m: number, p: number) => `على ${num(n, "ar")} من رسائل متجرك السابقة كانت القاعدة ستعمل ${num(m, "ar")} مرة (${num(p, "ar")}٪).`,
    (n: number, m: number, p: number) => `On ${n} of your shop's earlier messages the rule would have acted ${m} times (${p}%).`,
  ),
  backtestNone: w(
    "هێشتا نامەی پێشووی پێویست نییە بۆ تاقیکردنەوەی یاساکە.",
    "لا توجد رسائل سابقة كافية لتجربة القاعدة.",
    "There are not enough earlier messages to try the rule on.",
  ),
  /** Earlier messages that nothing could label: left out of the count, not counted as "the rule would not act". */
  backtestUnjudged: say(
    (n: number) => `${num(n, "ckb")} نامەی پێشوو نەتوانرا هەڵبسەنگێنرێن (جۆریان نەزانراوە) و لە ژمارەکە دەرنران.`,
    (n: number) => `تعذّر تقييم ${num(n, "ar")} من الرسائل السابقة (نوعها غير معروف) واستُبعدت من العدد.`,
    (n: number) => `${n} earlier messages could not be judged (their kind is not known) and are left out of the count.`,
  ),
  /** A rule that replies stays silent where Gituas answers with the product card (the default). The owner must see this before confirming. */
  cardKept: w(
    "لەو پۆست و گفتوگۆیانەی کارتی بەرهەمیان هەیە، کارتەکە دەنێردرێت و ئەم یاسایە بێدەنگ دەبێت. ئەگەر دەتەوێت بیگۆڕیت بڵێ «نووسینی من لە جیاتی کارتەکە بنێرە».",
    "في المنشورات والمحادثات التي لها بطاقة منتج تُرسل البطاقة وتبقى هذه القاعدة صامتة. إن أردت تغيير ذلك فقل «أرسل نصي بدل البطاقة».",
    "On posts and chats that have a product card, the card is sent and this rule stays silent. Say “send my text instead of the card” if you want that changed.",
  ),
};

export const DONE = {
  created: say(
    (name: string) => `یاسای ${quoted(name, "ckb")} چالاک کرا.`,
    (name: string) => `تم تفعيل القاعدة ${quoted(name, "ar")}.`,
    (name: string) => `The rule ${quoted(name, "en")} is on.`,
  ),
  paused: say(
    (name: string) => `یاسای ${quoted(name, "ckb")} وەستێندرا.`,
    (name: string) => `تم إيقاف القاعدة ${quoted(name, "ar")} مؤقتًا.`,
    (name: string) => `The rule ${quoted(name, "en")} is paused.`,
  ),
  resumed: say(
    (name: string) => `یاسای ${quoted(name, "ckb")} دووبارە چالاک کرایەوە.`,
    (name: string) => `أُعيد تشغيل القاعدة ${quoted(name, "ar")}.`,
    (name: string) => `The rule ${quoted(name, "en")} is on again.`,
  ),
  deleted: say(
    (name: string) => `یاسای ${quoted(name, "ckb")} سڕایەوە. تۆمارەکەی ${num(90, "ckb")} ڕۆژ دەمێنێتەوە.`,
    (name: string) => `تم حذف القاعدة ${quoted(name, "ar")}. يبقى سجلّها ${num(90, "ar")} يومًا.`,
    (name: string) => `The rule ${quoted(name, "en")} is deleted. Its log stays for 90 days.`,
  ),
};

/** The screens of the reads. */
export const VIEW = {
  rulesTitle: w("یاساکانت", "قواعدك", "Your rules"),
  noRules: w("هێشتا هیچ یاسایەکت نییە.", "ليس لديك قواعد بعد.", "You have no rules yet."),
  off: w(
    "یاسای خۆکار هێشتا بۆ ئەم هەژمارە نەکراوەتەوە.",
    "القواعد التلقائية غير مفعّلة لهذا الحساب بعد.",
    "Automatic rules are not switched on for this account yet.",
  ),
  ruleInWords: w("یاساکە بە وشە", "القاعدة بالكلمات", "The rule in words"),
  examples: w("نموونەکان", "الأمثلة", "Examples"),
  samples: w("دەقەکانی تۆ", "نصوصك", "Your texts"),
  earlier: w("نامە پێشووەکان کە یاساکە کاری پێدەکرد", "رسائل سابقة كانت القاعدة ستعمل بها", "Earlier messages the rule would have acted on"),
  problems: w("کێشەکان", "المشاكل", "Problems"),
  warnings: w("ئاگاداریەکان", "تنبيهات", "Warnings"),
  colText: w("دەق", "النص", "Text"),
  colResult: w("ئەنجام", "النتيجة", "Result"),
  sendsWord: w("دەنێرێت", "يرسل", "Sends"),
  flagsWord: w("دەخرێتە لیستی «پێویستی بە تۆیە»", "توضع في قائمة «تحتاج إليك»", "Goes to “Needs you”"),
  actsWord: w("کار دەکات", "يعمل", "Acts"),
  nothingWord: w("هیچ ناکات", "لا يحدث شيء", "Nothing happens"),
  mismatch: w("چاوەڕوان نەدەکرا", "غير متوقع", "unexpected"),
  status: {
    ACTIVE: w("کار دەکات", "تعمل", "On"),
    PAUSED: w("وەستێندراوە", "متوقفة", "Paused"),
    PAUSED_AUTO: w("خۆی وەستا", "توقفت من تلقاء نفسها", "Stopped by itself"),
    ARCHIVED: w("سڕاوەتەوە", "محذوفة", "Deleted"),
  } as Record<string, Words>,
  recent: say(
    (n: number) => `${num(n, "ckb")} جار لە ${num(7, "ckb")} ڕۆژی ڕابردوودا`,
    (n: number) => `${num(n, "ar")} مرة في آخر ${num(7, "ar")} أيام`,
    (n: number) => `${n} time${n === 1 ? "" : "s"} in the last 7 days`,
  ),
};

export const RUNS = {
  title: w("چی کراوە", "ماذا فعلت القواعد", "What your rules did"),
  none: w("هێشتا هیچ تۆمارێک نییە.", "لا يوجد سجل بعد.", "Nothing has been logged yet."),
  colWhen: w("کات", "الوقت", "When"),
  colRule: w("یاسا", "القاعدة", "Rule"),
  colWhat: w("چی بوو", "ماذا حدث", "What happened"),
  colWhy: w("هۆکار", "السبب", "Why"),
  replySent: w("وەڵام نێردرا", "أُرسل الرد", "Reply sent"),
  replyWaiting: w("وەڵام چاوەڕێیە", "الرد بالانتظار", "Reply waiting"),
  replyNotSent: w("وەڵام نەنێردرا", "لم يُرسل الرد", "Reply not sent"),
  flagged: w("خرایە لیستی «پێویستی بە تۆیە»", "وُضعت في قائمة «تحتاج إليك»", "Put on your “Needs you” list"),
  held: w("ڕاگیرا", "أُوقف", "Held back"),
  test: w("تاقیکردنەوە", "تجريبي", "Test run"),
  failed: w("شکستی هێنا", "فشل", "Failed"),
  inProgress: w("لە کاردایە", "قيد التنفيذ", "In progress"),
  noJob: w("وەڵامەکە نەخرایە ڕیز", "لم يوضع الرد في الطابور", "The reply was not queued"),
  /** A run the server left half-way (the function was cut off) and nobody finished: settled as "stale" after ten minutes. */
  cutOff: w("لە ناوەڕاستدا پچڕا", "انقطع في منتصف التنفيذ", "Cut off half-way"),
  cutOffWhy: w(
    "سێرڤەر پێش تەواوبوون پچڕا، بۆیە نازانرێت وەڵامەکە نێردرا یان نا.",
    "انقطع الخادم قبل الانتهاء، فلا يُعرف هل أُرسل الرد أم لا.",
    "The server was cut off before the end, so it is not known whether the reply went out.",
  ),
  /** The outbox's short code "too_long": Instagram refused the text (over 1,000 bytes) and it can never go through. */
  tooLong: w(
    "دەقی وەڵامەکە لەوە درێژترە کە ئینستاگرام وەریدەگرێت (١٠٠٠ بایت)؛ کورتی بکەرەوە.",
    "نص الرد أطول مما يقبله إنستغرام (١٠٠٠ بايت)؛ اختصره.",
    "The reply text is longer than Instagram accepts (1,000 bytes); shorten it.",
  ),
};

/** The buckets the model reads in a run log. */
export const RUN_KIND = ["acted", "held_back", "test"] as const;
export type RunKind = (typeof RUN_KIND)[number];
export const RUN_KIND_STATUSES: Record<RunKind, string[]> = {
  acted: ["CLAIMED", "QUEUED", "PENDING", "DONE"],
  held_back: ["SKIPPED", "FAILED"],
  test: ["DRY"],
};
