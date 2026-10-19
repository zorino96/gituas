import { describe, expect, it } from "vitest";

import type { Classification } from "@/lib/shop/policy";
import { compileKeyword, compileKeywords, conditionCount, matchKeywords, matchTrigger, needsLabel } from "@/lib/shop/rules/match";
import type { RuleTrigger } from "@/lib/shop/rules/spec";

const hit = (text: string, any: string[], mode: "word" | "prefix" | "contains" = "prefix", none: string[] = []) => matchKeywords(text, { any, none, mode });
const label = (over: Partial<Classification> = {}): Classification => ({ type: "QUESTION", intent: "price", language: "ckb", confidence: 0.85, ...over });

function trigger(over: Partial<RuleTrigger> = {}): RuleTrigger {
  return { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], viaVoice: false, productCard: "keep", keywords: { any: ["info"], none: [], mode: "prefix" }, ...over };
}
const input = (over: Record<string, unknown> = {}) => ({
  channel: "comment" as const, platform: "META_FACEBOOK" as const, text: "info", viaVoice: false, c: label(), ...over,
});

describe("keyword matching: modes", () => {
  it("word: whole words only", () => {
    expect(hit("Info please", ["info"], "word").matched).toBe(true);
    expect(hit("information", ["info"], "word").matched).toBe(false);
    expect(hit("send me the info!", ["info"], "word").matched).toBe(true);
    expect(hit("uninformed", ["info"], "word").matched).toBe(false);
  });

  it("prefix (the default): a word that starts with the keyword, for glued Kurdish endings", () => {
    expect(hit("information", ["info"]).matched).toBe(true);
    expect(hit("uninformed", ["info"]).matched).toBe(false);
    // Kurdish glues "-ەکەی", "-ی", "-م" onto the word
    expect(hit("نرخەکەی چەندە", ["نرخ"]).matched).toBe(true);
    expect(hit("نرخی ئەمە", ["نرخ"]).matched).toBe(true);
    expect(hit("زانیاریم دەوێت", ["زانیاری"]).matched).toBe(true);
    expect(hit("گەیاندنتان هەیە؟", ["گەیاندن"]).matched).toBe(true);
    // ...but a word with the keyword in the middle is another word
    expect(hit("بەنرخ", ["نرخ"]).matched).toBe(false);
  });

  it("word does not take a glued ending, prefix does", () => {
    expect(hit("نرخەکەی چەندە", ["نرخ"], "word").matched).toBe(false);
    expect(hit("نرخ چەندە", ["نرخ"], "word").matched).toBe(true);
  });

  it("contains: anywhere in the text", () => {
    expect(hit("uninformed", ["info"], "contains").matched).toBe(true);
    expect(hit("بەنرخ", ["نرخ"], "contains").matched).toBe(true);
    expect(hit("hello", ["info"], "contains").matched).toBe(false);
  });

  it("a short word in a prefix keyword must be a whole word", () => {
    expect(hit("info want", ["i want"]).matched).toBe(false);
    expect(hit("i want it", ["i want"]).matched).toBe(true);
  });

  it("a number is never a prefix of a longer number", () => {
    expect(hit("5000", ["500"]).matched).toBe(false);
    expect(hit("it costs 5000", ["5000"]).matched).toBe(true);
    expect(hit("٥٠٠٠ دینار", ["5000"]).matched).toBe(true);
  });

  it("multi-word keywords need the words side by side, in order", () => {
    expect(hit("how much is it", ["how much"], "word").matched).toBe(true);
    expect(hit("how is it much", ["how much"], "word").matched).toBe(false);
    expect(hit("much how", ["how much"], "word").matched).toBe(false);
    // prefix glue works on each word of a Kurdish phrase
    expect(hit("نرخەکەی چەندە", ["نرخ چەند"]).matched).toBe(true);
  });

  it("an emoji keyword matches as a word", () => {
    expect(hit("جوانە 🔥🔥", ["🔥"], "word").matched).toBe(true);
    expect(hit("جوانە", ["🔥"], "word").matched).toBe(false);
  });

  it("returns the owner's own spelling of the keyword that matched, never the buyer's text", () => {
    const m = hit("بۆ زانیاریم بنێرە", ["معلومات", "زانیاری", "info"]);
    expect(m).toEqual({ matched: true, hit: "زانیاری", blockedBy: null });
  });
});

describe("keyword matching: the shop words of Sorani, Badini, Arabic and Latin Kurdish", () => {
  const price = ["نرخ", "چەند", "بكم", "السعر", "price", "chende", "nirx", "bchend"];
  it("price", () => {
    for (const text of ["نرخی ئەمە چەندە", "چەندە؟", "چهنده", "بكم هذا؟", "كم السعر", "price?", "How much is the price", "Çende ye?", "chende", "nirxê wê çend e", "nirx"]) {
      expect(hit(text, price).matched, text).toBe(true);
    }
    expect(hit("زۆر جوانە 😍", price).matched).toBe(false);
  });

  it("a word with something glued to its FRONT is found by contains, not by prefix", () => {
    // Arabic-style "bi-" in front of the word: the owner picks contains (or lists the form)
    expect(hit("بچەند", ["چەند"]).matched).toBe(false);
    expect(hit("بچەند", ["چەند"], "contains").matched).toBe(true);
  });

  it("delivery", () => {
    const delivery = ["گەیاندن", "گەیاندنتان", "توصيل", "التوصيل", "delivery", "gehandin", "gehandn"];
    for (const text of ["گەیاندنتان هەیە؟", "گەیاندن بۆ دهۆک", "التوصيل متوفر؟", "توصيل لبغداد", "Do you do delivery?", "delivery to Erbil"]) {
      expect(hit(text, delivery).matched, text).toBe(true);
    }
  });

  it("size", () => {
    const size = ["قیاس", "قياس", "مقاس", "size", "qias"];
    for (const text of ["قیاسی L هەیە؟", "قیاس؟", "قياس كبير", "مقاسات؟", "What size?", "qias heye?"]) {
      expect(hit(text, size).matched, text).toBe(true);
    }
  });

  it("address", () => {
    const address = ["ناونیشان", "عنوان", "address", "nawnishan", "navnishan"];
    for (const text of ["ناونیشانتان لەکوێیە؟", "وين العنوان", "address?", "nawnishan?", "Navnîşan?"]) {
      expect(hit(text, address).matched, text).toBe(true);
    }
  });

  it("the Badini word and the Latin Kurdish stem the shop itself uses", () => {
    expect(hit("پێزانین بدەن", ["پێزانین", "زانیاری", "zanyari"]).matched).toBe(true);
    expect(hit("بيزانين", ["پێزانین"]).matched).toBe(true); // typed on an Arabic keyboard
    expect(hit("zanyari please", ["zanyari"]).matched).toBe(true);
    expect(hit("zaniari please", ["zanyari"]).matched).toBe(false); // another spelling must be listed too
    expect(hit("zaniari please", ["zanyari", "zaniari"]).matched).toBe(true);
    expect(hit("معلومات؟", ["معلومات"]).matched).toBe(true);
    expect(hit("Info please", ["info"]).matched).toBe(true);
  });
});

describe("keyword matching: the none-list", () => {
  it("a none-word vetoes the match and is reported", () => {
    expect(hit("info and price", ["info"], "prefix", ["price"])).toEqual({ matched: false, hit: "info", blockedBy: "price" });
    expect(hit("info please", ["info"], "prefix", ["price"]).matched).toBe(true);
  });

  it("uses the rule's mode, so a Kurdish ending is still a none-word", () => {
    expect(hit("زانیاری و نرخەکەی", ["زانیاری"], "prefix", ["نرخ"]).matched).toBe(false);
    expect(hit("زانیاری و نرخەکەی", ["زانیاری"], "word", ["نرخ"]).matched).toBe(true);
  });

  it("is only a veto: without an any-word there is nothing to block", () => {
    expect(hit("price only", ["info"], "prefix", ["price"])).toEqual({ matched: false, hit: null, blockedBy: null });
  });

  it("folds the none-words the same way (a spelling variant is still blocked)", () => {
    expect(hit("info + بكم", ["info"], "prefix", ["بکم"]).matched).toBe(false);
  });
});

describe("compiling keywords", () => {
  it("drops a keyword that is only punctuation and one that repeats after folding", () => {
    expect(compileKeyword("؟؟؟")).toBeNull();
    expect(compileKeywords(["Info", "INFO", "info!", "؟", "price"]).map((k) => k.source)).toEqual(["Info", "price"]);
  });
});

describe("matchTrigger: channel, platform, voice", () => {
  it("fires on the channel and platform it names", () => {
    expect(matchTrigger(trigger(), input())).toEqual({ ok: true, matched: "info" });
    expect(matchTrigger(trigger(), input({ channel: "dm" }))).toEqual({ ok: false, reason: "wrong_channel" });
    expect(matchTrigger(trigger(), input({ platform: "META_INSTAGRAM" })).ok).toBe(true);
    expect(matchTrigger(trigger({ platforms: ["META_INSTAGRAM"] }), input())).toEqual({ ok: false, reason: "wrong_platform" });
    expect(matchTrigger(trigger({ channel: "dm", platforms: ["WHATSAPP"] }), input({ channel: "dm", platform: "WHATSAPP" })).ok).toBe(true);
  });

  it("does not take a voice note unless the trigger says so", () => {
    expect(matchTrigger(trigger(), input({ viaVoice: true }))).toEqual({ ok: false, reason: "voice" });
    expect(matchTrigger(trigger({ viaVoice: true }), input({ viaVoice: true })).ok).toBe(true);
    expect(matchTrigger(trigger({ viaVoice: true }), input()).ok).toBe(true);
  });
});

describe("matchTrigger: keywords and labels", () => {
  it("says which keyword matched, or why none did", () => {
    expect(matchTrigger(trigger(), input({ text: "hello" }))).toEqual({ ok: false, reason: "no_keyword" });
    expect(matchTrigger(trigger({ keywords: { any: ["info"], none: ["price"], mode: "prefix" } }), input({ text: "info price" }))).toEqual({ ok: false, reason: "blocked_word" });
  });

  it("matches the classifier's topic, type and language without any keyword", () => {
    const t = trigger({ keywords: undefined, intents: ["price", "delivery"], types: ["QUESTION"], languages: ["ckb", "ar"] });
    expect(matchTrigger(t, input({ c: label() }))).toEqual({ ok: true, matched: "intent:price" });
    expect(matchTrigger(t, input({ c: label({ intent: "delivery", language: "ar" }) })).ok).toBe(true);
    expect(matchTrigger(t, input({ c: label({ intent: "hours" }) }))).toEqual({ ok: false, reason: "wrong_intent" });
    expect(matchTrigger(t, input({ c: label({ type: "PRAISE", intent: "price" }) }))).toEqual({ ok: false, reason: "wrong_type" });
    expect(matchTrigger(t, input({ c: label({ language: "en" }) }))).toEqual({ ok: false, reason: "wrong_language" });
  });

  it("a trigger that reads labels cannot match a message with none", () => {
    expect(matchTrigger(trigger({ keywords: undefined, intents: ["price"] }), input({ c: null }))).toEqual({ ok: false, reason: "no_label" });
    // ...while a keyword-only trigger does not care
    expect(matchTrigger(trigger(), input({ c: null })).ok).toBe(true);
  });

  it("with keywords and labels both must hold, and the owner's keyword is what is reported", () => {
    const t = trigger({ intents: ["price"] });
    expect(matchTrigger(t, input({ c: label() }))).toEqual({ ok: true, matched: "info" });
    expect(matchTrigger(t, input({ c: label({ intent: "delivery" }) }))).toEqual({ ok: false, reason: "wrong_intent" });
    expect(matchTrigger(t, input({ text: "hello", c: label() }))).toEqual({ ok: false, reason: "no_keyword" });
  });

  it("a type-only trigger reports the type", () => {
    expect(matchTrigger(trigger({ keywords: undefined, types: ["PRAISE"] }), input({ c: label({ type: "PRAISE", intent: "none" }) }))).toEqual({ ok: true, matched: "type:PRAISE" });
  });
});

describe("trigger shape helpers", () => {
  it("knows whether a trigger needs the classifier's label", () => {
    expect(needsLabel(trigger())).toBe(false);
    expect(needsLabel(trigger({ intents: ["price"] }))).toBe(true);
    expect(needsLabel(trigger({ languages: ["en"] }))).toBe(true);
  });

  it("counts conditions: the more specific trigger counts higher", () => {
    expect(conditionCount(trigger())).toBe(1);
    expect(conditionCount(trigger({ keywords: { any: ["a"], none: ["b"], mode: "prefix" } }))).toBe(2);
    expect(conditionCount(trigger({ intents: ["price"], types: ["QUESTION"] }))).toBe(3);
    expect(conditionCount(trigger({ keywords: undefined, intents: ["price"] }))).toBe(1);
  });
});
