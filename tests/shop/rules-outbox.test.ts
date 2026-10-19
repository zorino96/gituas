import { beforeEach, describe, expect, it, vi } from "vitest";

// A text over the platform's length limit can never be sent. Meta's refusal is classified "too_long", which is FINAL: the job is FAILED at
// once (not retried five times), the log can say why with a short code, and a reply that was an answer puts the message on the owner's
// "needs you" list, because the buyer got nothing. The owner's words are never cut to fit.

const db = vi.hoisted(() => ({
  outboxJob: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  threadPause: { count: vi.fn() },
  conversationMessage: { update: vi.fn(), count: vi.fn() },
  order: { count: vi.fn() },
  store: { update: vi.fn() },
}));
const meta = vi.hoisted(() => ({
  accountFor: vi.fn(),
  hideComment: vi.fn(),
  likeComment: vi.fn(),
  privateReply: vi.fn(),
  replyToComment: vi.fn(),
  sendDm: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/shop/meta-client", () => meta);

import { classifyMetaError, MAX_ATTEMPTS, retryable } from "@/lib/shop/meta-errors";
import { runJob } from "@/lib/shop/outbox";

const TOO_LONG_BODY = { error: { message: "(#100) Length of param message[text] must be less than or equal to 1000", type: "OAuthException", code: 100 } };

describe("classifyMetaError: a text that is too long", () => {
  it("knows Instagram's refusal of a long message, and says it is final", () => {
    expect(classifyMetaError(400, TOO_LONG_BODY)).toBe("too_long");
    expect(retryable("too_long")).toBe(false);
    expect(classifyMetaError(400, { error: { code: 100, message: "Message is too long" } })).toBe("too_long");
    expect(classifyMetaError(400, { error: { message: "The message text is too long" } })).toBe("too_long");
  });

  it("leaves every other failure as it was", () => {
    expect(classifyMetaError(400, { error: { code: 100, message: "Invalid parameter" } })).toBe("other");
    expect(classifyMetaError(401, {})).toBe("token");
    expect(classifyMetaError(400, { error: { code: 190 } })).toBe("token");
    expect(classifyMetaError(429, {})).toBe("rate");
    expect(classifyMetaError(400, { error: { code: 10900 } })).toBe("duplicate");
    expect(classifyMetaError(400, { error: { code: 131047 } })).toBe("window");
    expect(classifyMetaError(400, { error: { error_subcode: 33 } })).toBe("gone");
    expect(retryable("other")).toBe(true);
    expect(retryable("rate")).toBe(true);
  });
});

describe("runJob: a too-long text", () => {
  const job = (kind: string, over: Record<string, unknown> = {}) => ({
    id: "j1", kind, status: "PENDING", attempts: 0, messageId: "m1", storeId: "s1", recipientId: "u1", createdAt: new Date(),
    payload: kind === "PRIVATE_REPLY" ? { commentId: "c1", message: { text: "long text" } } : { recipientId: "u1", message: { text: "long text" } },
    store: { id: "s1", tenantId: "t1", fbPageId: "fb1", igUserId: "ig1", waPhoneNumberId: null, automationEnabled: true },
    message: { platform: "META_INSTAGRAM" },
    ...over,
  });
  const updates = () => db.outboxJob.update.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    vi.resetAllMocks();
    db.outboxJob.updateMany.mockResolvedValue({ count: 1 });
    db.threadPause.count.mockResolvedValue(0);
    db.conversationMessage.update.mockResolvedValue({});
    meta.accountFor.mockResolvedValue({ platform: "META_INSTAGRAM" });
  });

  it("an answer in the chat is FAILED at once with the short code, never retried, and the message goes to the owner's needs-you list", async () => {
    db.outboxJob.findUnique.mockResolvedValue(job("DM_ANSWER"));
    meta.sendDm.mockResolvedValue({ ok: false, failure: "too_long", error: "400 100 (#100) Length of param message[text] must be less than or equal to 1000" });
    await runJob("j1", { immediate: true });
    expect(meta.sendDm).toHaveBeenCalledTimes(1);
    expect(updates()).toEqual([{ where: { id: "j1" }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: "too_long" } }]);
    expect(updates()[0].data).not.toHaveProperty("nextAttemptAt");
    expect(db.conversationMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { outcome: "FLAGGED", outcomeReason: "needs_you" } });
  });

  it("the private reply to a comment is treated the same way", async () => {
    db.outboxJob.findUnique.mockResolvedValue(job("PRIVATE_REPLY"));
    meta.privateReply.mockResolvedValue({ ok: false, failure: "too_long", error: "x" });
    await runJob("j1", { immediate: true });
    expect(updates()[0].data).toMatchObject({ status: "FAILED", lastError: "too_long" });
    expect(db.conversationMessage.update).toHaveBeenCalledTimes(1);
  });

  it("a nudge that is too long fails too, but it was no answer, so the owner's list is left alone", async () => {
    db.outboxJob.findUnique.mockResolvedValue(job("DM_FOLLOWUP"));
    db.conversationMessage.count.mockResolvedValue(0);
    db.order.count.mockResolvedValue(0);
    meta.sendDm.mockResolvedValue({ ok: false, failure: "too_long", error: "x" });
    await runJob("j1", { immediate: true });
    expect(updates()[0].data).toMatchObject({ status: "FAILED", lastError: "too_long" });
    expect(db.conversationMessage.update).not.toHaveBeenCalled();
  });

  it("a failure to flag the message never breaks the job's own record", async () => {
    db.outboxJob.findUnique.mockResolvedValue(job("DM_ANSWER"));
    db.conversationMessage.update.mockRejectedValue(new Error("down"));
    meta.sendDm.mockResolvedValue({ ok: false, failure: "too_long", error: "x" });
    await expect(runJob("j1", { immediate: true })).resolves.toBeUndefined();
    expect(updates()[0].data).toMatchObject({ status: "FAILED" });
  });

  it("any other failure is still retried with a back-off, up to the limit", async () => {
    db.outboxJob.findUnique.mockResolvedValue(job("DM_ANSWER"));
    meta.sendDm.mockResolvedValue({ ok: false, failure: "other", error: "boom" });
    await runJob("j1", { immediate: true });
    expect(updates()[0].data).toMatchObject({ attempts: 1, lastError: "boom" });
    expect(updates()[0].data).toHaveProperty("nextAttemptAt");
    expect(updates()[0].data).not.toHaveProperty("status");
    expect(db.conversationMessage.update).not.toHaveBeenCalled();

    db.outboxJob.update.mockClear();
    db.outboxJob.findUnique.mockResolvedValue(job("DM_ANSWER", { attempts: MAX_ATTEMPTS - 1 }));
    await runJob("j1", { immediate: true });
    expect(updates()[0].data).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
  });
});
