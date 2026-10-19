import { describe, expect, it } from "vitest";

import { lintRule, textFindings, type OtherRule } from "@/lib/shop/rules/lint";
import { RuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";

const GOOD_EXAMPLES = [{ text: "info", match: true }, { text: "hello there", match: false }];

function spec(over: Record<string, unknown> = {}): RuleSpecT {
  return RuleSpec.parse({
    v: 1,
    name: "info",
    trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info"] } },
    actions: [{ do: "reply", texts: { default: "Here are the details." } }],
    examples: GOOD_EXAMPLES,
    ...over,
  });
}
const kw = (any: string[], extra: Record<string, unknown> = {}) => ({
  trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any, ...extra } },
});
const reply = (default_: string, more: Record<string, string> = {}) => ({ actions: [{ do: "reply", texts: { default: default_, ...more } }] });
/** Examples that fit any keyword trigger on the first keyword given. */
const ex = (word: string, negative = "hello there") => ({ examples: [{ text: word, match: true }, { text: negative, match: false }] });

const codes = (r: ReturnType<typeof lintRule>) => ({ problems: r.problems.map((p) => p.code), warnings: r.warnings.map((w) => w.code) });
const other = (name: string, s: RuleSpecT): OtherRule => ({ name, spec: s });

describe("lintRule: a good rule", () => {
  it("has nothing to say", () => {
    const r = lintRule(spec());
    expect(r).toEqual({ problems: [], warnings: [], ok: true });
  });
});

describe("lintRule: keywords that are too broad", () => {
  it("refuses a keyword of fewer than three letters", () => {
    for (const w of ["ok", "نا", "q"]) {
      const r = lintRule(spec({ ...kw([w]), ...ex(w) }));
      expect(r.problems, w).toEqual([{ code: "keyword_short", level: "problem", params: { word: w } }]);
      expect(r.ok).toBe(false);
    }
  });

  it("only warns about a two-letter word when it must be a whole word", () => {
    const r = lintRule(spec({ ...kw(["hm"], { mode: "word" }), ...ex("hm") }));
    expect(codes(r)).toEqual({ problems: [], warnings: ["keyword_short"] });
  });

  it("does not count the letters of an emoji keyword", () => {
    expect(lintRule(spec({ ...kw(["🔥"], { mode: "word" }), ...ex("🔥") })).problems).toEqual([]);
  });

  it("counts the letters after folding (a doubled letter is one)", () => {
    expect(codes(lintRule(spec({ ...kw(["ccc"]), ...ex("ccc") }))).problems).toEqual(["keyword_short"]);
    expect(lintRule(spec({ ...kw(["نرخ"]), ...ex("نرخ") })).problems).toEqual([]);
  });

  it("refuses a word everyone writes: a greeting, a thanks, a yes", () => {
    for (const w of ["hello", "سڵاو", "please", "سوپاس", "مرحبا", "Thanks", "this", "ئەمە", "کاک", "تکایە", "عزیزم"]) {
      const r = lintRule(spec({ ...kw([w]), ...ex(w, "zzz unrelated") }));
      expect(r.problems.map((p) => p.code), w).toEqual(["keyword_common"]);
    }
    expect(lintRule(spec({ ...kw(["hello", "price"]), ...ex("price", "hi") })).problems.map((p) => p.params?.word)).toEqual(["hello"]);
  });

  it("warns about a short word that is allowed to be anywhere in the text", () => {
    expect(codes(lintRule(spec({ ...kw(["abc"], { mode: "contains" }), ...ex("abc") }))).warnings).toEqual(["keyword_contains_short"]);
    expect(codes(lintRule(spec({ ...kw(["abcd"], { mode: "contains" }), ...ex("abcd") }))).warnings).toEqual([]);
  });

  it("refuses a keyword that the none-list always blocks", () => {
    const r = lintRule(spec({ ...kw(["info"], { none: ["info"] }), ...ex("info") }));
    expect(r.problems.map((p) => p.code)).toContain("keyword_contradiction");
    // a none-word that blocks only some of them is fine
    expect(lintRule(spec({ ...kw(["info", "details"], { none: ["info"] }), ...reply("Delivery is free."), ...ex("details") })).problems).toEqual([]);
  });
});

describe("lintRule: a reply that triggers itself", () => {
  it("refuses a text that contains one of the rule's own words", () => {
    const r = lintRule(spec({ ...reply("Here is the info you asked for.") }));
    expect(codes(r).problems).toEqual(["self_trigger"]);
  });

  it("looks at the text of every language, glued endings and spellings included", () => {
    const r = lintRule(spec({ ...kw(["زانیاری"]), ...reply("Hello", { ar: "هذه زانياريك" }), ...ex("زانیاری") }));
    expect(codes(r).problems).toEqual(["self_trigger"]);
  });

  it("is fine when a none-word of the rule blocks it", () => {
    const r = lintRule(spec({ ...kw(["info"], { none: ["details"] }), ...reply("Here are the info details.") }));
    expect(codes(r).problems).toEqual([]);
  });

  it("also catches a rule on a topic whose text is itself that kind of message", () => {
    const rule = {
      trigger: { channel: "dm", platforms: ["META_FACEBOOK"], intents: ["price"], types: ["QUESTION"] },
      ...reply("چەندە؟"),
      examples: [{ text: "بكم؟", match: true }, { text: "hello there", match: false }],
    };
    expect(codes(lintRule(spec(rule))).problems).toEqual(["self_trigger"]);
    expect(codes(lintRule(spec({ ...rule, ...reply("Delivery is free.") }))).problems).toEqual([]);
  });
});

describe("lintRule: the shop's other rules", () => {
  const mine = () => spec({ ...kw(["info", "details"]), ...reply("Delivery is free."), ...ex("info") });

  it("allows ten active rules in all and refuses an eleventh", () => {
    const nine = Array.from({ length: 9 }, (_, i) => other(`r${i}`, spec({ ...kw([`word${i}x`]), ...ex(`word${i}x`) })));
    expect(lintRule(mine(), nine).problems).toEqual([]);
    const r = lintRule(mine(), [...nine, other("r9", spec({ ...kw(["word9x"]), ...ex("word9x") }))]);
    expect(r.problems).toEqual([{ code: "too_many_rules", level: "problem", params: { max: 10 } }]);
    expect(lintRule(mine(), nine, { maxActiveRules: 5 }).problems.map((p) => p.code)).toEqual(["too_many_rules"]);
  });

  it("refuses an exact copy of another active rule", () => {
    const r = lintRule(mine(), [other("the first", mine())]);
    expect(r.problems).toEqual([{ code: "duplicate", level: "problem", params: { other: "the first" } }]);
  });

  it("warns when another active rule answers the same words on the same platform", () => {
    const o = other("details rule", spec({ ...kw(["details", "price"]), ...ex("price") }));
    const r = lintRule(mine(), [o]);
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([{ code: "overlap", level: "warning", params: { other: "details rule", shared: "details" } }]);
  });

  it("sees an overlap through a glued ending", () => {
    const o = other("o", spec({ ...kw(["information"]), ...ex("information") }));
    expect(codes(lintRule(mine(), [o])).warnings).toEqual(["overlap"]);
  });

  it("does not warn for another channel, another platform, other words, or a rule that only flags", () => {
    const dm = other("dm", spec({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } }, ...ex("info") }));
    const ig = other("ig", spec({ trigger: { channel: "comment", platforms: ["META_INSTAGRAM"], keywords: { any: ["info"] } }, ...ex("info") }));
    const mineFb = spec({ ...kw(["info"]), ...ex("info") });
    const words = other("words", spec({ ...kw(["address"]), ...ex("address") }));
    const flag = other("flag", spec({ ...kw(["info"]), actions: [{ do: "flag_owner" }], ...ex("info") }));
    expect(lintRule(mineFb, [dm, ig, words, flag]).warnings).toEqual([]);
  });

  it("warns when two rules answer the same topic", () => {
    const topic = (name: string, intents: string[]) =>
      spec({
        name,
        trigger: { channel: "dm", platforms: ["WHATSAPP"], intents },
        examples: [{ text: "چەندە؟", match: true }, { text: "hello there", match: false }],
      });
    const r = lintRule(topic("a", ["price", "delivery"]), [other("b", topic("b", ["price"]))]);
    expect(r.warnings).toEqual([{ code: "overlap", level: "warning", params: { other: "b", shared: "price" } }]);
    expect(lintRule(topic("a", ["delivery"]), [other("b", topic("b", ["price"]))]).warnings).toEqual([]);
  });
});

describe("lintRule: contradictory or empty triggers", () => {
  it("refuses a topic on message types that never have one", () => {
    const rule = { trigger: { channel: "dm", platforms: ["WHATSAPP"], intents: ["price"], types: ["PRAISE"] }, examples: [{ text: "😍", match: true, as: { type: "PRAISE", intent: "price" } }, { text: "hello there", match: false }] };
    expect(codes(lintRule(spec(rule))).problems).toContain("intent_type_conflict");
    expect(codes(lintRule(spec({ ...rule, trigger: { ...rule.trigger, types: ["QUESTION", "PRAISE"] } }))).problems).not.toContain("intent_type_conflict");
  });

  it("catches a rule with nothing to react to, or WhatsApp comments, even if it did not come through the schema", () => {
    const base = spec();
    const empty = { ...base, trigger: { ...base.trigger, keywords: undefined } } as RuleSpecT;
    expect(codes(lintRule(empty)).problems).toContain("trigger_empty");
    const wa = { ...base, trigger: { ...base.trigger, platforms: ["WHATSAPP"] } } as RuleSpecT;
    expect(codes(lintRule(wa)).problems).toContain("platform_channel");
  });

  it("refuses a reply to orders: Gituas handles them", () => {
    const rule = { trigger: { channel: "dm", platforms: ["WHATSAPP"], types: ["QUESTION", "ORDER"] }, examples: [{ text: "دەمەوێت", match: true, as: { type: "ORDER" } }, { text: "hello there", match: false }] };
    expect(codes(lintRule(spec(rule))).problems).toContain("reply_on_order");
    // a flag on orders is fine
    expect(codes(lintRule(spec({ ...rule, actions: [{ do: "flag_owner" }] }))).problems).not.toContain("reply_on_order");
  });

  it("warns when the languages cannot be written in the letters of the words", () => {
    expect(codes(lintRule(spec({ ...kw(["معلومات"]), trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["معلومات"] }, languages: ["en"] }, examples: [{ text: "معلومات", match: true, as: { language: "en" } }, { text: "hello there", match: false }] }))).warnings).toContain("language_script_mismatch");
    const ok = spec({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["معلومات"] }, languages: ["ar"] }, examples: [{ text: "معلومات", match: true, as: { language: "ar" } }, { text: "hello there", match: false }] });
    expect(codes(lintRule(ok)).warnings).not.toContain("language_script_mismatch");
  });
});

describe("lintRule: examples must behave as declared", () => {
  it("refuses a rule whose example does not do what it says", () => {
    const wrongPositive = lintRule(spec({ examples: [{ text: "info", match: true }, { text: "address please", match: true }, { text: "hello there", match: false }] }));
    expect(wrongPositive.problems).toEqual([{ code: "examples_fail", level: "problem", params: { count: 1, text: "address please" } }]);
    const wrongNegative = lintRule(spec({ examples: [{ text: "info", match: true }, { text: "more info", match: false }] }));
    expect(wrongNegative.problems).toEqual([{ code: "examples_fail", level: "problem", params: { count: 1, text: "more info" } }]);
  });

  it("counts every failing example", () => {
    const r = lintRule(spec({ examples: [{ text: "nope", match: true }, { text: "nada", match: true }, { text: "hello there", match: false }] }));
    expect(r.problems[0].params).toMatchObject({ count: 2, text: "nope" });
  });
});

describe("lintRule: the owner's texts", () => {
  it("warns about untranslated copies of the main text", () => {
    const r = lintRule(spec(reply("Hello details", { ar: "Hello details", ckb: "Hello details", en: "Different" })));
    expect(r.warnings).toEqual([{ code: "same_text", level: "warning", params: { langs: "ckb,ar" } }]);
  });

  it("does not call an emoji-only text untranslated", () => {
    expect(lintRule(spec(reply("🌷", { en: "🌷" }))).warnings).toEqual([]);
  });

  it("warns when one text has to serve words in two scripts", () => {
    const rule = spec({ ...kw(["info", "معلومات"]), ...ex("info") });
    expect(codes(lintRule(rule)).warnings).toEqual(["single_language_text"]);
    expect(codes(lintRule(spec({ ...kw(["info", "معلومات"]), ...reply("Hello there", { ar: "اهلا" }), ...ex("info") }))).warnings).toEqual([]);
  });

  it("warns about a link, an e-mail address or an @handle in a text, and says which", () => {
    for (const t of ["See https://example.com/shop for more", "see www.mystore.shop", "write to shop@mymail.com", "follow @my_shop.iq", "visit mystore.com/offers"]) {
      const r = lintRule(spec(reply(t)));
      expect(r.warnings.map((w) => w.code), t).toEqual(["text_link"]);
      expect(String(r.warnings[0].params?.items)).not.toBe("");
    }
    expect(lintRule(spec(reply("Plain words, nothing else."))).warnings).toEqual([]);
  });

  it("warns about a phone number, in any digits", () => {
    for (const t of ["Call 07501234567", "Call 0750 123 4567", "Call +964 750 123 4567", "پەیوەندی: ٠٧٥٠١٢٣٤٥٦٧", "Whatsapp: 964-750-123-4567"]) {
      expect(lintRule(spec(reply(t))).warnings.map((w) => w.code), t).toEqual(["text_phone"]);
    }
    expect(lintRule(spec(reply("Order within 1-3 days"))).warnings).toEqual([]);
  });

  it("warns about a price, in any digits and any currency word", () => {
    for (const t of ["Delivery 5000 IQD", "Delivery is 5,000 dinar", "گەیاندن ٥٠٠٠ دینار", "التوصيل ٥٠٠٠ دينار", "only $12", "٥ هەزار دینار", "IQD 5000"]) {
      expect(lintRule(spec(reply(t))).warnings.map((w) => w.code), t).toEqual(["text_price"]);
    }
    expect(lintRule(spec(reply("We deliver in 3 days"))).warnings).toEqual([]);
  });

  it("does not warn about a number or a link the owner typed in this conversation", () => {
    const text = "Call 0750 123 4567, delivery 5000 IQD, see www.mystore.shop";
    expect(lintRule(spec(reply(text))).warnings.map((w) => w.code).sort()).toEqual(["text_link", "text_phone", "text_price"]);
    const typed = "my number is 07501234567 and the delivery is 5000 IQD and the site is www.mystore.shop";
    expect(lintRule(spec(reply(text)), [], { ownerText: typed }).warnings).toEqual([]);
    // a number the owner did not type is still flagged
    expect(lintRule(spec(reply("Call 07709999999")), [], { ownerText: typed }).warnings.map((w) => w.code)).toEqual(["text_phone"]);
  });

  it("keeps the found values short and few", () => {
    const r = lintRule(spec(reply("5000 IQD, 6000 IQD, 7000 IQD, 8000 IQD, 9000 IQD")));
    expect(String(r.warnings[0].params?.items).split(" | ").length).toBeLessThanOrEqual(3);
  });
});

describe("lintRule: other warnings", () => {
  it("warns that the rule's text replaces the product card when the owner chose so", () => {
    const rule = { trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, productCard: "replace" } };
    expect(codes(lintRule(spec(rule))).warnings).toEqual(["card_replaced"]);
    expect(codes(lintRule(spec())).warnings).toEqual([]);
  });

  it("warns that pausing a conversation lasts", () => {
    expect(codes(lintRule(spec({ actions: [{ do: "flag_owner" }, { do: "pause_thread" }] }))).warnings).toEqual(["pause_is_lasting"]);
  });

  it("warnings do not stop a rule", () => {
    const r = lintRule(spec(reply("Call 07501234567")));
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("textFindings", () => {
  it("finds links, phone numbers and prices separately", () => {
    const f = textFindings("Visit www.shop.iq or mail a@b.com. Call 0750 123 4567. Delivery 5000 IQD.");
    expect(f.links).toEqual(expect.arrayContaining(["www.shop.iq", "a@b.com"]));
    expect(f.phones).toEqual(["0750 123 4567"]);
    expect(f.prices).toEqual(["5000 IQD"]);
    expect(textFindings("nothing here")).toEqual({ links: [], phones: [], prices: [] });
  });
});
