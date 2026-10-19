import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The news-desk finders of "check everything". The database is replaced; what is tested is the part that is ours: for every area a bad
// case and a good case, every query scoped by the desk, and the rules that decide a defensible finding (an autopilot that is off or a
// desk that is frozen is never reported as "silent").

const db = vi.hoisted(() => ({
  oAuthCredential: { findMany: vi.fn() },
  tenant: { findUnique: vi.fn() },
  newsSettings: { findUnique: vi.fn() },
  newsDraft: { findFirst: vi.fn() },
  newsItem: { count: vi.fn(), findMany: vi.fn() },
  newsSource: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
  scheduledPost: { count: vi.fn() },
  chatRun: { count: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { autopilotFinder, connectionsFinder, newsFinders, planFinder, sourcesFinder } from "@/lib/chat/health/news";
import type { Finder, HealthCtx } from "@/lib/chat/health/types";
import type { Lang } from "@/lib/i18n/lang";

const NOW = new Date("2026-10-19T09:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const hc = (lang: Lang = "en"): HealthCtx => ({ tenantId: "t1", lang, kind: "news", base: "/newsroom", now: NOW });
const run = (f: Finder, lang: Lang = "en") => f.run(hc(lang));

const FB = { provider: "META_FACEBOOK", providerAccountId: "fb1", expiresAt: null };
const IG = { provider: "META_INSTAGRAM", providerAccountId: "ig1", expiresAt: at(30 * DAY) };
const PAID = { kind: "NEWS", plan: "AUTO", planPaidUntil: at(20 * DAY), trialEndsAt: null };
/** What the finders select from the desk's settings. */
const SETTINGS = { autoMode: "PUBLISH", autoAccounts: [] as string[], categories: [] as string[], filterMode: "KEYWORDS", updatedAt: at(-3 * DAY), lastFetchedAt: at(-HOUR / 30) as Date | null };
const story = (category: string | null, subcategory: string | null = null) => ({ category, subcategory });

function clear() {
  db.oAuthCredential.findMany.mockResolvedValue([FB, IG]);
  db.tenant.findUnique.mockResolvedValue(PAID);
  db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, lastFetchedAt: at(-HOUR / 30) });
  db.newsDraft.findFirst.mockResolvedValue({ createdAt: at(-2 * HOUR) });
  db.newsItem.count.mockResolvedValue(40);
  db.newsItem.findMany.mockResolvedValue([]);
  db.newsSource.findMany.mockResolvedValue([{ lastError: null }, { lastError: null }]);
  db.auditLog.findMany.mockResolvedValue([]);
  db.scheduledPost.count.mockResolvedValue(0);
  db.chatRun.count.mockResolvedValue(0);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clear();
});
afterEach(() => vi.useRealTimers());

describe("page connections", () => {
  it("live connections are fine", async () => {
    expect(await run(connectionsFinder)).toEqual([]);
  });

  it("no Page or account at all: urgent, and the person must connect it", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([]);
    const [f] = await run(connectionsFinder);
    expect(f).toMatchObject({ area: "connections", severity: "high", href: "/newsroom/settings", text: "No Facebook Page or Instagram account is connected, so nothing can be posted." });
    expect(f.fix).toMatch(/you cannot do that for them/);
  });

  it("every connection expired: one urgent finding with the number of accounts", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(-DAY) }, { ...IG, expiresAt: at(-HOUR) }]);
    const out = await run(connectionsFinder);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "high", text: "The connection of every Page and account (2) has ended, so nothing can be posted." });
  });

  it("Facebook lost while Instagram works: urgent for Facebook only", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(-DAY) }, IG]);
    const out = await run(connectionsFinder);
    expect(out.map((f) => [f.severity, f.text])).toEqual([["high", "The Facebook connection has ended, so nothing is posted to Facebook."]]);
  });

  it("one of two Pages lost: medium, and urgent only when the autopilot is set to post to it", async () => {
    const two = [FB, { ...FB, providerAccountId: "fb2", expiresAt: at(-DAY) }, IG];
    db.oAuthCredential.findMany.mockResolvedValue(two);
    expect((await run(connectionsFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "The connection of 1 account has ended, but the others still work."]]);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoAccounts: ["FB:fb2"] });
    expect((await run(connectionsFinder)).map((f) => [f.severity, f.text])).toEqual([["high", "The connection of 1 account the autopilot posts to has ended."]]);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", autoAccounts: ["FB:fb2"] });
    expect((await run(connectionsFinder))[0].severity).toBe("medium");
  });

  it("a Facebook connection that ends within a week is a medium warning", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(2 * DAY) }, IG]);
    expect((await run(connectionsFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "The connection of 1 Facebook Page ends within a week."]]);
  });

  it("reads only this desk's credentials and settings", async () => {
    await run(connectionsFinder);
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.newsSettings.findUnique.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
  });
});

describe("trial and plan", () => {
  it("a paid plan with weeks left, a legacy desk and a trial with days left are fine", async () => {
    expect(await run(planFinder)).toEqual([]);
    db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: null });
    expect(await run(planFinder)).toEqual([]);
    db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(9 * DAY) });
    expect(await run(planFinder)).toEqual([]);
  });

  it("an ended trial or plan freezes the desk: urgent", async () => {
    db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(-DAY) });
    const [f] = await run(planFinder);
    expect(f).toMatchObject({ area: "plan", severity: "high", href: "/newsroom/billing" });
    expect(f.text).toMatch(/can only read/);
    db.tenant.findUnique.mockResolvedValue({ ...PAID, planPaidUntil: at(-HOUR) });
    expect((await run(planFinder))[0].severity).toBe("high");
  });

  it("a trial or plan that ends within 3 days is medium, with the days left", async () => {
    db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(2 * DAY - HOUR) });
    expect((await run(planFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "The free trial ends in 2 days."]]);
    db.tenant.findUnique.mockResolvedValue({ ...PAID, planPaidUntil: at(HOUR) });
    expect((await run(planFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "The paid plan ends in 1 day."]]);
  });

  it("a workspace that is not a news desk is not judged", async () => {
    db.tenant.findUnique.mockResolvedValue({ kind: "MERCHANT", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(-DAY) });
    expect(await run(planFinder)).toEqual([]);
    expect(db.tenant.findUnique.mock.calls[0][0].where).toEqual({ id: "t1" });
  });
});

describe("autopilot", () => {
  it("working normally is fine", async () => {
    expect(await run(autopilotFinder)).toEqual([]);
  });

  it("an autopilot that is off is never reported", async () => {
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "OFF", lastFetchedAt: null });
    db.newsDraft.findFirst.mockResolvedValue(null);
    db.newsItem.count.mockResolvedValue(0);
    expect(await run(autopilotFinder)).toEqual([]);
  });

  it("a frozen desk is not reported here (the plan finder says so)", async () => {
    db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(-DAY) });
    db.newsDraft.findFirst.mockResolvedValue(null);
    expect(await run(autopilotFinder)).toEqual([]);
  });

  it("on, stories that the desk's own choice lets through came in, but no draft for over a day: medium, with the number of such stories", async () => {
    db.newsDraft.findFirst.mockResolvedValue({ createdAt: at(-30 * HOUR) });
    db.newsItem.findMany.mockResolvedValue(Array.from({ length: 17 }, () => story("politics")));
    const [f] = await run(autopilotFinder);
    expect(f).toMatchObject({ area: "autopilot", severity: "medium", href: "/newsroom/autopilot" });
    expect(f.text).toBe("The autopilot is on and 17 new stories came in, but it has written no draft in the last 24 hours.");
    db.newsDraft.findFirst.mockResolvedValue(null);
    expect((await run(autopilotFinder))[0].text).toContain("17 new stories");
  });

  it("stories came in but the desk's categories keep every one of them from the autopilot: it is right to write nothing", async () => {
    db.newsDraft.findFirst.mockResolvedValue(null);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, categories: ["sports/football"] });
    db.newsItem.findMany.mockResolvedValue([story("politics"), story("sports", "local"), story("economy", "markets"), story("sports")]);
    expect(await run(autopilotFinder)).toEqual([]);
    // one story of the chosen sub-category (or of a whole chosen category) makes the silence a finding
    db.newsItem.findMany.mockResolvedValue([story("politics"), story("sports", "football")]);
    expect((await run(autopilotFinder))[0].text).toBe("The autopilot is on and 1 new story came in, but it has written no draft in the last 24 hours.");
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, categories: ["sports"] });
    db.newsItem.findMany.mockResolvedValue([story("politics"), story("sports", "local")]);
    expect((await run(autopilotFinder))[0].text).toContain("1 new story");
  });

  it("stories that are not classified yet, or are not new any more, cannot be drafted: not a finding", async () => {
    db.newsDraft.findFirst.mockResolvedValue(null);
    db.newsItem.findMany.mockResolvedValue([story(null), story(null)]);
    expect(await run(autopilotFinder)).toEqual([]);
    const where = db.newsItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "t1", status: "NEW", category: { not: null } });
    expect(where.createdAt.gt.getTime()).toBe(NOW.getTime() - DAY);
    expect(db.newsItem.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(500);
    expect(Object.keys(db.newsItem.findMany.mock.calls[0][0].select).sort()).toEqual(["category", "subcategory"]);
  });

  it("with a news prompt (filterMode PROMPT) only the stories the prompt kept count; without one that is not asked", async () => {
    db.newsDraft.findFirst.mockResolvedValue(null);
    db.newsItem.findMany.mockResolvedValue([story("politics")]);
    await run(autopilotFinder);
    expect(db.newsItem.findMany.mock.calls[0][0].where).not.toHaveProperty("focusMatch");
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, filterMode: "PROMPT" });
    await run(autopilotFinder);
    expect(db.newsItem.findMany.mock.calls[1][0].where.focusMatch).toBe(true);
  });

  it("a saved category choice that cannot be read makes the autopilot do nothing on purpose: not reported as silent", async () => {
    db.newsDraft.findFirst.mockResolvedValue(null);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, categories: ["not-a-category"] });
    db.newsItem.findMany.mockResolvedValue([story("politics")]);
    expect(await run(autopilotFinder)).toEqual([]);
  });

  it("a recent draft means the stories are not even looked at again", async () => {
    await run(autopilotFinder);
    expect(db.newsItem.findMany).not.toHaveBeenCalled();
  });

  it("on, but the desk has not looked for stories for hours: medium", async () => {
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", lastFetchedAt: at(-8 * HOUR - 5 * 60_000) });
    expect((await run(autopilotFinder)).map((f) => f.text)).toEqual(["The autopilot is on, but no new stories have been fetched for 8 hours."]);
  });

  it("never fetched is said only when nothing came in and the settings were not just saved (saving the keywords clears the time)", async () => {
    // nothing came in for a day and the settings are old: a real gap
    db.newsItem.count.mockResolvedValue(0);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", lastFetchedAt: null });
    expect((await run(autopilotFinder))[0].text).toBe("The autopilot is on, but no stories have been fetched yet.");
    // the keywords were saved 3 minutes ago: the clock fetches within a minute or two
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", lastFetchedAt: null, updatedAt: at(-3 * 60_000) });
    expect(await run(autopilotFinder)).toEqual([]);
    // stories came in today, so the desk has fetched before
    db.newsItem.count.mockResolvedValue(25);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", lastFetchedAt: null });
    expect(await run(autopilotFinder)).toEqual([]);
    // 12 minutes after the save, with nothing arriving, it is reported
    db.newsItem.count.mockResolvedValue(0);
    db.newsSettings.findUnique.mockResolvedValue({ ...SETTINGS, autoMode: "DRAFT", lastFetchedAt: null, updatedAt: at(-12 * 60_000) });
    expect(await run(autopilotFinder)).toHaveLength(1);
  });

  it("on and fetching, but no story arrived in a day: medium", async () => {
    db.newsItem.count.mockResolvedValue(0);
    expect((await run(autopilotFinder)).map((f) => f.text)).toEqual(["The autopilot is on, but no new story arrived in the last 24 hours."]);
  });

  it("counts only this desk's autopilot drafts and stories", async () => {
    await run(autopilotFinder);
    expect(db.newsDraft.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", auto: true });
    expect(db.newsItem.count.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.newsSettings.findUnique.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
  });
});

describe("news sources", () => {
  it("working sources are fine", async () => {
    expect(await run(sourcesFinder)).toEqual([]);
  });

  it("none switched on, all failing and some failing", async () => {
    db.newsSource.findMany.mockResolvedValue([]);
    expect((await run(sourcesFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "No news source is switched on, so no new stories will come."]]);
    db.newsSource.findMany.mockResolvedValue([{ lastError: "timeout" }, { lastError: "404" }]);
    expect((await run(sourcesFinder)).map((f) => [f.severity, f.text])).toEqual([["medium", "All news sources (2) failed on the last check, so no new stories are arriving."]]);
    db.newsSource.findMany.mockResolvedValue([{ lastError: "timeout" }, { lastError: null }, { lastError: null }]);
    expect((await run(sourcesFinder)).map((f) => [f.severity, f.text])).toEqual([["info", "1 source failed on the last check."]]);
  });

  it("never reads the error text, and only this desk's enabled sources", async () => {
    db.newsSource.findMany.mockResolvedValue([{ lastError: "SENTINEL feed error text" }]);
    const out = await run(sourcesFinder);
    expect(JSON.stringify(out)).not.toContain("SENTINEL");
    const call = db.newsSource.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: "t1", enabled: true });
    expect(call.select).toEqual({ lastError: true });
  });
});

describe("the desk's list", () => {
  it("covers connections, plan, posts, scheduled stories, autopilot, sources and chat actions", () => {
    expect(newsFinders().map((f) => f.area)).toEqual(["connections", "plan", "posts", "scheduled", "autopilot", "sources", "chat_actions"]);
  });

  it("failed posts and late scheduled stories are read for this desk with the desk's own actions", async () => {
    const [, , posts, scheduled] = newsFinders();
    db.auditLog.findMany.mockResolvedValue([{ action: "app.publish_failed", createdAt: at(-HOUR), metadata: { target: "FB", error: "x" } }]);
    db.scheduledPost.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "PENDING" ? 2 : 0));
    expect((await run(posts))[0]).toMatchObject({ severity: "high", href: "/newsroom/publish" });
    expect((await run(scheduled))[0].text).toBe("2 scheduled posts are more than 15 minutes late.");
    // the desk's own failure actions, and the successful posts that show a failure was posted again
    expect(db.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", action: { in: ["app.publish_failed", "news.autopilot_publish_failed", "app.publish"] } });
    expect(db.scheduledPost.count.mock.calls.every((c) => c[0].where.tenantId === "t1")).toBe(true);
  });
});
