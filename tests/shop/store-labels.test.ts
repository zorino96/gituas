import { beforeEach, describe, expect, it, vi } from "vitest";

// The pickers of the shop screens say which accounts a store holds, by the names they have now, and leave out an empty shell.

const db = vi.hoisted(() => ({ oAuthCredential: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { storeChoices, storeLabelMap } from "@/lib/shop/store-labels";

const NSFW = { id: "s1", name: "NSFW", igUsername: null, fbPageId: "fb1", igUserId: "ig1" };
const HAW = { id: "s2", name: "Hawalnoos", igUsername: null, fbPageId: null, igUserId: null };
const TSF = { id: "s3", name: "@thesecretfile26", igUsername: "thesecretfile26", fbPageId: null, igUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.oAuthCredential.findMany.mockResolvedValue([
    { provider: "META_FACEBOOK", providerAccountId: "fb1", providerAccountName: "The Secret File" },
    { provider: "META_INSTAGRAM", providerAccountId: "ig1", providerAccountName: "@thesecretfile26" },
  ]);
});

describe("store pickers", () => {
  it("name the accounts a store holds, not the name it was given when it was made", async () => {
    const labels = await storeLabelMap("t1", [NSFW, HAW, TSF]);
    expect(labels.get("s1")).toBe("The Secret File + @thesecretfile26");
    expect(labels.get("s2")).toBe("Hawalnoos");
    expect(labels.get("s3")).toBe("@thesecretfile26");
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", providerAccountId: { in: ["fb1", "ig1"] } });
  });

  it("leave out a store that holds no account while another one does, and keep the one being looked at", async () => {
    expect(await storeChoices("t1", [NSFW, HAW, TSF])).toEqual([{ id: "s1", name: "The Secret File + @thesecretfile26" }]);
    expect((await storeChoices("t1", [NSFW, HAW, TSF], "s2")).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("keep every store when none holds an account", async () => {
    expect((await storeChoices("t1", [HAW, TSF])).map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("fall back to the stored name when the names cannot be read", async () => {
    db.oAuthCredential.findMany.mockRejectedValue(new Error("down"));
    const labels = await storeLabelMap("t1", [{ ...NSFW, igUserId: null }]);
    expect(labels.get("s1")).toBe("Facebook");
  });
});
