import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An automatic story that fails before any voice was paid gives the store's day back, so the day's video is not lost; it is bounded, so a
// failure that keeps coming back does not retry every minute. Only an automatic STORY: an ad, or a story made by hand, is never touched.
vi.mock("@/lib/db", () => ({
  db: {
    store: { findMany: vi.fn(), updateMany: vi.fn() },
    adVideo: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({ put: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/shop/pipeline", () => ({ startOfShopDay: (d: Date) => new Date(Math.floor((d.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000) }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(async () => "haiku"), recordSpend: vi.fn() }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ videos: { LITE: 10, PRO: 0 }, videosPerDay: 1 })) }));
vi.mock("@/lib/shop/profile", () => ({ loadProfiles: vi.fn(async () => new Map()) }));
vi.mock("@/lib/advideo/limits", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/limits")>()), videosUsed: vi.fn(async () => 0), videosToday: vi.fn(async () => 0), refundVideo: vi.fn() }));
vi.mock("@/lib/advideo/publish", () => ({ publishAdVideo: vi.fn() }));
vi.mock("@/lib/advideo/voice", () => ({ voiceWasPaid: vi.fn(async () => false) }));
vi.mock("@/lib/advideo/prepare", () => ({ AD_CLAIM_MS: 1, AD_MAX_TRIES: 3, createAdVideo: vi.fn(), prepareQueued: vi.fn(async () => 0) }));

import { db } from "@/lib/db";
import { tickAdVideos } from "@/lib/advideo/auto";
import { AUTO_DAY_RESTORES_MAX, giveBackAutoDay } from "@/lib/advideo/auto-day";
import { refundVideo } from "@/lib/advideo/limits";
import { voiceWasPaid } from "@/lib/advideo/voice";

const m = db as unknown as {
  store: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  adVideo: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

const NOW = Date.UTC(2026, 9, 21, 15, 30);
const CREATED = new Date(NOW - 20 * 60_000);
const job = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", source: "AUTO", createdAt: CREATED, spec: { kind: "story", lang: "en" }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.store.updateMany.mockReset().mockResolvedValue({ count: 1 });
  m.adVideo.count.mockReset().mockResolvedValue(1);
});
afterEach(() => vi.restoreAllMocks());

describe("giving the day back", () => {
  it("makes the store's video due again when an automatic story failed before any voice was paid", async () => {
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(true);
    expect(m.store.updateMany).toHaveBeenCalledTimes(1);
    const arg = m.store.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ videoAutoLastAt: null });
    // Only the claim this job belongs to: made just before the job was, never a later one.
    expect(arg.where.id).toBe("s1");
    expect(arg.where.videoAutoLastAt.gte.getTime()).toBe(CREATED.getTime() - 60_000);
    expect(arg.where.videoAutoLastAt.lte.getTime()).toBe(CREATED.getTime() + 10_000);
  });

  it("does nothing when a voice was paid for, for an ad, for a story the owner made by hand, or with no store", async () => {
    expect(await giveBackAutoDay(job(), { voicePaid: true, now: NOW })).toBe(false);
    expect(await giveBackAutoDay(job({ spec: { kind: "ad" } }), { voicePaid: false, now: NOW })).toBe(false);
    expect(await giveBackAutoDay(job({ spec: null }), { voicePaid: false, now: NOW })).toBe(false);
    expect(await giveBackAutoDay(job({ source: "MANUAL" }), { voicePaid: false, now: NOW })).toBe(false);
    expect(await giveBackAutoDay(job({ storeId: null }), { voicePaid: false, now: NOW })).toBe(false);
    expect(m.store.updateMany).not.toHaveBeenCalled();
  });

  it("is bounded: after two failed automatic stories in one shop day the third failure waits for tomorrow", async () => {
    expect(AUTO_DAY_RESTORES_MAX).toBe(2);
    m.adVideo.count.mockResolvedValue(AUTO_DAY_RESTORES_MAX);
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(true);
    m.adVideo.count.mockResolvedValue(AUTO_DAY_RESTORES_MAX + 1);
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(false);
    // The count is of this store's failed automatic stories since the shop day began.
    const where = m.adVideo.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ storeId: "s1", source: "AUTO", status: "FAILED", spec: { path: ["kind"], equals: "story" } });
    expect(where.createdAt.gte.getTime()).toBe(Date.UTC(2026, 9, 20, 21, 0)); // Baghdad midnight
  });

  it("is harmless to do twice: once the day is given back, the claim is gone and nothing else is touched", async () => {
    m.store.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(true);
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(false);
  });

  it("never throws: a failed database call is a log line, not a second failure", async () => {
    m.store.updateMany.mockRejectedValue(new Error("db down"));
    expect(await giveBackAutoDay(job(), { voicePaid: false, now: NOW })).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the minute's housekeeping gives the day back", () => {
  beforeEach(() => {
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.store.findMany.mockResolvedValue([]);
    m.adVideo.findFirst.mockResolvedValue(null);
    m.adVideo.updateMany.mockResolvedValue({ count: 0 });
    vi.mocked(voiceWasPaid).mockResolvedValue(false);
  });
  afterEach(() => vi.unstubAllEnvs());

  /** The tick's queries in the order it makes them after the automation: stuck jobs first, then the failed automatic stories. */
  const queries = (stuck: unknown[], failed: unknown[]) => m.adVideo.findMany.mockReset().mockResolvedValueOnce(stuck).mockResolvedValueOnce(failed);

  it("gives the day back for an automatic story that failed in its prepare before any voice was paid", async () => {
    queries([], [job()]);
    const out = await tickAdVideos({ deadline: NOW + 50_000 });
    expect(m.store.updateMany).toHaveBeenCalledTimes(1);
    expect(out.day_given_back).toBe(1);
    // It looks only at recent automatic stories that failed.
    const where = m.adVideo.findMany.mock.calls[1][0].where;
    expect(where).toMatchObject({ source: "AUTO", status: "FAILED", spec: { path: ["kind"], equals: "story" } });
    expect(where.updatedAt.gte).toBeInstanceOf(Date);
  });

  it("does not, when a voice was paid for", async () => {
    vi.mocked(voiceWasPaid).mockResolvedValue(true);
    queries([], [job()]);
    const out = await tickAdVideos({ deadline: NOW + 50_000 });
    expect(m.store.updateMany).not.toHaveBeenCalled();
    expect(out.day_given_back).toBeUndefined();
  });

  it("does it for a story that ran out of tries without answering too (the stuck ones), and refunds as before", async () => {
    const stuck = { id: "v2", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", createdAt: CREATED, source: "AUTO", spec: { kind: "story" } };
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    queries([stuck], []);
    await tickAdVideos({ deadline: NOW + 50_000 });
    expect(vi.mocked(refundVideo)).toHaveBeenCalledWith("t1", "LITE", CREATED, { keepDay: false });
    expect(m.store.updateMany).toHaveBeenCalledTimes(1);
    // A stuck job whose voice was paid keeps its day, as it always did, and does not give the store's day back.
    vi.mocked(voiceWasPaid).mockResolvedValue(true);
    m.store.updateMany.mockClear();
    queries([stuck], []);
    await tickAdVideos({ deadline: NOW + 50_000 });
    expect(vi.mocked(refundVideo)).toHaveBeenLastCalledWith("t1", "LITE", CREATED, { keepDay: true });
    expect(m.store.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing while the AI video section is closed", async () => {
    vi.stubEnv("AD_VIDEO_ENABLED", "0");
    expect(await tickAdVideos({ deadline: NOW + 50_000 })).toEqual({ disabled: 1 });
    expect(m.adVideo.findMany).not.toHaveBeenCalled();
  });
});
