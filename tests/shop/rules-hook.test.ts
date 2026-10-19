import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ownerRule: the one call the buyer pipeline makes. The database is replaced by recorders. What is tested is the promise of the
// hook: with the switch off or no rule it costs (almost) nothing, a rule can never break the pipeline, a message is decided once,
// the caps are kept (a refused daily unit drops that rule), a test run changes nothing, and no buyer's words reach the log.

const db = vi.hoisted(() => ({
  shopRule: { findMany: vi.fn() },
  ruleRun: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  usage: { findMany: vi.fn() },
  outboxJob: { count: vi.fn(), findMany: vi.fn() },
  threadPause: { create: vi.fn() },
}));
const slots = vi.hoisted(() => ({ takeDaily: vi.fn(), baghdadDay: vi.fn(() => "2026-10-19") }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/slots", () => slots);

import { commentDecisionWithRule, dmActionsWithRule, finishRules, NO_RULE, ownerRule, type RuleInput, type RuleTail } from "@/lib/shop/rules/pipeline-hook";
import type { RuleReply } from "@/lib/shop/rules/engine";
import type { CommentDecision } from "@/lib/shop/policy";
import { addressRule, flagRule, infoRule } from "./rules-fixtures";

const NOW = new Date("2026-10-19T09:00:00Z");
const BUYER_WORDS = "info please, call me on 07501234567";
const unique = () => Object.assign(new Error("unique"), { code: "P2002" });
const rule = (id: string, spec: unknown, over: Record<string, unknown> = {}) => ({ id, version: 1, priority: 100, createdAt: new Date("2026-10-01T00:00:00Z"), spec, ...over });

const comment = (over: Partial<RuleInput> = {}): RuleInput => ({
  channel: "comment", tenantId: "t1", storeId: "s1", messageId: "m1", platform: "META_FACEBOOK", buyerKey: "b1", threadKey: "c1",
  text: BUYER_WORDS, viaVoice: false, c: { type: "QUESTION", intent: "delivery", language: "en", confidence: 0.9 },
  canPrivateReply: true, limited: false, hasProductCard: false, orderInProgress: false, now: NOW, ...over,
});
const chat = (over: Partial<RuleInput> = {}): RuleInput =>
  comment({ channel: "dm", threadKey: "b1", text: "what is your address", c: { type: "QUESTION", intent: "address", language: "en", confidence: 0.9 }, ...over });

const written = () => JSON.stringify([db.ruleRun.create.mock.calls, db.ruleRun.updateMany.mock.calls]);

beforeEach(() => {
  vi.resetAllMocks();
  slots.baghdadDay.mockReturnValue("2026-10-19");
  slots.takeDaily.mockResolvedValue(1);
  db.shopRule.findMany.mockResolvedValue([rule("r1", infoRule())]);
  db.ruleRun.findMany.mockResolvedValue([]);
  db.ruleRun.create.mockResolvedValue({ id: "run1" });
  db.usage.findMany.mockResolvedValue([]);
  db.outboxJob.count.mockResolvedValue(0);
  db.outboxJob.findMany.mockResolvedValue([]);
  process.env.SHOP_RULES_ENABLED = "1";
  delete process.env.RULES_DRY_RUN;
});
afterEach(() => {
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
  vi.restoreAllMocks();
});

const touched = () => Object.values(db).flatMap((t) => Object.values(t)).some((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length > 0);

describe("when nothing is to be done it costs nothing", () => {
  it("with the switch off it touches nothing", async () => {
    delete process.env.SHOP_RULES_ENABLED;
    expect(await ownerRule(comment())).toBe(NO_RULE);
    expect(touched()).toBe(false);
    for (const v of ["0", "true", " 1"]) {
      process.env.SHOP_RULES_ENABLED = v;
      expect(await ownerRule(comment())).toBe(NO_RULE);
    }
    expect(touched()).toBe(false);
  });

  it("without a sender (no cap could be kept) or without words, no rule runs", async () => {
    expect(await ownerRule(comment({ buyerKey: null }))).toBe(NO_RULE);
    expect(await ownerRule(comment({ text: "   " }))).toBe(NO_RULE);
    expect(touched()).toBe(false);
  });

  it("with the switch on and no rules in the shop it is one indexed query", async () => {
    db.shopRule.findMany.mockResolvedValue([]);
    expect(await ownerRule(comment())).toBe(NO_RULE);
    expect(db.shopRule.findMany).toHaveBeenCalledTimes(1);
    expect(db.ruleRun.findMany).not.toHaveBeenCalled();
    expect(db.usage.findMany).not.toHaveBeenCalled();
    expect(slots.takeDaily).not.toHaveBeenCalled();
  });

  it("a message that meets none of the rules' words costs the shop's rules and the decision of that message, and nothing else", async () => {
    const out = await ownerRule(comment({ text: "is the blue one in stock", c: { type: "QUESTION", intent: "availability", language: "en", confidence: 0.9 } }));
    expect(out).toBe(NO_RULE);
    expect(db.shopRule.findMany).toHaveBeenCalledTimes(1);
    expect(db.ruleRun.findMany).toHaveBeenCalledTimes(1); // only the check for an earlier decision about this message
    expect(db.ruleRun.findMany.mock.calls[0][0].where.messageId).toBe("m1");
    expect(db.usage.findMany).not.toHaveBeenCalled();
    expect(db.outboxJob.count).not.toHaveBeenCalled();
    expect(slots.takeDaily).not.toHaveBeenCalled();
    expect(db.ruleRun.create).not.toHaveBeenCalled();
  });

  it("a message that does match reads the counters of the rules that match, not of every rule of the shop", async () => {
    const other = infoRule({
      name: "Catalogue",
      trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["catalogue"] } },
      actions: [{ do: "reply", texts: { default: "Catalogue text" } }],
      examples: [{ text: "catalogue", match: true }, { text: "hello there", match: false }],
    });
    db.shopRule.findMany.mockResolvedValue([rule("r1", infoRule()), rule("r2", other)]);
    const out = await ownerRule(comment());
    expect(out.reply).toMatchObject({ ruleId: "r1" });
    expect(db.usage.findMany.mock.calls[0][0].where.tenantId).toEqual({ in: ["rule:r1"] });
    expect(db.ruleRun.findMany.mock.calls[1][0].where.ruleId).toEqual({ in: ["r1"] });
  });

  it("an earlier decision about the message is still read first: a re-run whose label changed does not lose it", async () => {
    // the first run decided on "info"; the second run's words do not meet any rule any more, yet the message follows the first decision
    db.ruleRun.findMany.mockResolvedValue([
      { id: "run1", ruleId: "r1", ruleVersion: 1, status: "CLAIMED", matched: "info", reason: null, actions: [{ do: "reply", channel: "private", text: "First decision", textLang: "default", lang: "en", publicLine: "standard" }] },
    ]);
    const out = await ownerRule(comment({ text: "something else entirely" }));
    expect(out.reply).toMatchObject({ text: "First decision", ruleId: "r1" });
    expect(db.ruleRun.create).not.toHaveBeenCalled();
  });

  it("a shop whose rules are for another channel or platform costs the same one query", async () => {
    db.shopRule.findMany.mockResolvedValue([rule("r1", infoRule()), rule("r2", addressRule({ trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: ["address"] } } }))]);
    expect(await ownerRule(chat())).toBe(NO_RULE); // r1 is a comment rule, r2 is WhatsApp only
    expect(db.ruleRun.findMany).not.toHaveBeenCalled();
  });
});

describe("a rule that matches", () => {
  it("answers with the owner's text in the buyer's language, takes its day, and logs the owner's keyword, never the buyer's words", async () => {
    const out = await ownerRule(comment({ c: { type: "QUESTION", intent: "delivery", language: "ckb", confidence: 0.9 } }));
    expect(out.reply).toMatchObject({ ruleId: "r1", channel: "private", textLang: "ckb", publicLine: "standard", matched: "info" });
    expect(out.reply?.text).toContain("گەیاندن");
    expect(out.flag).toBe(false);
    expect(slots.takeDaily).toHaveBeenCalledWith("rule:r1", "rule_day", 1, 50);
    const create = db.ruleRun.create.mock.calls[0][0].data;
    expect(create).toMatchObject({ ruleId: "r1", ruleVersion: 1, storeId: "s1", messageId: "m1", buyerKey: "b1", status: "CLAIMED", matched: "info" });
    expect(written()).not.toContain("07501234567");
    expect(written()).not.toContain("please");
    expect(out.tail).toMatchObject({ tenantId: "t1", messageId: "m1", platform: "META_FACEBOOK", threadKey: "c1" });
    expect(out.tail?.runs).toHaveLength(1);
  });

  it("answers a chat message with a chat answer and no public line", async () => {
    db.shopRule.findMany.mockResolvedValue([rule("r2", addressRule())]);
    const out = await ownerRule(chat());
    expect(out.reply).toMatchObject({ ruleId: "r2", channel: "dm", publicLine: "none", text: "We are in Erbil, Gulan Street, opposite the park." });
  });

  it("a rule that only flags gives a flag and no reply", async () => {
    db.shopRule.findMany.mockResolvedValue([rule("r3", flagRule())]);
    const out = await ownerRule(chat({ text: "I want a refund", c: { type: "COMPLAINT", intent: "none", language: "en", confidence: 0.9 } }));
    expect(out.reply).toBeNull();
    expect(out.flag).toBe(true);
    expect(out.flagNotes).toEqual(["Customer talks about a refund"]);
    expect(db.ruleRun.create.mock.calls[0][0].data.actions).toEqual([{ do: "flag_owner", note: "Customer talks about a refund" }]);
  });

  it("stays silent where Meta forbids the reply (the private-reply window, a reply already sent) and says why in the log", async () => {
    const closed = await ownerRule(comment({ canPrivateReply: false }));
    expect(closed.reply).toBeNull();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", reason: "private_window" });
    expect(slots.takeDaily).not.toHaveBeenCalled();

    db.ruleRun.create.mockClear();
    db.outboxJob.count.mockResolvedValue(1); // a private reply to this comment already exists
    const used = await ownerRule(comment({ messageId: "m2" }));
    expect(used.reply).toBeNull();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", reason: "private_reply_used" });
    expect(db.outboxJob.count.mock.calls.at(-1)?.[0].where).toEqual({ messageId: "m2", kind: "PRIVATE_REPLY" });
  });
});

describe("the caps", () => {
  it("a refused daily unit drops that rule and lets the next one answer", async () => {
    const second = infoRule({ name: "Second", actions: [{ do: "reply", texts: { default: "Second text" } }] });
    db.shopRule.findMany.mockResolvedValue([rule("a", infoRule(), { priority: 200 }), rule("b", second, { priority: 100 })]);
    slots.takeDaily.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const out = await ownerRule(comment());
    expect(out.reply).toMatchObject({ ruleId: "b", text: "Second text" });
    expect(slots.takeDaily.mock.calls.map((c) => c[0])).toEqual(["rule:a", "rule:b"]);
    const rows = db.ruleRun.create.mock.calls.map((c) => c[0].data);
    expect(rows.find((r) => r.ruleId === "a")).toMatchObject({ status: "SKIPPED", reason: "cap_rule_day" });
    expect(rows.find((r) => r.ruleId === "b")).toMatchObject({ status: "CLAIMED" });
  });

  it("when every rule's day is used up nothing is sent and nothing is claimed", async () => {
    slots.takeDaily.mockResolvedValue(0);
    const out = await ownerRule(comment());
    expect(out).toBe(NO_RULE);
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", reason: "cap_rule_day" });
  });

  it("one person gets a rule's answer once a day (counted from the log), and a rule's day total comes from Usage", async () => {
    db.ruleRun.findMany.mockImplementation(async (a: { where: { messageId?: string; ruleId?: unknown; status?: unknown } }) => {
      if (a.where.messageId) return []; // the decision about this message
      return a.where.ruleId ? [{ ruleId: "r1" }] : []; // this person's runs today
    });
    const out = await ownerRule(comment());
    expect(out.reply).toBeNull();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", reason: "cap_person" });

    vi.clearAllMocks();
    db.shopRule.findMany.mockResolvedValue([rule("r1", infoRule({ limits: { perPersonPerDay: 1, perDay: 3 } }))]);
    db.ruleRun.findMany.mockResolvedValue([]);
    db.ruleRun.create.mockResolvedValue({ id: "run9" });
    db.usage.findMany.mockResolvedValue([{ tenantId: "rule:r1", count: 3 }]);
    db.outboxJob.count.mockResolvedValue(0);
    const full = await ownerRule(comment({ messageId: "m5" }));
    expect(full.reply).toBeNull();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ reason: "cap_rule_day" });
  });

  it("a sender who already got three rule replies this hour gets no more, whatever the rules say", async () => {
    db.ruleRun.findMany.mockImplementation(async (a: { where: { messageId?: string; ruleId?: unknown } }) => {
      if (a.where.messageId) return [];
      if (a.where.ruleId) return [];
      return Array.from({ length: 3 }, () => ({ actions: [{ do: "reply" }] }));
    });
    const out = await ownerRule(comment());
    expect(out.reply).toBeNull();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ reason: "cap_sender_hour" });
  });
});

describe("a message is decided once", () => {
  it("a second run does what the first decided and never decides again, takes nothing and writes nothing", async () => {
    db.ruleRun.findMany.mockResolvedValue([
      { id: "run1", ruleId: "r1", ruleVersion: 1, status: "CLAIMED", matched: "info", reason: null, actions: [{ do: "reply", channel: "private", text: "First decision", textLang: "default", lang: "en", publicLine: "standard" }] },
    ]);
    const out = await ownerRule(comment());
    expect(out.reply).toMatchObject({ text: "First decision", ruleId: "r1" });
    expect(out.tail?.runs.map((r) => r.id)).toEqual(["run1"]);
    expect(slots.takeDaily).not.toHaveBeenCalled();
    expect(db.ruleRun.create).not.toHaveBeenCalled();
  });

  it("if the first run held the rule back, the second one does not answer either", async () => {
    db.ruleRun.findMany.mockResolvedValue([{ id: "run1", ruleId: "r1", ruleVersion: 1, status: "SKIPPED", matched: "info", reason: "cap_person", actions: [] }]);
    expect(await ownerRule(comment())).toBe(NO_RULE);
    expect(slots.takeDaily).not.toHaveBeenCalled();
  });

  it("two runs at the same moment: the one that loses the race follows the winner's decision", async () => {
    db.ruleRun.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.ruleRun.create.mockRejectedValueOnce(unique());
    db.ruleRun.findUnique.mockResolvedValue({ id: "winner", status: "CLAIMED" });
    // what the re-read finds: the winner's row, which holds the winner's decision
    db.ruleRun.findMany.mockResolvedValueOnce([
      { id: "winner", ruleId: "r1", ruleVersion: 1, status: "CLAIMED", matched: "info", reason: null, actions: [{ do: "reply", channel: "private", text: "Winner text", textLang: "default", lang: "en", publicLine: "standard" }] },
    ]);
    const out = await ownerRule(comment());
    expect(out.reply?.text).toBe("Winner text");
    expect(out.tail?.runs[0].id).toBe("winner");
  });
});

describe("the test run (RULES_DRY_RUN)", () => {
  it("writes what the rules would do, takes nothing, and changes nothing for the buyer", async () => {
    process.env.RULES_DRY_RUN = "1";
    const out = await ownerRule(comment());
    expect(out).toBe(NO_RULE);
    expect(slots.takeDaily).not.toHaveBeenCalled();
    expect(db.ruleRun.create.mock.calls[0][0].data).toMatchObject({ ruleId: "r1", status: "DRY", matched: "info" });
    expect(db.ruleRun.create.mock.calls[0][0].data.actions[0]).toMatchObject({ do: "reply" });
  });

  it("does not act on a live decision made earlier either", async () => {
    process.env.RULES_DRY_RUN = "1";
    db.ruleRun.findMany.mockResolvedValue([{ id: "run1", ruleId: "r1", ruleVersion: 1, status: "CLAIMED", matched: "info", reason: null, actions: [{ do: "reply", channel: "private", text: "x", textLang: "default", lang: "en", publicLine: "none" }] }]);
    expect(await ownerRule(comment())).toBe(NO_RULE);
    expect(db.ruleRun.create).not.toHaveBeenCalled();
  });
});

describe("a rule can never break the pipeline", () => {
  it("a database failure anywhere in the hook is 'no rule', and is said in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.shopRule.findMany.mockRejectedValue(new Error("connection lost"));
    expect(await ownerRule(comment())).toBe(NO_RULE);
    db.shopRule.findMany.mockResolvedValue([rule("r1", infoRule())]);
    db.usage.findMany.mockRejectedValue(new Error("boom"));
    expect(await ownerRule(comment())).toBe(NO_RULE);
    db.usage.findMany.mockResolvedValue([]);
    db.ruleRun.create.mockRejectedValue(new Error("write failed"));
    expect(await ownerRule(comment())).toBe(NO_RULE);
    slots.takeDaily.mockRejectedValue(new Error("counter down"));
    db.ruleRun.create.mockResolvedValue({ id: "x" });
    expect(await ownerRule(comment())).toBe(NO_RULE);
    expect(err).toHaveBeenCalled();
    // the log line carries an error name, never the buyer's words
    expect(JSON.stringify(err.mock.calls)).not.toContain("07501234567");
  });

  it("a stored rule that no longer parses is left out and the others still run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.shopRule.findMany.mockResolvedValue([rule("bad", { v: 1 }), rule("r1", infoRule())]);
    const out = await ownerRule(comment());
    expect(out.reply?.ruleId).toBe("r1");
    expect(warn).toHaveBeenCalled();
  });
});

describe("what the pipeline does with an answer", () => {
  const reply = (over: Partial<RuleReply> = {}): RuleReply => ({ ruleId: "r1", ruleVersion: 1, matched: "info", channel: "private", text: "Owner text", lang: "en", textLang: "default", publicLine: "standard", ...over });

  it("a comment: the owner's private reply and the usual public line replace our reply, likes and hides stay", () => {
    const base: CommentDecision = {
      actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, { kind: "PRIVATE_REPLY", content: "card", whatsapp: true }, { kind: "LIKE" }, { kind: "HIDE" }],
      flag: "no_product",
    };
    expect(commentDecisionWithRule(base, reply())).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false }, { kind: "LIKE" }, { kind: "HIDE" }],
      flag: null,
    });
    // a rule that asked for no public line leaves the comment without ours too
    expect(commentDecisionWithRule(base, reply({ publicLine: "none" })).actions).toEqual([{ kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false }, { kind: "LIKE" }, { kind: "HIDE" }]);
  });

  it("a chat message: one answer, the owner's; our product answer goes, photos stay", () => {
    expect(dmActionsWithRule([{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "price", whatsapp: true }], "address")).toEqual([
      { kind: "DM_PHOTOS" },
      { kind: "DM_ANSWER", intent: "address", whatsapp: false },
    ]);
    expect(dmActionsWithRule([], "none")).toEqual([{ kind: "DM_ANSWER", intent: "none", whatsapp: false }]);
  });
});

describe("settling the log after the jobs ran", () => {
  const tail = (actions: unknown[], over: Partial<RuleTail> = {}): RuleTail => ({
    tenantId: "t1", messageId: "m1", platform: "META_FACEBOOK", threadKey: "c1", runs: [{ id: "run1", actions: actions as never }], ...over,
  });
  const replyAct = { do: "reply", channel: "private", text: "Hi", textLang: "default", lang: "en", publicLine: "standard" };

  beforeEach(() => {
    db.ruleRun.updateMany.mockResolvedValue({ count: 1 });
    db.threadPause.create.mockResolvedValue({});
  });

  it("a reply that was sent is DONE with its job; one still waiting is QUEUED with its job", async () => {
    db.outboxJob.findMany.mockResolvedValue([{ id: "j1", kind: "PRIVATE_REPLY", status: "SENT" }]);
    await finishRules(tail([replyAct]));
    expect(db.outboxJob.findMany.mock.calls[0][0].where).toEqual({ messageId: "m1", kind: { in: ["PRIVATE_REPLY", "DM_ANSWER"] } });
    const upd = db.ruleRun.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "run1", status: { in: ["CLAIMED", "QUEUED"] } });
    expect(upd.data.status).toBe("DONE");
    expect(upd.data.actions[0].jobId).toBe("j1");

    db.ruleRun.updateMany.mockClear();
    db.outboxJob.findMany.mockResolvedValue([{ id: "j1", kind: "PRIVATE_REPLY", status: "PENDING" }]);
    await finishRules(tail([replyAct]));
    expect(db.ruleRun.updateMany.mock.calls[0][0].data.status).toBe("QUEUED");
  });

  it("a reply whose job never existed is FAILED, so the log does not claim a send", async () => {
    db.outboxJob.findMany.mockResolvedValue([]);
    await finishRules(tail([replyAct]));
    expect(db.ruleRun.updateMany.mock.calls[0][0].data).toEqual({ status: "FAILED", reason: "no_job" });
  });

  it("a chat answer looks for the chat job, not the comment job", async () => {
    db.outboxJob.findMany.mockResolvedValue([{ id: "jp", kind: "PRIVATE_REPLY", status: "SENT" }, { id: "jd", kind: "DM_ANSWER", status: "SENT" }]);
    await finishRules(tail([{ ...replyAct, channel: "dm" }]));
    expect(db.ruleRun.updateMany.mock.calls[0][0].data.actions[0].jobId).toBe("jd");
  });

  it("a flag-only rule is DONE at once and needs no job", async () => {
    await finishRules(tail([{ do: "flag_owner" }]));
    expect(db.outboxJob.findMany).not.toHaveBeenCalled();
    expect(db.ruleRun.updateMany.mock.calls[0][0].data).toEqual({ status: "DONE" });
  });

  it("a pause comes only after the reply it came with was sent", async () => {
    db.outboxJob.findMany.mockResolvedValue([{ id: "j1", kind: "PRIVATE_REPLY", status: "PENDING" }]);
    await finishRules(tail([replyAct, { do: "pause_thread" }]));
    expect(db.threadPause.create).not.toHaveBeenCalled();

    db.outboxJob.findMany.mockResolvedValue([{ id: "j1", kind: "PRIVATE_REPLY", status: "SENT" }]);
    await finishRules(tail([replyAct, { do: "pause_thread" }]));
    expect(db.threadPause.create.mock.calls[0][0].data).toEqual({ tenantId: "t1", platform: "META_FACEBOOK", threadKey: "c1" });
  });

  it("a pause that was already written is not an error, and a failing log never throws into the pipeline", async () => {
    db.threadPause.create.mockRejectedValue(unique());
    await expect(finishRules(tail([{ do: "pause_thread" }]))).resolves.toBeUndefined();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.ruleRun.updateMany.mockRejectedValue(new Error("down"));
    await expect(finishRules(tail([{ do: "flag_owner" }]))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    await expect(finishRules(null)).resolves.toBeUndefined();
    await expect(finishRules(tail([], { runs: [] }))).resolves.toBeUndefined();
  });
});
