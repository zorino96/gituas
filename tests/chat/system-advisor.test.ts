import { afterEach, describe, expect, it } from "vitest";

import { hasProfileState, systemPrompt } from "@/lib/chat/system";

// The advisor rules in the chat's system prompt: present exactly when the account data carries the setup interview's fields (that is, only
// while BUSINESS_PROFILE_ENABLED is on), and never questioning what an account is for.

afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

const FEATURES = { max: false, video: false, pictures: false };
const prompt = (state: unknown, advisor?: boolean) =>
  systemPrompt({
    lang: "en",
    uiNames: { today: "Today", settings: "Settings" },
    state,
    features: FEATURES,
    attachments: [],
    advisor,
    buttons: { confirm: "Confirm", cancel: "Cancel" },
    nowBaghdad: "2026-10-25 10:00",
  });

const withInterview = (setupInterview: "done" | "not done yet") => ({ shops: [{ name: "Shop", plan: "FREE", setupInterview }] });

describe("hasProfileState", () => {
  it("is true when a shop's data carries the setup interview, done or not", () => {
    expect(hasProfileState(withInterview("done"))).toBe(true);
    expect(hasProfileState(withInterview("not done yet"))).toBe(true);
    expect(hasProfileState({ shops: [{ name: "A" }, { name: "B", setupInterview: "done" }] })).toBe(true);
  });

  it("is false when the interview is switched off (the field is missing), whatever else the data holds", () => {
    expect(hasProfileState({ shops: [{ name: "Shop", plan: "FREE" }] })).toBe(false);
    expect(hasProfileState({ shops: [] })).toBe(false);
    expect(hasProfileState({})).toBe(false);
    expect(hasProfileState({ shops: "x" })).toBe(false);
    expect(hasProfileState(null)).toBe(false);
    expect(hasProfileState(undefined)).toBe(false);
    expect(hasProfileState({ shops: [null, 3] })).toBe(false);
  });
});

describe("the advisor rules", () => {
  it("are in the prompt when the advisor is on, and not when it is off", () => {
    const on = prompt(withInterview("done"), true);
    const off = prompt({ shops: [{ name: "Shop" }] }, false);
    // The words the rule must keep, whatever else is added to it (the final wording also names get_business_picture).
    for (const rule of [/how to sell more/, /never predict/i, /never suggest spending more than the owner said/i, /THEIR kind of work/]) {
      expect(on).toMatch(rule);
      expect(off).not.toMatch(rule);
    }
  });

  it("send the model to the read tools for the numbers, never to memory", () => {
    const on = prompt(withInterview("done"), true);
    expect(on).toMatch(/orders_summary/);
    expect(on).toMatch(/read tools/);
  });

  it("say once where the setup questions are when the interview is not done yet", () => {
    expect(prompt(withInterview("not done yet"), true)).toMatch(/"setupInterview" is "not done yet", say once/);
  });

  it("follow the advisor flag the loop computes from the account data", () => {
    // loop.ts passes advisor: hasProfileState(snapshot.state)
    expect(prompt(withInterview("done"), hasProfileState(withInterview("done")))).toMatch(/how to sell more/);
    expect(prompt({ shops: [{ name: "Shop" }] }, hasProfileState({ shops: [{ name: "Shop" }] }))).not.toMatch(/how to sell more/);
  });

  it("never question what the account is used for, with the advisor on or off", () => {
    for (const advisor of [true, false]) {
      const p = prompt(withInterview("done"), advisor);
      expect(p).toMatch(/You never ask why they use Gituas or judge what they use it for/);
      expect(p).toMatch(/What the owner wants to do with their own accounts is theirs to decide/);
    }
  });

  it("keep customer words as data, and keep the numbers of the account in the prompt", () => {
    const p = prompt(withInterview("done"), true);
    expect(p).toMatch(/Never invent prices, discounts, dates, delivery promises or guarantees/);
    expect(p).toContain(JSON.stringify(withInterview("done")));
  });

  it("starts from fresh numbers and forbids new numbers, predictions and spending advice", () => {
    const p = prompt(withInterview("done"), true);
    expect(p).toContain("get_business_picture");
    expect(p).toContain("Never calculate a new number");
    expect(p).toMatch(/Never predict results/);
    expect(p).toMatch(/Never suggest spending more than the owner said/);
    expect(p).toMatch(/never question what the account is used for/);
  });
});
