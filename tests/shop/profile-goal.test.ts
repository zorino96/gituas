import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/setup/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/app/setup" }));

import { stepsFor } from "@/app/app/setup/setup-client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { choiceOf, GOAL_CHOICES, GOALS, isAudienceGoal, sanitizePatch } from "@/lib/shop/profile-shared";

// The interview asks how the page earns for its owner, with three choices: selling, monetizing the content, or something else.

describe("the goal question", () => {
  it("offers three choices: selling, monetizing and other", () => {
    expect([...GOAL_CHOICES]).toEqual(["sell", "monetize", "other"]);
  });

  it("has a label for every goal in every language", () => {
    for (const [lang, d] of [["ckb", ckb], ["ar", ar], ["en", en]] as const) {
      const s = d.setup as unknown as Record<string, string>;
      for (const g of GOALS) expect(s[`goal_${g}`]?.trim(), `${lang}.goal_${g}`).toBeTruthy();
    }
    expect(ckb.setup.goal_monetize).toContain("مۆنەتایز");
    expect(ckb.setup.goal_sell).toContain("فرۆشتن");
  });

  it("saves monetize, and still reads the goals older profiles hold", () => {
    expect(sanitizePatch({ goal: "monetize" }).goal).toBe("monetize");
    expect(sanitizePatch({ goal: "grow" }).goal).toBe("grow");
    expect(sanitizePatch({ goal: "leads" }).goal).toBe("leads");
    expect(sanitizePatch({ goal: "bank" }).goal).toBeNull();
  });

  it("shows an older goal as the choice it stands for, and keeps the three as they are", () => {
    expect(choiceOf("grow")).toBe("monetize");
    expect(choiceOf("leads")).toBe("sell");
    expect(choiceOf("sell")).toBe("sell");
    expect(choiceOf("monetize")).toBe("monetize");
    expect(choiceOf("other")).toBe("other");
    expect(choiceOf(null)).toBeNull();
  });

  it("spares people who earn from their content the questions about buyers", () => {
    expect(isAudienceGoal("monetize")).toBe(true);
    expect(isAudienceGoal("grow")).toBe(true);
    expect(isAudienceGoal("sell")).toBe(false);
    expect(stepsFor("monetize", false)).toEqual(["goal", "what", "who", "tone"]);
    expect(stepsFor("sell", false)).toEqual(["goal", "what", "who", "where", "facts", "tone"]);
    expect(stepsFor("other", true)).toContain("where");
  });
});
