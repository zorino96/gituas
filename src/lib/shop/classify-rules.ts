// Two kinds of buyer message are labelled by rules, without the AI: a reaction made only of
// friendly emoji (praise), and a bare price question. They are the most common messages a shop
// gets and the cheapest to be sure about, so they are not worth a model call; and when the AI
// cannot be reached or the workspace's monthly AI allowance is used up they are still answered.
//
// The rules are strict on purpose: the message must be nothing but the question (or nothing but
// the emoji), so a second meaning ("the price is too high", "how beautiful it is", "price and
// delivery?") always goes to the model, or to the owner. The label a rule gives is the one the
// model gives to the same message.

import type { Lang } from "./money";
import type { Classification } from "./policy";

const MARKS = /[‌‍ً-ٰٟ]/g;

/** One spelling for the letters Arabic and Kurdish keyboards write differently; marks and punctuation out. */
const clean = (t: string) =>
  t
    .normalize("NFKC")
    .replace(MARKS, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .toLowerCase()
    .replace(/[?؟!.,،:;؛"'«»()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const KURDISH_ONLY = /[ێۆڕڵەڤ]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** The whole question, as it is written by buyers (spelled the way clean() spells). */
const PRICE_CKB = ["بە چەندە", "چەندە", "چەند دینارە", "چەند دینار", "چەند پارەیە", "نرخی چەندە", "نرخ چەندە", "نرخەکەی چەندە", "نرخەکەی", "نرخ", "نرخی", "قیمەتی چەندە", "قیمەت"];
const PRICE_AR = ["بكم", "بكام", "بقديش", "شكد", "شگد", "شكد السعر", "كم السعر", "السعر كم", "كم سعر", "السعر", "سعر", "بكم هذا", "بكم هاد"];
const PRICE_EN = ["price", "how much", "how much is it", "cost", "hm"];

/** Courtesy words around a question that do not change it. */
const FILLER = ["ئەمە", "ئەم", "ئەو", "تکایە", "تکا", "ببورە", "سڵاو", "برا", "خوشکە", "خۆشکە", "عزیزم", "گیان", "کاک", "هذا", "هاد", "لطفا", "من فضلك", "please", "plz", "pls", "hi", "hello", "the", "it", "is", "this", "of"];

const toSet = (xs: string[]) => new Set(xs.map(clean));
const SETS = { ckb: toSet(PRICE_CKB), ar: toSet(PRICE_AR), en: toSet(PRICE_EN) };
const FILLERS = new Set(FILLER.map(clean));

/** Friendly reactions: anything else (a laugh, an eye-roll, a question mark, money) is for the model. */
const FRIENDLY = new Set(
  [..."❤🧡💛💚💙💜🖤🤍🤎💕💖💗💘💝💞💓💟😍🥰😘😊😁😃😀🙂😇🤩😻👍👏🙌🔥✨💯🌹🌸🌷💐🎉👌🙏🤝💪⭐🌟😎"],
);
const STRIP = /[‍️\s.!~*_+=-]|\p{Emoji_Modifier}/gu;

/** A label for a message that is plainly one of the two kinds, else null (the model, or the owner, decides). */
export function classifyByRules(text: string): Classification | null {
  const raw = text.trim();
  if (!raw || raw.length > 60) return null;

  // Nothing but friendly emoji: a reaction.
  const marks = raw.replace(STRIP, "");
  if (marks !== "" && [...marks].every((ch) => FRIENDLY.has(ch))) {
    return { type: "PRAISE", intent: "none", language: "ckb", confidence: 0.9 };
  }

  // Nothing but a price question (and courtesy words).
  const words = clean(raw).split(" ").filter((w) => w && !FILLERS.has(w));
  if (!words.length || words.length > 4) return null;
  const rest = words.join(" ");
  const script: Lang | null = ARABIC_SCRIPT.test(rest) ? "ckb" : /^[a-z ]+$/.test(rest) ? "en" : null;
  if (!script) return null;
  if (script === "en") return SETS.en.has(rest) ? { type: "QUESTION", intent: "price", language: "en", confidence: 0.85 } : null;
  if (SETS.ckb.has(rest)) return { type: "QUESTION", intent: "price", language: "ckb", confidence: 0.85 };
  if (SETS.ar.has(rest)) {
    // The same letters can be Kurdish or Arabic; Kurdish-only letters settle it.
    return { type: "QUESTION", intent: "price", language: KURDISH_ONLY.test(rest) ? "ckb" : "ar", confidence: 0.85 };
  }
  return null;
}
