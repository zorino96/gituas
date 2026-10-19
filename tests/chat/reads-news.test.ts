import { beforeEach, describe, expect, it, vi } from "vitest";

// The news desk's read tools talk to the database and to Meta; here both are replaced, so what is tested is the part that is ours: every
// query is scoped by the desk, a foreign id is refused, the model's copy of a result is small and holds no phone number, no address of
// the source and no label the desk does not need, the person's copy is full and in their language, every id passes on unchanged, and the
// words are written in all three languages.

const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  newsItem: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  newsDraft: { count: vi.fn(), findMany: vi.fn() },
  newsVideo: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  newsSettings: { findUnique: vi.fn() },
  newsSource: { count: vi.fn() },
  scheduledPost: { findMany: vi.fn(), count: vi.fn() },
  usage: { findUnique: vi.fn() },
  order: { findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn() },
}));
const data = vi.hoisted(() => ({
  loadAccountLists: vi.fn(),
  loadConnections: vi.fn(),
  loadPosts: vi.fn(),
  loadConversations: vi.fn(),
  loadInsights: vi.fn(),
  loadYouTube: vi.fn(),
}));
const props = vi.hoisted(() => ({ loadNewsProps: vi.fn() }));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => data);
vi.mock("@/app/app/settings/news-props", () => props);
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/shop/state", () => ({ loadCommentOutcomes: vi.fn(async () => ({})) }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});
// reads.ts (the shared reads) imports the shop's loaders too.
vi.mock("@/lib/assistant/state", () => ({ loadAssistantState: vi.fn(async () => ({})) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: () => true }));
vi.mock("@/lib/advideo/limits", () => ({ workspaceVideos: vi.fn(async () => null) }));
vi.mock("@/lib/ai/image-left", () => ({ imagesLeft: vi.fn(async () => null) }));
vi.mock("@/lib/ai/meter", () => ({ allowanceOf: vi.fn(async () => null), OPTIONAL_SHARE: 0.7 }));
vi.mock("@/lib/shop/quota", () => ({ aiVaryUsed: vi.fn(async () => 0), smartUsed: vi.fn(async () => 0) }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 0, images: 0 })) }));

import { READ_TOOLS } from "@/lib/chat/tools/reads";
import { NEWS_READ_TOOLS } from "@/lib/chat/tools/reads-news";
import { newsWords } from "@/lib/chat/tools/reads-news-words";
import { words } from "@/lib/chat/tools/reads-words";
import { PART_MAX, postedTo, storyState, textParts } from "@/lib/chat/tools/reads-news-shape";
import { wrapForModel } from "@/lib/chat/wrap";
import { ToolRefusal, type ToolCtx, type ViewBlock } from "@/lib/chat/types";
import { NEWS_QUICK_PLAN } from "@/lib/chat/quick";
import { loadInbox } from "@/lib/news/inbox";
import { dict } from "@/lib/i18n";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "news",
  lang: "en",
  threadId: "th1",
  attachments: [],
  review: true,
  deadline: Date.now() + 50_000,
  ...over,
});

const tool = (name: string) => {
  const t = [...NEWS_READ_TOOLS, ...READ_TOOLS].find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
/** Runs a tool the way the loop does: the arguments go through the tool's own schema first. */
const call = (name: string, args: unknown = {}, c: ToolCtx = ctx()) => tool(name).run(c, tool(name).schema.parse(args));
const json = (v: unknown) => JSON.stringify(v);

const NEWS_NAMES = ["get_desk_state", "list_stories", "get_story", "list_news_videos", "get_desk_insights", "get_desk_settings", "get_desk_usage"];
const PHONE = "0750 123 4567";
const NOW = new Date();
const DAY = 86_400_000;

const item = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  tenantId: "t1",
  title: "Parliament approves the new budget",
  snippet: "The council voted on Sunday to approve the budget for next year.",
  sourceName: "Rudaw",
  url: "https://rudaw.example/news/1",
  lang: "en",
  publishedAt: new Date(NOW.getTime() - 3_600_000),
  clusterKey: "c1",
  status: "NEW",
  category: "politics",
  subcategory: "elections",
  region: "iraq",
  imageUrl: null,
  draft: null,
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  itemId: "n1",
  tenantId: "t1",
  headline: "The new budget is approved",
  body: "Lawmakers agreed on the spending plan after a long session.",
  category: "گشتی",
  cardKind: "STANDARD",
  stat: null,
  quote: null,
  speaker: null,
  photoPath: null,
  cardUrl: null,
  cardPath: null,
  results: null,
  publishedAt: null,
  auto: false,
  model: "x",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const tenantRow = (over: Record<string, unknown> = {}) => ({
  name: "Janan",
  kind: "NEWS",
  plan: "AUTO",
  planPaidUntil: new Date(NOW.getTime() + 10 * DAY),
  trialEndsAt: null,
  ...over,
});

const noLists = { META_FACEBOOK: [], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] };
const notConnected = { META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } };

beforeEach(() => {
  vi.resetAllMocks();
  db.tenant.findUnique.mockResolvedValue(tenantRow());
  db.newsSettings.findUnique.mockResolvedValue({ categories: [], filterMode: "KEYWORDS", focusPrompt: null, excludePrompt: null, focusBroad: false, lastFetchedAt: null, autoMode: "OFF" });
  db.newsItem.findMany.mockResolvedValue([]);
  db.newsItem.count.mockResolvedValue(0);
  db.newsDraft.count.mockResolvedValue(0);
  db.newsDraft.findMany.mockResolvedValue([]);
  db.newsVideo.findMany.mockResolvedValue([]);
  db.newsVideo.count.mockResolvedValue(0);
  db.newsSource.count.mockResolvedValue(0);
  db.scheduledPost.findMany.mockResolvedValue([]);
  db.scheduledPost.count.mockResolvedValue(0);
  db.usage.findUnique.mockResolvedValue(null);
  db.order.findMany.mockResolvedValue([]);
  db.conversationMessage.findMany.mockResolvedValue([]);
  data.loadAccountLists.mockResolvedValue(noLists);
  data.loadConnections.mockResolvedValue(notConnected);
});

describe("the catalogue", () => {
  it("has the seven desk tools: read tools for the news kind with the right permission and trust", () => {
    expect(NEWS_READ_TOOLS.map((t) => t.name).sort()).toEqual([...NEWS_NAMES].sort());
    for (const t of NEWS_READ_TOOLS) {
      expect(t.risk).toBe("read");
      expect(t.kinds).toEqual(["news"]);
      expect(t.permission, t.name).toBe(["get_desk_settings", "get_desk_usage"].includes(t.name) ? "configure" : "read");
      // What carries outside sources' words (a feed's titles, a draft made from them, post captions) is untrusted.
      expect(!!t.untrusted, t.name).toBe(["list_stories", "get_story", "list_news_videos", "get_desk_insights"].includes(t.name));
    }
  });

  it("is joined to the shop's reads without a name used twice, and the shared reads serve both kinds", () => {
    const names = [...READ_TOOLS, ...NEWS_READ_TOOLS].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["list_comments", "list_conversations", "get_conversation", "list_scheduled_posts"]) expect(tool(n).kinds).toEqual(["shop", "news"]);
    // The shop-only reads stay out of the desk's reach.
    for (const n of ["get_account_state", "orders_summary", "list_orders", "get_order", "list_products", "get_insights", "list_videos", "get_settings", "get_plan_usage"]) {
      expect(tool(n).kinds, n).toEqual(["shop"]);
    }
  });

  it("describes each tool in at most four sentences and says what to do with the ids", () => {
    const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    expect(NEWS_READ_TOOLS.filter((t) => sentencesOf(t.description) > 4).map((t) => `${t.name}: ${sentencesOf(t.description)}`)).toEqual([]);
    for (const t of NEWS_READ_TOOLS) expect(t.description.length, t.name).toBeGreaterThan(40);
    expect(tool("list_stories").description).toMatch(/`id`.*`story`/);
    expect(tool("get_story").description).toContain("`story`");
    expect(tool("list_news_videos").description).toContain("`story`");
    expect(tool("get_desk_settings").description).toContain("`id`");
  });

  it("rejects unknown arguments and out-of-range values", () => {
    expect(() => tool("list_stories").schema.parse({ limit: 99 })).toThrow();
    expect(() => tool("list_stories").schema.parse({ tab: "dismissed" })).toThrow();
    expect(() => tool("list_stories").schema.parse({ category: "gossip" })).toThrow();
    expect(() => tool("list_stories").schema.parse({ region: "mars" })).toThrow();
    expect(() => tool("list_stories").schema.parse({ tenantId: "t2" })).toThrow();
    expect(() => tool("get_story").schema.parse({})).toThrow();
    expect(() => tool("get_story").schema.parse({ story: "n1", tenantId: "t2" })).toThrow();
    expect(() => tool("get_desk_insights").schema.parse({ days: 400 })).toThrow();
    expect(() => tool("get_desk_settings").schema.parse({ area: "payments" })).toThrow();
    expect(() => tool("list_news_videos").schema.parse({ limit: 0 })).toThrow();
    expect(tool("list_stories").schema.parse({})).toEqual({ tab: "new", limit: 10 });
  });
});

describe("the shortcut buttons", () => {
  it("name only tools the desk has, with arguments their schemas accept", () => {
    for (const [id, plan] of Object.entries(NEWS_QUICK_PLAN)) {
      for (const step of plan) {
        const t = tool(step.tool);
        expect(t.kinds, `${id}/${step.tool}`).toContain("news");
        expect(t.risk).toBe("read");
        expect(t.schema.safeParse(step.args).success, `${id}/${step.tool}`).toBe(true);
      }
    }
  });
});

describe("the words", () => {
  const shape = (v: unknown): unknown => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);

  it("have the same keys in Sorani, Arabic and English, none of them empty", () => {
    expect(shape(newsWords("ar"))).toEqual(shape(newsWords("ckb")));
    expect(shape(newsWords("en"))).toEqual(shape(newsWords("ckb")));
    const walk = (v: unknown, path: string, lang: string) => {
      if (typeof v === "string") expect(v.trim().length, `${lang}.${path}`).toBeGreaterThan(0);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, lang);
    };
    for (const lang of ["ckb", "ar", "en"] as const) walk(newsWords(lang), "", lang);
  });

  it("keep each script clean: no Kurdish-only letter in the Arabic, no Arabic-only letter in the Sorani, no Arabic script in the English", () => {
    const text = (lang: "ckb" | "ar" | "en") => JSON.stringify(newsWords(lang));
    // Kurdish kaf and yeh count as Kurdish-only here, because the Arabic words must be written with the Arabic ones.
    expect(text("ar")).not.toMatch(/[کیەێۆڕڵڤپچژگ]/);
    expect(text("ckb")).not.toMatch(/[كيىة]/);
    expect(text("en")).not.toMatch(/[؀-ۿ]/);
  });

  it("give every tool of the desk a working sentence in every language", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      for (const t of NEWS_READ_TOOLS) expect(t.label(lang), `${t.name}/${lang}`).toMatch(/\S/);
    }
  });

  it("name every status a news video can have", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      for (const s of ["QUEUED", "VOICED", "RENDERING", "RENDERED", "POSTING", "POSTED", "FAILED", "CARD"]) expect(newsWords(lang).videoStatus[s], `${lang}/${s}`).toBeTruthy();
    }
  });
});

describe("long text for the model", () => {
  it("is handed over in parts the wrapper will not cut, and joining them gives the text back", () => {
    const text = Array.from({ length: 140 }, (_, i) => `word${i}`).join(" ");
    const parts = textParts(text);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(PART_MAX);
    expect(parts.join(" ")).toBe(text);
    expect(textParts("short")).toEqual(["short"]);
    expect(textParts("")).toEqual([]);
    expect(textParts(null)).toEqual([]);
  });

  it("cuts a text with no spaces without splitting an emoji", () => {
    const parts = textParts("😀".repeat(400));
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(PART_MAX);
      expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(p).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(parts.join("")).toBe("😀".repeat(400));
  });

  it("drops hidden characters before it counts", () => {
    const zwsp = String.fromCodePoint(0x200b);
    expect(textParts(`a${zwsp}b c`)).toEqual(["ab c"]);
  });
});

describe("the inbox query", () => {
  it("asks for the tab's statuses inside this desk only, newest first, and groups the stories of one event", async () => {
    db.newsItem.findMany.mockResolvedValue([item({ id: "a", clusterKey: "c1" }), item({ id: "b", clusterKey: "c1" }), item({ id: "c", clusterKey: "c2" })]);
    db.newsItem.count.mockResolvedValue(3);
    const r = await loadInbox("t1", "ready", { category: "politics", source: "Rudaw" });
    const q = db.newsItem.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ tenantId: "t1", status: { in: ["DRAFTED"] }, category: "politics", sourceName: "Rudaw" });
    expect(q.orderBy).toEqual({ publishedAt: "desc" });
    expect(q.take).toBe(150);
    expect(db.newsItem.count.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(r.groups.map((g) => [g.lead.id, g.count])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
    expect(r.total).toBe(3);
  });

  it("keeps the desk's topic choice and, with news by prompt on a plan that has it, the AI's verdicts", async () => {
    db.newsSettings.findUnique.mockResolvedValue({ categories: ["politics"], filterMode: "PROMPT", focusPrompt: "only the budget", excludePrompt: null, focusBroad: false });
    await loadInbox("t1", "new");
    const and = db.newsItem.findMany.mock.calls[0][0].where.AND;
    expect(and).toHaveLength(2);
    expect(and[0].OR).toContainEqual({ category: null });
    expect(and[0].OR).toContainEqual({ category: { in: ["politics"] } });
    // A plan without news by prompt shows every story, whatever was saved.
    db.newsItem.findMany.mockClear();
    db.tenant.findUnique.mockResolvedValue(tenantRow({ plan: "MANUAL" }));
    await loadInbox("t1", "new");
    expect(db.newsItem.findMany.mock.calls[0][0].where.AND).toHaveLength(1);
  });
});

describe("list_stories", () => {
  it("passes the story id on unchanged and gives the model small rows without the source address or the snippet", async () => {
    const long = `${"x".repeat(250)} call ${PHONE} now`;
    db.newsItem.findMany.mockResolvedValue([
      item({ id: "story-1", clusterKey: "k1", title: long }),
      item({ id: "story-2", clusterKey: "k2", status: "DRAFTED", draft: { id: "d2", auto: true, cardPath: "merchant/t1/card.jpg" } }),
      item({ id: "story-3", clusterKey: "k3", status: "DRAFTED", draft: { id: "d3", auto: false, cardPath: null } }),
      item({ id: "story-4", clusterKey: "k4", status: "PUBLISHED", draft: { id: "d4", auto: false, cardPath: "merchant/t1/c.jpg" } }),
    ]);
    db.newsItem.count.mockResolvedValue(4);
    const r = await call("list_stories", { limit: 4 });
    const d = r.data as { tab: string; total: number; shown: number; stories: Record<string, unknown>[] };
    expect(d.tab).toBe("new");
    expect(d.stories.map((s) => s.id)).toEqual(["story-1", "story-2", "story-3", "story-4"]);
    expect(d.stories.map((s) => s.state)).toEqual(["new", "card_ready", "drafted", "published"]);
    expect(d.stories[1].auto).toBe(true);
    expect(d.stories[0]).toMatchObject({ source: "Rudaw", lang: "en", topic: "politics/elections", region: "iraq" });
    expect(Array.from(d.stories[0].title as string).length).toBeLessThanOrEqual(120);
    const text = json(r.data);
    expect(text).not.toContain("rudaw.example");
    expect(text).not.toContain("snippet");
    expect(text).not.toContain("council voted");
    expect(text).not.toContain("0750");
    expect(d).toMatchObject({ total: 4, shown: 4 });
  });

  it("fits a default page of stories through the wrapper without losing one", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => item({ id: `cm${"x".repeat(20)}${i}`, clusterKey: `k${i}`, title: `${"A long headline about the budget ".repeat(6)}${i}` }));
    db.newsItem.findMany.mockResolvedValue(rows);
    db.newsItem.count.mockResolvedValue(10);
    const r = await call("list_stories");
    const wrapped = JSON.parse(wrapForModel(r.data, { untrusted: true }));
    expect(wrapped.data.stories).toHaveLength(10);
    // `truncated` is the tool's own flag (false: nothing was left out); the wrapper would have replaced it with the true totals.
    expect(wrapped.data.truncated).toBe(false);
    expect(wrapped.untrusted).toBe(true);
  });

  it("takes a phone number out of a title for the model while the person's list keeps the title", async () => {
    db.newsItem.findMany.mockResolvedValue([item({ title: `Hotline ${PHONE} opens` })]);
    db.newsItem.count.mockResolvedValue(1);
    const r = await call("list_stories");
    expect(json(r.data)).toContain("[number]");
    expect(json(r.data)).not.toContain("123 4567");
    const list = r.view?.[0];
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items[0].title).toContain(PHONE);
  });

  it("scopes the query to the desk and passes the filters as plain values", async () => {
    await call("list_stories", { tab: "done", category: "sports", region: "kurdistan", lang: "ku", source: "Rudaw", limit: 5 });
    const q = db.newsItem.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ tenantId: "t1", status: { in: ["PUBLISHED"] }, category: "sports", region: "kurdistan", lang: "ku", sourceName: "Rudaw" });
    expect(db.newsSettings.findUnique.mock.calls.every((c) => c[0].where.tenantId === "t1")).toBe(true);
  });

  it("shows the person the whole list in their language, with the way to each story and how many are left", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => item({ id: `s${i}`, clusterKey: `c${i}`, title: `Story number ${i}` }));
    db.newsItem.findMany.mockResolvedValue(rows);
    db.newsItem.count.mockResolvedValue(12);
    const r = await call("list_stories", { limit: 10 });
    const d = r.data as { total: number; shown: number; truncated: boolean };
    expect(d).toMatchObject({ total: 12, shown: 10, truncated: true });
    const list = r.view?.[0];
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items).toHaveLength(10);
    expect(list.more).toBe(2);
    expect(list.items[0].href).toBe("/newsroom/news/s0");
    expect(list.title).toBe(dict("en").nr.news.list.tabs.new);
    const ku = await call("list_stories", {}, ctx({ lang: "ckb" }));
    const kuList = ku.view?.[0];
    if (kuList?.kind !== "list") throw new Error("no list");
    expect(kuList.title).toBe(dict("ckb").nr.news.list.tabs.new);
    expect(kuList.items[0].sub).toContain("Rudaw");
  });

  it("says plainly that there are no stories, and never links to the shop's side of the site", async () => {
    const r = await call("list_stories");
    expect(r.view).toEqual([{ kind: "note", text: dict("en").nr.news.list.empty }]);
    db.newsItem.findMany.mockResolvedValue([item()]);
    const full = await call("list_stories");
    expect(json(full.view)).not.toContain('"/app');
  });
});

describe("get_story", () => {
  it("refuses an id that is not this desk's, looking it up inside the desk only", async () => {
    db.newsItem.findFirst.mockResolvedValue(null);
    await expect(call("get_story", { story: "someone-elses-story" })).rejects.toBeInstanceOf(ToolRefusal);
    expect(db.newsItem.findFirst).toHaveBeenCalledWith({ where: { id: "someone-elses-story", tenantId: "t1" }, include: { draft: true } });
  });

  it("opens a story without a draft: the source text in parts with the phone number out, no address", async () => {
    const snippet = `${Array.from({ length: 150 }, (_, i) => `fact${i}`).join(" ")} reach us on ${PHONE}`;
    db.newsItem.findFirst.mockResolvedValue(item({ snippet, imageUrl: "https://img.example/p.jpg" }));
    db.newsItem.count.mockResolvedValue(3);
    const r = await call("get_story", { story: "n1" });
    const d = r.data as Record<string, unknown> & { sourceText: string[]; draft: unknown };
    expect(d).toMatchObject({ id: "n1", state: "new", reportedBySources: 3, topic: "politics/elections", region: "iraq", hasSourcePicture: true });
    expect(d.draft).toBeNull();
    expect(d.sourceText.every((p) => p.length <= PART_MAX)).toBe(true);
    expect(Array.from(d.sourceText.join(" ")).length).toBeLessThanOrEqual(600);
    expect(json(d)).not.toContain("0750");
    expect(json(d)).not.toContain("rudaw.example");
    expect(json(d)).not.toContain("img.example");
    expect(db.newsVideo.findFirst).not.toHaveBeenCalled();
    expect(db.newsItem.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", clusterKey: "c1" });
    const texts = (r.view as ViewBlock[]).map((b) => b.kind);
    expect(texts).toContain("note");
  });

  it("gives the draft exactly as it is, in parts, with its ids, its card state, its video and where it went", async () => {
    const body = `${Array.from({ length: 48 }, (_, i) => `sentence${i}`).join(" ")} total 1500000000 IQD`;
    const d = draft({
      body,
      stat: "35%",
      quote: "We will not stop",
      speaker: "The minister",
      cardPath: "merchant/t1/card.jpg",
      photoPath: "merchant/t1/photo.jpg",
      results: [
        { target: "FB", ok: true, accountName: "Janan Page", accountId: "123" },
        { target: "IG", ok: false, accountName: "janan_ig", error: "Media upload failed" },
        { nonsense: true },
      ],
    });
    db.newsItem.findFirst.mockResolvedValue(item({ status: "DRAFTED", draft: d }));
    db.newsItem.count.mockResolvedValue(1);
    db.newsVideo.findFirst.mockResolvedValue({ id: "v1", status: "RENDERED", style: "TEMPLATE", videoUrl: "https://blob.example/v.mp4", createdAt: NOW });
    const r = await call("get_story", { story: "n1" });
    const out = r.data as { id: string; state: string; draft: Record<string, unknown>; video: Record<string, unknown> };
    expect(out.id).toBe("n1");
    expect(out.state).toBe("card_ready");
    expect(out.draft).toMatchObject({
      id: "d1",
      headline: "The new budget is approved",
      cardKind: "STANDARD",
      stat: "35%",
      quote: "We will not stop",
      speaker: "The minister",
      hasPhoto: true,
      cardReady: true,
      readyToPublish: true,
    });
    // The desk's own text is given whole: its figures are never taken for a phone number.
    const parts = out.draft.body as string[];
    expect(parts.join(" ")).toBe(body);
    expect(parts.join(" ")).toContain("1500000000");
    expect(out.draft.postedTo).toEqual([
      { target: "FB", ok: true, account: "Janan Page" },
      { target: "IG", ok: false, account: "janan_ig", error: "Media upload failed" },
    ]);
    expect(out.video).toEqual({ status: "RENDERED", style: "TEMPLATE", ready: true });
    expect(json(out)).not.toContain("blob.example");
    expect(json(out)).not.toContain("merchant/t1");
    expect(json(out)).not.toContain("123");
    expect(db.newsVideo.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", draftId: "d1" });
    // What the loop hands the model: the wrapper cuts every string to 300 characters, and the parts come through whole.
    const wrapped = JSON.parse(wrapForModel(r.data, { untrusted: true }));
    expect(wrapped.untrusted).toBe(true);
    expect(wrapped.data.draft.body.join(" ")).toBe(body);
    expect(wrapped.data.truncated).toBeUndefined();
  });

  it("reports the rule problems in English for the model and in the person's language for the screen", async () => {
    const copy = draft({ headline: "Parliament approves the new budget", body: "The council voted on Sunday to approve the budget for next year." });
    db.newsItem.findFirst.mockResolvedValue(item({ status: "DRAFTED", draft: copy }));
    db.newsItem.count.mockResolvedValue(1);
    const r = await call("get_story", { story: "n1" }, ctx({ lang: "ckb" }));
    const out = r.data as { draft: { problems: { code: string; message: string }[]; readyToPublish: boolean } };
    expect(out.draft.problems.map((p) => p.code)).toContain("COPY");
    expect(out.draft.problems[0].message).toMatch(/source/i);
    expect(out.draft.readyToPublish).toBe(false);
    const warn = (r.view as ViewBlock[]).filter((b) => b.kind === "note" && b.tone === "warn");
    expect(warn.length).toBeGreaterThan(0);
    expect(warn[0]).toMatchObject({ text: dict("ckb").nr.news.rules.copy.both });
    expect(json(r.view)).not.toContain('"/app');
  });

  it("shows the person the draft in full and the story's source as a link they can open", async () => {
    db.newsItem.findFirst.mockResolvedValue(item({ status: "DRAFTED", draft: draft({ cardPath: "merchant/t1/c.jpg" }) }));
    db.newsItem.count.mockResolvedValue(1);
    const r = await call("get_story", { story: "n1" });
    const blocks = r.view as ViewBlock[];
    const stats = blocks[0];
    if (stats.kind !== "stats") throw new Error("no stats");
    expect(stats.href).toBe("/newsroom/news/n1");
    const source = blocks[1];
    if (source.kind !== "list") throw new Error("no list");
    expect(source.items[0].href).toBe("https://rudaw.example/news/1");
    const drafted = blocks[2];
    if (drafted.kind !== "stats") throw new Error("no draft stats");
    expect(drafted.items.map((i) => i.value).join(" | ")).toContain("The new budget is approved");
    expect(drafted.items.map((i) => i.value).join(" | ")).toContain("Lawmakers agreed");
  });

  it("calls a dismissed story dismissed", () => {
    expect(storyState({ status: "DISMISSED", draft: null })).toBe("dismissed");
    expect(storyState({ status: "NEW", draft: { cardPath: null } })).toBe("drafted");
  });

  it("reads where a draft went from its stored results, ignoring what is not a result", () => {
    expect(postedTo(null)).toEqual([]);
    expect(postedTo("x")).toEqual([]);
    expect(postedTo([null, 5, { target: 3 }, { target: "YT", ok: true }])).toEqual([{ target: "YT", ok: true }]);
  });
});

describe("list_news_videos", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", itemId: "n1", draftId: "d1", status: "RENDERED", autoPost: true, videoUrl: "https://blob.example/v.mp4", createdAt: NOW, ...over });

  it("scopes the reels and their headlines to the desk, and hands over the story id, never a job", async () => {
    db.newsVideo.findMany.mockResolvedValue([row(), row({ id: "v2", itemId: "n2", draftId: "d2", status: "QUEUED", videoUrl: null })]);
    db.newsVideo.count.mockResolvedValue(2);
    db.newsDraft.findMany.mockResolvedValue([
      { id: "d1", headline: "First headline" },
      { id: "d2", headline: "Second headline" },
    ]);
    db.usage.findUnique.mockResolvedValue({ count: 12 });
    const r = await call("list_news_videos");
    const q = db.newsVideo.findMany.mock.calls[0][0];
    expect(q.where.tenantId).toBe("t1");
    expect(q.where.status.in).toEqual(["RENDERED", "POSTED", "POSTING", "QUEUED", "VOICED", "RENDERING"]);
    expect(Date.now() - q.where.createdAt.gte.getTime()).toBeGreaterThan(3 * DAY - 5_000);
    expect(db.newsVideo.count.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.newsDraft.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["d1", "d2"] }, tenantId: "t1" });
    const d = r.data as { videosThisMonth: { used: number; planAllows: number }; videos: Record<string, unknown>[] };
    expect(d.videosThisMonth).toEqual({ used: 12, planAllows: 300 });
    expect(d.videos).toEqual([
      expect.objectContaining({ id: "v1", story: "n1", headline: "First headline", status: "RENDERED", ready: true }),
      expect.objectContaining({ id: "v2", story: "n2", headline: "Second headline", status: "QUEUED", ready: false }),
    ]);
    expect(json(d)).not.toContain("blob.example");
    expect(json(d)).not.toMatch(/jobId/);
    const list = (r.view as ViewBlock[]).find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items[0].href).toBe("https://blob.example/v.mp4");
    expect(list.items[1].href).toBeUndefined();
    expect(list.items[0].badge).toBe(newsWords("en").videoStatus.RENDERED);
  });

  it("says there are none, without a second query for headlines", async () => {
    const r = await call("list_news_videos");
    expect(db.newsDraft.findMany).not.toHaveBeenCalled();
    expect((r.view as ViewBlock[]).some((b) => b.kind === "note" && b.text === dict("en").nr.news.editor.listEmpty)).toBe(true);
  });
});

describe("get_desk_state", () => {
  it("counts the stories of the desk's three tabs, what went out today and what waits, all inside the desk", async () => {
    db.newsItem.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2).mockResolvedValueOnce(40);
    db.newsDraft.count.mockResolvedValue(3);
    db.scheduledPost.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    db.newsSource.count.mockResolvedValue(6);
    db.newsSettings.findUnique.mockResolvedValue({ categories: [], filterMode: "PROMPT", focusPrompt: null, excludePrompt: null, focusBroad: false, lastFetchedAt: new Date(NOW.getTime() - 120_000), autoMode: "DRAFT" });
    data.loadAccountLists.mockResolvedValue({
      META_FACEBOOK: [{ id: "page-777001", name: "Janan Page", avatarUrl: null }],
      META_INSTAGRAM: [],
      TIKTOK: [],
      YOUTUBE: [{ id: "UC1", name: "Janan TV", avatarUrl: null }],
    });
    const r = await call("get_desk_state");
    const d = r.data as Record<string, any>;
    expect(d.desk).toBe("Janan");
    expect(d.plan).toBe("AUTO");
    expect(d.access).toMatchObject({ mayWrite: true, status: "paid" });
    expect(d.stories).toEqual({ new: 5, draftsReady: 2, published: 40, publishedToday: 3 });
    expect(d.scheduledPosts).toBe(4);
    expect(d.failedScheduledPostsLast14Days).toBe(1);
    expect(d.sourcesOn).toBe(6);
    expect(d.refreshEverySec).toBe(60);
    expect(d.autopilot).toBe("DRAFT");
    expect(d.newsFilter).toBe("PROMPT");
    expect(d.connected).toEqual({ facebook: ["Janan Page"], instagram: [], tiktok: [], youtube: ["Janan TV"] });
    expect(d.lastRefresh).toMatch(/\+03:00$/);
    // Nothing that is a token, an id of a Page or a story's text.
    expect(json(d)).not.toContain("777001");
    expect(db.tenant.findUnique.mock.calls.every((c) => c[0].where.id === "t1")).toBe(true);
    expect(db.scheduledPost.count.mock.calls.every((c) => c[0].where.tenantId === "t1")).toBe(true);
    expect(db.newsDraft.count.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(data.loadAccountLists).toHaveBeenCalledWith("t1");
    const stats = r.view?.[0];
    if (stats?.kind !== "stats") throw new Error("no stats");
    expect(stats.title).toBe("Janan");
    expect(stats.items.map((i) => i.value).join(" | ")).toContain("Janan Page");
  });

  it("tells a trial desk its days and a frozen desk that it only reads", async () => {
    db.tenant.findUnique.mockResolvedValue(tenantRow({ planPaidUntil: null, trialEndsAt: new Date(NOW.getTime() + 3 * DAY - 1_000) }));
    const trial = await call("get_desk_state");
    expect((trial.data as { access: unknown }).access).toMatchObject({ mayWrite: true, status: "trial", trialDaysLeft: 3 });
    db.tenant.findUnique.mockResolvedValue(tenantRow({ planPaidUntil: null, trialEndsAt: new Date(NOW.getTime() - DAY) }));
    const frozen = await call("get_desk_state");
    expect((frozen.data as { access: unknown }).access).toMatchObject({ mayWrite: false, status: "frozen" });
    const stats = frozen.view?.[0];
    if (stats?.kind !== "stats") throw new Error("no stats");
    expect(stats.items[0].value).toContain(newsWords("en").frozenShort);
  });

  it("refuses a desk that does not exist", async () => {
    db.tenant.findUnique.mockResolvedValue(null);
    await expect(call("get_desk_state")).rejects.toBeInstanceOf(ToolRefusal);
  });

  it("answers in the person's language", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await call("get_desk_state", {}, ctx({ lang }));
      const stats = r.view?.[0];
      if (stats?.kind !== "stats") throw new Error("no stats");
      expect(stats.items.map((i) => i.label), lang).toContain(newsWords(lang).newStories);
      expect(stats.items.map((i) => i.label), lang).toContain(dict(lang).platform.FB);
    }
  });
});

describe("get_desk_insights", () => {
  it("counts what the desk did over the period, failures by platform, and the platforms' numbers when they answer", async () => {
    data.loadConnections.mockResolvedValue({ ...notConnected, META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" } });
    data.loadInsights.mockResolvedValue({ fbFollowers: 900, fbMetrics: [], igMetrics: [], waTaps7d: 0, notes: [] });
    data.loadPosts.mockResolvedValue({
      posts: [
        { platform: "FB", id: "p1", caption: `Big news call ${PHONE}`, commentCount: 7, comments: [], createdAt: "2026-10-18T10:00:00+0000", permalink: "https://facebook.example/p1" },
        { platform: "FB", id: "p2", caption: "Quiet", commentCount: 0, comments: [] },
      ],
      errors: [],
    });
    db.newsItem.count.mockResolvedValue(120);
    db.newsDraft.count.mockResolvedValueOnce(40).mockResolvedValueOnce(25).mockResolvedValueOnce(30);
    db.newsVideo.count.mockResolvedValue(6);
    db.newsDraft.findMany.mockResolvedValue([
      { results: [{ target: "IG", ok: false, error: "x" }, { target: "FB", ok: true }] },
      { results: [{ target: "IG", ok: false, error: "y" }] },
      { results: null },
    ]);
    const r = await call("get_desk_insights", { days: 14 });
    const d = r.data as { days: number; desk: Record<string, unknown>; facebookFollowers: number; topPostsByComments: { caption: string; comments: number }[] };
    expect(d.days).toBe(14);
    expect(d.desk).toEqual({ storiesReceived: 120, draftsWritten: 40, writtenByAutopilot: 25, storiesPublished: 30, videosMade: 6, failedPostsByPlatform: { IG: 2 } });
    expect(d.facebookFollowers).toBe(900);
    expect(d.topPostsByComments).toHaveLength(1);
    expect(d.topPostsByComments[0].comments).toBe(7);
    expect(d.topPostsByComments[0].caption).toContain("[number]");
    expect(json(d)).not.toContain("123 4567");
    // Every count is the desk's own, over the period asked for.
    for (const c of [...db.newsItem.count.mock.calls, ...db.newsDraft.count.mock.calls, ...db.newsVideo.count.mock.calls, ...db.newsDraft.findMany.mock.calls]) {
      expect(c[0].where.tenantId).toBe("t1");
    }
    expect(Date.now() - db.newsItem.count.mock.calls[0][0].where.createdAt.gt.getTime()).toBeGreaterThan(14 * DAY - 5_000);
    expect(data.loadInsights.mock.calls[0][0]).toBe("t1");
    const top = (r.view as ViewBlock[]).find((b) => b.kind === "list");
    if (top?.kind !== "list") throw new Error("no list");
    expect(top.items[0].title).toContain(PHONE);
    expect(top.items[0].href).toBe("https://facebook.example/p1");
  });

  it("says what could not be read instead of guessing, and still gives the desk's own numbers", async () => {
    data.loadConnections.mockResolvedValue({ ...notConnected, META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" } });
    data.loadInsights.mockRejectedValue(new Error("Meta down"));
    data.loadPosts.mockRejectedValue(new Error("Meta down"));
    db.newsItem.count.mockResolvedValue(7);
    const r = await call("get_desk_insights");
    const d = r.data as { desk: { storiesReceived: number }; notAvailable: string[]; facebookFollowers?: number };
    expect(d.desk.storiesReceived).toBe(7);
    expect(d.notAvailable).toEqual(["facebook_and_instagram_numbers", "top_posts"]);
    expect(d.facebookFollowers).toBeUndefined();
    expect((r.view as ViewBlock[]).some((b) => b.kind === "note" && b.tone === "warn")).toBe(true);
  });

  it("does not start a Meta read it has no time for", async () => {
    data.loadConnections.mockResolvedValue({ ...notConnected, META_INSTAGRAM: { connected: true, name: "ig", accountId: "ig1" } });
    const r = await call("get_desk_insights", {}, ctx({ deadline: Date.now() + 1_000 }));
    expect(data.loadInsights).not.toHaveBeenCalled();
    expect((r.data as { notAvailable: string[] }).notAvailable).toContain("facebook_and_instagram_numbers");
  });
});

describe("get_desk_settings", () => {
  const settingsProps = () => ({
    workspaceId: "t1",
    pageName: "",
    keywords: ["Erbil", "budget"],
    catalog: [
      { id: "gdelt", name: "GDELT", group: "api", lang: null, description: null, enabled: true, lastError: "secret upstream error text" },
      { id: "bbc-en", name: "BBC News", group: "world", lang: "en", description: null, enabled: false, lastError: null },
      { id: "k24-ckb", name: "Kurdistan24", group: "kurdistan", lang: "ckb", description: null, enabled: true, lastError: null },
    ],
    categories: ["politics", "sports/football"],
    keywordFilter: true,
    sourceImages: false,
    aiPictures: true,
    photoCardsOnly: false,
    filter: { level: "focus", mode: "PROMPT", focus: "only the budget", exclude: "", broad: false },
    video: {
      quota: 300,
      used: 4,
      full: false,
      mode: "AUTO",
      style: "TEMPLATE",
      clips: [{ id: "clip1", url: "https://blob.example/c.mp4", label: "Citadel", general: false }],
      topics: ["politics"],
      dailyMax: 5,
      voice: "aram",
      speed: 1,
      prompt: "",
      clone: { saved: false, text: "", seconds: 0 },
    },
    voiceNote: "Short sentences.",
    autopilot: {
      mode: "DRAFT",
      targets: ["FB"],
      dailyMax: 20,
      minGapMin: 3,
      quietFrom: 1,
      quietTo: 8,
      canPublish: true,
      refreshSec: 60,
      connected: { FB: true, IG: false },
      accountLists: { FB: [{ id: "111", name: "Janan Page" }], IG: [] },
      accounts: ["FB:111"],
    },
    feeds: [{ id: "feed1", name: "My feed", url: "https://myfeed.example/rss", lastError: "feed error text" }],
    kit: { logoPath: "merchant/t1/logo.png", primary: "#0B2545", accent: "#E0A526", text: "#FFFFFF", headingFont: "kufi", framePath: null, frameText: "bottom", logoCorner: "off" },
    photos: [{ id: "ph1", pathname: "merchant/t1/p.jpg", label: "Erbil citadel", general: false }],
    sectionFrames: [{ section: "sports", framePath: "merchant/t1/f.png", frameText: "top", referencePath: null, note: "green" }],
    designPrompt: "deep blue, thin gold lines",
    aiFrames: true,
  });

  const setup = () => {
    props.loadNewsProps.mockResolvedValue(settingsProps());
    data.loadAccountLists.mockResolvedValue({
      META_FACEBOOK: [{ id: "111", name: "Janan Page", avatarUrl: null }],
      META_INSTAGRAM: [{ id: "222", name: "janan_ig", avatarUrl: null }],
      TIKTOK: [],
      YOUTUBE: [],
    });
    data.loadConnections.mockResolvedValue(notConnected);
    db.newsSource.count.mockResolvedValue(3);
  };

  it("reads the desk's own settings through the setup screens' loader, for this desk only", async () => {
    setup();
    await call("get_desk_settings");
    expect(props.loadNewsProps.mock.calls[0][0]).toMatchObject({ id: "t1" });
    expect(data.loadAccountLists).toHaveBeenCalledWith("t1");
    expect(data.loadConnections).toHaveBeenCalledWith("t1");
    expect(db.tenant.findUnique.mock.calls[0][0].where.id).toBe("t1");
    expect(db.newsSource.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", enabled: true });
  });

  it("gives the source tools their ids, the sources that fail by id and never the error text", async () => {
    setup();
    const r = await call("get_desk_settings", { area: "sources" });
    const d = (r.data as { sources: Record<string, any> }).sources;
    expect(d.sources).toEqual([
      { id: "gdelt", name: "GDELT", on: true },
      { id: "bbc-en", name: "BBC News", on: false },
      { id: "k24-ckb", name: "Kurdistan24", on: true },
    ]);
    expect(d.ownFeeds).toEqual([{ id: "feed1", name: "My feed" }]);
    expect(d.notWorking).toEqual(["gdelt", "feed1"]);
    expect(d).toMatchObject({ keywords: ["Erbil", "budget"], topicsKept: ["politics", "sports/football"], keywordFilter: true, sourcesOn: 3, sourceLimit: 30 });
    expect(json(r.data)).not.toContain("error text");
    expect(json(r.data)).not.toContain("myfeed.example");
    // The person sees the failure and the feed's address.
    expect(json(r.view)).toContain("secret upstream error text");
    expect(json(r.view)).toContain("myfeed.example");
    expect((r.data as { sources: unknown; autopilot?: unknown }).autopilot).toBeUndefined();
  });

  it("gives the publish tools the Pages' ids and the autopilot's choice", async () => {
    setup();
    const r = await call("get_desk_settings", { area: "accounts" });
    const d = (r.data as { accounts: Record<string, unknown> }).accounts;
    expect(d.facebook).toEqual([{ id: "111", name: "Janan Page" }]);
    expect(d.instagram).toEqual([{ id: "222", name: "janan_ig" }]);
    expect(d.tiktok).toEqual([]);
    expect(d.autopilotAccounts).toEqual(["FB:111"]);
    const stats = r.view?.[0];
    if (stats?.kind !== "stats") throw new Error("no stats");
    expect(stats.items.map((i) => i.value)).toEqual(["Janan Page", "janan_ig", words("en").notConnected, words("en").notConnected]);
  });

  it("reads each of the other areas with the names the settings tools use", async () => {
    setup();
    const get = async (area: string) => ((await call("get_desk_settings", { area })).data as Record<string, any>)[area];
    expect(await get("filter")).toEqual({ planAllows: "focus", mode: "PROMPT", focus: "only the budget", broad: false });
    expect(await get("autopilot")).toMatchObject({ mode: "DRAFT", postsTo: ["FB"], mayPostByItself: true, mostPostsPerDay: 20, minutesBetweenPosts: 3, quietHoursBaghdad: { from: 1, to: 8 }, accounts: ["FB:111"] });
    expect(await get("video")).toMatchObject({ monthlyVideosOnPlan: 300, madeThisMonth: 4, mode: "AUTO", style: "TEMPLATE", topics: ["politics"], mostVideosPerDay: 5, voice: "aram", speed: 1, ownVoiceSaved: false, footageClips: 1 });
    expect(await get("brand")).toMatchObject({
      colours: { primary: "#0B2545", accent: "#E0A526", text: "#FFFFFF" },
      headlineFont: "kufi",
      hasLogo: true,
      hasMainFrame: false,
      headlinePosition: "bottom",
      logoCorner: "off",
      sectionFrames: [{ section: "sports", headlinePosition: "top", note: "green", hasReference: false }],
      designPrompt: "deep blue, thin gold lines",
      writingStyleNote: "Short sentences.",
      aiPictures: true,
      aiFrameDesignAvailable: true,
    });
    const lib = await get("library");
    expect(lib).toEqual({ photos: { count: 1, items: [{ id: "ph1", label: "Erbil citadel", general: false }] }, clips: { count: 1, items: [{ id: "clip1", label: "Citadel", general: false }] } });
    // The brand answer holds no file path and no address of a file.
    expect(json(await get("brand"))).not.toContain("merchant/t1");
    expect(json(lib)).not.toContain("blob.example");
  });

  it("answers all areas in short by default, and in the person's language", async () => {
    setup();
    const r = await call("get_desk_settings");
    const d = r.data as Record<string, any>;
    expect(d.area).toBe("all");
    for (const a of ["sources", "filter", "autopilot", "video", "brand", "accounts", "library"]) expect(d[a], a).toBeDefined();
    // The long lists are counts and ids here.
    expect(d.sources.sources).toEqual(["gdelt", "k24-ckb"]);
    expect(d.library.photos).toEqual({ count: 1 });
    for (const lang of ["ckb", "ar", "en"] as const) {
      const out = await call("get_desk_settings", { area: "autopilot" }, ctx({ lang }));
      const stats = out.view?.[0];
      if (stats?.kind !== "stats") throw new Error("no stats");
      expect(stats.title, lang).toBe(newsWords(lang).areas.autopilot);
      expect(stats.items.every((i) => i.label.length > 0 && i.value.length > 0), lang).toBe(true);
    }
  });

  it("notes that the plan cannot post by itself, and a plan without videos", async () => {
    props.loadNewsProps.mockResolvedValue({ ...settingsProps(), autopilot: { ...settingsProps().autopilot, canPublish: false }, video: { ...settingsProps().video, quota: 0 } });
    db.tenant.findUnique.mockResolvedValue({ plan: "MANUAL" });
    const auto = await call("get_desk_settings", { area: "autopilot" });
    expect((auto.view as ViewBlock[]).some((b) => b.kind === "note" && b.text === dict("en").settings.news.autoPlanOnly)).toBe(true);
    const video = await call("get_desk_settings", { area: "video" });
    expect((video.view as ViewBlock[]).some((b) => b.kind === "note" && b.text === dict("en").settings.news.videoPlanOnly)).toBe(true);
    expect(((await call("get_desk_settings", { area: "sources" })).data as { sources: { sourceLimit: number } }).sources.sourceLimit).toBe(10);
  });
});

describe("get_desk_usage", () => {
  const usage = (rows: Record<string, number>) =>
    db.usage.findUnique.mockImplementation(async (a: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
      const k = a.where.tenantId_month_metric;
      return k.tenantId === "t1" && rows[k.metric] !== undefined ? { count: rows[k.metric] } : null;
    });

  it("sets the month's work and the daily AI counters against the plan, and counts the assistant chats left", async () => {
    usage({ draft: 120, improve: 3, publish: 80, video: 10, news_frame_ai: 4, news_frame_ai_day: 2, chat: 10, chat_day: 4, chat_action_day: 15, chat_post_day: 7 });
    db.newsSource.count.mockResolvedValue(7);
    const r = await call("get_desk_usage");
    const d = r.data as Record<string, any>;
    expect(d.plan).toBe("AUTO");
    expect(d.thisMonth).toEqual({
      drafts: { used: 120, limit: 3000 },
      improvements: { used: 3, limit: 300 },
      publishes: { used: 80, limit: 3000 },
      videos: { used: 10, limit: 300 },
    });
    expect(d.sources).toEqual({ on: 7, limit: 30 });
    expect(d.mayPublishAutomatically).toBe(true);
    expect(d.newsByPrompt).toBe("focus");
    expect(d.aiFrames).toEqual({ todayLeft: 4, monthLeft: 16 });
    expect(d.newsPromptChanges).toEqual({ todayLeft: 6, monthLeft: 60 });
    // AUTO: 600 a month and 120 a day.
    expect(d.assistantChatsLeft).toEqual({ day: 116, month: 590 });
    // A desk may confirm 120 changes and 60 posts a day from the chat.
    expect(d.assistantMayStillToday).toEqual({ changes: 105, posts: 53 });
    for (const c of db.usage.findUnique.mock.calls) expect(c[0].where.tenantId_month_metric.tenantId).toBe("t1");
    expect(db.newsSource.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", enabled: true });
  });

  it("gives a frozen desk no assistant chats, and says so with the plan", async () => {
    db.tenant.findUnique.mockResolvedValue(tenantRow({ planPaidUntil: null, trialEndsAt: new Date(NOW.getTime() - DAY) }));
    const r = await call("get_desk_usage");
    const d = r.data as Record<string, any>;
    expect(d.access).toMatchObject({ mayWrite: false, status: "frozen" });
    expect(d.assistantChatsLeft).toEqual({ day: 0, month: 0 });
  });

  it("shows the person the same numbers in their language", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await call("get_desk_usage", {}, ctx({ lang }));
      const stats = r.view?.[0];
      if (stats?.kind !== "stats") throw new Error("no stats");
      expect(stats.items.map((i) => i.label), lang).toContain(dict(lang).billing.features.label.drafts);
      expect(stats.href).toBe("/newsroom/billing");
    }
  });
});

describe("the shared reads on a desk", () => {
  const comment = {
    platform: "FB" as const,
    id: "c1",
    postId: "p1",
    author: "Visitor One",
    text: `Great, call me ${PHONE}`,
    createdAt: new Date(NOW.getTime() - 600_000).toISOString(),
    hidden: false,
    fromUs: false,
    replies: [],
  };
  const conv = (over: Record<string, unknown> = {}) => ({
    platform: "FB",
    id: "conv1",
    participantId: "psid1",
    participantName: "",
    withinWindow: false,
    updatedAt: "2026-10-19T06:00:00+0000",
    messages: [
      { id: "m1", text: "Hello from the desk", fromUs: true, createdAt: "2026-10-19T05:00:00+0000" },
      { id: "m2", text: `my number is ${PHONE}, is this true?`, fromUs: false, createdAt: "2026-10-19T06:00:00+0000" },
    ],
    ...over,
  });
  const facebook = () =>
    data.loadConnections.mockResolvedValue({ ...notConnected, META_FACEBOOK: { connected: true, name: "Janan Page", accountId: "111" } });

  it("lists the comments of a desk with the way to the desk's own Comments screen, and the same ids", async () => {
    facebook();
    data.loadPosts.mockResolvedValue({ posts: [{ platform: "FB", id: "p1", caption: "Post", commentCount: 1, comments: [comment] }], errors: [] });
    const r = await call("list_comments");
    const d = r.data as { comments: { id: string; platform: string; text: string }[] };
    expect(d.comments).toEqual([expect.objectContaining({ id: "c1", platform: "FB" })]);
    expect(d.comments[0].text).toContain("[number]");
    const list = r.view?.find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.href).toBe("/newsroom/comments");
    expect(json(r.view)).not.toContain('"/app');
    expect(data.loadPosts.mock.calls[0][0]).toBe("t1");
    // The shop's own link is unchanged.
    const shop = await call("list_comments", {}, ctx({ kind: "shop" }));
    expect(shop.view?.find((b) => b.kind === "list")).toMatchObject({ href: "/app/comments" });
  });

  it("names the desk's sections, not the shop's, when a platform has several Pages", async () => {
    facebook();
    data.loadAccountLists.mockResolvedValue({ ...noLists, META_FACEBOOK: [{ id: "111", name: "Janan Page", avatarUrl: null }, { id: "112", name: "Other", avatarUrl: null }] });
    data.loadPosts.mockResolvedValue({ posts: [], errors: [] });
    const r = await call("list_comments", {}, ctx({ lang: "ckb" }));
    const note = r.view?.[0];
    if (note?.kind !== "note") throw new Error("no note");
    expect(note.text).toContain(dict("ckb").nr.shell.nav.items.comments);
  });

  it("calls the two sides of a chat the desk and the visitor, and reads only this desk's conversations", async () => {
    facebook();
    data.loadConversations.mockResolvedValue({ conversations: [conv()], unreadable: 0, errors: [] });
    const list = await call("list_conversations");
    const l = list.data as { conversations: { id: string; platform: string; lastFrom: string; last: string }[] };
    expect(l.conversations[0]).toMatchObject({ id: "conv1", platform: "FB", lastFrom: "visitor" });
    expect(l.conversations[0].last).toContain("[number]");
    expect(json(list.data)).not.toContain("psid1");
    const view = list.view?.find((b) => b.kind === "list");
    if (view?.kind !== "list") throw new Error("no list");
    expect(view.href).toBe("/newsroom/messages");
    expect(view.items[0].title).toBe(dict("en").messages.viewer);
    expect(data.loadConversations.mock.calls[0][0]).toBe("t1");

    const one = await call("get_conversation", { id: "conv1" });
    const o = one.data as { id: string; messages: { from: string }[] };
    expect(o.id).toBe("conv1");
    expect(o.messages.map((m) => m.from)).toEqual(["desk", "visitor"]);
    const conversation = one.view?.find((b) => b.kind === "list");
    if (conversation?.kind !== "list") throw new Error("no list");
    expect(conversation.href).toBe("/newsroom/messages");
    expect(conversation.items[1].sub).toContain(dict("en").messages.viewer);
    expect((one.view as ViewBlock[]).some((b) => b.kind === "note" && b.text === dict("en").messages.windowClosed(dict("en").messages.viewer))).toBe(true);
    await expect(call("get_conversation", { id: "conv-of-another-desk" })).rejects.toBeInstanceOf(ToolRefusal);
    // The shop's two sides are unchanged.
    const shop = await call("get_conversation", { id: "conv1" }, ctx({ kind: "shop" }));
    expect((shop.data as { messages: { from: string }[] }).messages.map((m) => m.from)).toEqual(["shop", "buyer"]);
  });

  it("lists the scheduled posts of the desk and links to its Publish screen", async () => {
    db.scheduledPost.findMany.mockResolvedValue([{ id: "sp1", runAt: new Date(NOW.getTime() + DAY), input: { caption: "Story caption", targets: ["FB"], media: { url: "x" } }, status: "PENDING", lastError: null }]);
    const r = await call("list_scheduled_posts");
    expect(db.scheduledPost.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect((r.data as { posts: { id: string }[] }).posts[0].id).toBe("sp1");
    const list = r.view?.[0];
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.href).toBe("/newsroom/publish");
    const shop = await call("list_scheduled_posts", {}, ctx({ kind: "shop" }));
    expect(shop.view?.[0]).toMatchObject({ href: "/app/publish" });
  });
});

describe("tenant isolation", () => {
  it("scopes every query of every desk tool by the desk of the session", async () => {
    facebookAndEverything();
    for (const name of NEWS_NAMES) {
      const args = name === "get_story" ? { story: "n1" } : {};
      await call(name, args).catch((e) => {
        if (!(e instanceof ToolRefusal)) throw e;
      });
    }
    await call("list_comments");
    await call("list_conversations");
    await call("list_scheduled_posts");

    /** The desk a query asked for, however its model spells the scope. */
    const scopeOf = (where: Record<string, any> | undefined): unknown => where?.tenantId ?? where?.tenantId_month_metric?.tenantId ?? where?.id ?? where?.store?.tenantId;
    let seen = 0;
    for (const [model, methods] of Object.entries(db)) {
      for (const [method, fn] of Object.entries(methods)) {
        for (const c of (fn as ReturnType<typeof vi.fn>).mock.calls) {
          seen++;
          const scope = scopeOf(c[0]?.where);
          expect(scope, `${model}.${method} ${json(c[0]?.where)}`).toBe("t1");
        }
      }
    }
    expect(seen).toBeGreaterThan(25);
    // The live loaders get the desk's id first.
    for (const fn of Object.values(data)) for (const c of fn.mock.calls) expect(c[0], json(c)).toBe("t1");
  });

  it("never links a desk's view to the shop's side of the site", async () => {
    facebookAndEverything();
    for (const name of [...NEWS_NAMES, "list_comments", "list_conversations", "list_scheduled_posts"]) {
      const out = await call(name, name === "get_story" ? { story: "n1" } : {}).catch(() => null);
      if (out) expect(json(out.view), name).not.toMatch(/"(href)":"\/app/);
    }
  });

  function facebookAndEverything() {
    data.loadConnections.mockResolvedValue({ ...notConnected, META_FACEBOOK: { connected: true, name: "Page", accountId: "111" } });
    data.loadPosts.mockResolvedValue({ posts: [], errors: [] });
    data.loadConversations.mockResolvedValue({ conversations: [], unreadable: 0, errors: [] });
    data.loadInsights.mockResolvedValue({ fbFollowers: 1, fbMetrics: [], igMetrics: [], waTaps7d: 0, notes: [] });
    data.loadYouTube.mockResolvedValue(null);
    props.loadNewsProps.mockResolvedValue({
      keywords: [],
      catalog: [],
      categories: [],
      keywordFilter: false,
      sourceImages: false,
      aiPictures: false,
      photoCardsOnly: false,
      filter: { level: "none", mode: "KEYWORDS", focus: "", exclude: "", broad: false },
      video: { quota: 0, used: 0, full: false, mode: "OFF", style: "TEMPLATE", clips: [], topics: [], dailyMax: 5, voice: "male", speed: 1, prompt: "", clone: { saved: false, text: "", seconds: 0 } },
      voiceNote: "",
      autopilot: { mode: "OFF", targets: [], dailyMax: 20, minGapMin: 3, quietFrom: null, quietTo: null, canPublish: false, refreshSec: 120, connected: { FB: true, IG: false }, accountLists: { FB: [], IG: [] }, accounts: [] },
      feeds: [],
      kit: { logoPath: null, primary: "#000000", accent: "#111111", text: "#ffffff", headingFont: "kufi", framePath: null, frameText: "bottom", logoCorner: "off" },
      photos: [],
      sectionFrames: [],
      designPrompt: "",
      aiFrames: false,
    });
    db.newsItem.findFirst.mockResolvedValue(item({ status: "DRAFTED", draft: draft() }));
    db.newsItem.findMany.mockResolvedValue([item()]);
    db.newsItem.count.mockResolvedValue(1);
    db.newsVideo.findMany.mockResolvedValue([{ id: "v1", itemId: "n1", draftId: "d1", status: "QUEUED", autoPost: true, videoUrl: null, createdAt: NOW }]);
    db.newsDraft.findMany.mockResolvedValue([{ id: "d1", headline: "H", results: null }]);
    db.newsDraft.count.mockResolvedValue(1);
  }
});
