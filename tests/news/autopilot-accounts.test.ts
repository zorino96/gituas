import { describe, expect, it } from "vitest";

import { autoAccountsFor, MAX_AUTO_ACCOUNTS } from "@/lib/news/autopilot-settings";

describe("autoAccountsFor", () => {
  it("keeps at most three accounts per platform, in the order they were saved", () => {
    expect(MAX_AUTO_ACCOUNTS).toBe(3);
    expect(autoAccountsFor(["FB:101", "FB:102", "FB:103", "FB:104", "FB:105", "IG:207", "IG:208", "IG:209", "IG:210"])).toEqual({
      FB: ["101", "102", "103"],
      IG: ["207", "208", "209"],
    });
  });

  it("groups saved FB/IG account ids per target and drops anything else", () => {
    expect(autoAccountsFor(["FB:111", "FB:222", "IG:333", "FB:111", "TT:9", "YT:1", "FB:abc", 5, null])).toEqual({ FB: ["111", "222"], IG: ["333"] });
  });

  it("is undefined (the default accounts) when nothing valid was saved", () => {
    expect(autoAccountsFor([])).toBeUndefined();
    expect(autoAccountsFor(null)).toBeUndefined();
    expect(autoAccountsFor(["nope"])).toBeUndefined();
  });
});
