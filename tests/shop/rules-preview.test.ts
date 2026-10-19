import { describe, expect, it } from "vitest";

import { classifyByRules } from "@/lib/shop/classify-rules";
import type { Classification } from "@/lib/shop/policy";
import { backtestIssue, backtestRule, evaluateExamples, guessLanguage, previewRule, type StoredMessage } from "@/lib/shop/rules/preview";
import { RuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";

// The owner's three sentences, as rules.
// 1. "when someone asks the price, tell them about delivery"
const PRICE_RULE = RuleSpec.parse({
  v: 1,
  name: "delivery after a price question",
  trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], intents: ["price"], types: ["QUESTION"] },
  actions: [
    {
      do: "reply",
      texts: {
        default: "Delivery to every city, 1-3 days.",
        ckb: "گەیاندن بۆ هەموو شارەکان، ١ بۆ ٣ ڕۆژ.",
        ar: "التوصيل لكل المحافظات، من ١ إلى ٣ أيام.",
        en: "Delivery to every city, 1-3 days.",
      },
    },
  ],
  examples: [
    { text: "چەندە؟", match: true },
    { text: "بكم", match: true },
    { text: "price?", match: true },
    { text: "زۆر جوانە", match: false },
  ],
});

// 2. "when someone comments info, send them the details"
const INFO_RULE = RuleSpec.parse({
  v: 1,
  name: "info comment",
  trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info", "زانیاری", "معلومات"] } },
  actions: [{ do: "reply", texts: { default: "Here are the details of everything we sell." } }],
  examples: [{ text: "info", match: true }, { text: "Info please", match: true }, { text: "زانیاری؟", match: true }, { text: "very nice", match: false }],
});

// 3. a rule that words "I want to order" but must never answer an order
const ORDER_WORDS_RULE = RuleSpec.parse({
  v: 1,
  name: "order words",
  trigger: { channel: "dm", platforms: ["META_FACEBOOK", "WHATSAPP"], keywords: { any: ["order", "want", "دەمەوێت"] } },
  actions: [{ do: "reply", texts: { default: "Please send your name, phone and address." } }],
  examples: [{ text: "my order", match: false, as: { type: "ORDER", language: "en" } }, { text: "hello", match: false }, { text: "want a discount", match: true, as: { type: "NEGOTIATION" } }],
});

const rowOf = (spec: RuleSpecT, text: string, as?: Partial<Classification>) => previewRule(spec, [{ text, as }]).rows.at(-1)!;

describe("previewRule: the three sentences", () => {
  it("a price question gets the delivery text, in the language it was asked in", () => {
    const ckb = rowOf(PRICE_RULE, "چەندە؟");
    expect(ckb).toMatchObject({ triggered: true, matches: true, labelSource: "classifier", reasons: [] });
    expect(ckb.sends).toEqual({ text: "گەیاندن بۆ هەموو شارەکان، ١ بۆ ٣ ڕۆژ.", textLang: "ckb", lang: "ckb", channel: "private", publicLine: "standard" });
    expect(rowOf(PRICE_RULE, "بكم").sends).toMatchObject({ text: "التوصيل لكل المحافظات، من ١ إلى ٣ أيام.", textLang: "ar" });
    expect(rowOf(PRICE_RULE, "How much?").sends).toMatchObject({ text: "Delivery to every city, 1-3 days.", textLang: "en" });
  });

  it("a message that is not a plain price question cannot be judged offline: it says so", () => {
    const r = rowOf(PRICE_RULE, "سوپاس");
    expect(r).toMatchObject({ triggered: false, matches: false, label: null, labelSource: "none", sends: null, reasons: ["no_label"] });
    // ...unless the example says which label to assume
    const assumed = rowOf(PRICE_RULE, "نرخی ئەو دووانە چەندە و کەی دەگات", { type: "QUESTION", intent: "price", language: "ckb" });
    expect(assumed).toMatchObject({ matches: true, labelSource: "declared" });
  });

  it("an 'info' comment gets the details, whatever the capital letters and punctuation", () => {
    for (const text of ["info", "Info please", "INFO!!", "زانیاری؟", "بۆ زانیاریم بنێرە"]) {
      const r = rowOf(INFO_RULE, text);
      expect(r.matches, text).toBe(true);
      expect(r.sends?.text, text).toBe("Here are the details of everything we sell.");
      expect(r.sends?.channel).toBe("private");
      expect(r.labelSource, text).toBe("assumed");
    }
    expect(rowOf(INFO_RULE, "very nice 😍")).toMatchObject({ matches: false, triggered: false, sends: null, reasons: ["no_keyword"] });
  });

  it("'I want to order' is NOT answered by a canned reply: order collection is the pipeline's job", () => {
    const r = rowOf(ORDER_WORDS_RULE, "I want to order", { type: "ORDER", intent: "none", language: "en", confidence: 0.95 });
    expect(r).toMatchObject({ triggered: true, matches: false, sends: null, reasons: ["order_flow"], labelSource: "declared" });
    // the same words as a haggle are answered
    expect(rowOf(ORDER_WORDS_RULE, "I want a discount", { type: "NEGOTIATION" }).sends?.text).toBe("Please send your name, phone and address.");
  });
});

describe("previewRule: the declared examples", () => {
  it("runs them first and says whether each behaves as declared", () => {
    const r = previewRule(PRICE_RULE, ["extra sample"]);
    expect(r.rows).toHaveLength(5);
    expect(r.rows.slice(0, 4).every((x) => x.declared)).toBe(true);
    expect(r.rows[4]).toMatchObject({ declared: false, expected: null, ok: null, text: "extra sample" });
    expect(r.examplesOk).toBe(true);
    expect(r.failing).toEqual([]);
    expect(r.rows.map((x) => x.ok).slice(0, 4)).toEqual([true, true, true, true]);
  });

  it("lists the ones that do not", () => {
    const wrong = RuleSpec.parse({ ...INFO_RULE, examples: [{ text: "info", match: true }, { text: "address", match: true }, { text: "info please", match: false }, { text: "hello", match: false }] });
    const r = evaluateExamples(wrong);
    expect(r.examplesOk).toBe(false);
    expect(r.failing.map((f) => f.text)).toEqual(["address", "info please"]);
    expect(r.failing[0]).toMatchObject({ expected: true, matches: false });
    expect(r.failing[1]).toMatchObject({ expected: false, matches: true });
  });

  it("counts a rule that waits, flags or pauses as acting", () => {
    const timer = RuleSpec.parse({
      v: 1,
      name: "timer",
      trigger: { channel: "dm", platforms: ["WHATSAPP"], intents: ["price"], types: ["QUESTION"] },
      wait: { unansweredMinutes: 10 },
      actions: [{ do: "flag_owner" }],
      examples: [{ text: "چەندە؟", match: true }, { text: "سوپاس", match: false }],
    });
    const r = previewRule(timer);
    expect(r.examplesOk).toBe(true);
    expect(r.rows[0]).toMatchObject({ matches: true, waits: true, sends: null, flags: false });
    const flagPause = RuleSpec.parse({ ...INFO_RULE, actions: [{ do: "flag_owner" }, { do: "pause_thread" }] });
    expect(rowOf(flagPause, "info")).toMatchObject({ matches: true, flags: true, pauses: true, sends: null });
  });

  it("uses the channel and the first platform of the rule", () => {
    const dm = RuleSpec.parse({ ...INFO_RULE, trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } });
    expect(rowOf(dm, "info").sends).toMatchObject({ channel: "dm", publicLine: "none" });
  });
});

describe("previewRule: where the label comes from, and no model", () => {
  it("asks the classifier it was given, once per text, and nothing else", () => {
    const asked: string[] = [];
    const classify = (t: string): Classification | null => {
      asked.push(t);
      return t === "special" ? { type: "QUESTION", intent: "price", language: "en", confidence: 0.9 } : null;
    };
    const r = previewRule(PRICE_RULE, ["special", "other"], classify);
    expect(asked).toEqual([...PRICE_RULE.examples.map((e) => e.text), "special", "other"]);
    expect(r.rows.at(-2)).toMatchObject({ matches: true, labelSource: "classifier" });
    expect(r.rows.at(-1)).toMatchObject({ matches: false, labelSource: "none" });
  });

  it("uses the real rule-based classifier by default", () => {
    expect(rowOf(PRICE_RULE, "نرخی چەندە").label).toEqual(classifyByRules("نرخی چەندە"));
    expect(rowOf(INFO_RULE, "😍").label).toEqual(classifyByRules("😍"));
  });

  it("assumes an ordinary message for a rule that reads words only, in the script the text is written in", () => {
    expect(rowOf(INFO_RULE, "info").label).toMatchObject({ type: "OTHER", intent: "none", language: "en" });
    expect(rowOf(INFO_RULE, "نرخەکەی؟ زانیاری").label).toMatchObject({ language: "ckb" }); // Kurdish-only letters settle it
    expect(rowOf(INFO_RULE, "معلومات").label).toMatchObject({ language: "ar" });
  });

  it("lets a declared label override part of the real one", () => {
    const r = rowOf(PRICE_RULE, "چەندە؟", { intent: "delivery" });
    expect(r.label).toMatchObject({ type: "QUESTION", intent: "delivery", language: "ckb" });
    expect(r.matches).toBe(false);
    expect(r.reasons).toEqual(["wrong_intent"]);
  });

  it("guesses a language from the script", () => {
    expect(guessLanguage("hello")).toBe("en");
    expect(guessLanguage("چەندە")).toBe("ckb");
    expect(guessLanguage("كم السعر")).toBe("ar");
    expect(guessLanguage("😍")).toBe("ckb");
  });

  it("judges a sample under the conditions it is given", () => {
    const base = previewRule(INFO_RULE, [], undefined, {});
    expect(base.examplesOk).toBe(true);
    const card = previewRule(INFO_RULE, ["info"], undefined, { hasProductCard: true });
    expect(card.rows.at(-1)).toMatchObject({ matches: false, reasons: ["product_card"] });
    const late = previewRule(INFO_RULE, ["info"], undefined, { canPrivateReply: false });
    expect(late.rows.at(-1)).toMatchObject({ matches: false, reasons: ["private_window"] });
    const voice = previewRule(INFO_RULE, ["info"], undefined, { viaVoice: true });
    expect(voice.rows.at(-1)).toMatchObject({ matches: false, reasons: ["voice"] });
  });
});

describe("backtestRule: the shop's stored messages, labels already on them", () => {
  const stored = (id: string, text: string, over: Partial<StoredMessage> = {}): StoredMessage => ({
    id, text, channel: "comment", platform: "META_FACEBOOK", type: "OTHER", intent: "none", language: "en", confidence: 0.9, ...over,
  });

  it("counts what the rule would have answered and returns a few of them", () => {
    const messages = [
      stored("1", "info"),
      stored("2", "Info please"),
      stored("3", "send me information"),
      stored("4", "so beautiful"),
      stored("5", "how much", { type: "QUESTION", intent: "price" }),
      stored("6", "info", { channel: "dm" }),
      stored("7", "info", { platform: "WHATSAPP" }),
      stored("8", "info about the red one"),
    ];
    const b = backtestRule(INFO_RULE, messages, { maxExamples: 2 });
    expect(b.total).toBe(8);
    expect(b.considered).toBe(6); // the DM and the WhatsApp message are not for this rule
    expect(b.matched).toBe(4);
    expect(b.triggered).toBe(4);
    expect(b.share).toBeCloseTo(4 / 6);
    expect(b.examples).toEqual([{ id: "1", text: "info" }, { id: "2", text: "Info please" }]);
    expect(b.byReason).toEqual({ no_keyword: 2 });
  });

  it("reads the labels from the stored columns, and treats a missing one as no label", () => {
    const messages = [
      stored("1", "info", { type: null, intent: null, language: null, confidence: null }),
      stored("2", "info", { type: "COMPLAINT" }),
      stored("3", "info", { type: "ORDER" }),
      stored("4", "info", { type: "NOT_A_TYPE" }),
      stored("5", "info", { confidence: Number.NaN }),
      stored("6", "info"),
    ];
    const b = backtestRule(INFO_RULE, messages);
    expect(b.matched).toBe(1);
    expect(b.triggered).toBe(6);
    expect(b.byReason).toEqual({ reply_needs_label: 3, never_answered: 1, order_flow: 1 });
  });

  it("does not take a voice note for a rule that is not for voice notes", () => {
    const b = backtestRule(INFO_RULE, [stored("1", "info", { viaVoice: true }), stored("2", "info")]);
    expect(b.matched).toBe(1);
    expect(b.byReason).toEqual({ voice: 1 });
  });

  it("works on an empty list", () => {
    expect(backtestRule(INFO_RULE, [])).toMatchObject({ total: 0, considered: 0, matched: 0, share: 0, examples: [] });
  });

  it("returns buyers' words only in examples, as the owner's screen needs them", () => {
    const b = backtestRule(INFO_RULE, [stored("a1", "info")]);
    expect(JSON.stringify({ ...b, examples: [] })).not.toContain("info");
  });
});

describe("backtestIssue: too broad for the shop's real messages", () => {
  const result = (considered: number, matched: number) => ({ total: considered, considered, triggered: matched, matched, share: considered ? matched / considered : 0, examples: [], byReason: {} });

  it("says nothing on a small sample", () => {
    expect(backtestIssue(result(9, 9))).toBeNull();
    expect(backtestIssue(result(0, 0))).toBeNull();
  });
  it("says nothing up to 30 %", () => {
    expect(backtestIssue(result(100, 30))).toBeNull();
    expect(backtestIssue(result(100, 2))).toBeNull();
  });
  it("warns above 30 %", () => {
    expect(backtestIssue(result(100, 31))).toEqual({ code: "backtest_broad", level: "warning", params: { share: 31 } });
    expect(backtestIssue(result(100, 60))).toMatchObject({ code: "backtest_broad" });
  });
  it("refuses above 60 %", () => {
    expect(backtestIssue(result(100, 61))).toEqual({ code: "backtest_too_broad", level: "problem", params: { share: 61 } });
    expect(backtestIssue(result(10, 10))).toMatchObject({ code: "backtest_too_broad", level: "problem" });
  });
});
