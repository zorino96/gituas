import { describe, expect, it } from "vitest";

import { pickRule, type PickInput, type RuleRecord } from "@/lib/shop/rules/engine";
import { prepareText } from "@/lib/shop/rules/match";
import { isStopRequest } from "@/lib/shop/rules/optout";
import { reasonText } from "@/lib/shop/rules/render";
import { RuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";
import { SKIP_REASONS } from "@/lib/shop/rules/types";

// A message that tells the shop to stop writing never gets a canned rule reply. The phrases are matched as whole words on the folded
// text, so a spelling difference does not hide a stop request and a word inside another sentence does not make one.

describe("isStopRequest: who is asking to be left alone", () => {
  it("hears it in English", () => {
    for (const t of [
      "stop messaging me about the price", "STOP", "Stop!", "please stop", "Stop texting me", "I want to unsubscribe", "opt out please",
      "don't message me again", "Dont contact me", "do not send me anything", "leave me alone", "remove me from your list", "no more messages", "enough",
    ]) {
      expect(isStopRequest(t), t).toBe(true);
    }
  });

  it("hears it in Sorani", () => {
    for (const t of [
      "بەس بکە", "پەیام مەنێرە بۆم", "ئیتر مەنووسە", "وازم لێ بێنە", "بەس", "بوەستە", "دەست هەڵگرە لە نرخ", "نامەوێت پەیام بۆ بنێریت", "وازم لێبێنە ئیتر",
    ]) {
      expect(isStopRequest(t), t).toBe(true);
    }
  });

  it("hears it in Arabic, with either spelling of yeh and kaf", () => {
    for (const t of ["لا ترسل لي رسائل", "لا تراسلني", "توقف عن إرسال الرسائل", "توقف", "كفى", "ايقاف الرسائل", "الغاء الاشتراك", "اتركني", "دعني وشأني", "لا اريد رسائل", "لا تكلمني"]) {
      expect(isStopRequest(t), t).toBe(true);
    }
    // the Persian letters people type on a Kurdish keyboard fold to the same word
    expect(isStopRequest("لا تراسلنی")).toBe(true);
    expect(isStopRequest("لا ترسل لی")).toBe(true);
  });

  it("hears it in Kurdish written with Latin letters (Sorani and Badini)", () => {
    for (const t of ["bes bke", "Bes", "peyam menere", "wazm le bene", "dest ji min berde", "dev ji min berde", "mesaj neşîne", "nenivîse", "ez naxwazim mesaj", "bas e"]) {
      expect(isStopRequest(t), t).toBe(true);
    }
  });

  it("does not hear it in an ordinary sentence: a common word counts only as the whole message", () => {
    for (const t of [
      "bus stop near the shop", "non-stop delivery?", "stop by tomorrow", "does the shop stop selling it?", "I cannot stop looking at this dress", "enough stock?",
      "نرخی ئەوە چەندە", "بەس ئەوەندە نرخەکەی چەندە", "ئەمە بەس نییە", "توقف السيارة أمام المحل", "كفى الله شر الغلاء", "كم السعر", "bes e dixwazim", "send me the price",
      "", "   ", "😍",
    ]) {
      expect(isStopRequest(t), JSON.stringify(t)).toBe(false);
    }
  });

  it("takes a text that was already folded and split (the engine folds once)", () => {
    expect(isStopRequest(prepareText("Stop messaging me!"))).toBe(true);
    expect(isStopRequest(prepareText("how much is the red one"))).toBe(false);
  });

  it("looks at no more than the folded length: a huge text costs nothing special", () => {
    expect(isStopRequest("hello ".repeat(100_000))).toBe(false);
  });
});

describe("the engine: a stop request never gets a canned reply", () => {
  const spec = (over: Record<string, unknown> = {}): RuleSpecT =>
    RuleSpec.parse({
      v: 1,
      name: "price info",
      trigger: { channel: "dm", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["price"] } },
      actions: [{ do: "reply", texts: { default: "The price list is on our page." } }],
      examples: [{ text: "price", match: true }, { text: "hello", match: false }],
      ...over,
    });
  const rec = (over: Record<string, unknown> = {}): RuleRecord => ({ id: "r1", version: 1, priority: 100, createdAt: new Date(2026, 0, 1), spec: spec(over) });
  const input = (text: string, over: Partial<PickInput> = {}): PickInput => ({
    channel: "dm", platform: "META_FACEBOOK", text, viaVoice: false, c: { type: "OTHER", intent: "none", language: "en", confidence: 0.9 },
    canPrivateReply: true, privateReplyUsed: false, limited: false, hasProductCard: false, orderInProgress: false, usage: {}, senderRepliesLastHour: 0, ...over,
  });

  it("holds the reply back with the reason opt_out, in the log, in all three languages", () => {
    const out = pickRule(input("stop messaging me about the price"), [rec()]);
    expect(out.reply).toBeNull();
    expect(out.fired).toEqual([]);
    expect(out.trace[0]).toMatchObject({ outcome: "skipped", matched: "price", did: [], reasons: ["opt_out"] });
    expect(SKIP_REASONS).toContain("opt_out");
    for (const lang of ["ckb", "ar", "en"] as const) expect(reasonText("opt_out", lang)).not.toBe("opt_out");
  });

  it("answers the same rule when the person is not asking to stop", () => {
    expect(pickRule(input("what is the price"), [rec()]).reply?.text).toBe("The price list is on our page.");
  });

  it("applies to a comment rule as well, whatever language the stop is in", () => {
    const comment = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["نرخ"] } }, examples: [{ text: "نرخ", match: true }, { text: "hello", match: false }] });
    expect(pickRule(input("نرخ؟ بەس بکە", { channel: "comment" }), [comment]).trace[0].reasons).toEqual(["opt_out"]);
    expect(pickRule(input("نرخ چەندە", { channel: "comment" }), [comment]).reply).not.toBeNull();
  });

  it("is only about replying: a rule that flags the owner still does, and the reply of a rule that does both is the part held back", () => {
    const both = rec({ actions: [{ do: "reply", texts: { default: "The price list is on our page." } }, { do: "flag_owner", note: "look" }] });
    const out = pickRule(input("stop messaging me about the price"), [both]);
    expect(out.reply).toBeNull();
    expect(out.flag).toBe(true);
    expect(out.trace[0]).toMatchObject({ outcome: "fired", did: ["flag_owner"], reasons: ["opt_out"] });
    const flagOnly = rec({ actions: [{ do: "flag_owner" }] });
    expect(pickRule(input("stop messaging me about the price"), [flagOnly]).flag).toBe(true);
  });

  it("a rule that does not match the message does not log an opt-out", () => {
    expect(pickRule(input("stop messaging me"), [rec()]).trace[0]).toMatchObject({ outcome: "no_match", reasons: ["no_keyword"] });
  });

  it("looks at the message once, however many rules reply", () => {
    const second = { ...rec(), id: "r2" };
    const out = pickRule(input("stop messaging me about the price"), [rec(), second]);
    expect(out.trace.map((t) => t.reasons)).toEqual([["opt_out"], ["opt_out"]]);
  });
});
