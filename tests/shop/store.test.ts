import { describe, expect, it } from "vitest";
import { pickStoreForAccount } from "@/lib/shop/store";

const s = (id: string, fbPageId: string | null, igUserId: string | null) => ({ id, fbPageId, igUserId });

describe("pickStoreForAccount", () => {
  it("links Instagram to the tenant's only store when that store has no Instagram yet", () => {
    expect(pickStoreForAccount([s("A", "PAGE", null)], "META_INSTAGRAM")).toBe("A");
  });
  it("links a Page to the only store that has Instagram but no Page", () => {
    expect(pickStoreForAccount([s("A", null, "IG")], "META_FACEBOOK")).toBe("A");
  });
  it("creates a new store when the slot is taken or the tenant has several stores", () => {
    expect(pickStoreForAccount([s("A", "PAGE", null)], "META_FACEBOOK")).toBeNull();
    expect(pickStoreForAccount([s("A", "P1", null), s("B", "P2", null)], "META_INSTAGRAM")).toBeNull();
    expect(pickStoreForAccount([], "META_FACEBOOK")).toBeNull();
  });
});
