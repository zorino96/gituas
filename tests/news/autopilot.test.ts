import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AiDown = vi.hoisted(
  () =>
    class AiUnavailable extends Error {
      constructor(message: string) {
        super(message);
        this.name = "AiUnavailable";
      }
    },
);

vi.mock("@/lib/db", () => ({
  db: {
    newsSettings: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tenant: { findUnique: vi.fn() },
    newsItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    newsDraft: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    newsVideo: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ AiUnavailable: AiDown }));
vi.mock("@/lib/billing/limits", () => {
  class LimitReached extends Error {}
  return { LimitReached, assertWithin: vi.fn(), countUsage: vi.fn(), usageOf: vi.fn() };
});
vi.mock("@/lib/cards/server-render", () => ({ renderAndStoreCard: vi.fn() }));
vi.mock("@/lib/merchant/publish-core", () => ({ publishForWorkspace: vi.fn() }));
vi.mock("@/lib/news/write", () => ({ writeDraft: vi.fn() }));

import { loadConnections } from "@/app/app/data";
import { assertWithin, countUsage, LimitReached, usageOf } from "@/lib/billing/limits";
import { renderAndStoreCard } from "@/lib/cards/server-render";
import { db } from "@/lib/db";
import { publishForWorkspace } from "@/lib/merchant/publish-core";
import {
  AUTO_MAX_AGE_MS,
  AUTO_MAX_PER_TICK,
  autoBudget,
  autoPostBudget,
  autopilotCandidates,
  renderOrigin,
  runAutopilot,
  safeError,
  type BudgetInput,
  type CandidateItem,
} from "@/lib/news/autopilot";
import { autoTargetsFor, parseAutopilot } from "@/lib/news/autopilot-settings";
import { writeDraft } from "@/lib/news/write";

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

function story(id: string, over: Partial<CandidateItem> = {}): CandidateItem {
  return { id, clusterKey: `c-${id}`, category: "politics", subcategory: "government", status: "NEW", publishedAt: minsAgo(30), autoTriedAt: null, ...over };
}

const ids = (list: CandidateItem[]) => list.map((i) => i.id);

describe("autopilotCandidates", () => {
  it("keeps a fresh, classified, untried story", () => {
    expect(ids(autopilotCandidates([story("a")], [], NOW))).toEqual(["a"]);
  });

  it("leaves out a story that is not classified yet, even when the desk keeps every category", () => {
    const items = [story("a", { category: null, subcategory: null })];
    expect(autopilotCandidates(items, [], NOW)).toEqual([]);
    expect(autopilotCandidates(items, ["politics"], NOW)).toEqual([]);
  });

  it("leaves out a story outside the desk's categories", () => {
    const items = [
      story("whole", { category: "economy", subcategory: "energy" }),
      story("sub", { category: "sports", subcategory: "football" }),
      story("other-sub", { category: "sports", subcategory: "local" }),
      story("wrong", { category: "politics", subcategory: "elections" }),
    ];
    expect(ids(autopilotCandidates(items, ["economy", "sports/football"], NOW)).sort()).toEqual(["sub", "whole"]);
  });

  it("leaves out a story older than six hours", () => {
    const items = [
      story("old", { publishedAt: new Date(NOW - AUTO_MAX_AGE_MS - 1000) }),
      story("edge", { publishedAt: new Date(NOW - AUTO_MAX_AGE_MS) }),
    ];
    expect(ids(autopilotCandidates(items, [], NOW))).toEqual(["edge"]);
  });

  it("leaves out a story it already tried", () => {
    expect(autopilotCandidates([story("a", { autoTriedAt: minsAgo(5) })], [], NOW)).toEqual([]);
  });

  it("leaves out anything that is not NEW", () => {
    const items = ["DRAFTED", "PUBLISHED", "DISMISSED"].map((status) => story(status, { status }));
    expect(autopilotCandidates(items, [], NOW)).toEqual([]);
  });

  it("takes only the oldest article of a story", () => {
    const items = [
      story("second", { clusterKey: "c1", publishedAt: minsAgo(10) }),
      story("first", { clusterKey: "c1", publishedAt: minsAgo(40) }),
      story("third", { clusterKey: "c1", publishedAt: minsAgo(5) }),
    ];
    expect(ids(autopilotCandidates(items, [], NOW))).toEqual(["first"]);
  });

  it("leaves out a story whose cluster already has a draft", () => {
    const items = [story("a", { clusterKey: "c1" }), story("b", { clusterKey: "c2" })];
    expect(ids(autopilotCandidates(items, [], NOW, new Set(["c1"])))).toEqual(["b"]);
  });

  it("sees a drafted, published or tried article in the list itself as closing its story", () => {
    const items = [
      story("drafted", { clusterKey: "c1", status: "DRAFTED" }),
      story("a", { clusterKey: "c1" }),
      story("published", { clusterKey: "c2", status: "PUBLISHED" }),
      story("b", { clusterKey: "c2" }),
      story("tried", { clusterKey: "c3", autoTriedAt: minsAgo(2), publishedAt: minsAgo(5) }),
      story("c", { clusterKey: "c3", publishedAt: minsAgo(50) }),
      story("d", { clusterKey: "c4" }),
    ];
    expect(ids(autopilotCandidates(items, [], NOW))).toEqual(["d"]);
  });

  it("leaves out a story an editor dismissed one article of", () => {
    const items = [
      story("dismissed", { clusterKey: "c1", status: "DISMISSED", publishedAt: minsAgo(20) }),
      story("sibling", { clusterKey: "c1", publishedAt: minsAgo(40) }),
      story("later", { clusterKey: "c1", publishedAt: minsAgo(5) }),
      story("other", { clusterKey: "c2" }),
    ];
    expect(ids(autopilotCandidates(items, [], NOW))).toEqual(["other"]);
  });

  it("returns the stories oldest first", () => {
    const items = [story("mid", { publishedAt: minsAgo(60) }), story("new", { publishedAt: minsAgo(5) }), story("old", { publishedAt: minsAgo(300) })];
    expect(ids(autopilotCandidates(items, [], NOW))).toEqual(["old", "mid", "new"]);
  });
});

describe("autoPostBudget (stories already drafted, such as rendered videos)", () => {
  const base: BudgetInput = {
    mode: "PUBLISH",
    plan: "AUTO",
    draftsUsed: 10,
    draftLimit: 3000,
    publishesUsed: 10,
    publishLimit: 3000,
    autoDraftsToday: 20,
    autoPostsToday: 16,
    autoDailyMax: 20,
    lastAutoAt: minsAgo(10),
    autoMinGapMin: 3,
    now: NOW,
  };
  it("still posts when today's drafts are used up but posts are not", () => {
    expect(autoBudget(base).publish).toBe(0);
    expect(autoPostBudget(base)).toBe(true);
  });
  it("stops at the day's posts, the publish quota, the gap, or without auto-publish", () => {
    expect(autoPostBudget({ ...base, autoPostsToday: 20 })).toBe(false);
    expect(autoPostBudget({ ...base, publishesUsed: 3000 })).toBe(false);
    expect(autoPostBudget({ ...base, lastAutoAt: minsAgo(1) })).toBe(false);
    expect(autoPostBudget({ ...base, mode: "DRAFT" })).toBe(false);
    expect(autoPostBudget({ ...base, plan: "MANUAL" })).toBe(false);
  });
});

describe("autoBudget", () => {
  const base: BudgetInput = {
    mode: "PUBLISH",
    plan: "AUTO",
    draftsUsed: 10,
    draftLimit: 3000,
    publishesUsed: 10,
    publishLimit: 3000,
    autoDraftsToday: 2,
    autoPostsToday: 2,
    autoDailyMax: 20,
    lastAutoAt: minsAgo(10),
    autoMinGapMin: 3,
    now: NOW,
  };

  it("does nothing when the mode is OFF, or is not a mode at all", () => {
    expect(autoBudget({ ...base, mode: "OFF" })).toEqual({ mode: "OFF", draft: 0, publish: 0, stop: "off" });
    expect(autoBudget({ ...base, mode: "EVERYTHING" })).toMatchObject({ mode: "OFF", draft: 0, publish: 0, stop: "off" });
  });

  it("drafts up to three a run in draft mode, and never posts", () => {
    expect(autoBudget({ ...base, mode: "DRAFT" })).toEqual({ mode: "DRAFT", draft: AUTO_MAX_PER_TICK, publish: 0, stop: null });
  });

  it("drafts only what the month's quota still has room for", () => {
    expect(autoBudget({ ...base, mode: "DRAFT", draftsUsed: 2998 })).toMatchObject({ draft: 2, stop: null });
  });

  it("does nothing once the draft quota is used up, in either mode", () => {
    expect(autoBudget({ ...base, mode: "DRAFT", draftsUsed: 3000 })).toMatchObject({ draft: 0, publish: 0, stop: "draft-quota" });
    expect(autoBudget({ ...base, draftsUsed: 3001 })).toMatchObject({ draft: 0, publish: 0, stop: "draft-quota" });
  });

  it("does nothing once the publish quota is used up", () => {
    expect(autoBudget({ ...base, publishesUsed: 3000 })).toMatchObject({ mode: "PUBLISH", draft: 0, publish: 0, stop: "publish-quota" });
  });

  it("does nothing at the daily maximum of automatic posts", () => {
    expect(autoBudget({ ...base, autoPostsToday: 20 })).toMatchObject({ draft: 0, publish: 0, stop: "daily-max" });
    expect(autoBudget({ ...base, autoDailyMax: 0, autoDraftsToday: 0, autoPostsToday: 0 })).toMatchObject({ draft: 0, publish: 0, stop: "daily-max" });
  });

  it("does nothing once it wrote the daily maximum of drafts, posted or not", () => {
    expect(autoBudget({ ...base, mode: "DRAFT", autoDraftsToday: 20 })).toMatchObject({ draft: 0, publish: 0, stop: "daily-max" });
    expect(autoBudget({ ...base, autoDraftsToday: 20, autoPostsToday: 0 })).toMatchObject({ draft: 0, publish: 0, stop: "daily-max" });
    expect(autoBudget({ ...base, mode: "DRAFT", autoDraftsToday: 19 })).toMatchObject({ draft: 1, stop: null });
  });

  it("does nothing inside the minimum gap since the last automatic post", () => {
    expect(autoBudget({ ...base, lastAutoAt: minsAgo(2) })).toMatchObject({ draft: 0, publish: 0, stop: "min-gap" });
    expect(autoBudget({ ...base, lastAutoAt: minsAgo(3) })).toMatchObject({ draft: 1, publish: 1, stop: null });
  });

  it("posts one story a run when a gap is set, and drafts no more than it posts", () => {
    expect(autoBudget({ ...base, lastAutoAt: null })).toEqual({ mode: "PUBLISH", draft: 1, publish: 1, stop: null });
    expect(autoBudget({ ...base, autoMinGapMin: 0, lastAutoAt: minsAgo(0) })).toEqual({ mode: "PUBLISH", draft: 3, publish: 3, stop: null });
    expect(autoBudget({ ...base, autoMinGapMin: 0, publishesUsed: 2998 })).toMatchObject({ draft: 2, publish: 2 });
  });

  it("the gap does not hold back draft mode", () => {
    expect(autoBudget({ ...base, mode: "DRAFT", lastAutoAt: minsAgo(0) })).toMatchObject({ draft: 3, publish: 0, stop: null });
  });

  it("turns PUBLISH into DRAFT on a plan that may not post by itself", () => {
    for (const plan of ["LITE", "MANUAL", "SOMETHING", null, undefined]) {
      expect(autoBudget({ ...base, plan, lastAutoAt: minsAgo(0), publishesUsed: 3000 })).toEqual({ mode: "DRAFT", draft: 3, publish: 0, stop: null });
    }
    expect(autoBudget({ ...base, plan: "ENTERPRISE" })).toMatchObject({ mode: "PUBLISH", publish: 1 });
  });
});

describe("autoTargetsFor", () => {
  const both = { FB: true, IG: true };

  it("never lets TikTok or YouTube through, whatever is saved", () => {
    expect(autoTargetsFor(["TT", "YT", "FB", "IG", "fb", "X"], both)).toEqual(["FB", "IG"]);
    expect(autoTargetsFor(["TT", "YT"], both)).toEqual([]);
  });

  it("keeps only the connected pages", () => {
    expect(autoTargetsFor(["FB", "IG"], { FB: false, IG: true })).toEqual(["IG"]);
    expect(autoTargetsFor(["FB"], { FB: false, IG: true })).toEqual([]);
    expect(autoTargetsFor(null, both)).toEqual([]);
  });
});

describe("parseAutopilot", () => {
  const good = { mode: "PUBLISH", targets: ["IG", "FB"], dailyMax: 20, minGapMin: 3 };

  it("accepts a clean choice", () => {
    expect(parseAutopilot(good)).toEqual({ mode: "PUBLISH", targets: ["FB", "IG"], dailyMax: 20, minGapMin: 3 });
  });

  it("refuses an unknown mode, a platform that is not allowed, and numbers out of range", () => {
    expect(parseAutopilot({ ...good, mode: "ON" })).toBeNull();
    expect(parseAutopilot({ ...good, targets: ["FB", "TT"] })).toBeNull();
    expect(parseAutopilot({ ...good, targets: ["YT"] })).toBeNull();
    expect(parseAutopilot({ ...good, targets: "FB" })).toBeNull();
    for (const dailyMax of [0, 201, 1.5, "20", NaN]) expect(parseAutopilot({ ...good, dailyMax })).toBeNull();
    for (const minGapMin of [0, 121, 2.5, null]) expect(parseAutopilot({ ...good, minGapMin })).toBeNull();
    expect(parseAutopilot(null)).toBeNull();
  });
});

describe("renderOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is always the newsroom's own domain in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://somewhere-else.example");
    expect(renderOrigin()).toBe("https://hawalnoos.com");
  });

  it("uses the app URL, or localhost, only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:4000/");
    expect(renderOrigin()).toBe("http://localhost:4000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(renderOrigin()).toBe("http://localhost:3001");
  });
});

describe("safeError", () => {
  it("keeps tokens out of what is logged", () => {
    const line = safeError(
      new Error(`net::ERR_FAILED at https://hawalnoos.com/newsroom/card-render/abc?t=1790000000.${"a".repeat(64)}&x=1 Bearer abc.def ${"K".repeat(48)}`),
    );
    expect(line).toContain("card-render/abc?t=…&x=…");
    expect(line).not.toContain("a".repeat(20));
    expect(line).not.toContain("abc.def");
    expect(line).not.toContain("K".repeat(40));
    expect(safeError(undefined)).toBe("unknown error");
    expect(safeError("x".repeat(900)).length).toBeLessThanOrEqual(300);
  });
});

// ─── The run, with the database and every outside call stubbed ──────────────

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const DRAFT = { headline: "سەردێڕ", body: "دەق.", category: "سیاسەت", cardKind: "STANDARD", stat: null, quote: null, speaker: null };
/** Long enough for the same-story check to have something to compare. */
const EVENT = {
  headline: "حکومەتی هەرێم بودجەی ساڵی داهاتووی پەسەند کرد",
  body: "ئەنجومەنی وەزیران لە کۆبوونەوەی ئەمڕۆیدا بودجەی ساڵی داهاتووی پەسەند کرد و بڕیاریدا مووچەی فەرمانبەران لە کاتی خۆیدا دابەش بکرێت.",
};
const OTHER_EVENT = {
  headline: "یانەی هەولێر یاریی کۆتایی جامی بردەوە",
  body: "لە یاریگای فرانسۆ هەریری یانەی هەولێر بە دوو گۆڵ بەرامبەر بە یەک گۆڵ سەرکەوتنی بەدەستهێنا و نازناوەکەی پاراست.",
};
const CARD = { url: "https://blob.example/card.jpg", pathname: "merchant/t1/news-card-1.jpg" };

function item(id: string, clusterKey = `c-${id}`) {
  return {
    id,
    clusterKey,
    category: "politics",
    subcategory: null,
    status: "NEW",
    publishedAt: new Date(Date.now() - 10 * 60_000),
    autoTriedAt: null,
    url: `https://example.com/${id}`,
    sourceName: "Example",
    title: `Title ${id}`,
    snippet: "Snippet.",
  };
}

interface Desk {
  mode?: string;
  plan?: string;
  targets?: string[];
  connected?: { FB: boolean; IG: boolean };
  frozen?: boolean;
  gapMin?: number;
  items?: ReturnType<typeof item>[];
}

function desk(d: Desk = {}) {
  const settings = {
    autoMode: d.mode ?? "DRAFT",
    autoTargets: d.targets ?? ["FB", "IG"],
    autoDailyMax: 20,
    autoMinGapMin: d.gapMin ?? 3,
    lastAutoAt: null as Date | null,
    voiceNote: "ڕستەی کورت",
    categories: [] as string[],
  };
  m.newsSettings.findUnique.mockImplementation(async () => ({ ...settings }));
  m.newsSettings.update.mockImplementation(async ({ data }: { data: { lastAutoAt: Date } }) => {
    settings.lastAutoAt = data.lastAutoAt;
    return {};
  });
  // The slot: taken only when the last automatic post is older than the cut-off, as the database would decide it.
  m.newsSettings.updateMany.mockImplementation(async ({ where, data }: { where: { OR: [unknown, { lastAutoAt: { lt: Date } }] }; data: { lastAutoAt: Date } }) => {
    if (settings.lastAutoAt && settings.lastAutoAt >= where.OR[1].lastAutoAt.lt) return { count: 0 };
    settings.lastAutoAt = data.lastAutoAt;
    return { count: 1 };
  });
  m.tenant.findUnique.mockResolvedValue({
    kind: "NEWS",
    plan: d.plan ?? "AUTO",
    planPaidUntil: new Date(Date.now() + (d.frozen ? -1 : 1) * 86_400_000),
    trialEndsAt: null,
  });
  // The first lookup is the fresh stories; the second, which clusters are already taken.
  m.newsItem.findMany.mockResolvedValueOnce(d.items ?? [item("a")]).mockResolvedValue([]);
  m.newsItem.updateMany.mockResolvedValue({ count: 1 });
  m.newsItem.count.mockResolvedValue(0);
  m.newsDraft.count.mockResolvedValue(0);
  m.newsDraft.findMany.mockResolvedValue([]);
  m.newsDraft.create.mockImplementation(async ({ data }: { data: { itemId: string; headline: string; body: string } }) => ({
    id: `d-${data.itemId}`,
    headline: data.headline,
    body: data.body,
  }));
  m.auditLog.create.mockResolvedValue({});
  const conn = d.connected ?? { FB: true, IG: true };
  vi.mocked(loadConnections).mockResolvedValue({
    META_FACEBOOK: { connected: conn.FB },
    META_INSTAGRAM: { connected: conn.IG },
    TIKTOK: { connected: true },
    YOUTUBE: { connected: true },
  } as Awaited<ReturnType<typeof loadConnections>>);
  vi.mocked(usageOf).mockResolvedValue(0);
  vi.mocked(assertWithin).mockResolvedValue(undefined);
  vi.mocked(writeDraft).mockResolvedValue({ draft: DRAFT, model: "m1", part: null } as Awaited<ReturnType<typeof writeDraft>>);
  vi.mocked(renderAndStoreCard).mockResolvedValue({ ...CARD, headline: DRAFT.headline, body: DRAFT.body });
  vi.mocked(publishForWorkspace).mockImplementation(async (_ws, input) => input.targets.map((target) => ({ target, ok: true, url: `https://post/${target}` })));
}

const audits = () => m.auditLog.create.mock.calls.map((c) => (c[0] as { data: { action: string } }).data.action);
const claims = () => m.newsItem.updateMany.mock.calls.filter((c) => "autoTriedAt" in (c[0] as { data: object }).data);
const writes = (text: { headline: string; body: string }) =>
  vi.mocked(writeDraft).mockResolvedValue({ draft: { ...DRAFT, ...text }, model: "m1", part: null } as Awaited<ReturnType<typeof writeDraft>>);

describe("runAutopilot", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of Object.values(m)) for (const fn of Object.values(table)) fn.mockReset();
    // No auto-videos waiting, unless a test says so.
    (db.newsVideo.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.newsVideo.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  it("does nothing when the mode is OFF", async () => {
    desk({ mode: "OFF" });
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(m.newsItem.findMany).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("does nothing for a frozen newsroom", async () => {
    desk({ mode: "PUBLISH", frozen: true });
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(m.newsItem.findMany).not.toHaveBeenCalled();
    expect(m.newsItem.updateMany).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
  });

  it("drafts nothing new while a story waits for its video (it holds the next posting slot)", async () => {
    desk({ mode: "DRAFT" });
    (db.newsVideo.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("claims the story before it writes, drafts it fast in the desk's voice, and counts one draft", async () => {
    desk({ mode: "DRAFT" });
    const order: string[] = [];
    m.newsItem.updateMany.mockImplementation(async ({ data }: { data: object }) => (order.push("autoTriedAt" in data ? "claim" : "status"), { count: 1 }));
    vi.mocked(writeDraft).mockImplementation(async () => (order.push("write"), { draft: DRAFT, model: "m1", part: null }) as never);

    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(order).toEqual(["claim", "write", "status"]);
    expect(claims()[0][0]).toMatchObject({ where: { id: "a", tenantId: "t1", autoTriedAt: null }, data: { autoTriedAt: expect.any(Date) } });
    expect(vi.mocked(writeDraft).mock.calls[0].slice(0, 3)).toEqual(["t1", expect.objectContaining({ id: "a" }), "fast"]);
    expect(vi.mocked(writeDraft).mock.calls[0][3]).toMatchObject({ voiceNote: "ڕستەی کورت" });
    expect(m.newsDraft.create.mock.calls[0][0].data).toMatchObject({ itemId: "a", tenantId: "t1", auto: true, model: "m1", headline: DRAFT.headline });
    expect(countUsage).toHaveBeenCalledTimes(1);
    expect(countUsage).toHaveBeenCalledWith("t1", "draft");
    expect(renderAndStoreCard).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
  });

  it("leaves a story another run already claimed", async () => {
    desk({ mode: "DRAFT" });
    m.newsItem.updateMany.mockResolvedValue({ count: 0 });
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(writeDraft).not.toHaveBeenCalled();
    expect(m.newsDraft.create).not.toHaveBeenCalled();
  });

  it("leaves a story when another article of it was claimed a moment ago", async () => {
    desk({ mode: "DRAFT" });
    m.newsItem.count.mockResolvedValue(1);
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("counts a dismissed article as closing its story, when it picks and again after the claim", async () => {
    desk({ mode: "DRAFT" });
    await runAutopilot("t1");
    const closing = (where: { OR: [{ status: { in: string[] } }, unknown] }) => where.OR[0].status.in;
    expect(closing(m.newsItem.findMany.mock.calls[1][0].where)).toEqual(expect.arrayContaining(["DRAFTED", "PUBLISHED", "DISMISSED"]));
    expect(closing(m.newsItem.count.mock.calls[0][0].where)).toEqual(expect.arrayContaining(["DRAFTED", "PUBLISHED", "DISMISSED"]));
  });

  it("stores nothing and counts nothing when the draft still copies the source", async () => {
    desk({ mode: "PUBLISH" });
    vi.mocked(writeDraft).mockResolvedValue({ draft: DRAFT, model: "m1", part: "body" } as Awaited<ReturnType<typeof writeDraft>>);
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(m.newsDraft.create).not.toHaveBeenCalled();
    expect(countUsage).not.toHaveBeenCalled();
    expect(m.newsItem.updateMany.mock.calls.every((c) => !("status" in (c[0] as { data: object }).data))).toBe(true);
    expect(audits()).toContain("news.autopilot_skipped");
  });

  it("posts only to Facebook and Instagram, and only where a page is connected", async () => {
    desk({ mode: "PUBLISH", targets: ["TT", "YT", "FB", "IG"], connected: { FB: true, IG: false } });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 1 });
    expect(renderAndStoreCard).toHaveBeenCalledWith("d-a", "t1", expect.stringMatching(/^http/));
    expect(publishForWorkspace).toHaveBeenCalledTimes(1);
    const [ws, input] = vi.mocked(publishForWorkspace).mock.calls[0];
    expect(ws).toEqual({ id: "t1", kind: "NEWS", role: "OWNER" });
    expect(input).toEqual({
      caption: `${DRAFT.headline}\n\n${DRAFT.body}`,
      targets: ["FB"],
      media: { url: "https://blob.example/card.jpg", pathname: "merchant/t1/news-card-1.jpg", type: "IMAGE" },
      newsDraftId: "d-a",
      igDeadlineMs: 30_000,
    });
    expect(m.newsSettings.update.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1" }, data: { lastAutoAt: expect.any(Date) } });
    expect(audits()).toContain("news.autopilot_published");
    // The publish count is recordNewsPublish's, inside publishForWorkspace: only the draft is counted here.
    expect(vi.mocked(countUsage).mock.calls).toEqual([["t1", "draft"]]);
  });

  it("only drafts when no allowed page is connected", async () => {
    desk({ mode: "PUBLISH", targets: ["TT", "YT", "FB"], connected: { FB: false, IG: true } });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(renderAndStoreCard).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
  });

  it("only drafts in PUBLISH mode on a plan that may not post by itself", async () => {
    desk({ mode: "PUBLISH", plan: "MANUAL" });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(loadConnections).not.toHaveBeenCalled();
    expect(renderAndStoreCard).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
  });

  it("checks the budget again before every story: the second one falls inside the gap", async () => {
    desk({ mode: "PUBLISH", items: [item("a"), item("b")] });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 1 });
    expect(claims()).toHaveLength(1);
    expect(writeDraft).toHaveBeenCalledTimes(1);
  });

  it("stops before a story once the daily maximum is reached", async () => {
    desk({ mode: "PUBLISH" });
    m.newsDraft.count.mockResolvedValue(20);
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(claims()).toHaveLength(0);
    expect(m.newsDraft.count.mock.calls.map((c) => (c[0] as { where: object }).where)).toEqual(
      expect.arrayContaining([expect.objectContaining({ tenantId: "t1", auto: true, publishedAt: { gte: expect.any(Date) } })]),
    );
  });

  it("stops, without touching the story, when the quota gate refuses", async () => {
    desk({ mode: "DRAFT", items: [item("a"), item("b")] });
    vi.mocked(assertWithin).mockRejectedValue(new LimitReached("draft", 100));
    expect(await runAutopilot("t1")).toEqual({ drafted: 0, published: 0 });
    expect(claims()).toHaveLength(0);
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("logs a story that fails and carries on with the next", async () => {
    desk({ mode: "DRAFT", items: [item("a"), item("b")] });
    vi.mocked(writeDraft).mockRejectedValueOnce(new Error("model said no ?access_token=SECRETSECRET"));
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(m.newsDraft.create.mock.calls.map((c) => c[0].data.itemId)).toEqual(["b"]);
    expect(audits()).toContain("news.autopilot_failed");
    expect(JSON.stringify([m.auditLog.create.mock.calls, errors.mock.calls])).not.toContain("SECRETSECRET");
  });

  it("leaves the draft for a person when the post fails, and stops the run", async () => {
    desk({ mode: "PUBLISH", gapMin: 1, items: [item("a"), item("b")] });
    vi.mocked(publishForWorkspace).mockResolvedValue([{ target: "FB", ok: false, error: "token expired" }]);
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    // The slot stays taken: a failed attempt uses up the gap too.
    expect(m.newsSettings.updateMany).toHaveBeenCalledTimes(1);
    expect(m.newsSettings.update).not.toHaveBeenCalled();
    expect(audits()).toContain("news.autopilot_publish_failed");
    expect(writeDraft).toHaveBeenCalledTimes(1);
  });

  it("does not post an event the desk already covered in the last two days, and leaves the draft for a person", async () => {
    desk({ mode: "PUBLISH" });
    writes(EVENT);
    m.newsDraft.findMany.mockResolvedValue([OTHER_EVENT, { ...EVENT }]);
    const before = Date.now();

    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });

    expect(renderAndStoreCard).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
    // Nothing was posted, so the slot is not used up either.
    expect(m.newsSettings.updateMany).not.toHaveBeenCalled();
    expect(audits()).toContain("news.autopilot_duplicate");
    expect(audits()).not.toContain("news.autopilot_publish_failed");
    const asked = m.newsDraft.findMany.mock.calls[0][0];
    expect(asked).toMatchObject({ where: { tenantId: "t1", id: { not: "d-a" } }, orderBy: { createdAt: "desc" }, take: 30 });
    const since = before - (asked.where.createdAt.gte as Date).getTime();
    expect(since).toBeGreaterThanOrEqual(48 * 3_600_000 - 5_000);
    expect(since).toBeLessThanOrEqual(48 * 3_600_000 + 5_000);
  });

  it("posts when the desk's recent drafts are about something else", async () => {
    desk({ mode: "PUBLISH" });
    writes(EVENT);
    vi.mocked(renderAndStoreCard).mockResolvedValue({ ...CARD, ...EVENT });
    m.newsDraft.findMany.mockResolvedValue([OTHER_EVENT]);
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 1 });
    expect(audits()).not.toContain("news.autopilot_duplicate");
  });

  it("takes the posting slot before the card is made, by the desk's own gap", async () => {
    desk({ mode: "PUBLISH", gapMin: 7 });
    const order: string[] = [];
    m.newsSettings.updateMany.mockImplementation(async () => (order.push("slot"), { count: 1 }));
    vi.mocked(renderAndStoreCard).mockImplementation(async () => (order.push("card"), { ...CARD, headline: DRAFT.headline, body: DRAFT.body }));
    vi.mocked(publishForWorkspace).mockImplementation(async (_ws, input) => (order.push("post"), input.targets.map((target) => ({ target, ok: true }))));

    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 1 });

    expect(order).toEqual(["slot", "card", "post"]);
    const { where, data } = m.newsSettings.updateMany.mock.calls[0][0];
    expect(where).toEqual({ tenantId: "t1", OR: [{ lastAutoAt: null }, { lastAutoAt: { lt: expect.any(Date) } }] });
    expect((data.lastAutoAt as Date).getTime() - (where.OR[1].lastAutoAt.lt as Date).getTime()).toBe(7 * 60_000);
  });

  it("does not post when another run took the slot first", async () => {
    desk({ mode: "PUBLISH", items: [item("a"), item("b")] });
    m.newsSettings.updateMany.mockResolvedValue({ count: 0 });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(renderAndStoreCard).not.toHaveBeenCalled();
    expect(publishForWorkspace).not.toHaveBeenCalled();
    expect(audits()).toContain("news.autopilot_slot_taken");
    // The other run is posting for this desk: this one stops.
    expect(writeDraft).toHaveBeenCalledTimes(1);
  });

  it("takes the caption from the text the card was rendered from", async () => {
    desk({ mode: "PUBLISH" });
    vi.mocked(renderAndStoreCard).mockResolvedValue({ ...CARD, headline: " سەردێڕی سەر کارتەکە ", body: "دەقی سەر کارتەکە.\n" });
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 1 });
    expect(vi.mocked(publishForWorkspace).mock.calls[0][1].caption).toBe("سەردێڕی سەر کارتەکە\n\nدەقی سەر کارتەکە.");
  });

  it("does not start a post with less than 35 s left, however long the card took", async () => {
    desk({ mode: "PUBLISH" });
    const real = Date.now.bind(Date);
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + skew);
    vi.mocked(renderAndStoreCard).mockImplementation(async () => {
      skew = 20_000;
      return { ...CARD, headline: DRAFT.headline, body: DRAFT.body };
    });
    try {
      // 54 s is enough to start; the card then eats 20 s, which leaves 34.
      expect(await runAutopilot("t1", { deadline: real() + 54_000 })).toEqual({ drafted: 1, published: 0 });
    } finally {
      clock.mockRestore();
    }
    expect(renderAndStoreCard).toHaveBeenCalledTimes(1);
    expect(publishForWorkspace).not.toHaveBeenCalled();
    expect(audits()).toContain("news.autopilot_publish_failed");
  });

  it("starts no story once the time for starting is over", async () => {
    desk({ mode: "DRAFT" });
    expect(await runAutopilot("t1", { startBy: Date.now() - 1 })).toEqual({ drafted: 0, published: 0 });
    expect(claims()).toHaveLength(0);
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("leaves the draft for a person when the card cannot be made", async () => {
    desk({ mode: "PUBLISH" });
    vi.mocked(renderAndStoreCard).mockRejectedValue(new Error("The headline is too long for the card."));
    expect(await runAutopilot("t1")).toEqual({ drafted: 1, published: 0 });
    expect(publishForWorkspace).not.toHaveBeenCalled();
    expect(audits()).toContain("news.autopilot_publish_failed");
  });

  it("does not start a story it has no time to post", async () => {
    desk({ mode: "PUBLISH" });
    expect(await runAutopilot("t1", { deadline: Date.now() + 20_000 })).toEqual({ drafted: 0, published: 0 });
    expect(claims()).toHaveLength(0);
    // The post alone needs 35 s, so 45 s is not enough for the draft, the card and the post.
    desk({ mode: "PUBLISH" });
    expect(await runAutopilot("t1", { deadline: Date.now() + 45_000 })).toEqual({ drafted: 0, published: 0 });
    expect(claims()).toHaveLength(0);
  });

  it("never throws, whatever breaks", async () => {
    desk({ mode: "DRAFT" });
    m.newsSettings.findUnique.mockRejectedValue(new Error("db down"));
    m.auditLog.create.mockRejectedValue(new Error("db down"));
    await expect(runAutopilot("t1")).resolves.toEqual({ drafted: 0, published: 0 });
  });
});
