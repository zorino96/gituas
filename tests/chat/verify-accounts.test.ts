import { beforeEach, describe, expect, it, vi } from "vitest";

// The read-back of group_accounts. The database is replaced; what is tested is the part that is ours: the groups are read again inside
// the workspace only (one query), a problem is a clear mismatch (the two accounts are in different groups, the old group still holds the
// moved account), what cannot be told says nothing, and every sentence exists in the person's three languages.

const db = vi.hoisted(() => ({ store: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: () => [], runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn(), loadAccountLists: vi.fn() }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import type { ToolCtx, VerifyReport } from "@/lib/chat/types";
import { ACCOUNT_VERIFIERS } from "@/lib/chat/verify/accounts";
import { verifierFor } from "@/lib/chat/verify/index";
import { parseVerify } from "@/lib/chat/verify/report";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: "g1", name: "NSFW", igUsername: null, fbPageId: null, igUserId: null, ...over });

/** What execute returns for the owner's case: the Page moved from g1 to g2. */
const moved = (over: Record<string, unknown> = {}) => ({
  facebook: "9001", instagram: "8002", moved: "facebook", toGroup: "g2", fromGroup: "g1", toName: "thesecretfile26", facebookName: "The Secret File", instagramName: "thesecretfile26", ...over,
});
const run = (data: unknown, c = ctx()): Promise<VerifyReport | null> =>
  ACCOUNT_VERIFIERS.group_accounts(c, { facebook: "The Secret File", instagram: "thesecretfile26" }, { text: "done", runId: "run1", data });
const all = (r: VerifyReport | null) => [...(r?.checked ?? []), ...(r?.problems ?? [])].join("\n");

/** After the move: the Page and @thesecretfile26 in g2, @hawalnoos alone in g1. */
const after = () => [
  row({ id: "g1", name: "NSFW", igUserId: "8001", igUsername: "hawalnoos" }),
  row({ id: "g2", name: "thesecretfile26", fbPageId: "9001", igUserId: "8002", igUsername: "thesecretfile26" }),
];

beforeEach(() => {
  vi.resetAllMocks();
  db.store.findMany.mockResolvedValue(after());
});

describe("the catalogue", () => {
  it("has a check for group_accounts only, and the shop's table finds it", async () => {
    expect(Object.keys(ACCOUNT_VERIFIERS)).toEqual(["group_accounts"]);
    expect(await verifierFor("shop", "group_accounts")).toBe(ACCOUNT_VERIFIERS.group_accounts);
    expect(await verifierFor("news", "group_accounts")).toBeUndefined();
    // the older tables still answer
    expect(await verifierFor("shop", "post_now")).toBeTypeOf("function");
    expect(await verifierFor("shop", "create_rule")).toBeTypeOf("function");
  });
});

describe("group_accounts", () => {
  it("says the two accounts are in one group now and the old group let go, reading the groups by account in this workspace", async () => {
    const r = await run(moved());
    expect(r?.status).toBe("ok");
    expect(r?.problems).toEqual([]);
    expect(r?.checked).toEqual([
      "The Facebook Page “The Secret File” and the Instagram account @thesecretfile26 are now in one group: the group “thesecretfile26”.",
      "The Facebook Page “The Secret File” is no longer in the group “NSFW”.",
    ]);
    expect(db.store.findMany).toHaveBeenCalledTimes(1);
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", OR: [{ fbPageId: "9001" }, { igUserId: "8002" }, { id: "g1" }] });
  });

  it("reads inside the session's workspace only", async () => {
    await run(moved(), ctx({ tenantId: "t8" }));
    expect(db.store.findMany.mock.calls[0][0].where.tenantId).toBe("t8");
  });

  it("is a problem when the two accounts are still in different groups (the slot did not move)", async () => {
    db.store.findMany.mockResolvedValue([
      row({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001" }),
      row({ id: "g2", name: "thesecretfile26", igUserId: "8002" }),
    ]);
    const r = await run(moved());
    expect(r?.status).toBe("problem");
    // the first problem is the one that matters: the accounts are apart (the old group still holding the Page is the same fact seen from the other side)
    expect(r?.problems).toEqual([
      "The Facebook Page “The Secret File” and the Instagram account @thesecretfile26 are still not in one group.",
      "The Facebook Page “The Secret File” is still in the group “NSFW”.",
    ]);
    expect(r?.fix).toContain("show_accounts");
    expect(r?.fix).toContain("group_accounts");
    expect(r?.checked).toEqual([]);
  });

  it("is a problem when an account is in no group at all", async () => {
    db.store.findMany.mockResolvedValue([row({ id: "g2", name: "thesecretfile26", igUserId: "8002" })]);
    expect((await run(moved()))?.status).toBe("problem");
    db.store.findMany.mockResolvedValue([]);
    expect((await run(moved()))?.status).toBe("problem");
  });

  it("without an old group to look at, being apart is the only problem", async () => {
    db.store.findMany.mockResolvedValue([row({ id: "g1", name: "NSFW", fbPageId: "9001" }), row({ id: "g2", name: "thesecretfile26", igUserId: "8002" })]);
    const r = await run(moved({ fromGroup: null, moved: null }));
    expect(r?.problems).toEqual(["The Facebook Page “The Secret File” and the Instagram account @thesecretfile26 are still not in one group."]);
  });

  it("is a problem when the old group still holds the account that was moved (even if the rows are inconsistent)", async () => {
    db.store.findMany.mockResolvedValue([
      row({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001" }),
      row({ id: "g2", name: "thesecretfile26", fbPageId: "9001", igUserId: "8002" }),
    ]);
    const r = await run(moved());
    expect(r?.status).toBe("problem");
    expect(r?.problems).toContain("The Facebook Page “The Secret File” is still in the group “NSFW”.");
    expect(r?.fix).toContain("group_accounts");
  });

  it("prints the names as the card and the done sentence spelled them (what execute hands over is the real, cut name, not the model's scrubbed copy)", async () => {
    const r = await run(moved({ facebookName: "Nawroz Shop 0750 123 4567" }));
    expect(r?.status).toBe("ok");
    expect(r?.checked?.[0]).toContain("“Nawroz Shop 0750 123 4567”");
    expect(all(r)).not.toContain("[number]");
  });

  it("checks an Instagram account that was moved the same way", async () => {
    db.store.findMany.mockResolvedValue([
      row({ id: "g1", name: "Page group", fbPageId: "9001", igUserId: "8002", igUsername: "thesecretfile26" }),
      row({ id: "g2", name: "Busy", fbPageId: "9002" }),
    ]);
    const r = await run(moved({ moved: "instagram", toGroup: "g1", fromGroup: "g2", toName: "Page group" }));
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual([
      "The Facebook Page “The Secret File” and the Instagram account @thesecretfile26 are now in one group: the group “Page group”.",
      "The Instagram account @thesecretfile26 is no longer in the group “Busy”.",
    ]);
    db.store.findMany.mockResolvedValue([
      row({ id: "g1", name: "Page group", fbPageId: "9001", igUserId: "8002" }),
      row({ id: "g2", name: "Busy", fbPageId: "9002", igUserId: "8002" }),
    ]);
    const bad = await run(moved({ moved: "instagram", toGroup: "g1", fromGroup: "g2" }));
    expect(bad?.problems).toEqual(["The Instagram account @thesecretfile26 is still in the group “Busy”."]);
  });

  it("an account that was in no group has nothing to let go of: only the join is checked", async () => {
    db.store.findMany.mockResolvedValue([row({ id: "g1", name: "Page group", fbPageId: "9001", igUserId: "8002" })]);
    const r = await run(moved({ moved: "instagram", toGroup: "g1", fromGroup: null }));
    expect(r?.status).toBe("ok");
    expect(r?.checked).toHaveLength(1);
    expect(db.store.findMany.mock.calls[0][0].where.OR).toEqual([{ fbPageId: "9001" }, { igUserId: "8002" }]);
  });

  it("a group that has vanished says nothing about the old side, and a nothing-changed run just confirms the join", async () => {
    db.store.findMany.mockResolvedValue([row({ id: "g2", name: "thesecretfile26", fbPageId: "9001", igUserId: "8002" })]);
    const gone = await run(moved());
    expect(gone?.status).toBe("ok");
    expect(gone?.checked).toHaveLength(1);
    const same = await run(moved({ moved: null, fromGroup: null, nothingChanged: true }));
    expect(same?.status).toBe("ok");
    expect(same?.checked).toHaveLength(1);
  });

  it("falls back to the stored group name when the run did not carry one, and to the handle when a group has no name", async () => {
    db.store.findMany.mockResolvedValue([row({ id: "g2", name: "", igUsername: "handle", fbPageId: "9001", igUserId: "8002" })]);
    const r = await run(moved({ toName: undefined, fromGroup: null, moved: null }));
    expect(r?.checked[0]).toContain("“@handle”");
  });

  it("says nothing when it cannot tell: no ids from the tool (a name the model wrote proves nothing)", async () => {
    expect(await run(undefined)).toBeNull();
    expect(await run({})).toBeNull();
    expect(await run({ facebook: "The Secret File", instagram: "" })).toBeNull();
    expect(await run("text")).toBeNull();
    expect(db.store.findMany).not.toHaveBeenCalled();
  });

  it("a report always survives the report parser unchanged in meaning", async () => {
    const ok = parseVerify(await run(moved()));
    expect(ok?.status).toBe("ok");
    db.store.findMany.mockResolvedValue([]);
    const bad = parseVerify(await run(moved()));
    expect(bad?.status).toBe("problem");
    expect(bad?.fix).toBeTruthy();
  });

  it("speaks each language with its own letters, and every sentence is there in all three", async () => {
    const KURDISH_ONLY = /[ێۆڕڵەیکگپچژڤ]/u;
    const ARABIC_ONLY = /[يكىةؤ]/u;
    const seen: Record<string, VerifyReport> = {};
    const bad: Record<string, VerifyReport> = {};
    const oldHolds = [
      row({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001" }),
      row({ id: "g2", name: "thesecretfile26", fbPageId: "9001", igUserId: "8002" }),
    ];
    for (const lang of ["ckb", "ar", "en"] as const) {
      db.store.findMany.mockResolvedValue(after());
      seen[lang] = (await run(moved(), ctx({ lang }))) as VerifyReport;
      db.store.findMany.mockResolvedValue(oldHolds);
      bad[lang] = (await run(moved(), ctx({ lang }))) as VerifyReport;
      expect(seen[lang].checked, lang).toHaveLength(2);
      expect(bad[lang].problems.length, lang).toBeGreaterThanOrEqual(1);
    }
    for (const t of [...seen.ar.checked, ...bad.ar.problems]) expect(t, t).not.toMatch(KURDISH_ONLY);
    for (const t of [...seen.ckb.checked, ...bad.ckb.problems]) {
      expect(t, t).not.toMatch(ARABIC_ONLY);
      expect(t, t).toMatch(KURDISH_ONLY);
    }
    // the three languages say three different things
    expect(new Set([seen.ckb.checked[0], seen.ar.checked[0], seen.en.checked[0]]).size).toBe(3);
    expect(new Set([bad.ckb.problems[0], bad.ar.problems[0], bad.en.problems[0]]).size).toBe(3);
    // the names are in every language's sentence
    for (const lang of ["ckb", "ar", "en"] as const) expect(seen[lang].checked.join("\n"), lang).toContain("The Secret File");
  });
});
