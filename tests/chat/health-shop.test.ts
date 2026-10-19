import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shop finders of "check everything". The database is replaced; what is tested is the part that is ours: for every area a bad
// case and a good case, every query scoped by the workspace, counts and our own labels only (no buyer's words are ever selected), and
// the rules finder that exists only while the owner rules are switched on.

const db = vi.hoisted(() => ({
  oAuthCredential: { findMany: vi.fn() },
  store: { findMany: vi.fn() },
  tenant: { findUnique: vi.fn() },
  auditLog: { findMany: vi.fn() },
  scheduledPost: { count: vi.fn() },
  outboxJob: { count: vi.fn(), findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn() },
  threadPause: { findMany: vi.fn() },
  order: { count: vi.fn() },
  product: { count: vi.fn() },
  shopRule: { count: vi.fn() },
  ruleRun: { count: vi.fn() },
  chatRun: { count: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { Prisma } from "@/generated/prisma/client";
import {
  chatActionsFinder,
  connectionsFinder,
  inboxFinder,
  lostAttempts,
  ordersFinder,
  outboxFinder,
  postsFinder,
  productsFinder,
  rulesFinder,
  scheduledFinder,
  settingsFinder,
  shopFinders,
} from "@/lib/chat/health/shop";
import type { Finder, HealthCtx } from "@/lib/chat/health/types";
import { say } from "@/lib/chat/text";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { Lang } from "@/lib/i18n/lang";

const NOW = new Date("2026-10-19T09:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);
/** A failed-post audit row per age, newest rows first or not: the finder sorts them itself. */
const failedRows = (...agesMs: number[]) => agesMs.map((a) => ({ action: "app.publish_failed", createdAt: at(-a), metadata: { target: "FB", error: "x" } }));
const row = (action: string, agoMs: number, target: string | null, extra: Record<string, unknown> = {}) => ({
  action,
  createdAt: at(-agoMs),
  metadata: { ...(target ? { target } : {}), ...extra },
});

const hc = (lang: Lang = "en"): HealthCtx => ({ tenantId: "t1", lang, kind: "shop", base: "/app", now: NOW });
const run = (f: Finder, lang: Lang = "en") => f.run(hc(lang));
const allMocks = () => Object.values(db).flatMap((t) => Object.values(t) as ReturnType<typeof vi.fn>[]);

const STORE = { fbPageId: "fb1", igUserId: "ig1", pausedReason: null, automationEnabled: true, plan: "FREE", planPaidUntil: null };
const LIVE_FB = { provider: "META_FACEBOOK", providerAccountId: "fb1", expiresAt: at(60 * DAY) };
const LIVE_IG = { provider: "META_INSTAGRAM", providerAccountId: "ig1", expiresAt: null };

let seq = 0;
/** A flagged inbound message, as the open-items read selects it. `age` is how long ago it came in. */
const flagged = (o: Partial<{ platform: string; channelType: string; authorId: string | null; externalThreadId: string | null; externalMessageId: string | null; parentCommentId: string | null; outcomeReason: string; age: number }> = {}) => {
  const { age = 3 * HOUR, ...rest } = o;
  return {
    platform: "META_INSTAGRAM",
    channelType: "DM",
    authorId: "buyer1",
    externalThreadId: null,
    externalMessageId: `m${++seq}`,
    parentCommentId: null,
    outcomeReason: "needs_you",
    createdAt: at(-age),
    ...rest,
  };
};
const comment = (o: Parameters<typeof flagged>[0] = {}) => flagged({ channelType: "COMMENT", authorId: `author${seq}`, externalThreadId: "post1", ...o });

/** Everything healthy. */
function clear() {
  db.oAuthCredential.findMany.mockResolvedValue([LIVE_FB, LIVE_IG]);
  db.store.findMany.mockResolvedValue([STORE]);
  db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647501234567", unlimited: false });
  for (const fn of [db.scheduledPost.count, db.outboxJob.count, db.order.count, db.product.count, db.shopRule.count, db.ruleRun.count, db.chatRun.count]) {
    fn.mockResolvedValue(0);
  }
  db.conversationMessage.findMany.mockResolvedValue([]);
  db.threadPause.findMany.mockResolvedValue([]);
  db.outboxJob.findMany.mockResolvedValue([]);
  db.auditLog.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
  clear();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
});

describe("connections", () => {
  it("a live connection on both platforms is fine", async () => {
    expect(await run(connectionsFinder)).toEqual([]);
  });

  it("an expired Facebook Page is urgent, with the number, a fix for the model and the Settings screen", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...LIVE_FB, expiresAt: at(-DAY) }, LIVE_IG]);
    const [f, ...rest] = await run(connectionsFinder);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ area: "connections", severity: "high", href: "/app/settings" });
    expect(f.text).toBe("The connection of 1 Facebook Page has ended, so posts and replies there are not going out.");
    expect(f.fix).toMatch(/reconnect/i);
    expect(f.todo).toBe("Reconnect it in Settings.");
  });

  it("an expired credential does not count when the same account was reconnected since (one row is live)", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...LIVE_FB, expiresAt: at(-DAY) }, LIVE_FB, LIVE_IG]);
    expect(await run(connectionsFinder)).toEqual([]);
  });

  it("a Page with no credential at all counts as lost; an ad account is not a Page", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([LIVE_IG, { provider: "META_FACEBOOK", providerAccountId: "act_1", expiresAt: at(DAY) }]);
    const out = await run(connectionsFinder);
    expect(out.map((f) => f.severity)).toEqual(["high"]);
    expect(out[0].text).toContain("1 Facebook Page");
  });

  it("an expired Instagram account is urgent too", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([LIVE_FB, { ...LIVE_IG, expiresAt: at(-HOUR) }]);
    const out = await run(connectionsFinder);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("1 Instagram account");
  });

  it("nothing connected at all is urgent and says the person must connect it", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([]);
    db.store.findMany.mockResolvedValue([]);
    const [f] = await run(connectionsFinder);
    expect(f.severity).toBe("high");
    expect(f.text).toMatch(/No Facebook Page or Instagram account is connected/);
    expect(f.fix).toMatch(/you cannot do that for them/);
  });

  it("replies paused because Meta refused the token are urgent (once, not on top of an expired connection)", async () => {
    db.store.findMany.mockResolvedValue([{ ...STORE, pausedReason: "token" }]);
    const out = await run(connectionsFinder);
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/Automatic replies are paused in 1 shop/);
    db.oAuthCredential.findMany.mockResolvedValue([{ ...LIVE_FB, expiresAt: at(-DAY) }, LIVE_IG]);
    expect((await run(connectionsFinder)).map((f) => f.text)).toEqual(["The connection of 1 Facebook Page has ended, so posts and replies there are not going out."]);
  });

  it("a Facebook connection that ends within a week is a medium warning", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...LIVE_FB, expiresAt: at(3 * DAY) }, LIVE_IG]);
    const [f] = await run(connectionsFinder);
    expect(f).toMatchObject({ severity: "medium", text: "The connection of 1 Facebook Page ends within a week." });
  });

  it("reads only this workspace's credentials and stores", async () => {
    await run(connectionsFinder);
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.store.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.oAuthCredential.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });

  it("tells the person to reconnect with the right Sorani verb (not the verb for 'fall')", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...LIVE_FB, expiresAt: at(-DAY) }, LIVE_IG]);
    expect((await run(connectionsFinder, "ckb"))[0].todo).toBe("لە ڕێکخستن دووبارە پەیوەستی بکەرەوە.");
  });
});

describe("posts", () => {
  const finder = postsFinder(["app.publish_failed"]);

  it("nothing failed is fine", async () => {
    expect(await run(finder)).toEqual([]);
  });

  it("a failure in the last day is urgent; one only in the last week is medium (each attempt apart)", async () => {
    db.auditLog.findMany.mockResolvedValue(failedRows(HOUR, 5 * HOUR, 3 * DAY));
    const [day] = await run(finder);
    expect(day).toMatchObject({ area: "posts", severity: "high", text: "2 posts could not be published in the last 24 hours.", href: "/app/publish" });
    db.auditLog.findMany.mockResolvedValue(failedRows(2 * DAY, 3 * DAY, 4 * DAY));
    const [week] = await run(finder);
    expect(week).toMatchObject({ severity: "medium", text: "3 posts could not be published in the last 7 days." });
  });

  it("is ONE read, scoped by the workspace, for the failure actions and the successful posts that follow them, 100 rows at most", async () => {
    await run(postsFinder(["app.publish_failed", "news.autopilot_publish_failed"]));
    expect(db.auditLog.findMany.mock.calls.length).toBe(1);
    const a = db.auditLog.findMany.mock.calls[0][0];
    expect(a.where).toMatchObject({ tenantId: "t1", action: { in: ["app.publish_failed", "news.autopilot_publish_failed", "app.publish"] } });
    expect(a.where.createdAt.gt.getTime()).toBe(NOW.getTime() - 7 * DAY);
    expect(a.take).toBe(100);
    expect(a.select).toEqual({ action: true, createdAt: true, metadata: true });
  });

  it("does not count Instagram still preparing a video, nor the autopilot leaving a draft for a person", async () => {
    db.auditLog.findMany.mockResolvedValue([
      row("app.publish_failed", HOUR, "IG", { error: en.actions.publish.igProcessing }),
      row("app.publish_failed", HOUR, "IG", { error: ckb.actions.publish.igProcessing }),
      { action: "news.autopilot_publish_failed", createdAt: at(-HOUR), metadata: { error: "out of time", draftId: "d" } },
    ]);
    expect(await run(finder)).toEqual([]);
    // a real failure next to them is still counted, and a row with no metadata at all is a failure too
    db.auditLog.findMany.mockResolvedValue([
      row("app.publish_failed", HOUR, "IG", { error: en.actions.publish.igProcessing }),
      row("app.publish_failed", 5 * HOUR, "IG", { error: "Instagram publish 400" }),
      { action: "app.publish_failed", createdAt: at(-9 * HOUR), metadata: null },
    ]);
    const [f] = await run(finder);
    expect(f).toMatchObject({ severity: "high", text: "2 posts could not be published in the last 24 hours." });
  });

  it("one post that failed on Facebook and Instagram is ONE failed post, not two", async () => {
    db.auditLog.findMany.mockResolvedValue([row("app.publish_failed", HOUR, "FB", { error: "x" }), row("app.publish_failed", HOUR - 4_000, "IG", { error: "y" })]);
    expect((await run(finder))[0].text).toBe("1 post could not be published in the last 24 hours.");
  });

  it("on a news desk the autopilot's own note next to its failed targets is the same attempt (3 rows, 1 post)", async () => {
    const desk = postsFinder(["app.publish_failed", "news.autopilot_publish_failed"]);
    db.auditLog.findMany.mockResolvedValue([
      row("app.publish_failed", 2 * HOUR, "FB", { error: "x" }),
      row("app.publish_failed", 2 * HOUR - 3_000, "IG", { error: "y" }),
      { action: "news.autopilot_publish_failed", createdAt: at(-2 * HOUR + 8_000), metadata: { itemId: "i", draftId: "d", error: "FB: x | IG: y" } },
    ]);
    expect((await run(desk))[0].text).toBe("1 post could not be published in the last 24 hours.");
    // a note with no target row beside it (the card or the post was refused before anything was sent) is a lost attempt on its own
    db.auditLog.findMany.mockResolvedValue([{ action: "news.autopilot_publish_failed", createdAt: at(-2 * HOUR), metadata: { itemId: "i", draftId: "d", error: "no allowed target" } }]);
    expect((await run(desk))[0].text).toBe("1 post could not be published in the last 24 hours.");
  });

  it("rows more than two minutes apart are separate attempts", async () => {
    db.auditLog.findMany.mockResolvedValue([row("app.publish_failed", HOUR, "FB", { error: "x" }), row("app.publish_failed", HOUR - 5 * MIN, "FB", { error: "x" })]);
    expect((await run(finder))[0].text).toBe("2 posts could not be published in the last 24 hours.");
  });

  it("a failure that was posted again to the same target within half an hour is not reported", async () => {
    db.auditLog.findMany.mockResolvedValue([row("app.publish_failed", 3 * HOUR, "FB", { error: "x" }), row("app.publish", 3 * HOUR - 10 * MIN, "FB", { url: "u" })]);
    expect(await run(finder)).toEqual([]);
  });

  it("a later post to ANOTHER target, to another account, much later, or BEFORE the failure does not clear it", async () => {
    const failed = row("app.publish_failed", 3 * HOUR, "FB", { error: "x", accountId: "fb1" });
    for (const ok of [
      row("app.publish", 3 * HOUR - 10 * MIN, "IG", { accountId: "ig1" }),
      row("app.publish", 3 * HOUR - 10 * MIN, "FB", { accountId: "fb2" }),
      row("app.publish", 3 * HOUR - 40 * MIN, "FB", { accountId: "fb1" }),
      row("app.publish", 3 * HOUR + 10 * MIN, "FB", { accountId: "fb1" }),
    ]) {
      db.auditLog.findMany.mockResolvedValue([failed, ok]);
      expect((await run(finder))[0].text, JSON.stringify(ok)).toBe("1 post could not be published in the last 24 hours.");
    }
    // the same account does
    db.auditLog.findMany.mockResolvedValue([failed, row("app.publish", 3 * HOUR - 10 * MIN, "FB", { accountId: "fb1" })]);
    expect(await run(finder)).toEqual([]);
  });

  it("an attempt where one target was posted again and the other was not is still one lost post", async () => {
    db.auditLog.findMany.mockResolvedValue([
      row("app.publish_failed", 3 * HOUR, "FB", { error: "x" }),
      row("app.publish_failed", 3 * HOUR - 2_000, "IG", { error: "y" }),
      row("app.publish", 3 * HOUR - 10 * MIN, "FB"),
    ]);
    expect((await run(finder))[0].text).toBe("1 post could not be published in the last 24 hours.");
  });

  it("lostAttempts gives the time each lost attempt began, and rows without an action count as failures", () => {
    const t = lostAttempts([{ createdAt: at(-HOUR), metadata: { target: "FB", error: "x" } }, row("app.publish_failed", HOUR - 1_000, "IG")]);
    expect(t.map((d) => d.getTime())).toEqual([at(-HOUR).getTime()]);
  });
});

describe("scheduled posts", () => {
  it("none overdue or failed is fine; some overdue by more than 15 minutes is medium", async () => {
    expect(await run(scheduledFinder)).toEqual([]);
    db.scheduledPost.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "PENDING" ? 1 : 0));
    const [f, ...rest] = await run(scheduledFinder);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ area: "scheduled", severity: "medium", text: "1 scheduled post is more than 15 minutes late." });
    const where = db.scheduledPost.count.mock.calls.map((c) => c[0].where).find((w) => w.status === "PENDING");
    expect(where).toMatchObject({ tenantId: "t1", status: "PENDING" });
    expect(where.runAt.lt.getTime()).toBe(NOW.getTime() - 15 * 60_000);
  });

  it("a scheduled post that FAILED with no result (so no audit row says so) is reported, for the last 7 days", async () => {
    db.scheduledPost.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "FAILED" ? 2 : 0));
    const [f, ...rest] = await run(scheduledFinder);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ area: "scheduled", severity: "medium", text: "2 scheduled posts failed to go out in the last 7 days.", href: "/app/publish" });
    expect(f.fix).toMatch(/check the Page/i);
    const where = db.scheduledPost.count.mock.calls.map((c) => c[0].where).find((w) => w.status === "FAILED");
    // Runs that kept a result already have an "app.publish_failed" row each (the posts finder): only the ones with no result are new here.
    expect(where).toMatchObject({ tenantId: "t1", status: "FAILED", result: { equals: Prisma.DbNull } });
    expect(where.updatedAt.gt.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });

  it("late and failed posts are told apart when both exist", async () => {
    db.scheduledPost.count.mockResolvedValue(1);
    expect((await run(scheduledFinder)).map((f) => f.text)).toEqual(["1 scheduled post is more than 15 minutes late.", "1 scheduled post failed to go out in the last 7 days."]);
  });
});

describe("replies going out", () => {
  it("nothing stuck is fine", async () => {
    expect(await run(outboxFinder)).toEqual([]);
  });

  it("stuck, failed and 'needs you' are each urgent, with their own numbers (needs you counts buyers)", async () => {
    db.outboxJob.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "PENDING" ? 4 : 2));
    db.conversationMessage.findMany.mockResolvedValue([1, 2, 3, 4, 5].map((i) => flagged({ authorId: `b${i}` })));
    const out = await run(outboxFinder);
    expect(out.map((f) => f.severity)).toEqual(["high", "high", "high"]);
    expect(out.map((f) => f.text)).toEqual([
      "4 replies are stuck in the sending queue and not reaching buyers.",
      "2 replies to buyers could not be sent in the last 7 days.",
      '5 messages are marked "needs you" and still waiting for an answer.',
    ]);
  });

  it("looks only at this workspace's queue and at answers (not likes or hides); a failed reply whose message is 'needs you' is left to that finding", async () => {
    await run(outboxFinder);
    for (const call of db.outboxJob.count.mock.calls) expect(call[0].where.store).toEqual({ tenantId: "t1" });
    const failed = db.outboxJob.count.mock.calls.map((c) => c[0].where).find((w) => w.status === "FAILED");
    expect(failed.kind.in).toEqual(["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"]);
    expect(failed.message).toEqual({ OR: [{ outcomeReason: null }, { outcomeReason: { not: "needs_you" } }] });
    expect(db.conversationMessage.findMany.mock.calls[0][0].where).toMatchObject({ store: { tenantId: "t1" }, direction: "INBOUND", outcome: "FLAGGED" });
    expect(db.conversationMessage.findMany.mock.calls[0][0].where.outcomeReason.in).toContain("needs_you");
  });

  it("the fix for failed replies does not claim that the buyers got nothing", async () => {
    db.outboxJob.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "FAILED" ? 1 : 0));
    const [f] = await run(outboxFinder);
    expect(f.fix).not.toMatch(/buyers? got nothing/i);
    expect(f.fix).toMatch(/do not claim that nothing reached the buyer/);
    expect(f.fix).toMatch(/private reply/i);
  });

  it("a buyer who wrote three flagged messages is one buyer; the newest of them decides the reason", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      flagged({ authorId: "b1", age: 2 * HOUR }),
      flagged({ authorId: "b1", age: 5 * HOUR }),
      flagged({ authorId: "b1", age: 9 * HOUR }),
      flagged({ authorId: "b2", age: 4 * HOUR }),
    ]);
    expect((await run(outboxFinder))[0].text).toBe('2 messages are marked "needs you" and still waiting for an answer.');
    // the same buyer's newest flagged message is an older kind of waiting: they leave the needs-you count
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 2 * HOUR, outcomeReason: "unclear" }), flagged({ authorId: "b1", age: 9 * HOUR })]);
    expect(await run(outboxFinder)).toEqual([]);
  });

  it("'needs you' that came in less than an hour ago is not yet reported", async () => {
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 30 * MIN }), flagged({ authorId: "b2", age: 2 * HOUR })]);
    expect((await run(outboxFinder))[0].text).toBe('1 message is marked "needs you" and still waiting for an answer.');
  });

  it("a buyer the owner answered since (a pause newer than the message) is left out; an older pause does not hide a newer message", async () => {
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 5 * HOUR }), flagged({ authorId: "b2", age: 5 * HOUR }), flagged({ authorId: "b3", age: 5 * HOUR, platform: "META_FACEBOOK" })]);
    db.threadPause.findMany.mockResolvedValue([
      { platform: "META_INSTAGRAM", threadKey: "b1", createdAt: at(-2 * HOUR) },
      { platform: "META_INSTAGRAM", threadKey: "b2", createdAt: at(-9 * HOUR) },
      // a pause for the same id on another platform is another thread
      { platform: "META_INSTAGRAM", threadKey: "b3", createdAt: at(-HOUR) },
    ]);
    expect((await run(outboxFinder))[0].text).toBe('2 messages are marked "needs you" and still waiting for an answer.');
    const pause = db.threadPause.findMany.mock.calls[0][0];
    expect(pause.where.tenantId).toBe("t1");
    expect(pause.where.threadKey.in.sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("a buyer whose later message was answered (SENT) is left out; the same message's own reply is not an answer", async () => {
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 5 * HOUR }), flagged({ authorId: "b2", age: 5 * HOUR }), flagged({ authorId: "b3", age: 5 * HOUR })]);
    db.outboxJob.findMany.mockResolvedValue([
      { message: { platform: "META_INSTAGRAM", authorId: "b1", createdAt: at(-HOUR) } },
      { message: { platform: "META_INSTAGRAM", authorId: "b2", createdAt: at(-5 * HOUR) } },
      { message: { platform: "META_INSTAGRAM", authorId: "b3", createdAt: at(-8 * HOUR) } },
    ]);
    expect((await run(outboxFinder))[0].text).toBe('2 messages are marked "needs you" and still waiting for an answer.');
    const sent = db.outboxJob.findMany.mock.calls[0][0];
    expect(sent.where).toMatchObject({ store: { tenantId: "t1" }, status: "SENT", message: { direction: "INBOUND" } });
    expect(sent.where.kind.in).toEqual(["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"]);
    expect(sent.where.message.authorId.in.sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("a comment is a thread of its own: answered when the comment (or the one it replies to) is paused", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      comment({ externalMessageId: "c1", age: 5 * HOUR }),
      comment({ externalMessageId: "c2", age: 5 * HOUR, parentCommentId: "p2" }),
      comment({ externalMessageId: "c3", age: 5 * HOUR }),
    ]);
    db.threadPause.findMany.mockResolvedValue([
      { platform: "META_INSTAGRAM", threadKey: "c1", createdAt: at(-HOUR) },
      { platform: "META_INSTAGRAM", threadKey: "p2", createdAt: at(-HOUR) },
    ]);
    expect((await run(outboxFinder))[0].text).toBe('1 message is marked "needs you" and still waiting for an answer.');
    // comments need no outbox lookup: nobody's chat to match an answer against
    expect(db.outboxJob.findMany).not.toHaveBeenCalled();
  });

  it("is asked ONCE for the outbox and the inbox of one check (they share the read), in at most three reads", async () => {
    const c = hc();
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 5 * HOUR }), flagged({ authorId: "b2", age: 3 * DAY, outcomeReason: "no_product" })]);
    await Promise.all([outboxFinder.run(c), inboxFinder.run(c)]);
    expect(db.conversationMessage.findMany).toHaveBeenCalledTimes(1);
    expect(db.threadPause.findMany).toHaveBeenCalledTimes(1);
    expect(db.outboxJob.findMany).toHaveBeenCalledTimes(1);
    // another check asks again
    await run(inboxFinder);
    expect(db.conversationMessage.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("comments and messages waiting", () => {
  it("nothing waiting is fine", async () => {
    expect(await run(inboxFinder)).toEqual([]);
  });

  it("comments and buyers waiting over a day are medium, counted apart", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      comment({ externalMessageId: "c1", age: 2 * DAY, outcomeReason: "complaint" }),
      comment({ externalMessageId: "c2", age: 2 * DAY, outcomeReason: "negotiation" }),
      comment({ externalMessageId: "c3", age: 3 * DAY, outcomeReason: "no_product" }),
      flagged({ authorId: "b1", age: 2 * DAY, outcomeReason: "unclear" }),
    ]);
    const out = await run(inboxFinder);
    expect(out.map((f) => [f.severity, f.text, f.href])).toEqual([
      ["medium", "3 comments have waited more than a day for your answer.", "/app/comments"],
      ["medium", "1 message has waited more than a day for your answer.", "/app/messages"],
    ]);
  });

  it("counts buyers, not messages: three waiting messages of one buyer are one", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      flagged({ authorId: "b1", age: 2 * DAY, outcomeReason: "unclear" }),
      flagged({ authorId: "b1", age: 3 * DAY, outcomeReason: "other" }),
      flagged({ authorId: "b1", age: 4 * DAY, outcomeReason: "no_action" }),
      flagged({ authorId: "b2", age: 2 * DAY, outcomeReason: "unclear" }),
    ]);
    expect((await run(inboxFinder))[0].text).toBe("2 messages have waited more than a day for your answer.");
  });

  it("messages that are younger than a day, and 'needs you' (its own finding), are not here", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      flagged({ authorId: "b1", age: 5 * HOUR, outcomeReason: "unclear" }),
      flagged({ authorId: "b2", age: 3 * DAY, outcomeReason: "needs_you" }),
    ]);
    expect(await run(inboxFinder)).toEqual([]);
  });

  it("a buyer the owner already answered is not reported any more (pause, or a later answer that was sent)", async () => {
    db.conversationMessage.findMany.mockResolvedValue([
      flagged({ authorId: "b1", age: 2 * DAY, outcomeReason: "unclear" }),
      flagged({ authorId: "b2", age: 2 * DAY, outcomeReason: "unclear" }),
      flagged({ authorId: "b3", age: 2 * DAY, outcomeReason: "unclear" }),
      comment({ externalMessageId: "c1", age: 2 * DAY, outcomeReason: "complaint" }),
    ]);
    db.threadPause.findMany.mockResolvedValue([
      { platform: "META_INSTAGRAM", threadKey: "b1", createdAt: at(-DAY) },
      { platform: "META_INSTAGRAM", threadKey: "c1", createdAt: at(-DAY) },
    ]);
    db.outboxJob.findMany.mockResolvedValue([{ message: { platform: "META_INSTAGRAM", authorId: "b2", createdAt: at(-DAY) } }]);
    expect((await run(inboxFinder)).map((f) => f.text)).toEqual(["1 message has waited more than a day for your answer."]);
  });

  it("asks for the owner's open items of the last week, newest first, and never for spam or abuse", async () => {
    await run(inboxFinder);
    const a = db.conversationMessage.findMany.mock.calls[0][0];
    expect(a.where).toMatchObject({ store: { tenantId: "t1" }, direction: "INBOUND", outcome: "FLAGGED" });
    expect(a.where.createdAt.gt.getTime()).toBe(NOW.getTime() - 7 * DAY);
    expect(a.where.outcomeReason.in).toContain("needs_you");
    expect(a.where.outcomeReason.in).not.toContain("spam");
    expect(a.where.outcomeReason.in).not.toContain("abuse");
    expect(a.orderBy).toEqual({ createdAt: "desc" });
    expect(a.take).toBeLessThanOrEqual(300);
  });

  it("reads a buyer's platform id, never what they wrote", async () => {
    await run(inboxFinder);
    const a = db.conversationMessage.findMany.mock.calls[0][0];
    expect(Object.keys(a.select).sort()).toEqual(["authorId", "channelType", "createdAt", "externalMessageId", "externalThreadId", "outcomeReason", "parentCommentId", "platform"]);
  });

  it("Arabic: the verb fits the noun (يوجد before a masculine noun for 1, 2 and 11 or more; توجد for 3 to 10 and for 'message')", async () => {
    const waiting = (n: number) => Array.from({ length: n }, (_, i) => comment({ externalMessageId: `c${n}-${i}`, age: 2 * DAY, outcomeReason: "complaint" }));
    const sentence = async (n: number) => {
      db.conversationMessage.findMany.mockResolvedValue(waiting(n));
      return (await run(inboxFinder, "ar"))[0].text;
    };
    expect(await sentence(1)).toBe("يوجد تعليق واحد بانتظار ردك منذ أكثر من يوم.");
    expect(await sentence(2)).toBe("يوجد تعليقان بانتظار ردك منذ أكثر من يوم.");
    expect(await sentence(3)).toBe("توجد ٣ تعليقات بانتظار ردك منذ أكثر من يوم.");
    expect(await sentence(10)).toBe("توجد ١٠ تعليقات بانتظار ردك منذ أكثر من يوم.");
    expect(await sentence(11)).toBe("يوجد ١١ تعليقاً بانتظار ردك منذ أكثر من يوم.");
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 2 * DAY, outcomeReason: "unclear" })]);
    expect((await run(inboxFinder, "ar"))[0].text).toBe("توجد رسالة واحدة بانتظار ردك منذ أكثر من يوم.");
  });
});

describe("orders", () => {
  it("none waiting is fine; new orders over 24 hours old are urgent", async () => {
    expect(await run(ordersFinder)).toEqual([]);
    db.order.count.mockResolvedValue(2);
    const [f] = await run(ordersFinder);
    expect(f).toMatchObject({ area: "orders", severity: "high", href: "/app/orders", text: "2 new orders have waited more than 24 hours without being confirmed." });
    const where = db.order.count.mock.calls.at(-1)?.[0].where;
    expect(where).toMatchObject({ tenantId: "t1", status: "NEW" });
    expect(where.createdAt.lt.getTime()).toBe(NOW.getTime() - DAY);
  });

  it("Arabic: يوجد for one and two new orders, توجد for three to ten", async () => {
    db.order.count.mockResolvedValue(1);
    expect((await run(ordersFinder, "ar"))[0].text).toBe("يوجد طلب جديد واحد بلا تأكيد منذ أكثر من ٢٤ ساعة.");
    db.order.count.mockResolvedValue(2);
    expect((await run(ordersFinder, "ar"))[0].text).toBe("يوجد طلبان جديدان بلا تأكيد منذ أكثر من ٢٤ ساعة.");
    db.order.count.mockResolvedValue(6);
    expect((await run(ordersFinder, "ar"))[0].text).toBe("توجد ٦ طلبات جديدة بلا تأكيد منذ أكثر من ٢٤ ساعة.");
  });

  it("tells the person to confirm with the right Sorani verb", async () => {
    db.order.count.mockResolvedValue(2);
    expect((await run(ordersFinder, "ckb"))[0].todo).toBe("داواکارییەکان بکەرەوە و پشتڕاستیان بکەرەوە یان هەڵیان وەشێنەوە.");
  });
});

describe("products", () => {
  it("a shop whose products all have a price and a photo is fine", async () => {
    expect(await run(productsFinder)).toEqual([]);
  });

  it("products with no price and products with no photo are medium, each with its number", async () => {
    db.product.count.mockImplementation(async (a: { where: { photos?: unknown } }) => (a.where.photos ? 4 : 2));
    const out = await run(productsFinder);
    expect(out.map((f) => f.text)).toEqual(["2 active products have no price.", "4 active products have no photo."]);
    expect(out.every((f) => f.severity === "medium")).toBe(true);
  });

  it("looks at active products of this workspace's shops; a price of 0 or no price line counts as no price", async () => {
    await run(productsFinder);
    const wheres = db.product.count.mock.calls.map((c) => c[0].where);
    for (const w of wheres) expect(w).toMatchObject({ active: true, store: { tenantId: "t1" } });
    const price = wheres.find((w) => w.OR);
    expect(price.OR).toEqual([{ variants: { none: {} } }, { variants: { some: { inStock: true, amountMinor: { lte: 0 } } } }]);
  });

  it("Arabic: يوجد for one and two active products, توجد for three to ten, يوجد again from eleven", async () => {
    const photos = async (n: number) => {
      db.product.count.mockImplementation(async (a: { where: { photos?: unknown } }) => (a.where.photos ? n : 0));
      return (await run(productsFinder, "ar"))[0].text;
    };
    expect(await photos(1)).toBe("يوجد منتج فعّال واحد بلا صورة.");
    expect(await photos(2)).toBe("يوجد منتجان فعّالان بلا صورة.");
    expect(await photos(5)).toBe("توجد ٥ منتجات فعّالة بلا صورة.");
    expect(await photos(12)).toBe("يوجد ١٢ منتجاً فعّالاً بلا صورة.");
    db.product.count.mockImplementation(async (a: { where: { photos?: unknown } }) => (a.where.photos ? 0 : 1));
    expect((await run(productsFinder, "ar"))[0].text).toBe("يوجد منتج فعّال واحد بلا سعر.");
  });
});

describe("settings", () => {
  it("a complete setup is fine", async () => {
    expect(await run(settingsFinder)).toEqual([]);
  });

  it("no WhatsApp number and automatic replies off are information (they are the owner's choice or a to-do, not a fault)", async () => {
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "  ", unlimited: false });
    db.store.findMany.mockResolvedValue([{ ...STORE, automationEnabled: false }, STORE]);
    const out = await run(settingsFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([
      ["info", "No WhatsApp number is set, so buyers cannot message you on WhatsApp."],
      ["info", "Automatic replies are switched off in 1 shop."],
    ]);
    expect(out[1].fix).toMatch(/ask first/i);
  });

  it("a paid plan that ran out is medium; one that ends within 3 days is information; unlimited shops are left alone", async () => {
    db.store.findMany.mockResolvedValue([
      { ...STORE, plan: "PRO", planPaidUntil: at(-DAY) },
      { ...STORE, plan: "MERCHANT", planPaidUntil: at(2 * DAY) },
      { ...STORE, plan: "FREE", planPaidUntil: null },
      { ...STORE, plan: "UNLIMITED", planPaidUntil: at(-DAY) },
      { ...STORE, plan: "PRO", planPaidUntil: at(40 * DAY) },
    ]);
    const out = await run(settingsFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([
      ["medium", "The paid plan has ended in 1 shop, which now works on the Free plan."],
      ["info", "The paid plan ends within 3 days in 1 shop."],
    ]);
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647", unlimited: true });
    expect(await run(settingsFinder)).toEqual([]);
  });

  it("a plan that ran out and was already moved to Free by the daily sweep (it keeps the date) is still reported, for a month", async () => {
    db.store.findMany.mockResolvedValue([
      { ...STORE, plan: "FREE", planPaidUntil: at(-3 * DAY) },
      { ...STORE, plan: "FREE", planPaidUntil: at(-29 * DAY) },
      { ...STORE, plan: "FREE", planPaidUntil: at(-31 * DAY) },
      { ...STORE, plan: "FREE", planPaidUntil: at(2 * DAY) },
    ]);
    const out = await run(settingsFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([["medium", "The paid plan has ended in 2 shops, which now work on the Free plan."]]);
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647", unlimited: true });
    expect(await run(settingsFinder)).toEqual([]);
  });

  it("reads this workspace's tenant row and stores", async () => {
    await run(settingsFinder);
    expect(db.tenant.findUnique.mock.calls[0][0].where).toEqual({ id: "t1" });
    expect(db.store.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });
});

describe("rules and chat actions", () => {
  it("the rules finder is part of the list only while the owner rules are switched on", () => {
    expect(shopFinders().map((f) => f.area)).not.toContain("rules");
    process.env.SHOP_RULES_ENABLED = "1";
    expect(shopFinders().map((f) => f.area)).toContain("rules");
  });

  it("healthy rules are fine; paused-by-themselves rules and failed runs are medium", async () => {
    expect(await run(rulesFinder)).toEqual([]);
    db.shopRule.count.mockResolvedValue(2);
    db.ruleRun.count.mockResolvedValue(5);
    const out = await run(rulesFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([
      ["medium", "Gituas switched off 2 rules by itself after problems."],
      ["medium", "A rule failed to run 5 times in the last 7 days."],
    ]);
    expect(db.ruleRun.count.mock.calls.at(-1)?.[0].where).toMatchObject({ rule: { tenantId: "t1" }, status: "FAILED" });
    expect(db.shopRule.count.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", status: "PAUSED_AUTO" });
  });

  it("rules in test mode are information, and only when there are active rules", async () => {
    process.env.RULES_DRY_RUN = "1";
    expect(await run(rulesFinder)).toEqual([]);
    db.shopRule.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "ACTIVE" ? 3 : 0));
    const out = await run(rulesFinder);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "info", text: "Rules are in test mode, so they only write down what they would do and send nothing." });
  });

  it("chat actions that failed in the last 7 days are information", async () => {
    expect(await run(chatActionsFinder)).toEqual([]);
    db.chatRun.count.mockResolvedValue(2);
    // a plain failure: the same two runs are all of the failed ones and none of them timed out
    db.chatRun.count.mockImplementation(async (a: { where: { OR?: unknown } }) => (a.where.OR ? 0 : 2));
    const [f, ...rest] = await run(chatActionsFinder);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ area: "chat_actions", severity: "info", text: "2 actions started in the chat failed in the last 7 days." });
    expect(f.todo).toBe("Ask again if you still need it.");
    expect(db.chatRun.count.mock.calls.at(-1)?.[0].where).toMatchObject({ tenantId: "t1", status: "FAILED" });
  });

  it("a chat action that ran out of time (it may have gone through) is told apart and never says 'ask again'", async () => {
    // 3 failed runs in all, 2 of them timed out
    db.chatRun.count.mockImplementation(async (a: { where: { OR?: unknown } }) => (a.where.OR ? 2 : 3));
    const out = await run(chatActionsFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([
      ["info", "1 action started in the chat failed in the last 7 days."],
      ["info", "2 actions started in the chat took too long in the last 7 days and may still have gone through."],
    ]);
    const unknown = out[1];
    expect(unknown.todo).toBe("Check Facebook, Instagram and your pictures before trying again.");
    expect(unknown.todo).not.toMatch(/ask again/i);
    expect(unknown.fix).toMatch(/do NOT repeat/);
    // only timed-out runs: a single finding
    db.chatRun.count.mockImplementation(async () => 2);
    expect((await run(chatActionsFinder)).map((f) => f.text)).toEqual(["2 actions started in the chat took too long in the last 7 days and may still have gone through."]);
  });

  it("finds a timed-out run by the marker it stores (result.unknownOutcome) or by the sentence older runs carry, in any language", async () => {
    db.chatRun.count.mockResolvedValue(0);
    await run(chatActionsFinder);
    const wheres = db.chatRun.count.mock.calls.map((c) => c[0].where);
    const withOr = wheres.find((w) => w.OR);
    expect(withOr.tenantId).toBe("t1");
    expect(withOr.OR[0]).toEqual({ result: { path: ["unknownOutcome"], equals: true } });
    expect(withOr.OR[1].error.in).toEqual([say("unknownOutcome", "ckb"), say("unknownOutcome", "ar"), say("unknownOutcome", "en")]);
    expect(wheres.find((w) => !w.OR)).toMatchObject({ tenantId: "t1", status: "FAILED" });
  });
});

describe("nothing a buyer wrote is ever read", () => {
  it("no query selects text, names, phone numbers, addresses or notes, and buyer tables are read for ids only", async () => {
    process.env.SHOP_RULES_ENABLED = "1";
    process.env.RULES_DRY_RUN = "1";
    db.conversationMessage.findMany.mockResolvedValue([flagged({ authorId: "b1", age: 2 * DAY, outcomeReason: "unclear" })]);
    const c = hc();
    for (const f of shopFinders()) await f.run(c);
    const blob = JSON.stringify(allMocks().flatMap((m) => m.mock.calls));
    for (const column of ["content", "customerName", "phone", "address", "authorName", "authorHandle", "transcript", "generatedReply", "note", "payload"]) {
      expect(blob, column).not.toContain(`"${column}"`);
    }
    // Orders are only counted; messages, pauses and answers are read for their ids and times alone.
    expect(db.order.count).toHaveBeenCalled();
    expect(db.conversationMessage.findMany).toHaveBeenCalled();
    for (const m of [db.conversationMessage.findMany, db.threadPause.findMany, db.outboxJob.findMany]) {
      for (const [args] of m.mock.calls) expect(args.select, JSON.stringify(args)).toBeTruthy();
    }
  });
});
