import { describe, expect, it } from "vitest";

import { actionsSentence, LINT_TEXT_CODES, lintText, num, REASON_CODES, reasonText, ruleParts, ruleSentence } from "@/lib/shop/rules/render";
import { RuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";
import { LINT_CODES, NO_MATCH_REASONS, SKIP_REASONS, type UiLang } from "@/lib/shop/rules/types";

const LANGS: UiLang[] = ["ckb", "ar", "en"];

// The same checks as tests/i18n/dictionaries.test.ts: letters only Kurdish has must not show up in Arabic text.
const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
// Letters only Arabic has (Arabic yeh, kaf, alef maksura, teh marbuta, hamza-on-alef, waw-hamza): not Sorani.
const ARABIC_ONLY = /[يكىةأإؤ]/;
const ARABIC_SCRIPT = /[\u{600}-\u{6FF}]/u;

/** A rule whose data (keywords, texts, note) is plain ASCII, so that every Arabic-script letter in the output is the template's. */
function ascii(over: Record<string, unknown> = {}): RuleSpecT {
  return RuleSpec.parse({
    v: 1,
    name: "info",
    trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info", "price"] } },
    actions: [{ do: "reply", texts: { default: "Hello there" } }],
    examples: [{ text: "info", match: true }, { text: "hello there", match: false }],
    ...over,
  });
}

/** Every shape of rule the renderer has a branch for. */
function matrix(): Record<string, RuleSpecT> {
  const label = { examples: [{ text: "x", match: true, as: { type: "QUESTION", intent: "price" } }, { text: "hello", match: false }] };
  return {
    commentKeywords: ascii(),
    commentNoPublicLine: ascii({ actions: [{ do: "reply", publicLine: "none", texts: { default: "Hi" } }] }),
    dmKeywords: ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } }),
    manyKeywords: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg"] } } }),
    intentsOnly: ascii({ trigger: { channel: "dm", platforms: ["META_INSTAGRAM"], intents: ["price", "delivery", "size_colour"] }, ...label }),
    typesOnly: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], types: ["QUESTION", "NEGOTIATION", "PRAISE", "OTHER"] }, ...label }),
    intentsAndTypes: ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], intents: ["address", "hours", "availability"], types: ["QUESTION"] }, ...label }),
    keywordsAndIntents: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, intents: ["price"] }, ...label }),
    keywordsAndTypes: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, types: ["QUESTION", "ORDER"] }, ...label }),
    keywordsAndBoth: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, intents: ["price"], types: ["QUESTION"] }, ...label }),
    languages: ascii({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, languages: ["ckb", "kmr", "ar", "ku_latn", "en"] }, ...label }),
    voiceFlag: ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] }, viaVoice: true }, actions: [{ do: "flag_owner", note: "look at it" }] }),
    waitFlag: ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], intents: ["price"] }, wait: { unansweredMinutes: 10 }, actions: [{ do: "flag_owner" }], ...label }),
    flagPause: ascii({ actions: [{ do: "flag_owner" }, { do: "pause_thread" }] }),
    pauseOnly: ascii({ actions: [{ do: "pause_thread" }] }),
    all: ascii({ actions: [{ do: "reply", texts: { default: "Hi" } }, { do: "flag_owner", note: "n" }, { do: "pause_thread" }] }),
  };
}

describe("ruleSentence: one sentence per rule", () => {
  const rule = ascii();

  it("says it in English", () => {
    expect(ruleSentence(rule, "en")).toBe(
      "When a comment on Facebook or Instagram says “info” or “price”, we send them a private message: “Hello there”, and we leave a short public note under the comment saying we did. At most 50 a day, and 1 per person a day.",
    );
  });

  it("says it in Sorani, with the places, the owner's words and Arabic-Indic digits", () => {
    const s = ruleSentence(rule, "ckb");
    expect(s).toContain("کاتێک کەسێک لە کۆمێنتی فەیسبووک یان ئینستاگرام «info» یان «price» بنووسێت");
    expect(s).toContain("بە نامەی تایبەت ئەم وەڵامە دەنێرین: «Hello there»");
    expect(s).toContain("زۆرترین ٥٠ جار لە ڕۆژێکدا، و هەر کەسێک ڕۆژی ١ جار.");
  });

  it("says it in Arabic", () => {
    const s = ruleSentence(rule, "ar");
    expect(s).toContain("عندما يكتب شخص ما «info» أو «price» في تعليق على فيسبوك أو إنستغرام");
    expect(s).toContain("نرسل له رسالة خاصة بهذا النص: «Hello there»");
    expect(s).toContain("الحد الأقصى ٥٠ في اليوم، و١ لكل شخص في اليوم.");
  });

  it("speaks of a private message for a DM rule, and leaves out the public note", () => {
    const dm = ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["info"] } } });
    expect(ruleSentence(dm, "en")).toBe("When a private message on WhatsApp says “info”, we answer: “Hello there”. At most 50 a day, and 1 per person a day.");
    expect(ruleSentence(dm, "ckb")).toContain("لە نامەی تایبەتی واتساپ");
    expect(ruleSentence(dm, "ar")).toContain("في رسالة خاصة على واتساب");
    expect(ruleSentence(dm, "en")).not.toContain("public");
  });

  it("describes topics, kinds, languages, voice notes, waiting, flags and pauses", () => {
    const m = matrix();
    expect(ruleSentence(m.intentsAndTypes, "en")).toContain("is a question and asks about the shop's address, opening hours or availability");
    expect(ruleSentence(m.intentsOnly, "en")).toContain("asks about the price, delivery or size or colour");
    expect(ruleSentence(m.languages, "en")).toContain("is written in Sorani, in Badini, in Arabic, in Kurdish with Latin letters or in English");
    expect(ruleSentence(m.voiceFlag, "en")).toContain("(voice notes count too)");
    expect(ruleSentence(m.voiceFlag, "en")).toContain("the message goes to your “Needs you” list (look at it)");
    expect(ruleSentence(m.waitFlag, "en")).toContain("and you have not answered within 10 minutes");
    expect(ruleSentence(m.flagPause, "en")).toContain("the message goes to your “Needs you” list, and automatic replies in that conversation stop");
    expect(ruleSentence(m.waitFlag, "ckb")).toContain("لە ماوەی ١٠ خولەکدا وەڵامت نەدابێتەوە");
    expect(ruleSentence(m.flagPause, "ckb")).toContain("«پێویستی بە تۆیە»");
    expect(ruleSentence(m.flagPause, "ar")).toContain("«تحتاج إليك»");
  });

  it("lists the first five words and counts the rest", () => {
    expect(ruleSentence(matrix().manyKeywords, "en")).toContain("or “eee” (+2)");
    expect(ruleSentence(matrix().manyKeywords, "ckb")).toContain("(+٢)");
  });

  it("shortens a long reply text and marks the cut", () => {
    const long = ascii({ actions: [{ do: "reply", texts: { default: "word ".repeat(100).trim() } }] });
    const s = ruleSentence(long, "en");
    expect(s).toContain("…”");
    expect(s.length).toBeLessThan(500);
  });

  it("keeps a text that has quotation marks of its own readable", () => {
    const quoted = ascii({ actions: [{ do: "reply", texts: { default: "Write «order» here" } }] });
    expect(ruleSentence(quoted, "ckb")).toContain("“Write «order» here”");
    const en = ascii({ actions: [{ do: "reply", texts: { default: "Write “order” here" } }] });
    expect(ruleSentence(en, "en")).toContain("\"Write “order” here\"");
  });

  it("counts Arabic minutes the Arabic way", () => {
    const wait = (n: number) => ruleSentence(ascii({ trigger: { channel: "dm", platforms: ["WHATSAPP"], intents: ["price"] }, wait: { unansweredMinutes: n }, actions: [{ do: "flag_owner" }], examples: [{ text: "x", match: true, as: { type: "QUESTION", intent: "price" } }, { text: "hello", match: false }] }), "ar");
    expect(wait(2)).toContain("خلال دقيقتين");
    expect(wait(5)).toContain("خلال ٥ دقائق");
    expect(wait(10)).toContain("خلال ١٠ دقائق");
    expect(wait(11)).toContain("خلال ١١ دقيقة");
    expect(wait(120)).toContain("خلال ١٢٠ دقيقة");
    expect(wait(103)).toContain("خلال ١٠٣ دقائق");
  });

  it("gives the parts separately for a card", () => {
    const p = ruleParts(rule, "en");
    expect(p.when).toBe("When a comment on Facebook or Instagram says “info” or “price”");
    expect(p.does).toHaveLength(2);
    expect(p.limits).toBe("At most 50 a day, and 1 per person a day.");
  });
});

describe("actionsSentence", () => {
  it("says what the actions do, in each language", () => {
    const all = matrix().all;
    expect(actionsSentence(all, "en")).toBe(
      "We send them a private message: “Hi”, and we leave a short public note under the comment saying we did, and the message goes to your “Needs you” list (n), and automatic replies in that conversation stop.",
    );
    expect(actionsSentence(matrix().pauseOnly, "ckb")).toBe("وەڵامدانەوەی خۆکار لەو گفتوگۆیەدا دەوەستێت.");
    expect(actionsSentence(matrix().pauseOnly, "ar")).toBe("يتوقف الرد التلقائي في تلك المحادثة.");
  });
});

describe("the wording is in the right script for each language", () => {
  const all = Object.entries(matrix());
  it("the Arabic has no Kurdish-only letters", () => {
    for (const [name, spec] of all) {
      const s = ruleSentence(spec, "ar");
      expect(KURDISH_ONLY.test(s), `${name}: ${s}`).toBe(false);
      expect(KURDISH_ONLY.test(actionsSentence(spec, "ar")), name).toBe(false);
    }
  });

  it("the Sorani has no letters that only Arabic has", () => {
    for (const [name, spec] of all) {
      const s = ruleSentence(spec, "ckb");
      expect(ARABIC_ONLY.test(s), `${name}: ${s}`).toBe(false);
    }
  });

  it("the English has no Arabic script", () => {
    for (const [name, spec] of all) expect(ARABIC_SCRIPT.test(ruleSentence(spec, "en")), name).toBe(false);
  });

  it("every shape renders something in every language, with no hole in it", () => {
    for (const [name, spec] of all) {
      for (const lang of LANGS) {
        const s = ruleSentence(spec, lang);
        expect(s.trim().length, `${name} ${lang}`).toBeGreaterThan(20);
        expect(s, `${name} ${lang}`).not.toMatch(/undefined|\[object|NaN|null/);
        expect(s, `${name} ${lang}`).not.toMatch(/\s{2,}/);
        expect(s.endsWith("."), `${name} ${lang} ends with a full stop`).toBe(true);
      }
    }
  });
});

describe("num", () => {
  it("writes Arabic-Indic digits for Sorani and Arabic and Western digits for English", () => {
    expect(num(50, "ckb")).toBe("٥٠");
    expect(num(1903, "ar")).toBe("١٩٠٣");
    expect(num(50, "en")).toBe("50");
    expect(num("7", "en")).toBe("7");
  });
});

describe("the sentences of the log (reasons)", () => {
  it("has a sentence for every reason code the engine can give, and no more", () => {
    expect([...REASON_CODES].sort()).toEqual([...NO_MATCH_REASONS, ...SKIP_REASONS].sort());
  });

  it("has all three languages, each in its own script", () => {
    for (const code of REASON_CODES) {
      for (const lang of LANGS) expect(reasonText(code, lang).trim().length, `${code} ${lang}`).toBeGreaterThan(10);
      expect(KURDISH_ONLY.test(reasonText(code, "ar")), `ar ${code}: ${reasonText(code, "ar")}`).toBe(false);
      expect(ARABIC_ONLY.test(reasonText(code, "ckb")), `ckb ${code}: ${reasonText(code, "ckb")}`).toBe(false);
      expect(ARABIC_SCRIPT.test(reasonText(code, "en")), `en ${code}`).toBe(false);
      // the three languages say different things in different words
      expect(new Set(LANGS.map((l) => reasonText(code, l))).size, code).toBe(3);
    }
  });

  it("falls back to the code itself for one it does not know", () => {
    expect(reasonText("nonsense" as never, "en")).toBe("nonsense");
  });
});

describe("the sentences of the lint", () => {
  const params = { word: "info", other: "rule one", shared: "info", langs: "ar,en", items: "0750 | 5000 IQD", share: 45, count: 2, text: "an example", max: 10, bytes: 1200 };

  it("has a sentence for every lint code, and no more", () => {
    expect([...LINT_TEXT_CODES].sort()).toEqual([...LINT_CODES].sort());
  });

  it("has all three languages, each in its own script, with the values in", () => {
    for (const code of LINT_CODES) {
      const level = "warning" as const;
      for (const lang of LANGS) {
        const s = lintText({ code, level, params }, lang);
        expect(s.trim().length, `${code} ${lang}`).toBeGreaterThan(15);
        expect(s, `${code} ${lang}`).not.toMatch(/undefined|\[object|NaN/);
      }
      expect(KURDISH_ONLY.test(lintText({ code, level, params }, "ar")), `ar ${code}: ${lintText({ code, level, params }, "ar")}`).toBe(false);
      expect(ARABIC_ONLY.test(lintText({ code, level, params }, "ckb")), `ckb ${code}: ${lintText({ code, level, params }, "ckb")}`).toBe(false);
      expect(ARABIC_SCRIPT.test(lintText({ code, level, params }, "en")), `en ${code}`).toBe(false);
    }
  });

  it("puts the owner's word, the other rule, the shared words and the numbers into the sentence", () => {
    expect(lintText({ code: "keyword_short", level: "problem", params }, "en")).toContain("“info”");
    expect(lintText({ code: "overlap", level: "warning", params }, "en")).toContain("“rule one” (info)");
    expect(lintText({ code: "duplicate", level: "problem", params }, "ckb")).toContain("«rule one»");
    expect(lintText({ code: "too_many_rules", level: "problem", params }, "ar")).toContain("(١٠)");
    expect(lintText({ code: "backtest_too_broad", level: "problem", params }, "ckb")).toContain("٤٥%");
    expect(lintText({ code: "examples_fail", level: "problem", params }, "en")).toContain("2, for example “an example”");
    expect(lintText({ code: "text_phone", level: "warning", params }, "en")).toContain("(0750 | 5000 IQD)");
    expect(lintText({ code: "text_long_bytes", level: "warning", params }, "en")).toContain("is 1200 bytes, over 1,000");
    expect(lintText({ code: "text_long_bytes", level: "warning", params }, "ckb")).toContain("١٢٠٠");
    expect(lintText({ code: "text_long_bytes", level: "warning", params }, "ar")).toContain("١٢٠٠");
  });

  it("names the languages of an untranslated text in the person's language", () => {
    expect(lintText({ code: "same_text", level: "warning", params }, "en")).toBe("The Arabic or English text is the same as the main text; it looks untranslated.");
    expect(lintText({ code: "same_text", level: "warning", params }, "ar")).toContain("العربية أو الإنجليزية");
    expect(lintText({ code: "same_text", level: "warning", params }, "ckb")).toContain("عەرەبی یان ئینگلیزی");
  });
});
