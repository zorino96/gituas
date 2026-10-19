import { beforeEach, describe, expect, it, vi } from "vitest";

// The rules' storage and the rule log. The database is replaced by recorders; what is tested is the part that is ours: which rows are
// asked for, what is written (never a buyer's words), what a repeated run does, and what the daily clean-up removes.

const db = vi.hoisted(() => ({
  shopRule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  ruleRun: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
  usage: { findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn() },
  outboxJob: { findMany: vi.fn() },
  store: { findUnique: vi.fn() },
}));
const slots = vi.hoisted(() => ({ takeDaily: vi.fn(), baghdadDay: vi.fn(() => "2026-10-19") }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/slots", () => slots);

import {
  activeOthers, countStored, findStoredRule, insertRule, listStoredRules, loadActiveRules, loadUsage, MAX_STORED_RULES, pruneRuleRuns, recentInbound,
  RULE_DAY_METRIC, ruleScope, runnable, setRuleStatus, settleStaleRuns, STALE_CLAIM_MS, storeSwitches, takeRuleDay,
} from "@/lib/shop/rules/db";
import { pickRule } from "@/lib/shop/rules/engine";
import { draftsFromPick, markRuns, priorRuns, recentRuns, reasonCounts, recordRuns, replayOf, runCounts, type RunDraft } from "@/lib/shop/rules/log";
import { specHash } from "@/lib/shop/rules/spec";
import { addressRule, flagRule, infoRule } from "./rules-fixtures";

const NOW = new Date("2026-10-19T09:00:00Z");
const row = (id: string, spec: unknown, over: Record<string, unknown> = {}) => ({ id, version: 1, priority: 100, createdAt: new Date("2026-10-01T00:00:00Z"), spec, ...over });
const unique = () => Object.assign(new Error("unique"), { code: "P2002" });

beforeEach(() => {
  vi.resetAllMocks();
  slots.baghdadDay.mockReturnValue("2026-10-19");
});

describe("the fixtures are real rules", () => {
  it("parse, and the two reply rules do not answer themselves", () => {
    expect(infoRule().trigger.channel).toBe("comment");
    expect(addressRule().trigger.channel).toBe("dm");
    expect(flagRule().actions[0].do).toBe("flag_owner");
  });
});

describe("loading the rules the pipeline runs", () => {
  it("asks only for this shop's ACTIVE rules and returns them parsed", async () => {
    db.shopRule.findMany.mockResolvedValue([row("r1", infoRule()), row("r2", addressRule())]);
    const rules = await loadActiveRules("s1");
    expect(db.shopRule.findMany.mock.calls[0][0].where).toEqual({ storeId: "s1", status: "ACTIVE" });
    expect(rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(rules[0].spec.name).toBe("Delivery info");
  });

  it("skips a stored rule that no longer parses, and one that waits for a timer (no timers in this version)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const waiting = flagRule({ wait: { unansweredMinutes: 10 } });
    db.shopRule.findMany.mockResolvedValue([row("bad", { v: 1, name: "broken" }), row("timer", waiting), row("ok", infoRule())]);
    expect((await loadActiveRules("s1")).map((r) => r.id)).toEqual(["ok"]);
    expect(runnable(waiting)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("what a message has already used up", () => {
  it("reads the rule's day from Usage, the person's runs from the log, and the sender's replies in the last hour", async () => {
    db.usage.findMany.mockResolvedValue([{ tenantId: ruleScope("r1"), count: 7 }]);
    db.ruleRun.findMany
      .mockResolvedValueOnce([{ ruleId: "r1" }, { ruleId: "r1" }, { ruleId: "r2" }])
      .mockResolvedValueOnce([{ actions: [{ do: "reply" }] }, { actions: [{ do: "flag_owner" }] }, { actions: [{ do: "reply" }, { do: "flag_owner" }] }]);
    const u = await loadUsage([{ id: "r1" }, { id: "r2" }], { storeId: "s1", buyerKey: "b1", now: NOW });
    expect(u.usage).toEqual({ r1: { today: 7, personToday: 2 }, r2: { today: 0, personToday: 1 } });
    // a flag-only run is not a reply: only the two runs that replied count towards the hourly ceiling
    expect(u.senderRepliesLastHour).toBe(2);
    const usageQuery = db.usage.findMany.mock.calls[0][0].where;
    expect(usageQuery).toMatchObject({ month: "2026-10-19", metric: RULE_DAY_METRIC });
    const personQuery = db.ruleRun.findMany.mock.calls[0][0].where;
    expect(personQuery).toMatchObject({ buyerKey: "b1", status: { in: ["CLAIMED", "QUEUED", "PENDING", "DONE"] } });
    // Baghdad midnight of 2026-10-19 is 21:00 UTC of the 18th
    expect((personQuery.createdAt.gte as Date).toISOString()).toBe("2026-10-18T21:00:00.000Z");
  });

  it("takes a unit of the rule's day atomically and says whether it got one", async () => {
    slots.takeDaily.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await takeRuleDay("r1", 50)).toBe(true);
    expect(await takeRuleDay("r1", 50)).toBe(false);
    expect(slots.takeDaily).toHaveBeenCalledWith("rule:r1", "rule_day", 1, 50);
  });
});

describe("the owner's list", () => {
  const stored = (id: string, over: Record<string, unknown> = {}) => ({
    id, tenantId: "t1", storeId: "s1", name: "Delivery info", sentence: "", status: "ACTIVE", version: 1, priority: 100, spec: infoRule(),
    specHash: "x", pausedReason: null, activatedAt: null, createdAt: NOW, updatedAt: NOW, store: { name: "Shop A", igUsername: null }, ...over,
  });

  it("lists the workspace's live rules and shows a rule that no longer parses as unreadable instead of dropping it", async () => {
    db.shopRule.findMany.mockResolvedValue([stored("r1"), stored("r2", { spec: { nonsense: true } })]);
    const list = await listStoredRules("t1");
    expect(db.shopRule.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } });
    expect(list.map((r) => [r.id, r.spec === null])).toEqual([["r1", false], ["r2", true]]);
    expect(list[0].shopName).toBe("Shop A");
  });

  it("lists the NEWEST rules first when asked, so replaced rules do not push the current ones out of the first 100", async () => {
    db.shopRule.findMany.mockResolvedValue([]);
    await listStoredRules("t1");
    expect(db.shopRule.findMany.mock.calls[0][0]).toMatchObject({ orderBy: { createdAt: "asc" }, take: 100 });
    await listStoredRules("t1", { newestFirst: true });
    expect(db.shopRule.findMany.mock.calls[1][0]).toMatchObject({ orderBy: { createdAt: "desc" }, take: 100 });
  });

  it("leaves out a deleted rule whose log has already gone, but keeps the live ones whatever their age", async () => {
    db.shopRule.findMany.mockResolvedValue([]);
    const since = new Date("2026-07-21T09:00:00Z");
    await listStoredRules("t1", { statuses: ["ACTIVE", "PAUSED", "PAUSED_AUTO", "ARCHIVED"], newestFirst: true, archivedSince: since });
    expect(db.shopRule.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1",
      OR: [{ status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } }, { status: "ARCHIVED", updatedAt: { gte: since } }],
    });
    // without ARCHIVED among the statuses there is nothing to cut
    await listStoredRules("t1", { archivedSince: since });
    expect(db.shopRule.findMany.mock.calls[1][0].where).toEqual({ tenantId: "t1", status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } });
  });

  it("finds a rule by id first, then by an exact name; two rules with one name are ambiguous; a deleted rule is never found by name", async () => {
    db.shopRule.findFirst.mockResolvedValueOnce(stored("r1"));
    expect(await findStoredRule("t1", "r1")).toMatchObject({ ok: true });
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: "r1" });

    db.shopRule.findFirst.mockResolvedValueOnce(null);
    db.shopRule.findMany.mockResolvedValueOnce([stored("r2")]);
    expect(await findStoredRule("t1", "delivery info")).toMatchObject({ ok: true });
    const nameQuery = db.shopRule.findMany.mock.calls[0][0].where;
    expect(nameQuery).toMatchObject({ tenantId: "t1", name: { equals: "delivery info", mode: "insensitive" }, status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } });

    db.shopRule.findFirst.mockResolvedValueOnce(null);
    db.shopRule.findMany.mockResolvedValueOnce([stored("r2"), stored("r3")]);
    expect(await findStoredRule("t1", "Delivery info")).toEqual({ ok: false, why: "ambiguous" });

    db.shopRule.findFirst.mockResolvedValueOnce(null);
    db.shopRule.findMany.mockResolvedValueOnce([]);
    expect(await findStoredRule("t1", "nothing")).toEqual({ ok: false, why: "none" });
    expect(await findStoredRule("t1", "   ")).toEqual({ ok: false, why: "none" });
  });

  it("gives the lint the shop's other active rules, without the rule being checked", async () => {
    db.shopRule.findMany.mockResolvedValue([{ id: "r2", name: "Address", spec: addressRule() }, { id: "r3", name: "broken", spec: {} }]);
    const others = await activeOthers("s1", "r1");
    expect(db.shopRule.findMany.mock.calls[0][0].where).toEqual({ storeId: "s1", status: "ACTIVE", id: { not: "r1" } });
    expect(others.map((o) => o.id)).toEqual(["r2"]);
  });

  it("stores a new rule ACTIVE at once, in its normalised form, with its hash and who made it", async () => {
    db.shopRule.create.mockResolvedValue({ id: "new1" });
    const spec = infoRule();
    const id = await insertRule({ tenantId: "t1", storeId: "s1", userId: "u1", spec, sentence: "x".repeat(2000) });
    expect(id).toBe("new1");
    const data = db.shopRule.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", storeId: "s1", status: "ACTIVE", version: 1, createdBy: "u1", specHash: specHash(spec), name: "Delivery info" });
    expect(data.sentence).toHaveLength(1000);
    expect(data.activatedAt).toBeInstanceOf(Date);
  });

  it("changes a status only inside the workspace and only from the statuses given", async () => {
    db.shopRule.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await setRuleStatus("t1", "r1", ["ACTIVE"], "PAUSED", "owner")).toBe(true);
    expect(db.shopRule.updateMany.mock.calls[0][0]).toEqual({ where: { id: "r1", tenantId: "t1", status: { in: ["ACTIVE"] } }, data: { status: "PAUSED", pausedReason: "owner" } });
    expect(await setRuleStatus("t1", "r1", ["PAUSED", "PAUSED_AUTO"], "ACTIVE", null)).toBe(false);
    expect(db.shopRule.updateMany.mock.calls[1][0].data.activatedAt).toBeInstanceOf(Date);
  });

  it("counts a shop's rules that are not deleted, and reads the shop's own switches", async () => {
    db.shopRule.count.mockResolvedValue(4);
    expect(await countStored("s1")).toBe(4);
    expect(db.shopRule.count.mock.calls[0][0].where.status).toEqual({ in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] });
    expect(MAX_STORED_RULES).toBeGreaterThan(10);
    db.store.findUnique.mockResolvedValue({ automationEnabled: false, pausedReason: "token" });
    expect(await storeSwitches("s1")).toEqual({ automatic: false, pausedReason: "token" });
    db.store.findUnique.mockResolvedValue(null);
    expect(await storeSwitches("gone")).toBeNull();
  });
});

describe("the shop's stored messages for a try-out", () => {
  it("reads inbound messages of the rule's channel and platforms, and gives a chat message's typed words (a voice note's transcript included)", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      { id: "m1", content: "[audio] what is your address", platform: "META_FACEBOOK", commentType: "QUESTION", intent: "address", language: "en", confidence: 0.9 },
      { id: "m2", content: "  ", platform: "WHATSAPP", commentType: null, intent: null, language: null, confidence: null },
      { id: "m3", content: "[image] the address please", platform: "WHATSAPP", commentType: null, intent: null, language: null, confidence: null },
    ]);
    const msgs = await recentInbound("s1", addressRule(), 14, 400, NOW);
    const where = db.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ storeId: "s1", direction: "INBOUND", channelType: "DM", platform: { in: ["META_FACEBOOK", "META_INSTAGRAM", "WHATSAPP"] } });
    expect((where.createdAt.gte as Date).toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(msgs.map((m) => [m.id, m.text, m.viaVoice])).toEqual([["m1", "what is your address", true], ["m3", "the address please", false]]);
  });
});

describe("the daily clean-up", () => {
  it("removes log rows older than 90 days, a deleted rule's included, and says how many", async () => {
    db.ruleRun.deleteMany.mockResolvedValue({ count: 12 });
    db.ruleRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await pruneRuleRuns(NOW)).toBe(12);
    const where = db.ruleRun.deleteMany.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(["createdAt"]);
    expect((where.createdAt.lt as Date).toISOString()).toBe("2026-07-21T09:00:00.000Z");
  });

  it("first settles the rows a dead run left CLAIMED: after 10 minutes they are FAILED with the reason stale", async () => {
    db.ruleRun.updateMany.mockResolvedValue({ count: 3 });
    expect(await settleStaleRuns(NOW)).toBe(3);
    const call = db.ruleRun.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ status: "FAILED", reason: "stale" });
    expect(call.where.status).toBe("CLAIMED");
    expect((call.where.updatedAt.lt as Date).toISOString()).toBe(new Date(NOW.getTime() - STALE_CLAIM_MS).toISOString());
    expect(STALE_CLAIM_MS).toBe(600_000);
    // a message without an outcome is still the stuck-message sweep's to finish; its run follows these very rows
    expect(call.where.message).toEqual({ outcome: { not: null } });
  });

  it("does the settling and the removal in one daily pass, and a failing settle never stops the removal", async () => {
    db.ruleRun.updateMany.mockResolvedValue({ count: 1 });
    db.ruleRun.deleteMany.mockResolvedValue({ count: 2 });
    expect(await pruneRuleRuns(NOW)).toBe(2);
    expect(db.ruleRun.updateMany).toHaveBeenCalledTimes(1);
    db.ruleRun.updateMany.mockRejectedValue(new Error("down"));
    expect(await pruneRuleRuns(NOW)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the rule log", () => {
  const rec = (over: Partial<RunDraft> = {}): RunDraft => ({
    ruleId: "r1", ruleVersion: 1, storeId: "s1", messageId: "m1", buyerKey: "b1", status: "CLAIMED", reason: null, matched: "info",
    actions: [{ do: "reply", channel: "private", text: "Hello", textLang: "default", lang: "en", publicLine: "standard" }], dueAt: null, ...over,
  });

  it("is made from a pick: the owner's keyword and text only, never what the buyer wrote", () => {
    const rule = { id: "r1", version: 2, priority: 100, createdAt: NOW, spec: infoRule() };
    const flag = { id: "r2", version: 1, priority: 90, createdAt: NOW, spec: flagRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] } } }) };
    const buyerWords = "info please, my number is 07501234567";
    const result = pickRule(
      { channel: "comment", platform: "META_FACEBOOK", text: buyerWords, viaVoice: false, c: { type: "QUESTION", intent: "delivery", language: "en", confidence: 0.9 }, canPrivateReply: true, privateReplyUsed: false, limited: false, hasProductCard: false, orderInProgress: false, usage: {}, senderRepliesLastHour: 0 },
      [rule, flag],
    );
    const drafts = draftsFromPick(result, [rule, flag], { storeId: "s1", messageId: "m1", buyerKey: "b1", now: NOW }, false);
    expect(drafts.map((d) => [d.ruleId, d.status])).toEqual([["r1", "CLAIMED"], ["r2", "CLAIMED"]]);
    expect(drafts[0].matched).toBe("info");
    expect(drafts[0].actions[0]).toMatchObject({ do: "reply", channel: "private", textLang: "default", publicLine: "standard" });
    expect(drafts[1].actions).toEqual([{ do: "flag_owner", note: "Customer talks about a refund" }]);
    expect(JSON.stringify(drafts)).not.toContain("07501234567");
    expect(JSON.stringify(drafts)).not.toContain("please");
  });

  it("makes a test run's rows DRY, and logs a held-back rule with the reason", () => {
    const rule = { id: "r1", version: 1, priority: 100, createdAt: NOW, spec: infoRule() };
    const input = { channel: "comment" as const, platform: "META_FACEBOOK" as const, text: "info", viaVoice: false, c: { type: "QUESTION" as const, intent: "delivery" as const, language: "en" as const, confidence: 0.9 }, canPrivateReply: false, privateReplyUsed: false, limited: false, hasProductCard: false, orderInProgress: false, usage: {}, senderRepliesLastHour: 0 };
    const held = draftsFromPick(pickRule(input, [rule]), [rule], { storeId: "s1", messageId: "m1", buyerKey: "b1", now: NOW }, false);
    expect(held).toHaveLength(1);
    // the trigger matched but a reply is blocked (Meta's private-reply window): the rule did nothing, and says why
    expect(held[0]).toMatchObject({ status: "SKIPPED", reason: "private_window", matched: "info", actions: [] });
    const dry = draftsFromPick(pickRule({ ...input, canPrivateReply: true }, [rule]), [rule], { storeId: "s1", messageId: "m1", buyerKey: "b1", now: NOW }, true);
    expect(dry[0].status).toBe("DRY");
    expect(dry[0].actions[0]).toMatchObject({ do: "reply" });
  });

  it("writes a row once: a second write of the same rule and message is reported as already there, and not overwritten", async () => {
    db.ruleRun.create.mockResolvedValueOnce({ id: "run1" }).mockRejectedValueOnce(unique());
    db.ruleRun.findUnique.mockResolvedValue({ id: "run1", status: "CLAIMED" });
    const [a] = await recordRuns([rec()]);
    const [b] = await recordRuns([rec()]);
    expect(a).toMatchObject({ id: "run1", created: true });
    expect(b).toMatchObject({ id: "run1", created: false });
    expect(db.ruleRun.updateMany).not.toHaveBeenCalled();
    expect(db.ruleRun.findUnique.mock.calls[0][0].where).toEqual({ ruleId_messageId: { ruleId: "r1", messageId: "m1" } });
  });

  it("lets a live run replace a test-run (DRY) row, but never the other way round", async () => {
    db.ruleRun.create.mockRejectedValue(unique());
    db.ruleRun.findUnique.mockResolvedValueOnce({ id: "run1", status: "DRY" });
    db.ruleRun.updateMany.mockResolvedValue({ count: 1 });
    const [live] = await recordRuns([rec()]);
    expect(live.created).toBe(true);
    expect(db.ruleRun.updateMany.mock.calls[0][0].where).toEqual({ id: "run1", status: "DRY" });

    db.ruleRun.findUnique.mockResolvedValueOnce({ id: "run2", status: "CLAIMED" });
    const [dry] = await recordRuns([rec({ status: "DRY" })]);
    expect(dry.created).toBe(false);
    expect(db.ruleRun.updateMany).toHaveBeenCalledTimes(1);
  });

  it("finds the job of a run that was cut off before it wrote the job into its row, by message and kind", async () => {
    db.ruleRun.findMany.mockResolvedValue([
      { id: "a", ruleId: "r1", ruleVersion: 1, messageId: "m1", status: "FAILED", reason: "stale", matched: "info", createdAt: NOW, actions: [{ do: "reply", channel: "private", text: "Hi", textLang: "default", lang: "en", publicLine: "standard" }] },
      { id: "b", ruleId: "r1", ruleVersion: 1, messageId: "m2", status: "CLAIMED", reason: null, matched: "info", createdAt: NOW, actions: [{ do: "reply", channel: "dm", text: "Hi", textLang: "default", lang: "en", publicLine: "none" }] },
      { id: "c", ruleId: "r1", ruleVersion: 1, messageId: "m3", status: "FAILED", reason: "stale", matched: "info", createdAt: NOW, actions: [{ do: "flag_owner" }] },
    ]);
    db.outboxJob.findMany.mockResolvedValue([
      { messageId: "m1", kind: "PRIVATE_REPLY", status: "SENT", lastError: null },
      { messageId: "m1", kind: "DM_ANSWER", status: "FAILED", lastError: "too_long" },
      { messageId: "m2", kind: "DM_ANSWER", status: "FAILED", lastError: "too_long" },
    ]);
    const runs = await recentRuns({ ruleIds: ["r1"], since: NOW, limit: 5 });
    expect(runs[0]).toMatchObject({ id: "a", delivery: "SENT", deliveryNote: null }); // a comment's private reply, not the chat answer
    expect(runs[1]).toMatchObject({ id: "b", delivery: "FAILED", deliveryNote: "too_long" });
    expect(runs[2]).toMatchObject({ id: "c", delivery: null }); // a flag has no reply to follow
    expect(db.outboxJob.findMany).toHaveBeenCalledTimes(1);
    expect(db.outboxJob.findMany.mock.calls[0][0].where).toEqual({ messageId: { in: ["m1", "m2"] }, kind: { in: ["PRIVATE_REPLY", "DM_ANSWER"] } });
    // the message id never leaks into the shape the tools read
    expect(Object.keys(runs[0])).not.toContain("messageId");
  });

  it("passes any other database error on (the hook turns it into 'no rule')", async () => {
    db.ruleRun.create.mockRejectedValue(new Error("connection lost"));
    await expect(recordRuns([rec()])).rejects.toThrow("connection lost");
  });

  it("rebuilds the first run's decision from its rows, for a second run of the same message", async () => {
    db.ruleRun.findMany.mockResolvedValue([
      { id: "a", ruleId: "r1", ruleVersion: 3, status: "QUEUED", matched: "info", reason: null, actions: [{ do: "reply", channel: "private", text: "Hello", textLang: "ckb", lang: "ckb", publicLine: "none" }, { do: "flag_owner", note: "look" }] },
      { id: "b", ruleId: "r2", ruleVersion: 1, status: "SKIPPED", matched: "x", reason: "cap_person", actions: [] },
      { id: "c", ruleId: "r3", ruleVersion: 1, status: "DRY", matched: "x", reason: null, actions: [{ do: "reply", channel: "private", text: "never", textLang: "default", lang: "en", publicLine: "none" }] },
    ]);
    const prior = await priorRuns("m1", ["r1", "r2", "r3"]);
    const r = replayOf(prior);
    expect(r.reply).toMatchObject({ ruleId: "r1", ruleVersion: 3, matched: "info", channel: "private", text: "Hello", textLang: "ckb", publicLine: "none" });
    expect(r.flag).toBe(true);
    expect(r.flagNotes).toEqual(["look"]);
    expect(r.pause).toBe(false);
    expect(r.live.map((x) => x.id)).toEqual(["a"]);
    expect(await priorRuns("m1", [])).toEqual([]);
  });

  it("moves only rows still in progress, and settles them with the job they queued", async () => {
    db.ruleRun.updateMany.mockResolvedValue({ count: 1 });
    await markRuns([{ id: "a", status: "DONE" }, { id: "b", status: "FAILED", reason: "no_job" }]);
    expect(db.ruleRun.updateMany.mock.calls[0][0]).toEqual({ where: { id: "a", status: { in: ["CLAIMED", "QUEUED"] } }, data: { status: "DONE" } });
    expect(db.ruleRun.updateMany.mock.calls[1][0].data).toEqual({ status: "FAILED", reason: "no_job" });
  });

  it("counts runs by rule and status and reasons, and reads the newest runs with what became of their reply", async () => {
    db.ruleRun.groupBy.mockResolvedValueOnce([{ ruleId: "r1", status: "DONE", _count: { _all: 3 } }, { ruleId: "r1", status: "SKIPPED", _count: { _all: 2 } }]);
    expect(await runCounts(["r1"], NOW)).toEqual({ r1: { DONE: 3, SKIPPED: 2 } });
    expect(await runCounts([], NOW)).toEqual({});
    db.ruleRun.groupBy.mockResolvedValueOnce([{ reason: "cap_person", _count: { _all: 4 } }]);
    expect(await reasonCounts(["r1"], NOW)).toEqual({ cap_person: 4 });

    db.ruleRun.findMany.mockResolvedValue([
      { id: "a", ruleId: "r1", ruleVersion: 1, status: "QUEUED", reason: null, matched: "info", createdAt: NOW, actions: [{ do: "reply", channel: "dm", text: "Hi", textLang: "default", lang: "en", publicLine: "none", jobId: "j1" }] },
      { id: "b", ruleId: "r1", ruleVersion: 1, status: "DONE", reason: null, matched: "info", createdAt: NOW, actions: [{ do: "reply", channel: "dm", text: "Hi", textLang: "default", lang: "en", publicLine: "none", jobId: "j2" }] },
    ]);
    db.outboxJob.findMany.mockResolvedValue([
      { id: "j1", status: "SKIPPED", lastError: "account_disconnected" },
      { id: "j2", status: "SKIPPED", lastError: "(#10) Meta said something with a buyer's name Ali" },
    ]);
    const runs = await recentRuns({ ruleIds: ["r1"], since: NOW, statuses: ["QUEUED", "DONE"], limit: 5 });
    expect(runs[0]).toMatchObject({ delivery: "SKIPPED", deliveryNote: "account_disconnected" });
    // Meta's own words are never passed on: only the outbox's short codes
    expect(runs[1]).toMatchObject({ delivery: "SKIPPED", deliveryNote: null });
    expect(db.ruleRun.findMany.mock.calls[0][0].where.status).toEqual({ in: ["QUEUED", "DONE"] });
  });
});
