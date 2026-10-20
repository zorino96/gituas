import { beforeEach, describe, expect, it, vi } from "vitest";

// A store is named after its account when it is made ("NSFW"); the Page is renamed later ("The Secret File"). What the owner reads on a card
// and what a video carries as its brand name is the name the connected accounts have now.

const db = vi.hoisted(() => ({ oAuthCredential: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { accountsPhraseOf, brandNameOf } from "@/lib/shop/brand-name";

const store = { tenantId: "t1", name: "NSFW", igUsername: null as string | null, fbPageId: "fb1" as string | null, igUserId: null as string | null };
const FB = { provider: "META_FACEBOOK", providerAccountId: "fb1", providerAccountName: "The Secret File" };
const IG = { provider: "META_INSTAGRAM", providerAccountId: "ig1", providerAccountName: "@thesecretfile26" };

beforeEach(() => {
  vi.clearAllMocks();
  db.oAuthCredential.findMany.mockResolvedValue([FB, IG]);
});

describe("brandNameOf", () => {
  it("is the Page's name now, not the name the store was given", async () => {
    expect(await brandNameOf(store)).toBe("The Secret File");
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", providerAccountId: { in: ["fb1"] } });
  });
  it("falls back to the Instagram handle, then to the stored name", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([IG]);
    expect(await brandNameOf({ ...store, fbPageId: null, igUserId: "ig1" })).toBe("@thesecretfile26");
    expect(await brandNameOf({ ...store, fbPageId: null, igUserId: "ig1", igUsername: "thesecretfile26" })).toBe("@thesecretfile26");
    expect(await brandNameOf({ ...store, fbPageId: null })).toBe("NSFW");
  });
  it("keeps the stored name when the names cannot be read", async () => {
    db.oAuthCredential.findMany.mockRejectedValue(new Error("down"));
    expect(await brandNameOf(store)).toBe("NSFW");
  });
  it("is scoped to the workspace and never reads an account that is not the store's", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, providerAccountId: "other", providerAccountName: "Someone else" }]);
    expect(await brandNameOf(store)).toBe("NSFW");
  });
});

describe("accountsPhraseOf", () => {
  it("names the Page and the Instagram account a change covers", async () => {
    expect(await accountsPhraseOf({ ...store, igUserId: "ig1", igUsername: "thesecretfile26" })).toBe("The Secret File + @thesecretfile26");
    expect(await accountsPhraseOf({ ...store, igUserId: "ig1" })).toBe("The Secret File + @thesecretfile26");
  });
  it("names one account when there is one, and the stored name when there is none", async () => {
    expect(await accountsPhraseOf(store)).toBe("The Secret File");
    expect(await accountsPhraseOf({ ...store, fbPageId: null })).toBe("NSFW");
    expect(await accountsPhraseOf({ ...store, fbPageId: null, name: "", igUsername: "zana" })).toBe("@zana");
  });
});
