// The matcher: does a rule's trigger meet this message? Pure: no database, no network, no model. The text side is the buyer's
// words folded (fold.ts); the label side is what the classifier already decided (type, topic, language), so a rule keyed on
// "asks the price" works in all five languages without a keyword list.

import type { Classification } from "../policy";
import { fold, isEmojiToken, tokens } from "./fold";
import type { RuleTrigger } from "./spec";
import type { KeywordMode, NoMatchReason, RuleChannel, RulePlatform } from "./types";

/** A prefix keyword token shorter than this must match a whole token: "I" must not hit "info". */
const MIN_PREFIX_LETTERS = 3;

export interface CompiledKeyword {
  /** Exactly what the owner wrote: the only thing a log may store about a match. */
  source: string;
  folded: string;
  tokens: string[];
}

/** A keyword ready to compare, or null when it folds to nothing (only punctuation). */
export function compileKeyword(source: string): CompiledKeyword | null {
  const folded = fold(source);
  return folded ? { source, folded, tokens: tokens(folded) } : null;
}

export function compileKeywords(list: readonly string[]): CompiledKeyword[] {
  const out: CompiledKeyword[] = [];
  const seen = new Set<string>();
  for (const source of list) {
    const k = compileKeyword(source);
    if (k && !seen.has(k.folded)) {
      seen.add(k.folded);
      out.push(k);
    }
  }
  return out;
}

/** A text folded once and compared with many keywords. */
export interface PreparedText {
  folded: string;
  tokens: string[];
}
export function prepareText(text: string): PreparedText {
  const folded = fold(text);
  return { folded, tokens: tokens(folded) };
}

/** Whether one token of the keyword fits one token of the text under the mode. */
function tokenFits(kw: string, tx: string, mode: KeywordMode): boolean {
  if (kw === tx) return true;
  // Kurdish glues its endings to the word (نرخەکەی, زانیاریم): a keyword of three letters or more may be the start of a token.
  return mode === "prefix" && !isEmojiToken(kw) && /\p{L}/u.test(kw) && [...kw].length >= MIN_PREFIX_LETTERS && tx.startsWith(kw);
}

/** Does the keyword occur in the prepared text? word: whole tokens; prefix: tokens that start with it; contains: anywhere. */
export function keywordIn(text: PreparedText, kw: CompiledKeyword, mode: KeywordMode): boolean {
  if (mode === "contains") return text.folded.includes(kw.folded);
  const n = kw.tokens.length;
  for (let i = 0; i + n <= text.tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < n && ok; j++) ok = tokenFits(kw.tokens[j], text.tokens[i + j], mode);
    if (ok) return true;
  }
  return false;
}

export interface KeywordSetInput {
  any: readonly string[];
  none?: readonly string[];
  mode?: KeywordMode;
}
export interface KeywordMatch {
  /** Some word of the any-list is in the text and no word of the none-list is. */
  matched: boolean;
  /** The owner's own spelling of the first any-keyword found (null when none). */
  hit: string | null;
  /** The owner's own spelling of the none-keyword that blocked the match, if one did. */
  blockedBy: string | null;
}

/** The any/none keyword test on a raw text. none-words veto: a text with a none-word never matches. */
export function matchKeywords(text: string | PreparedText, set: KeywordSetInput): KeywordMatch {
  const t = typeof text === "string" ? prepareText(text) : text;
  const mode = set.mode ?? "prefix";
  const hit = compileKeywords(set.any).find((k) => keywordIn(t, k, mode)) ?? null;
  if (!hit) return { matched: false, hit: null, blockedBy: null };
  const blocker = compileKeywords(set.none ?? []).find((k) => keywordIn(t, k, mode)) ?? null;
  return blocker ? { matched: false, hit: hit.source, blockedBy: blocker.source } : { matched: true, hit: hit.source, blockedBy: null };
}

/** Does the trigger ask for the classifier's labels (so a message with no label cannot meet it)? */
export function needsLabel(t: RuleTrigger): boolean {
  return !!(t.intents || t.types || t.languages);
}

/** How specific a trigger is: used to put the more specific rule first when priorities are equal. */
export function conditionCount(t: RuleTrigger): number {
  return (t.keywords ? 1 + (t.keywords.none.length ? 1 : 0) : 0) + (t.intents ? 1 : 0) + (t.types ? 1 : 0) + (t.languages ? 1 : 0);
}

export interface TriggerInput {
  channel: RuleChannel;
  platform: RulePlatform;
  /** What the buyer typed (for a voice note, its transcript). */
  text: string | PreparedText;
  /** The text is a voice note's transcript: speech recognition can mishear, so only a trigger that says so accepts it. */
  viaVoice: boolean;
  /** What the classifier decided; null when it could not (or has not been asked). */
  c: Classification | null;
}

export type TriggerResult =
  | { ok: true; /** The owner's keyword that matched, else "intent:price", "type:QUESTION" or "language:ar". Never the buyer's text. */ matched: string }
  | { ok: false; reason: NoMatchReason };

/** The whole trigger, in a fixed order so the reason it gives is always the first thing that was wrong. */
export function matchTrigger(t: RuleTrigger, input: TriggerInput): TriggerResult {
  if (t.channel !== input.channel) return { ok: false, reason: "wrong_channel" };
  if (!t.platforms.includes(input.platform)) return { ok: false, reason: "wrong_platform" };
  if (input.viaVoice && !t.viaVoice) return { ok: false, reason: "voice" };

  let matched: string | null = null;
  if (t.keywords) {
    const m = matchKeywords(input.text, t.keywords);
    if (m.blockedBy) return { ok: false, reason: "blocked_word" };
    if (!m.matched) return { ok: false, reason: "no_keyword" };
    matched = m.hit;
  }
  if (needsLabel(t)) {
    const c = input.c;
    if (!c) return { ok: false, reason: "no_label" };
    if (t.intents) {
      if (!(t.intents as readonly string[]).includes(c.intent)) return { ok: false, reason: "wrong_intent" };
      matched ??= `intent:${c.intent}`;
    }
    if (t.types) {
      if (!(t.types as readonly string[]).includes(c.type)) return { ok: false, reason: "wrong_type" };
      matched ??= `type:${c.type}`;
    }
    if (t.languages) {
      if (!(t.languages as readonly string[]).includes(c.language)) return { ok: false, reason: "wrong_language" };
      matched ??= `language:${c.language}`;
    }
  }
  return { ok: true, matched: matched ?? "" };
}
