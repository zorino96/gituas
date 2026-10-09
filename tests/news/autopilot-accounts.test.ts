import { describe, expect, it } from "vitest";

import { autoAccountsFor } from "@/lib/news/autopilot-settings";

describe("autoAccountsFor", () => {
  it("groups saved FB/IG account ids per target and drops anything else", () => {
    expect(autoAccountsFor(["FB:111", "FB:222", "IG:333", "FB:111", "TT:9", "YT:1", "FB:abc", 5, null])).toEqual({ FB: ["111", "222"], IG: ["333"] });
  });

  it("is undefined (the default accounts) when nothing valid was saved", () => {
    expect(autoAccountsFor([])).toBeUndefined();
    expect(autoAccountsFor(null)).toBeUndefined();
    expect(autoAccountsFor(["nope"])).toBeUndefined();
  });
});
