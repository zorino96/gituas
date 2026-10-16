import { describe, expect, it } from "vitest";

import { allowedNumbers, allowedWords, buildUser, type SmartFacts, type SmartInput } from "@/lib/shop/smart";

const facts: SmartFacts = { shop: "Shop", tagline: null, delivery: [], asked: null, catalog: [], orderLink: null };
const input = (f: SmartFacts): SmartInput => ({ kind: "dm_followup", lang: "ckb", brief: "", facts: f, message: "نرخی چەندە؟" });

describe("the owner's profile in a smart reply", () => {
  it("is part of the prompt only when there is one", () => {
    expect(buildUser(input(facts))).not.toContain("About the business");
    const withProfile = buildUser(input({ ...facts, profile: ["Business type: beauty and care.", "Tone: warm and friendly."] }));
    expect(withProfile).toContain("About the business (confirmed by the owner):");
    expect(withProfile).toContain("Business type: beauty and care.");
  });

  it("lets a number in a confirmed fact be said, but never one from the description lines", () => {
    const f: SmartFacts = { ...facts, profile: ["What they offer: 24 hour service from 15000", "- Exchange within 7 days"] };
    const nums = allowedNumbers(f, "");
    expect(nums.has("7")).toBe(true);
    expect(nums.has("24")).toBe(false);
    expect(nums.has("15000")).toBe(false);
    expect(nums.has("5000")).toBe(false);
  });

  it("lets the words the owner used be said, so a correct reply is not thrown away", () => {
    const f: SmartFacts = { ...facts, profile: ["- Money back within seven days"] };
    expect(allowedWords(f, "").has("seven")).toBe(true);
    expect(allowedWords({ ...facts, profile: ["What they offer: seven day service"] }, "").has("seven")).toBe(false);
    expect(allowedWords(facts, "").has("seven")).toBe(false);
  });
});
