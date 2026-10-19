// Does this message tell the shop to stop writing to the person? Pure: a short list of phrases in Sorani, Arabic, Kurdish in Latin
// letters (Badini and Sorani) and English, matched on the folded text (fold.ts), so a keyboard's spelling differences are erased on
// both sides exactly as they are for the owner's keywords.
//
// Why it exists: a buyer who writes "stop messaging me about the price" matches a rule on "price", and a rule that answers it with a
// canned text answers a person who just asked not to be answered. A message like this never gets a rule's reply (the engine gives the
// reason opt_out). It is a safeguard that errs on the quiet side: a false hit only means one canned reply is not sent.
//
// Phrases are whole tokens in a row, never a loose substring: "bus stop" and "non-stop" do not match "stop messaging" or "stop".
// A bare word that is common in ordinary sentences ("stop", "enough", the Sorani/Arabic "just/only") counts only when it is the
// WHOLE message.
//
// This file holds Arabic-script text as ordinary characters (no invisible or bidi characters); the folding does the rest.

import { fold, tokens } from "./fold";

/** Phrases that mean "stop writing to me" wherever they stand in the message. Written as people type them. */
const ANYWHERE: readonly string[] = [
  // English ("don't" folds to "dont")
  "stop messaging", "stop texting", "stop sending", "stop contacting", "stop writing", "stop replying", "stop spamming", "stop it", "please stop",
  "unsubscribe", "opt out", "optout", "remove me", "leave me alone", "no more messages", "no more texts",
  "dont message me", "dont text me", "dont contact me", "dont write me", "dont write to me", "dont send me",
  "do not message", "do not text", "do not contact", "do not send me",
  // Sorani (Arabic letters): "enough", "don't send / don't write to me", "leave me alone", "I don't want messages"
  "بەس بکە", "بەس بکەن", "مەنێرە بۆم", "مەنێرن بۆم", "پەیام مەنێرە", "نامە مەنێرە", "پەیامم بۆ مەنێرە", "نامەم بۆ مەنێرە", "ئیتر مەنێرە",
  "مەنووسە بۆم", "مەنووسن بۆم", "ئیتر مەنووسە", "وازم لێ بێنە", "وازم لێبێنە", "وازم لێ بهێنە", "دەست هەڵگرە", "دەست لێ هەڵگرە",
  "نامەوێت پەیام", "نامەوێ پەیام", "نامەوێت نامە", "نامەوێ نامە",
  // Arabic: "don't send / write / call me", "stop the messages", "unsubscribe", "leave me alone", "I don't want messages"
  "لا ترسل لي", "لا ترسلي", "لا ترسلوا لي", "لا تراسلني", "لا تراسلوني", "لا تكلمني", "لا تتصل بي", "لا تتواصل معي",
  "توقف عن", "توقفوا عن", "اوقف الرسائل", "ايقاف الرسائل", "الغاء الاشتراك", "احذفني", "ازل رقمي", "احذف رقمي",
  "اتركني", "دعني وشأني", "دعني بحالي", "كفى رسائل", "كفى ارسال", "لا اريد رسائل", "ما اريد رسائل", "لا اريد استقبال",
  // Kurdish in Latin letters, Sorani and Badini: "stop it", "don't send / write to me", "leave me alone", "I don't want messages"
  "bes bke", "bes ke", "bes bike", "bes bka", "bas bke", "bas ke", "peyam menere", "pyam menere", "nama menere", "menere bom", "menusa bom",
  "wazm le bene", "wazm lebene", "dest helgre", "dest ji min berde", "dev ji min berde", "mesaj neshine", "peyam neshine", "nenivise", "nenvise",
  "naxwazim mesaj", "naxwazim peyam", "ez naxwazim mesaj", "ez naxwazim peyam",
];

/** Messages that are a stop request only when they are the whole message (the word is too common to count inside a sentence). */
const ALONE: readonly string[] = [
  "stop", "stop please", "enough", "unsubscribe",
  "بەس", "بەسە", "بوەستە", "ڕاگرە", "وەستان", "ڕاگرتن",
  "توقف", "كفى", "ايقاف", "إيقاف", "إلغاء", "الغاء",
  "bes", "bas", "bese", "bes e", "bas e",
];

const PHRASES: readonly string[][] = [...new Set(ANYWHERE.map(fold))].filter(Boolean).map(tokens);
const WHOLE: ReadonlySet<string> = new Set(ALONE.map(fold).filter(Boolean));

/** A text already folded and split into tokens (the engine folds once and reuses it). */
export interface FoldedText {
  folded: string;
  tokens: string[];
}

function hasRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) ok = haystack[i + j] === needle[j];
    if (ok) return true;
  }
  return false;
}

/** True when the message tells the shop to stop writing to the person. */
export function isStopRequest(text: string | FoldedText): boolean {
  const folded = typeof text === "string" ? fold(text) : text.folded;
  if (!folded) return false;
  if (WHOLE.has(folded)) return true;
  const toks = typeof text === "string" ? tokens(folded) : text.tokens;
  return PHRASES.some((p) => hasRun(toks, p));
}
