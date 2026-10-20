import { beforeEach, describe, expect, it, vi } from "vitest";

// A store keeps the name its account had when it was made; the name follows the accounts' names, in this workspace only.

const db = vi.hoisted(() => ({
  store: { updateMany: vi.fn(), findMany: vi.fn() },
  oAuthCredential: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { healStoreNames, healTenantStoreNames, wantedName } from "@/lib/shop/store-names";

const NSFW = { id: "s1", name: "NSFW", igUsername: null, fbPageId: "fb1", igUserId: null };
const ACCOUNTS = [
  { provider: "META_FACEBOOK", providerAccountId: "fb1", providerAccountName: "The Secret File" },
  { provider: "META_INSTAGRAM", providerAccountId: "ig1", providerAccountName: "thesecretfile26" },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.store.updateMany.mockResolvedValue({ count: 1 });
});

describe("wantedName", () => {
  it("is the Page's name, else the Instagram handle, else nothing", () => {
    expect(wantedName(NSFW, ACCOUNTS)).toBe("The Secret File");
    expect(wantedName({ ...NSFW, fbPageId: null, igUserId: "ig1" }, ACCOUNTS)).toBe("@thesecretfile26");
    expect(wantedName({ ...NSFW, fbPageId: null, igUserId: "ig1", igUsername: "zana" }, ACCOUNTS)).toBe("@zana");
    expect(wantedName({ ...NSFW, fbPageId: null }, ACCOUNTS)).toBeNull();
    expect(wantedName(NSFW, [])).toBeNull();
  });
});

describe("healStoreNames", () => {
  it("renames a store whose name is not its Page's name, only while the old name is still there, in this workspace", async () => {
    const out = await healStoreNames("t1", [NSFW], ACCOUNTS);
    expect(out.get("s1")).toBe("The Secret File");
    expect(db.store.updateMany).toHaveBeenCalledWith({ where: { id: "s1", tenantId: "t1", name: "NSFW" }, data: { name: "The Secret File" } });
  });
  it("leaves a store that is already right, and a store with no account that tells", async () => {
    expect((await healStoreNames("t1", [{ ...NSFW, name: "The Secret File" }, { ...NSFW, id: "s2", fbPageId: null }], ACCOUNTS)).size).toBe(0);
    expect(db.store.updateMany).not.toHaveBeenCalled();
  });
  it("skips a rename that lost the race, or failed", async () => {
    db.store.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await healStoreNames("t1", [NSFW], ACCOUNTS)).size).toBe(0);
    db.store.updateMany.mockRejectedValueOnce(new Error("down"));
    expect((await healStoreNames("t1", [NSFW], ACCOUNTS)).size).toBe(0);
  });
});

describe("healTenantStoreNames", () => {
  it("reads the workspace's stores and its accounts' names, then renames", async () => {
    db.store.findMany.mockResolvedValue([NSFW]);
    db.oAuthCredential.findMany.mockResolvedValue(ACCOUNTS);
    const out = await healTenantStoreNames("t1");
    expect(out.get("s1")).toBe("The Secret File");
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", providerAccountId: { in: ["fb1"] } });
  });
  it("does nothing for a workspace with no account", async () => {
    db.store.findMany.mockResolvedValue([{ ...NSFW, fbPageId: null }]);
    expect((await healTenantStoreNames("t1")).size).toBe(0);
    expect(db.oAuthCredential.findMany).not.toHaveBeenCalled();
  });
});
