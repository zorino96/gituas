import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A creator (someone who earns from content) is not a seller with fewer products: who the owner is comes from their own answer.

const db = vi.hoisted(() => ({ businessProfile: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { loadOwnerType, ownerTypeOf } from "@/lib/shop/owner-type";

describe("ownerTypeOf", () => {
  it("is a creator when the goals are about the audience", () => {
    expect(ownerTypeOf(["monetize"])).toBe("creator");
    expect(ownerTypeOf(["grow"])).toBe("creator");
    expect(ownerTypeOf(["monetize", "grow", null])).toBe("creator");
  });
  it("is a seller as soon as any group sells", () => {
    expect(ownerTypeOf(["sell"])).toBe("seller");
    expect(ownerTypeOf(["leads"])).toBe("seller");
    expect(ownerTypeOf(["monetize", "sell"])).toBe("seller");
  });
  it("stays unknown when nothing is said, or the answer is 'other'", () => {
    expect(ownerTypeOf([])).toBe("unknown");
    expect(ownerTypeOf([null, undefined])).toBe("unknown");
    expect(ownerTypeOf(["other"])).toBe("unknown");
    expect(ownerTypeOf(["bank"])).toBe("unknown");
  });
});

describe("loadOwnerType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUSINESS_PROFILE_ENABLED = "1";
  });
  afterEach(() => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
  });

  it("reads the goals of this workspace's groups, and only those", async () => {
    db.businessProfile.findMany.mockResolvedValue([{ goal: "monetize" }]);
    expect(await loadOwnerType("t1")).toBe("creator");
    expect(db.businessProfile.findMany.mock.calls[0][0].where).toEqual({ store: { tenantId: "t1" } });
  });
  it("is unknown while the setup questions are switched off, and when the read fails", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    expect(await loadOwnerType("t1")).toBe("unknown");
    expect(db.businessProfile.findMany).not.toHaveBeenCalled();
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockRejectedValue(new Error("down"));
    expect(await loadOwnerType("t1")).toBe("unknown");
  });
});
