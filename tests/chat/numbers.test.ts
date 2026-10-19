import { describe, expect, it } from "vitest";

import { allowedSet, guardAdvice, guardAdviceDetailed, ungroundedNumbers } from "@/lib/chat/numbers";

const FALLBACK = "I can only quote numbers from your own data.";

describe("ungroundedNumbers", () => {
  it("finds a number that is not in the allowed text", () => {
    expect(ungroundedNumbers("Sales are up 40% this week.", '{"orders":12}')).toEqual(["40"]);
  });

  it("lets a number through that the allowed text holds", () => {
    expect(ungroundedNumbers("You had 12 orders this week.", '{"orders":12}')).toEqual([]);
  });

  it("treats 1, 2 and 3 as free, and zero", () => {
    expect(ungroundedNumbers("Try two or three ideas: 1, 2, 3 and 0 orders.", "{}")).toEqual([]);
    expect(ungroundedNumbers("Try 4 ideas.", "{}")).toEqual(["4"]);
  });

  it("ignores list markers at the start of a line", () => {
    const answer = "Ideas:\n1. Post daily\n2) Reply fast\n- 3. Add photos\n4. Ask for reviews\n10. Offer a bundle";
    expect(ungroundedNumbers(answer, "{}")).toEqual([]);
    // the same digits inside a sentence are numbers
    expect(ungroundedNumbers("Post 4 times a week.", "{}")).toEqual(["4"]);
  });

  it("reads prices with thousands separators in any script", () => {
    expect(ungroundedNumbers("The price is 25,000 IQD.", '{"price":25000}')).toEqual([]);
    expect(ungroundedNumbers("نرخەکە ٢٥٬٠٠٠ دینارە", '{"price":25000}')).toEqual([]);
    expect(ungroundedNumbers("السعر 25.000 دينار", "the price is 25,000")).toEqual([]);
    expect(ungroundedNumbers("The price is 30,000 IQD.", '{"price":25000}')).toEqual(["30000"]);
  });

  it("reads Arabic-Indic and Persian digits, and full-width digits", () => {
    expect(ungroundedNumbers("لديك ١٢ طلباً", '{"orders":12}')).toEqual([]);
    expect(ungroundedNumbers("لديك ١٥ طلباً", '{"orders":12}')).toEqual(["15"]);
    expect(ungroundedNumbers("تۆ ۱۸ داواکاریت هەیە", '{"orders":12}')).toEqual(["18"]);
    expect(ungroundedNumbers("You had １５ orders", '{"orders":12}')).toEqual(["15"]);
  });

  it("reads percentages and decimals", () => {
    expect(ungroundedNumbers("30% of buyers bargain.", '{"bargainSharePercent":30}')).toEqual([]);
    expect(ungroundedNumbers("45% of buyers bargain.", '{"bargainSharePercent":30}')).toEqual(["45"]);
    expect(ungroundedNumbers("About 2.5 per day", '{"x":25}')).toEqual([]); // "2.5" reads as 25, like the buyer-reply guard
  });

  it("does not let a digit inside a long identifier ground a made-up number", () => {
    expect(ungroundedNumbers("You had 47 orders.", '{"id":"cmgx9k2m40001abcd1234xyz47","orders":12}')).toEqual(["47"]);
    expect(allowedSet('{"id":"cmgx9k2m40001abcd1234xyz47","orders":12}').has("47")).toBe(false);
  });

  it("lists each ungrounded number once, in order", () => {
    expect(ungroundedNumbers("Aim for 50 and then 80, not 50 again.", "{}")).toEqual(["50", "80"]);
  });
});

describe("guardAdvice", () => {
  const allowed = '{"orders":{"thisWeek":12,"weekBefore":9},"sales":{"IQD":250000}}';

  it("returns a grounded answer untouched", () => {
    const answer = "You had 12 orders this week against 9 before.\nWorth 250,000 IQD.";
    expect(guardAdvice(answer, allowed, FALLBACK)).toBe(answer);
    expect(guardAdviceDetailed(answer, allowed, FALLBACK)).toEqual({ text: answer, cut: false, dropped: [] });
  });

  it("drops the sentence that holds a number nobody gave and keeps the rest", () => {
    const answer = "You had 12 orders this week. Expect 40% more next month. Reply faster to the messages waiting for you.";
    const out = guardAdviceDetailed(answer, allowed, FALLBACK);
    expect(out.text).toBe("You had 12 orders this week. Reply faster to the messages waiting for you.");
    expect(out.cut).toBe(true);
    expect(out.dropped).toEqual(["Expect 40% more next month."]);
  });

  it("works line by line, so a list loses only the bad item", () => {
    const answer = "Ideas:\n- Post your best seller with its price.\n- Spend 100,000 IQD on an ad.\n- Answer the waiting messages today.";
    expect(guardAdvice(answer, allowed, FALLBACK)).toBe("Ideas:\n- Post your best seller with its price.\n- Answer the waiting messages today.");
  });

  it("does not split a sentence inside a decimal or a price", () => {
    const answer = "You had 12 orders. The ad costs 2.5 times more than 12 posts!";
    // "2.5" reads as 25, which is not allowed: that whole sentence goes, and the first stays.
    expect(guardAdvice(answer, allowed, FALLBACK)).toBe("You had 12 orders.");
  });

  it("falls back to the fixed sentence when nothing is left", () => {
    expect(guardAdvice("Expect 40% more orders. Spend 100,000 IQD.", allowed, FALLBACK)).toBe(FALLBACK);
    expect(guardAdviceDetailed("Expect 40% more orders.", allowed, FALLBACK)).toEqual({ text: FALLBACK, cut: true, dropped: ["Expect 40% more orders."] });
  });

  it("falls back when what is left is only a dangling lead-in", () => {
    expect(guardAdvice("Here:\n1. Spend 100,000 IQD", allowed, FALLBACK)).toBe(FALLBACK);
  });

  it("guards the Arabic and Sorani sentences the same way", () => {
    const ar = "لديك ١٢ طلباً هذا الأسبوع. سترتفع المبيعات ٤٠٪ قريباً. أجب عن الرسائل المنتظرة اليوم.";
    expect(guardAdvice(ar, allowed, FALLBACK)).toBe("لديك ١٢ طلباً هذا الأسبوع. أجب عن الرسائل المنتظرة اليوم.");
    const ckb = "١٢ داواکاریت هەیە. ٤٠ لەسەد زیاتر دەفرۆشیت؟ وەڵامی نامەکان بدەرەوە.";
    expect(guardAdvice(ckb, allowed, FALLBACK)).toBe("١٢ داواکاریت هەیە. وەڵامی نامەکان بدەرەوە.");
  });

  it("allows the owner's own numbers when they are in the allowed text", () => {
    const withOwner = `${allowed}\nowner said: my budget is 50,000 IQD`;
    expect(guardAdvice("Spending 50,000 IQD fits your budget.", withOwner, FALLBACK)).toBe("Spending 50,000 IQD fits your budget.");
    expect(guardAdvice("Spending 60,000 IQD would be fine.", withOwner, FALLBACK)).toBe(FALLBACK);
  });
});
