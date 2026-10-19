import { describe, expect, it } from "vitest";

import { canonicalJson, normalise, parseRuleSpec, RuleSpec, specHash, type RuleSpecT } from "@/lib/shop/rules/spec";
import { evaluateExamples } from "@/lib/shop/rules/preview";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

/** The survey's sentence 2: "when someone comments info, send them our delivery details". */
const INFO_RULE = {
  v: 1,
  name: "زانیاری گەیاندن",
  trigger: {
    channel: "comment",
    platforms: ["META_FACEBOOK", "META_INSTAGRAM"],
    keywords: { any: ["info", "زانیاری", "معلومات", "پێزانین", "zanyari", "zaniari"], none: [], mode: "prefix" },
  },
  actions: [
    {
      do: "reply",
      publicLine: "standard",
      texts: {
        default: "سڵاو 🌷 گەیاندن بۆ هەموو شارەکان هەیە، ٥٠٠٠ دینار و ١ بۆ ٣ ڕۆژ. بۆ داواکردن لێرە بنووسە «دەمەوێت».",
        ar: "أهلاً 🌷 التوصيل لكل المحافظات، ٥٠٠٠ دينار وخلال ١-٣ أيام. للطلب اكتب «أريد» هنا.",
        en: "Hi 🌷 We deliver to every city: 5,000 IQD, 1-3 days. To order, write «I want it» here.",
      },
    },
  ],
  limits: { perPersonPerDay: 1, perDay: 50 },
  examples: [
    { text: "info", match: true },
    { text: "زانیاری؟", match: true },
    { text: "معلومات لطفا", match: true },
    { text: "zanyari", match: true },
    { text: "زۆر جوانە 😍", match: false },
    { text: "نرخی چەندە", match: false },
  ],
};

/** The survey's sentence 1: "price asked and I have not answered in 10 minutes, tell me". */
const TIMER_RULE = {
  v: 1,
  name: "نرخ بێ وەڵام",
  trigger: { channel: "dm", platforms: ["META_FACEBOOK", "META_INSTAGRAM", "WHATSAPP"], intents: ["price"], types: ["QUESTION"] },
  wait: { unansweredMinutes: 10 },
  actions: [{ do: "flag_owner", note: "کڕیار نرخی پرسیوە و ١٠ خولەکە وەڵام نەدراوەتەوە" }],
  limits: { perPersonPerDay: 1, perDay: 30 },
  examples: [
    { text: "چەندە؟", match: true },
    { text: "بكم؟", match: true },
    { text: "how much", match: true },
    { text: "سوپاس", match: false },
    { text: "کەی دەگات؟", match: false, as: { type: "QUESTION", intent: "delivery" } },
  ],
};

function rule(over: Record<string, unknown> = {}): RuleSpecT {
  return RuleSpec.parse({ ...INFO_RULE, ...over });
}
const bad = (over: Record<string, unknown>): string[] => {
  const r = parseRuleSpec({ ...INFO_RULE, ...over });
  if (r.ok) throw new Error("expected the rule to be rejected");
  return r.issues;
};

describe("RuleSpec v1: the worked examples", () => {
  it("accepts 'when someone comments info, send our delivery details' and its examples behave as declared", () => {
    const spec = rule();
    expect(spec.limits).toEqual({ perPersonPerDay: 1, perDay: 50 });
    expect(spec.trigger.keywords?.mode).toBe("prefix");
    expect(spec.trigger.viaVoice).toBe(false);
    expect(spec.trigger.productCard).toBe("keep");
    const r = evaluateExamples(spec);
    expect(r.failing.map((f) => f.text)).toEqual([]);
    expect(r.examplesOk).toBe(true);
  });

  it("accepts 'price asked and I have not answered in 10 minutes, tell me' and its examples behave as declared", () => {
    const spec = RuleSpec.parse(TIMER_RULE);
    expect(spec.wait).toEqual({ unansweredMinutes: 10 });
    expect(evaluateExamples(spec).failing.map((f) => f.text)).toEqual([]);
  });

  it("does not accept start_order_collection: it is not part of v1 (Gituas collects orders itself)", () => {
    const r = parseRuleSpec({ ...TIMER_RULE, wait: undefined, trigger: { channel: "dm", platforms: ["WHATSAPP"], types: ["ORDER"] }, actions: [{ do: "start_order_collection" }] });
    expect(r.ok).toBe(false);
  });

  it("fills the defaults: keywords mode, none-list, limits, voice, card", () => {
    const spec = RuleSpec.parse({ ...INFO_RULE, limits: undefined, trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] } } });
    expect(spec.trigger.keywords).toEqual({ any: ["info"], none: [], mode: "prefix" });
    expect(spec.limits).toEqual({ perPersonPerDay: 1, perDay: 50 });
  });
});

describe("RuleSpec v1: strict objects", () => {
  it("rejects a key that is not part of the language (a recipient, a time, a bulk send)", () => {
    for (const extra of [{ recipient: "all" }, { sendAt: "09:00" }, { schedule: "daily" }, { broadcast: true }]) {
      expect(parseRuleSpec({ ...INFO_RULE, ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
    const t = { ...INFO_RULE.trigger, sendTo: "followers" };
    expect(parseRuleSpec({ ...INFO_RULE, trigger: t }).ok).toBe(false);
    const a = [{ do: "reply", to: "everyone", texts: { default: "hi" } }];
    expect(parseRuleSpec({ ...INFO_RULE, actions: a }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "send_message", texts: { default: "hi" } }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, limits: { perDay: 50, perHour: 5 } }).ok).toBe(false);
  });

  it("only knows version 1", () => {
    expect(parseRuleSpec({ ...INFO_RULE, v: 2 }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, v: undefined }).ok).toBe(false);
  });

  it("cannot name complaints, abuse or spam as a type to answer", () => {
    for (const type of ["COMPLAINT", "ABUSE", "SPAM"]) {
      expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, types: [type] } }).ok, type).toBe(false);
    }
  });

  it("needs keywords, intents or types in the trigger", () => {
    const t = { channel: "dm", platforms: ["WHATSAPP"] };
    expect(parseRuleSpec({ ...INFO_RULE, trigger: t }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...t, languages: ["ar"] } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...t, types: ["PRAISE"] }, examples: [{ text: "😍", match: true }, { text: "info", match: false }] }).ok).toBe(true);
  });

  it("bounds the lists and the limits", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `word${i}x`);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: many(30) } } }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: many(31) } } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: ["info"], none: many(21) } } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: [] } } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, limits: { perPersonPerDay: 1, perDay: 200 } }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, limits: { perPersonPerDay: 1, perDay: 201 } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, limits: { perPersonPerDay: 4, perDay: 50 } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, limits: { perPersonPerDay: 0, perDay: 50 } }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, examples: [{ text: "info", match: true }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, examples: Array.from({ length: 13 }, (_, i) => ({ text: `t${i}`, match: i % 2 === 0 })) }).ok).toBe(false);
  });

  it("refuses a keyword that is only punctuation, empty, or longer than 40 characters", () => {
    for (const k of ["؟؟؟", "   ", "", "x".repeat(41)]) {
      expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: [k] } } }).ok, JSON.stringify(k)).toBe(false);
    }
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: ["x".repeat(40)] } } }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: ["🔥"] } } }).ok).toBe(true);
  });
});

describe("RuleSpec v1: the owner's fixed texts", () => {
  const withText = (text: string, lang: "default" | "ar" = "default") => ({
    actions: [{ do: "reply", texts: lang === "default" ? { default: text } : { default: "x", [lang]: text } }],
  });

  it("accepts a text of exactly 900 characters and rejects one of 901", () => {
    expect(parseRuleSpec({ ...INFO_RULE, ...withText("a".repeat(900)) }).ok).toBe(true);
    const r = parseRuleSpec({ ...INFO_RULE, ...withText("a".repeat(901)) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join("\n")).toMatch(/actions\.0\.texts\.default.*900/);
  });

  it("applies the limit to every language, and counts an emoji as one character", () => {
    expect(parseRuleSpec({ ...INFO_RULE, ...withText("b".repeat(901), "ar") }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, ...withText("😍".repeat(900)) }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, ...withText("😍".repeat(901)) }).ok).toBe(false);
  });

  it("rejects an empty text, a blank text, and a language the shop does not speak", () => {
    expect(parseRuleSpec({ ...INFO_RULE, ...withText("   ") }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "reply", texts: { default: "hi", fr: "salut" } }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "reply", texts: { ckb: "hi" } }] }).ok).toBe(false); // a default is needed
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "reply", texts: { default: "hi", en: "" } }] }).ok).toBe(false);
  });

  it("rejects hidden and control characters in a text, a name, a note and a keyword", () => {
    for (const ch of [cp(0x200b), cp(0x202e), cp(0x2066), cp(0xfeff), cp(0x00ad), cp(0x0007), cp(0x2028)]) {
      expect(parseRuleSpec({ ...INFO_RULE, ...withText(`hello${ch}there`) }).ok, `U+${ch.codePointAt(0)!.toString(16)} in a text`).toBe(false);
      expect(parseRuleSpec({ ...INFO_RULE, name: `a${ch}b` }).ok, "name").toBe(false);
      expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, keywords: { any: [`in${ch}fo`] } } }).ok, "keyword").toBe(false);
    }
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "flag_owner", note: `x${cp(0x202e)}y` }] }).ok).toBe(false);
  });

  it("allows a zero-width non-joiner and a newline: ordinary in Sorani and in a message", () => {
    expect(parseRuleSpec({ ...INFO_RULE, ...withText(`ئەو${cp(0x200c)}ەی\nدووەم دێڕ`) }).ok).toBe(true);
  });

  it("limits a note to 200 characters and a name to 80", () => {
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "flag_owner", note: "n".repeat(200) }] }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "flag_owner", note: "n".repeat(201) }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, name: "n".repeat(81) }).ok).toBe(false);
  });
});

describe("RuleSpec v1: rules that contradict themselves", () => {
  it("a reply cannot wait, and a wait needs flag_owner and nothing that acts for good", () => {
    expect(bad({ wait: { unansweredMinutes: 10 } }).join("\n")).toMatch(/reply cannot wait/);
    const timer = { ...TIMER_RULE };
    expect(parseRuleSpec(timer).ok).toBe(true);
    expect(parseRuleSpec({ ...timer, actions: [{ do: "pause_thread" }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...timer, actions: [{ do: "flag_owner" }, { do: "pause_thread" }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...timer, wait: { unansweredMinutes: 1 } }).ok).toBe(false);
    expect(parseRuleSpec({ ...timer, wait: { unansweredMinutes: 721 } }).ok).toBe(false);
    expect(parseRuleSpec({ ...timer, wait: { unansweredMinutes: 2.5 } }).ok).toBe(false);
  });

  it("WhatsApp has no comments", () => {
    expect(bad({ trigger: { ...INFO_RULE.trigger, platforms: ["WHATSAPP"] } }).join("\n")).toMatch(/WhatsApp has no comments/);
  });

  it("a reply never goes to a voice note", () => {
    expect(bad({ trigger: { ...INFO_RULE.trigger, viaVoice: true } }).join("\n")).toMatch(/voice/);
    // a flag may
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, viaVoice: true }, actions: [{ do: "flag_owner" }] }).ok).toBe(true);
  });

  it("at most one of each action, at most one reply", () => {
    const r = { do: "reply", texts: { default: "hi" } };
    expect(parseRuleSpec({ ...INFO_RULE, actions: [r, r] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [{ do: "flag_owner" }, { do: "flag_owner" }] }).ok).toBe(false);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [r, { do: "flag_owner" }, { do: "pause_thread" }] }).ok).toBe(true);
    expect(parseRuleSpec({ ...INFO_RULE, actions: [r, { do: "flag_owner" }, { do: "pause_thread" }, { do: "flag_owner" }] }).ok).toBe(false);
  });

  it("needs a should-match and a should-not-match example", () => {
    expect(bad({ examples: [{ text: "info", match: true }, { text: "zanyari", match: true }] }).join("\n")).toMatch(/should NOT match/);
    expect(bad({ examples: [{ text: "hello", match: false }, { text: "bye", match: false }] }).join("\n")).toMatch(/should match/);
  });

  it("a rule that reads labels needs an assumed label on a positive example the free classifier cannot label", () => {
    const t = { channel: "dm", platforms: ["WHATSAPP"], intents: ["delivery"] };
    const missing = parseRuleSpec({ ...INFO_RULE, trigger: t, examples: [{ text: "کەی دەگات؟", match: true }, { text: "سوپاس", match: false }] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.join("\n")).toMatch(/examples\.0\.as/);
    const given = parseRuleSpec({ ...INFO_RULE, trigger: t, examples: [{ text: "کەی دەگات؟", match: true, as: { type: "QUESTION", intent: "delivery" } }, { text: "سوپاس", match: false }] });
    expect(given.ok).toBe(true);
    // the free classifier can label a bare price question, so no "as" is needed for it
    expect(parseRuleSpec({ ...INFO_RULE, trigger: { ...t, intents: ["price"] }, examples: [{ text: "چەندە؟", match: true }, { text: "سوپاس", match: false }] }).ok).toBe(true);
  });
});

describe("normalise and specHash: the canonical form", () => {
  it("is idempotent", () => {
    const once = normalise(rule());
    expect(normalise(once)).toEqual(once);
    const timer = normalise(RuleSpec.parse(TIMER_RULE));
    expect(normalise(timer)).toEqual(timer);
  });

  it("ignores the order of keywords, platforms and other sets", () => {
    const examples = [{ text: "a-word", match: true, as: { type: "QUESTION", intent: "price" } }, { text: "zzz", match: false }];
    const a = rule({ trigger: { channel: "comment", platforms: ["META_INSTAGRAM", "META_FACEBOOK"], keywords: { any: ["b-word", "a-word", "c-word"] }, intents: ["delivery", "price"] }, examples });
    const b = rule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["c-word", "a-word", "b-word"] }, intents: ["price", "delivery"] }, examples });
    expect(specHash(a)).toBe(specHash(b));
    expect(canonicalJson(normalise(a))).toBe(canonicalJson(normalise(b)));
  });

  it("deduplicates keywords that fold to the same word and keeps the first spelling", () => {
    const n = normalise(rule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["Info", "INFO", "info!", "price"], none: ["zzz", "ZZZ"] } } }));
    expect(n.trigger.keywords?.any).toEqual(["Info", "price"]);
    expect(n.trigger.keywords?.none).toEqual(["zzz"]);
  });

  it("drops a language text that repeats the default and tidies line ends and spaces", () => {
    const n = normalise(
      rule({ actions: [{ do: "reply", texts: { default: "line one  \r\nline two \r\n\r\n\r\n\r\nline three", en: "line one\nline two\n\n\nline three", ar: "different" } }] }),
    );
    const r = n.actions[0];
    if (r.do !== "reply") throw new Error("expected a reply");
    expect(r.texts).toEqual({ default: "line one\nline two\n\nline three", ar: "different" });
  });

  it("writes a private-message rule with no public line", () => {
    const dm = normalise(rule({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } }));
    expect(dm.actions[0]).toMatchObject({ do: "reply", publicLine: "none" });
    const comment = normalise(rule());
    expect(comment.actions[0]).toMatchObject({ do: "reply", publicLine: "standard" });
  });

  it("puts the actions in a fixed order", () => {
    const a = normalise(rule({ actions: [{ do: "pause_thread" }, { do: "flag_owner" }, { do: "reply", texts: { default: "hi" } }] }));
    expect(a.actions.map((x) => x.do)).toEqual(["reply", "flag_owner", "pause_thread"]);
  });

  it("gives the same hash when the same rule is saved again or goes through JSON", () => {
    const spec = parseRuleSpec(INFO_RULE);
    if (!spec.ok) throw new Error("rule should parse");
    const again = parseRuleSpec(JSON.parse(JSON.stringify(spec.spec)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(specHash(again.spec)).toBe(specHash(spec.spec));
    expect(specHash(rule())).toMatch(/^[0-9a-f]{64}$/);
    expect(specHash(rule())).toBe(specHash(spec.spec));
  });

  it("changes the hash when what the rule says or does changes", () => {
    const h = specHash(rule());
    expect(specHash(rule({ name: "another name" }))).not.toBe(h);
    expect(specHash(rule({ limits: { perPersonPerDay: 2, perDay: 50 } }))).not.toBe(h);
    expect(specHash(rule({ actions: [{ do: "reply", texts: { default: "other words" } }] }))).not.toBe(h);
    expect(specHash(rule({ trigger: { ...INFO_RULE.trigger, keywords: { any: ["info"], mode: "word" } } }))).not.toBe(h);
  });

  it("canonicalJson sorts keys and leaves out undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"z":1}]},"b":1}');
  });

  it("parseRuleSpec returns the normalised rule, and says where each problem is", () => {
    const r = parseRuleSpec({ ...INFO_RULE, trigger: { ...INFO_RULE.trigger, platforms: ["META_INSTAGRAM", "META_FACEBOOK"] } });
    expect(r.ok && r.spec.trigger.platforms).toEqual(["META_FACEBOOK", "META_INSTAGRAM"]);
    const issues = bad({ actions: [{ do: "reply", texts: { default: "" } }] });
    expect(issues.some((i) => i.startsWith("actions.0.texts.default:"))).toBe(true);
  });
});
