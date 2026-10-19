// The lint: what is wrong, or probably wrong, with a rule that is valid JSON. Problems stop the rule from being saved; warnings
// are shown on the card so the owner decides. Everything here is pure; the sentences come from render.ts (lintText) in all three
// languages. Checks that need the shop's stored messages (the backtest) live in preview.ts (backtestIssue).

import { classifyByRules } from "../classify-rules";
import { asciiDigits, fold, isEmojiToken, scriptsOf, skeletonLength, tokens } from "./fold";
import { compileKeyword, matchKeywords, matchTrigger } from "./match";
import { evaluateExamples } from "./preview";
import { actionsOf, specHash, type RuleSpecT } from "./spec";
import { MAX_ACTIVE_RULES, MIN_KEYWORD_LETTERS, SHOP_LANGS, type LintIssue } from "./types";

/** Another ACTIVE rule of the same shop (never the rule being linted). */
export interface OtherRule {
  id?: string;
  name: string;
  spec: RuleSpecT;
}

export interface LintContext {
  /** How many active rules a shop may have (default MAX_ACTIVE_RULES). */
  maxActiveRules?: number;
  /** What the owner typed in this conversation: a phone number or a price that is in it is the owner's own and is not flagged. */
  ownerText?: string;
}

export interface LintResult {
  problems: LintIssue[];
  warnings: LintIssue[];
  /** No problems (warnings do not stop a rule). */
  ok: boolean;
}

/**
 * Words almost everyone writes: thanks, "yes", "good", "how". A rule on one of these alone would answer half the shop's messages.
 * The courtesy words around a price question (hello, please, sir, "this") are NOT listed here: classify-rules.ts keeps that table
 * private, so isCourtesyWord asks the classifier itself instead of copying it.
 */
const COMMON = [
  // Sorani
  "بەخێربێن", "سوپاس", "زۆر", "جوان", "باشە", "بۆ", "لە", "کە", "من", "تۆ", "ئایا", "چۆن", "هەیە", "نییە", "نا", "بەڵێ", "ئەرێ", "ماڵئاوا", "ڕۆژباش", "شەوباش",
  // Arabic
  "مرحبا", "السلام", "عليكم", "اهلا", "شكرا", "جميل", "نعم", "هذه", "في", "على", "ما", "هل", "كيف", "ممكن",
  // English
  "hey", "ok", "okay", "thanks", "thank", "you", "a", "i", "yes", "no", "good", "nice", "how", "what", "can", "are", "and", "for", "to", "in", "on", "me", "my", "we", "do", "have", "there", "bro", "sis",
];
const COMMON_FOLDED = new Set(COMMON.map(fold));

/** A word the free classifier ignores around a price question: it is a courtesy word, so a keyword made of it matches everyone. */
function isCourtesyWord(word: string): boolean {
  return !classifyByRules(word) && classifyByRules(`${word} چەندە`) !== null;
}

/** Every word of the keyword is a very common one. */
function isCommonKeyword(source: string): boolean {
  const words = source.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => COMMON_FOLDED.has(fold(w)) || isCourtesyWord(w));
}

const onlyEmoji = (folded: string): boolean => !!folded && tokens(folded).every(isEmojiToken);
const scriptOfKeyword = (kw: string): "arabic" | "latin" | null => {
  const s = scriptsOf(kw);
  return s.arabic ? "arabic" : s.latin ? "latin" : null;
};

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|co|app|shop|store|iq|krd|info|biz|ly|link|xyz|site|online|tk)\b(?:\/[^\s<>"]*)?/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const HANDLE_RE = /(?<![\w.@])@[a-z0-9_.]{2,}/gi;
const PHONE_RE = /(?<!\d)(?:\+|00)?\d(?:[\s().-]?\d){6,}(?!\d)/g;
/** A number next to a currency word or sign ("5000 IQD", "٥ هەزار دینار", "$12"). */
const PRICE_RE = /\d[\d.,]*\s*(?:iqd|usd|dinars?|dollars?|\$|د\.ع|دینار|دينار|دۆلار|دولار|هەزار|هزار|ألف|الف)|(?:iqd|usd|\$|د\.ع)\s*\d[\d.,]*/gi;

const digitsOf = (s: string): string => s.replace(/\D/g, "");

/** The links, phone numbers and prices written in a text (digits of every script read as 0-9). */
export function textFindings(text: string): { links: string[]; phones: string[]; prices: string[] } {
  const t = asciiDigits(text);
  // A match ends where the sentence does: "write to a@b.com." is the address, not the address and a full stop.
  const tidy = (xs: string[]) => xs.map((x) => x.trim().replace(/[.,;:!?)\]'"]+$/g, "")).filter(Boolean);
  const uniq = (xs: string[]) => [...new Set(tidy(xs))];
  // The domain inside an e-mail address is found twice; keep the longer one.
  const longest = (xs: string[]) => xs.filter((x) => !xs.some((y) => y !== x && y.includes(x)));
  const links = longest(uniq([...(t.match(URL_RE) ?? []), ...(t.match(EMAIL_RE) ?? []), ...(t.match(HANDLE_RE) ?? [])]));
  const phones = (t.match(PHONE_RE) ?? []).filter((p) => {
    const d = digitsOf(p);
    return d.length >= 10 || /^\s*(?:\+|0)/.test(p);
  });
  return { links, phones: uniq(phones), prices: uniq(t.match(PRICE_RE) ?? []) };
}

export function lintRule(spec: RuleSpecT, others: readonly OtherRule[] = [], context: LintContext = {}): LintResult {
  const problems: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const problem = (code: LintIssue["code"], params?: LintIssue["params"]) => problems.push({ code, level: "problem", ...(params ? { params } : {}) });
  const warn = (code: LintIssue["code"], params?: LintIssue["params"]) => warnings.push({ code, level: "warning", ...(params ? { params } : {}) });

  const t = spec.trigger;
  const { reply, pause } = actionsOf(spec);
  const kw = t.keywords;

  // --- the trigger itself
  if (!kw && !t.intents && !t.types) problem("trigger_empty");
  if (t.channel === "comment" && t.platforms.includes("WHATSAPP")) problem("platform_channel");
  if (t.intents && t.types && !t.types.some((x) => x === "QUESTION" || x === "ORDER")) problem("intent_type_conflict");
  if (reply && t.types?.includes("ORDER")) problem("reply_on_order");

  if (kw) {
    // A keyword that the none-list always blocks leaves the rule nothing to fire on.
    const compiled = kw.any.map((k) => compileKeyword(k)).filter((k): k is NonNullable<typeof k> => !!k);
    if (kw.none.length && compiled.length && compiled.every((k) => matchKeywords(k.source, { any: kw.any, none: kw.none, mode: kw.mode }).blockedBy)) {
      problem("keyword_contradiction", { word: compiled[0].source });
    }
    const reported = new Set<string>();
    for (const k of compiled) {
      if (reported.has(k.folded)) continue;
      reported.add(k.folded);
      if (onlyEmoji(k.folded)) continue;
      const letters = skeletonLength(k.folded);
      if (letters < MIN_KEYWORD_LETTERS && !(kw.mode === "word" && letters === 2)) problem("keyword_short", { word: k.source });
      else if (letters < MIN_KEYWORD_LETTERS) warn("keyword_short", { word: k.source });
      else if (isCommonKeyword(k.source)) problem("keyword_common", { word: k.source });
      else if (kw.mode === "contains" && letters < 4) warn("keyword_contains_short", { word: k.source });
    }

    // Languages that cannot be written in the letters of the words.
    if (t.languages) {
      const scripts = new Set(compiled.map((k) => scriptOfKeyword(k.source)).filter(Boolean));
      if (scripts.size) {
        const fits = t.languages.some((l) => (l === "en" || l === "ku_latn" ? scripts.has("latin") : scripts.has("arabic")));
        if (!fits) warn("language_script_mismatch");
      }
    }
  }

  // --- the reply texts
  if (reply) {
    const texts: { lang: string; text: string }[] = [{ lang: "default", text: reply.texts.default }];
    for (const l of SHOP_LANGS) if (reply.texts[l]) texts.push({ lang: l, text: reply.texts[l] as string });

    // A text that would trigger its own rule could answer itself (a bot on the other side, a quoted reply).
    const selfHit = (text: string): boolean => {
      if (kw) return matchKeywords(text, kw).matched;
      return matchTrigger(t, { channel: t.channel, platform: t.platforms[0], text, viaVoice: false, c: classifyByRules(text) }).ok;
    };
    if (texts.some((x) => selfHit(x.text))) problem("self_trigger");

    // Variants that repeat the default word for word are almost always an untranslated copy.
    const same = texts.slice(1).filter((x) => x.text.trim() === reply.texts.default.trim() && /\p{L}/u.test(x.text)).map((x) => x.lang);
    if (same.length) warn("same_text", { langs: same.join(",") });
    if (texts.length === 1 && kw) {
      const scripts = new Set(kw.any.map(scriptOfKeyword).filter(Boolean));
      if (scripts.size > 1) warn("single_language_text");
    }

    // Links, phone numbers and prices: the owner may mean them, so this is a warning with what was found.
    const typed = context.ownerText ?? "";
    const typedDigits = digitsOf(asciiDigits(typed));
    const typedFolded = fold(typed);
    const found = { links: new Set<string>(), phones: new Set<string>(), prices: new Set<string>() };
    for (const x of texts) {
      const f = textFindings(x.text);
      for (const l of f.links) if (!typedFolded.includes(fold(l))) found.links.add(l);
      for (const p of f.phones) if (!digitsOf(p) || !typedDigits.includes(digitsOf(p))) found.phones.add(p);
      for (const p of f.prices) if (!digitsOf(p) || !typedDigits.includes(digitsOf(p))) found.prices.add(p);
    }
    const show = (s: Set<string>) => [...s].slice(0, 3).join(" | ");
    if (found.links.size) warn("text_link", { items: show(found.links) });
    if (found.phones.size) warn("text_phone", { items: show(found.phones) });
    if (found.prices.size) warn("text_price", { items: show(found.prices) });

    if (t.productCard === "replace") warn("card_replaced");
  }
  if (pause) warn("pause_is_lasting");

  // --- the shop
  const max = context.maxActiveRules ?? MAX_ACTIVE_RULES;
  if (others.length + 1 > max) problem("too_many_rules", { max });
  const hash = specHash(spec);
  for (const o of others) {
    if (specHash(o.spec) === hash) {
      problem("duplicate", { other: o.name });
      continue;
    }
    const shared = overlap(spec, o.spec);
    if (shared) warn("overlap", { other: o.name, shared });
  }

  // --- the examples must do what they say
  const bad = evaluateExamples(spec).failing;
  if (bad.length) problem("examples_fail", { count: bad.length, text: bad[0].text });

  return { problems, warnings, ok: problems.length === 0 };
}

/** What two replying rules have in common (shared words, or shared topics), or null when they cannot meet. */
function overlap(a: RuleSpecT, b: RuleSpecT): string | null {
  if (!actionsOf(a).reply || !actionsOf(b).reply) return null;
  if (a.trigger.channel !== b.trigger.channel) return null;
  if (!a.trigger.platforms.some((p) => b.trigger.platforms.includes(p))) return null;
  const ka = a.trigger.keywords;
  const kb = b.trigger.keywords;
  if (ka && kb) {
    const shared = new Set<string>();
    for (const w of ka.any) if (matchKeywords(w, { any: kb.any, mode: kb.mode }).matched) shared.add(w);
    for (const w of kb.any) if (matchKeywords(w, { any: ka.any, mode: ka.mode }).matched) shared.add(w);
    return shared.size ? [...shared].slice(0, 3).join(", ") : null;
  }
  if (!ka && !kb) {
    const common = (x: readonly string[] | undefined, y: readonly string[] | undefined): string[] => (x && y ? x.filter((v) => y.includes(v)) : [...(x ?? y ?? [])]);
    if (a.trigger.intents || b.trigger.intents) {
      const i = common(a.trigger.intents, b.trigger.intents);
      return i.length ? i.join(", ") : null;
    }
    const ty = common(a.trigger.types, b.trigger.types);
    return ty.length ? ty.join(", ") : null;
  }
  return null;
}
