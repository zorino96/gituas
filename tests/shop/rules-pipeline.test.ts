import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// processMessage with the owner rules, end to end inside the process: a fake database that remembers the jobs and outcomes the
// pipeline writes, the real gate, policy, job builder, hook and engine, and a classifier passed in through the test seam (no model).
// What is pinned: with the switch off or no rule the pipeline does exactly what it did before; with a rule the owner's text replaces
// our reply and nothing else is added to it; a rule that breaks changes nothing.

type Job = { id: string; kind: string; messageId: string; status: string; payload: Record<string, unknown> };
const world = vi.hoisted(() => ({
  msg: null as Record<string, unknown> | null,
  jobs: [] as Job[],
  outcomes: [] as { outcome: string; outcomeReason: string | null }[],
  rules: [] as unknown[],
  runs: [] as { id: string; ruleId: string; messageId: string; status: string; actions: unknown[]; reason: string | null; data: Record<string, unknown> }[],
  product: null as Record<string, unknown> | null,
  pauses: [] as Record<string, unknown>[],
  next: 0,
}));

const unique = () => Object.assign(new Error("unique"), { code: "P2002" });
const db = vi.hoisted(() => {
  const f = vi.fn;
  return {
    conversationMessage: { findUnique: f(), update: f(), count: f(), findFirst: f() },
    postAutomation: { findUnique: f(), count: f(), upsert: f() },
    threadPause: { count: f(), create: f() },
    outboxJob: { count: f(), create: f(), findFirst: f(), findMany: f() },
    product: { findUnique: f(), findMany: f(), findFirst: f() },
    automationTemplate: { findUnique: f() },
    order: { count: f(), findFirst: f(), findUnique: f(), update: f() },
    shopRule: { findMany: f() },
    ruleRun: { findMany: f(), create: f(), findUnique: f(), updateMany: f() },
    usage: { findMany: f() },
  };
});
const slots = vi.hoisted(() => ({ takeDaily: vi.fn(), baghdadDay: vi.fn(() => "2026-10-19") }));
const runJob = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/slots", () => slots);
vi.mock("@/lib/shop/outbox", () => ({ runJob }));
vi.mock("@/lib/shop/classify", () => ({ classifyText: vi.fn() }));
vi.mock("@/lib/shop/meta-client", () => ({ accountFor: vi.fn(async () => null), fetchPostCreatedAt: vi.fn(async () => null) }));
vi.mock("@/lib/shop/smart-glue", () => ({ smartTry: vi.fn(async () => null) }));
vi.mock("@/lib/shop/vary", () => ({ varySample: vi.fn(async (s: string) => ({ text: s, ai: false })) }));
vi.mock("@/lib/shop/quota", () => ({ aiVaryUsed: vi.fn(async () => 999_999), countAiVary: vi.fn(async () => undefined) }));
vi.mock("@/lib/orders/auto", () => ({ openOrder: vi.fn(async () => null) }));
vi.mock("@/lib/ai/meter", () => ({ allowanceOf: vi.fn(async () => ({ percent: 10 })) }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { processMessage, type Classify } from "@/lib/shop/pipeline";
import { addressRule, flagRule, infoRule } from "./rules-fixtures";

const store = {
  id: "s1", tenantId: "t1", name: "Test shop", plan: "FREE", dailyCap: null, automationEnabled: true, pausedReason: null, stopBefore: null, expiryDays: 30,
  fbPageId: null, igUserId: null, igUsername: null, likeComments: false, autoHideSpam: false, aiReplies: false, defaultDm: "Default DM from the shop",
  defaultTemplateId: null, deliveryFeeMinor: null, deliveryCurrency: "IQD", deliveryTime: null, deliveryCityFees: null, waPhoneNumberId: null,
  tenant: { slug: "shop", whatsappNumber: null },
};
const base = { storeId: "s1", platform: "META_FACEBOOK", direction: "INBOUND", outcome: null, authorId: "u1", authorHandle: "Ali", parentCommentId: null, createdAt: new Date(), store };
const aComment = (content = "info please") => ({ ...base, id: "m1", channelType: "COMMENT", externalThreadId: "post1", externalMessageId: "c1", content });
const aChat = (content = "what is your address") => ({ ...base, id: "d1", channelType: "DM", externalThreadId: "u1", externalMessageId: "mid1", content });
const labelled = (type: string, intent: string, language = "en"): Classify => (async () => ({ type, intent, language, confidence: 0.9 })) as unknown as Classify;

const jobOf = (kind: string) => world.jobs.find((j) => j.kind === kind);
const lastOutcome = () => world.outcomes.at(-1);
// A product card is sent as a template; its words are the plain-text fallback of the same job.
const textOf = (j?: Job) => ((j?.payload.message as { text?: string } | undefined)?.text ?? (j?.payload.text as string | undefined) ?? (j?.payload.fallbackText as string | undefined));
const rule = (id: string, spec: unknown) => ({ id, version: 1, priority: 100, createdAt: new Date("2026-10-01T00:00:00Z"), spec });

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(world, { msg: null, jobs: [], outcomes: [], rules: [], runs: [], product: null, pauses: [], next: 0 });
  slots.baghdadDay.mockReturnValue("2026-10-19");
  slots.takeDaily.mockResolvedValue(1);
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;

  db.conversationMessage.findUnique.mockImplementation(async () => world.msg);
  db.conversationMessage.update.mockImplementation(async (a: { data: { outcome: string; outcomeReason: string | null } }) => void world.outcomes.push({ outcome: a.data.outcome, outcomeReason: a.data.outcomeReason }));
  db.conversationMessage.count.mockResolvedValue(0);
  db.conversationMessage.findFirst.mockResolvedValue(null);
  db.postAutomation.findUnique.mockResolvedValue({ id: "pa1", enabled: true, productId: null, templateId: null, postCreatedAt: new Date(Date.now() - 3_600_000), activeUntil: new Date(Date.now() + 86_400_000) });
  db.postAutomation.count.mockResolvedValue(0);
  db.threadPause.count.mockResolvedValue(0);
  db.threadPause.create.mockImplementation(async (a: { data: Record<string, unknown> }) => void world.pauses.push(a.data));
  db.outboxJob.count.mockImplementation(async (a: { where?: { messageId?: string; kind?: string } }) => world.jobs.filter((j) => (!a.where?.messageId || j.messageId === a.where.messageId) && (!a.where?.kind || j.kind === a.where.kind)).length);
  db.outboxJob.create.mockImplementation(async (a: { data: { kind: string; messageId: string; payload: Record<string, unknown> } }) => {
    if (world.jobs.some((j) => j.messageId === a.data.messageId && j.kind === a.data.kind)) throw unique();
    const job = { id: `job${++world.next}`, kind: a.data.kind, messageId: a.data.messageId, status: "PENDING", payload: a.data.payload };
    world.jobs.push(job);
    return { id: job.id };
  });
  db.outboxJob.findFirst.mockResolvedValue(null);
  db.outboxJob.findMany.mockImplementation(async (a: { where: { messageId: string; kind: { in: string[] } } }) => world.jobs.filter((j) => j.messageId === a.where.messageId && a.where.kind.in.includes(j.kind)));
  db.product.findUnique.mockImplementation(async () => world.product);
  db.automationTemplate.findUnique.mockResolvedValue(null);
  db.order.count.mockResolvedValue(0);
  db.order.findFirst.mockResolvedValue(null);
  db.shopRule.findMany.mockImplementation(async () => world.rules);
  db.ruleRun.findMany.mockImplementation(async (a: { where: { messageId?: string } }) => (a.where.messageId ? world.runs.filter((r) => r.messageId === a.where.messageId) : []));
  db.ruleRun.create.mockImplementation(async (a: { data: Record<string, unknown> }) => {
    const d = a.data as { ruleId: string; messageId: string; status: string; actions: unknown[]; reason: string | null };
    if (world.runs.some((r) => r.ruleId === d.ruleId && r.messageId === d.messageId)) throw unique();
    const run = { id: `run${world.runs.length + 1}`, ruleId: d.ruleId, messageId: d.messageId, status: d.status, actions: d.actions, reason: d.reason, data: a.data };
    world.runs.push(run);
    return { id: run.id };
  });
  db.ruleRun.updateMany.mockImplementation(async (a: { where: { id: string }; data: { status?: string; actions?: unknown[] } }) => {
    const run = world.runs.find((r) => r.id === a.where.id);
    if (run) Object.assign(run, a.data);
    return { count: run ? 1 : 0 };
  });
  db.usage.findMany.mockResolvedValue([]);
  runJob.mockImplementation(async (id: string) => {
    const j = world.jobs.find((x) => x.id === id);
    if (j) j.status = "SENT";
  });
});
afterEach(() => {
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
  vi.restoreAllMocks();
});

describe("a comment, rules switched off: the pipeline as it always was", () => {
  it("answers a question with the shop's default message and the usual public line, and never reads a rule", async () => {
    world.msg = aComment();
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Default DM from the shop");
    expect(jobOf("PUBLIC_REPLY")?.payload.requiresPrivate).toBe(true);
    expect(lastOutcome()).toEqual({ outcome: "AUTO_REPLIED", outcomeReason: null });
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(db.shopRule.findMany).not.toHaveBeenCalled();
    expect(db.ruleRun.create).not.toHaveBeenCalled();
  });
});

describe("a comment, rules switched on", () => {
  beforeEach(() => {
    process.env.SHOP_RULES_ENABLED = "1";
  });

  it("sends the owner's text as the private reply (in the buyer's language), keeps the public line, and logs the rule as done", async () => {
    world.msg = aComment();
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery", "ckb") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toContain("گەیاندن بۆ هەموو شارەکان");
    expect(textOf(jobOf("PRIVATE_REPLY"))).not.toContain("Default DM");
    expect(jobOf("PUBLIC_REPLY")?.payload.requiresPrivate).toBe(true);
    expect(lastOutcome()).toEqual({ outcome: "AUTO_REPLIED", outcomeReason: null });
    expect(world.runs).toHaveLength(1);
    expect(world.runs[0].status).toBe("DONE");
    expect((world.runs[0].actions[0] as { jobId?: string }).jobId).toBe(jobOf("PRIVATE_REPLY")?.id);
    expect(JSON.stringify(world.runs)).not.toContain("please");
  });

  it("with the rule saying no public line, only the private reply goes", async () => {
    world.msg = aComment();
    world.rules = [rule("r1", infoRule({ actions: [{ do: "reply", publicLine: "none", texts: { default: "Only private" } }] }))];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Only private");
    expect(jobOf("PUBLIC_REPLY")).toBeUndefined();
  });

  it("a comment no rule matches gets our reply as before, and only the matching rules leave a log row", async () => {
    world.msg = aComment("nice colour");
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Default DM from the shop");
    expect(world.runs).toHaveLength(0);
  });

  it("a rule that only flags puts the message on the owner's pile and leaves our reply alone", async () => {
    world.msg = aComment("info about the dress");
    world.rules = [rule("r1", infoRule({ actions: [{ do: "flag_owner", note: "look at this" }] }))];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Default DM from the shop");
    expect(lastOutcome()).toEqual({ outcome: "AUTO_REPLIED", outcomeReason: "needs_you" });
    expect(world.runs[0].status).toBe("DONE");
  });

  it("a flag on a comment we would not answer is FLAGGED needs_you", async () => {
    world.msg = aComment("info");
    world.rules = [rule("r1", infoRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, types: ["OTHER"] }, actions: [{ do: "flag_owner" }], examples: [{ text: "info", match: true, as: { type: "OTHER" } }, { text: "hello there", match: false }] }))];
    await processMessage("m1", { classify: labelled("OTHER", "none") });
    expect(world.jobs).toHaveLength(0);
    expect(lastOutcome()).toEqual({ outcome: "FLAGGED", outcomeReason: "needs_you" });
  });

  it("a complaint is never answered by a rule, whatever words it holds", async () => {
    world.msg = aComment("info: the dress I got was torn");
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("COMPLAINT", "none") });
    expect(world.jobs).toHaveLength(0);
    expect(lastOutcome()).toEqual({ outcome: "FLAGGED", outcomeReason: "complaint" });
    expect(world.runs[0]).toMatchObject({ status: "SKIPPED", reason: "never_answered" });
  });

  it("where our answer is the product card, a rule that keeps the card stays silent; one that replaces it speaks", async () => {
    world.product = { id: "p1", active: true, name: "Red dress", photos: [], variants: [{ label: "", amountMinor: 25000, currency: "IQD", inStock: true }] };
    db.postAutomation.findUnique.mockResolvedValue({ id: "pa1", enabled: true, productId: "p1", templateId: null, postCreatedAt: new Date(Date.now() - 3_600_000), activeUntil: new Date(Date.now() + 86_400_000) });
    world.msg = aComment();
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toContain("Red dress");
    expect(world.runs[0]).toMatchObject({ status: "SKIPPED", reason: "product_card" });

    Object.assign(world, { jobs: [], outcomes: [], runs: [], next: 0 });
    world.rules = [rule("r1", infoRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, productCard: "replace" } }))];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toContain("We deliver");
    expect(textOf(jobOf("PRIVATE_REPLY"))).not.toContain("Red dress");
  });

  it("a rule that breaks changes nothing: our reply goes out and the message is finished", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    world.msg = aComment();
    db.shopRule.findMany.mockRejectedValue(new Error("connection lost"));
    await expect(processMessage("m1", { classify: labelled("QUESTION", "delivery") })).resolves.toBeUndefined();
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Default DM from the shop");
    expect(lastOutcome()).toEqual({ outcome: "AUTO_REPLIED", outcomeReason: null });
    expect(err).toHaveBeenCalled();
  });

  it("a second run of the same message (the stuck-message sweep) sends nothing more and decides nothing again", async () => {
    world.msg = aComment();
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    const jobs = world.jobs.length;
    // the first run died before the outcome was stored: the sweep runs the message again
    world.msg = aComment();
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(world.jobs).toHaveLength(jobs);
    expect(world.runs).toHaveLength(1);
    expect(slots.takeDaily).toHaveBeenCalledTimes(1);
  });

  it("in test mode the rule is only written down: our reply goes out, the log says DRY", async () => {
    process.env.RULES_DRY_RUN = "1";
    world.msg = aComment();
    world.rules = [rule("r1", infoRule())];
    await processMessage("m1", { classify: labelled("QUESTION", "delivery") });
    expect(textOf(jobOf("PRIVATE_REPLY"))).toBe("Default DM from the shop");
    expect(world.runs).toHaveLength(1);
    expect(world.runs[0].status).toBe("DRY");
    expect(slots.takeDaily).not.toHaveBeenCalled();
  });
});

describe("a private message, rules switched on", () => {
  beforeEach(() => {
    process.env.SHOP_RULES_ENABLED = "1";
  });

  it("without a rule the shop (which knows no product here) leaves the message to the owner", async () => {
    world.msg = aChat();
    await processMessage("d1", { classify: labelled("QUESTION", "address") });
    expect(world.jobs).toHaveLength(0);
    expect(lastOutcome()).toEqual({ outcome: "FLAGGED", outcomeReason: "no_product" });
  });

  it("with a rule, the owner's text is the answer: one chat answer, no nudge afterwards, the message is settled", async () => {
    world.msg = aChat();
    world.rules = [rule("r2", addressRule())];
    await processMessage("d1", { classify: labelled("QUESTION", "address") });
    expect(world.jobs.map((j) => j.kind)).toEqual(["DM_ANSWER"]);
    expect(textOf(jobOf("DM_ANSWER"))).toBe("We are in Erbil, Gulan Street, opposite the park.");
    expect(lastOutcome()).toEqual({ outcome: "AUTO_REPLIED", outcomeReason: null });
    expect(world.runs[0]).toMatchObject({ ruleId: "r2", status: "DONE" });
  });

  it("a buyer in the middle of giving order details is never interrupted by a rule", async () => {
    world.msg = aChat("my address is Erbil, Gulan, and my phone is 07501234567");
    world.rules = [rule("r2", addressRule())];
    // an order whose details are being collected: the buyer's message is the next answer (the order step handles it)
    db.order.findFirst.mockResolvedValueOnce({ id: "o1", productId: null, customerName: "", phone: null, city: null, address: null, productName: "Dress", variantLabel: null, amountMinor: 25000, currency: "IQD", collect: "ask" });
    await processMessage("d1", { classify: labelled("QUESTION", "address") });
    expect(db.shopRule.findMany).not.toHaveBeenCalled();
    expect(world.runs).toHaveLength(0);
    expect(world.jobs.map((j) => j.kind)).toEqual(["DM_ANSWER"]);
    expect(textOf(jobOf("DM_ANSWER"))).not.toContain("Gulan Street");
  });

  it("a flag rule marks the message needs_you even though no answer is sent", async () => {
    world.msg = aChat("I want a refund");
    world.rules = [rule("r3", flagRule())];
    await processMessage("d1", { classify: labelled("COMPLAINT", "none") });
    expect(world.jobs).toHaveLength(0);
    expect(lastOutcome()).toEqual({ outcome: "FLAGGED", outcomeReason: "needs_you" });
    expect(world.runs[0]).toMatchObject({ status: "DONE" });
  });

  it("the second message of the same person on the same day is held by the person's cap", async () => {
    world.msg = aChat();
    world.rules = [rule("r2", addressRule())];
    await processMessage("d1", { classify: labelled("QUESTION", "address") });
    // the second message: the person's runs today now include the first (the log is the counter)
    db.ruleRun.findMany.mockImplementation(async (a: { where: { messageId?: string; ruleId?: unknown } }) => {
      if (a.where.messageId) return [];
      return a.where.ruleId ? [{ ruleId: "r2" }] : [];
    });
    world.msg = { ...aChat("address please"), id: "d2", externalMessageId: "mid2" };
    await processMessage("d2", { classify: labelled("QUESTION", "address") });
    expect(world.jobs.filter((j) => j.kind === "DM_ANSWER")).toHaveLength(1);
    expect(world.runs.find((r) => r.messageId === "d2")).toMatchObject({ status: "SKIPPED", reason: "cap_person" });
  });
});
