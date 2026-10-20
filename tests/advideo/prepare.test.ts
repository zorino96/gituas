import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/advideo/voice", () => ({ voiceScenes: vi.fn(), voiceWasPaid: vi.fn(async () => false) }));
vi.mock("@/lib/advideo/refs", () => ({ listRefs: vi.fn(), refImagesForModel: vi.fn() }));
vi.mock("@/lib/advideo/strategy", () => ({ getDailyBrief: vi.fn(), baghdadDate: () => "2026-10-12" }));
vi.mock("@/lib/shop/profile", () => ({ loadProfile: vi.fn(async () => null) }));

import { db } from "@/lib/db";
import { loadAdBrief } from "@/lib/advideo/brief";
import { chooseTier } from "@/lib/ai/meter";
import { dayKey, videosToday, videosUsed } from "@/lib/advideo/limits";
import { monthKey } from "@/lib/billing/limits";
import { SHOP_LIMITS } from "@/lib/shop/plans";
import { AD_MAX_TRIES, AD_PREPARE_BUDGET_MS, AD_PREPARE_LEASE_MS, createAdVideo, prepareAdVideo, prepareNeedMs, prepareQueued, voiceEstimateMs } from "@/lib/advideo/prepare";
import { listRefs, refImagesForModel } from "@/lib/advideo/refs";
import { AD_ICONS, lookFromSeed, type AdLook } from "@/lib/advideo/spec";
import { getDailyBrief } from "@/lib/advideo/strategy";
import { loadProfile } from "@/lib/shop/profile";
import { voiceScenes, voiceWasPaid } from "@/lib/advideo/voice";
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

describe("createAdVideo: the language and the kind", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usage.clear();
    plans.current = ["MERCHANT"];
    for (const [name, t] of Object.entries(m)) if (name !== "usage" && name !== "store") for (const f of Object.values(t)) f.mockReset();
    m.store.findFirst.mockReset().mockResolvedValue({ id: "s1" });
    vi.mocked(chooseTier).mockResolvedValue("haiku");
    m.adVideo.count.mockResolvedValue(0);
    m.adVideo.create.mockResolvedValue({ id: "v1" });
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("PAWAN_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  const input = { tenantId: "t1", storeId: "s1", tier: "LITE" as const, topic: null, productId: null, voice: "shilan", targets: [], autoPost: false, source: "MANUAL" as const, createdById: null };
  const rowOf = () => (m.adVideo.create.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;

  it("writes the row a Sorani ad always had: no spec, the voice as it was", async () => {
    expect(await createAdVideo({ ...input, topic: "ئۆفەر", productId: null })).toEqual({ ok: true, id: "v1" });
    expect(rowOf()).toEqual({ tenantId: "t1", storeId: "s1", tier: "LITE", source: "MANUAL", topic: "ئۆفەر", productId: null, voice: "shilan", targets: [], autoPost: false, createdById: null });
    expect(rowOf()).not.toHaveProperty("spec");
    // Naming the defaults changes nothing.
    await createAdVideo({ ...input, lang: "ckb", kind: "ad" });
    expect(rowOf()).not.toHaveProperty("spec");
  });

  it("makes a Sorani video without any voice key: it is checked where it was always checked, when the voice speaks", async () => {
    expect(await createAdVideo({ ...input, kind: "story", topic: "a story" })).toEqual({ ok: true, id: "v1" });
    expect(m.adVideo.create).toHaveBeenCalledTimes(1);
  });

  it("refuses an Arabic or English video when Gemini has no key, before it takes the day's place", async () => {
    expect(await createAdVideo({ ...input, lang: "en" })).toEqual({ ok: false, error: "voice" });
    expect(await createAdVideo({ ...input, lang: "ar", kind: "story", topic: "x" })).toEqual({ ok: false, error: "voice" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
    expect(await videosToday("t1")).toBe(0);
    expect(await videosUsed("t1", "LITE")).toBe(0);
    // A Pawan key does not read English.
    vi.stubEnv("PAWAN_API_KEY", "p");
    expect(await createAdVideo({ ...input, lang: "en" })).toEqual({ ok: false, error: "voice" });
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    expect(await createAdVideo({ ...input, lang: "en" })).toEqual({ ok: true, id: "v1" });
  });

  it("keeps the language and the kind in a stub spec, and nothing else", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    await createAdVideo({ ...input, lang: "en" });
    expect(rowOf().spec).toEqual({ lang: "en" });
    usage.clear();
    await createAdVideo({ ...input, lang: "ar", kind: "story", topic: "x" });
    expect(rowOf().spec).toEqual({ lang: "ar", kind: "story" });
    usage.clear();
    await createAdVideo({ ...input, kind: "story", topic: "x" });
    expect(rowOf().spec).toEqual({ kind: "story" });
  });

  it("stores the voice of the language: a Pawan name only for Sorani, male or female for the others", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    await createAdVideo({ ...input, voice: "rebin" });
    expect(rowOf().voice).toBe("rebin");
    usage.clear();
    await createAdVideo({ ...input, voice: "rebin", lang: "en" });
    expect(rowOf().voice).toBe("female");
    usage.clear();
    await createAdVideo({ ...input, voice: "rebin", lang: "en", kind: "story", topic: "x" });
    expect(rowOf().voice).toBe("male");
    usage.clear();
    await createAdVideo({ ...input, voice: "female", lang: "ar", kind: "story", topic: "x" });
    expect(rowOf().voice).toBe("female");
  });

  it("makes a story about no product, with a longer idea than an ad's", async () => {
    const long = "a".repeat(1500);
    await createAdVideo({ ...input, kind: "story", productId: "p1", topic: long });
    expect(m.product.findFirst).not.toHaveBeenCalled();
    expect(rowOf().productId).toBeNull();
    expect(Array.from(rowOf().topic as string)).toHaveLength(1200);
    usage.clear();
    await createAdVideo({ ...input, topic: long });
    expect(Array.from(rowOf().topic as string)).toHaveLength(300);
  });

  it("asks for the idea of a story the owner makes by hand, but lets the daily automation choose its own", async () => {
    expect(await createAdVideo({ ...input, kind: "story", topic: null })).toEqual({ ok: false, error: "topic" });
    expect(await createAdVideo({ ...input, kind: "story", topic: "   " })).toEqual({ ok: false, error: "topic" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
    expect(await videosToday("t1")).toBe(0);
    expect(await createAdVideo({ ...input, kind: "story", topic: null, source: "AUTO" })).toEqual({ ok: true, id: "v1" });
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
    // Nothing was paid for (no clip was made): the month's place and the day's place both go back.
    expect(m.usage.updateMany).toHaveBeenCalledTimes(2);
    expect(m.usage.updateMany.mock.calls[0][0]).toMatchObject({ where: { month: expect.stringMatching(/^\d{4}-\d{2}$/) } });
  });

  it("keeps the day's try spent when a voice clip was already paid for, and gives the month's place back", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: AD_MAX_TRIES - 1 }));
    vi.mocked(voiceScenes).mockRejectedValue(new Error("later scene failed"));
    vi.mocked(voiceWasPaid).mockResolvedValue(true);
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(m.usage.updateMany).toHaveBeenCalledTimes(1);
    expect(m.usage.updateMany.mock.calls[0][0]).toMatchObject({ where: { month: expect.stringMatching(/^\d{4}-\d{2}$/) } });
  });

  it("saves the script before the voice, so a failing voice does not make the director write it again", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tier: "PRO" }));
    vi.mocked(voiceScenes).mockRejectedValue(new Error("pawan 429: busy"));
    await prepareAdVideo("v1");
    const saved = m.adVideo.updateMany.mock.calls.find((c) => (c[0] as { data: Record<string, unknown> }).data.spec)![0] as { data: Record<string, unknown> };
    expect(saved.data).toMatchObject({ caption: "c", model: "m" });
    expect(writeAdSpec).toHaveBeenCalledTimes(1);

    // The next attempt finds the saved script (and no render props) and goes straight to the voice.
    vi.mocked(writeAdSpec).mockClear();
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((scene, i) => ({ scene, url: `https://blob/${i}.mp3` })));
    m.adVideo.findUnique.mockResolvedValue(row({ tier: "PRO", tries: 1, spec: (saved.data.spec as object), props: null, model: "m" }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(writeAdSpec).not.toHaveBeenCalled();
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

describe("prepareAdVideo: the language and the kind", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", tries: 0, claimedAt: null, productId: null, topic: null, voice: "shilan", ...over });
  const brief = { name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: "0750 123 4567", product: null, catalog: [], photos: [], refPhotos: 0, refIndices: [], clips: [] };
  const spec = (over: Record<string, unknown> = {}) => ({
    style: "elegant" as const,
    look: lookFromSeed("s1"),
    scenes: [
      { type: "hook" as const, text: "a", sub: null, voice: "ب", icon: null, photo: null, clip: null },
      { type: "cta" as const, text: "b", sub: null, voice: "ب", icon: null, photo: null, clip: null },
    ],
    caption: "c",
    ...over,
  });
  const updates = () => m.adVideo.updateMany.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    m.adVideo.findMany.mockResolvedValue([]);
    vi.mocked(listRefs).mockResolvedValue([]);
    vi.mocked(refImagesForModel).mockResolvedValue([]);
    vi.mocked(getDailyBrief).mockResolvedValue(null);
    vi.mocked(loadProfile).mockResolvedValue(null);
    vi.mocked(loadAdBrief).mockResolvedValue(brief);
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: spec(), model: "m", fallback: false });
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((scene, i) => ({ scene, url: `https://blob/${i}.mp3` })));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("writes a Sorani ad's script, spec and props with no language or kind in them", async () => {
    m.adVideo.findUnique.mockResolvedValue(row());
    expect(await prepareAdVideo("v1")).toBe(true);
    const saved = updates().filter((d) => d.spec);
    expect(saved).toHaveLength(2);
    for (const d of saved) {
      expect(d.spec).not.toHaveProperty("lang");
      expect(d.spec).not.toHaveProperty("kind");
    }
    const done = updates().at(-1)!;
    expect(done.props).not.toHaveProperty("lang");
    expect(done.props).not.toHaveProperty("kind");
    expect(Object.keys(done.props as object)).toEqual(["version", "size", "style", "look", "plan", "brand", "product", "photos", "clips", "scenes", "music"]);
    // The brief is asked for as it always was (three arguments), and the plan is made.
    expect(loadAdBrief).toHaveBeenCalledWith("s1", null, []);
    expect(getDailyBrief).toHaveBeenCalledTimes(1);
    expect(loadProfile).not.toHaveBeenCalled();
    expect(vi.mocked(voiceScenes).mock.calls[0][0]).toMatchObject({ lang: "ckb", kind: "ad" });
  });

  it("makes an English ad: the language goes to the brief, the writer, the voice, the saved spec and the render props", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "female", spec: { lang: "en" } }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(loadAdBrief).toHaveBeenCalledWith("s1", null, [], { lang: "en", kind: "ad" });
    // The stub holds no scenes: it is not a script an earlier attempt wrote.
    expect(writeAdSpec).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ lang: "en", kind: "ad" });
    expect(vi.mocked(voiceScenes).mock.calls[0][0]).toMatchObject({ lang: "en", kind: "ad", voice: "female" });
    const saved = updates().filter((d) => d.spec);
    // The first save is read back by a retry: it must carry the language.
    expect(saved[0].spec).toMatchObject({ lang: "en" });
    expect(saved[0].spec).not.toHaveProperty("kind");
    expect(saved[1].spec).toMatchObject({ lang: "en" });
    expect(updates().at(-1)!.props).toMatchObject({ lang: "en" });
    expect(updates().at(-1)!.props).not.toHaveProperty("kind");
  });

  it("goes straight to the voice on a retry and keeps the language it finds in the saved script", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "male", tries: 1, props: null, model: "m", spec: spec({ lang: "ar" }) }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(writeAdSpec).not.toHaveBeenCalled();
    expect(vi.mocked(voiceScenes).mock.calls[0][0]).toMatchObject({ lang: "ar", kind: "ad" });
    expect(updates().at(-1)!.props).toMatchObject({ lang: "ar" });
    expect(updates().at(-1)!.spec).toMatchObject({ lang: "ar" });
  });

  it("tells a story nothing of a shop: no daily plan, no product, the channel's own words", async () => {
    vi.mocked(loadProfile).mockResolvedValue({ storeId: "s1", goal: "monetize", goalText: "grow my story channel", category: "content", offerLine: "English mystery stories" } as never);
    vi.mocked(getDailyBrief).mockResolvedValue({ cached: true, brief: { date: "2026-10-12", objective: "sell_product", productId: "p9", why: "x", format: "showcase", priceMode: "engagement", cta: "dm", urgent: false, avoid: [], lookMood: "warm", boost: { worth: false, cities: [], note: "" }, source: "model", model: "m" } });
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: spec({ kind: "story", lang: "en" }), model: "m", fallback: false });
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "male", topic: "A locked room", productId: "p9", spec: { lang: "en", kind: "story" } }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(getDailyBrief).not.toHaveBeenCalled();
    expect(loadAdBrief).toHaveBeenCalledTimes(1);
    expect(loadAdBrief).toHaveBeenCalledWith("s1", null, [], { lang: "en", kind: "story" });
    const w = vi.mocked(writeAdSpec).mock.calls[0][0];
    expect(w).toMatchObject({ lang: "en", kind: "story", plan: null, topic: "A locked room" });
    expect(w.channel).toEqual({ about: "English mystery stories — grow my story channel — category: content" });
    const done = updates().at(-1)!;
    expect(done).toMatchObject({ status: "READY", productId: null });
    expect(done.spec).toMatchObject({ kind: "story", lang: "en" });
    expect(done.props).toMatchObject({ kind: "story", lang: "en", product: null, plan: null, brand: { phone: null }, music: { style: "ambient" } });
    expect(vi.mocked(voiceScenes).mock.calls[0][0]).toMatchObject({ lang: "en", kind: "story", voice: "male" });
  });

  it("goes on without a profile: the writer then has no 'about'", async () => {
    vi.mocked(loadProfile).mockRejectedValue(new Error("db down"));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: spec({ kind: "story" }), model: "m", fallback: false });
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "x", spec: { kind: "story" } }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].channel).toEqual({ about: null });
  });

  it("lets a story that could not be written fail like any job: queued again, never a plain storyboard", async () => {
    vi.mocked(writeAdSpec).mockRejectedValue(new Error("the story could not be written: no hook scene"));
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "x", spec: { kind: "story" } }));
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(updates().at(-1)).toMatchObject({ status: "QUEUED", claimedAt: null, error: expect.stringContaining("story could not be written") });
    expect(voiceScenes).not.toHaveBeenCalled();
  });

  it("takes the looks and hooks to avoid from the last videos of its own kind that have scripts", async () => {
    const old = (kind: string | undefined, hook: string, hasScenes = true) => ({
      spec: { ...(kind ? { kind } : {}), look: lookFromSeed(hook), ...(hasScenes ? { scenes: [{ type: "hook", text: hook }] } : {}) },
    });
    m.adVideo.findMany.mockResolvedValue([old("story", "S1"), old(undefined, "A1"), { spec: { lang: "en" } }, old(undefined, "A2", false), old("story", "S2"), old(undefined, "A3"), { spec: null }]);
    m.adVideo.findUnique.mockResolvedValue(row());
    await prepareAdVideo("v1");
    expect(m.adVideo.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentHooks).toEqual(["A1", "A3"]);

    vi.mocked(writeAdSpec).mockClear();
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: spec({ kind: "story" }), model: "m", fallback: false });
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "x", spec: { kind: "story" } }));
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentHooks).toEqual(["S1", "S2"]);
  });

  it("keeps only the six latest of the twelve it read", async () => {
    m.adVideo.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ spec: { look: lookFromSeed(`o${i}`), scenes: [{ type: "hook", text: `H${i}` }] } })));
    m.adVideo.findUnique.mockResolvedValue(row());
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentHooks).toEqual(["H0", "H1", "H2", "H3", "H4", "H5"]);
  });
});

describe("prepareAdVideo: the time a story has", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", tries: 1, claimedAt: null, productId: null, topic: "A locked room", voice: "shilan", ...over });
  const brief = { name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product: null, catalog: [], photos: [], refPhotos: 0, refIndices: [], clips: [] };
  const scene = (type: "hook" | "story" | "cta", i: number) => ({ type, text: `t${i}`, sub: null, voice: "ب", icon: null, photo: null, clip: null });
  /** A script of n scenes: a hook, n - 2 beats and a closing invitation. */
  const script = (n: number, over: Record<string, unknown> = {}) => ({
    style: "elegant" as const,
    look: lookFromSeed("s1"),
    scenes: Array.from({ length: n }, (_, i) => scene(i === 0 ? "hook" : i === n - 1 ? "cta" : "story", i)),
    caption: "c",
    kind: "story" as const,
    ...over,
  });
  const updates = () => m.adVideo.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    m.adVideo.findMany.mockResolvedValue([]);
    vi.mocked(listRefs).mockResolvedValue([]);
    vi.mocked(refImagesForModel).mockResolvedValue([]);
    vi.mocked(getDailyBrief).mockResolvedValue(null);
    vi.mocked(loadProfile).mockResolvedValue(null);
    vi.mocked(loadAdBrief).mockResolvedValue(brief);
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(8), model: "m", fallback: false });
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((s, i) => ({ scene: s, url: `https://blob/${i}.mp3` })));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("holds the story's writer to the function's deadline", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story" } }));
    const deadline = Date.now() + 52_000;
    await prepareAdVideo("v1", deadline);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ kind: "story", deadline });
  });

  it("gives itself the minute the cron routes give a prepare when it is not told", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story" } }));
    const before = Date.now();
    await prepareAdVideo("v1");
    const d = vi.mocked(writeAdSpec).mock.calls[0][0].deadline!;
    expect(d).toBeGreaterThanOrEqual(before + AD_PREPARE_BUDGET_MS);
    expect(d).toBeLessThanOrEqual(Date.now() + AD_PREPARE_BUDGET_MS);
  });

  it("voices a story at once when the script left enough time", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story" }, voice: "male" }));
    expect(await prepareAdVideo("v1", Date.now() + 50_000)).toBe(true);
    expect(voiceScenes).toHaveBeenCalledTimes(1);
    expect(updates().at(-1)!.data).toMatchObject({ status: "READY", tries: 0 });
  });

  it("saves a Sorani story's script and leaves the voice to the next attempt when the script used the minute, giving the try back", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story" } }));
    // Eight beats read by Pawan one at a time need about 40 s: with 25 s left the script is saved and the job waits.
    expect(await prepareAdVideo("v1", Date.now() + 25_000)).toBe(false);
    expect(voiceScenes).not.toHaveBeenCalled();
    const all = updates();
    expect(all.find((u) => u.data.spec)!.data).toMatchObject({ caption: "c" });
    expect(all.at(-1)).toEqual({ where: { id: "v1", status: "QUEUED", tries: { gt: 0 } }, data: { claimedAt: null, tries: { decrement: 1 } } });
    // Nothing failed: no error written, no allowance given back.
    expect(all.some((u) => "error" in u.data)).toBe(false);
    expect(m.usage.updateMany).not.toHaveBeenCalled();
  });

  it("lets Gemini read three beats at a time: an English story of eight beats needs less than a Sorani one", async () => {
    expect(voiceEstimateMs("ckb", 8)).toBe(40_000);
    expect(voiceEstimateMs("en", 8)).toBe(27_000);
    expect(voiceEstimateMs("ar", 3)).toBe(9_000);
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(8, { lang: "en" }), model: "m", fallback: false });
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story", lang: "en" }, voice: "male" }));
    expect(await prepareAdVideo("v1", Date.now() + 40_000)).toBe(true);
  });

  it("goes straight to the voice on a script it finds, however little time is left: the saved script is the next attempt's work", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ props: null, model: "m", spec: script(8) }));
    expect(await prepareAdVideo("v1", Date.now() + 5_000)).toBe(true);
    expect(writeAdSpec).not.toHaveBeenCalled();
    expect(voiceScenes).toHaveBeenCalledTimes(1);
  });

  it("never splits an ad: its script and voice are one go, as they always were", async () => {
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(8, { kind: undefined }), model: "m", fallback: false });
    m.adVideo.findUnique.mockResolvedValue(row({ topic: null }));
    expect(await prepareAdVideo("v1", Date.now() + 1_000)).toBe(true);
    expect(voiceScenes).toHaveBeenCalledTimes(1);
  });
});

describe("prepareQueued: the time a video needs before it is started", () => {
  const queued = (tier: string, spec: unknown = null) => ({ id: "v1", tier, spec });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.adVideo.findUnique.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("asks 50 s for a PRO video, 30 s for an ad, 45 s for a story still to be written and 30 s for one already written", () => {
    expect(prepareNeedMs({ tier: "PRO" })).toBe(50_000);
    expect(prepareNeedMs({ tier: "PRO", spec: { kind: "story" } })).toBe(50_000);
    expect(prepareNeedMs({ tier: "LITE" })).toBe(30_000);
    expect(prepareNeedMs({ tier: "LITE", spec: null })).toBe(30_000);
    expect(prepareNeedMs({ tier: "LITE", spec: { lang: "en" } })).toBe(30_000);
    expect(prepareNeedMs({ tier: "LITE", spec: { kind: "story" } })).toBe(45_000);
    expect(prepareNeedMs({ tier: "LITE", spec: { kind: "story", lang: "en", scenes: [] } })).toBe(45_000);
    expect(prepareNeedMs({ tier: "LITE", spec: { kind: "story", scenes: [{ type: "hook" }] } })).toBe(30_000);
  });

  it("does not start a LITE story with less than 45 s left, but starts an ad with 30", async () => {
    m.adVideo.findMany.mockResolvedValue([queued("LITE", { kind: "story" })]);
    expect(await prepareQueued(Date.now() + 40_000)).toBe(0);
    expect(m.adVideo.findUnique).not.toHaveBeenCalled();
    await prepareQueued(Date.now() + 50_000);
    expect(m.adVideo.findUnique).toHaveBeenCalledTimes(1);
    m.adVideo.findUnique.mockClear();
    m.adVideo.findMany.mockResolvedValue([queued("LITE")]);
    await prepareQueued(Date.now() + 35_000);
    expect(m.adVideo.findUnique).toHaveBeenCalledTimes(1);
  });

  it("gives the job the same deadline", async () => {
    m.adVideo.findMany.mockResolvedValue([queued("LITE", { kind: "story" })]);
    m.adVideo.findUnique.mockResolvedValue({ id: "v1", status: "QUEUED", tries: 0, claimedAt: null, tenantId: "t1", storeId: "s1", tier: "LITE", topic: "x", voice: "shilan", productId: null, spec: { kind: "story" } });
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(listRefs).mockResolvedValue([]);
    vi.mocked(refImagesForModel).mockResolvedValue([]);
    vi.mocked(loadProfile).mockResolvedValue(null);
    vi.mocked(loadAdBrief).mockResolvedValue({ name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product: null, catalog: [], photos: [], refPhotos: 0, refIndices: [], clips: [] });
    vi.mocked(writeAdSpec).mockRejectedValue(new Error("the story could not be written"));
    const deadline = Date.now() + 55_000;
    await prepareQueued(deadline, 1);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0].deadline).toBe(deadline);
  });
});
