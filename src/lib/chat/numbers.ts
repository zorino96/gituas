// The number-grounding guard for advice. When the assistant advises ("how do I sell more"), every number it writes must come from
// somewhere real: this turn's tool results, the account snapshot, or the owner's own words in the thread. A number the model made up
// ("expect 40 percent more orders", "spend 100,000 IQD") is cut out before the owner reads it.
//
// Pure: strings in, strings out. The loop collects the allowed text and calls guardAdvice on the closing message.

import { numbersIn } from "@/lib/shop/smart";
import { foldForMatch } from "./guard";

/** 0 to 3 stay free: "two or three ideas", "one thing", "0 orders" need no source. */
const FREE_NUMBER = /^0*[0-3]$/;

/**
 * A list marker at the start of a line: "4." "10)" "- 5." (up to two digits, then a dot or bracket, then a space).
 * Taken out of the answer before its numbers are read.
 */
const LIST_MARKER = /^[ \t]*(?:[-*•]\s+)?[0-9]{1,2}[.)]\s+/gmu;

/**
 * Long identifiers (a cuid, a message id) hold digits that are not facts. They are taken out of the allowed text so that a lucky digit
 * inside an id cannot make a made-up number look grounded.
 */
const ID_LIKE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{18,}\b/g;

/** Every number a text holds as plain digit strings ("25,000" and "٢٥٬٠٠٠" are both "25000"), full-width digits included. */
const numbersOf = (text: string): string[] => numbersIn(foldForMatch(text));

/** The set of numbers an allowed text holds. */
export function allowedSet(allowedText: string): Set<string> {
  return new Set(numbersOf(allowedText.replace(ID_LIKE, " ")));
}

/** The numbers of `answer` that are not free and not in the allowed set, in order, without repeats. */
export function ungroundedNumbers(answer: string, allowedText: string): string[] {
  return ungrounded(answer, allowedSet(allowedText));
}

function ungrounded(answer: string, allowed: ReadonlySet<string>): string[] {
  const body = foldForMatch(answer).replace(LIST_MARKER, "");
  const out: string[] = [];
  for (const n of numbersIn(body)) {
    if (FREE_NUMBER.test(n) || allowed.has(n) || out.includes(n)) continue;
    out.push(n);
  }
  return out;
}

export interface AdviceGuard {
  /** What the owner reads. */
  text: string;
  /** Something was cut (or the fallback was used). */
  cut: boolean;
  /** The sentences that were dropped, for the audit line (never shown to the owner). */
  dropped: string[];
}

/** A sentence ends at . ! ? or the Arabic question mark when white space follows; a line break always ends one. */
const SPLIT = /((?<=[.!?؟])[ \t]+|\n+)/u;

/** Enough letters left to be an answer at all. */
const MIN_LETTERS = 8;

/**
 * The answer without the sentences that hold a number outside the allowed set. When nothing of use is left, the fallback (a fixed
 * sentence in the person's language, chosen by the caller) takes its place.
 */
export function guardAdviceDetailed(answer: string, allowedText: string, fallback: string): AdviceGuard {
  const allowed = allowedSet(allowedText);
  if (!ungrounded(answer, allowed).length) return { text: answer, cut: false, dropped: [] };

  // The pieces alternate: sentence, separator, sentence, separator ... A dropped sentence takes the separator after it along.
  const parts = answer.split(SPLIT);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] ?? "";
    const separator = parts[i + 1] ?? "";
    if (sentence.trim() && ungrounded(sentence, allowed).length) {
      dropped.push(sentence.trim());
      continue;
    }
    kept.push(sentence, separator);
  }
  const text = kept
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < MIN_LETTERS) return { text: fallback, cut: true, dropped };
  return { text, cut: true, dropped };
}

/**
 * The advice the owner may read: sentences with numbers nobody gave are dropped; if nothing is left, `fallback`.
 * (guardAdviceDetailed says what was cut, for the audit line.)
 */
export function guardAdvice(answer: string, allowedText: string, fallback: string): string {
  return guardAdviceDetailed(answer, allowedText, fallback).text;
}
