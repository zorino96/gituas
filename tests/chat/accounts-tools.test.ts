import { beforeEach, describe, expect, it, vi } from "vitest";

// The account tools of the chat: show_accounts (read) and group_accounts (write). The database and the account lists are replaced; what
// is tested is the part that is ours: the model reads names and never ids, a group is named the way the app names it, every account is
// found only among this workspace's connected ones, the move goes in the one direction that has room (and the card says which), every
// refusal explains itself, the change is made in one transaction on rows that still look as the card showed them, nothing outside the
// workspace is touched, and every sentence exists in the person's three languages.

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
const data = vi.hoisted(() => ({ loadAccountLists: vi.fn(), loadConnections: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: () => [], runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => data);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { decide } from "@/lib/chat/guard";
import { riskOf, toolSpecs, toolsFor } from "@/lib/chat/registry";
import { systemPrompt } from "@/lib/chat/system";
import { groupLabel, planRank, type GroupRow, ACCOUNT_READ_TOOLS } from "@/lib/chat/tools/reads-accounts";
import { ACCOUNT_WRITE_TOOLS, planRegroup } from "@/lib/chat/tools/writes-accounts";
import { NEW } from "@/lib/chat/tools/writes-words";
import { ToolRefusal, type Card, type ToolCtx, type WriteTool } from "@/lib/chat/types";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});

const acc = (id: string, name: string) => ({ id, name, avatarUrl: null });
const lists = (over: Record<string, unknown> = {}) => ({
  META_FACEBOOK: [acc("9001", "The Secret File"), acc("9002", "Other Page")],
  META_INSTAGRAM: [acc("8001", "hawalnoos"), acc("8002", "thesecretfile26")],
  TIKTOK: [acc("7001", "tiktoker")],
  YOUTUBE: [acc("6001", "My Channel")],
  ...over,
});
const group = (over: Partial<GroupRow> = {}): GroupRow => ({
  id: "g1", name: "NSFW", igUsername: null, fbPageId: null, igUserId: null, plan: "FREE", planPaidUntil: null, createdAt: new Date("2026-01-01T00:00:00Z"),
  automationEnabled: false, autoMode: "OFF", videoAutoMode: "OFF", pausedReason: null, ...over,
});
/** The owner's real case: the Page "The Secret File" sits with @hawalnoos in one group, @thesecretfile26 is its own group. */
const ownerCase = () => [
  group({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos" }),
  group({ id: "g2", name: "thesecretfile26", igUserId: "8002", igUsername: "thesecretfile26", createdAt: new Date("2026-02-01T00:00:00Z") }),
];

const connected = (over: Record<string, string | undefined> = {}) => {
  const one = (id: string | undefined, name: string) => (id ? { connected: true, name, accountId: id } : { connected: false });
  return {
    META_FACEBOOK: one(over.fb ?? "9001", "The Secret File"),
    META_INSTAGRAM: one(over.ig ?? "8001", "hawalnoos"),
    TIKTOK: one(over.tt ?? "7001", "tiktoker"),
    YOUTUBE: one(over.yt, "My Channel"),
  };
};

const show = ACCOUNT_READ_TOOLS[0];
const tool = (): WriteTool => ACCOUNT_WRITE_TOOLS[0];
const parse = (args: unknown) => tool().schema.parse(args);
const cardOf = (args: unknown, c = ctx()): Promise<Card> => tool().card(c, parse(args));
const run = (args: unknown, c = ctx()) => tool().execute(c, parse(args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};
const lineOf = (card: Card, label: string) => card.lines.filter((l) => l.label === label).map((l) => l.value);
const all = (card: Card) => card.lines.map((l) => l.value).join("\n");
/** The invisible isolates around a handle in right-to-left text are not part of what the person reads. */
const plain = (s: string) => s.replace(new RegExp(`[${String.fromCodePoint(0x2066)}${String.fromCodePoint(0x2069)}]`, "g"), "");

function world(groups: GroupRow[], l = lists()) {
  data.loadAccountLists.mockResolvedValue(l);
  db.store.findMany.mockResolvedValue(groups);
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.store.updateMany.mockResolvedValue({ count: 1 });
  db.auditLog.create.mockResolvedValue({});
  data.loadConnections.mockResolvedValue(connected());
  world(ownerCase());
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the catalogue", () => {
  it("show_accounts is a read for everyone in the shop, group_accounts a standing change for owners and admins", () => {
    expect(show).toMatchObject({ name: "show_accounts", risk: "read", permission: "read", kinds: ["shop"] });
    expect(tool()).toMatchObject({ name: "group_accounts", risk: "standing", permission: "configure", kinds: ["shop"] });
    expect(ACCOUNT_READ_TOOLS).toHaveLength(1);
    expect(ACCOUNT_WRITE_TOOLS).toHaveLength(1);
  });

  it("is offered to the right roles and never in a news desk", () => {
    expect(toolsFor([...ACCOUNT_READ_TOOLS, ...ACCOUNT_WRITE_TOOLS], "shop", "OWNER").map((t) => t.name)).toEqual(["show_accounts", "group_accounts"]);
    expect(toolsFor([...ACCOUNT_READ_TOOLS, ...ACCOUNT_WRITE_TOOLS], "shop", "ADMIN").map((t) => t.name)).toEqual(["show_accounts", "group_accounts"]);
    expect(toolsFor([...ACCOUNT_READ_TOOLS, ...ACCOUNT_WRITE_TOOLS], "shop", "MEMBER").map((t) => t.name)).toEqual(["show_accounts"]);
    expect(toolsFor([...ACCOUNT_READ_TOOLS, ...ACCOUNT_WRITE_TOOLS], "news", "OWNER")).toEqual([]);
  });

  it("group_accounts always needs a card, whatever the autonomy setting", () => {
    for (const autonomy of ["ASK", "LOW", "ALL"] as const) {
      expect(decide({ risk: riskOf(tool(), {}), autonomy, tainted: false }), autonomy).toBe("confirm");
    }
  });

  it("show_accounts takes no arguments and group_accounts only its three", () => {
    expect(show.schema.safeParse({}).success).toBe(true);
    expect(show.schema.safeParse({ x: 1 }).success).toBe(false);
    expect(tool().schema.safeParse({ facebook: "a", instagram: "b", into: "facebook", extra: 1 }).success).toBe(false);
    expect(tool().schema.safeParse({ into: "both" }).success).toBe(false);
    const props = Object.keys((toolSpecs([tool()])[0].function.parameters as { properties: Record<string, unknown> }).properties);
    expect(props.sort()).toEqual(["facebook", "instagram", "into"]);
  });

  it("keeps the model's tool specs small (both together stay under 4 KB: they ride along on every model call)", () => {
    expect(JSON.stringify(toolSpecs([...ACCOUNT_READ_TOOLS, ...ACCOUNT_WRITE_TOOLS])).length).toBeLessThan(4000);
  });

  it("has a label in every language", () => {
    for (const t of [show, tool()]) for (const lang of ["ckb", "ar", "en"] as const) expect(t.label(lang).length, `${t.name}/${lang}`).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("groupLabel and planRank", () => {
  it("names a group by its name, else its Instagram handle, else its place", () => {
    const gs = [group({ id: "a", name: "  Shop   one " }), group({ id: "b", name: "", igUsername: "handle" }), group({ id: "c", name: "" })];
    expect(gs.map((g) => groupLabel(g, gs))).toEqual(["Shop one", "@handle", "#3"]);
  });

  it("ranks the plans, and a plan whose days ran out counts as Free", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(planRank(group({ plan: "PRO" }), now)).toBeGreaterThan(planRank(group({ plan: "MERCHANT" }), now));
    expect(planRank(group({ plan: "PRO", planPaidUntil: new Date("2026-10-01T00:00:00Z") }), now)).toBe(0);
    expect(planRank(group({ plan: "PRO", planPaidUntil: new Date("2026-11-01T00:00:00Z") }), now)).toBe(planRank(group({ plan: "PRO" }), now));
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("show_accounts", () => {
  it("returns every platform by name, which one the chat uses and which group holds each Page and Instagram account", async () => {
    const r = await show.run(ctx(), {});
    const d = r.data as { platforms: Record<string, { name: string; usedByChat: boolean; group?: string | null }[]>; groups: { name: string; facebook: string | null; instagram: string | null }[] };
    expect(d.platforms.facebook).toEqual([
      { name: "The Secret File", usedByChat: true, group: "NSFW" },
      { name: "Other Page", usedByChat: false, group: null },
    ]);
    expect(d.platforms.instagram).toEqual([
      { name: "hawalnoos", usedByChat: true, group: "NSFW" },
      { name: "thesecretfile26", usedByChat: false, group: "thesecretfile26" },
    ]);
    // TikTok and YouTube have no groups: no `group` key at all.
    expect(d.platforms.tiktok).toEqual([{ name: "tiktoker", usedByChat: true }]);
    expect(d.platforms.youtube).toEqual([{ name: "My Channel", usedByChat: false }]);
    expect(d.groups).toEqual([
      { name: "NSFW", facebook: "The Secret File", instagram: "hawalnoos" },
      { name: "thesecretfile26", facebook: null, instagram: "thesecretfile26" },
    ]);
  });

  it("follows the account the chat was switched to (loadConnections is already narrowed to the person's choice)", async () => {
    data.loadConnections.mockResolvedValue(connected({ fb: "9002", ig: "8002", tt: "no-such-channel", yt: "6001" }));
    const d = (await show.run(ctx(), {})).data as { platforms: Record<string, { name: string; usedByChat: boolean }[]> };
    expect(d.platforms.facebook.map((a) => a.usedByChat)).toEqual([false, true]);
    expect(d.platforms.instagram.map((a) => a.usedByChat)).toEqual([false, true]);
    expect(d.platforms.tiktok.map((a) => a.usedByChat)).toEqual([false]);
    expect(d.platforms.youtube.map((a) => a.usedByChat)).toEqual([true]);
  });

  it("gives the model no id at all, only names", async () => {
    const text = JSON.stringify((await show.run(ctx(), {})).data);
    for (const id of ["9001", "9002", "8001", "8002", "7001", "6001", "g1", "g2"]) expect(text, id).not.toContain(id);
  });

  it("cuts long names to 60 characters and takes phone numbers and addresses out of them", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", `${"A very long page name ".repeat(10)}`), acc("9002", "Call 07501234567 now")] }));
    const d = (await show.run(ctx(), {})).data as { platforms: { facebook: { name: string }[] } };
    expect(Array.from(d.platforms.facebook[0].name).length).toBeLessThanOrEqual(60);
    expect(d.platforms.facebook[1].name).not.toContain("07501234567");
  });

  it("says plainly when a group still holds an account that is no longer connected", async () => {
    world([group({ id: "g1", name: "Old", fbPageId: "9999", igUserId: "5555", igUsername: "gone" })]);
    const d = (await show.run(ctx(), {})).data as { groups: { facebook: string | null; instagram: string | null }[] };
    expect(d.groups[0].facebook).toBe("(not connected now)");
    expect(d.groups[0].instagram).toBe("@gone");
  });

  it("lists a group that holds nothing, and works with no group and no account at all", async () => {
    world([group({ id: "g1", name: "Empty" })], lists());
    expect(((await show.run(ctx(), {})).data as { groups: unknown[] }).groups).toEqual([{ name: "Empty", facebook: null, instagram: null }]);
    world([], { META_FACEBOOK: [], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] });
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } });
    const r = await show.run(ctx(), {});
    expect((r.data as { platforms: Record<string, unknown[]>; groups: unknown[] }).groups).toEqual([]);
    expect((r.data as { platforms: Record<string, unknown[]> }).platforms.facebook).toEqual([]);
    // an empty workspace still gets the live controls: that is where it connects its first account
    expect(r.view).toEqual([{ kind: "accounts" }]);
  });

  it("shows the person the live controls, and a role that may only look gets a note instead", async () => {
    expect((await show.run(ctx(), {})).view).toEqual([{ kind: "accounts" }]);
    expect((await show.run(ctx({ role: "ADMIN" }), {})).view).toEqual([{ kind: "accounts" }]);
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await show.run(ctx({ role: "MEMBER", lang }), {});
      expect(r.view).toHaveLength(1);
      expect(r.view?.[0]).toMatchObject({ kind: "note" });
      expect((r.data as { youMayChange: boolean }).youMayChange).toBe(false);
    }
    expect(((await show.run(ctx(), {})).data as { youMayChange: boolean }).youMayChange).toBe(true);
  });

  it("is scoped to the workspace in the session", async () => {
    await show.run(ctx({ tenantId: "t9" }), {});
    expect(data.loadAccountLists).toHaveBeenCalledWith("t9");
    expect(data.loadConnections).toHaveBeenCalledWith("t9");
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t9" });
  });

  it("tells the model to use the buttons and not to send the owner to Settings", async () => {
    const notes = ((await show.run(ctx(), {})).data as { notes: string[] }).notes.join("\n");
    expect(notes).toMatch(/buttons/);
    expect(notes).toMatch(/never send them to Settings/);
    expect(notes).toMatch(/group_accounts/);
  });

  it("tells the model, for a role that may only look, that group_accounts is not for them and the owner or an admin does it", async () => {
    const notes = ((await show.run(ctx({ role: "MEMBER" }), {})).data as { notes: string[] }).notes.join("\n");
    expect(notes).toMatch(/no buttons/);
    expect(notes).toMatch(/group_accounts is not available to them/);
    expect(notes).toMatch(/owner or an admin connects, switches and regroups/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("planRegroup", () => {
  it("moves the Page into the Instagram account's group when the Page's own group has no room", () => {
    const p = planRegroup(ownerCase(), "9001", "8002");
    expect(p.ok && p.move).toMatchObject({ account: "facebook", accountId: "9001", into: "instagram" });
    expect(p.ok && p.move.from?.id).toBe("g1");
    expect(p.ok && p.move.to.id).toBe("g2");
  });

  it("moves the Instagram account into the Page's group when that group has no Instagram account", () => {
    const gs = [group({ id: "g1", name: "Page group", fbPageId: "9001" }), group({ id: "g2", name: "Busy", fbPageId: "9002", igUserId: "8002" })];
    const p = planRegroup(gs, "9001", "8002");
    expect(p.ok && p.move).toMatchObject({ account: "instagram", accountId: "8002", into: "facebook" });
    expect(p.ok && p.move.to.id).toBe("g1");
    expect(p.ok && p.move.from?.id).toBe("g2");
  });

  it("an account that is in no group joins the other's group when it has room, and cannot be joined", () => {
    const joins = planRegroup([group({ id: "g1", fbPageId: "9001" })], "9001", "8002");
    expect(joins.ok && joins.move).toMatchObject({ account: "instagram", from: null });
    const blocked = planRegroup([group({ id: "g1", fbPageId: "9001", igUserId: "8001" })], "9001", "8002");
    expect(blocked).toMatchObject({ ok: false, why: "blocked" });
    expect(planRegroup([], "9001", "8002")).toMatchObject({ ok: false, why: "blocked", fbGroup: null, igGroup: null });
  });

  it("with room both ways, keeps the group on the bigger plan, then the older one, unless `into` says", () => {
    const small = group({ id: "g1", name: "Small", fbPageId: "9001", plan: "FREE", createdAt: new Date("2026-01-01T00:00:00Z") });
    const big = group({ id: "g2", name: "Big", igUserId: "8002", plan: "PRO", createdAt: new Date("2026-03-01T00:00:00Z") });
    expect(planRegroup([small, big], "9001", "8002")).toMatchObject({ ok: true, move: { into: "instagram" } });
    expect(planRegroup([small, big], "9001", "8002", "facebook")).toMatchObject({ ok: true, move: { into: "facebook", account: "instagram" } });
    // equal plans: the older group keeps its place
    const older = { ...big, plan: "FREE", createdAt: new Date("2025-06-01T00:00:00Z") };
    expect(planRegroup([small, older], "9001", "8002")).toMatchObject({ ok: true, move: { into: "instagram" } });
    expect(planRegroup([older, small], "9001", "8002")).toMatchObject({ ok: true, move: { into: "instagram" } });
  });

  it("a paid plan whose days ran out does not win", () => {
    const lapsed = group({ id: "g1", name: "Lapsed", fbPageId: "9001", plan: "PRO", planPaidUntil: new Date("2020-01-01T00:00:00Z") });
    const live = group({ id: "g2", name: "Live", igUserId: "8002", plan: "MERCHANT", planPaidUntil: new Date("2999-01-01T00:00:00Z"), createdAt: new Date("2026-05-01T00:00:00Z") });
    expect(planRegroup([lapsed, live], "9001", "8002")).toMatchObject({ ok: true, move: { into: "instagram" } });
  });

  it("an `into` that cannot work is blocked, never swapped for the other way", () => {
    const p = planRegroup(ownerCase(), "9001", "8002", "facebook");
    expect(p).toMatchObject({ ok: false, why: "blocked", into: "facebook" });
  });

  it("two accounts already in one group are together", () => {
    expect(planRegroup(ownerCase(), "9001", "8001")).toMatchObject({ ok: false, why: "together", group: { id: "g1" } });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("group_accounts: finding the accounts", () => {
  it("finds an account by its exact name, case and spaces aside, by an @ handle, by its id and by a name only one contains", async () => {
    for (const args of [
      { facebook: "the  secret FILE", instagram: "THESECRETFILE26" },
      { facebook: "9001", instagram: "@thesecretfile26" },
      { facebook: "secret", instagram: "8002" },
    ]) {
      const card = await cardOf(args);
      expect(card.pin, JSON.stringify(args)).toMatchObject({ facebook: "9001", instagram: "8002" });
    }
  });

  it("finds an Instagram account by the handle its group stores when the connection is named differently", async () => {
    world(
      [group({ id: "g1", name: "A", fbPageId: "9001" }), group({ id: "g2", name: "B", igUserId: "8002", igUsername: "shop.handle" })],
      lists({ META_INSTAGRAM: [acc("8002", "Display Name")] }),
    );
    expect((await cardOf({ facebook: "The Secret File", instagram: "@shop.handle" })).pin).toMatchObject({ instagram: "8002" });
  });

  it("refuses a name that matches nothing and lists the connected ones with their groups", async () => {
    const m = await refusal(cardOf({ facebook: "No Such Page", instagram: "hawalnoos" }));
    expect(m).toContain('No connected Facebook Page matches "No Such Page"');
    expect(m).toContain('"The Secret File" (in the group "NSFW")');
    expect(m).toContain('"Other Page" (not in any group)');
  });

  it("refuses a name that fits two accounts and lists both, and does not guess", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Secret File A"), acc("9002", "Secret File B")] }));
    const m = await refusal(cardOf({ facebook: "secret file", instagram: "hawalnoos" }));
    expect(m).toContain("More than one Facebook Page matches");
    expect(m).toContain("Secret File A");
    expect(m).toContain("Secret File B");
    // an exact name wins over a longer name that merely contains it
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Secret"), acc("9002", "Secret File B")] }));
    expect((await cardOf({ facebook: "secret", instagram: "thesecretfile26" })).pin).toMatchObject({ facebook: "9001" });
  });

  it("refuses two accounts with the very same name (it cannot tell them apart)", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Same"), acc("9002", "same")] }));
    expect(await refusal(cardOf({ facebook: "Same", instagram: "hawalnoos" }))).toContain("More than one Facebook Page matches");
  });

  it("only looks among the accounts that are connected: a Page that is not in the list does not exist, even by id", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [] }));
    expect(await refusal(cardOf({ facebook: "9001", instagram: "hawalnoos" }))).toMatch(/No Facebook Page is connected/);
    world(ownerCase());
    expect(await refusal(cardOf({ facebook: "7777", instagram: "hawalnoos" }))).toContain("No connected Facebook Page matches");
  });

  it("needs a name for at least one account; a kind that is not named is taken only when there is exactly one", async () => {
    expect(await refusal(cardOf({}))).toContain("Name the Facebook Page and the Instagram account");
    // two Instagram accounts: it asks which
    const ask = await refusal(cardOf({ facebook: "The Secret File" }));
    expect(ask).toContain("Which Instagram account");
    expect(ask).toContain("thesecretfile26");
    // one Instagram account: that one
    world([group({ id: "g1", name: "A", fbPageId: "9001" })], lists({ META_INSTAGRAM: [acc("8002", "thesecretfile26")] }));
    expect((await cardOf({ facebook: "The Secret File" })).pin).toMatchObject({ facebook: "9001", instagram: "8002" });
    // none: nothing to put together
    world([group({ id: "g1", name: "A", fbPageId: "9001" })], lists({ META_INSTAGRAM: [] }));
    expect(await refusal(cardOf({ facebook: "The Secret File" }))).toMatch(/No Instagram account is connected/);
  });

  it("reads the accounts of the session's workspace only", async () => {
    await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }, ctx({ tenantId: "t7" }));
    expect(data.loadAccountLists).toHaveBeenCalledWith("t7");
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t7" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("group_accounts: the card", () => {
  it("shows the owner's case: the Page moves from NSFW to the Instagram account's group, @hawalnoos stays", async () => {
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" });
    expect(card.title).toBe("Put a Page and an Instagram account together");
    expect(lineOf(card, "Moves")).toEqual(["the Facebook Page “The Secret File”"]);
    expect(lineOf(card, "From")).toEqual(["the group “NSFW”"]);
    expect(lineOf(card, "To")).toEqual(["the group “thesecretfile26”"]);
    expect(lineOf(card, "Stays")).toEqual(["the group “NSFW”: the Instagram account @hawalnoos"]);
    expect(lineOf(card, "Together")[0]).toContain("The Facebook Page “The Secret File” and the Instagram account @thesecretfile26 will be in one group");
    const note = lineOf(card, "Note")[0];
    expect(note).toContain("Old messages, products and settings stay with the group “NSFW”");
    expect(note).toContain("nothing is deleted");
    // Confirm acts on these accounts and this direction
    expect(card.pin).toEqual({ facebook: "9001", instagram: "8002", into: "instagram" });
    expect(() => parse(card.pin)).not.toThrow();
  });

  it("the Instagram account moving: it names what the old group keeps", async () => {
    world(
      [group({ id: "g1", name: "Page group", fbPageId: "9001" }), group({ id: "g2", name: "Busy", fbPageId: "9002", igUserId: "8002", igUsername: "thesecretfile26" })],
    );
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" });
    expect(lineOf(card, "Moves")).toEqual(["the Instagram account @thesecretfile26"]);
    expect(lineOf(card, "From")).toEqual(["the group “Busy”"]);
    expect(lineOf(card, "To")).toEqual(["the group “Page group”"]);
    expect(lineOf(card, "Stays")).toEqual(["the group “Busy”: the Facebook Page “Other Page”"]);
    expect(card.pin).toMatchObject({ into: "facebook" });
  });

  it("says when the old group is left with no accounts", async () => {
    world([group({ id: "g1", name: "Solo page", fbPageId: "9001" }), group({ id: "g2", name: "Solo insta", igUserId: "8002", createdAt: new Date("2026-02-01T00:00:00Z") })]);
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" });
    // both could move; equal plans, the older group is kept: the Instagram account moves into "Solo page"
    expect(lineOf(card, "To")).toEqual(["the group “Solo page”"]);
    expect(lineOf(card, "Stays")).toEqual(["the group “Solo insta”: no accounts left in it"]);
  });

  it("an account in no group has no From and no Stays line", async () => {
    world([group({ id: "g1", name: "Page group", fbPageId: "9001" })]);
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" });
    expect(lineOf(card, "From")).toEqual([]);
    expect(lineOf(card, "Stays")).toEqual([]);
    expect(lineOf(card, "Note")[0]).toContain("nothing is deleted".replace("nothing is deleted", "Nothing is deleted"));
  });

  it("warns when the account lands in a group on a lower plan", async () => {
    world([
      group({ id: "g1", name: "Pro group", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos", plan: "PRO" }),
      group({ id: "g2", name: "Free group", igUserId: "8002", plan: "FREE" }),
    ]);
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" });
    expect(lineOf(card, "Heads up")[0]).toContain("lower plan");
    expect((await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }).then((c) => c.lines.map((l) => l.label))).includes("Heads up")).toBe(true);
    // the same move into the bigger plan has no warning
    world([
      group({ id: "g1", name: "Free group", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos", plan: "FREE" }),
      group({ id: "g2", name: "Pro group", igUserId: "8002", plan: "PRO" }),
    ]);
    expect(lineOf(await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }), "Heads up")).toEqual([]);
  });

  it("uses `into` when both ways work", async () => {
    world([group({ id: "g1", name: "Solo page", fbPageId: "9001" }), group({ id: "g2", name: "Solo insta", igUserId: "8002", createdAt: new Date("2026-02-01T00:00:00Z") })]);
    const card = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26", into: "instagram" });
    expect(lineOf(card, "To")).toEqual(["the group “Solo insta”"]);
    expect(card.pin).toMatchObject({ into: "instagram" });
  });

  it("refuses when the two are already together", async () => {
    const m = await refusal(cardOf({ facebook: "The Secret File", instagram: "hawalnoos" }));
    expect(m).toContain("already in the same group");
    expect(m).toContain('"NSFW"');
  });

  it("refuses when neither group has room and names what blocks it", async () => {
    world([
      group({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos" }),
      group({ id: "g2", name: "Second", fbPageId: "9002", igUserId: "8002", igUsername: "thesecretfile26" }),
    ]);
    const m = await refusal(cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }));
    expect(m).toContain('the group "NSFW" already holds the Instagram account "hawalnoos"');
    expect(m).toContain('the group "Second" already holds the Facebook Page "Other Page"');
    expect(m).toContain("no tool takes an account out of a group");
    expect(m).toContain("Gituas support");
  });

  it("with `into` it explains only that way", async () => {
    const m = await refusal(cardOf({ facebook: "The Secret File", instagram: "thesecretfile26", into: "facebook" }));
    expect(m).toContain('the group "NSFW" already holds the Instagram account "hawalnoos"');
    expect(m).not.toContain("Facebook Page \"Other Page\"");
  });

  it("refuses when neither account is in a group", async () => {
    world([]);
    const m = await refusal(cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }));
    expect(m).toContain("is not in any group");
    expect(m).toContain("Neither account belongs to a group yet");
  });

  it("makes the card in the three languages, each with its own letters", async () => {
    const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/u;
    const ARABIC_ONLY = /[يكىةؤ]/u;
    const seen: Record<string, Card> = {};
    for (const lang of ["ckb", "ar", "en"] as const) seen[lang] = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }, ctx({ lang }));
    expect(seen.ckb.lines.map((l) => l.label)).toEqual(seen.en.lines.map(() => expect.any(String)));
    expect(seen.ar.lines).toHaveLength(seen.en.lines.length);
    expect(seen.ckb.lines).toHaveLength(seen.en.lines.length);
    for (const lang of ["ckb", "ar"] as const) {
      const c = seen[lang];
      expect(c.title.length).toBeGreaterThan(3);
      for (const l of c.lines) expect(l.label.length + l.value.length, `${lang} ${l.label}`).toBeGreaterThan(2);
      // the names stay as they are, the group is named
      expect(plain(all(c))).toContain("@hawalnoos");
      expect(plain(all(c))).toContain("The Secret File");
      expect(plain(all(c))).toContain("NSFW");
    }
    // the words that are ours: Sorani has no Arabic-only letter, Arabic no Kurdish-only letter (the names are Latin)
    const arText = [seen.ar.title, ...seen.ar.lines.flatMap((l) => [l.label, l.value])].join("\n");
    const ckbText = [seen.ckb.title, ...seen.ckb.lines.flatMap((l) => [l.label, l.value])].join("\n");
    expect(arText).not.toMatch(KURDISH_ONLY);
    expect(ckbText).not.toMatch(ARABIC_ONLY);
    expect(ckbText).toMatch(KURDISH_ONLY);
    // an @handle inside right-to-left text is isolated so the @ stays in front
    expect(all(seen.ckb)).toContain(`${String.fromCodePoint(0x2066)}@hawalnoos${String.fromCodePoint(0x2069)}`);
    expect(all(seen.en)).not.toContain(String.fromCodePoint(0x2066));
  });

  it("never says shop, store or the loan word for it to the owner", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const c = await cardOf({ facebook: "The Secret File", instagram: "thesecretfile26" }, ctx({ lang }));
      const text = [c.title, ...c.lines.flatMap((l) => [l.label, l.value])].join("\n");
      expect(text, lang).not.toMatch(/shop|store|شاپ|دووکان|متجر/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("group_accounts: the new group's switches", () => {
  /** The Page can only move into the group of @thesecretfile26 (the Instagram account's group has no Page); `g2` sets that group's switches. */
  const into = (g2: Partial<GroupRow>) =>
    world([
      group({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos" }),
      group({ id: "g2", name: "thesecretfile26", igUserId: "8002", igUsername: "thesecretfile26", createdAt: new Date("2026-02-01T00:00:00Z"), ...g2 }),
    ]);
  const args = { facebook: "The Secret File", instagram: "thesecretfile26" };

  it("states what the moved account will follow in the new group: replies, automatic posts and the daily video", async () => {
    into({ automationEnabled: true, autoMode: "PUBLISH", videoAutoMode: "DRAFT" });
    const card = await cardOf(args);
    expect(lineOf(card, "To")).toEqual(["the group “thesecretfile26”"]);
    expect(lineOf(card, "Switches of the new group")).toEqual(["Automatic replies: on · Automatic posts: posts by itself · Daily video: prepare only"]);
    // the new line sits right under the destination
    const labels = card.lines.map((l) => l.label);
    expect(labels.indexOf("Switches of the new group")).toBe(labels.indexOf("To") + 1);
  });

  it("says plainly when the new group has everything off", async () => {
    into({ automationEnabled: false, autoMode: "OFF", videoAutoMode: "OFF" });
    expect(lineOf(await cardOf(args), "Switches of the new group")).toEqual(["Automatic replies: off · Automatic posts: off · Daily video: off"]);
  });

  it("says 'paused' for what would run when the new group is paused, and still 'off' for what is off", async () => {
    into({ automationEnabled: true, autoMode: "DRAFT", videoAutoMode: "OFF", pausedReason: "token" });
    expect(lineOf(await cardOf(args), "Switches of the new group")).toEqual(["Automatic replies: paused · Automatic posts: paused · Daily video: off"]);
  });

  it("is in the three languages, with each language's own letters and none of the loan words", async () => {
    into({ automationEnabled: true, autoMode: "PUBLISH", videoAutoMode: "DRAFT" });
    for (const lang of ["ckb", "ar", "en"] as const) {
      const card = await cardOf(args, ctx({ lang }));
      const label = { ckb: "کارە خۆکارەکانی گرووپی نوێ", ar: "إعدادات المجموعة الجديدة", en: "Switches of the new group" }[lang];
      const [value] = lineOf(card, label);
      expect(value, lang).toBeTruthy();
      expect(value, lang).toContain("·");
      expect(value, lang).not.toMatch(/shop|store|شاپ|دووکان|متجر/i);
      if (lang === "ckb") expect(value).not.toMatch(/[يكىةؤ]/u);
      if (lang === "ar") expect(value).not.toMatch(/[کیەێۆڕڵڤپچژگ]/u);
    }
  });

  it("the note says the automation on posts already published stays with the old group (three languages), but only when there is an old group", async () => {
    into({});
    expect(lineOf(await cardOf(args), "Note")[0]).toContain("the automation on posts already published (such as product cards)");
    expect(lineOf(await cardOf(args, ctx({ lang: "ar" })), NEW.field.note.ar)[0]).toContain("الأتمتة على المنشورات المنشورة سابقاً");
    expect(lineOf(await cardOf(args, ctx({ lang: "ckb" })), NEW.field.note.ckb)[0]).toContain("کارە خۆکارەکانی ئەو پۆستانەی پێشتر بڵاو کراونەتەوە");
    world([group({ id: "g1", name: "Page group", fbPageId: "9001" })]);
    expect(lineOf(await cardOf(args), "Note")[0]).not.toContain("already published");
  });

  it("reads the switches with the groups (one query per read, inside the workspace)", async () => {
    into({});
    await cardOf(args);
    const select = db.store.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({ automationEnabled: true, autoMode: true, videoAutoMode: true, pausedReason: true });
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
  });
});

describe("group_accounts: the names the model was shown", () => {
  const shownNames = async (): Promise<Record<string, string[]>> => {
    const p = ((await show.run(ctx(), {})).data as { platforms: Record<string, { name: string }[]> }).platforms;
    return { facebook: p.facebook.map((a) => a.name), instagram: p.instagram.map((a) => a.name) };
  };
  const LONG = "Nawroz Bakhtiyar Kurdistan Collection of Leather Bags and Shoes for Women";

  it("finds a Page by the name show_accounts gave, with the phone number taken out of it", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Nawroz Shop 0750 123 4567"), acc("9002", "Other Page")] }));
    const [shown] = (await shownNames()).facebook;
    expect(shown).toBe("Nawroz Shop [number]");
    expect((await cardOf({ facebook: shown, instagram: "thesecretfile26" })).pin).toMatchObject({ facebook: "9001" });
    // a part of that name works too, and so does the real name, as before
    expect((await cardOf({ facebook: "nawroz shop [number", instagram: "thesecretfile26" })).pin).toMatchObject({ facebook: "9001" });
    expect((await cardOf({ facebook: "Nawroz Shop 0750 123 4567", instagram: "thesecretfile26" })).pin).toMatchObject({ facebook: "9001" });
  });

  it("finds an Instagram account whose handle has a number in it", async () => {
    world(
      [group({ id: "g1", name: "A", fbPageId: "9001" }), group({ id: "g2", name: "B", igUserId: "8002", igUsername: "shop07501234567" })],
      lists({ META_INSTAGRAM: [acc("8001", "hawalnoos"), acc("8002", "shop07501234567")] }),
    );
    const names = (await shownNames()).instagram;
    expect(names).toContain("shop[number]");
    expect((await cardOf({ facebook: "The Secret File", instagram: "@shop[number]" })).pin).toMatchObject({ instagram: "8002" });
  });

  it("finds a name of more than 60 characters by the cut form the model saw, with the ellipsis and without it", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", LONG), acc("9002", "Other Page")] }));
    const [shown] = (await shownNames()).facebook;
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.length).toBeLessThan(LONG.length);
    for (const hint of [shown, shown.slice(0, -1), `${shown.slice(0, -1)}...`, LONG]) {
      expect((await cardOf({ facebook: hint, instagram: "thesecretfile26" })).pin, hint).toMatchObject({ facebook: "9001" });
    }
  });

  it("still refuses a name that fits two accounts after the numbers are taken out, and shows the cut names", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Nawroz Shop 0750 111 2233"), acc("9002", "Nawroz Shop 0771 444 5566")] }));
    const m = await refusal(cardOf({ facebook: "Nawroz Shop [number]", instagram: "thesecretfile26" }));
    expect(m).toContain("More than one Facebook Page matches");
    expect(m).toContain("Nawroz Shop [number]");
    expect(m).not.toContain("0750");
  });

  it("hands the read-back the real names, cut like the card's, so the owner reads one spelling", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9001", "Nawroz Shop 0750 123 4567"), acc("9002", "Other Page")] }));
    const pinned = { facebook: "9001", instagram: "8002", into: "instagram" };
    const card = await cardOf(pinned);
    const r = await run(pinned);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Nawroz Shop 0750 123 4567");
    expect(lineOf(card, "Moves")).toEqual(["the Facebook Page “Nawroz Shop 0750 123 4567”"]);
    expect(r.data).toMatchObject({ facebookName: "Nawroz Shop 0750 123 4567", instagramName: "thesecretfile26", toName: "thesecretfile26" });
  });
});

describe("group_accounts: the change", () => {
  const pinned = { facebook: "9001", instagram: "8002", into: "instagram" };

  it("moves the Page out of its old group and into the new one, in one transaction, on rows that still look as the card showed", async () => {
    const r = await run(pinned);
    expect(r.ok).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.store.updateMany).toHaveBeenCalledTimes(2);
    expect(db.store.updateMany.mock.calls[0][0]).toEqual({ where: { id: "g1", tenantId: "t1", fbPageId: "9001" }, data: { fbPageId: null } });
    expect(db.store.updateMany.mock.calls[1][0]).toEqual({ where: { id: "g2", tenantId: "t1", fbPageId: null }, data: { fbPageId: "9001" } });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "t1",
      actor: "USER",
      action: "store.page_moved",
      metadata: { accountId: "9001", fromStoreId: "g1", storeId: "g2", via: "chat", userId: "u1" },
    });
    expect(r.text).toBe("Done: the Facebook Page “The Secret File” and the Instagram account @thesecretfile26 are now together in the group “thesecretfile26”.");
    expect(r.data).toMatchObject({ facebook: "9001", instagram: "8002", moved: "facebook", toGroup: "g2", fromGroup: "g1", toName: "thesecretfile26", facebookName: "The Secret File", instagramName: "thesecretfile26" });
  });

  it("an Instagram account moves with its handle, and the old group lets go of both", async () => {
    world([group({ id: "g1", name: "Page group", fbPageId: "9001" }), group({ id: "g2", name: "Busy", fbPageId: "9002", igUserId: "8002", igUsername: "thesecretfile26" })]);
    const r = await run({ facebook: "9001", instagram: "8002", into: "facebook" });
    expect(r.ok).toBe(true);
    expect(db.store.updateMany.mock.calls[0][0]).toEqual({ where: { id: "g2", tenantId: "t1", igUserId: "8002" }, data: { igUserId: null, igUsername: null } });
    expect(db.store.updateMany.mock.calls[1][0]).toEqual({ where: { id: "g1", tenantId: "t1", igUserId: null }, data: { igUserId: "8002", igUsername: "thesecretfile26" } });
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe("store.instagram_moved");
  });

  it("an account that was in no group is only added: no row is cleared", async () => {
    world([group({ id: "g1", name: "Page group", fbPageId: "9001" })], lists({ META_INSTAGRAM: [acc("8002", "@Display.Name")] }));
    const r = await run({ facebook: "9001", instagram: "8002", into: "facebook" });
    expect(r.ok).toBe(true);
    expect(db.store.updateMany).toHaveBeenCalledTimes(1);
    // the handle comes from the connected account's name, without the @
    expect(db.store.updateMany.mock.calls[0][0]).toEqual({ where: { id: "g1", tenantId: "t1", igUserId: null }, data: { igUserId: "8002", igUsername: "Display.Name" } });
    expect((r.data as { fromGroup: unknown }).fromGroup).toBeNull();
  });

  it("never stores a bare id as a handle", async () => {
    world([group({ id: "g1", name: "Page group", fbPageId: "9001" })], lists({ META_INSTAGRAM: [acc("8002", "8002")] }));
    await run({ facebook: "9001", instagram: "8002", into: "facebook" });
    expect(db.store.updateMany.mock.calls[0][0].data).toEqual({ igUserId: "8002", igUsername: null });
  });

  it("reads the groups again inside the transaction and touches only this workspace's rows", async () => {
    await run(pinned, ctx({ tenantId: "t5" }));
    expect(data.loadAccountLists).toHaveBeenCalledWith("t5");
    for (const call of db.store.findMany.mock.calls) expect(call[0].where).toEqual({ tenantId: "t5" });
    // one read for the accounts, one inside the transaction
    expect(db.store.findMany).toHaveBeenCalledTimes(2);
    for (const call of db.store.updateMany.mock.calls) expect(call[0].where.tenantId).toBe("t5");
    expect(db.auditLog.create.mock.calls[0][0].data.tenantId).toBe("t5");
  });

  it("stops without changing anything when the groups changed after the card and neither has room any more", async () => {
    db.store.findMany
      .mockResolvedValueOnce(ownerCase())
      .mockResolvedValueOnce([
        group({ id: "g1", name: "NSFW", fbPageId: "9001", igUserId: "8001", igUsername: "hawalnoos" }),
        group({ id: "g2", name: "thesecretfile26", fbPageId: "9002", igUserId: "8002" }),
      ]);
    const r = await run(pinned);
    expect(r).toEqual({ ok: false, text: NEW.stale.en });
    expect(db.store.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("will not swap the direction the card showed for the other one", async () => {
    // the card said "the Page goes to the Instagram account's group"; now only the other way has room
    db.store.findMany.mockResolvedValue([group({ id: "g1", name: "Solo page", fbPageId: "9001" }), group({ id: "g2", name: "Full", fbPageId: "9002", igUserId: "8002" })]);
    expect((await run(pinned)).ok).toBe(false);
    expect(db.store.updateMany).not.toHaveBeenCalled();
  });

  it("stops when a row no longer looks as it did (another change got in first)", async () => {
    db.store.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await run(pinned)).toEqual({ ok: false, text: NEW.stale.en });
    expect(db.store.updateMany).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
    db.store.updateMany.mockReset();
    db.store.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await run(pinned)).toEqual({ ok: false, text: NEW.stale.en });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("tells the person in their language when the database refuses a second group for the account", async () => {
    db.store.updateMany.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    for (const lang of ["ckb", "ar", "en"] as const) {
      expect(await run(pinned, ctx({ lang }))).toEqual({ ok: false, text: NEW.stale[lang] });
    }
  });

  it("lets any other failure through", async () => {
    db.store.updateMany.mockRejectedValue(new Error("connection lost"));
    await expect(run(pinned)).rejects.toThrow("connection lost");
  });

  it("an account disconnected after the card is not replaced by another", async () => {
    world(ownerCase(), lists({ META_FACEBOOK: [acc("9002", "Other Page")] }));
    expect(await run(pinned)).toEqual({ ok: false, text: NEW.stale.en });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("says so, and changes nothing, when the two were already together by the time Confirm is pressed", async () => {
    db.store.findMany.mockResolvedValue([group({ id: "g2", name: "thesecretfile26", fbPageId: "9001", igUserId: "8002" })]);
    const r = await run(pinned);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("were already in one group");
    expect(db.store.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ nothingChanged: true, toGroup: "g2", moved: null });
  });

  it("answers in each language, naming the accounts and the group", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      db.store.updateMany.mockClear();
      const r = await run(pinned, ctx({ lang }));
      expect(r.ok, lang).toBe(true);
      expect(plain(r.text), lang).toContain("The Secret File");
      expect(plain(r.text), lang).toContain("@thesecretfile26");
      expect(r.text.length, lang).toBeGreaterThan(20);
    }
  });

  it("works from the card's pinned arguments exactly (the model's names are gone)", async () => {
    const card = await cardOf({ facebook: "the secret", instagram: "@THESECRETFILE26" });
    const r = await run(card.pin);
    expect(r.ok).toBe(true);
    expect(db.store.updateMany.mock.calls[1][0].data).toEqual({ fbPageId: "9001" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the system prompt", () => {
  const prompt = (extra: { mayConfigure?: boolean } = {}) =>
    systemPrompt({
      lang: "en",
      uiNames: { settings: "Settings" },
      state: {},
      features: { max: false, video: false, pictures: false },
      attachments: [],
      buttons: { confirm: "Confirm", cancel: "Cancel" },
      nowBaghdad: "2026-10-25 10:00",
      ...extra,
    });

  it("sends the owner's account questions to show_accounts and regrouping to group_accounts, never to Settings", () => {
    const p = prompt();
    expect(p).toContain("call show_accounts");
    expect(p).toContain("call group_accounts");
    expect(p).toMatch(/never send the owner to Settings/);
    expect(p).toMatch(/never say an account was connected or switched until the owner has used them/);
  });

  it("for a role that may change settings, asks for group_accounts; if it is not among the tools the owner or an admin does it", () => {
    for (const p of [prompt(), prompt({ mayConfigure: true })]) {
      expect(p).toContain("call group_accounts with both names");
      expect(p).toMatch(/If group_accounts is not among your tools, this person's role cannot do it: say the owner or an admin does it/);
      expect(p).toContain("Connect and Choose buttons");
    }
  });

  it("for a role that may only look, never tells the model to call group_accounts or promises buttons; the owner or an admin does it", () => {
    const p = prompt({ mayConfigure: false });
    expect(p).toContain("call show_accounts");
    expect(p).not.toContain("call group_accounts with both names");
    expect(p).toMatch(/do not call group_accounts/);
    expect(p).toMatch(/the owner or an admin does it/);
    expect(p).toMatch(/never send them to Settings/);
    expect(p).not.toContain("Connect and Choose buttons");
    // the rest of the prompt is the same
    expect(p).toMatch(/Disconnecting an account is not possible from the chat/);
  });

  it("no longer claims the chat cannot connect, move or regroup accounts, or that support has to join them", () => {
    const p = prompt();
    expect(p).not.toMatch(/cannot connect, move or regroup/);
    expect(p).not.toMatch(/support has to join/);
    expect(p).not.toMatch(/connected accounts or the deletion/);
    // disconnecting is still not possible from the chat, and the prompt says so
    expect(p).toMatch(/Disconnecting an account is not possible from the chat/);
  });
});
