import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The daily AI video: each store's own language (Store.videoLang) and kind (from the page's goal), stories as drafts only,
// and the stores that can not make their video today are skipped without spending the day.
vi.mock("@/lib/db", () => ({ db: { store: { findMany: vi.fn(), updateMany: vi.fn() }, adVideo: {} } }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/shop/pipeline", () => ({ startOfShopDay: (d: Date) => new Date(Math.floor((d.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000) }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(async () => "haiku"), recordSpend: vi.fn() }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ videos: { LITE: 10, PRO: 0 }, videosPerDay: 1 })) }));
vi.mock("@/lib/shop/profile", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("@/lib/advideo/limits", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/limits")>()), videosUsed: vi.fn(async () => 0), videosToday: vi.fn(async () => 0), refundVideo: vi.fn() }));
vi.mock("@/lib/advideo/publish", () => ({ publishAdVideo: vi.fn() }));
vi.mock("@/lib/advideo/voice", () => ({ voiceWasPaid: vi.fn(async () => false) }));
vi.mock("@/lib/advideo/prepare", () => ({ AD_CLAIM_MS: 1, AD_MAX_TRIES: 3, createAdVideo: vi.fn(), prepareQueued: vi.fn() }));
vi.mock("@/lib/advideo/targets", () => ({ connectedVideoTargets: vi.fn() }));
vi.mock("@/lib/ai/review-idea", () => ({ reviewIdea: vi.fn() }));

import { db } from "@/lib/db";
import { runVideoAutomation } from "@/lib/advideo/auto";
import { createAdVideo } from "@/lib/advideo/prepare";
import { connectedVideoTargets } from "@/lib/advideo/targets";
import { reviewIdea } from "@/lib/ai/review-idea";
import { loadProfiles } from "@/lib/shop/profile";

const m = db as unknown as { store: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } };
const NOW = Date.UTC(2026, 9, 12, 15, 30); // 18:30 in Baghdad
const store = (over: Record<string, unknown> = {}) => ({
  id: "s1", tenantId: "t1", plan: "MERCHANT", videoAutoMode: "DRAFT", videoAutoTier: "LITE", videoAutoHour: 18, videoAutoLastAt: null, videoLang: null,
  fbPageId: "fb1", igUserId: "ig1", tenant: { ownerId: "u1" }, ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({ storeId: "s1", goal: "sell", goalText: null, category: null, offerLine: null, ...over });
const withProfiles = (...ps: Record<string, unknown>[]) => vi.mocked(loadProfiles).mockResolvedValue(new Map(ps.map((p) => [p.storeId as string, p])) as never);
const sent = () => vi.mocked(createAdVideo).mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;

describe("the daily video of a store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    vi.stubEnv("PAWAN_API_KEY", "");
    m.store.findMany.mockReset().mockResolvedValue([store()]);
    m.store.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(createAdVideo).mockResolvedValue({ ok: true, id: "v1" });
    vi.mocked(loadProfiles).mockResolvedValue(new Map());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads each store's video language", async () => {
    await runVideoAutomation(NOW);
    expect(m.store.findMany.mock.calls[0][0].select).toMatchObject({ videoLang: true });
  });

  it("makes a Sorani ad for a store that chose nothing, as it always did", async () => {
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 1 });
    expect(sent()).toMatchObject({ lang: "ckb", kind: "ad", voice: "shilan", topic: null, productId: null, source: "AUTO", autoPost: false, targets: ["FB", "IG"] });
  });

  it("posts an ad by itself in PUBLISH mode", async () => {
    m.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH" })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "ad", autoPost: true });
  });

  it("makes the ad in the language the store chose, with a voice of that language", async () => {
    m.store.findMany.mockResolvedValue([store({ videoLang: "en" })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ lang: "en", kind: "ad", voice: "female" });
    m.store.findMany.mockResolvedValue([store({ videoLang: "ar" })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ lang: "ar", kind: "ad", voice: "female" });
    // A language that is not one reads as Sorani.
    m.store.findMany.mockResolvedValue([store({ videoLang: "xx" })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ lang: "ckb", voice: "shilan" });
  });

  it("makes a story for a page that earns from its content, in its language, with the storyteller's voice", async () => {
    m.store.findMany.mockResolvedValue([store({ videoLang: "en" })]);
    withProfiles(profile({ goal: "monetize", offerLine: "English mystery and crime stories" }));
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 1 });
    expect(sent()).toMatchObject({ lang: "en", kind: "story", voice: "male", topic: null, productId: null });
    // The older "grow" goal is the same choice.
    withProfiles(profile({ goal: "grow", goalText: "grow a story channel" }));
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story" });
  });

  it("makes the daily story of every language without naming a case and without the literal switch: the system chooses a real case", async () => {
    for (const videoLang of [null, "ar", "en"]) {
      m.store.findMany.mockResolvedValue([store({ videoLang })]);
      withProfiles(profile({ goal: "monetize", offerLine: "mystery and crime stories from history" }));
      await runVideoAutomation(NOW);
      // Sorani (the default) is a documented story like the others; the case is chosen in prepare, from the page's concept and the
      // store's recent subjects, so what is sent here has no topic (an empty request) and is page-aware.
      expect(sent(), String(videoLang)).toMatchObject({ kind: "story", topic: null, productId: null });
      expect(sent()).not.toHaveProperty("literal");
      expect(sent()).not.toHaveProperty("review");
    }
  });

  it("keeps a story a draft even when the store posts its videos by itself: an invented story is read first", async () => {
    m.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH", videoLang: "en" })]);
    withProfiles(profile({ goal: "monetize", goalText: "stories" }));
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story", autoPost: false });
  });

  it("makes the ad as before for a content page that has written nothing about what it is about: it is never skipped for its kind", async () => {
    // No offer line and no goal in words: a bare category (even "content") is not a concept a story can follow.
    for (const over of [{}, { category: "other" }, { category: "content" }, { offerLine: "  ", goalText: "" }]) {
      vi.mocked(createAdVideo).mockClear();
      withProfiles(profile({ goal: "monetize", ...over }));
      expect(await runVideoAutomation(NOW), JSON.stringify(over)).toEqual({ queued: 1 });
      expect(sent(), JSON.stringify(over)).toMatchObject({ kind: "ad", topic: null, productId: null, lang: "ckb", voice: "shilan" });
    }
    withProfiles(profile({ goal: "grow", category: "content" }));
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "ad" });
  });

  it("makes a story once the page has written an offer line or a goal in words, and keeps the ad for a seller who has the same words", async () => {
    withProfiles(profile({ goal: "monetize", offerLine: "True crime stories" }));
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story" });
    withProfiles(profile({ goal: "grow", goalText: "I tell mystery stories", category: "content" }));
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story" });
    // A seller (or any other goal) is never switched, whatever it wrote.
    for (const goal of ["sell", "leads", "other"]) {
      withProfiles(profile({ goal, offerLine: "True crime stories", goalText: "stories" }));
      await runVideoAutomation(NOW);
      expect(sent(), goal).toMatchObject({ kind: "ad" });
    }
  });

  it("reads the profiles of the stores whose video is due, and none when none is", async () => {
    m.store.findMany.mockResolvedValue([store({ id: "late", videoAutoHour: 23 }), store({ id: "done", videoAutoLastAt: new Date(NOW - 3_600_000) }), store({ id: "due" })]);
    await runVideoAutomation(NOW);
    expect(vi.mocked(loadProfiles).mock.calls).toEqual([[["due"]]]);
    vi.mocked(loadProfiles).mockClear();
    m.store.findMany.mockResolvedValue([store({ id: "late", videoAutoHour: 23 })]);
    expect(await runVideoAutomation(NOW)).toEqual({});
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it("makes an ad for any other goal, and when the profile is off", async () => {
    for (const goal of ["sell", "leads", "other", null]) {
      withProfiles(profile({ goal }));
      await runVideoAutomation(NOW);
      expect(sent(), String(goal)).toMatchObject({ kind: "ad" });
    }
    vi.mocked(loadProfiles).mockResolvedValue(new Map());
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "ad" });
  });

  it("does not claim the day of an English or Arabic store when Gemini has no key, but never asks Sorani for one", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    m.store.findMany.mockResolvedValue([store({ videoLang: "en" })]);
    expect(await runVideoAutomation(NOW)).toEqual({ no_voice: 1 });
    expect(m.store.updateMany).not.toHaveBeenCalled();
    expect(createAdVideo).not.toHaveBeenCalled();
    m.store.findMany.mockResolvedValue([store({ videoLang: null })]);
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 1 });
  });

  it("gives the day back when the video is refused, for any reason, the new ones included", async () => {
    vi.mocked(createAdVideo).mockResolvedValue({ ok: false, error: "voice" });
    expect(await runVideoAutomation(NOW)).toEqual({ refused_voice: 1 });
    expect(m.store.updateMany).toHaveBeenCalledTimes(2);
    expect(m.store.updateMany.mock.calls[1][0]).toMatchObject({ data: { videoAutoLastAt: null } });
  });

  it("handles every store on its own: one story, one English ad, one Sorani ad", async () => {
    m.store.findMany.mockResolvedValue([store({ id: "a", videoLang: "en" }), store({ id: "b", videoLang: "ar" }), store({ id: "c" })]);
    withProfiles(profile({ storeId: "a", goal: "monetize", goalText: "stories" }), profile({ storeId: "b", goal: "sell" }));
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 3 });
    const calls = vi.mocked(createAdVideo).mock.calls.map((c) => c[0] as unknown as Record<string, unknown>);
    expect(calls.map((c) => [c.storeId, c.lang, c.kind])).toEqual([["a", "en", "story"], ["b", "ar", "ad"], ["c", "ckb", "ad"]]);
    expect(vi.mocked(loadProfiles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadProfiles).mock.calls[0][0]).toEqual(["a", "b", "c"]);
  });
});

// ---- the daily routine with a plan: the owner's own words, published to the platforms he named ----------------------------------------

describe("the daily video of a store with a plan", () => {
  const BRIEF = "one of the historical mystery stories, crime genre";
  const plan = (over: Record<string, unknown> = {}) => ({
    brief: BRIEF,
    kind: "story",
    review: false,
    photos: true,
    targets: ["FB", "IG", "YT"],
    youtube: { privacy: "private", madeForKids: false },
    ...over,
  });
  const planned = (p: unknown, over: Record<string, unknown> = {}) => store({ videoAutoMode: "PUBLISH", videoAutoPlan: p, ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    vi.stubEnv("PAWAN_API_KEY", "");
    m.store.findMany.mockReset().mockResolvedValue([planned(plan())]);
    m.store.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(createAdVideo).mockResolvedValue({ ok: true, id: "v1" });
    vi.mocked(loadProfiles).mockResolvedValue(new Map());
    vi.mocked(connectedVideoTargets).mockReset().mockImplementation(async (_t, _s, wanted) => wanted);
    vi.mocked(reviewIdea).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the plan column, and a store without one is the store it always was", async () => {
    await runVideoAutomation(NOW);
    expect(m.store.findMany.mock.calls[0][0].select).toMatchObject({ videoAutoPlan: true });
    // No plan: the old behaviour exactly (an ad, no topic, no connected-platform read, no literal switch).
    vi.mocked(connectedVideoTargets).mockClear();
    m.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH", videoAutoPlan: null })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "ad", topic: null, autoPost: true, targets: ["FB", "IG"] });
    for (const key of ["literal", "photos", "format", "fiction", "youtube"]) expect(sent()).not.toHaveProperty(key);
    expect(connectedVideoTargets).not.toHaveBeenCalled();
  });

  it("makes a story from the owner's own words, exactly as he wrote them, and posts it by itself to the platforms he named that are connected", async () => {
    vi.mocked(connectedVideoTargets).mockResolvedValue(["FB", "YT"]);
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 1 });
    expect(connectedVideoTargets).toHaveBeenCalledWith("t1", { fbPageId: "fb1", igUserId: "ig1" }, ["FB", "IG", "YT"]);
    expect(sent()).toMatchObject({
      kind: "story",
      topic: BRIEF,
      literal: true,
      photos: true,
      format: "vertical",
      fiction: false,
      targets: ["FB", "YT"],
      autoPost: true,
      youtube: { privacy: "private", madeForKids: false },
      source: "AUTO",
      voice: "shilan",
      productId: null,
    });
    // The words went straight through: no reviewer was asked.
    expect(reviewIdea).not.toHaveBeenCalled();
  });

  it("is the plan's kind even when the page's goal says another, and keeps a story a draft in mode DRAFT", async () => {
    withProfiles(profile({ goal: "sell", offerLine: "shoes" }));
    m.store.findMany.mockResolvedValue([planned(plan(), { videoAutoMode: "DRAFT" })]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story", topic: BRIEF, autoPost: false, targets: ["FB", "IG", "YT"] });
  });

  it("makes a wide story when the plan says so, and an ad never carries the story's switches", async () => {
    m.store.findMany.mockResolvedValue([planned(plan({ format: "wide", photos: false }))]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story", format: "wide", photos: false });
    m.store.findMany.mockResolvedValue([planned(plan({ kind: "ad", format: "wide", targets: ["FB"], youtube: undefined }))]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "ad", topic: BRIEF, targets: ["FB"], autoPost: true });
    for (const key of ["literal", "photos", "format", "fiction", "youtube"]) expect(sent()).not.toHaveProperty(key);
  });

  it("reads the page first only when the plan asks, and falls back on the owner's own words for any failure of the review", async () => {
    m.store.findMany.mockResolvedValue([planned(plan({ review: true }))]);
    const reviewed = "A clearer brief for the director.\nSuggested case: Mary Celeste";
    vi.mocked(reviewIdea).mockResolvedValue({ text: reviewed, summary: "s", kept: false });
    await runVideoAutomation(NOW);
    expect(reviewIdea).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", storeId: "s1", productId: null, idea: BRIEF, kind: "story", lang: "ckb" }));
    expect(sent()).toMatchObject({ topic: reviewed, literal: false });
    // The words stand when the review had nothing to read, or broke.
    vi.mocked(reviewIdea).mockResolvedValue({ text: BRIEF, summary: "", kept: true, skipped: true });
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ topic: BRIEF, literal: false });
    vi.mocked(reviewIdea).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runVideoAutomation(NOW)).toEqual({ queued: 1 });
    expect(sent()).toMatchObject({ topic: BRIEF, literal: false });
    // An ad's idea is reviewed as an ad's.
    m.store.findMany.mockResolvedValue([planned(plan({ review: true, kind: "ad", targets: [], youtube: undefined }))]);
    vi.mocked(reviewIdea).mockResolvedValue({ text: "a clearer ad brief", summary: "s", kept: false });
    await runVideoAutomation(NOW);
    expect(reviewIdea).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "video", idea: BRIEF }));
    expect(sent()).toMatchObject({ kind: "ad", topic: "a clearer ad brief" });
  });

  it("decides fiction from the owner's own words, before any review rewrote them", async () => {
    m.store.findMany.mockResolvedValue([planned(plan({ review: true, brief: "a fictional ghost story" }))]);
    vi.mocked(reviewIdea).mockResolvedValue({ text: "A haunted house tale, tense and quiet.", summary: "s", kept: false });
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ topic: "A haunted house tale, tense and quiet.", fiction: true });
  });

  it("with no words of his own the page's concept steers the choice: nothing is literal, no review is asked", async () => {
    m.store.findMany.mockResolvedValue([planned(plan({ brief: "", review: true }))]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ kind: "story", topic: null, literal: false, fiction: false });
    expect(reviewIdea).not.toHaveBeenCalled();
    m.store.findMany.mockResolvedValue([planned(plan({ brief: "", review: false }))]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ topic: null, literal: false });
  });

  it("keeps the video as a draft, and says so, when none of the platforms he named is connected (or the read fails)", async () => {
    vi.mocked(connectedVideoTargets).mockResolvedValue([]);
    expect(await runVideoAutomation(NOW)).toEqual({ draft_no_targets: 1, queued: 1 });
    expect(sent()).toMatchObject({ targets: [], autoPost: false });
    // A read that fails confirms nothing: Facebook and Instagram by the store's own accounts, and never YouTube.
    vi.mocked(connectedVideoTargets).mockRejectedValue(new Error("db"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ targets: ["FB", "IG"], autoPost: true });
    expect(sent()).not.toHaveProperty("youtube");
    // A plan of drafts only names no platform, and no read is made.
    vi.mocked(connectedVideoTargets).mockClear();
    m.store.findMany.mockResolvedValue([planned(plan({ targets: [], youtube: undefined }))]);
    await runVideoAutomation(NOW);
    expect(connectedVideoTargets).not.toHaveBeenCalled();
    expect(sent()).toMatchObject({ targets: [], autoPost: false });
  });

  it("never carries YouTube's declarations when YouTube is not one of the connected platforms", async () => {
    vi.mocked(connectedVideoTargets).mockResolvedValue(["FB"]);
    await runVideoAutomation(NOW);
    expect(sent()).toMatchObject({ targets: ["FB"] });
    expect(sent()).not.toHaveProperty("youtube");
  });

  it("reads a plan that is junk as no plan at all", async () => {
    for (const junk of ["not a plan", 5, { kind: "podcast" }, [], { brief: "x" }]) {
      m.store.findMany.mockResolvedValue([planned(junk)]);
      await runVideoAutomation(NOW);
      expect(sent(), JSON.stringify(junk)).toMatchObject({ kind: "ad", topic: null });
      expect(sent()).not.toHaveProperty("literal");
    }
    expect(connectedVideoTargets).not.toHaveBeenCalled();
  });

  it("makes the same words' video every day, and gives the day back when it was refused, like any other", async () => {
    m.store.findMany.mockResolvedValue([planned(plan())]);
    await runVideoAutomation(NOW);
    const first = sent().topic;
    m.store.findMany.mockResolvedValue([planned(plan(), { videoAutoLastAt: new Date(NOW - 26 * 3_600_000) })]);
    await runVideoAutomation(NOW);
    expect(sent().topic).toBe(first);
    vi.mocked(createAdVideo).mockResolvedValue({ ok: false, error: "busy" });
    expect(await runVideoAutomation(NOW)).toEqual({ refused_busy: 1 });
    expect(m.store.updateMany.mock.calls.at(-1)?.[0]).toMatchObject({ data: { videoAutoLastAt: expect.anything() } });
  });
});
