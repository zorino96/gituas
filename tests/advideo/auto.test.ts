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

import { db } from "@/lib/db";
import { runVideoAutomation } from "@/lib/advideo/auto";
import { createAdVideo } from "@/lib/advideo/prepare";
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
