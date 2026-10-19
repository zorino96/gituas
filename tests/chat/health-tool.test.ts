import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// check_everything as a whole. The database is replaced; what is tested is the part that is ours: the finders run together and one that
// throws or is slow costs only its own area, the 12 second limit, "all clear" only when every area ran, the order and the cap of the
// list, every query scoped by the workspace, and every sentence in the person's three languages.

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
  newsSettings: { findUnique: vi.fn() },
  newsDraft: { findFirst: vi.fn() },
  newsItem: { count: vi.fn(), findMany: vi.fn() },
  newsSource: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { zodToJsonSchema } from "zod-to-json-schema";
import { newsFinders } from "@/lib/chat/health/news";
import { shopFinders } from "@/lib/chat/health/shop";
import { A, areaLabel, N, type Finder, type Finding, type HealthCtx } from "@/lib/chat/health/types";
import { toolsFor, toolSpecs } from "@/lib/chat/registry";
import { HEALTH_READ_TOOLS, healthForModel, healthView, MAX_FINDINGS, runFinders } from "@/lib/chat/tools/reads-health";
import type { ToolCtx } from "@/lib/chat/types";
import type { Lang } from "@/lib/i18n/lang";

const NOW = new Date("2026-10-19T09:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const failedRows = (...agesMs: number[]) => agesMs.map((a) => ({ action: "app.publish_failed", createdAt: at(-a), metadata: { target: "FB", error: "x" } }));
/** A flagged inbound message, as the open-items read selects it. */
let rowSeq = 0;
const openRow = (o: { age: number; reason: string; channelType?: string }) => ({
  platform: "META_INSTAGRAM",
  channelType: o.channelType ?? "DM",
  authorId: `buyer${++rowSeq}`,
  externalThreadId: null,
  externalMessageId: `msg${rowSeq}`,
  parentCommentId: null,
  outcomeReason: o.reason,
  createdAt: at(-o.age),
});
/** What the finders select from the desk's settings. */
const NEWS_SETTINGS = { autoMode: "PUBLISH", autoAccounts: [] as string[], categories: [] as string[], filterMode: "KEYWORDS", updatedAt: at(-3 * DAY), lastFetchedAt: at(-60_000) as Date | null };
/** Chat runs: `all` failed in the last week, `timedOut` of them ran out of time (the finder asks twice: once for all, once for the timed-out ones). */
const chatRuns = (all: number, timedOut: number) => db.chatRun.count.mockImplementation(async (a: { where: { OR?: unknown } }) => (a.where.OR ? timedOut : all));

const tool = HEALTH_READ_TOOLS[0];
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});
const call = (c: ToolCtx = ctx()) => tool.run(c, tool.schema.parse({}));
const data = (r: Awaited<ReturnType<typeof call>>) => r.data as Record<string, any>;
const allMocks = () => Object.values(db).flatMap((t) => Object.values(t) as ReturnType<typeof vi.fn>[]);

/** Everything healthy, for a shop and for a news desk. */
function clear() {
  db.oAuthCredential.findMany.mockResolvedValue([
    { provider: "META_FACEBOOK", providerAccountId: "fb1", expiresAt: null },
    { provider: "META_INSTAGRAM", providerAccountId: "ig1", expiresAt: null },
  ]);
  db.store.findMany.mockResolvedValue([{ fbPageId: "fb1", igUserId: "ig1", pausedReason: null, automationEnabled: true, plan: "FREE", planPaidUntil: null }]);
  db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647501234567", unlimited: false, kind: "NEWS", plan: "AUTO", planPaidUntil: at(30 * DAY), trialEndsAt: null });
  for (const fn of [db.scheduledPost.count, db.outboxJob.count, db.order.count, db.product.count, db.shopRule.count, db.ruleRun.count, db.chatRun.count]) {
    fn.mockResolvedValue(0);
  }
  db.conversationMessage.findMany.mockResolvedValue([]);
  db.threadPause.findMany.mockResolvedValue([]);
  db.outboxJob.findMany.mockResolvedValue([]);
  db.auditLog.findMany.mockResolvedValue([]);
  db.newsSettings.findUnique.mockResolvedValue(NEWS_SETTINGS);
  db.newsItem.findMany.mockResolvedValue([]);
  db.newsDraft.findFirst.mockResolvedValue({ createdAt: at(-HOUR) });
  db.newsItem.count.mockResolvedValue(30);
  db.newsSource.findMany.mockResolvedValue([{ lastError: null }]);
}

/** A shop with something wrong everywhere: 21 findings (7 urgent, 9 soon, 5 for information). */
function badShop() {
  process.env.SHOP_RULES_ENABLED = "1";
  process.env.RULES_DRY_RUN = "1";
  db.oAuthCredential.findMany.mockResolvedValue([
    { provider: "META_FACEBOOK", providerAccountId: "fb1", expiresAt: at(-DAY) },
    { provider: "META_INSTAGRAM", providerAccountId: "ig1", expiresAt: at(-DAY) },
  ]);
  db.store.findMany.mockResolvedValue([{ fbPageId: "fb1", igUserId: "ig1", pausedReason: "token", automationEnabled: false, plan: "PRO", planPaidUntil: at(-DAY) }]);
  db.tenant.findUnique.mockResolvedValue({ whatsappNumber: null, unlimited: false });
  db.auditLog.findMany.mockResolvedValue(failedRows(HOUR, HOUR, HOUR));
  db.scheduledPost.count.mockResolvedValue(2);
  db.outboxJob.count.mockResolvedValue(4);
  db.conversationMessage.findMany.mockResolvedValue([
    // 5 buyers who need the owner, 3 comments and 2 buyers that have waited over a day
    ...Array.from({ length: 5 }, () => openRow({ age: 3 * HOUR, reason: "needs_you" })),
    ...Array.from({ length: 3 }, () => openRow({ age: 2 * DAY, reason: "complaint", channelType: "COMMENT" })),
    ...Array.from({ length: 2 }, () => openRow({ age: 2 * DAY, reason: "unclear" })),
  ]);
  db.order.count.mockResolvedValue(6);
  db.product.count.mockResolvedValue(7);
  db.shopRule.count.mockResolvedValue(9);
  db.ruleRun.count.mockResolvedValue(10);
  chatRuns(8, 2);
}

/** A news desk with a frozen plan, nothing connected, failing posts and sources: 6 findings (3 urgent, 2 soon, 1 for information). */
function badDesk() {
  db.oAuthCredential.findMany.mockResolvedValue([]);
  db.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: at(-DAY) });
  db.auditLog.findMany.mockResolvedValue(failedRows(HOUR, HOUR));
  db.scheduledPost.count.mockImplementation(async (a: { where: { status: string } }) => (a.where.status === "PENDING" ? 1 : 0));
  db.newsSettings.findUnique.mockResolvedValue({ ...NEWS_SETTINGS, lastFetchedAt: null });
  db.newsSource.findMany.mockResolvedValue([{ lastError: "x" }, { lastError: "y" }]);
  chatRuns(3, 0);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
  clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
});

const finding = (area: string, severity: Finding["severity"], text = `${area} ${severity}`): Finding => ({ area, severity, text, fix: `fix ${area}`, todo: `todo ${area}` });
const finder = (area: string, make: () => Promise<Finding[]> | Finding[]): Finder => ({ area, run: async () => make() });
const hc = (lang: Lang = "en"): HealthCtx => ({ tenantId: "t1", lang, kind: "shop", base: "/app", now: NOW });

describe("the catalogue", () => {
  it("is one read tool for shops and news desks, for every role that may read, with no arguments", () => {
    expect(HEALTH_READ_TOOLS.map((t) => t.name)).toEqual(["check_everything"]);
    expect(tool.risk).toBe("read");
    expect(tool.kinds).toEqual(["shop", "news"]);
    expect(tool.permission).toBe("read");
    expect(tool.schema.safeParse({}).success).toBe(true);
    expect(tool.schema.safeParse({ days: 3 }).success).toBe(false);
  });

  it("is NOT untrusted: it holds counts and our own labels only, so a turn that uses it can still change things", () => {
    expect(tool.untrusted).toBeFalsy();
  });

  it("is offered to a member of a shop and of a desk, and its spec is an empty object", () => {
    expect(toolsFor(HEALTH_READ_TOOLS, "shop", "MEMBER").map((t) => t.name)).toEqual(["check_everything"]);
    expect(toolsFor(HEALTH_READ_TOOLS, "news", "MEMBER").map((t) => t.name)).toEqual(["check_everything"]);
    const spec = toolSpecs(HEALTH_READ_TOOLS)[0].function;
    expect(spec.name).toBe("check_everything");
    expect(spec.parameters).toMatchObject({ type: "object", additionalProperties: false });
    expect(zodToJsonSchema(tool.schema)).toBeTruthy();
    expect(spec.description).toMatch(/never say that everything is fine/);
  });

  it("tells the person what it is doing in each language", () => {
    expect(tool.label("en")).toBe("Checking everything…");
    expect(tool.label("ckb")).not.toBe(tool.label("en"));
    expect(tool.label("ar")).not.toBe(tool.label("en"));
  });
});

describe("the Arabic counted nouns", () => {
  it("say one and two without a digit, three to ten in the plural, eleven and up in the singular", () => {
    expect(A(1, N.order)).toBe("طلب جديد واحد");
    expect(A(2, N.order)).toBe("طلبان جديدان");
    expect(A(2, N.order, true)).toBe("طلبين جديدين");
    expect(A(3, N.order)).toBe("٣ طلبات جديدة");
    expect(A(11, N.order)).toBe("١١ طلباً جديداً");
  });
});

describe("running the finders", () => {
  it("a finder that throws (even before its first await) costs only its own area", async () => {
    const r = await runFinders(
      [
        finder("orders", () => [finding("orders", "high")]),
        finder("posts", () => Promise.reject(new Error("db down: SENTINEL value"))),
        { area: "products", run: () => { throw new Error("sync"); } },
        finder("settings", () => []),
      ],
      hc(),
    );
    expect(r.findings.map((f) => f.area)).toEqual(["orders"]);
    expect(r.checked).toEqual(["orders", "settings"]);
    expect(r.notChecked).toEqual(["posts", "products"]);
    // The error is logged by its kind and the area only, never by its message.
    expect(JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("SENTINEL");
  });

  it("is never 'all clear' unless every area ran: the model is told, and the person is told which areas were missed", async () => {
    const r = await runFinders([finder("orders", () => []), finder("posts", () => Promise.reject(new Error("x"))), finder("products", () => Promise.reject(new Error("y")))], hc("en"));
    const d = healthForModel(r);
    expect(d).toMatchObject({ ok: true, allClear: false, partial: true, notChecked: ["posts", "products"], areasChecked: ["orders"] });
    expect(String(d.note)).toMatch(/do NOT say that everything is fine/);
    const view = healthView(r, "en");
    expect(view[0]).toEqual({ kind: "note", text: "I found nothing wrong in what I could check: Orders." });
    expect(view[1]).toEqual({ kind: "note", tone: "warn", text: "I could not check: Failed posts, Products." });
    expect(healthView(r, "ckb")[1]).toMatchObject({ tone: "warn" });
    expect((healthView(r, "ar")[1] as { text: string }).text).toContain(areaLabel("posts", "ar"));
  });

  it("a finder that never finishes is cut at the limit and reported as not checked; a late finisher is ignored", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let settled = false;
    const slow = new Promise<Finding[]>(() => undefined);
    const late = new Promise<Finding[]>((resolve) => setTimeout(() => resolve([finding("posts", "high")]), 13_000));
    const p = runFinders([finder("orders", () => [finding("orders", "medium")]), finder("scheduled", () => slow), finder("posts", () => late)], hc(), 12_000).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(settled).toBe(true);
    expect(r.checked).toEqual(["orders"]);
    expect(r.notChecked).toEqual(["scheduled", "posts"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(r.findings.map((f) => f.area)).toEqual(["orders"]);
  });

  it("the tool as a whole answers at 12 seconds with what finished, even when a query never returns", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.oAuthCredential.findMany.mockReturnValue(new Promise(() => undefined));
    const p = call();
    await vi.advanceTimersByTimeAsync(12_000);
    const r = await p;
    const d = data(r);
    expect(d.partial).toBe(true);
    expect(d.notChecked).toEqual(["connections"]);
    expect(d.allClear).toBe(false);
    expect(d.areasChecked).toEqual(["posts", "scheduled", "outbox", "orders", "inbox", "products", "settings", "chat_actions"]);
    expect(r.view?.at(-1)).toEqual({ kind: "note", tone: "warn", text: "I could not check: Connections." });
  });

  it("the tool answers sooner when the request's own deadline is close", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.product.count.mockReturnValue(new Promise(() => undefined));
    const p = call(ctx({ deadline: Date.now() + 6_000 }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(data(await p).notChecked).toEqual(["products"]);
  });
});

describe("what the model and the person get", () => {
  it("a healthy shop: ok, all clear, every area listed as checked, one calm note", async () => {
    const r = await call();
    expect(data(r)).toMatchObject({ ok: true, allClear: true, counts: { high: 0, medium: 0, info: 0 }, findings: [] });
    expect(data(r).areasChecked).toEqual(["connections", "posts", "scheduled", "outbox", "orders", "inbox", "products", "settings", "chat_actions"]);
    expect(data(r)).not.toHaveProperty("partial");
    expect(r.view).toEqual([
      { kind: "note", text: "All clear: I checked Connections, Failed posts, Scheduled posts, Sending replies, Orders, Comments and messages, Products, Settings, Chat actions and found nothing wrong." },
    ]);
  });

  it("'all clear' names what was looked at and never says that everything is fine, in all three languages", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const note = (await call(ctx({ lang }))).view?.[0] as { kind: string; text: string };
      expect(note.kind).toBe("note");
      for (const area of data(await call(ctx({ lang }))).areasChecked as string[]) expect(note.text, `${lang} ${area}`).toContain(areaLabel(area, lang));
      expect(note.text).not.toMatch(/everything is fine|كل شيء على ما يرام|هەموو شتێک باشە/);
    }
    // the model is told the same
    expect((data(await call()).rules as string[]).join(" ")).toMatch(/name the areas in areasChecked/);
    expect(tool.description).toMatch(/name the areas in areasChecked/);
  });

  it("a partial run names the areas it did check beside the ones it could not, and with none checked says only what failed", async () => {
    const r = await runFinders([finder("orders", () => []), finder("posts", () => Promise.reject(new Error("x")))], hc("ar"));
    expect(healthView(r, "ar")[0]).toEqual({ kind: "note", text: `لم أجد أي مشكلة فيما استطعت فحصه: ${areaLabel("orders", "ar")}.` });
    const none = await runFinders([finder("posts", () => Promise.reject(new Error("x")))], hc("en"));
    expect(healthView(none, "en")).toEqual([{ kind: "note", tone: "warn", text: "I could not check: Failed posts." }]);
  });

  it("a healthy news desk is all clear too, and the desk's areas are the ones listed", async () => {
    const r = await call(ctx({ kind: "news" }));
    expect(data(r)).toMatchObject({ ok: true, allClear: true });
    expect(data(r).areasChecked).toEqual(["connections", "plan", "posts", "scheduled", "autopilot", "sources", "chat_actions"]);
  });

  it("information alone keeps ok true but is shown, and is not an 'all clear'", async () => {
    chatRuns(2, 0);
    const r = await call();
    expect(data(r)).toMatchObject({ ok: true, allClear: false, counts: { high: 0, medium: 0, info: 1 } });
    expect((r.view?.[0] as { items: { badge: string }[] }).items[0].badge).toBe("FYI");
  });

  it("lists the most urgent first, caps the list at 12, and still counts all of them", async () => {
    badShop();
    const r = await call();
    const d = data(r);
    expect(d.counts).toEqual({ high: 7, medium: 9, info: 5 });
    expect(d.ok).toBe(false);
    expect(d.findings).toHaveLength(MAX_FINDINGS);
    expect(d.moreNotShown).toBe(9);
    expect((d.findings as { severity: string }[]).map((f) => f.severity)).toEqual([...Array(7).fill("high"), ...Array(5).fill("medium")]);
    expect((d.findings as { area: string }[]).slice(0, 3).map((f) => f.area)).toEqual(["connections", "connections", "posts"]);
    const list = r.view?.[0] as { kind: string; items: { title: string; sub?: string; badge: string; href?: string }[]; more?: number };
    expect(list.kind).toBe("list");
    expect(list.items).toHaveLength(12);
    expect(list.more).toBe(9);
    expect(list.items[0]).toMatchObject({ badge: "Urgent", sub: "Press Connect in the Accounts button of the chat." });
    expect(list.items[0]).not.toHaveProperty("href");
    expect(list.items.at(-1)?.badge).toBe("Soon");
  });

  it("the model's copy has the fix and the screen but not the person's advice, and nothing a buyer wrote", async () => {
    badShop();
    const d = data(await call());
    for (const f of d.findings as Record<string, unknown>[]) {
      expect(Object.keys(f).sort()).toEqual(expect.arrayContaining(["area", "severity", "text", "fix"]));
      expect(f).not.toHaveProperty("todo");
      expect(String(f.fix)).toMatch(/[a-z]/);
    }
    expect(JSON.stringify(d)).not.toMatch(/content|customer|phone|address/i);
  });

  it("a desk with a frozen plan and nothing connected reads as urgent, in order", async () => {
    badDesk();
    const d = data(await call(ctx({ kind: "news" })));
    expect(d.counts).toEqual({ high: 3, medium: 2, info: 1 });
    expect((d.findings as { area: string }[]).map((f) => f.area)).toEqual(["connections", "plan", "posts", "scheduled", "sources", "chat_actions"]);
  });
});

describe("every query is scoped by the workspace of the session", () => {
  it.each(["shop", "news"] as const)("%s: every call names this workspace", async (kind) => {
    process.env.SHOP_RULES_ENABLED = "1";
    process.env.RULES_DRY_RUN = "1";
    if (kind === "shop") badShop();
    else badDesk();
    await call(ctx({ kind, tenantId: "t-mine" }));
    const calls = allMocks().flatMap((m) => m.mock.calls);
    expect(calls.length).toBeGreaterThan(8);
    for (const [args] of calls) expect(JSON.stringify(args), JSON.stringify(args)).toContain('"t-mine"');
    // Nothing is read without a limit that could return a whole table.
    for (const m of [db.oAuthCredential.findMany, db.store.findMany, db.newsSource.findMany]) for (const [args] of m.mock.calls) expect(args.take).toBeLessThanOrEqual(100);
  });
});

describe("words", () => {
  const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
  const ARABIC_ONLY = /[يكىةأإؤ]/;
  const hasArabicScript = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x600 && (ch.codePointAt(0) ?? 0) <= 0x6ff);

  const STORE = { fbPageId: "fb1", igUserId: "ig1", pausedReason: null, automationEnabled: true, plan: "FREE", planPaidUntil: null };
  const FB = { provider: "META_FACEBOOK", providerAccountId: "fb1", expiresAt: null as Date | null };
  const IG = { provider: "META_INSTAGRAM", providerAccountId: "ig1", expiresAt: null as Date | null };
  const PAID = { kind: "NEWS", plan: "AUTO", planPaidUntil: at(30 * DAY), trialEndsAt: null as Date | null };
  const weekOnly = async () => failedRows(3 * DAY, 3 * DAY, 3 * DAY);

  // Together these make every finding of every finder appear at least once.
  const scenarios: { kind: "shop" | "news"; set: () => void }[] = [
    { kind: "shop", set: badShop },
    { kind: "shop", set: () => { db.oAuthCredential.findMany.mockResolvedValue([]); db.store.findMany.mockResolvedValue([]); } },
    { kind: "shop", set: () => db.store.findMany.mockResolvedValue([{ ...STORE, pausedReason: "token" }]) },
    { kind: "shop", set: () => db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(3 * DAY) }, IG]) },
    { kind: "shop", set: () => db.auditLog.findMany.mockImplementation(weekOnly) },
    { kind: "shop", set: () => db.store.findMany.mockResolvedValue([{ ...STORE, plan: "PRO", planPaidUntil: at(2 * DAY) }]) },
    { kind: "news", set: badDesk },
    { kind: "news", set: () => db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(-DAY) }, { ...IG, expiresAt: at(-DAY) }]) },
    { kind: "news", set: () => db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(-DAY) }, { ...IG, expiresAt: at(DAY * 20) }]) },
    { kind: "news", set: () => db.oAuthCredential.findMany.mockResolvedValue([FB, { ...IG, expiresAt: at(-DAY) }]) },
    { kind: "news", set: () => db.oAuthCredential.findMany.mockResolvedValue([FB, { ...FB, providerAccountId: "fb2", expiresAt: at(-DAY) }, IG]) },
    {
      kind: "news",
      set: () => {
        db.oAuthCredential.findMany.mockResolvedValue([FB, { ...FB, providerAccountId: "fb2", expiresAt: at(-DAY) }, IG]);
        db.newsSettings.findUnique.mockResolvedValue({ ...NEWS_SETTINGS, autoAccounts: ["FB:fb2"] });
      },
    },
    { kind: "news", set: () => db.oAuthCredential.findMany.mockResolvedValue([{ ...FB, expiresAt: at(2 * DAY) }, IG]) },
    { kind: "news", set: () => db.tenant.findUnique.mockResolvedValue({ ...PAID, planPaidUntil: null, trialEndsAt: at(2 * DAY - HOUR) }) },
    { kind: "news", set: () => db.tenant.findUnique.mockResolvedValue({ ...PAID, planPaidUntil: at(HOUR) }) },
    {
      kind: "news",
      set: () => {
        db.newsSettings.findUnique.mockResolvedValue({ ...NEWS_SETTINGS, lastFetchedAt: null });
        db.newsItem.count.mockResolvedValue(0);
      },
    },
    { kind: "news", set: () => db.newsSettings.findUnique.mockResolvedValue({ ...NEWS_SETTINGS, lastFetchedAt: at(-8 * HOUR) }) },
    { kind: "news", set: () => db.newsItem.count.mockResolvedValue(0) },
    {
      kind: "news",
      set: () => {
        db.newsDraft.findFirst.mockResolvedValue(null);
        db.newsItem.findMany.mockResolvedValue([{ category: "politics", subcategory: null }]);
      },
    },
    { kind: "news", set: () => db.newsSource.findMany.mockResolvedValue([]) },
    { kind: "news", set: () => db.newsSource.findMany.mockResolvedValue([{ lastError: "x" }, { lastError: null }]) },
  ];

  /** Every finding of every scenario, in one language. */
  async function collect(lang: Lang): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const sc of scenarios) {
      vi.resetAllMocks();
      clear();
      sc.set();
      process.env.SHOP_RULES_ENABLED = "1";
      process.env.RULES_DRY_RUN = "1";
      const finders = sc.kind === "shop" ? shopFinders() : newsFinders();
      out.push(...(await runFinders(finders, { ...hc(lang), kind: sc.kind, base: sc.kind === "shop" ? "/app" : "/newsroom" })).findings);
    }
    return out;
  }
  /** What the person reads: the sentence and the advice. */
  async function everything(lang: Lang): Promise<string[]> {
    return (await collect(lang)).flatMap((f) => [f.text, f.todo ?? ""]).filter(Boolean);
  }

  it("the scenarios reach every finding of every finder (43 of them), each with a sentence, advice and an English fix", async () => {
    const all = await collect("en");
    expect(new Set(all.map((f) => f.fix)).size).toBe(43);
    for (const f of all) {
      expect(f.text.length, f.fix).toBeGreaterThan(15);
      expect(f.todo?.length, f.fix).toBeGreaterThan(5);
      expect(hasArabicScript(f.fix), f.fix).toBe(false);
    }
  });

  it("Sorani text has no Arabic-only letters, Arabic text no Kurdish-only letters, English no Arabic script", async () => {
    for (const s of await everything("ckb")) expect(ARABIC_ONLY.test(s), `ckb: ${s}`).toBe(false);
    for (const s of await everything("ar")) expect(KURDISH_ONLY.test(s), `ar: ${s}`).toBe(false);
    for (const s of await everything("en")) expect(hasArabicScript(s), `en: ${s}`).toBe(false);
  });

  it("every finding reads differently in each language and the three languages agree on how many there are", async () => {
    const [en, ckb, ar] = [await collect("en"), await collect("ckb"), await collect("ar")];
    expect(ckb).toHaveLength(en.length);
    expect(ar).toHaveLength(en.length);
    en.forEach((f, i) => {
      expect(ckb[i].text, f.fix).not.toBe(f.text);
      expect(ar[i].text, f.fix).not.toBe(f.text);
      expect(ckb[i].text, f.fix).not.toBe(ar[i].text);
      expect(ckb[i].fix).toBe(f.fix);
      expect(ar[i].fix).toBe(f.fix);
    });
  });

  it("every sentence exists in all three languages, differs between them, and carries its number in that language's digits", async () => {
    badShop();
    const en = data(await call(ctx({ lang: "en" }))).findings as { text: string }[];
    const ckb = data(await call(ctx({ lang: "ckb" }))).findings as { text: string }[];
    const ar = data(await call(ctx({ lang: "ar" }))).findings as { text: string }[];
    expect(ckb).toHaveLength(en.length);
    expect(ar).toHaveLength(en.length);
    en.forEach((f, i) => {
      expect(ckb[i].text.length).toBeGreaterThan(10);
      expect(ar[i].text.length).toBeGreaterThan(10);
      expect(ckb[i].text).not.toBe(f.text);
      expect(ar[i].text).not.toBe(f.text);
      expect(hasArabicScript(ckb[i].text) && hasArabicScript(ar[i].text)).toBe(true);
    });
    const orders = (rows: { text: string }[]) => rows.find((f) => /٦|6/.test(f.text) && /طلب|داواکاری|order/.test(f.text))?.text;
    expect(orders(en)).toBe("6 new orders have waited more than 24 hours without being confirmed.");
    expect(orders(ar)).toBe("توجد ٦ طلبات جديدة بلا تأكيد منذ أكثر من ٢٤ ساعة.");
    expect(orders(ckb)).toBe("٦ داواکاریی نوێ زیاتر لە ٢٤ کاتژمێرە چاوەڕێی پشتڕاستکردنەوەیە.");
  });

  it("no Sorani sentence or advice uses the verb 'to fall' where 'to open again / to do again' is meant", async () => {
    for (const s of await everything("ckb")) expect(s, s).not.toContain("بکەوە");
    for (const s of await everything("ckb")) expect(s, s).not.toContain("سەرینەکەوت");
  });

  it("the badges and the area labels exist in all three languages", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = { findings: [finding("orders", "high"), finding("posts", "medium"), finding("rules", "info")], checked: [], notChecked: ["connections", "autopilot", "sources", "plan"] };
      const list = healthView(r, lang)[0] as { items: { badge: string }[] };
      expect(new Set(list.items.map((i) => i.badge)).size).toBe(3);
      for (const a of r.notChecked) expect(areaLabel(a, lang)).not.toBe(a);
    }
  });
});
