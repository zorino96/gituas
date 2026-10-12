import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

// The Usage table, in memory: the real day and month counters run against it.
const usage = vi.hoisted(() => new Map<string, number>());
const plans = vi.hoisted(() => ({ current: ["MERCHANT"] as string[] }));
const k = (w: { tenantId: string; month: string; metric: string }) => `${w.tenantId}|${w.month}|${w.metric}`;

vi.mock("@/lib/db", () => ({
  db: {
    store: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => plans.current.map((plan) => ({ plan }))) },
    product: { findFirst: vi.fn() },
    adVideo: { create: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    usage: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        const key = k(where.tenantId_month_metric);
        return usage.has(key) ? { count: usage.get(key)! } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } }; create: { count: number }; update: { count: { increment: number } } }) => {
        const key = k(where.tenantId_month_metric);
        usage.set(key, usage.has(key) ? usage.get(key)! + update.count.increment : create.count);
        return { count: usage.get(key)! };
      }),
      updateMany: vi.fn(async ({ where }: { where: { tenantId: string; month: string; metric: string } }) => {
        const key = k(where);
        if ((usage.get(key) ?? 0) > 0) {
          usage.set(key, usage.get(key)! - 1);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
  },
}));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(async () => "haiku"), recordSpend: vi.fn() }));
vi.mock("@/lib/advideo/brief", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/brief")>()), loadAdBrief: vi.fn() }));
vi.mock("@/lib/advideo/write", () => ({ writeAdSpec: vi.fn() }));
vi.mock("@/lib/advideo/voice", () => ({ voiceScenes: vi.fn() }));
vi.mock("@/lib/advideo/refs", () => ({ listRefs: vi.fn(), refImagesForModel: vi.fn() }));
vi.mock("@/lib/advideo/strategy", () => ({ getDailyBrief: vi.fn(), baghdadDate: () => "2026-10-12" }));

import { db } from "@/lib/db";
import { loadAdBrief } from "@/lib/advideo/brief";
import { chooseTier } from "@/lib/ai/meter";
import { dayKey, videosToday, videosUsed } from "@/lib/advideo/limits";
import { monthKey } from "@/lib/billing/limits";
import { SHOP_LIMITS } from "@/lib/shop/plans";
import { AD_MAX_TRIES, AD_PREPARE_LEASE_MS, createAdVideo, prepareAdVideo } from "@/lib/advideo/prepare";
import { listRefs, refImagesForModel } from "@/lib/advideo/refs";
import { AD_ICONS, lookFromSeed, type AdLook } from "@/lib/advideo/spec";
import { getDailyBrief } from "@/lib/advideo/strategy";
import { voiceScenes } from "@/lib/advideo/voice";
import { writeAdSpec } from "@/lib/advideo/write";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("the renderer's icon names", () => {
  it("every icon the director may pick exists in the bundled icon set", () => {
    const raw = gunzipSync(fs.readFileSync(path.join(__dirname, "../../adfilm/assets/icons/lucide.json.gz"))).toString("utf8");
    const set = JSON.parse(raw) as Record<string, unknown> | { icons?: Record<string, unknown> };
    const names = new Set(Object.keys((set as { icons?: Record<string, unknown> }).icons ?? set));
    for (const icon of AD_ICONS) expect(names.has(icon), icon).toBe(true);
  });
});

describe("createAdVideo", () => {
  const as = (...p: string[]) => {
    plans.current = p;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    usage.clear();
    as("MERCHANT");
    for (const [name, t] of Object.entries(m)) if (name !== "usage" && name !== "store") for (const f of Object.values(t)) f.mockReset();
    m.store.findFirst.mockReset().mockResolvedValue({ id: "s1" });
    vi.mocked(chooseTier).mockResolvedValue("haiku");
    m.adVideo.count.mockResolvedValue(0);
    m.adVideo.create.mockResolvedValue({ id: "v1" });
  });
  const input = { tenantId: "t1", storeId: "s1", tier: "LITE" as const, topic: null, productId: null, voice: "shilan", targets: [], autoPost: false, source: "MANUAL" as const, createdById: null };

  it("queues a video and takes its place in the day and in the month", async () => {
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    expect(await videosUsed("t1", "LITE")).toBe(1);
    expect(await videosToday("t1")).toBe(1);
  });

  it("makes at most one video a day, whatever the month allows, and gives the place back when it refuses", async () => {
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "daily" });
    expect(m.adVideo.create).toHaveBeenCalledTimes(1);
    expect(await videosToday("t1")).toBe(1);
    expect(await videosUsed("t1", "LITE")).toBe(1);
  });

  it("refuses a tier the plans do not have: Opus videos belong to the Opus plan alone, which has no Haiku videos", async () => {
    expect(await createAdVideo({ ...input, tier: "PRO" })).toEqual({ ok: false, error: "tier" });
    as("MAX");
    expect(await createAdVideo({ ...input, tier: "LITE" })).toEqual({ ok: false, error: "tier" });
    expect(await createAdVideo({ ...input, tier: "PRO" })).toEqual({ ok: true, id: "v1" });
  });

  it("refuses a month that is used up, and gives the day's place back", async () => {
    usage.set(`t1|${monthKey()}|advideo_lite`, SHOP_LIMITS.MERCHANT.videosPerMonth);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "limit" });
    expect(await videosToday("t1")).toBe(0);
  });

  it("makes no videos on the free plan", async () => {
    as("FREE", "FREE");
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "tier" });
    expect(await createAdVideo({ ...input, tier: "PRO" })).toEqual({ ok: false, error: "tier" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
  });

  it("adds the plans of the workspace's paid stores, and counts free stores once", async () => {
    as("MERCHANT", "FREE", "FREE", "FREE"); // the Merchant plan's month, one a day
    usage.set(`t1|${monthKey()}|advideo_lite`, SHOP_LIMITS.MERCHANT.videosPerMonth - 1);
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    usage.set(`t1|${dayKey()}|advideo_day`, 0);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "limit" });
  });

  it("lets two paid stores make two videos a day", async () => {
    as("MERCHANT", "MERCHANT");
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "daily" });
  });

  it("parallel requests cannot all pass the limit", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => createAdVideo(input)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(m.adVideo.create).toHaveBeenCalledTimes(1);
    expect(await videosToday("t1")).toBe(1);
  });

  it("does not take a fourth video while three are in the making", async () => {
    m.adVideo.count.mockResolvedValue(3);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "busy" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
    expect(await videosToday("t1")).toBe(0);
  });

  it("writes no video when the AI allowance is used up", async () => {
    vi.mocked(chooseTier).mockResolvedValue(null);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "ai" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
    expect(await videosToday("t1")).toBe(0);
  });

  it("gives the place back when the row cannot be written", async () => {
    m.adVideo.create.mockRejectedValue(new Error("db down"));
    await expect(createAdVideo(input)).rejects.toThrow("db down");
    expect(await videosToday("t1")).toBe(0);
    expect(await videosUsed("t1", "LITE")).toBe(0);
  });
});

describe("prepareAdVideo", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", tries: 0, claimedAt: null, productId: null, topic: null, voice: "shilan", ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    m.adVideo.findMany.mockResolvedValue([]);
    vi.mocked(listRefs).mockResolvedValue([]);
    vi.mocked(refImagesForModel).mockResolvedValue([]);
    vi.mocked(getDailyBrief).mockResolvedValue(null);
    vi.mocked(loadAdBrief).mockResolvedValue({ name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product: null, catalog: [], photos: [], refPhotos: 0, refIndices: [], clips: [] });
    vi.mocked(writeAdSpec).mockResolvedValue({
      spec: {
        style: "elegant",
        look: lookFromSeed("s1"),
        scenes: [
          { type: "hook", text: "a", sub: null, voice: "ب", icon: null, photo: null, clip: null },
          { type: "cta", text: "b", sub: null, voice: "ب", icon: null, photo: null, clip: null },
        ],
        caption: "c",
      },
      model: "m",
      fallback: false,
    });
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((scene, i) => ({ scene, url: `https://blob/${i}.mp3` })));
  });

  it("does nothing while the switch is closed", async () => {
    vi.stubEnv("AD_VIDEO_ENABLED", "");
    m.adVideo.findUnique.mockResolvedValue(row());
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(m.adVideo.updateMany).not.toHaveBeenCalled();
  });

  it("makes the job READY with a fresh try count and no lease", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 2 }));
    expect(await prepareAdVideo("v1")).toBe(true);
    const done = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(done.data).toMatchObject({ status: "READY", tries: 0, claimedAt: null });
  });

  const shown = { id: "p9", name: "X", description: null, priceLine: null, photos: ["https://x/p9.jpg"], inStock: true };
  const withProduct = (product: typeof shown | null) =>
    vi.mocked(loadAdBrief).mockResolvedValue({ name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product, catalog: [], photos: product?.photos ?? [], refPhotos: 0, refIndices: [], clips: [] });
  const dayPlan = (over: Record<string, unknown> = {}) => ({
    cached: true,
    brief: { date: "2026-10-12", objective: "sell_product" as const, productId: "p9", why: "x", format: "showcase", priceMode: "engagement" as const, cta: "dm" as const, urgent: false, avoid: [], lookMood: "warm", boost: { worth: false, cities: [], note: "" }, source: "model" as const, model: "m", ...over },
  });

  it("drops the plan's product when it sold out or lost its photo since the plan was made", async () => {
    m.adVideo.findUnique.mockResolvedValue(row());
    vi.mocked(getDailyBrief).mockResolvedValue(dayPlan());
    withProduct({ ...shown, inStock: false });
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(loadAdBrief).toHaveBeenLastCalledWith("s1", null, []);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].plan).toBeNull();
    const done = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(done.data.productId).toBeNull();
  });

  it("lets the owner's own words win over the day's plan", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "ئۆفەری جەژن" }));
    vi.mocked(getDailyBrief).mockResolvedValue(dayPlan());
    withProduct(shown);
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].plan).toBeNull();
    expect(loadAdBrief).toHaveBeenCalledWith("s1", null, []);
  });

  it("aims a video without a product at the one the daily plan picked, and remembers it", async () => {
    withProduct(shown);
    m.adVideo.findUnique.mockResolvedValue(row());
    vi.mocked(getDailyBrief).mockResolvedValue({
      cached: true,
      brief: { date: "2026-10-12", objective: "sell_product", productId: "p9", why: "x", format: "showcase", priceMode: "engagement", cta: "dm", urgent: false, avoid: [], lookMood: "warm", boost: { worth: false, cities: [], note: "" }, source: "model", model: "m" },
    });
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(loadAdBrief).toHaveBeenCalledWith("s1", "p9", []);
    const done = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(done.data).toMatchObject({ status: "READY", productId: "p9" });
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].plan?.objective).toBe("sell_product");
  });

  it("keeps the owner's own product choice over the plan's", async () => {
    withProduct({ ...shown, id: "mine" });
    m.adVideo.findUnique.mockResolvedValue(row({ productId: "mine" }));
    vi.mocked(getDailyBrief).mockResolvedValue({
      cached: true,
      brief: { date: "2026-10-12", objective: "trust", productId: "p9", why: "x", format: "showcase", priceMode: "engagement", cta: "dm", urgent: false, avoid: [], lookMood: "warm", boost: { worth: false, cities: [], note: "" }, source: "rules", model: "rules" },
    });
    await prepareAdVideo("v1");
    expect(loadAdBrief).toHaveBeenCalledWith("s1", "mine", []);
  });

  it("hands the director the looks and hooks of the last videos and goes on without a plan", async () => {
    m.adVideo.findMany.mockResolvedValue([{ spec: { look: lookFromSeed("old"), scenes: [{ type: "hook", text: "هۆکی کۆن" }] } }, { spec: null }]);
    m.adVideo.findUnique.mockResolvedValue(row());
    expect(await prepareAdVideo("v1")).toBe(true);
    const call = vi.mocked(writeAdSpec).mock.calls[0][0];
    expect(call.avoidLooks).toEqual([lookFromSeed("old") as AdLook]);
    expect(call.recentHooks).toEqual(["هۆکی کۆن"]);
    expect(call.plan).toBeNull();
  });

  it("leaves a job another caller is preparing right now", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ claimedAt: new Date(Date.now() - AD_PREPARE_LEASE_MS / 2) }));
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(m.adVideo.updateMany).not.toHaveBeenCalled();
  });

  it("takes over a job whose attempt was cut off, once its lease ended", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, claimedAt: new Date(Date.now() - AD_PREPARE_LEASE_MS * 2) }));
    expect(await prepareAdVideo("v1")).toBe(true);
  });

  it("gives up after the last try and returns the month's video", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: AD_MAX_TRIES - 1 }));
    vi.mocked(voiceScenes).mockRejectedValue(new Error("no voice"));
    expect(await prepareAdVideo("v1")).toBe(false);
    const last = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(last.data).toMatchObject({ status: "FAILED", claimedAt: null });
    // The voice was paid for: the month's place goes back, the day's place stays spent.
    expect(m.usage.updateMany).toHaveBeenCalledTimes(1);
    expect(m.usage.updateMany.mock.calls[0][0]).toMatchObject({ where: { month: expect.stringMatching(/^\d{4}-\d{2}$/) } });
  });

  it("keeps the job QUEUED for another go when tries are left", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 0 }));
    vi.mocked(voiceScenes).mockRejectedValue(new Error("no voice"));
    expect(await prepareAdVideo("v1")).toBe(false);
    const last = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(last.data).toMatchObject({ status: "QUEUED", claimedAt: null });
    expect(m.usage.updateMany).not.toHaveBeenCalled();
  });
});
