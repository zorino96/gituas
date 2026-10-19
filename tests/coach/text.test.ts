import { describe, expect, it } from "vitest";

import type { CoachFacts, NoteLang } from "@/lib/coach/facts";
import { acceptLine, bannedPhrase, hasContact, labelFor, LABEL, LABEL_RULES, renderRules, validateAiNote, type NoteBody } from "@/lib/coach/text";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";

const LANGS: NoteLang[] = ["ckb", "ar", "en"];
// Letters Sorani has and Arabic does not; any Arabic-script letter in English.
const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

const facts = (over: Partial<CoachFacts> = {}): CoachFacts => ({
  v: 1,
  week: "2026-W43",
  goal: { kind: "sell", text: null },
  lang: "ckb",
  profile: [],
  orders: {
    week: 14,
    before: 10,
    cancelled: 2,
    sales: { IQD: 1_250_000 },
    salesBefore: { IQD: 900_000 },
    changePct: 40,
    byStatus: { NEW: 5, DELIVERED: 9 },
    top: [{ name: "Red bag", orders: 6 }],
  },
  interest: [{ name: "Red bag", asks: 40, orders: 1, haggles: 12, haggleSharePct: 23 }],
  messages: { dm: 55, dmBefore: 40, comments: 120, commentsBefore: 100 },
  waiting: 4,
  posts: { published: 3, byAutopilot: 2 },
  buyers: { cities: ["erbil", "sulaymaniyah"], hours: [20, 21, 22], messages: 55, orders: 14 },
  ...over,
});

const quiet = (): CoachFacts => facts({ orders: { week: 0, before: 0, cancelled: 0, sales: {}, salesBefore: {}, changePct: null, byStatus: {}, top: [] }, interest: [], messages: { dm: 3, dmBefore: 0, comments: 0, commentsBefore: 0 }, waiting: 0, posts: { published: 0, byAutopilot: 0 }, buyers: { cities: [], hours: [], messages: 3, orders: 0 } });
const empty = (): CoachFacts => facts({ orders: { week: 0, before: 0, cancelled: 0, sales: {}, salesBefore: {}, changePct: null, byStatus: {}, top: [] }, interest: [], messages: { dm: 0, dmBefore: 0, comments: 0, commentsBefore: 0 }, waiting: 0, posts: { published: 0, byAutopilot: 0 }, buyers: { cities: [], hours: [], messages: 0, orders: 0 } });
const down = (): CoachFacts => facts({ orders: { ...facts().orders, week: 5, before: 12, changePct: -58 } });
const same = (): CoachFacts => facts({ orders: { ...facts().orders, week: 10, before: 10, changePct: 0 } });
const grow = (): CoachFacts => facts({ goal: { kind: "grow", text: "more followers" } });
const noPercent = (): CoachFacts => facts({ orders: { ...facts().orders, week: 3, before: 2, changePct: null, sales: { USD: 45.5 } } });

const SCENARIOS: [string, () => CoachFacts][] = [
  ["busy shop, orders up", () => facts()],
  ["orders down", down],
  ["orders the same", same],
  ["no orders but some messages", quiet],
  ["nothing at all", empty],
  ["a goal of growing an audience", grow],
  ["a small week without a percentage", noPercent],
];

const texts = (n: NoteBody): string[] => [n.headline, ...n.points.map((p) => p.text), ...n.tryThis];

describe("the label line", () => {
  it("says what the plan wants in each language, from the dictionary", () => {
    expect(LABEL.en).toBe("AI reading of your own shop numbers. Not live market prices. No prediction.");
    expect(LABEL).toEqual({ ckb: ckb.coach.label, ar: ar.coach.label, en: en.coach.label });
    expect(LABEL_RULES).toEqual({ ckb: ckb.coach.labelRules, ar: ar.coach.labelRules, en: en.coach.labelRules });
  });

  it("is honest about a note no AI wrote", () => {
    expect(labelFor("ai", "en")).toBe(LABEL.en);
    expect(labelFor("rules", "en")).toMatch(/no AI/);
    expect(labelFor("rules", "en")).not.toMatch(/^AI reading/);
    for (const lang of LANGS) {
      expect(labelFor("rules", lang)).not.toBe(labelFor("ai", lang));
      expect(labelFor("ai", lang).trim().length).toBeGreaterThan(30);
    }
  });

  it("keeps the Arabic free of Kurdish-only letters and the English free of Arabic script", () => {
    expect(KURDISH_ONLY.test(LABEL.ar)).toBe(false);
    expect(KURDISH_ONLY.test(LABEL_RULES.ar)).toBe(false);
    expect(ARABIC_SCRIPT.test(LABEL.en)).toBe(false);
    expect(ARABIC_SCRIPT.test(LABEL_RULES.en)).toBe(false);
  });
});

describe("the rules-only note", () => {
  for (const [name, make] of SCENARIOS) {
    describe(name, () => {
      it("has the same points in every language and no empty text", () => {
        const keys = LANGS.map((l) => renderRules(make(), l).points.map((p) => p.key));
        expect(keys[1]).toEqual(keys[0]);
        expect(keys[2]).toEqual(keys[0]);
        for (const lang of LANGS) {
          const note = renderRules(make(), lang);
          expect(note.points.length).toBeGreaterThan(0);
          expect(note.points.length).toBeLessThanOrEqual(8);
          expect(note.tryThis.length).toBeLessThanOrEqual(3);
          for (const t of texts(note)) expect(t.trim().length, `${lang}: ${t}`).toBeGreaterThan(8);
        }
      });

      it("predicts nothing, promises nothing and judges nothing", () => {
        for (const lang of LANGS) {
          for (const t of texts(renderRules(make(), lang))) expect(bannedPhrase(t), `${lang}: ${t}`).toBeNull();
        }
      });

      it("never says an account is not for something", () => {
        for (const t of texts(renderRules(make(), "en"))) expect(t.toLowerCase(), t).not.toContain("not for");
      });

      it("carries no link, handle or phone number", () => {
        for (const lang of LANGS) {
          for (const t of texts(renderRules(make(), lang))) expect(hasContact(t), `${lang}: ${t}`).toBe(false);
        }
      });

      it("keeps the scripts apart", () => {
        for (const t of texts(renderRules(make(), "ar"))) expect(KURDISH_ONLY.test(t), `ar: ${t}`).toBe(false);
        for (const t of texts(renderRules(make(), "en"))) expect(ARABIC_SCRIPT.test(t), `en: ${t}`).toBe(false);
      });
    });
  }

  it("writes the numbers in the language's own digits", () => {
    const en = renderRules(facts(), "en");
    expect(en.headline).toBe("Orders are up on last week");
    expect(en.points[0]).toEqual({ key: "orders_up", text: "14 orders were recorded this week, 10 the week before (40% more)." });
    const ckbNote = renderRules(facts(), "ckb");
    expect(ckbNote.points[0].text).toContain("١٤");
    expect(ckbNote.points[0].text).toContain("٤٠%");
    expect(renderRules(facts(), "ar").points[0].text).toContain("١٤");
  });

  it("calls the value of orders what buyers ordered, never sales or earnings", () => {
    const note = renderRules(facts(), "en");
    const value = note.points.find((p) => p.key === "orders_value");
    expect(value?.text).toContain("1,250,000 IQD");
    expect(value?.text).toContain("not money you have collected");
    for (const lang of LANGS) {
      const all = texts(renderRules(facts(), lang)).join(" ").toLowerCase();
      expect(all).not.toMatch(/\bearn|\bprofit|\brevenue|lost sale/);
    }
  });

  it("says 'recorded in Gituas' about orders and asks, so a missing order is not a lost sale", () => {
    const note = renderRules(facts(), "en");
    const asks = note.points.find((p) => p.key === "asks_few_orders");
    expect(asks?.text).toBe("Buyers asked about Red bag 40 times in the last 28 days, and 1 order is recorded in Gituas.");
    expect(note.tryThis[0]).toMatch(/Red bag/);
  });

  it("gives a percentage only when the facts have one", () => {
    expect(renderRules(facts(), "en").points[0].text).toContain("40% more");
    expect(renderRules(noPercent(), "en").points[0].text).not.toMatch(/%/);
    expect(renderRules(down(), "en").points[0].text).toBe("5 orders were recorded this week, 12 the week before (58% fewer).");
  });

  it("keeps different currencies apart", () => {
    const f = facts({ orders: { ...facts().orders, sales: { IQD: 500_000, USD: 20 } } });
    const text = renderRules(f, "en").points.find((p) => p.key === "orders_value")?.text ?? "";
    expect(text).toContain("500,000 IQD");
    expect(text).toContain("$20");
  });

  it("with a goal of growing an audience counts posts, comments and messages only, and says so", () => {
    const note = renderRules(grow(), "en");
    expect(note.headline).toBe("Your week in posts, comments and messages");
    const keys = note.points.map((p) => p.key);
    expect(keys).toContain("goal_missing");
    expect(keys).toContain("messages");
    expect(keys).not.toContain("orders_up");
    expect(keys).not.toContain("orders_value");
    expect(keys).not.toContain("top_product");
    expect(keys).not.toContain("buyers_where");
    expect(note.points.find((p) => p.key === "goal_missing")?.text).toMatch(/only counts posts, comments and messages/);
  });

  it("says plainly that there is not enough to say when nothing was counted", () => {
    for (const lang of LANGS) {
      const note = renderRules(empty(), lang);
      expect(note.points.map((p) => p.key)).toEqual(["no_data"]);
      expect(note.tryThis).toEqual([]);
    }
    expect(renderRules(empty(), "en").headline).toBe("Not enough numbers yet this week");
  });

  it("suggests how to start when there were no orders, and to post when nothing was posted", () => {
    const note = renderRules(quiet(), "en");
    expect(note.headline).toBe("No orders recorded this week");
    expect(note.points.map((p) => p.key)).toEqual(["orders_none", "messages", "posts_none"]);
    expect(note.tryThis).toEqual(["Prepare one post for your best product. Auto posts can prepare one every day.", "Post a product with a clear price and how to order it."]);
  });

  it("mentions where and when buyers are only with enough behind it", () => {
    const thin = facts({ buyers: { cities: ["erbil"], hours: [20], messages: 4, orders: 3 } });
    const keys = renderRules(thin, "en").points.map((p) => p.key);
    expect(keys).not.toContain("buyers_where");
    expect(keys).not.toContain("buyers_when");
    // a week with fewer other points, so the cap of eight does not cut these last two
    const calm = facts({ interest: [], orders: { ...facts().orders, cancelled: 0, top: [] } });
    const rich = renderRules(calm, "en").points.map((p) => p.key);
    expect(rich).toContain("buyers_where");
    expect(rich).toContain("buyers_when");
    expect(renderRules(calm, "en").points.find((p) => p.key === "buyers_where")?.text).toBe("The cities with most of your recorded orders: Erbil, Sulaymaniyah.");
    expect(renderRules(calm, "en").points.find((p) => p.key === "buyers_when")?.text).toBe("Buyers write most around these hours: 20:00, 21:00, 22:00.");
  });

  it("keeps the most useful points when a busy week has too many: orders, waiting, then what buyers ask", () => {
    const keys = renderRules(facts(), "en").points.map((p) => p.key);
    expect(keys).toHaveLength(8);
    expect(keys.slice(0, 5)).toEqual(["orders_up", "orders_value", "waiting", "asks_few_orders", "haggle"]);
    expect(keys).not.toContain("buyers_when");
  });

  it("puts the things to try in a fixed order of importance", () => {
    const note = renderRules(facts({ posts: { published: 0, byAutopilot: 0 } }), "en");
    expect(note.tryThis).toHaveLength(3);
    expect(note.tryThis[0]).toMatch(/^Look at Red bag/);
    expect(note.tryThis[1]).toMatch(/^Check whether the price of Red bag/);
    expect(note.tryThis[2]).toMatch(/^Open “Needs you”/);
  });

  it("does not repeat a suggestion and gives at most three", () => {
    const note = renderRules(facts(), "en");
    expect(new Set(note.tryThis).size).toBe(note.tryThis.length);
    expect(note.tryThis.length).toBeLessThanOrEqual(3);
  });
});

describe("the phrases a note may never hold", () => {
  const bad = [
    "Sales will double next month",
    "You are going to sell more",
    "We guarantee more orders",
    "I predict a good week",
    "Expect more buyers",
    "This account is not meant for selling",
    "Great job this week",
    "It is a waste of time",
    "سترتفع المبيعات الأسبوع القادم",
    "نضمن لك زيادة الطلبات",
    "توقعاتنا جيدة",
    "هذا الحساب لا يصلح للبيع",
    "فروشتنەکەت زیاد دەبێت",
    "گەرەنتی دەکەین",
    "پێشبینی دەکەم",
    "ئەم هەژمارە بۆ فرۆشتن نییە",
  ];
  for (const t of bad) {
    it(`bans: ${t}`, () => expect(bannedPhrase(t)).not.toBeNull());
  }

  // Predictions and promises that do not use the forms above: the future, "you will get", "it helps you sell more", "I promise".
  const moreBad = {
    en: ["Posting more often brings more orders", "This helps you sell more", "Replying fast boosts your sales", "Free delivery leads to more orders"],
    ar: [
      "سيزداد عدد طلباتك إذا نشرت أكثر",
      "ستحصل على طلبات أكثر إذا ردّيت بسرعة",
      "هذا سيساعدك على البيع أكثر",
      "وستحصل على المزيد من المشترين",
      "أعدك بنتائج أفضل",
      "سيجلب لك هذا مشترين جددا",
      "ستَحصُل على طلبات",
      "التوقعات جيدة هذا الأسبوع",
      "من المؤكد أن المبيعات ستتحسن",
      "تبيع أكثر عندما تنشر صورا",
    ],
    ckb: [
      "بە ئەم کارە فرۆشتنت زیاد دەکات",
      "ئەگەر پۆستی زیاتر بکەیت، داواکاری زیاتر وەردەگریت",
      "دەتوانیت زیاتر بفرۆشیت",
      "ئەمە یارمەتیت دەدات زیاتر بفرۆشیت",
      "داهاتووی ئەم دووکانە باشتر دەبێت",
      "بەڵێنت پێ دەدەم",
      "حەتمەن سوودی هەیە",
      "دڵنیابە کە کڕیار زیاد دەکات",
      // the same words typed with the Arabic heh, yeh and kaf
      "ئەگەر پۆستی زیاتر بکەیت، داواکاری زیاتر وهردهگریت",
      "هەر ڕۆژێک پۆست بکەیت فرۆشتنت زیاد دهكات",
    ],
  };
  for (const [lang, list] of Object.entries(moreBad)) {
    for (const t of list) it(`bans (${lang}): ${t}`, () => expect(bannedPhrase(t), t).not.toBeNull());
  }

  // Words that look like the banned ones and are not: an appointment, the number six, a car, "we prepare", "make sure".
  const moreFine = [
    "Replies sent within an hour are marked on the list",
    "موعد النشر مناسب لمشتريك",
    "ستة طلبات وصلت هذا الأسبوع",
    "نعدّ لك ملخص الأسبوع",
    "تأكد من الرد على الرسائل المنتظرة",
    "سيارة التوصيل جاهزة",
    "وەڵامی نامەکان بدەرەوە",
    "کاتی گونجاو بۆ نامەکان بپشکنە",
  ];
  for (const t of moreFine) it(`allows: ${t}`, () => expect(bannedPhrase(t), t).toBeNull());

  const fine = [
    "Orders are up on last week",
    "14 orders were recorded this week, 10 the week before",
    "Check whether the price suits your buyers",
    "الطلبات أكثر من الأسبوع الماضي",
    "داواکاری لە هەفتەی ڕابردوو زیاترە",
  ];
  for (const t of fine) {
    it(`allows: ${t}`, () => expect(bannedPhrase(t)).toBeNull());
  }
});

describe("hasContact", () => {
  it("finds links, handles, e-mail addresses and phone numbers", () => {
    for (const t of ["see https://example.com", "write to @myshop_iq", "mail me a@b.com", "call 0750 123 4567", "call +964 750 123 4567", "visit shop.example.com"]) {
      expect(hasContact(t), t).toBe(true);
    }
  });

  it("leaves prices alone, even with seven digits or more", () => {
    for (const t of ["Worth 1,250,000 IQD", "Worth 12,500,000 IQD", "بەهاکەی ١٬٢٥٠٬٠٠٠ دینارە", "قيمتها ١٬٢٥٠٬٠٠٠ د.ع", "20:00, 21:00", "14 orders, 10 the week before"]) {
      expect(hasContact(t), t).toBe(false);
    }
  });
});

describe("checking an AI wording", () => {
  const f = facts();
  const rules = renderRules(f, "en");

  it("keeps a reworded point whose numbers are all in the facts", () => {
    const out = validateAiNote(
      {
        headline: "A good week for orders: 14 against 10",
        points: [
          { key: "orders_up", text: "You got 14 orders this week and 10 the week before, 40% more." },
          { key: "orders_value", text: "The orders are worth 1,250,000 IQD. That is what buyers asked for, not money collected yet." },
        ],
        tryThis: ["Answer the 4 messages waiting for you first."],
      },
      { facts: f, rules },
    );
    expect(out?.headline).toBe("A good week for orders: 14 against 10");
    expect(out?.points.map((p) => p.key)).toEqual(["orders_up", "orders_value"]);
    expect(out?.tryThis).toEqual(["Answer the 4 messages waiting for you first."]);
  });

  it("drops a point that holds a number the facts do not have, and keeps the others", () => {
    const out = validateAiNote(
      {
        headline: "Your week",
        points: [
          { key: "orders_up", text: "You got 17 orders this week." },
          { key: "waiting", text: "4 messages are waiting for you." },
        ],
        tryThis: [],
      },
      { facts: f, rules },
    );
    expect(out?.points).toEqual([{ key: "waiting", text: "4 messages are waiting for you." }]);
  });

  it("drops a prediction, a promise and a judgement", () => {
    const out = validateAiNote(
      {
        headline: "Orders will keep growing",
        points: [
          { key: "orders_up", text: "Orders will keep growing next week." },
          { key: "waiting", text: "This account is not meant for selling." },
          { key: "messages", text: "Buyers wrote 55 messages and 120 comments this week." },
        ],
        tryThis: ["We guarantee more orders if you reply faster."],
      },
      { facts: f, rules },
    );
    // the headline and the try-this fall back to the rules'; only the clean point stays
    expect(out?.points).toEqual([{ key: "messages", text: "Buyers wrote 55 messages and 120 comments this week." }]);
    expect(out?.headline).toBe(rules.headline);
    expect(out?.tryThis).toEqual(rules.tryThis);
  });

  it("drops a point with a link, a handle or a phone number", () => {
    const out = validateAiNote(
      {
        headline: "Your week",
        points: [
          { key: "orders_up", text: "See https://example.com/offer for 14 orders." },
          { key: "waiting", text: "Call 0750 123 4567 about the 4 messages." },
          { key: "haggle", text: "Follow @myshop_iq: 23% bargained." },
          { key: "messages", text: "Buyers wrote 55 messages." },
        ],
        tryThis: [],
      },
      { facts: f, rules },
    );
    expect(out?.points).toEqual([{ key: "messages", text: "Buyers wrote 55 messages." }]);
  });

  it("refuses a key the rules did not write, and a key used twice", () => {
    const out = validateAiNote(
      {
        headline: "Your week",
        points: [
          { key: "competitors", text: "Other shops sell more." },
          { key: "waiting", text: "4 messages are waiting for you." },
          { key: "waiting", text: "Four are waiting, 4 in all." },
        ],
        tryThis: [],
      },
      { facts: f, rules },
    );
    expect(out?.points).toEqual([{ key: "waiting", text: "4 messages are waiting for you." }]);
  });

  it("returns null when no point survives, so the rules' own note is used", () => {
    expect(validateAiNote({ headline: "x", points: [{ key: "orders_up", text: "Sales will grow 90%." }], tryThis: [] }, { facts: f, rules })).toBeNull();
    expect(validateAiNote({ headline: "x", points: [], tryThis: [] }, { facts: f, rules })).toBeNull();
    expect(validateAiNote(null, { facts: f, rules })).toBeNull();
    expect(validateAiNote("a string", { facts: f, rules })).toBeNull();
    expect(validateAiNote({ points: "not a list" }, { facts: f, rules })).toBeNull();
  });

  it("allows the numbers of the owner's own words and the rules' fixed windows", () => {
    const withGoal = facts({ goal: { kind: "sell", text: "sell 300 bags this season" } });
    const draft = renderRules(withGoal, "en");
    const out = validateAiNote(
      { headline: "Your week", points: [{ key: "asks_few_orders", text: "In the last 28 days buyers asked about Red bag 40 times. Your aim is 300 bags." }], tryThis: [] },
      { facts: withGoal, rules: draft },
    );
    expect(out?.points).toHaveLength(1);
  });

  it("lets a line name the two windows the numbers cover (7 and 28 days) even when the draft does not", () => {
    const calm = facts({ interest: [], waiting: 0 });
    const draft = renderRules(calm, "en");
    const out = validateAiNote({ headline: "Your week", points: [{ key: "orders_up", text: "In the last 7 days you had 14 orders, and over 28 days your buyers wrote a lot." }], tryThis: [] }, { facts: calm, rules: draft });
    expect(out?.points).toHaveLength(1);
  });

  it("cuts nothing short but refuses a line that is too long", () => {
    expect(acceptLine("x".repeat(400), 280, "")).toBeNull();
    expect(acceptLine("   ", 280, "")).toBeNull();
    expect(acceptLine(42, 280, "")).toBeNull();
    expect(acceptLine("A short, plain line.", 280, "")).toBe("A short, plain line.");
  });

  it("keeps at most six points and three things to try", () => {
    const many = renderRules(facts(), "en");
    const raw = {
      headline: "Your week",
      points: many.points.map((p) => ({ key: p.key, text: p.text })),
      tryThis: ["Look at it.", "Think about it.", "Try it once.", "Try it twice.", "Try it again."],
    };
    const out = validateAiNote(raw, { facts: f, rules: many });
    expect(out!.points.length).toBeLessThanOrEqual(6);
    expect(out!.tryThis).toHaveLength(3);
  });
});
