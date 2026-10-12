import { describe, expect, it } from "vitest";

import { clampAccounts, MAX_ACCOUNTS_PER_POST } from "@/lib/merchant/accounts-policy";

describe("clampAccounts", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  it("keeps up to the per-post maximum for Facebook, Instagram and YouTube, in order", () => {
    for (const target of ["FB", "IG", "YT"] as const) {
      expect(clampAccounts(ids, target)).toEqual(ids.slice(0, MAX_ACCOUNTS_PER_POST));
    }
  });

  it("keeps one account for TikTok", () => {
    expect(clampAccounts(ids, "TT")).toEqual(["a"]);
  });

  it("leaves a short list as it is", () => {
    expect(clampAccounts(["a", "b"], "FB")).toEqual(["a", "b"]);
    expect(clampAccounts([], "IG")).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const given = [...ids];
    clampAccounts(given, "FB");
    expect(given).toEqual(ids);
  });
});
