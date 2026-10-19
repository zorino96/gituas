import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The news desk's write tools. The database, Meta and the desk's server actions are replaced; what is tested is the part that is ours:
// risk and permission of every tool, the desk and frozen checks, that a call which sets one field leaves the others as they were, the
// plan gates, that a run calls the right action with the right values, and that nothing exists for payments, team or accounts.

const world = vi.hoisted(() => ({
  ws: { id: "t1", name: "Janan", kind: "NEWS" } as { id: string; name: string; kind: string } | null,
  frozen: false,
  plan: "AUTO",
  used: {} as Record<string, number>,
  pages: { FB: [{ id: "111", name: "Page A", avatarUrl: null }], IG: [{ id: "222", name: "Insta A", avatarUrl: null }] } as Record<"FB" | "IG", { id: string; name: string; avatarUrl: null }[]>,
  slotDay: 0,
  imageOn: true,
  aiPictureOn: true,
  clone: null as unknown,
}));
const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  newsItem: { findFirst: vi.fn(), findMany: vi.fn() },
  newsSource: { count: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  newsSettings: { findUnique: vi.fn() },
  brandKit: { findUnique: vi.fn() },
  newsFrame: { findUnique: vi.fn() },
  newsPhoto: { count: vi.fn() },
  scheduledPost: { findFirst: vi.fn(), findMany: vi.fn() },
  igPending: { findFirst: vi.fn() },
}));
const actions = vi.hoisted(() => ({
  refreshNewsAction: vi.fn(),
  draftNewsAction: vi.fn(),
  saveNewsDraftAction: vi.fn(),
  dismissNewsAction: vi.fn(),
  makeVideoAction: vi.fn(),
  saveKeywordsAction: vi.fn(),
  toggleCatalogSourceAction: vi.fn(),
  addRssSourceAction: vi.fn(),
  removeSourceAction: vi.fn(),
  saveBrandKitAction: vi.fn(),
  saveAutopilotAction: vi.fn(),
  saveCategoriesAction: vi.fn(),
  setKeywordFilterAction: vi.fn(),
  setSourceImagesAction: vi.fn(),
  setPhotoCardsOnlyAction: vi.fn(),
  setAiPicturesAction: vi.fn(),
  saveVideoSettingsAction: vi.fn(),
  saveNewsFilterAction: vi.fn(),
  saveVoiceNoteAction: vi.fn(),
  addNewsPhotoAction: vi.fn(),
  designSectionFrameAction: vi.fn(),
  saveDesignPromptAction: vi.fn(),
  saveSectionFrameTextAction: vi.fn(),
  removeSectionFrameAction: vi.fn(),
}));
const shared = vi.hoisted(() => ({
  publishAction: vi.fn(),
  replyToCommentAction: vi.fn(),
  setCommentHiddenAction: vi.fn(),
  sendMessageAction: vi.fn(),
  schedulePublishAction: vi.fn(),
  cancelScheduledAction: vi.fn(),
  renderAndStoreCard: vi.fn(),
  claimSlot: vi.fn(),
  refundSlot: vi.fn(),
  loadPosts: vi.fn(),
  loadConversations: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  currentWorkspace: vi.fn(async () => world.ws),
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: world.pages.FB, META_INSTAGRAM: world.pages.IG, TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({
    META_FACEBOOK: world.pages.FB.length ? { connected: true, accountId: world.pages.FB[0].id, name: world.pages.FB[0].name } : { connected: false },
    META_INSTAGRAM: world.pages.IG.length ? { connected: true, accountId: world.pages.IG[0].id, name: world.pages.IG[0].name } : { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  })),
  loadPosts: shared.loadPosts,
  loadConversations: shared.loadConversations,
}));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (lang: string) => (lang === "ar" ? ar : lang === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/billing/limits", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/limits")>()),
  newsroomFrozenError: vi.fn(async () => (world.frozen ? "frozen" : null)),
  usageOf: vi.fn(async (_t: string, metric: string) => world.used[metric] ?? 0),
}));
vi.mock("@/lib/ai/slots", () => ({
  claimSlot: shared.claimSlot,
  refundSlot: shared.refundSlot,
  slotsUsed: vi.fn(async () => ({ month: 0, day: world.slotDay })),
  takeDaily: vi.fn(async () => 1),
  baghdadDay: () => "2026-10-19",
}));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => world.imageOn) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/lib/news/ai-picture", () => ({ aiPictureEnabled: vi.fn(() => world.aiPictureOn) }));
vi.mock("@/lib/voice/clone", () => ({ loadVoiceClone: vi.fn(async () => world.clone) }));
vi.mock("@/lib/cards/server-render", () => ({ renderAndStoreCard: shared.renderAndStoreCard }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/app/newsroom/(desk)/news/actions", () => actions);
vi.mock("@/app/app/actions", () => ({
  publishAction: shared.publishAction,
  saveWhatsAppAction: vi.fn(),
  replyToCommentAction: shared.replyToCommentAction,
  setCommentHiddenAction: shared.setCommentHiddenAction,
  sendMessageAction: shared.sendMessageAction,
}));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: shared.schedulePublishAction, cancelScheduledAction: shared.cancelScheduledAction }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/app/orders/actions", () => ({ setOrderStatusAction: vi.fn() }));

import { decide } from "@/lib/chat/guard";
import { cleanOutbound, ownerCorpus } from "@/lib/chat/guard";
import { indexTools, riskOf, toolSpecs, toolsFor } from "@/lib/chat/registry";
import { WRITE_TOOLS } from "@/lib/chat/tools/writes";
import { NEW_WRITE_TOOLS } from "@/lib/chat/tools/writes-new";
import { NEWS_WRITE_TOOLS } from "@/lib/chat/tools/writes-news";
import { igBudgetMs } from "@/lib/chat/tools/writes-news-story";
import { NW } from "@/lib/chat/tools/writes-news-words";
import { ToolRefusal, type Card, type ToolCtx, type WriteResult, type WriteTool } from "@/lib/chat/types";

const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/1.jpg";
const img = { id: "a1", url: OWN, pathname: "merchant/t1/chat/1.jpg", kind: "image" as const, name: "erbil.jpg" };
const gif = { id: "a2", url: OWN.replace(".jpg", ".gif"), pathname: "merchant/t1/chat/2.gif", kind: "image" as const, name: "x.gif" };
const vid = { id: "a3", url: OWN.replace("1.jpg", "3.mp4"), pathname: "merchant/t1/chat/3.mp4", kind: "video" as const, name: "clip.mp4" };
const avi = { id: "a4", url: OWN.replace("1.jpg", "4.avi"), pathname: "merchant/t1/chat/4.avi", kind: "video" as const, name: "clip.avi" };

const ctxOf = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "news",
  lang: "en",
  threadId: "th1",
  attachments: [img, gif, vid, avi],
  review: true,
  deadline: Date.now() + 60_000,
  ...over,
});

/** Every tool the desk is offered: its own and the four it shares with the shop. */
const ALL: WriteTool[] = [...NEWS_WRITE_TOOLS, ...NEW_WRITE_TOOLS.filter((t) => t.kinds.includes("news"))];
const tool = (name: string): WriteTool => {
  const t = ALL.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
/** What the loop does: parse with the tool's own schema, then ask for the card. */
const parse = (name: string, args: unknown) => tool(name).schema.parse(args);
const cardOf = (name: string, args: unknown, ctx = ctxOf()): Promise<Card> => tool(name).card(ctx, parse(name, args));
const run = (name: string, args: unknown, ctx = ctxOf()): Promise<WriteResult> => tool(name).execute(ctx, parse(name, args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};
const lineOf = (card: Card, label: string) => card.lines.find((l) => l.label === label)?.value;
const values = (card: Card) => card.lines.map((l) => l.value).join(" | ");

// ---------------------------------------------------------------------------------------------------------------------
// The desk's data

const draftOf = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  itemId: "s1",
  tenantId: "t1",
  headline: "Council agrees the new yearly budget",
  body: "Ministers met on Tuesday and agreed spending plans for every province, including schools and roads.",
  category: "سیاسەت",
  cardKind: "STAT",
  stat: "12%",
  quote: "A fair budget for all",
  speaker: "The minister",
  photoPath: "merchant/t1/photo-erbil.jpg",
  cardUrl: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-1.jpg",
  cardPath: "merchant/t1/news-card-1.jpg",
  results: null,
  publishedAt: null,
  model: "fast",
  ...over,
});
const itemOf = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  tenantId: "t1",
  title: "Parliament passes annual spending law after long debate",
  snippet: "Lawmakers voted late on Monday to approve the state spending law, officials said.",
  sourceName: "BBC",
  status: "DRAFTED",
  draft: draftOf(),
  ...over,
});
const settingsOf = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1",
  keywords: ["erbil", "economy"],
  categories: ["politics", "sports/football"],
  keywordFilter: false,
  sourceImages: false,
  photoCardsOnly: false,
  aiPictures: false,
  autoMode: "DRAFT",
  autoTargets: ["FB"],
  autoAccounts: ["FB:111"],
  autoDailyMax: 15,
  autoMinGapMin: 5,
  autoQuietFrom: 1,
  autoQuietTo: 8,
  voiceNote: "Short sentences.",
  designPrompt: "Deep blue",
  filterMode: "PROMPT",
  focusPrompt: "Kurdistan economy",
  excludePrompt: "celebrity news",
  focusBroad: true,
  videoMode: "AUTO",
  videoStyle: "HIGHLIGHT",
  videoTopics: ["politics"],
  videoDailyMax: 7,
  videoVoice: "aram",
  videoSpeed: 1.1,
  videoPrompt: "Only big news",
  ...over,
});
const kitOf = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1",
  logoPath: "merchant/t1/logo.png",
  primary: "#0B2545",
  accent: "#E0A526",
  text: "#FFFFFF",
  headingFont: "kufi",
  framePath: "merchant/t1/frame.png",
  frameText: "top",
  logoCorner: "right",
  ...over,
});

const ok = { ok: true as const };

/** A Baghdad wall-clock time a few days from now, as "YYYY-MM-DDTHH:mm" (the format schedule_story takes). */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 16);
const LATER = inDays(3);

beforeEach(() => {
  vi.clearAllMocks();
  world.ws = { id: "t1", name: "Janan", kind: "NEWS" };
  world.frozen = false;
  world.plan = "AUTO";
  world.used = {};
  world.pages = { FB: [{ id: "111", name: "Page A", avatarUrl: null }], IG: [{ id: "222", name: "Insta A", avatarUrl: null }] };
  world.slotDay = 0;
  world.imageOn = true;
  world.aiPictureOn = true;
  world.clone = null;
  db.tenant.findUnique.mockImplementation(async () => ({ plan: world.plan }));
  db.newsItem.findFirst.mockResolvedValue(itemOf());
  db.newsItem.findMany.mockResolvedValue([]);
  db.newsSource.count.mockResolvedValue(3);
  db.newsSource.findUnique.mockResolvedValue(null);
  db.newsSource.findFirst.mockResolvedValue(null);
  db.newsSettings.findUnique.mockResolvedValue(settingsOf());
  db.brandKit.findUnique.mockResolvedValue(kitOf());
  db.newsFrame.findUnique.mockResolvedValue(null);
  db.newsPhoto.count.mockResolvedValue(4);
  db.scheduledPost.findFirst.mockResolvedValue({ runAt: new Date("2026-10-20T16:30:00Z"), input: { caption: "Weekend", targets: ["FB"] } });
  db.scheduledPost.findMany.mockResolvedValue([]);
  db.igPending.findFirst.mockResolvedValue(null);
  shared.claimSlot.mockResolvedValue({ ok: true, month: "2026-10", day: "2026-10-19" });
  shared.refundSlot.mockResolvedValue(undefined);
  shared.loadPosts.mockResolvedValue({ posts: [{ platform: "FB", id: "post1", caption: "", commentCount: 1, comments: [{ platform: "FB", id: "c1", postId: "post1", author: "Ali", text: "Is this true?", hidden: false, fromUs: false, replies: [] }] }], errors: [] });
  shared.loadConversations.mockResolvedValue({
    conversations: [{ platform: "FB", id: "conv1", participantId: "psid1", participantName: "Dana", withinWindow: true, messages: [{ id: "m1", text: "Can I send a tip?", fromUs: false }] }],
    unreadable: 0,
    errors: [],
  });
  for (const f of Object.values(actions)) f.mockResolvedValue(ok);
});

// ---------------------------------------------------------------------------------------------------------------------

const NEWS_NAMES = [
  "refresh_news",
  "draft_story",
  "improve_story",
  "edit_draft",
  "make_story_card",
  "publish_story",
  "schedule_story",
  "dismiss_stories",
  "make_story_video",
  "set_news_autopilot",
  "set_news_filter",
  "set_news_keywords",
  "set_news_categories",
  "set_news_options",
  "toggle_news_source",
  "add_news_feed",
  "remove_news_feed",
  "set_news_video_settings",
  "set_voice_note",
  "set_brand_look",
  "add_library_photo",
  "design_section_frame",
  "set_design_prompt",
  "set_frame_text",
  "remove_section_frame",
];
const SHARED_NAMES = ["hide_comment", "reply_to_comment", "send_message", "cancel_scheduled_post"];

/** Arguments that fit each tool's schema and pass its card in the default world. */
const SAMPLE: Record<string, unknown> = {
  refresh_news: {},
  draft_story: { story: "s1" },
  improve_story: { story: "s1" },
  edit_draft: { story: "s1", headline: "Budget agreed by the council" },
  make_story_card: { story: "s1" },
  publish_story: { story: "s1", targets: ["FB"] },
  schedule_story: { story: "s1", targets: ["FB"], when: LATER },
  dismiss_stories: { stories: ["s1"] },
  make_story_video: { story: "s1" },
  set_news_autopilot: { dailyMax: 10 },
  set_news_filter: { focus: "Kurdistan sports" },
  set_news_keywords: { add: ["duhok"] },
  set_news_categories: { add: ["economy"] },
  set_news_options: { photoCardsOnly: true },
  toggle_news_source: { source: "bbc-ar", enabled: true },
  add_news_feed: { url: "https://example.com/rss.xml", name: "Example" },
  remove_news_feed: { id: "f1" },
  set_news_video_settings: { dailyMax: 3 },
  set_voice_note: { text: "Plain words." },
  set_brand_look: { primary: "#112233" },
  add_library_photo: { attachment: "a1", label: "Erbil citadel" },
  design_section_frame: { section: "sports" },
  set_design_prompt: { text: "Green and calm" },
  set_frame_text: { section: "sports", position: "middle" },
  remove_section_frame: { section: "sports" },
  hide_comment: { platform: "FB", comment: "c1" },
  reply_to_comment: { platform: "FB", comment: "c1", text: "Thank you for asking." },
  send_message: { platform: "FB", conversation: "conv1", text: "Please send it here." },
  cancel_scheduled_post: { post: "sp1" },
};

describe("the news write tool list", () => {
  it("has the twenty-five desk tools once each, for the newsroom only, and the four shared ones serve both", () => {
    expect(NEWS_WRITE_TOOLS.map((t) => t.name)).toEqual(NEWS_NAMES);
    expect(new Set(NEWS_WRITE_TOOLS.map((t) => t.name)).size).toBe(NEWS_NAMES.length);
    for (const t of NEWS_WRITE_TOOLS) expect(t.kinds, t.name).toEqual(["news"]);
    for (const name of SHARED_NAMES) expect(tool(name).kinds, name).toEqual(["shop", "news"]);
    expect(Object.keys(SAMPLE).sort()).toEqual([...NEWS_NAMES, ...SHARED_NAMES].sort());
  });

  it("has names that never clash with the shop's tools or the reads", () => {
    expect(() => indexTools([...WRITE_TOOLS, ...NEWS_WRITE_TOOLS])).not.toThrow();
    // a shop is offered none of the desk's own tools
    for (const name of NEWS_NAMES) expect(toolsFor(WRITE_TOOLS, "shop", "OWNER").some((t) => t.name === name)).toBe(false);
    for (const name of NEWS_NAMES) expect(toolsFor([...WRITE_TOOLS, ...NEWS_WRITE_TOOLS], "shop", "OWNER").some((t) => t.name === name)).toBe(false);
  });

  it("has no tool for payments, plans, the team, connecting accounts, tokens, voice recording or deleting a desk", () => {
    const risky = /pay|plan|billing|checkout|connect|disconnect|token|secret|password|credential|api_?key|invite|member|team|seat|clone|consent|delete|purge|desk_/i;
    for (const t of ALL) {
      expect(t.name, t.name).not.toMatch(risky);
      const props = Object.keys((toolSpecs([t])[0].function.parameters as { properties?: Record<string, unknown> }).properties ?? {});
      for (const p of props) expect(p, `${t.name}.${p}`).not.toMatch(risky);
    }
  });

  it("describes every tool for the model as an object schema with a real description", () => {
    for (const spec of toolSpecs(ALL)) {
      expect((spec.function.parameters as { type: string }).type).toBe("object");
      expect(spec.function.description.length).toBeGreaterThan(40);
    }
  });

  it("offers the desk's write tools to an owner and an admin, and none to a member", () => {
    expect(toolsFor(ALL, "news", "OWNER")).toHaveLength(NEWS_NAMES.length + SHARED_NAMES.length);
    expect(toolsFor(ALL, "news", "ADMIN")).toHaveLength(NEWS_NAMES.length + SHARED_NAMES.length);
    // a member may draft (permission "draft") but the chat itself is for owners and admins
    const member = toolsFor(ALL, "news", "MEMBER").map((t) => t.name);
    expect(member).toEqual(["refresh_news", "draft_story", "improve_story", "edit_draft", "make_story_card", "dismiss_stories"]);
  });
});

describe("permissions", () => {
  it("follow the roles of the screens the actions belong to", () => {
    const want: Record<string, string> = {
      refresh_news: "draft",
      draft_story: "draft",
      improve_story: "draft",
      edit_draft: "draft",
      make_story_card: "draft",
      dismiss_stories: "draft",
      publish_story: "publish",
      schedule_story: "publish",
      make_story_video: "publish",
      cancel_scheduled_post: "publish",
      hide_comment: "engage",
      reply_to_comment: "engage",
      send_message: "engage",
    };
    for (const t of ALL) expect(t.permission, t.name).toBe(want[t.name] ?? "configure");
  });
});

describe("risk, long and posts", () => {
  it("is fixed for the tools that do not depend on their arguments", () => {
    const fixed: Record<string, string> = {
      refresh_news: "low",
      draft_story: "money",
      improve_story: "money",
      edit_draft: "low",
      make_story_card: "low",
      publish_story: "public",
      schedule_story: "public",
      // nothing in the app brings a dismissed story back
      dismiss_stories: "destructive",
      make_story_video: "money",
      set_news_categories: "low",
      set_news_keywords: "low",
      toggle_news_source: "low",
      add_news_feed: "standing",
      remove_news_feed: "destructive",
      set_voice_note: "public",
      set_brand_look: "public",
      add_library_photo: "low",
      design_section_frame: "money",
      set_design_prompt: "low",
      set_frame_text: "low",
      remove_section_frame: "destructive",
      hide_comment: "low",
      reply_to_comment: "outbound",
      send_message: "outbound",
      cancel_scheduled_post: "destructive",
    };
    for (const [name, risk] of Object.entries(fixed)) {
      expect(tool(name).risk, name).toBe(risk);
      expect(tool(name).riskFor, name).toBeUndefined();
    }
  });

  it("is standing for an autopilot that publishes by itself or may be doing so, low when it is switched off or to drafts", () => {
    const t = tool("set_news_autopilot");
    expect(riskOf(t, { mode: "PUBLISH" })).toBe("standing");
    expect(riskOf(t, { mode: "DRAFT" })).toBe("low");
    expect(riskOf(t, { mode: "OFF" })).toBe("low");
    // no mode given: it changes an autopilot that may be publishing, so it always gets a card
    for (const args of [{ dailyMax: 100 }, { minGapMin: 1 }, { targets: ["FB", "IG"] }, { accounts: ["FB:111"] }, { quietOff: true }, { quietFrom: 1, quietTo: 8 }]) {
      expect(riskOf(t, args), JSON.stringify(args)).toBe("standing");
    }
  });

  it("is standing for a prompt filter, low when switched back to keywords", () => {
    const t = tool("set_news_filter");
    expect(riskOf(t, { mode: "PROMPT" })).toBe("standing");
    expect(riskOf(t, { focus: "x" })).toBe("standing");
    expect(riskOf(t, { mode: "KEYWORDS" })).toBe("low");
  });

  it("is standing when a picture option goes on, low otherwise", () => {
    const t = tool("set_news_options");
    expect(riskOf(t, { sourceImages: true })).toBe("standing");
    expect(riskOf(t, { aiPictures: true })).toBe("standing");
    expect(riskOf(t, { aiPictures: true, photoCardsOnly: false })).toBe("standing");
    expect(riskOf(t, { sourceImages: false })).toBe("low");
    expect(riskOf(t, { aiPictures: false, keywordFilter: true, photoCardsOnly: true })).toBe("low");
  });

  it("is standing for video settings unless the video is switched off", () => {
    const t = tool("set_news_video_settings");
    expect(riskOf(t, { mode: "AUTO" })).toBe("standing");
    expect(riskOf(t, { dailyMax: 5 })).toBe("standing");
    expect(riskOf(t, { mode: "OFF" })).toBe("low");
  });

  it("makes a destructive, standing or long tool wait for Confirm at every autonomy level", () => {
    for (const name of ["dismiss_stories", "remove_news_feed", "remove_section_frame", "add_news_feed", "reply_to_comment", "send_message"]) {
      for (const autonomy of ["ASK", "LOW", "ALL"] as const) expect(decide({ risk: tool(name).risk as never, autonomy, tainted: false }), name).toBe("confirm");
    }
    for (const name of NEWS_NAMES.filter((n) => tool(n).long)) expect(decide({ risk: tool(name).risk as never, autonomy: "ALL", tainted: false, long: true }), name).toBe("confirm");
  });

  it("marks what takes more than about 20 seconds as long, and nothing else", () => {
    const long = ALL.filter((t) => t.long).map((t) => t.name);
    expect(long.sort()).toEqual(["design_section_frame", "draft_story", "improve_story", "make_story_card", "publish_story"]);
  });

  it("counts a publish or a schedule against the day's posts, and nothing else", () => {
    expect(ALL.filter((t) => t.countsAsPost).map((t) => t.name).sort()).toEqual(["publish_story", "schedule_story"]);
  });
});

describe("figures in a reply on a desk", () => {
  it("keeps the cleaning on the replies and messages (they are outbound and always a card) and tells the model about long figures", () => {
    for (const name of ["reply_to_comment", "send_message"]) {
      expect(tool(name).textFields, name).toEqual(["text"]);
      expect(tool(name).description, name).toMatch(/ten or more digits/);
      expect(tool(name).description, name).toMatch(/1\.5 billion IQD/);
    }
  });
});

describe("no cleaning of a story's text", () => {
  it("lists textFields only on the replies, the messages and the feed address", () => {
    const withFields = ALL.filter((t) => t.textFields?.length).map((t) => `${t.name}:${t.textFields!.join(",")}`);
    expect(withFields.sort()).toEqual(["add_news_feed:url", "reply_to_comment:text", "send_message:text"]);
    for (const name of ["edit_draft", "draft_story", "publish_story", "schedule_story", "set_voice_note", "set_design_prompt", "set_news_filter", "set_news_keywords"]) {
      expect(tool(name).textFields, name).toBeUndefined();
    }
  });

  it("would otherwise destroy a story's figures, which is why edit_draft has none", () => {
    const text = "The budget is 1,500,000,000 IQD, says example.com";
    expect(cleanOutbound(text, ownerCorpus([]))).not.toContain("1,500,000,000");
    expect(tool("edit_draft").textFields).toBeUndefined();
  });

  it("keeps a feed address the person typed and strips one that came from anywhere else", () => {
    const url = "https://example.com/rss.xml";
    expect(cleanOutbound(url, ownerCorpus([`add this feed ${url}`]))).toBe(url);
    expect(cleanOutbound(url, ownerCorpus(["add a feed please"]))).toBe("");
  });
});

describe("the desk and frozen checks", () => {
  it("refuse every card of a frozen desk, and no run of one reaches an action", async () => {
    world.frozen = true;
    for (const name of [...NEWS_NAMES, ...SHARED_NAMES]) {
      const message = await refusal(cardOf(name, SAMPLE[name]));
      expect(message, name).toMatch(/can only read/);
      const result = await run(name, SAMPLE[name]);
      expect(result.ok, name).toBe(false);
      expect(result.text, name).toBe(NW.frozen.en);
    }
    for (const [name, f] of Object.entries({ ...actions, ...shared })) {
      if (name === "claimSlot" || name === "refundSlot" || name === "loadPosts" || name === "loadConversations") continue;
      expect(f, name).not.toHaveBeenCalled();
    }
  });

  it("says so in the person's language when a run finds the desk frozen", async () => {
    world.frozen = true;
    for (const lang of ["ckb", "ar", "en"] as const) expect((await run("edit_draft", SAMPLE.edit_draft, ctxOf({ lang }))).text).toBe(NW.frozen[lang]);
  });

  it("refuse a session that is on another desk than the run's, before any action", async () => {
    world.ws = { id: "t2", name: "Other", kind: "NEWS" };
    for (const name of [...NEWS_NAMES, ...SHARED_NAMES]) {
      expect(await refusal(cardOf(name, SAMPLE[name])), name).toMatch(/not the one open/);
      const result = await run(name, SAMPLE[name]);
      expect(result, name).toEqual({ ok: false, text: NW.wrongDesk.en });
    }
    world.ws = { id: "t1", name: "Shop", kind: "MERCHANT" };
    expect(await refusal(cardOf("refresh_news", {}))).toMatch(/not the one open/);
    for (const [name, f] of Object.entries(actions)) expect(f, name).not.toHaveBeenCalled();
  });

  it("does not apply to the shop's use of the four shared tools", async () => {
    world.ws = { id: "t1", name: "Shop", kind: "MERCHANT" };
    world.frozen = true;
    const shopCtx = ctxOf({ kind: "shop" });
    const card = await tool("hide_comment").card(shopCtx, parse("hide_comment", SAMPLE.hide_comment));
    expect(card.lines.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the shared engagement tools on a desk", () => {
  it("hide, reply and message through the desk's own Pages, naming the Page when there are several", async () => {
    world.pages.FB = [
      { id: "111", name: "Page A", avatarUrl: null },
      { id: "333", name: "Page B", avatarUrl: null },
    ];
    const hide = await cardOf("hide_comment", SAMPLE.hide_comment);
    expect(values(hide)).toContain("Is this true?");
    expect(lineOf(hide, "Platform")).toBe("Facebook · Page A");
    const reply = await cardOf("reply_to_comment", SAMPLE.reply_to_comment);
    expect(lineOf(reply, "Reply")).toBe("Thank you for asking.");
    const message = await cardOf("send_message", SAMPLE.send_message);
    expect(lineOf(message, "Their last message")).toBe("Can I send a tip?");
    shared.setCommentHiddenAction.mockResolvedValue(ok);
    shared.replyToCommentAction.mockResolvedValue(ok);
    shared.sendMessageAction.mockResolvedValue(ok);
    expect((await run("hide_comment", SAMPLE.hide_comment)).ok).toBe(true);
    expect(shared.setCommentHiddenAction).toHaveBeenCalledWith("FB", "c1", true, "111");
    expect((await run("reply_to_comment", SAMPLE.reply_to_comment)).ok).toBe(true);
    expect(shared.replyToCommentAction).toHaveBeenCalledWith("FB", "c1", "Thank you for asking.", "111");
    expect((await run("send_message", SAMPLE.send_message)).ok).toBe(true);
    expect(shared.sendMessageAction).toHaveBeenCalledWith("FB", "psid1", "Please send it here.", "111");
  });

  it("word a desk's already-answered comment without the shop", async () => {
    shared.loadPosts.mockResolvedValue({
      posts: [{ platform: "FB", id: "post1", caption: "", commentCount: 1, comments: [{ platform: "FB", id: "c1", postId: "post1", author: "Ali", text: "Is this true?", hidden: false, fromUs: false, replies: [{ id: "r1", fromUs: true, text: "yes" }] }] }],
      errors: [],
    });
    const card = await cardOf("reply_to_comment", SAMPLE.reply_to_comment);
    expect(lineOf(card, "Note")).toBe(NW.alreadyReplied.en);
    expect(lineOf(card, "Note")).not.toMatch(/shop/i);
  });

  it("cancels a scheduled story through the same action", async () => {
    shared.cancelScheduledAction.mockResolvedValue(ok);
    const card = await cardOf("cancel_scheduled_post", SAMPLE.cancel_scheduled_post);
    expect(card.title).toMatch(/Cancel/);
    expect((await run("cancel_scheduled_post", SAMPLE.cancel_scheduled_post)).ok).toBe(true);
    expect(shared.cancelScheduledAction).toHaveBeenCalledWith("sp1");
    expect(db.scheduledPost.findFirst.mock.calls[0][0].where).toMatchObject({ id: "sp1", tenantId: "t1", status: "PENDING" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("fetching and drafting", () => {
  it("refreshes with a daily fence, refunds it when the refresh fails, and says which sources did not answer", async () => {
    actions.refreshNewsAction.mockResolvedValue({ ok: true, added: 4, failed: ["Rudaw", "KNN"] });
    const card = await cardOf("refresh_news", {});
    expect(lineOf(card, "Sources switched on")).toBe("3");
    const r = await run("refresh_news", {});
    expect(r.ok).toBe(true);
    expect(r.text).toContain("4 new stories added.");
    expect(r.text).toContain("Rudaw, KNN");
    expect(shared.claimSlot).toHaveBeenCalledWith("t1", { month: "news_chat_refresh", day: "news_chat_refresh_day" }, { month: 360, day: 12 });

    actions.refreshNewsAction.mockResolvedValue({ ok: false, error: "Refresh failed. Try again." });
    expect((await run("refresh_news", {})).ok).toBe(false);
    expect(shared.refundSlot).toHaveBeenCalledTimes(1);

    shared.claimSlot.mockResolvedValue({ ok: false, error: "daily" });
    actions.refreshNewsAction.mockClear();
    expect(await run("refresh_news", {})).toEqual({ ok: false, text: NW.refreshTooOften.en });
    expect(actions.refreshNewsAction).not.toHaveBeenCalled();
    world.slotDay = 12;
    expect(await refusal(cardOf("refresh_news", {}))).toMatch(/12 times/);
  });

  it("drafts with the fast writer and improves with the strong one, each from its own monthly count", async () => {
    actions.draftNewsAction.mockResolvedValue({ ok: true, draft: { headline: "A fresh headline" } });
    const draft = await cardOf("draft_story", { story: "s1" });
    expect(lineOf(draft, "Story")).toContain("Parliament passes");
    expect(lineOf(draft, "Current draft (will be replaced)")).toBe("Council agrees the new yearly budget");
    expect(lineOf(draft, "Drafts left this month")).toBe("3000 / 3000");
    const r = await run("draft_story", { story: "s1" });
    expect(r.text).toContain("A fresh headline");
    expect(actions.draftNewsAction).toHaveBeenLastCalledWith("s1", "fast");
    world.used = { improve: 4 };
    const improve = await cardOf("improve_story", { story: "s1" });
    expect(lineOf(improve, "Improvements left this month")).toBe("296 / 300");
    await run("improve_story", { story: "s1" });
    expect(actions.draftNewsAction).toHaveBeenLastCalledWith("s1", "strong");
    expect(await run("draft_story", { story: "s1" })).toMatchObject({ ok: true, data: { story: "s1" } });
  });

  it("refuses a drafting past the plan's monthly number, a dismissed story, an unknown id and an improvement with nothing to improve", async () => {
    world.plan = "MANUAL";
    world.used = { draft: 300 };
    expect(await refusal(cardOf("draft_story", { story: "s1" }))).toMatch(/limit of 300 drafts/);
    world.used = { improve: 30 };
    expect(await refusal(cardOf("improve_story", { story: "s1" }))).toMatch(/limit of 30 improvements/);
    world.used = {};
    db.newsItem.findFirst.mockResolvedValue(itemOf({ status: "DISMISSED" }));
    expect(await refusal(cardOf("draft_story", { story: "s1" }))).toMatch(/dismissed/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: null }));
    expect(await refusal(cardOf("improve_story", { story: "s1" }))).toMatch(/no draft to improve/);
    db.newsItem.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("draft_story", { story: "zz" }))).toMatch(/no story with id "zz"/);
    // the lookup is scoped by the desk
    expect(db.newsItem.findFirst.mock.calls.at(-1)![0].where).toEqual({ id: "zz", tenantId: "t1" });
  });

  it("passes on an action's own refusal in the person's language", async () => {
    actions.draftNewsAction.mockResolvedValue({ ok: false, error: "Limit reached." });
    expect(await run("draft_story", { story: "s1" })).toEqual({ ok: false, text: "Limit reached." });
  });
});

describe("edit_draft", () => {
  it("changes only what was given and saves every other field exactly as it was, the photo included", async () => {
    actions.saveNewsDraftAction.mockResolvedValue({ ok: true, draftId: "d1" });
    const r = await run("edit_draft", { story: "s1", headline: "Budget agreed by the council" });
    expect(r.ok).toBe(true);
    expect(actions.saveNewsDraftAction).toHaveBeenCalledWith("s1", {
      headline: "Budget agreed by the council",
      body: "Ministers met on Tuesday and agreed spending plans for every province, including schools and roads.",
      cardKind: "STAT",
      stat: "12%",
      quote: "A fair budget for all",
      speaker: "The minister",
      photoPath: "merchant/t1/photo-erbil.jpg",
    });
  });

  it("clears a stat with an empty string, changes the card kind, and merges with the draft as it is when the run happens", async () => {
    const card = await cardOf("edit_draft", { story: "s1", stat: "", cardKind: "BREAKING" });
    expect(lineOf(card, "Stat")).toBe("Empty (was 12%)");
    expect(lineOf(card, "Card type")).toBe("Breaking (was Stat)");
    expect(lineOf(card, "Note")).toMatch(/card is removed/);
    // the body changes while the card waits
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ body: "Ministers met on Tuesday and then voted for the plans on Wednesday morning." }) }));
    await run("edit_draft", { story: "s1", stat: "", cardKind: "BREAKING" });
    expect(actions.saveNewsDraftAction).toHaveBeenCalledWith("s1", expect.objectContaining({ body: "Ministers met on Tuesday and then voted for the plans on Wednesday morning.", stat: null, cardKind: "BREAKING", quote: "A fair budget for all" }));
  });

  it("warns, without touching the text, when a change brings in a link, an e-mail address or an @handle", async () => {
    const plain = await cardOf("edit_draft", { story: "s1", body: "A new body that says the council met and agreed to spend 1,500,000,000 IQD more on roads." });
    expect(plain.lines.some((l) => l.value === NW.contactWarning.en)).toBe(false);
    expect(lineOf(plain, "Body")).toContain("1,500,000,000 IQD");
    for (const body of ["A new body that says the council met, see www.evil.example for the roads.", "A new body that says the council met, write to tips@evil.example about roads.", "A new body that says the council met, follow @evil_handle for the roads."]) {
      const card = await cardOf("edit_draft", { story: "s1", body });
      expect(card.lines.some((l) => l.value === NW.contactWarning.en), body).toBe(true);
      expect(lineOf(card, "Body")).toBe(body);
    }
  });

  it("shows the headline and the body in full", async () => {
    const card = await cardOf("edit_draft", { story: "s1", body: "A new body that says the council met and agreed to spend more on roads next year." });
    expect(lineOf(card, "Body")).toBe("A new body that says the council met and agreed to spend more on roads next year.");
  });

  it("refuses text that breaks the desk's rules, a draft that does not exist without both texts, and a change that changes nothing", async () => {
    expect(await refusal(cardOf("edit_draft", { story: "s1", headline: "Parliament passes annual spending law after long debate" }))).toMatch(/too close/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: null }));
    expect(await refusal(cardOf("edit_draft", { story: "s1", headline: "Only a headline" }))).toMatch(/no draft yet/);
    const card = await cardOf("edit_draft", { story: "s1", headline: "A headline and", body: "A body, both written by hand about something else entirely." });
    expect(lineOf(card, "Note")).toBe(NW.newByHand.en);
    db.newsItem.findFirst.mockResolvedValue(itemOf());
    expect(await refusal(cardOf("edit_draft", { story: "s1", headline: "Council agrees the new yearly budget" }))).toMatch(/Nothing would change/);
  });

  it("limits the fields the way the desk's editor does", () => {
    const schema = tool("edit_draft").schema;
    expect(schema.safeParse({ story: "s1" }).success).toBe(false);
    expect(schema.safeParse({ story: "s1", headline: "x".repeat(121) }).success).toBe(false);
    expect(schema.safeParse({ story: "s1", body: "x".repeat(601) }).success).toBe(false);
    expect(schema.safeParse({ story: "s1", stat: "x".repeat(31) }).success).toBe(false);
    expect(schema.safeParse({ story: "s1", cardKind: "PHOTO" }).success).toBe(false);
  });
});

describe("the card", () => {
  it("shows the draft and renders the card with the renderer loaded on demand, returning it as a picture", async () => {
    shared.renderAndStoreCard.mockResolvedValue({ url: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-9.jpg", pathname: "merchant/t1/news-card-9.jpg", headline: "h", body: "b" });
    const card = await cardOf("make_story_card", { story: "s1" });
    expect(lineOf(card, "Headline")).toBe("Council agrees the new yearly budget");
    expect(lineOf(card, "Card type")).toBe("Stat");
    expect(lineOf(card, "Note")).toBe(NW.cardReplaced.en);
    const r = await run("make_story_card", { story: "s1" });
    expect(r.ok).toBe(true);
    expect(r.media).toEqual({ url: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-9.jpg", pathname: "merchant/t1/news-card-9.jpg", kind: "image", name: "story-card.jpg" });
    expect(r.data).toEqual({ story: "s1" });
    expect(shared.renderAndStoreCard).toHaveBeenCalledWith("d1", "t1", expect.stringMatching(/^https?:\/\//));
  });

  it("says in the person's language when the render failed or the draft changed meanwhile", async () => {
    shared.renderAndStoreCard.mockRejectedValue(new Error("Rendering the card took longer than 25 seconds."));
    expect(await run("make_story_card", { story: "s1" })).toEqual({ ok: false, text: NW.cardFailed.en });
    shared.renderAndStoreCard.mockRejectedValue(new Error("The draft changed while its card was being rendered."));
    expect(await run("make_story_card", { story: "s1" }, ctxOf({ lang: "ckb" }))).toEqual({ ok: false, text: NW.cardChanged.ckb });
  });

  it("refuses without a draft, and a draft that breaks the rules", async () => {
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: null }));
    expect(await refusal(cardOf("make_story_card", { story: "s1" }))).toMatch(/no draft yet/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ headline: "" }) }));
    expect(await refusal(cardOf("make_story_card", { story: "s1" }))).toMatch(/breaks the desk's rules/);
    expect(shared.renderAndStoreCard).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("publish_story", () => {
  const outcome = (over: Record<string, unknown> = {}) => ({ target: "FB", ok: true, ...over });

  it("posts the draft's headline and body with the draft's own card, and names the Page on the card", async () => {
    shared.publishAction.mockResolvedValue({ ok: true, results: [outcome({ accountName: "Page A" })] });
    const card = await cardOf("publish_story", SAMPLE.publish_story);
    expect(lineOf(card, "Facebook")).toBe("Page A");
    expect(lineOf(card, "Post text")).toBe("Council agrees the new yearly budget\n\nMinisters met on Tuesday and agreed spending plans for every province, including schools and roads.");
    expect(lineOf(card, "Publishes left this month")).toBe("3000 / 3000");
    const r = await run("publish_story", SAMPLE.publish_story);
    expect(r).toMatchObject({ ok: true });
    expect(r.text).toBe("Facebook · Page A: published");
    expect(shared.publishAction).toHaveBeenCalledWith({
      caption: "Council agrees the new yearly budget\n\nMinisters met on Tuesday and agreed spending plans for every province, including schools and roads.",
      targets: ["FB"],
      media: { url: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-1.jpg", pathname: "merchant/t1/news-card-1.jpg", type: "IMAGE" },
      newsDraftId: "d1",
    });
  });

  it("is a post that goes out at once and to the named account only", async () => {
    world.pages.FB = [
      { id: "111", name: "Page A", avatarUrl: null },
      { id: "333", name: "Page B", avatarUrl: null },
    ];
    // several Pages and none named: the model must ask
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/several Facebook accounts.*FB:111 \(Page A\), FB:333 \(Page B\)/);
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["FB:999"] }))).toMatch(/not a connected Facebook account/);
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["IG:222"] }))).toMatch(/not among the platforms chosen/);
    shared.publishAction.mockResolvedValue({ ok: true, results: [outcome({ accountId: "333", accountName: "Page B" })] });
    const card = await cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["333"] });
    expect(lineOf(card, "Facebook")).toBe("Page B");
    await run("publish_story", { story: "s1", targets: ["FB"], accounts: ["333"] });
    expect(shared.publishAction.mock.calls[0][0].accounts).toEqual({ FB: ["333"] });
  });

  it("reports each platform on its own: a partial success is a post, a processing Instagram is not a failure, all failed is a failure", async () => {
    shared.publishAction.mockResolvedValue({ ok: true, results: [outcome(), { target: "IG", ok: false, error: "Token expired" }] });
    const partial = await run("publish_story", { story: "s1", targets: ["FB", "IG"] });
    expect(partial.ok).toBe(true);
    expect(partial.text).toBe("Facebook: published\nInstagram: failed: Token expired");
    shared.publishAction.mockResolvedValue({ ok: true, results: [{ target: "IG", ok: false, pending: true, error: "processing" }] });
    expect((await run("publish_story", { story: "s1", targets: ["IG"] })).ok).toBe(true);
    shared.publishAction.mockResolvedValue({ ok: true, results: [{ target: "IG", ok: false, error: "No" }] });
    expect((await run("publish_story", { story: "s1", targets: ["IG"] })).ok).toBe(false);
    shared.publishAction.mockResolvedValue({ ok: false, error: "Your plan has ended." });
    expect(await run("publish_story", SAMPLE.publish_story)).toEqual({ ok: false, text: "Your plan has ended." });
  });

  it("refuses a story with no card, a card that is not a JPEG for Instagram, and a draft that breaks the rules", async () => {
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ cardUrl: null, cardPath: null }) }));
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/make_story_card/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ cardPath: "merchant/t1/news-card-1.png", cardUrl: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-1.png" }) }));
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["IG"] }))).toMatch(/JPEG/);
    expect((await cardOf("publish_story", { story: "s1", targets: ["FB"] })).lines.length).toBeGreaterThan(2);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ cardPath: "merchant/other/news-card-1.jpg" }) }));
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/make_story_card/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ body: "Lawmakers voted late on Monday to approve the state spending law, officials said." }) }));
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/breaks the desk's rules/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: null }));
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/no draft yet/);
    expect(shared.publishAction).not.toHaveBeenCalled();
  });

  it("refuses an account that is not connected, a plan whose published stories are used up, and a place the story already went to", async () => {
    world.pages.IG = [];
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["IG"] }))).toMatch(/Instagram is not connected/);
    world.pages.IG = [{ id: "222", name: "Insta A", avatarUrl: null }];
    world.plan = "LITE";
    world.used = { publish: 100 };
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/limit of 100 published stories/);
    world.plan = "AUTO";
    world.used = {};
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ results: [{ target: "FB", ok: true }, { target: "IG", ok: false, error: "x" }] }) }));
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/already published to Facebook/);
    // a failed Instagram attempt may be tried again
    expect((await cardOf("publish_story", { story: "s1", targets: ["IG"] })).title).toBe("Publish a story");
    // but not one that Instagram is still processing (the parked post would be doubled)
    db.igPending.findFirst.mockResolvedValue({ id: "ig1" });
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["IG"] }))).toMatch(/still being processed/);
    db.igPending.findFirst.mockResolvedValue(null);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ results: [{ target: "IG", ok: false, pending: true }] }) }));
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["IG"] }))).toMatch(/already published to Instagram/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ results: [{ target: "FB", ok: true }, { target: "IG", ok: false, error: "x" }] }) }));
    // and what the card refused, the run refuses too (the story went out while the card waited)
    db.newsItem.findFirst.mockResolvedValue(itemOf());
    const card = await cardOf("publish_story", SAMPLE.publish_story);
    expect(card.lines.length).toBeGreaterThan(2);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ results: [{ target: "FB", ok: true }] }) }));
    expect(await run("publish_story", SAMPLE.publish_story)).toEqual({ ok: false, text: NW.stale.en });
    expect(shared.publishAction).not.toHaveBeenCalled();
  });
});

describe("schedule_story", () => {
  it("schedules the same post for a Baghdad time and gives the scheduled post's id back", async () => {
    shared.schedulePublishAction.mockResolvedValue({ ok: true, id: "sp9", runAt: "2030-10-25T07:00:00.000Z" });
    const card = await cardOf("schedule_story", SAMPLE.schedule_story);
    expect(lineOf(card, "Time")).toBe(`${LATER.replace("T", " ")} (Baghdad time)`);
    const r = await run("schedule_story", SAMPLE.schedule_story);
    expect(r).toMatchObject({ ok: true, data: { story: "s1", scheduledPost: "sp9" } });
    expect(r.text).toBe(`Scheduled for ${LATER.replace("T", " ")} (Baghdad time).`);
    expect(shared.schedulePublishAction).toHaveBeenCalledWith(expect.objectContaining({ targets: ["FB"], newsDraftId: "d1", media: expect.objectContaining({ type: "IMAGE" }) }), LATER);
  });

  it("refuses a time that is too soon or too far, a story already waiting for its time, and one already published there", async () => {
    expect(await refusal(cardOf("schedule_story", { story: "s1", targets: ["FB"], when: "2020-01-01T10:00" }))).toMatch(/Baghdad time/);
    expect(await refusal(cardOf("schedule_story", { story: "s1", targets: ["FB"], when: "2090-01-01T10:00" }))).toMatch(/Baghdad time/);
    db.scheduledPost.findMany.mockResolvedValue([{ id: "sp3", runAt: new Date("2026-10-20T06:00:00Z"), status: "PENDING", input: { newsDraftId: "d1", targets: ["FB"] } }]);
    expect(await refusal(cardOf("schedule_story", SAMPLE.schedule_story))).toMatch(/already scheduled for Facebook \(scheduled post sp3, 2026-10-20 09:00 Baghdad time\)/);
    db.scheduledPost.findMany.mockResolvedValue([]);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ results: [{ target: "FB", ok: true }] }) }));
    expect(await refusal(cardOf("schedule_story", SAMPLE.schedule_story))).toMatch(/already published/);
    expect(shared.schedulePublishAction).not.toHaveBeenCalled();
  });

  it("only takes a Baghdad time in the right shape", () => {
    const s = tool("schedule_story").schema;
    expect(s.safeParse({ story: "s1", targets: ["FB"], when: "tomorrow" }).success).toBe(false);
    expect(s.safeParse({ story: "s1", targets: ["TT"], when: "2030-10-25T10:00" }).success).toBe(false);
    expect(s.safeParse({ story: "s1", targets: [], when: "2030-10-25T10:00" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A story and its scheduled posts

/** A scheduled post as the database returns it for a story. */
const waitingRow = (over: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
  id: "sp7",
  runAt: new Date("2026-10-20T06:00:00Z"),
  status: "PENDING",
  input: { caption: "x", targets: ["FB"], media: { url: "https://abc.public.blob.vercel-storage.com/merchant/t1/news-card-1.jpg", pathname: "merchant/t1/news-card-1.jpg", type: "IMAGE" }, newsDraftId: "d1", ...input },
  ...over,
});

describe("publish_story and a scheduled post of the same story", () => {
  const outcome = { target: "FB", ok: true };

  it("is refused when the story is waiting for its time at the same place, and names the scheduled post and its time", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow()]);
    const why = await refusal(cardOf("publish_story", SAMPLE.publish_story));
    expect(why).toMatch(/already scheduled for Facebook \(scheduled post sp7, 2026-10-20 09:00 Baghdad time\)/);
    expect(why).toMatch(/cancel_scheduled_post/);
    // the run refuses too: a post may have been scheduled while the card waited for Confirm
    expect(await run("publish_story", SAMPLE.publish_story)).toEqual({ ok: false, text: NW.stale.en });
    expect(shared.publishAction).not.toHaveBeenCalled();
  });

  it("asks the database for this draft's pending and running rows only, with no cap on the rows", async () => {
    await cardOf("publish_story", SAMPLE.publish_story);
    const q = db.scheduledPost.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ tenantId: "t1", status: { in: ["PENDING", "RUNNING"] }, input: { path: ["newsDraftId"], equals: "d1" } });
    expect(q.take).toBeUndefined();
  });

  it("ignores a row of another story, whatever the database returned", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({ id: "sp8" }, { newsDraftId: "d2" })]);
    expect((await cardOf("publish_story", SAMPLE.publish_story)).title).toBe("Publish a story");
  });

  it("tells a post being made by the scheduler right now from one that is waiting", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({ status: "RUNNING" })]);
    expect(await refusal(cardOf("publish_story", SAMPLE.publish_story))).toMatch(/being posted to Facebook by the scheduler right now/);
  });

  it("lets the story go to another platform, or to another Page, than the scheduled post", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow()]);
    expect((await cardOf("publish_story", { story: "s1", targets: ["IG"] })).title).toBe("Publish a story");
    world.pages.FB = [
      { id: "111", name: "Page A", avatarUrl: null },
      { id: "333", name: "Page B", avatarUrl: null },
    ];
    // the autopilot's later-Page row names its Page; the other Page is free, the same Page is not
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({}, { accounts: { FB: ["333"] }, stagger: true })]);
    expect((await cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["111"] })).title).toBe("Publish a story");
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["333"] }))).toMatch(/already scheduled for Facebook/);
    // a row that names no Page goes to the default one, which may be either
    db.scheduledPost.findMany.mockResolvedValue([waitingRow()]);
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["FB"], accounts: ["333"] }))).toMatch(/already scheduled for Facebook/);
  });

  it("reads a row that does not say where it goes as going everywhere", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({}, { targets: undefined })]);
    expect(await refusal(cardOf("publish_story", { story: "s1", targets: ["IG"] }))).toMatch(/already scheduled for Instagram/);
  });

  it("gives Instagram a bounded wait inside the Confirm request, so a slow Instagram is parked instead of outliving it", async () => {
    shared.publishAction.mockResolvedValue({ ok: true, results: [outcome, { target: "IG", ok: false, pending: true, error: "processing" }] });
    const ctx = ctxOf({ deadline: Date.now() + 57_000 });
    await tool("publish_story").execute(ctx, parse("publish_story", { story: "s1", targets: ["FB", "IG"] }));
    const sent = shared.publishAction.mock.calls[0][0];
    expect(sent.igDeadlineMs).toBeGreaterThanOrEqual(15_000);
    expect(sent.igDeadlineMs).toBeLessThanOrEqual(30_000);
    // Facebook alone has no Instagram part to bound
    await tool("publish_story").execute(ctx, parse("publish_story", { story: "s1", targets: ["FB"] }));
    expect("igDeadlineMs" in shared.publishAction.mock.calls[1][0]).toBe(false);
  });

  it("keeps the wait between 15 and 30 seconds and leaves about 20 seconds of the request for the rest", () => {
    const now = 1_000_000;
    expect(igBudgetMs(now + 57_000, now)).toBe(30_000);
    expect(igBudgetMs(now + 45_000, now)).toBe(25_000);
    expect(igBudgetMs(now + 30_000, now)).toBe(15_000);
    expect(igBudgetMs(now + 1_000, now)).toBe(15_000);
    expect(igBudgetMs(now - 5_000, now)).toBe(15_000);
  });
});

describe("schedule_story and a scheduled post of the same story", () => {
  it("lets one story wait for Facebook at one time and Instagram at another, and refuses the same place twice", async () => {
    shared.schedulePublishAction.mockResolvedValue({ ok: true, id: "sp9", runAt: "2030-10-25T07:00:00.000Z" });
    db.scheduledPost.findMany.mockResolvedValue([waitingRow()]);
    const ig = await run("schedule_story", { story: "s1", targets: ["IG"], when: LATER });
    expect(ig.ok).toBe(true);
    expect(shared.schedulePublishAction).toHaveBeenCalledWith(expect.objectContaining({ targets: ["IG"] }), LATER);
    expect(await refusal(cardOf("schedule_story", { story: "s1", targets: ["FB", "IG"], when: LATER }))).toMatch(/already scheduled for Facebook/);
  });

  it("finds the earlier post however many are waiting on the desk (the database filters, nothing is cut at 100)", async () => {
    await cardOf("schedule_story", SAMPLE.schedule_story);
    expect(db.scheduledPost.findMany.mock.calls[0][0].take).toBeUndefined();
    expect(db.scheduledPost.findMany.mock.calls[0][0].where.input).toEqual({ path: ["newsDraftId"], equals: "d1" });
  });

  it("refuses a story whose other place is still being posted by the scheduler", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({ status: "RUNNING" })]);
    expect(await refusal(cardOf("schedule_story", SAMPLE.schedule_story))).toMatch(/being posted to Facebook by the scheduler/);
  });
});

describe("changing a story that has a scheduled post", () => {
  const held = () => db.scheduledPost.findMany.mockResolvedValue([waitingRow()]);
  const NAMES: [string, Record<string, unknown>][] = [
    ["edit_draft", { story: "s1", headline: "Budget agreed by the council" }],
    ["draft_story", { story: "s1" }],
    ["improve_story", { story: "s1" }],
    ["make_story_card", { story: "s1" }],
  ];

  it("refuses an edit, a rewrite, an improvement and a new card on the card, and says to cancel the schedule first", async () => {
    held();
    for (const [name, args] of NAMES) {
      const why = await refusal(cardOf(name, args));
      expect(why, name).toMatch(/post scheduled for 2026-10-20 09:00 Baghdad time \(scheduled post sp7\)/);
      expect(why, name).toMatch(/cancel the scheduled post first/);
    }
  });

  it("refuses the run too, in the person's language, and calls no action", async () => {
    held();
    for (const [name, args] of NAMES) {
      for (const lang of ["ckb", "ar", "en"] as const) {
        expect(await run(name, args, ctxOf({ lang })), `${name}/${lang}`).toEqual({ ok: false, text: NW.scheduledHolds[lang]("2026-10-20 09:00") });
      }
    }
    expect(actions.saveNewsDraftAction).not.toHaveBeenCalled();
    expect(actions.draftNewsAction).not.toHaveBeenCalled();
    expect(shared.renderAndStoreCard).not.toHaveBeenCalled();
  });

  it("asks only for PENDING posts of this story", async () => {
    await cardOf("edit_draft", { story: "s1", headline: "Budget agreed by the council" });
    expect(db.scheduledPost.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", status: { in: ["PENDING"] }, input: { path: ["newsDraftId"], equals: "d1" } });
  });

  it("does not stop a story whose scheduled post is a video (it does not carry the card), or one with no draft yet", async () => {
    db.scheduledPost.findMany.mockResolvedValue([waitingRow({}, { media: { url: "https://abc.public.blob.vercel-storage.com/merchant/t1/v.mp4", pathname: "merchant/t1/v.mp4", type: "VIDEO" } })]);
    for (const [name, args] of NAMES) expect((await cardOf(name, args)).title, name).toBeTruthy();
    db.scheduledPost.findMany.mockClear();
    held();
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: null }));
    expect((await cardOf("edit_draft", { story: "s1", headline: "A headline and", body: "A body, both written by hand about something else entirely." })).title).toBeTruthy();
    expect(db.scheduledPost.findMany).not.toHaveBeenCalled();
  });

  it("does not stop making the story's video, which leaves the card alone", async () => {
    held();
    expect((await cardOf("make_story_video", { story: "s1" })).title).toBeTruthy();
  });

  it("tells the model, in the descriptions, to cancel the scheduled post first", () => {
    for (const [name] of NAMES) expect(tool(name).description, name).toMatch(/scheduled post/);
    expect(tool("publish_story").description).toMatch(/cancel_scheduled_post/);
    expect(tool("schedule_story").description).toMatch(/cancel_scheduled_post/);
  });
});

describe("dismiss_stories", () => {
  const rows = [
    { id: "s1", title: "First story title", sourceName: "BBC", status: "NEW", draft: null },
    { id: "s2", title: "Second story title", sourceName: "Rudaw", status: "DRAFTED", draft: { id: "d2" } },
  ];

  it("lists the stories on the card and pins Confirm to exactly those ids", async () => {
    db.newsItem.findMany.mockResolvedValue(rows);
    const card = await cardOf("dismiss_stories", { stories: ["s1", "s2", "s1"] });
    expect(card.lines.map((l) => l.value)).toContain("Second story title (has a draft)");
    expect(card.pin).toEqual({ stories: ["s1", "s2"] });
    expect(db.newsItem.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["s1", "s2"] }, tenantId: "t1" });
  });

  it("dismisses each story through the screen's action, and leaves out one that is already dismissed", async () => {
    db.newsItem.findMany.mockResolvedValue([...rows, { id: "s3", title: "Old", sourceName: "KNN", status: "DISMISSED", draft: null }]);
    const r = await run("dismiss_stories", { stories: ["s1", "s2", "s3"] });
    expect(r).toEqual({ ok: true, text: "2 stories dismissed." });
    expect(actions.dismissNewsAction.mock.calls.map((c) => c[0])).toEqual(["s1", "s2"]);
  });

  it("refuses an id that is not the desk's, a published story, nothing left to dismiss, and more than ten", async () => {
    db.newsItem.findMany.mockResolvedValue([rows[0]]);
    expect(await refusal(cardOf("dismiss_stories", { stories: ["s1", "zz"] }))).toMatch(/No story with id "zz"/);
    db.newsItem.findMany.mockResolvedValue([{ ...rows[0], status: "PUBLISHED" }]);
    expect(await refusal(cardOf("dismiss_stories", { stories: ["s1"] }))).toMatch(/published story cannot be dismissed/);
    db.newsItem.findMany.mockResolvedValue([{ ...rows[0], status: "DISMISSED" }]);
    expect(await refusal(cardOf("dismiss_stories", { stories: ["s1"] }))).toMatch(/dismissed already/);
    expect(tool("dismiss_stories").schema.safeParse({ stories: Array.from({ length: 11 }, (_, i) => `s${i}`) }).success).toBe(false);
    expect(tool("dismiss_stories").schema.safeParse({ stories: [] }).success).toBe(false);
    expect(actions.dismissNewsAction).not.toHaveBeenCalled();
  });
});

describe("make_story_video", () => {
  it("makes a design video, or a highlight from the attached MP4 clips, and returns no job id", async () => {
    actions.makeVideoAction.mockResolvedValue({ ok: true, video: { id: "v1", status: "QUEUED", style: "TEMPLATE", videoUrl: null } });
    const card = await cardOf("make_story_video", { story: "s1" });
    expect(lineOf(card, "Clips")).toBe(NW.designVideo.en);
    expect(lineOf(card, "Videos left this month")).toBe("300 / 300");
    const r = await run("make_story_video", { story: "s1" });
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("jobId");
    expect(actions.makeVideoAction).toHaveBeenLastCalledWith("d1", []);
    const withClip = await cardOf("make_story_video", { story: "s1", clips: ["a3"] });
    expect(lineOf(withClip, "Clips")).toBe("clip.mp4");
    await run("make_story_video", { story: "s1", clips: ["a3"] });
    expect(actions.makeVideoAction).toHaveBeenLastCalledWith("d1", [vid.url]);
  });

  it("refuses a plan without videos, a used-up month, a clip that is not an attached MP4, and a draft that breaks the rules", async () => {
    world.plan = "MANUAL";
    expect(await refusal(cardOf("make_story_video", { story: "s1" }))).toMatch(/not part of the desk's MANUAL plan/);
    world.plan = "AUTO";
    world.used = { video: 300 };
    expect(await refusal(cardOf("make_story_video", { story: "s1" }))).toMatch(/limit of 300 videos/);
    world.used = {};
    expect(await refusal(cardOf("make_story_video", { story: "s1", clips: ["a9"] }))).toMatch(/not a video attached/);
    expect(await refusal(cardOf("make_story_video", { story: "s1", clips: ["a1"] }))).toMatch(/not a video attached/);
    expect(await refusal(cardOf("make_story_video", { story: "s1", clips: ["a4"] }))).toMatch(/MP4 or MOV/);
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ body: "" }) }));
    expect(await refusal(cardOf("make_story_video", { story: "s1" }))).toMatch(/breaks the desk's rules/);
    expect(tool("make_story_video").schema.safeParse({ story: "s1", clips: ["a1", "a2", "a3", "a4"] }).success).toBe(false);
    expect(actions.makeVideoAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Settings that replace a whole record

describe("set_news_autopilot", () => {
  it("sets one field and writes every other field back exactly as it was", async () => {
    await run("set_news_autopilot", { dailyMax: 10 });
    expect(actions.saveAutopilotAction).toHaveBeenCalledWith({ mode: "DRAFT", targets: ["FB"], accounts: ["FB:111"], dailyMax: 10, minGapMin: 5, quietFrom: 1, quietTo: 8 });
    await run("set_news_autopilot", { minGapMin: 30 });
    expect(actions.saveAutopilotAction).toHaveBeenLastCalledWith({ mode: "DRAFT", targets: ["FB"], accounts: ["FB:111"], dailyMax: 15, minGapMin: 30, quietFrom: 1, quietTo: 8 });
  });

  it("shows the whole result on the card, with what changed marked", async () => {
    const card = await cardOf("set_news_autopilot", { dailyMax: 10 });
    expect(lineOf(card, "Autopilot")).toBe("Auto drafts");
    expect(lineOf(card, "Most auto posts per day")).toBe("10 (was 15)");
    expect(lineOf(card, "Shortest gap between two posts (minutes)")).toBe("5");
    expect(lineOf(card, "Quiet hours (no automatic posts)")).toBe("01:00 - 08:00");
    expect(lineOf(card, "Accounts")).toBe("Page A");
  });

  it("reads the record again when the run happens", async () => {
    await cardOf("set_news_autopilot", { dailyMax: 10 });
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ autoMinGapMin: 9, autoQuietFrom: null, autoQuietTo: null }));
    await run("set_news_autopilot", { dailyMax: 10 });
    expect(actions.saveAutopilotAction).toHaveBeenCalledWith(expect.objectContaining({ minGapMin: 9, quietFrom: null, quietTo: null }));
  });

  it("starts the posting on its own only on a plan that includes it, with a target that is connected", async () => {
    world.plan = "MANUAL";
    expect(await refusal(cardOf("set_news_autopilot", { mode: "PUBLISH" }))).toMatch(/Pro and Enterprise/);
    world.plan = "AUTO";
    const card = await cardOf("set_news_autopilot", { mode: "PUBLISH" });
    expect(lineOf(card, "Autopilot")).toBe("Auto publish (was Auto drafts)");
    expect(lineOf(card, "Note")).toMatch(/without human review/i);
    world.pages.FB = [];
    expect(await refusal(cardOf("set_news_autopilot", { mode: "PUBLISH", targets: ["FB"] }))).toMatch(/Facebook is not connected/);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ autoTargets: [] }));
    expect(await refusal(cardOf("set_news_autopilot", { mode: "PUBLISH" }))).toMatch(/at least one connected/);
    expect(actions.saveAutopilotAction).not.toHaveBeenCalled();
  });

  it("clears the quiet hours, needs both ends, and refuses accounts it does not have", async () => {
    await run("set_news_autopilot", { quietOff: true });
    expect(actions.saveAutopilotAction).toHaveBeenLastCalledWith(expect.objectContaining({ quietFrom: null, quietTo: null, dailyMax: 15 }));
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ autoQuietFrom: null, autoQuietTo: null }));
    expect(await refusal(cardOf("set_news_autopilot", { quietFrom: 2 }))).toMatch(/quiet hours need both/);
    expect(tool("set_news_autopilot").schema.safeParse({ quietOff: true, quietFrom: 2 }).success).toBe(false);
    expect(await refusal(cardOf("set_news_autopilot", { accounts: ["FB:999"] }))).toMatch(/not a connected Facebook account/);
    expect(await refusal(cardOf("set_news_autopilot", { dailyMax: 15 }))).toMatch(/Nothing would change/);
    expect(tool("set_news_autopilot").schema.safeParse({}).success).toBe(false);
    expect(tool("set_news_autopilot").schema.safeParse({ dailyMax: 500 }).success).toBe(false);
  });

  it("treats a PUBLISH that the plan no longer allows as the DRAFT it runs as, so a number can still be changed", async () => {
    world.plan = "MANUAL";
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ autoMode: "PUBLISH" }));
    await run("set_news_autopilot", { dailyMax: 4 });
    expect(actions.saveAutopilotAction).toHaveBeenCalledWith(expect.objectContaining({ mode: "DRAFT", dailyMax: 4 }));
  });
});

describe("set_news_filter", () => {
  it("sets the focus and writes the mode, the exclude prompt and the broad switch back as they were", async () => {
    world.plan = "ENTERPRISE";
    await run("set_news_filter", { focus: "Kurdistan sports" });
    expect(actions.saveNewsFilterAction).toHaveBeenCalledWith({ mode: "PROMPT", focus: "Kurdistan sports", exclude: "celebrity news", broad: true });
    await run("set_news_filter", { broad: false });
    expect(actions.saveNewsFilterAction).toHaveBeenLastCalledWith({ mode: "PROMPT", focus: "Kurdistan economy", exclude: "celebrity news", broad: false });
  });

  it("shows old and new on the card and says the stories are judged again", async () => {
    world.plan = "ENTERPRISE";
    const card = await cardOf("set_news_filter", { focus: "Kurdistan sports" });
    expect(lineOf(card, "Which news do you want?")).toBe("Kurdistan sports (was Kurdistan economy)");
    expect(lineOf(card, "Which news do you never want? (optional)")).toBe("celebrity news");
    expect(lineOf(card, "Note")).toBe(NW.filterRejudge.en);
  });

  it("follows the plan: no prompt on MANUAL, no exclude or broad on AUTO, a prompt must not be empty, a few changes a day", async () => {
    world.plan = "MANUAL";
    expect(await refusal(cardOf("set_news_filter", { mode: "PROMPT", focus: "x" }))).toMatch(/Pro and Enterprise/);
    world.plan = "AUTO";
    expect(await refusal(cardOf("set_news_filter", { exclude: "sports" }))).toMatch(/Enterprise/);
    expect(await refusal(cardOf("set_news_filter", { broad: false }))).toMatch(/Enterprise/);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ filterMode: "KEYWORDS", focusPrompt: null, excludePrompt: null, focusBroad: false }));
    expect(await refusal(cardOf("set_news_filter", { mode: "PROMPT" }))).toMatch(/Write what the desk wants/);
    world.plan = "ENTERPRISE";
    expect((await cardOf("set_news_filter", { mode: "PROMPT", exclude: "gossip" })).lines.length).toBeGreaterThan(1);
    world.slotDay = 6;
    expect(await refusal(cardOf("set_news_filter", { mode: "PROMPT", focus: "y" }))).toMatch(/several times today/);
    expect(actions.saveNewsFilterAction).not.toHaveBeenCalled();
  });

  it("does not show the Enterprise lines to a desk that cannot use them, and writes the saved ones back untouched", async () => {
    world.plan = "AUTO";
    const card = await cardOf("set_news_filter", { focus: "New focus" });
    expect(card.lines.some((l) => l.label.includes("never want"))).toBe(false);
    await run("set_news_filter", { focus: "New focus" });
    expect(actions.saveNewsFilterAction).toHaveBeenCalledWith({ mode: "PROMPT", focus: "New focus", exclude: "celebrity news", broad: true });
  });
});

describe("set_news_keywords and set_news_categories", () => {
  it("adds and removes keywords against the list as it is, and saves the whole list", async () => {
    const card = await cardOf("set_news_keywords", { add: ["duhok", "Erbil"], remove: ["economy"] });
    expect(lineOf(card, "Keywords")).toBe("erbil, duhok");
    expect(lineOf(card, "Before")).toBe("erbil, economy");
    await run("set_news_keywords", { add: ["duhok", "Erbil"], remove: ["economy"] });
    expect(actions.saveKeywordsAction).toHaveBeenCalledWith("erbil,duhok");
    // the list changes while the card waits
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ keywords: ["erbil", "economy", "oil"] }));
    await run("set_news_keywords", { add: ["duhok"] });
    expect(actions.saveKeywordsAction).toHaveBeenLastCalledWith("erbil,economy,oil,duhok");
  });

  it("refuses a word that is not in the list, a list over twenty and a call that changes nothing; the schema refuses commas", async () => {
    expect(await refusal(cardOf("set_news_keywords", { remove: ["oil"] }))).toMatch(/not in the keyword list: oil/);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ keywords: Array.from({ length: 20 }, (_, i) => `word${i}`) }));
    expect(await refusal(cardOf("set_news_keywords", { add: ["one more"] }))).toMatch(/at most 20/);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf());
    expect(await refusal(cardOf("set_news_keywords", { add: ["economy"] }))).toMatch(/Nothing would change/);
    const s = tool("set_news_keywords").schema;
    expect(s.safeParse({ add: ["a,b"] }).success).toBe(false);
    expect(s.safeParse({ add: ["a،b"] }).success).toBe(false);
    expect(s.safeParse({ add: ["x"] }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });

  it("adds a category and removes a topic with its parts, keeping the rest, and refuses what cannot be", async () => {
    const card = await cardOf("set_news_categories", { add: ["economy"], remove: ["politics"] });
    expect(lineOf(card, "Categories")).toBe("Economy, Sports · Football (was Politics, Sports · Football)");
    await run("set_news_categories", { add: ["economy"], remove: ["politics"] });
    expect(actions.saveCategoriesAction).toHaveBeenCalledWith(["economy", "sports/football"]);
    await run("set_news_categories", { add: ["sports"] });
    // a whole topic makes its parts redundant
    expect(actions.saveCategoriesAction).toHaveBeenLastCalledWith(["politics", "sports"]);
    expect(await refusal(cardOf("set_news_categories", { remove: ["health"] }))).toMatch(/not in the desk's categories/);
    expect(await refusal(cardOf("set_news_categories", { remove: ["politics/elections"] }))).toMatch(/kept as a whole/);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ categories: ["sports"] }));
    expect(await refusal(cardOf("set_news_categories", { remove: ["sports/football"] }))).toMatch(/kept as a whole/);
    expect(await refusal(cardOf("set_news_categories", { add: ["sports"] }))).toMatch(/Nothing would change/);
    expect(tool("set_news_categories").schema.safeParse({ add: ["sport"] }).success).toBe(false);
  });
});

describe("set_news_options", () => {
  it("calls only the switches that change", async () => {
    const card = await cardOf("set_news_options", { photoCardsOnly: true, keywordFilter: false, aiPictures: true });
    expect(card.lines).toHaveLength(2);
    await run("set_news_options", { photoCardsOnly: true, keywordFilter: false, aiPictures: true });
    expect(actions.setPhotoCardsOnlyAction).toHaveBeenCalledWith(true);
    expect(actions.setAiPicturesAction).toHaveBeenCalledWith(true);
    expect(actions.setKeywordFilterAction).not.toHaveBeenCalled();
    expect(actions.setSourceImagesAction).not.toHaveBeenCalled();
  });

  it("refuses an option that is already so, AI pictures the server cannot make, and stops at the first action that fails", async () => {
    expect(await refusal(cardOf("set_news_options", { sourceImages: false }))).toMatch(/Nothing would change/);
    world.aiPictureOn = false;
    expect(await refusal(cardOf("set_news_options", { aiPictures: true }))).toMatch(/not available/);
    world.aiPictureOn = true;
    actions.setSourceImagesAction.mockResolvedValue({ ok: false, error: "No." });
    expect(await run("set_news_options", { sourceImages: true, aiPictures: true })).toEqual({ ok: false, text: "No." });
    expect(actions.setAiPicturesAction).not.toHaveBeenCalled();
  });
});

describe("sources and feeds", () => {
  it("switches a ready-made source on or off within the plan's room", async () => {
    const card = await cardOf("toggle_news_source", { source: "bbc-ar", enabled: true });
    expect(card.title).toBe("Switch a source on");
    expect(lineOf(card, "Sources switched on")).toBe("4 / 30");
    await run("toggle_news_source", { source: "bbc-ar", enabled: true });
    expect(actions.toggleCatalogSourceAction).toHaveBeenCalledWith("bbc-ar", true);
    db.newsSource.findUnique.mockResolvedValue({ enabled: true });
    expect((await cardOf("toggle_news_source", { source: "bbc-ar", enabled: false })).title).toBe("Switch a source off");
    expect(await refusal(cardOf("toggle_news_source", { source: "bbc-ar", enabled: true }))).toMatch(/already switched on/);
    expect(await refusal(cardOf("toggle_news_source", { source: "nope", enabled: true }))).toMatch(/no ready-made source/);
    db.newsSource.findUnique.mockResolvedValue(null);
    world.plan = "LITE";
    db.newsSource.count.mockResolvedValue(5);
    expect(await refusal(cardOf("toggle_news_source", { source: "bbc-ar", enabled: true }))).toMatch(/allows 5 sources/);
  });

  it("adds the person's own feed only within the plan, once, and shows the address", async () => {
    const card = await cardOf("add_news_feed", SAMPLE.add_news_feed);
    expect(lineOf(card, "Link")).toBe("https://example.com/rss.xml");
    await run("add_news_feed", SAMPLE.add_news_feed);
    expect(actions.addRssSourceAction).toHaveBeenCalledWith("https://example.com/rss.xml", "Example");
    db.newsSource.findFirst.mockResolvedValue({ id: "f1" });
    expect(await refusal(cardOf("add_news_feed", SAMPLE.add_news_feed))).toMatch(/already has this feed/);
    db.newsSource.findFirst.mockResolvedValue(null);
    world.plan = "MANUAL";
    db.newsSource.count.mockResolvedValue(10);
    expect(await refusal(cardOf("add_news_feed", SAMPLE.add_news_feed))).toMatch(/allows 10 sources/);
    expect(tool("add_news_feed").schema.safeParse({ url: "ftp://x.com/a", name: "x" }).success).toBe(false);
    expect(tool("add_news_feed").schema.safeParse({ url: "javascript:alert(1)", name: "x" }).success).toBe(false);
  });

  it("removes only the desk's own feed, never a ready-made source", async () => {
    db.newsSource.findFirst.mockResolvedValue({ name: "Example", rssUrl: "https://example.com/rss.xml", catalogId: null });
    expect(values(await cardOf("remove_news_feed", { id: "f1" }))).toContain("https://example.com/rss.xml");
    await run("remove_news_feed", { id: "f1" });
    expect(actions.removeSourceAction).toHaveBeenCalledWith("f1");
    expect(db.newsSource.findFirst.mock.calls[0][0].where).toEqual({ id: "f1", tenantId: "t1" });
    db.newsSource.findFirst.mockResolvedValue({ name: "BBC", rssUrl: null, catalogId: "bbc-ar" });
    expect(await refusal(cardOf("remove_news_feed", { id: "f2" }))).toMatch(/toggle_news_source/);
    db.newsSource.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("remove_news_feed", { id: "f3" }))).toMatch(/no source with id/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Video, voice, brand, photos, frames

describe("set_news_video_settings", () => {
  it("sets one field and writes the mode, style, topics, voice, speed and prompt back as they were", async () => {
    world.plan = "ENTERPRISE";
    await run("set_news_video_settings", { dailyMax: 3 });
    expect(actions.saveVideoSettingsAction).toHaveBeenCalledWith({ mode: "AUTO", style: "HIGHLIGHT", topics: ["politics"], dailyMax: 3, voice: "aram", speed: 1.1, prompt: "Only big news" });
    await run("set_news_video_settings", { mode: "OFF" });
    expect(actions.saveVideoSettingsAction).toHaveBeenLastCalledWith({ mode: "OFF", style: "HIGHLIGHT", topics: ["politics"], dailyMax: 7, voice: "aram", speed: 1.1, prompt: "Only big news" });
  });

  it("shows the whole result with the quota", async () => {
    const card = await cardOf("set_news_video_settings", { mode: "OFF", topics: [] });
    expect(lineOf(card, "Auto video")).toBe("Off (was On)");
    expect(lineOf(card, "Topics")).toBe("Everything the autopilot posts (was Politics)");
    expect(lineOf(card, "Narrator voice")).toBe("Aram");
    expect(lineOf(card, "Reading speed")).toBe("1.1×");
    expect(lineOf(card, "Videos left this month")).toBe("300 / 300");
  });

  it("follows the plan: no video without a quota, the prompt and the own voice only on Enterprise", async () => {
    world.plan = "MANUAL";
    expect(await refusal(cardOf("set_news_video_settings", { mode: "AUTO" }))).toMatch(/Pro and Enterprise/);
    world.plan = "AUTO";
    expect(await refusal(cardOf("set_news_video_settings", { prompt: "x" }))).toMatch(/Enterprise/);
    expect(await refusal(cardOf("set_news_video_settings", { voice: "custom" }))).toMatch(/Enterprise/);
    world.plan = "ENTERPRISE";
    expect(await refusal(cardOf("set_news_video_settings", { voice: "custom" }))).toMatch(/recording of its own voice/);
    world.clone = { refUrl: "u", text: "t", seconds: 8 };
    expect(lineOf(await cardOf("set_news_video_settings", { voice: "custom" }), "Narrator voice")).toBe("Your voice (was Aram)");
    expect(await refusal(cardOf("set_news_video_settings", { mode: "AUTO" }))).toMatch(/Nothing would change/);
    const s = tool("set_news_video_settings").schema;
    expect(s.safeParse({ speed: 2 }).success).toBe(false);
    expect(s.safeParse({ dailyMax: 99 }).success).toBe(false);
    expect(s.safeParse({ voice: "nobody" }).success).toBe(false);
    expect(s.safeParse({ topics: ["gossip"] }).success).toBe(false);
  });

  it("keeps the prompt of a desk on a lower plan out of the record it writes", async () => {
    world.plan = "AUTO";
    await run("set_news_video_settings", { dailyMax: 3 });
    expect(actions.saveVideoSettingsAction).toHaveBeenCalledWith(expect.objectContaining({ prompt: "" }));
  });
});

describe("set_voice_note", () => {
  it("shows the new style and the old one, and clears with an empty text", async () => {
    const card = await cardOf("set_voice_note", { text: "Plain words." });
    expect(lineOf(card, "Writing style")).toBe("Plain words. (was Short sentences.)");
    actions.saveVoiceNoteAction.mockResolvedValue({ ok: true, voiceNote: "Plain words." });
    expect((await run("set_voice_note", { text: "Plain words." })).text).toBe(NW.done.voiceNote.en);
    expect(lineOf(await cardOf("set_voice_note", { text: "" }), "Writing style")).toBe("Empty (was Short sentences.)");
    expect((await run("set_voice_note", { text: "" })).text).toBe(NW.done.voiceNoteCleared.en);
    expect(await refusal(cardOf("set_voice_note", { text: "Short sentences." }))).toMatch(/Nothing would change/);
    expect(tool("set_voice_note").schema.safeParse({ text: "x".repeat(301) }).success).toBe(false);
  });
});

describe("set_brand_look", () => {
  it("sets one colour and passes the logo, the frame and every other value back unchanged", async () => {
    await run("set_brand_look", { primary: "#112233" });
    expect(actions.saveBrandKitAction).toHaveBeenCalledWith({
      logoPath: "merchant/t1/logo.png",
      primary: "#112233",
      accent: "#E0A526",
      text: "#FFFFFF",
      headingFont: "kufi",
      framePath: "merchant/t1/frame.png",
      frameText: "top",
      logoCorner: "right",
    });
    await run("set_brand_look", { headingFont: "sans", frameText: "bottom" });
    expect(actions.saveBrandKitAction).toHaveBeenLastCalledWith(expect.objectContaining({ headingFont: "sans", frameText: "bottom", primary: "#0B2545", logoPath: "merchant/t1/logo.png", framePath: "merchant/t1/frame.png", logoCorner: "right" }));
  });

  it("shows only what changes, and works for a desk that has no brand kit yet", async () => {
    const card = await cardOf("set_brand_look", { primary: "#112233", logoCorner: "left" });
    expect(card.lines.map((l) => l.value)).toEqual(["#112233 (was #0B2545)", "Top left (was Top right)"]);
    db.brandKit.findUnique.mockResolvedValue(null);
    await run("set_brand_look", { accent: "#abcdef" });
    expect(actions.saveBrandKitAction).toHaveBeenLastCalledWith({ logoPath: null, primary: "#0B2545", accent: "#abcdef", text: "#FFFFFF", headingFont: "kufi", framePath: null, frameText: "bottom", logoCorner: "off" });
  });

  it("refuses a logo corner without a logo, a change that changes nothing, and a colour that is not a hex colour", async () => {
    db.brandKit.findUnique.mockResolvedValue(kitOf({ logoPath: null, logoCorner: "off" }));
    expect(await refusal(cardOf("set_brand_look", { logoCorner: "right" }))).toMatch(/no logo uploaded/);
    expect(await refusal(cardOf("set_brand_look", { primary: "#0b2545" }))).toMatch(/Nothing would change/);
    const s = tool("set_brand_look").schema;
    expect(s.safeParse({ primary: "red" }).success).toBe(false);
    expect(s.safeParse({ primary: "#12345" }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });
});

describe("add_library_photo", () => {
  it("adds an attached picture with the person's description", async () => {
    actions.addNewsPhotoAction.mockResolvedValue({ ok: true, photo: { id: "p1" } });
    const card = await cardOf("add_library_photo", { attachment: "a1", label: "Erbil citadel", general: true });
    expect(lineOf(card, "Photos in the library")).toBe("5 / 200");
    expect(lineOf(card, "General (fits any story)")).toBe("On");
    await run("add_library_photo", { attachment: "a1", label: "Erbil citadel", general: true });
    expect(actions.addNewsPhotoAction).toHaveBeenCalledWith({ pathname: img.pathname, url: img.url, label: "Erbil citadel", general: true });
  });

  it("takes only an attached JPG, PNG or WebP picture, and refuses a full library", async () => {
    expect(await refusal(cardOf("add_library_photo", { attachment: "a9", label: "x" }))).toMatch(/not one of the files attached/);
    expect(await refusal(cardOf("add_library_photo", { attachment: "a3", label: "x" }))).toMatch(/not a JPG, PNG or WebP/);
    expect(await refusal(cardOf("add_library_photo", { attachment: "a2", label: "x" }))).toMatch(/not a JPG, PNG or WebP/);
    db.newsPhoto.count.mockResolvedValue(200);
    expect(await refusal(cardOf("add_library_photo", { attachment: "a1", label: "x" }))).toMatch(/library is full/);
    expect(actions.addNewsPhotoAction).not.toHaveBeenCalled();
  });
});

describe("the frame tools", () => {
  it("design a section's frame with the attached reference, and keep the earlier reference and note when none is given", async () => {
    const card = await cardOf("design_section_frame", { section: "sports", note: "green", reference: "a1", position: "top" });
    expect(card.title).toBe("Design a section's frame");
    expect(lineOf(card, "Section")).toBe("Sports");
    expect(lineOf(card, "Reference graphic")).toBe("erbil.jpg");
    expect(lineOf(card, "Headline place")).toBe("Top");
    expect(lineOf(card, "Frame designs left today")).toBe("6 / 6");
    expect((await run("design_section_frame", { section: "sports", note: "green", reference: "a1", position: "top" })).ok).toBe(true);
    expect(actions.designSectionFrameAction).toHaveBeenCalledWith({ section: "sports", referencePath: img.pathname, note: "green", frameText: "top" });

    db.newsFrame.findUnique.mockResolvedValue({ frameText: "middle", referencePath: "merchant/t1/ref.png", note: "calm" });
    const kept = await cardOf("design_section_frame", { section: "economy" });
    expect(lineOf(kept, "Note")).toBe("calm (from the earlier design)");
    expect(lineOf(kept, "Reference graphic")).toBe(NW.keptReference.en);
    await run("design_section_frame", { section: "economy" });
    expect(actions.designSectionFrameAction).toHaveBeenLastCalledWith({ section: "economy", referencePath: "merchant/t1/ref.png", note: "calm", frameText: "middle" });
  });

  it("shows the whole earlier design prompt next to the new one, however long it is, and tells the model to read it first", async () => {
    const was = Array.from({ length: 110 }, (_, i) => `tone${i}`).join(" ").slice(0, 700).replace(/\s+\S*$/, "");
    expect(was.length).toBeGreaterThan(600);
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ designPrompt: was }));
    const card = await cardOf("set_design_prompt", { text: `${was} with gold accents` });
    expect(lineOf(card, "Your words about your graphics")).toBe(`${was} with gold accents (was ${was})`);
    expect(tool("set_design_prompt").description).toMatch(/REPLACES the whole text/);
    expect(tool("set_design_prompt").description).toMatch(/get_desk_settings/);
  });

  it("refuse when the AI is off, the day's frames are used, the reference is not a picture, and never design the main frame", async () => {
    world.imageOn = false;
    expect(await refusal(cardOf("design_section_frame", { section: "sports" }))).toMatch(/not available/);
    world.imageOn = true;
    world.slotDay = 6;
    expect(await refusal(cardOf("design_section_frame", { section: "sports" }))).toMatch(/6 frames today/);
    world.slotDay = 0;
    expect(await refusal(cardOf("design_section_frame", { section: "sports", reference: "a3" }))).toMatch(/picture/);
    expect(tool("design_section_frame").schema.safeParse({ section: "main" }).success).toBe(false);
    expect(actions.designSectionFrameAction).not.toHaveBeenCalled();
  });

  it("save the desk's words about its graphics, move the headline only on a frame the section has, and remove a frame", async () => {
    actions.saveDesignPromptAction.mockResolvedValue({ ok: true, designPrompt: "Green and calm" });
    expect(lineOf(await cardOf("set_design_prompt", { text: "Green and calm" }), "Your words about your graphics")).toBe("Green and calm (was Deep blue)");
    expect((await run("set_design_prompt", { text: "Green and calm" })).ok).toBe(true);
    expect(actions.saveDesignPromptAction).toHaveBeenCalledWith("Green and calm");
    expect(await refusal(cardOf("set_design_prompt", { text: "Deep blue" }))).toMatch(/Nothing would change/);

    expect(await refusal(cardOf("set_frame_text", { section: "sports", position: "top" }))).toMatch(/no frame of its own/);
    db.newsFrame.findUnique.mockResolvedValue({ frameText: "top" });
    expect(await refusal(cardOf("set_frame_text", { section: "sports", position: "top" }))).toMatch(/already at the top/);
    expect(lineOf(await cardOf("set_frame_text", { section: "sports", position: "middle" }), "Headline place")).toBe("Middle (was Top)");
    expect((await run("set_frame_text", { section: "sports", position: "middle" })).ok).toBe(true);
    expect(actions.saveSectionFrameTextAction).toHaveBeenCalledWith("sports", "middle");

    const removed = await cardOf("remove_section_frame", { section: "breaking" });
    expect(lineOf(removed, "Section")).toBe("Breaking news");
    expect((await run("remove_section_frame", { section: "breaking" })).ok).toBe(true);
    expect(actions.removeSectionFrameAction).toHaveBeenCalledWith("breaking");
    db.newsFrame.findUnique.mockResolvedValue(null);
    expect(await refusal(cardOf("remove_section_frame", { section: "sports" }))).toMatch(/no frame of its own/);
  });

  it("use the same names and arguments as the classic assistant's frame tools", async () => {
    const { SCHEMAS, NEWS_TOOLS } = await import("@/lib/assistant/tools");
    for (const name of NEWS_TOOLS) expect(tool(name).schema, name).toBe(SCHEMAS[name]);
  });
});

describe("a change that finds things different when it runs", () => {
  it("answers in the person's language instead of failing loudly", async () => {
    db.newsItem.findFirst.mockResolvedValue(itemOf({ draft: draftOf({ cardUrl: null, cardPath: null }) }));
    expect(await run("publish_story", SAMPLE.publish_story, ctxOf({ lang: "ar" }))).toEqual({ ok: false, text: NW.stale.ar });
    db.newsSettings.findUnique.mockResolvedValue(settingsOf({ keywords: [] }));
    expect(await run("set_news_keywords", { remove: ["economy"] }, ctxOf({ lang: "ckb" }))).toEqual({ ok: false, text: NW.stale.ckb });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Words

const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Every sentence of a word table in all three languages (a function is called with a number and with a word). */
function sentences(table: unknown, path = "NW"): { path: string; ckb: string; ar: string; en: string }[] {
  const t = table as Record<string, unknown>;
  if (t && typeof t === "object" && "ckb" in t && "ar" in t && "en" in t) {
    const out: { path: string; ckb: string; ar: string; en: string }[] = [];
    const each = (lang: "ckb" | "ar" | "en") => {
      const v = t[lang];
      return typeof v === "function" ? [(v as (x: unknown) => string)(5), (v as (x: unknown) => string)("abc")] : [String(v)];
    };
    const [c, a, e] = [each("ckb"), each("ar"), each("en")];
    for (let i = 0; i < c.length; i++) out.push({ path: `${path}[${i}]`, ckb: c[i], ar: a[i], en: e[i] });
    return out;
  }
  return Object.entries(t ?? {}).flatMap(([k, v]) => sentences(v, `${path}.${k}`));
}

describe("the word tables", () => {
  const all = sentences(NW);

  it("have every sentence in all three languages", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const s of all) for (const lang of ["ckb", "ar", "en"] as const) expect(s[lang].trim().length, `${s.path}.${lang}`).toBeGreaterThan(0);
  });

  it("use no Kurdish-only letter in the Arabic and no Arabic-script letter in the English", () => {
    for (const s of all) {
      expect(KURDISH_ONLY.test(s.ar), `${s.path} Arabic has Kurdish letters: ${s.ar}`).toBe(false);
      expect(ARABIC_SCRIPT.test(s.en), `${s.path} English has Arabic-script text: ${s.en}`).toBe(false);
    }
  });

  it("are written in Sorani for ckb: no Arabic yeh or kaf where the Sorani letters go", () => {
    for (const s of all) expect(/[يك]/.test(s.ckb), `${s.path} Sorani has Arabic yeh or kaf: ${s.ckb}`).toBe(false);
  });

  it("show a value inside the sentence in every language", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      expect(NW.done.drafted[lang]("A headline")).toContain("A headline");
      expect(NW.done.scheduled[lang]("2030-10-25 10:00")).toContain("2030-10-25 10:00");
      expect(NW.done.refreshFailed[lang]("Rudaw")).toContain("Rudaw");
    }
  });
});

describe("the source files", () => {
  it("hold no invisible or bidirectional character", () => {
    const invisible = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff, 0x061c, 0x00ad].map((n) => String.fromCharCode(n)).join("")}]`);
    for (const f of [
      "src/lib/chat/tools/writes-news.ts",
      "src/lib/chat/tools/writes-news-common.ts",
      "src/lib/chat/tools/writes-news-story.ts",
      "src/lib/chat/tools/writes-news-settings.ts",
      "src/lib/chat/tools/writes-news-brand.ts",
      "src/lib/chat/tools/writes-news-words.ts",
      "src/lib/chat/tools/writes-new.ts",
      "src/app/newsroom/run-desk-tool.ts",
      "tests/chat/writes-news.test.ts",
    ]) {
      expect(invisible.test(readFileSync(f, "utf8")), f).toBe(false);
    }
  });

  it("keep run-desk-tool.ts a plain module: not a server-action file", () => {
    expect(readFileSync("src/app/newsroom/run-desk-tool.ts", "utf8")).not.toMatch(/^\s*["']use server["']/m);
  });
});
