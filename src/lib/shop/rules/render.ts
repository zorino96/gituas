// The owner's rules in plain words: one sentence that says what a rule does (for a card or a list), the same for its actions,
// and the sentences of the log ("why did this rule not answer?") and of the lint. Sorani, Arabic and English; the Arabic uses no
// Kurdish-only letters (tests/shop/rules-render.test.ts checks it). What is quoted from the rule (keywords, the owner's texts) is
// the owner's data and is shown as written.

import { actionsOf } from "./spec";
import type { RuleSpecT } from "./spec";
import type { LintCode, LintIssue, ReasonCode, RulePlatform, Tri, UiLang } from "./types";

const tri = (ckb: string, ar: string, en: string): Tri => ({ ckb, ar, en });

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
/** Digits as the screen writes them: Arabic-Indic for Sorani and Arabic, Western for English. */
export function num(n: number | string, lang: UiLang): string {
  const s = String(n);
  return lang === "en" ? s : s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** The owner's own words in quotation marks; a text that already contains that kind of mark gets the other kind. */
function quote(s: string, lang: UiLang): string {
  if (lang === "en") return /[“”]/u.test(s) ? `"${s}"` : `“${s}”`;
  return /[«»]/u.test(s) ? `“${s}”` : `«${s}»`;
}

/** "2 minutes" in Arabic: the number decides the noun (dual, plural from 3 to 10, singular after). */
function arMinutes(n: number): string {
  if (n === 2) return "دقيقتين";
  const plural = n % 100 >= 3 && n % 100 <= 10;
  return `${num(n, "ar")} ${plural ? "دقائق" : "دقيقة"}`;
}

/** A short plain version of a text for a sentence: one line, cut on a character boundary. */
function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[], lang: UiLang): string {
  if (items.length <= 1) return items[0] ?? "";
  const sep = lang === "en" ? ", " : "، ";
  const or = lang === "ckb" ? " یان " : lang === "ar" ? " أو " : " or ";
  return items.slice(0, -1).join(sep) + or + items[items.length - 1];
}

/** The first few quoted words and how many more there are. */
function wordsList(words: readonly string[], lang: UiLang, show = 5): string {
  const shown = words.slice(0, show).map((w) => quote(w, lang));
  const more = words.length > show ? ` (+${num(words.length - show, lang)})` : "";
  return orList(shown, lang) + more;
}

const PLATFORM: Record<RulePlatform, Tri> = {
  META_FACEBOOK: tri("فەیسبووک", "فيسبوك", "Facebook"),
  META_INSTAGRAM: tri("ئینستاگرام", "إنستغرام", "Instagram"),
  WHATSAPP: tri("واتساپ", "واتساب", "WhatsApp"),
};

const INTENT: Record<string, Tri> = {
  price: tri("نرخ", "السعر", "the price"),
  delivery: tri("گەیاندن", "التوصيل", "delivery"),
  size_colour: tri("قیاس یان ڕەنگ", "المقاس أو اللون", "size or colour"),
  address: tri("ناونیشانی دووکان", "عنوان المتجر", "the shop's address"),
  hours: tri("کاتی کارکردن", "أوقات الدوام", "opening hours"),
  availability: tri("بەردەستبوون", "التوفر", "availability"),
};

const TYPE: Record<string, Tri> = {
  QUESTION: tri("پرسیار", "سؤال", "a question"),
  ORDER: tri("داواکاری", "طلب شراء", "an order request"),
  NEGOTIATION: tri("داوای داشکاندن", "طلب خصم", "a request for a discount"),
  PRAISE: tri("ستایش", "ثناء", "a compliment"),
  OTHER: tri("نامەیەکی تر", "رسالة أخرى", "another kind of message"),
};

const LANGUAGE: Record<string, Tri> = {
  ckb: tri("بە سۆرانی", "بالكردية السورانية", "in Sorani"),
  kmr: tri("بە بادینی", "بالكردية البادينية", "in Badini"),
  ar: tri("بە عەرەبی", "بالعربية", "in Arabic"),
  ku_latn: tri("بە کوردی بە پیتی لاتینی", "بالكردية بالأحرف اللاتينية", "in Kurdish with Latin letters"),
  en: tri("بە ئینگلیزی", "بالإنجليزية", "in English"),
};

/** The language of a text as a bare name, for "the English text". */
const LANGUAGE_NAME: Record<string, Tri> = {
  ckb: tri("سۆرانی", "الكردية السورانية", "Sorani"),
  kmr: tri("بادینی", "الكردية البادينية", "Badini"),
  ar: tri("عەرەبی", "العربية", "Arabic"),
  ku_latn: tri("کوردی بە پیتی لاتینی", "الكردية بالأحرف اللاتينية", "Latin-letter Kurdish"),
  en: tri("ئینگلیزی", "الإنجليزية", "English"),
};

const platformsOf = (platforms: readonly RulePlatform[], lang: UiLang): string => orList(platforms.map((p) => PLATFORM[p][lang]), lang);

const pick = (table: Record<string, Tri>, keys: readonly string[], lang: UiLang): string[] => keys.map((k) => table[k]?.[lang] ?? k);

export interface RuleParts {
  /** "When someone writes … on …" (no closing punctuation). */
  when: string;
  /** What happens, one clause per action. */
  does: string[];
  /** "At most … a day…" */
  limits: string;
}

/** The three parts of the one-sentence summary: when, what happens, and the limits. */
export function ruleParts(spec: RuleSpecT, lang: UiLang): RuleParts {
  return { when: whenClause(spec, lang), does: doesClauses(spec, lang), limits: limitsClause(spec, lang) };
}

function whenClause(spec: RuleSpecT, lang: UiLang): string {
  const t = spec.trigger;
  const kw = t.keywords ? wordsList(t.keywords.any, lang) : "";
  const intents = t.intents ? orList(pick(INTENT, t.intents, lang), lang) : "";
  const types = t.types ? orList(pick(TYPE, t.types, lang), lang) : "";
  const langs = t.languages ? orList(pick(LANGUAGE, t.languages, lang), lang) : "";
  const platforms = platformsOf(t.platforms, lang);
  const wait = spec.wait ? num(spec.wait.unansweredMinutes, lang) : "";

  if (lang === "ckb") {
    const place = t.channel === "comment" ? `لە کۆمێنتی ${platforms}` : `لە نامەی تایبەتی ${platforms}`;
    const label = intents && types ? `${types} بێت و دەربارەی ${intents} بێت` : intents ? `دەربارەی ${intents} بێت` : `${types} بێت`;
    let s = `کاتێک کەسێک ${place} `;
    s += kw ? `${kw} بنووسێت${intents || types ? ` و نامەکە ${label}` : ""}` : `نامەیەک بنێرێت کە ${label}`;
    if (langs) s += ` و ${langs} نووسرابێت`;
    if (t.viaVoice) s += " (نامەی دەنگیش دەگرێتەوە)";
    if (wait) s += ` و لە ماوەی ${wait} خولەکدا وەڵامت نەدابێتەوە`;
    return s;
  }
  if (lang === "ar") {
    const place = t.channel === "comment" ? `في تعليق على ${platforms}` : `في رسالة خاصة على ${platforms}`;
    const kinds = t.types ? orList(t.types.map((k) => quote(TYPE[k]?.ar ?? k, "ar")), "ar") : "";
    const label = intents && types ? `من نوع ${kinds} وتسأل عن ${intents}` : intents ? `تسأل عن ${intents}` : `من نوع ${kinds}`;
    let s: string;
    if (kw) s = `عندما يكتب شخص ما ${kw} ${place}${intents || types ? ` وكانت رسالته ${label}` : ""}`;
    else if (intents) s = `عندما يسأل شخص ما عن ${intents} ${place}${types ? ` وكانت الرسالة من نوع ${kinds}` : ""}`;
    else s = `عندما يرسل شخص ما ${place} رسالة من نوع ${kinds}`;
    if (langs) s += `، وكُتبت ${langs}`;
    if (t.viaVoice) s += " (وتُحتسب الرسائل الصوتية أيضًا)";
    if (spec.wait) s += `، ولم تردّ عليه خلال ${arMinutes(spec.wait.unansweredMinutes)}`;
    return s;
  }
  const place = t.channel === "comment" ? `a comment on ${platforms}` : `a private message on ${platforms}`;
  const verbs: string[] = [];
  if (kw) verbs.push(`says ${kw}`);
  if (types) verbs.push(`is ${types}`);
  if (intents) verbs.push(`asks about ${intents}`);
  if (langs) verbs.push(`is written ${langs}`);
  const joined = verbs.length > 1 ? `${verbs.slice(0, -1).join(", ")} and ${verbs[verbs.length - 1]}` : verbs[0];
  let s = `When ${place} ${joined}`;
  if (t.viaVoice) s += " (voice notes count too)";
  if (wait) s += ` and you have not answered within ${wait} minutes`;
  return s;
}

function doesClauses(spec: RuleSpecT, lang: UiLang): string[] {
  const { reply, flag, pause } = actionsOf(spec);
  const comment = spec.trigger.channel === "comment";
  const out: string[] = [];
  if (reply) {
    const text = quote(clip(reply.texts.default, 120), lang);
    const publicNote = comment && reply.publicLine === "standard";
    if (lang === "ckb") {
      out.push(comment ? `بە نامەی تایبەت ئەم وەڵامە دەنێرین: ${text}` : `ئەم وەڵامە دەنێرین: ${text}`);
      if (publicNote) out.push("لە ژێر کۆمێنتەکەدا کورتە تێبینییەک دەنووسین کە نامەکەمان ناردووە");
    } else if (lang === "ar") {
      out.push(comment ? `نرسل له رسالة خاصة بهذا النص: ${text}` : `نرد عليه بهذا النص: ${text}`);
      if (publicNote) out.push("نكتب تحت تعليقه ملاحظة قصيرة بأننا أرسلنا له رسالة");
    } else {
      out.push(comment ? `we send them a private message: ${text}` : `we answer: ${text}`);
      if (publicNote) out.push("we leave a short public note under the comment saying we did");
    }
  }
  if (flag) {
    const note = flag.note ? ` (${clip(flag.note, 80)})` : "";
    out.push(
      lang === "ckb" ? `نامەکە دەخرێتە لیستی «پێویستی بە تۆیە»${note}`
      : lang === "ar" ? `توضع الرسالة في قائمة «تحتاج إليك»${note}`
      : `the message goes to your “Needs you” list${note}`,
    );
  }
  if (pause) {
    out.push(
      lang === "ckb" ? "وەڵامدانەوەی خۆکار لەو گفتوگۆیەدا دەوەستێت"
      : lang === "ar" ? "يتوقف الرد التلقائي في تلك المحادثة"
      : "automatic replies in that conversation stop",
    );
  }
  return out;
}

function limitsClause(spec: RuleSpecT, lang: UiLang): string {
  const { perDay, perPersonPerDay: pp } = spec.limits;
  return lang === "ckb" ? `زۆرترین ${num(perDay, lang)} جار لە ڕۆژێکدا، و هەر کەسێک ڕۆژی ${num(pp, lang)} جار.`
    : lang === "ar" ? `الحد الأقصى ${num(perDay, lang)} في اليوم، و${num(pp, lang)} لكل شخص في اليوم.`
    : `At most ${perDay} a day, and ${pp} per person a day.`;
}

/** What the rule's actions do, as one sentence ("We send … and the message goes to your Needs you list."). */
export function actionsSentence(spec: RuleSpecT, lang: UiLang): string {
  const does = doesClauses(spec, lang);
  if (lang === "ckb") return `${does.map((d, i) => (i ? `و ${d}` : d)).join("، ")}.`;
  if (lang === "ar") return `${does.map((d, i) => (i ? `و${d}` : d)).join("، ")}.`;
  const first = does[0] ?? "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${does.length > 1 ? `, and ${does.slice(1).join(", and ")}` : ""}.`;
}

/** The whole rule in one sentence plus its limits: "When … , … . At most …". */
export function ruleSentence(spec: RuleSpecT, lang: UiLang): string {
  const p = ruleParts(spec, lang);
  const does = p.does.map((d, i) => (i ? (lang === "ckb" ? `و ${d}` : lang === "ar" ? `و${d}` : `and ${d}`) : d));
  const comma = lang === "en" ? ", " : "، ";
  return `${p.when}${comma}${does.join(comma)}. ${p.limits}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The log: one sentence per reason code.

const REASON: Record<ReasonCode, Tri> = {
  wrong_channel: tri(
    "ئەم یاسایە بۆ جۆرێکی تری نامەیە (کۆمێنت یان نامەی تایبەت).",
    "هذه القاعدة لنوع آخر من الرسائل (تعليق أو رسالة خاصة).",
    "The rule is for the other kind of message (a comment or a private message).",
  ),
  wrong_platform: tri("ئەم یاسایە بۆ ئەم پلاتفۆرمە دیاری نەکراوە.", "هذه القاعدة غير مفعّلة لهذه المنصة.", "The rule is not set for this platform."),
  voice: tri(
    "نامەکە دەنگییە و یاسایەکە تەنها نامەی نووسراو وەردەگرێت.",
    "الرسالة صوتية والقاعدة تقبل الرسائل المكتوبة فقط.",
    "The message is a voice note and the rule only takes typed messages.",
  ),
  no_keyword: tri("هیچ یەکێک لە وشەکانی یاساکە لە نامەکەدا نییە.", "لا توجد في الرسالة أي كلمة من كلمات القاعدة.", "None of the rule's words is in the message."),
  blocked_word: tri("وشەیەک کە یاساکە پێی ڕێگری دەکات لە نامەکەدا هەیە.", "في الرسالة كلمة تتجاهلها القاعدة.", "The message has a word the rule is set to ignore."),
  no_label: tri(
    "هێشتا نازانرێت نامەکە چ جۆرێکە، و یاساکە پێویستی بەو زانیارییە هەیە.",
    "لم يُعرف بعد نوع الرسالة، والقاعدة تحتاج إلى ذلك.",
    "The kind of message is not known, and the rule needs it.",
  ),
  wrong_intent: tri("بابەتی نامەکە (نرخ، گەیاندن...) ئەو نییە کە یاساکە دەیەوێت.", "موضوع الرسالة ليس ما تطلبه القاعدة.", "The topic of the message is not the one the rule asks for."),
  wrong_type: tri("جۆری نامەکە (پرسیار، داواکاری...) ئەو نییە کە یاساکە دەیەوێت.", "نوع الرسالة ليس ما تطلبه القاعدة.", "The kind of message is not the one the rule asks for."),
  wrong_language: tri("زمانی نامەکە ئەو نییە کە یاساکە دیاری کردووە.", "لغة الرسالة ليست التي حددتها القاعدة.", "The message is not in a language the rule is set for."),
  order_in_progress: tri(
    "کڕیار لە ناوەڕاستی پێدانی زانیاری داواکارییەکەیدایە؛ یاسا دەستی تێوەرنادات.",
    "الزبون في منتصف إعطاء تفاصيل طلبه؛ القاعدة لا تتدخل.",
    "The customer is in the middle of giving order details; rules do not interrupt that.",
  ),
  cap_rule_day: tri("یاساکە گەیشتووەتە سنووری ڕۆژانەی خۆی.", "وصلت القاعدة إلى حدها اليومي.", "The rule has reached its limit for today."),
  cap_person: tri("ئەم کەسە ئەمڕۆ پێشتر وەڵامی ئەم یاسایەی وەرگرتووە.", "هذا الشخص تلقى رد هذه القاعدة اليوم بالفعل.", "This person already got this rule's answer today."),
  cap_sender_hour: tri(
    "ئەم کەسە لە کاتژمێرێکدا چەند وەڵامێکی یاسای وەرگرتووە؛ بۆ پاراستن ڕاگیرا.",
    "تلقى هذا الشخص عدة ردود من القواعد خلال ساعة؛ توقفنا للحماية.",
    "This person got several rule replies within an hour; stopped as a safeguard.",
  ),
  reply_needs_label: tri(
    "بێ ناسینەوەی جۆری نامەکە هیچ وەڵامێکی ئامادەکراو نانێردرێت.",
    "لا يُرسل أي رد جاهز قبل معرفة نوع الرسالة.",
    "No canned reply is sent until the kind of message is known.",
  ),
  never_answered: tri(
    "گلەیی، جنێو و سپام هەرگیز بە یاسا وەڵام نادرێنەوە؛ بۆ خۆت دەمێنێتەوە.",
    "الشكاوى والإساءة والرسائل المزعجة لا يُرد عليها بقاعدة أبدًا؛ تبقى لك.",
    "Complaints, abuse and spam are never answered by a rule; they stay with you.",
  ),
  order_flow: tri(
    "داواکاری لەلایەن Gituas خۆیەوە بەڕێوە دەچێت (زانیاری کڕیار کۆ دەکاتەوە)، نەک یاسا.",
    "الطلبات يتولاها Gituas بنفسه (يجمع بيانات الزبون)، وليس القواعد.",
    "Orders are handled by Gituas itself (it collects the customer's details), not by a rule.",
  ),
  low_confidence: tri(
    "جۆری نامەکە دڵنیا نییە، بۆیە وەڵامی ئامادەکراو نانێردرێت.",
    "نوع الرسالة غير مؤكد، لذلك لا يُرسل رد جاهز.",
    "The kind of message is uncertain, so no canned reply is sent.",
  ),
  limited: tri("ئەم کەسە ئەمڕۆ لەم پۆستەدا پێشتر وەڵام دراوەتەوە.", "تم الرد على هذا الشخص اليوم على هذا المنشور.", "This person was already answered on this post today."),
  private_window: tri(
    "ماوەی ٧ ڕۆژی نامەی تایبەت بۆ ئەم کۆمێنتە بەسەر چووە.",
    "انتهت مهلة الأيام السبعة للرسالة الخاصة على هذا التعليق.",
    "The 7-day window for a private message to this comment has ended.",
  ),
  private_reply_used: tri(
    "بۆ ئەم کۆمێنتە پێشتر نامەی تایبەت نێردراوە (Meta تەنها یەکێک ڕێگە دەدات).",
    "أُرسلت رسالة خاصة على هذا التعليق من قبل (ميتا تسمح بواحدة فقط).",
    "A private message to this comment was already sent (Meta allows only one).",
  ),
  product_card: tri(
    "لەم گفتوگۆیەدا کارتی بەرهەم هەیە و ئەو دەنێردرێت، نەک ئەم یاسایە.",
    "في هذه المحادثة بطاقة منتج وهي التي تُرسل بدل هذه القاعدة.",
    "This thread has a product card, and the card is sent instead of the rule.",
  ),
  reply_taken: tri(
    "یاسایەکی تر پێشتر وەڵامی ئەم نامەیەی داوەتەوە (تەنها یەک وەڵام بۆ هەر نامەیەک).",
    "قاعدة أخرى ردت على هذه الرسالة بالفعل (رد واحد فقط لكل رسالة).",
    "Another rule already replied to this message (one reply per message).",
  ),
  pause_needs_reply: tri(
    "وەستاندن تەنها لەگەڵ وەڵامدانەوەی یاساکە دەبێت، و وەڵامەکە نەنێردرا.",
    "الإيقاف يحدث مع رد القاعدة فقط، ولم يُرسل الرد.",
    "The pause goes together with the rule's reply, and the reply was not sent.",
  ),
};

/** The sentence for a reason code in the log. */
export function reasonText(code: ReasonCode, lang: UiLang): string {
  return REASON[code]?.[lang] ?? code;
}

export const REASON_CODES = Object.keys(REASON) as ReasonCode[];

// ---------------------------------------------------------------------------------------------------------------------
// The lint: one sentence per finding.

type P = Record<string, string | number>;
type Say = Record<UiLang, (p: P, lang: UiLang) => string>;
const says = (ckb: Say["ckb"], ar: Say["ar"], en: Say["en"]): Say => ({ ckb, ar, en });
const s = (p: P, k: string): string => String(p[k] ?? "");
/** A comma-separated list of language codes as the names of those languages. */
const langNames = (p: P, lang: UiLang): string =>
  orList(s(p, "langs").split(",").filter(Boolean).map((c) => LANGUAGE_NAME[c]?.[lang] ?? c), lang);

const LINT: Record<LintCode, Say> = {
  trigger_empty: says(
    () => "یاساکە دەبێت وشە، بابەتی پرسیار (وەک نرخ) یان جۆری نامە دیاری بکات.",
    () => "يجب أن تحدد القاعدة كلمات أو موضوع سؤال (مثل السعر) أو نوع رسالة.",
    () => "The rule must name some words, a question topic (like the price) or a kind of message.",
  ),
  keyword_contradiction: says(
    (p) => `وشەی «${s(p, "word")}» هەم داواکراوە و هەم ڕێگری لێ کراوە؛ یاساکە هەرگیز کار ناکات.`,
    (p) => `الكلمة «${s(p, "word")}» مطلوبة ومحظورة في الوقت نفسه؛ لن تعمل القاعدة أبدًا.`,
    (p) => `The word “${s(p, "word")}” is both wanted and blocked, so the rule can never fire.`,
  ),
  intent_type_conflict: says(
    () => "بابەتی پرسیار (نرخ، گەیاندن...) تەنها لە نامەی جۆری «پرسیار» یان «داواکاری» هەیە؛ جۆرە هەڵبژێردراوەکانی نامە هەرگیز بابەتیان نییە.",
    () => "موضوع السؤال (السعر، التوصيل...) لا يوجد إلا في رسائل «سؤال» أو «طلب شراء»؛ الأنواع التي اخترتها لا موضوع لها أبدًا.",
    () => "A question topic (price, delivery…) only exists on questions and order requests; the kinds you picked never have one.",
  ),
  platform_channel: says(
    () => "واتساپ کۆمێنتی نییە؛ «نامەی تایبەت» هەڵبژێرە.",
    () => "واتساب لا يحتوي على تعليقات؛ اختر «رسالة خاصة».",
    () => "WhatsApp has no comments; pick private messages.",
  ),
  keyword_short: says(
    (p) => `وشەی «${s(p, "word")}» زۆر کورتە و لە زۆر نامەدا دەردەکەوێت؛ وشەیەکی درێژتر یان تایبەتتر بنووسە.`,
    (p) => `الكلمة «${s(p, "word")}» قصيرة جدًا وتظهر في رسائل كثيرة؛ اكتب كلمة أطول أو أكثر تحديدًا.`,
    (p) => `The word “${s(p, "word")}” is too short and would match many messages; use a longer or more specific word.`,
  ),
  keyword_common: says(
    (p) => `وشەی «${s(p, "word")}» وشەیەکی زۆر باوە (وەک سڵاو)؛ هەموو کەسێک دەینووسێت.`,
    (p) => `الكلمة «${s(p, "word")}» شائعة جدًا (مثل التحية)؛ يكتبها الجميع.`,
    (p) => `The word “${s(p, "word")}” is very common (like a greeting); almost everyone writes it.`,
  ),
  self_trigger: says(
    () => "خودی نووسینی وەڵامەکە وشەیەکی یاساکەی تێدایە؛ ئەگەر بگەڕێتەوە بۆت یاساکە دووبارە کار دەکات. وشەکە لە وەڵامەکە لابە یان وشەیەکی ڕێگری زیاد بکە.",
    () => "نص الرد نفسه يحتوي على كلمة من كلمات القاعدة؛ لو عاد إليك لعملت القاعدة من جديد. أزل الكلمة من الرد أو أضف كلمة محظورة.",
    () => "The reply text itself contains one of the rule's words, so the rule could answer its own reply. Take the word out of the reply or add a blocked word.",
  ),
  too_many_rules: says(
    (p) => `ئەم دووکانە گەیشتووەتە زۆرترین ژمارەی یاسای چالاک (${num(s(p, "max"), "ckb")})؛ یەکێک بوەستێنە یان بیسڕەوە.`,
    (p) => `وصل المتجر إلى الحد الأقصى من القواعد المفعّلة (${num(s(p, "max"), "ar")})؛ أوقف واحدة أو احذفها.`,
    (p) => `This shop already has the most active rules allowed (${s(p, "max")}); pause or delete one first.`,
  ),
  duplicate: says(
    (p) => `ئەم یاسایە هەمان یاسای «${s(p, "other")}»یە.`,
    (p) => `هذه القاعدة هي نفسها قاعدة «${s(p, "other")}».`,
    (p) => `This rule is identical to the rule “${s(p, "other")}”.`,
  ),
  examples_fail: says(
    (p) => `ژمارەی ئەو نموونانەی وەک ڕاگەیەندراو کار ناکەن: ${num(s(p, "count"), "ckb")}، بۆ نموونە «${s(p, "text")}».`,
    (p) => `عدد الأمثلة التي لا تعمل كما هو معلن: ${num(s(p, "count"), "ar")}، مثل «${s(p, "text")}».`,
    (p) => `Examples that do not behave as declared: ${s(p, "count")}, for example “${s(p, "text")}”.`,
  ),
  reply_on_order: says(
    () => "یاسایەک کە بۆ «داواکاری» وەڵام بداتەوە کار ناکات: داواکاری لەلایەن Gituas خۆیەوە بەڕێوە دەچێت و وەڵامی ئامادەکراو جێی ناگرێتەوە.",
    () => "قاعدة ترد على «طلب شراء» لن تعمل: يتولى Gituas الطلبات بنفسه ولا يحل رد جاهز محله.",
    () => "A rule that replies to orders will not fire: Gituas handles orders itself and a canned reply never takes its place.",
  ),
  backtest_too_broad: says(
    (p) => `ئەم یاسایە لە ${num(s(p, "share"), "ckb")}% ی نامە کۆنەکانی دووکانەکەت دەگونجێت؛ زۆر گشتییە و کڕیاری ڕاستەقینە دەگرێتەوە.`,
    (p) => `تنطبق هذه القاعدة على ${num(s(p, "share"), "ar")}% من رسائل متجرك السابقة؛ هي عامة جدًا وستلتقط زبائن حقيقيين.`,
    (p) => `This rule matches ${s(p, "share")}% of your shop's past messages; it is far too broad and would catch real customers.`,
  ),
  keyword_contains_short: says(
    (p) => `وشەی «${s(p, "word")}» بە شێوازی «لە هەر شوێنێکی نووسینەکە» کورتە و لە ناو وشەی تردا دەردەکەوێت.`,
    (p) => `الكلمة «${s(p, "word")}» بنمط «في أي مكان من النص» قصيرة وتظهر داخل كلمات أخرى.`,
    (p) => `The word “${s(p, "word")}” in "anywhere in the text" mode is short and would match inside other words.`,
  ),
  overlap: says(
    (p) => `ئەم یاسایە لەگەڵ یاسای چالاکی «${s(p, "other")}» هاوبەشە (${s(p, "shared")})؛ بۆ هەر نامەیەک تەنها یەک وەڵام دەنێردرێت و یاسای ئەولەویەتدار دەیباتەوە.`,
    (p) => `تتداخل هذه القاعدة مع القاعدة المفعّلة «${s(p, "other")}» (${s(p, "shared")})؛ يُرسل رد واحد فقط لكل رسالة وتفوز القاعدة الأعلى أولوية.`,
    (p) => `This rule overlaps the active rule “${s(p, "other")}” (${s(p, "shared")}); only one reply goes out per message and the higher-priority rule wins.`,
  ),
  same_text: says(
    (p, l) => `نووسینی ${langNames(p, l)} هەمان نووسینی سەرەکییە؛ وا دیارە وەرنەگێڕدراوە.`,
    (p, l) => `نص ${langNames(p, l)} هو نفسه النص الأساسي؛ يبدو أنه لم يُترجم.`,
    (p, l) => `The ${langNames(p, l)} text is the same as the main text; it looks untranslated.`,
  ),
  text_link: says(
    (p) => `نووسینی وەڵامەکە بەستەر، ئیمەیڵ یان @ی تێدایە (${s(p, "items")}). ئەگەر خۆت دەتەوێت باشە، ئەگەر نا لایببە.`,
    (p) => `يحتوي نص الرد على رابط أو بريد إلكتروني أو @ (${s(p, "items")}). إن كان ما تريده فلا بأس، وإلا فأزله.`,
    (p) => `The reply contains a link, e-mail or @handle (${s(p, "items")}). Fine if you meant it, otherwise take it out.`,
  ),
  text_phone: says(
    (p) => `نووسینی وەڵامەکە ژمارەی تەلەفۆنی تێدایە (${s(p, "items")}). ئەگەر ژمارەی خۆتە باشە، ئەگەر نا لایببە.`,
    (p) => `يحتوي نص الرد على رقم هاتف (${s(p, "items")}). إن كان رقمك فلا بأس، وإلا فأزله.`,
    (p) => `The reply contains a phone number (${s(p, "items")}). Fine if it is yours, otherwise take it out.`,
  ),
  text_price: says(
    (p) => `نووسینی وەڵامەکە نرخی تێدایە (${s(p, "items")}). دڵنیابە نرخەکە ڕاستە و ناگۆڕدرێت، چونکە یاساکە هەمیشە هەمان نووسین دەنێرێت.`,
    (p) => `يحتوي نص الرد على سعر (${s(p, "items")}). تأكد أنه صحيح وثابت، فالقاعدة ترسل النص نفسه دائمًا.`,
    (p) => `The reply contains a price (${s(p, "items")}). Make sure it is right and stays right: the rule always sends the same text.`,
  ),
  card_replaced: says(
    () => "لەو پۆست و گفتوگۆیانەی کارتی بەرهەمیان هەیە، نووسینی ئەم یاسایە جێگای کارتەکە دەگرێتەوە.",
    () => "في المنشورات والمحادثات التي لها بطاقة منتج سيحل نص هذه القاعدة محل البطاقة.",
    () => "On posts and chats that have a product card, this rule's text is sent instead of the card.",
  ),
  language_script_mismatch: says(
    () => "زمانە دیاریکراوەکان بە پیتی وشەکان نانووسرێن؛ ڕەنگە یاساکە زۆر کەم کار بکات.",
    () => "اللغات المحددة لا تُكتب بحروف الكلمات؛ قد تعمل القاعدة نادرًا.",
    () => "The languages you picked are not written in the letters of your words; the rule may rarely fire.",
  ),
  single_language_text: says(
    () => "تەنها یەک نووسین هەیە بەڵام وشەکان بە چەند پیتێک دەنووسرێن؛ بۆ هەر زمانێکی تر نووسینێک زیاد بکە.",
    () => "هناك نص واحد فقط بينما الكلمات بأكثر من خط؛ أضف نصًا لكل لغة أخرى.",
    () => "There is only one text but the words are in more than one script; add a text for each other language.",
  ),
  pause_is_lasting: says(
    () => "وەستاندنی گفتوگۆ وەڵامدانەوەی خۆکار لەو گفتوگۆیەدا دەوەستێنێت؛ دەبێت خۆت بەردەوامی پێ بدەیت.",
    () => "إيقاف المحادثة يوقف الرد التلقائي فيها؛ عليك أن تتابعها بنفسك.",
    () => "Pausing a conversation stops automatic replies in it; you have to carry it on yourself.",
  ),
  backtest_broad: says(
    (p) => `ئەم یاسایە لە ${num(s(p, "share"), "ckb")}% ی نامە کۆنەکانی دووکانەکەت دەگونجێت؛ ڕەنگە زۆر گشتی بێت.`,
    (p) => `تنطبق هذه القاعدة على ${num(s(p, "share"), "ar")}% من رسائل متجرك السابقة؛ قد تكون عامة أكثر من اللازم.`,
    (p) => `This rule matches ${s(p, "share")}% of your shop's past messages; it may be too broad.`,
  ),
};

export const LINT_TEXT_CODES = Object.keys(LINT) as LintCode[];

/** The sentence for one lint finding, with its values filled in. */
export function lintText(issue: LintIssue, lang: UiLang): string {
  const say = LINT[issue.code];
  return say ? say[lang](issue.params ?? {}, lang) : issue.code;
}
