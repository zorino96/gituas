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

describe("figures read the way a person reads them", () => {
  const hours = '{"buyers":{"busiestHoursBaghdad":[20,21,22],"basedOnMessages":140}}';

  it("keeps the numbers of a compact list apart", () => {
    const set = allowedSet(hours);
    for (const n of ["20", "21", "22", "140"]) expect(set.has(n), n).toBe(true);
    expect(set.has("202122")).toBe(false);
    expect(ungroundedNumbers("Your buyers write most around 21:00 and 22:00. Post just before that.", hours)).toEqual([]);
    expect(guardAdvice("Your buyers write most around 21:00 and 22:00.", hours, FALLBACK)).toBe("Your buyers write most around 21:00 and 22:00.");
    expect(ungroundedNumbers("They write at 23:00.", hours)).toEqual(["23"]);
  });

  it("reads a list that could also be a grouped figure both ways in the data", () => {
    const set = allowedSet('{"x":[100,200,300],"y":[5,100]}');
    for (const n of ["100", "200", "300", "5", "5100", "100200300"]) expect(set.has(n), n).toBe(true);
  });

  it("compares figures without their leading zeros", () => {
    expect(ungroundedNumbers("They write at 09:00 mostly.", '{"hours":[9]}')).toEqual([]);
    expect(ungroundedNumbers("They write at 09:30 mostly.", '{"hours":[9]}')).toEqual([]);
    expect(ungroundedNumbers("Order 007 came in.", '{"n":7}')).toEqual([]);
    expect(ungroundedNumbers("Order 0012 came in.", '{"n":7}')).toEqual(["12"]);
  });

  it("reads a clock time as its hour, and a 12-hour clock either way", () => {
    expect(ungroundedNumbers("Post at 6:45 PM.", '{"hours":[18]}')).toEqual([]);
    expect(ungroundedNumbers("Post at 9 pm.", '{"hours":[21]}')).toEqual([]);
    expect(ungroundedNumbers("Post at 18:45.", '{"hours":[21]}')).toEqual(["18"]);
    // the minutes are not figures
    expect(ungroundedNumbers("At 21:47 and 21:58.", '{"hours":[21]}')).toEqual([]);
  });

  it("reads thousands written with spaces", () => {
    expect(ungroundedNumbers("The order is 1 250 000 IQD.", '{"total":1250000}')).toEqual([]);
    expect(ungroundedNumbers("The order is 1 250 000 IQD.", '{"orders":250}')).toEqual(["1250000"]);
    expect(ungroundedNumbers("Worth 1\u{a0}250\u{a0}000 IQD.", '{"total":1250000}')).toEqual([]);
    expect(ungroundedNumbers("Worth 1,250.50 IQD.", '{"total":1250.5}')).toEqual([]);
    expect(allowedSet("1 250 000").has("1250000")).toBe(true);
  });

  it("does not let an unrelated small number save an invented amount", () => {
    expect(ungroundedNumbers("Spend 25,000 IQD on a boost.", '{"orders":25}')).toEqual(["25000"]);
    expect(ungroundedNumbers("Spend 5 000 IQD on a boost.", '{"orders":5}')).toEqual(["5000"]);
  });

  it("reads decimals as decimals, and as the plain digits the buyer-reply guard reads", () => {
    expect(ungroundedNumbers("About 2.5 per day", '{"perDay":2.5}')).toEqual([]);
    expect(ungroundedNumbers("About 0.75 per day", '{"perDay":0.75}')).toEqual([]);
    expect(ungroundedNumbers("About 4.5 per day", '{"perDay":2.5}')).toEqual(["4.5"]);
  });

  it("lets a product code that the data holds be quoted, and nothing else about codes", () => {
    const data = '{"top":[{"name":"ABC-12345-XL-RED-2024-LIMITED","orders":5}]}';
    expect(allowedSet(data).has("12345")).toBe(false);
    expect(allowedSet(data).has("2024")).toBe(false);
    expect(allowedSet(data).has("5")).toBe(true);
    expect(ungroundedNumbers("Your best seller is ABC-12345-XL-RED-2024-LIMITED with 5 orders.", data)).toEqual([]);
    expect(ungroundedNumbers("Try the code SAVE-4000-NOW for your buyers.", data)).toEqual(["4000"]);
  });

  it("does not count a phone-like figure", () => {
    expect(ungroundedNumbers("Call 0750 123 4567 or +964 750 123 4567 or 07501234567.", "{}")).toEqual([]);
    expect(ungroundedNumbers("You had 47 orders, call 07501234567.", "{}")).toEqual(["47"]);
  });
});

describe("dates the assistant works out", () => {
  const empty = '{"x":1}';

  it("does not count a date or the time written with it", () => {
    for (const s of [
      "Scheduled for 21 October at 18:45.",
      "Scheduled for October 21, 2026 at 6:45 PM.",
      "I will post it on 2026-10-21 18:45.",
      "I will post it on 2026-10-21T18:45:00Z.",
      "The 21st of October at 18:45 suits your buyers.",
      "Posting at 18:45 on 21 Oct.",
      "Scheduled for 21/10/2026.",
      "Scheduled for 21.10.2026 18:45.",
      "سأنشره في 21 تشرين الأول الساعة 18:45.",
      "سأنشره في ٢١ أكتوبر 2026.",
      "ئەمە لە ٢١ی ئۆکتۆبەر بڵاودەکرێتەوە و ٢١ ئۆکتۆبەر ٢٠٢٦ باشە.",
    ]) {
      expect(ungroundedNumbers(s, empty), s).toEqual([]);
    }
  });

  it("still reads the figures around a date", () => {
    expect(ungroundedNumbers("On 21 October you will get 40 orders.", empty)).toEqual(["40"]);
    expect(ungroundedNumbers("Posting at 18:45 helps.", empty)).toEqual(["18"]);
    expect(ungroundedNumbers("Offer 10 percent off from 21 October.", empty)).toEqual(["10"]);
  });

  it("does not take a verb for a month", () => {
    expect(ungroundedNumbers("You may 12 times ask.", empty)).toEqual(["12"]);
    expect(ungroundedNumbers("About 15 may order again.", empty)).toEqual(["15"]);
  });

  it("allows the year of a date the data holds, and nothing else the date has", () => {
    const data = '{"orders":[{"createdAt":"2026-10-12T08:30:00.000Z"}],"count":3}';
    expect(ungroundedNumbers("Since 2026 you grew.", data)).toEqual([]);
    expect(ungroundedNumbers("In 2030 you grew.", data)).toEqual(["2030"]);
    expect(ungroundedNumbers("You had 12 orders.", data)).toEqual(["12"]);
    expect(ungroundedNumbers("You had 30 orders.", data)).toEqual(["30"]);
    expect(allowedSet(data).has("8")).toBe(false);
  });

  it("keeps a sentence with a computed date and cuts the one with an invented figure", () => {
    const answer = "I prepared the post for 21 October at 18:45. It will bring 40% more orders.";
    const out = guardAdviceDetailed(answer, empty, FALLBACK);
    expect(out.text).toBe("I prepared the post for 21 October at 18:45.");
    expect(out.dropped).toEqual(["It will bring 40% more orders."]);
  });
});

describe("what the loop gives as allowed text", () => {
  // The system prompt is not part of it: only tool results, the account snapshot and the owner's words.
  const allowed = ['{"orders":{"thisWeek":12}}', '{"features":{"plan":"PRO"}}', "owner said: my budget is 50,000 IQD"].join("\n");

  it("cuts the invented discount, budget and weekly count", () => {
    for (const s of ["Offer a 10% discount on the red dress.", "Try a 20% discount for the first 5 buyers.", "Spend 25,000 IQD on a boost.", "Post 7 times a week."]) {
      expect(guardAdvice(s, allowed, FALLBACK), s).toBe(FALLBACK);
    }
  });

  it("keeps the figures it was given", () => {
    expect(guardAdvice("You had 12 orders. A 50,000 IQD boost fits your budget.", allowed, FALLBACK)).toBe("You had 12 orders. A 50,000 IQD boost fits your budget.");
  });
});
