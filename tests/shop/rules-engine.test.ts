import { describe, expect, it } from "vitest";

import type { Classification } from "@/lib/shop/policy";
import { orderRules, pickRule, pickText, type PickInput, type RuleRecord } from "@/lib/shop/rules/engine";
import { RuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";

const label = (over: Partial<Classification> = {}): Classification => ({ type: "OTHER", intent: "none", language: "ckb", confidence: 0.9, ...over });
const price = (over: Partial<Classification> = {}) => label({ type: "QUESTION", intent: "price", ...over });

/** A rule spec. By default: a comment rule on the word "info" that replies. Examples are filler: the engine does not run them. */
function spec(over: Record<string, unknown> = {}): RuleSpecT {
  return RuleSpec.parse({
    v: 1,
    name: "info",
    trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info"] } },
    actions: [{ do: "reply", texts: { default: "default text", ar: "arabic text", en: "english text", ckb: "sorani text" } }],
    examples: [{ text: "info", match: true }, { text: "hello", match: false }],
    ...over,
  });
}

let n = 0;
function rec(over: Record<string, unknown> = {}, meta: Partial<Omit<RuleRecord, "spec">> = {}): RuleRecord {
  n += 1;
  return { id: `r${n}`, version: 1, priority: 100, createdAt: new Date(2026, 0, n), spec: spec(over), ...meta };
}

function input(over: Partial<PickInput> = {}): PickInput {
  return {
    channel: "comment", platform: "META_FACEBOOK", text: "info please", viaVoice: false, c: label(),
    canPrivateReply: true, privateReplyUsed: false, limited: false, hasProductCard: false, orderInProgress: false,
    usage: {}, senderRepliesLastHour: 0, ...over,
  };
}

const flagRule = (over: Record<string, unknown> = {}, meta: Partial<Omit<RuleRecord, "spec">> = {}) => rec({ actions: [{ do: "flag_owner" }], ...over }, meta);
const traceOf = (r: ReturnType<typeof pickRule>, id: string) => r.trace.find((t) => t.ruleId === id)!;

describe("pickRule: a reply", () => {
  it("answers a matching comment with the owner's text, as a private reply", () => {
    const r = rec();
    const out = pickRule(input({ c: label({ language: "ar" }) }), [r]);
    expect(out.reply).toEqual({
      ruleId: r.id, ruleVersion: 1, matched: "info", channel: "private", text: "arabic text", lang: "ar", textLang: "ar", publicLine: "standard",
    });
    expect(out.fired).toEqual([{ ruleId: r.id, ruleVersion: 1, matched: "info", did: ["reply"] }]);
    expect(out.flag).toBe(false);
    expect(out.pause).toBe(false);
  });

  it("answers a matching DM in the chat, with no public line", () => {
    const r = rec({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } });
    const out = pickRule(input({ channel: "dm", platform: "WHATSAPP" }), [r]);
    expect(out.reply).toMatchObject({ channel: "dm", publicLine: "none", text: "sorani text" });
  });

  it("can leave out the standard public line of a comment", () => {
    const r = rec({ actions: [{ do: "reply", publicLine: "none", texts: { default: "x" } }] });
    expect(pickRule(input(), [r]).reply?.publicLine).toBe("none");
  });

  it("does nothing when no rule matches, and says why for each rule", () => {
    const a = rec();
    const b = rec({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } });
    const out = pickRule(input({ text: "hello" }), [a, b]);
    expect(out).toMatchObject({ reply: null, flag: false, pause: false, fired: [], waiting: [] });
    expect(traceOf(out, a.id)).toMatchObject({ outcome: "no_match", reasons: ["no_keyword"], matched: null, did: [] });
    expect(traceOf(out, b.id)).toMatchObject({ outcome: "no_match", reasons: ["wrong_channel"] });
  });

  it("reports the owner's keyword, not the buyer's text", () => {
    const r = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["Zanyari", "معلومات"] } } });
    expect(pickRule(input({ text: "zanyarim dewet!!" }), [r]).reply?.matched).toBe("Zanyari");
  });
});

describe("pickRule: which text, in which language", () => {
  const texts = { default: "D", ckb: "C", ar: "A", en: "E" };
  it("uses the text of the buyer's language", () => {
    expect(pickText(texts, "ar")).toEqual({ text: "A", textLang: "ar" });
    expect(pickText(texts, "en")).toEqual({ text: "E", textLang: "en" });
    expect(pickText(texts, "ckb")).toEqual({ text: "C", textLang: "ckb" });
  });
  it("gives a Badini reader the Sorani text, else the default", () => {
    expect(pickText(texts, "kmr")).toEqual({ text: "C", textLang: "ckb" });
    expect(pickText({ default: "D", ar: "A" }, "kmr")).toEqual({ text: "D", textLang: "default" });
  });
  it("gives a reader of Latin Kurdish the default, not the Arabic-script text", () => {
    expect(pickText(texts, "ku_latn")).toEqual({ text: "D", textLang: "default" });
    expect(pickText({ default: "D", ku_latn: "K" }, "ku_latn")).toEqual({ text: "K", textLang: "ku_latn" });
  });
  it("falls back to the default when there is no text for the language or no language", () => {
    expect(pickText({ default: "D" }, "en")).toEqual({ text: "D", textLang: "default" });
    expect(pickText(texts, null)).toEqual({ text: "D", textLang: "default" });
  });
});

describe("pickRule: selection order and one reply per message", () => {
  it("orders by priority, then by how specific the trigger is, then by age, then by id", () => {
    const lowOld = rec({}, { priority: 10, createdAt: new Date(2020, 0, 1) });
    const highNew = rec({}, { priority: 200, createdAt: new Date(2026, 5, 1) });
    const midGeneral = rec({}, { priority: 100, createdAt: new Date(2021, 0, 1) });
    const midSpecific = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"], none: ["zzz"] } } }, { priority: 100, createdAt: new Date(2025, 0, 1) });
    const midSpecificOlder = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"], none: ["yyy"] } } }, { priority: 100, createdAt: new Date(2024, 0, 1) });
    const ids = orderRules([lowOld, midGeneral, highNew, midSpecific, midSpecificOlder]).map((r) => r.id);
    expect(ids).toEqual([highNew.id, midSpecificOlder.id, midSpecific.id, midGeneral.id, lowOld.id]);
    const same1 = rec({}, { id: "a", createdAt: new Date(2000, 0, 1) });
    const same2 = rec({}, { id: "b", createdAt: new Date(2000, 0, 1) });
    expect(orderRules([same2, same1]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sends ONE reply however many rules match: the first in order, the others are told why not", () => {
    const first = rec({ actions: [{ do: "reply", texts: { default: "FIRST" } }] }, { priority: 200 });
    const second = rec({ actions: [{ do: "reply", texts: { default: "SECOND" } }] }, { priority: 100 });
    const out = pickRule(input(), [second, first]);
    expect(out.reply?.text).toBe("FIRST");
    expect(out.fired.map((f) => f.ruleId)).toEqual([first.id]);
    expect(traceOf(out, second.id)).toMatchObject({ outcome: "skipped", reasons: ["reply_taken"], did: [] });
    expect(out.trace.map((t) => t.ruleId)).toEqual([first.id, second.id]);
  });

  it("lets a later rule reply when the first one's reply was held back", () => {
    const capped = rec({ actions: [{ do: "reply", texts: { default: "CAPPED" } }] }, { priority: 200 });
    const other = rec({ actions: [{ do: "reply", texts: { default: "OTHER" } }] }, { priority: 100 });
    const out = pickRule(input({ usage: { [capped.id]: { today: 0, personToday: 1 } } }), [capped, other]);
    expect(out.reply?.text).toBe("OTHER");
    expect(traceOf(out, capped.id)).toMatchObject({ outcome: "skipped", reasons: ["cap_person"] });
  });

  it("merges the flags and pauses of every matching rule, once, with their notes deduplicated", () => {
    const a = rec();
    const f1 = flagRule({ actions: [{ do: "flag_owner", note: "look at this" }] });
    const f2 = flagRule({ actions: [{ do: "flag_owner", note: "look at this" }] });
    const f3 = flagRule({ actions: [{ do: "flag_owner", note: "second note" }, { do: "pause_thread" }] });
    const out = pickRule(input(), [a, f1, f2, f3]);
    expect(out.reply).not.toBeNull();
    expect(out.flag).toBe(true);
    expect(out.flagNotes).toEqual(["look at this", "second note"]);
    expect(out.pause).toBe(true);
    expect(out.fired).toHaveLength(4);
  });

  it("one rule can reply, flag and pause", () => {
    const r = rec({ actions: [{ do: "reply", texts: { default: "x" } }, { do: "flag_owner" }, { do: "pause_thread" }] });
    const out = pickRule(input(), [r]);
    expect(out.fired[0].did).toEqual(["reply", "flag_owner", "pause_thread"]);
    expect(out.reply && out.flag && out.pause).toBeTruthy();
  });

  it("a pause that comes with a reply is only applied when the reply is sent", () => {
    const r = rec({ actions: [{ do: "reply", texts: { default: "x" } }, { do: "pause_thread" }] });
    const out = pickRule(input({ c: label({ type: "COMPLAINT" }) }), [r]);
    expect(out.pause).toBe(false);
    expect(traceOf(out, r.id)).toMatchObject({ outcome: "skipped", did: [], reasons: ["never_answered", "pause_needs_reply"] });
    // a pause on its own acts as soon as the trigger matches
    const alone = rec({ actions: [{ do: "pause_thread" }] });
    expect(pickRule(input({ c: label({ type: "COMPLAINT" }) }), [alone]).pause).toBe(true);
  });
});

describe("pickRule: what a rule never answers in words", () => {
  it("needs a label: no label, no canned reply (a flag still works)", () => {
    const r = rec();
    const f = flagRule();
    const out = pickRule(input({ c: null }), [r, f]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id)).toMatchObject({ outcome: "skipped", reasons: ["reply_needs_label"], matched: "info" });
    expect(out.flag).toBe(true);
  });

  it("never answers a complaint, abuse or spam, whatever words they contain", () => {
    for (const type of ["COMPLAINT", "ABUSE", "SPAM"] as const) {
      const r = rec();
      const out = pickRule(input({ c: label({ type, confidence: 0.99 }) }), [r]);
      expect(out.reply, type).toBeNull();
      expect(traceOf(out, r.id).reasons, type).toEqual(["never_answered"]);
    }
  });

  it("does not answer an order: Gituas collects orders itself", () => {
    const r = rec();
    const out = pickRule(input({ text: "info, I want to order", c: label({ type: "ORDER", confidence: 0.95 }) }), [r]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id)).toMatchObject({ outcome: "skipped", reasons: ["order_flow"] });
    // even a doubtful order label is left to Gituas
    expect(pickRule(input({ c: label({ type: "ORDER", confidence: 0.3 }) }), [rec()]).reply).toBeNull();
  });

  it("doubts a rule that rests on the label when the label is uncertain, but not one that rests on words", () => {
    const byLabel = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], intents: ["price"] }, examples: [{ text: "چەندە", match: true }, { text: "hello", match: false }] });
    const out = pickRule(input({ text: "x", c: price({ confidence: 0.59 }) }), [byLabel]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, byLabel.id)).toMatchObject({ outcome: "skipped", reasons: ["low_confidence"] });
    expect(pickRule(input({ text: "x", c: price({ confidence: 0.6 }) }), [byLabel]).reply).not.toBeNull();
    const byWord = rec();
    expect(pickRule(input({ c: label({ confidence: 0.4 }) }), [byWord]).reply).not.toBeNull();
  });

  it("does not answer a voice note unless the rule says voice notes count (and a reply never says so)", () => {
    const r = rec();
    const f = flagRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, viaVoice: true } });
    const out = pickRule(input({ viaVoice: true }), [r, f]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id)).toMatchObject({ outcome: "no_match", reasons: ["voice"] });
    expect(out.flag).toBe(true);
  });

  it("does not answer an author who was already answered today", () => {
    const r = rec();
    const f = flagRule();
    const out = pickRule(input({ limited: true }), [r, f]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id).reasons).toEqual(["limited"]);
    expect(out.flag).toBe(true);
  });
});

describe("pickRule: Meta's windows", () => {
  it("a comment needs the private-reply window (7 days) and only one private reply per comment", () => {
    const r = rec();
    const closed = pickRule(input({ canPrivateReply: false }), [r]);
    expect(closed.reply).toBeNull();
    expect(traceOf(closed, r.id).reasons).toEqual(["private_window"]);
    const used = pickRule(input({ privateReplyUsed: true }), [r]);
    expect(used.reply).toBeNull();
    expect(traceOf(used, r.id).reasons).toEqual(["private_reply_used"]);
  });

  it("a DM is not held by those facts (the buyer wrote to us, inside the 24 hours)", () => {
    const r = rec({ trigger: { channel: "dm", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] } } });
    expect(pickRule(input({ channel: "dm", canPrivateReply: false, privateReplyUsed: true }), [r]).reply).not.toBeNull();
  });

  it("a flag does not need a window", () => {
    expect(pickRule(input({ canPrivateReply: false }), [flagRule()]).flag).toBe(true);
  });
});

describe("pickRule: the product card and an order in progress", () => {
  it("keeps the product card by default: the rule does not reply where a card answers", () => {
    const r = rec();
    const out = pickRule(input({ hasProductCard: true }), [r]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id).reasons).toEqual(["product_card"]);
  });

  it("replaces the card when the owner chose to", () => {
    const r = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, productCard: "replace" } });
    expect(pickRule(input({ hasProductCard: true }), [r]).reply?.text).toBe("sorani text");
  });

  it("a flag still fires on a thread with a card", () => {
    expect(pickRule(input({ hasProductCard: true }), [flagRule()]).flag).toBe(true);
  });

  it("never interrupts an order that is being collected: nothing fires, replies and flags alike", () => {
    const r = rec();
    const f = flagRule();
    const unrelated = rec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["zzz"] } } });
    const out = pickRule(input({ orderInProgress: true }), [r, f, unrelated]);
    expect(out).toMatchObject({ reply: null, flag: false, pause: false, fired: [] });
    expect(traceOf(out, r.id).reasons).toEqual(["order_in_progress"]);
    expect(traceOf(out, f.id).reasons).toEqual(["order_in_progress"]);
    expect(traceOf(out, unrelated.id)).toMatchObject({ outcome: "no_match", reasons: ["no_keyword"] });
  });
});

describe("pickRule: limits", () => {
  it("stops a rule that has reached its daily limit", () => {
    const r = rec({ limits: { perPersonPerDay: 1, perDay: 5 } });
    const out = pickRule(input({ usage: { [r.id]: { today: 5, personToday: 0 } } }), [r]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id)).toMatchObject({ outcome: "skipped", reasons: ["cap_rule_day"] });
    expect(pickRule(input({ usage: { [r.id]: { today: 4, personToday: 0 } } }), [r]).reply).not.toBeNull();
  });

  it("stops a rule for a person who already had its answer today, as many times as the owner allowed", () => {
    const once = rec();
    expect(traceOf(pickRule(input({ usage: { [once.id]: { today: 1, personToday: 1 } } }), [once]), once.id).reasons).toEqual(["cap_person"]);
    const twice = rec({ limits: { perPersonPerDay: 2, perDay: 50 } });
    expect(pickRule(input({ usage: { [twice.id]: { today: 1, personToday: 1 } } }), [twice]).reply).not.toBeNull();
    expect(pickRule(input({ usage: { [twice.id]: { today: 2, personToday: 2 } } }), [twice]).reply).toBeNull();
  });

  it("a capped flag rule does not flag", () => {
    const f = flagRule({ limits: { perPersonPerDay: 1, perDay: 50 } });
    expect(pickRule(input({ usage: { [f.id]: { today: 1, personToday: 1 } } }), [f]).flag).toBe(false);
  });

  it("stops replying to a sender who already got three rule replies this hour", () => {
    const r = rec();
    expect(pickRule(input({ senderRepliesLastHour: 2 }), [r]).reply).not.toBeNull();
    const out = pickRule(input({ senderRepliesLastHour: 3 }), [r]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, r.id).reasons).toEqual(["cap_sender_hour"]);
  });
});

describe("pickRule: rules that wait", () => {
  it("hands a matching timer rule to the sweep instead of acting now", () => {
    const w = rec({
      trigger: { channel: "dm", platforms: ["META_FACEBOOK"], intents: ["price"], types: ["QUESTION"] },
      wait: { unansweredMinutes: 10 },
      actions: [{ do: "flag_owner", note: "no answer" }],
      examples: [{ text: "چەندە", match: true }, { text: "hello", match: false }],
    });
    const out = pickRule(input({ channel: "dm", c: price() }), [w]);
    expect(out.waiting).toEqual([{ ruleId: w.id, ruleVersion: 1, matched: "intent:price", minutes: 10 }]);
    expect(out).toMatchObject({ flag: false, fired: [] });
    expect(traceOf(out, w.id)).toMatchObject({ outcome: "waiting", matched: "intent:price" });
    // a different topic does not start the timer
    expect(pickRule(input({ channel: "dm", c: price({ intent: "delivery" }) }), [w]).waiting).toEqual([]);
  });
});

describe("pickRule: the owner's three sentences", () => {
  const dmPrice = rec({
    name: "price asked: tell delivery",
    trigger: { channel: "dm", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], intents: ["price"], types: ["QUESTION"] },
    actions: [{ do: "reply", texts: { default: "Delivery 5,000 IQD, 1-3 days.", ckb: "گەیاندن ٥٠٠٠ دینار، ١ بۆ ٣ ڕۆژ." } }],
    examples: [{ text: "چەندە", match: true }, { text: "hello", match: false }],
  });
  const infoComment = rec({
    name: "info comment",
    trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info", "زانیاری"] } },
    actions: [{ do: "reply", texts: { default: "Here are the details." } }],
  });
  const orderRule = rec({
    name: "order words",
    trigger: { channel: "dm", platforms: ["META_FACEBOOK"], keywords: { any: ["order", "want", "دەمەوێت"] } },
    actions: [{ do: "reply", texts: { default: "Please send name, phone, address." } }],
  });

  it("a price question in a DM gets the delivery text", () => {
    const out = pickRule(input({ channel: "dm", text: "چەندە؟", c: price() }), [dmPrice, infoComment, orderRule]);
    expect(out.reply).toMatchObject({ ruleId: dmPrice.id, text: "گەیاندن ٥٠٠٠ دینار، ١ بۆ ٣ ڕۆژ.", channel: "dm" });
  });

  it("an 'info' comment gets the details", () => {
    const out = pickRule(input({ text: "Info?" }), [dmPrice, infoComment, orderRule]);
    expect(out.reply).toMatchObject({ ruleId: infoComment.id, text: "Here are the details.", channel: "private", matched: "info" });
  });

  it("'I want to order' is not answered by a canned reply: order collection is the pipeline's job", () => {
    const out = pickRule(input({ channel: "dm", text: "I want to order", c: label({ type: "ORDER", language: "en" }) }), [dmPrice, infoComment, orderRule]);
    expect(out.reply).toBeNull();
    expect(traceOf(out, orderRule.id)).toMatchObject({ outcome: "skipped", matched: "order", reasons: ["order_flow"] });
  });
});
