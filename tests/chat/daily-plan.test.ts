// The owner's daily video plan, and the chat's story card when the owner mentions YouTube. The scenario that started it: the owner, who runs a
// mystery-history channel, wrote in Sorani "every day make me a video in this style [his prompt] and publish it", and the product did something
// else. Here: one card with his plan in his words (no question unless YouTube's two answers are missing), Confirm saves exactly that plan, and
// every refusal is a plain sentence for the model, never a guess.
import { beforeEach, describe, expect, it, vi } from "vitest";

const shop = vi.hoisted(() => ({
  fb: { connected: true, accountId: "fb1", name: "Page" } as { connected: boolean; accountId?: string; name?: string },
  ig: { connected: false } as { connected: boolean; accountId?: string; name?: string },
  yt: { connected: false } as { connected: boolean; accountId?: string; name?: string },
}));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn() },
  businessProfile: { findUnique: vi.fn() },
  chatMessage: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: [{}], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({ META_FACEBOOK: shop.fb, META_INSTAGRAM: shop.ig, TIKTOK: { connected: false }, YOUTUBE: shop.yt })),
  loadPosts: vi.fn(async () => ({ posts: [], errors: [] })),
  loadConversations: vi.fn(async () => ({ conversations: [], unreadable: 0, errors: [] })),
}));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (lang: string) => (lang === "ar" ? ar : lang === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/app/app/actions", () => ({ publishAction: vi.fn(), saveWhatsAppAction: vi.fn(), replyToCommentAction: vi.fn(), setCommentHiddenAction: vi.fn(), sendMessageAction: vi.fn() }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn(), cancelScheduledAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/app/orders/actions", () => ({ setOrderStatusAction: vi.fn() }));

import { createVideoAction, saveVideoAutoAction } from "@/app/app/video/actions";
import { riskOf, toolSpecs } from "@/lib/chat/registry";
import { WRITE_TOOLS } from "@/lib/chat/tools/writes";
import { CARD } from "@/lib/chat/tools/writes-words";
import { ToolRefusal, type Card, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { DAILY_VIDEO_RULE } from "@/lib/assistant/tools";
import { systemPrompt } from "@/lib/chat/system";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";

const ctxOf = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [],
  latestAttachments: [],
  review: true,
  deadline: Date.now() + 50_000,
  ...over,
});
const tool = (name: string): WriteTool => {
  const t = WRITE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const parse = (name: string, args: unknown) => tool(name).schema.parse(args);
const cardOf = (name: string, args: unknown, ctx = ctxOf()): Promise<Card> => tool(name).card(ctx, parse(name, args));
const run = (name: string, args: unknown, ctx = ctxOf()) => tool(name).execute(ctx, parse(name, args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};
/** The owner's own messages, oldest first (the store returns them newest first and reverses them). */
const owner = (...texts: string[]) => db.chatMessage.findMany.mockImplementation(async () => [...texts].reverse().map((content, i) => ({ role: "user", content, seq: texts.length - i })));
const line = (c: Card, label: string) => c.lines.find((l) => l.label === label);
const UI: Lang[] = ["ckb", "ar", "en"];
const KURDISH = /[کیەێۆڕڵڤپچژگ]/;

// The owner's own prompt, in Sorani: "one of the historical mystery stories, crime genre, very eye-catching".
const SORANI_IDEA = "یەکێک لە چیرۆکە نهێنییە مێژووییەکان، ژانری تاوان، زۆر سەرنجڕاکێش";
const SORANI_ASK = `هەموو ڕۆژێک ڤیدیۆیەک بەم شێوەیە بۆم دروست بکە و بڵاوی بکەرەوە: ${SORANI_IDEA}`;

const saved = (plan: unknown, mode: string | null = "DRAFT") => ({ videoAutoHour: 21, videoAutoTier: "LITE", videoAutoMode: mode, videoAutoPlan: plan });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  db.businessProfile.findUnique.mockResolvedValue(null);
  db.chatMessage.findMany.mockReset();
  db.chatMessage.findMany.mockResolvedValue([]);
  shop.fb = { connected: true, accountId: "fb1", name: "Page" };
  shop.ig = { connected: false };
  shop.yt = { connected: false };
  db.store.findMany.mockResolvedValue([
    { id: "s1", name: "Shop one", igUsername: null, fbPageId: "other", igUserId: null },
    { id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null },
  ]);
  db.store.findUnique.mockResolvedValue(saved(null, "OFF"));
  db.product.findMany.mockResolvedValue([]);
  db.product.findFirst.mockResolvedValue(null);
  vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
});

describe("the daily video plan: the owner's scenario", () => {
  it("makes ONE card with the plan in the owner's own words, and asks nothing when YouTube is not wanted", async () => {
    owner(SORANI_ASK);
    const c = await cardOf("set_daily_video", { mode: "PUBLISH", idea: SORANI_IDEA, kind: "story", publishTo: ["FB"] }, ctxOf({ lang: "ckb" }));
    const t = dict("ckb").assistant.fields;
    // His words verbatim, the kind, the shape, the words going through exactly (no review), the photographs and where it is posted.
    expect(line(c, t.idea)).toEqual({ label: t.idea, value: SORANI_IDEA });
    expect(line(c, t.kind)).toEqual({ label: t.kind, value: t.kindStory });
    expect(line(c, t.format)).toEqual({ label: t.format, value: t.formatVertical });
    expect(line(c, t.words)).toEqual({ label: t.words, value: t.wordsExact });
    expect(line(c, t.postTo)).toEqual({ label: t.postTo, value: "Facebook" });
    expect(line(c, t.mode)).toEqual({ label: t.mode, value: t.modePublish });
    // The plain facts BEFORE Confirm: a general idea gets a different real case each day, and a story told from memory or very recent waits.
    const done = dict("ckb").assistant.done;
    expect(c.lines.map((l) => l.value)).toEqual(expect.arrayContaining([done.dailyCase, done.dailyWaits, done.videoLengthStory]));
    // No YouTube line when YouTube is not in the plan.
    expect(c.lines.some((l) => l.label === t.youtube)).toBe(false);
    // What Confirm saves is the whole plan the card showed.
    expect(c.pin).toEqual({ idea: SORANI_IDEA, kind: "story", review: false, photos: true, publishTo: ["FB"], format: "vertical" });
  });

  it("saves the plan with parseVideoAutoPlan on Confirm, in his words, and tells what runs every day", async () => {
    owner(SORANI_ASK);
    const args = { mode: "PUBLISH", idea: `  ${SORANI_IDEA}  `, kind: "story", publishTo: ["FB"] };
    const card = await cardOf("set_daily_video", args);
    const r = await run("set_daily_video", { ...parse("set_daily_video", args), ...card.pin });
    expect(r.ok).toBe(true);
    const sent = vi.mocked(saveVideoAutoAction).mock.calls.at(-1)!;
    expect(sent[0]).toBe("s2");
    expect(sent[1]).toMatchObject({ mode: "PUBLISH", tier: "LITE", hour: 21 });
    // The idea is stored exactly (trimmed), literal (no review), photographs on, posted to Facebook.
    expect(sent[1].plan).toEqual({ brief: SORANI_IDEA, kind: "story", review: false, photos: true, targets: ["FB"] });
    const done = dict("en").assistant.done;
    // (With several shops the result also names the one it acted on.)
    expect(r.text.split("\n").filter((x) => !x.startsWith(dict("en").assistant.fields.shop))).toEqual([done.setting, done.dailyPlan, done.dailyCase, done.dailyWaits]);
  });

  it("is act-first: a generic request needs no kind, no hour, no review and no platform decision from the owner", async () => {
    owner(SORANI_ASK);
    // The model gives only the idea and the platform: the page decides the kind, the hour stays, the words go through exactly.
    const c = await cardOf("set_daily_video", { mode: "PUBLISH", idea: SORANI_IDEA, publishTo: ["FB"] });
    expect(line(c, "Kind")).toEqual({ label: "Kind", value: "Ad" });
    expect(c.pin).toMatchObject({ idea: SORANI_IDEA, review: false, photos: true, publishTo: ["FB"] });
    // A content page (creator) is a story.
    vi.stubEnv("BUSINESS_PROFILE_ENABLED", "1");
    db.businessProfile.findUnique.mockResolvedValue({ storeId: "s2", goal: "monetize", goalText: null, category: null, offerLine: null, customer: [], sellsTo: [], language: null, tone: null, facts: [], interview: {} });
    const story = await cardOf("set_daily_video", { mode: "PUBLISH", idea: SORANI_IDEA, publishTo: ["FB"] });
    expect(line(story, "Kind")).toEqual({ label: "Kind", value: "Story" });
  });

  it("asks ONE short question, by refusing the card with the instruction, only when YouTube is wanted and the owner has not said both answers", async () => {
    owner("every day make me a mystery video like this and post it on YouTube");
    for (const args of [
      { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["YT"] },
      { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["YT"], youtubePrivacy: "public" },
      { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["FB", "YT"], youtubeMadeForKids: false },
    ]) {
      const said = await refusal(cardOf("set_daily_video", args));
      expect(said).toMatch(/Ask ONE short question for both/);
      expect(said).toMatch(/Never choose them yourself/);
      expect(said).toMatch(/youtubePrivacy/);
      expect(said).toMatch(/youtubeMadeForKids/);
    }
  });

  it("shows the owner's two YouTube answers and that YouTube keeps uploads Private, and refuses a YouTube that is not connected", async () => {
    owner("every day make me a mystery video like this and post it on YouTube, public, not for kids");
    const args = { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["YT"], youtubePrivacy: "public", youtubeMadeForKids: false };
    const notThere = await refusal(cardOf("set_daily_video", args));
    expect(notThere).toMatch(/YouTube is not connected/);
    expect(notThere).toMatch(/show_accounts/);
    shop.yt = { connected: true, accountId: "UC1", name: "Channel" };
    for (const lang of UI) {
      const t = dict(lang).assistant.fields;
      const c = await cardOf("set_daily_video", args, ctxOf({ lang }));
      expect(line(c, t.postTo), lang).toEqual({ label: t.postTo, value: "YouTube" });
      expect(line(c, t.ytWho), lang).toEqual({ label: t.ytWho, value: t.ytWhoOptions.public });
      expect(line(c, t.ytKids), lang).toEqual({ label: t.ytKids, value: t.no });
      expect(c.lines.some((l) => l.value === dict(lang).publish.ytPrivate), lang).toBe(true);
      expect(c.pin).toMatchObject({ publishTo: ["YT"], youtubePrivacy: "public", youtubeMadeForKids: false });
      if (lang === "ar") expect(KURDISH.test(c.lines.map((l) => `${l.label}${l.value}`).join(" ")), lang).toBe(false);
    }
  });

  it("refuses a daily video that posts by itself with nowhere to post to, and says what to do without asking the owner", async () => {
    owner("post a mystery video every day");
    const said = await refusal(cardOf("set_daily_video", { mode: "PUBLISH", idea: "a mystery story", kind: "story" }));
    expect(said).toMatch(/needs publishTo/);
    expect(said).toMatch(/every Facebook Page and Instagram account that is connected/);
    expect(said).toMatch(/Do not ask the owner which ones/);
    // Kept as a draft needs no platform.
    const draft = await cardOf("set_daily_video", { mode: "DRAFT", idea: "a mystery story", kind: "story" });
    expect(line(draft, "Posts to")).toEqual({ label: "Posts to", value: "Nowhere: kept for you to read" });
    // PUBLISH on a plan that already exists but has no platform is refused too (the plan is read from the shop).
    db.store.findUnique.mockResolvedValue(saved({ brief: "x", kind: "story", review: false, photos: true, targets: [] }, "DRAFT"));
    expect(await refusal(cardOf("set_daily_video", { mode: "PUBLISH" }))).toMatch(/needs publishTo/);
    // With a platform in the saved plan, switching to PUBLISH is fine.
    db.store.findUnique.mockResolvedValue(saved({ brief: "x", kind: "story", review: false, photos: true, targets: ["FB"] }, "DRAFT"));
    expect((await cardOf("set_daily_video", { mode: "PUBLISH" })).lines.length).toBeGreaterThan(0);
  });

  it("refuses a platform this shop does not have, an idea too long to keep whole, and words the owner never said", async () => {
    owner("make a mystery video every day and post it");
    expect(await refusal(cardOf("set_daily_video", { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["IG"] }))).toMatch(/no Instagram account/);
    const tooLong = "a".repeat(601);
    const said = await refusal(cardOf("set_daily_video", { mode: "DRAFT", idea: tooLong, kind: "story" }));
    expect(said).toMatch(/at most 600 characters/);
    expect(said).toMatch(/never cut or rewrite their words yourself/);
    // 600 characters exactly are kept whole.
    const exact = "b".repeat(600);
    const ok = await cardOf("set_daily_video", { mode: "DRAFT", idea: exact, kind: "ad" });
    expect(ok.pin).toMatchObject({ idea: exact });
    // The idea is the owner's words: an Egyptian crime nobody asked for is the model's addition.
    const added = await refusal(cardOf("set_daily_video", { mode: "DRAFT", idea: "A historical Egyptian crime mystery", kind: "story" }));
    expect(added).toMatch(/words the owner did not say: Egypt/);
    expect(added).toMatch(/Do not ask the owner anything/);
  });

  it("sets a story wide by itself when the owner says YouTube, 16:9 or wide in any of the three languages, and says so on the card", async () => {
    for (const said of ["upload it to YouTube", "I want 16:9", "a wide video", "ڤیدیۆکە بۆ یوتیوب بێت", "أريده على يوتيوب"]) {
      owner(said);
      const c = await cardOf("set_daily_video", { mode: "DRAFT", idea: "a mystery story", kind: "story" });
      expect(c.lines, said).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
      expect(c.lines, said).toContainEqual({ label: "Note", value: CARD.videoWideAuto.en });
      expect(c.pin, said).toMatchObject({ format: "wide" });
    }
    // Not when the owner asked for the vertical shape, and not for an ad.
    owner("a vertical video for reels, and maybe YouTube later");
    expect((await cardOf("set_daily_video", { mode: "DRAFT", idea: "a mystery story", kind: "story" })).pin).toMatchObject({ format: "vertical" });
    owner("upload it to YouTube");
    const ad = await cardOf("set_daily_video", { mode: "DRAFT", idea: "an ad", kind: "ad" });
    expect(ad.lines.some((l) => l.label === "Shape")).toBe(false);
  });

  it("builds on the plan already saved: only what the call carries changes, and the card shows the whole plan", async () => {
    owner("move it to 8 and use my new words");
    db.store.findUnique.mockResolvedValue(saved({ brief: "old words", kind: "story", format: "wide", review: true, photos: false, targets: ["FB"] }, "PUBLISH"));
    const c = await cardOf("set_daily_video", { hour: 8, idea: "my new words" });
    expect(c.lines).toContainEqual({ label: "Idea", value: "my new words" });
    expect(c.lines).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    expect(c.lines).toContainEqual({ label: "Your words", value: "Gituas reads your page first, then improves the idea" });
    expect(c.lines).toContainEqual({ label: "Photos", value: "No photographs" });
    expect(c.lines).toContainEqual({ label: "Posts to", value: "Facebook" });
    expect(c.pin).toEqual({ idea: "my new words", kind: "story", review: true, photos: false, publishTo: ["FB"], format: "wide" });
    await run("set_daily_video", { hour: 8, idea: "my new words" });
    expect(vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1]).toMatchObject({ hour: 8, plan: { brief: "my new words", kind: "story", format: "wide", review: true, photos: false, targets: ["FB"] } });
    // An empty idea says "no idea of my own": the plan keeps going with the page's usual choice.
    const usual = await cardOf("set_daily_video", { idea: "" });
    expect(usual.lines).toContainEqual({ label: "Idea", value: dict("en").assistant.fields.ideaUsual });
  });

  it("checks again when it runs, whatever the card said: the idea is not cut, YouTube is never guessed, every platform must be there", async () => {
    const base = { mode: "PUBLISH", idea: "a mystery story", kind: "story" };
    const en = dict("en").assistant.errors;
    expect(await run("set_daily_video", { ...base, publishTo: ["YT"] })).toEqual({ ok: false, text: en.youtubeNeeds });
    expect(await run("set_daily_video", { ...base, publishTo: ["YT"], youtubePrivacy: "private", youtubeMadeForKids: true })).toEqual({ ok: false, text: en.notConnected("YouTube") });
    expect(await run("set_daily_video", { ...base, publishTo: ["IG"] })).toEqual({ ok: false, text: en.notConnected("Instagram") });
    expect(await run("set_daily_video", base)).toEqual({ ok: false, text: en.planTargets });
    expect(await run("set_daily_video", { ...base, idea: "z".repeat(700), publishTo: ["FB"] })).toEqual({ ok: false, text: en.planIdeaLong });
    expect(saveVideoAutoAction).not.toHaveBeenCalled();
  });

  it("saves a YouTube plan with the owner's own answers, and says YouTube keeps uploads Private", async () => {
    shop.yt = { connected: true, accountId: "UC1" };
    const r = await run("set_daily_video", { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["FB", "YT"], youtubePrivacy: "unlisted", youtubeMadeForKids: false });
    expect(r.ok).toBe(true);
    expect(vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1].plan).toEqual({
      brief: "a mystery story",
      kind: "story",
      review: false,
      photos: true,
      targets: ["FB", "YT"],
      youtube: { privacy: "unlisted", madeForKids: false },
    });
    expect(r.text).toContain(dict("en").publish.ytPrivate);
  });

  it("keeps the old calls exactly as they were: no plan in the call means no plan in the save", async () => {
    await run("set_daily_video", { mode: "PUBLISH" });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "PUBLISH", tier: "LITE", hour: 21 });
    await run("set_daily_video", { hour: 9 });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { tier: "LITE", hour: 9 });
    const c = await cardOf("set_daily_video", { mode: "DRAFT", hour: 20 });
    expect(c.pin).toBeUndefined();
    expect(c.lines.map((l) => l.label)).toEqual(["Mode", "Hour", "Accounts"]);
  });

  it("is a card (standing) whenever the plan or the language changes, and small only for OFF or a bare hour", () => {
    const t = tool("set_daily_video");
    expect(riskOf(t, { idea: "x words" })).toBe("standing");
    expect(riskOf(t, { publishTo: ["FB"] })).toBe("standing");
    expect(riskOf(t, { mode: "PUBLISH", idea: "x words" })).toBe("standing");
    expect(riskOf(t, { mode: "OFF", idea: "x words" })).toBe("low");
    expect(riskOf(t, { hour: 8 })).toBe("low");
  });

  it("has the schema and the description the model needs: the plan's arguments, the YouTube question, act-first", () => {
    const props = Object.keys((toolSpecs([tool("set_daily_video")])[0].function.parameters as { properties: Record<string, unknown> }).properties);
    expect(props).toEqual(expect.arrayContaining(["mode", "hour", "language", "idea", "kind", "format", "review", "photos", "publishTo", "youtubePrivacy", "youtubeMadeForKids"]));
    expect(() => parse("set_daily_video", { publishTo: ["TT"] })).toThrow();
    expect(() => parse("set_daily_video", { youtubePrivacy: "everyone" })).toThrow();
    expect(() => parse("set_daily_video", { review: "yes" })).toThrow();
    expect(parse("set_daily_video", { publishTo: ["FB", "IG", "YT"], youtubePrivacy: "private", youtubeMadeForKids: true }).publishTo).toEqual(["FB", "IG", "YT"]);
    const d = tool("set_daily_video").description;
    expect(d).toMatch(/idea: the owner's own words, VERBATIM, at most 600 characters/);
    expect(d).toMatch(/ask ONE short question for both; never choose them/);
    expect(d).toMatch(/Everything else is act-first/);
    expect(d).toMatch(/a different real case each day/);
    expect(d).toMatch(/waits as a draft/);
    expect(d).toMatch(/YouTube keeps every upload Private until Google finishes reviewing Gituas/);
    // The old sentence that every story is a draft is gone: the owner's plan can post one that was told from a read article.
    expect(d).not.toMatch(/always kept as a draft/);
    // The rule the model reads once in the system prompt says the same.
    expect(DAILY_VIDEO_RULE).toMatch(/ask both in ONE short question and never answer them for the owner/);
    expect(DAILY_VIDEO_RULE).toMatch(/no questions/);
    expect(DAILY_VIDEO_RULE).toMatch(/copied word for word/);
  });

  it("says its words in the person's language: no Kurdish-only letter in the Arabic and no Arabic script in the English", async () => {
    shop.yt = { connected: true, accountId: "UC1" };
    owner(SORANI_ASK);
    for (const lang of UI) {
      const c = await cardOf("set_daily_video", { mode: "PUBLISH", idea: "a mystery story", kind: "story", publishTo: ["FB", "YT"], youtubePrivacy: "private", youtubeMadeForKids: false }, ctxOf({ lang }));
      for (const l of c.lines) {
        expect(l.label.trim(), lang).not.toBe("");
        expect(l.value.trim(), lang).not.toBe("");
        if (lang === "ar") expect(KURDISH.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
        if (lang === "en") expect(/[؀-ۿ]/.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
      }
    }
  });
});

describe("a story from the chat: YouTube sets it wide, and the deadline and the review line are honest", () => {
  const idea = "one of the historical mystery stories, crime";
  const bare = (over: Partial<ToolCtx> = {}) => ctxOf({ attachments: [], latestAttachments: [], ...over });

  it("sets the shape to wide when the owner's recent words say YouTube, even if the model left the shape out, and stores it with the run", async () => {
    owner("a video for my YouTube mystery-history channel, one of the historical mystery stories, crime");
    const c = await cardOf("make_video", { idea, kind: "story", language: "en" }, bare());
    expect(c.lines).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    expect(c.lines).toContainEqual({ label: "Note", value: CARD.videoWideAuto.en });
    expect(c.pin).toMatchObject({ format: "wide" });
    // The model said vertical by default: the owner's words win.
    const v = await cardOf("make_video", { idea, kind: "story", language: "en", format: "vertical" }, bare());
    expect(v.lines).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    // Said in Sorani or Arabic it is the same.
    for (const said of ["ڤیدیۆیەکی 16:9 بۆ یوتیوب", "فيديو على يوتيوب"]) {
      owner(said);
      expect((await cardOf("make_video", { idea, kind: "story", language: "en" }, bare())).pin, said).toMatchObject({ format: "wide" });
    }
  });

  it("leaves the shape alone when the owner did not say it, said vertical, or only an old message said it; an ad is never made wide", async () => {
    owner("a mystery story please");
    expect((await cardOf("make_video", { idea, kind: "story", language: "en" }, bare())).lines).toContainEqual({ label: "Shape", value: "Vertical 9:16 (Reels)" });
    owner("a vertical reel about YouTube history");
    expect((await cardOf("make_video", { idea, kind: "story", language: "en" }, bare())).pin).toBeUndefined();
    // Only the owner's last three messages count: YouTube said long ago is not this request.
    owner("upload to YouTube", "ok", "thanks", "another one please", "make it a mystery");
    expect((await cardOf("make_video", { idea, kind: "story", language: "en" }, bare())).pin).toBeUndefined();
    owner("upload to YouTube");
    const ad = await cardOf("make_video", { idea: "a short ad", kind: "ad" }, bare());
    expect(ad.lines.some((l) => l.label === "Shape")).toBe(false);
  });

  it("passes the chat's own deadline on to the action that prepares the video, so the writer stops in time", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const deadline = Date.now() + 41_000;
    await run("make_video", { idea, kind: "story", language: "en" }, bare({ deadline }));
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ deadline });
  });

  it("says 'used exactly as written' for a story whose idea was not reviewed, never for a reviewed one", async () => {
    const done = dict("en").assistant.done;
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const plain = await run("make_video", { idea, kind: "story", language: "en" }, bare({ review: false }));
    expect(plain.text).toContain(done.videoUsedAsWritten);
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", reviewed: { text: "a clearer brief", summary: "added the page's angle" } });
    const reviewed = await run("make_video", { idea, kind: "story", language: "en" }, bare());
    expect(reviewed.text).not.toContain(done.videoUsedAsWritten);
    expect(reviewed.text).toContain("Reviewed: added the page's angle");
    // An ad keeps its own wording (nothing new is said about the idea).
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "ad", format: "vertical" } });
    expect((await run("make_video", { idea: "a short ad", kind: "ad" }, bare({ review: false }))).text).not.toContain(done.videoUsedAsWritten);
  });
});

describe("a generic Sorani story request in the chat is act-first: the card comes at once, nothing is asked", () => {
  it("makes the card for his words as they are, with no language, no kind and no format from the model, and refuses nothing", async () => {
    owner(SORANI_ASK);
    vi.stubEnv("BUSINESS_PROFILE_ENABLED", "1");
    db.businessProfile.findUnique.mockResolvedValue({ storeId: "s2", goal: "monetize", goalText: null, category: null, offerLine: null, customer: [], sellsTo: [], language: null, tone: null, facts: [], interview: {} });
    const c = await cardOf("make_video", { idea: SORANI_IDEA }, ctxOf({ lang: "ckb" }));
    const t = dict("ckb").assistant.fields;
    expect(line(c, t.idea)).toEqual({ label: t.idea, value: SORANI_IDEA });
    expect(line(c, t.kind)).toEqual({ label: t.kind, value: t.kindStory });
    // The shape is vertical unless he said YouTube, the story is retold from a real case Gituas chooses, and the length and YouTube sentences are there.
    expect(line(c, t.format)).toEqual({ label: t.format, value: t.formatVertical });
    expect(line(c, t.length)).toEqual({ label: t.length, value: dict("ckb").assistant.done.videoLengthStory });
    expect(line(c, t.youtube)).toEqual({ label: t.youtube, value: dict("ckb").assistant.done.videoNotYouTube });
    // And the daily version of the same request: his words, no question.
    const daily = await cardOf("set_daily_video", { mode: "DRAFT", idea: SORANI_IDEA }, ctxOf({ lang: "ckb" }));
    expect(line(daily, t.idea)).toEqual({ label: t.idea, value: SORANI_IDEA });
    expect(line(daily, t.kind)).toEqual({ label: t.kind, value: t.kindStory });
  });

  it("tells the model in the tool and in the system prompt to propose at once and never ask for a case, a country or an era", () => {
    expect(tool("make_video").description).toMatch(/Act first: a generic idea \(a genre, a wish, a style\) is enough for a story, so propose the video at once and never ask the owner to name a case, a country or an era/);
    const system = systemPrompt({ lang: "ckb", uiNames: {}, state: {}, features: { max: true, video: true, pictures: true }, attachments: [], buttons: { confirm: "پەسەندکردن", cancel: "هەڵوەشاندنەوە" }, nowBaghdad: "2026-10-25 10:00" });
    expect(system).toMatch(/NEVER ask the owner to name a case: propose the video right away/);
    expect(system).toMatch(/Ask a question only when a wrong guess would publish, spend money or message the wrong thing/);
  });
});
