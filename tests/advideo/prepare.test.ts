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
    store: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => plans.current.map((plan) => ({ plan }))), updateMany: vi.fn(async () => ({ count: 1 })) },
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
// The Wikimedia Commons photo finder is never allowed to reach the network from here.
// (its pure helpers stay real; the stored pictures are never deleted from here either)
vi.mock("@/lib/advideo/commons", async (orig) => ({
  ...(await orig<typeof import("@/lib/advideo/commons")>()),
  findStoryPhotos: vi.fn(async () => []),
  deletePhotos: vi.fn(async () => undefined),
  STORY_PHOTO_BUDGET_MS: 16_000,
}));
vi.mock("@/lib/advideo/voice", () => ({ voiceScenes: vi.fn(), voiceWasPaid: vi.fn(async () => false) }));
// Giving the daily automation's day back is auto-day.ts's own job (tested there); here only that it is asked.
vi.mock("@/lib/advideo/auto-day", () => ({ giveBackAutoDay: vi.fn(async () => false) }));
vi.mock("@/lib/advideo/refs", () => ({ listRefs: vi.fn(), refImagesForModel: vi.fn() }));
vi.mock("@/lib/advideo/strategy", () => ({ getDailyBrief: vi.fn(), baghdadDate: () => "2026-10-12" }));
vi.mock("@/lib/shop/profile", () => ({ loadProfile: vi.fn(async () => null) }));

import { db } from "@/lib/db";
import { loadAdBrief } from "@/lib/advideo/brief";
import { chooseTier } from "@/lib/ai/meter";
import { dayKey, videosToday, videosUsed } from "@/lib/advideo/limits";
import { monthKey } from "@/lib/billing/limits";
import { SHOP_LIMITS } from "@/lib/shop/plans";
import { AD_MAX_TRIES, AD_PREPARE_BUDGET_MS, AD_PREPARE_LEASE_MS, createAdVideo, prepareAdVideo, prepareNeedMs, prepareQueued, readPhotoCache, scriptFitsMode, storyEraOf, storyIsCrime, subjectsOfSpecs, voiceEstimateMs } from "@/lib/advideo/prepare";
import { giveBackAutoDay } from "@/lib/advideo/auto-day";
import { deletePhotos, findStoryPhotos } from "@/lib/advideo/commons";
import { fictionLine, type PhotoCredit } from "@/lib/advideo/credits";
import { NO_SUBJECT_NOTE, PLAIN_VIDEO_NOTE, StorySubjectMissing, UNKNOWN_SUBJECT_NOTE } from "@/lib/advideo/job-error";
import { WAIT_FICTION_NOTE, WAIT_MEMORY_NOTE, WAIT_RECENT_NOTE } from "@/lib/advideo/wait-note";
import { listRefs, refImagesForModel } from "@/lib/advideo/refs";
import { AD_ICONS, lookFromSeed, type AdLook } from "@/lib/advideo/spec";
import { getDailyBrief } from "@/lib/advideo/strategy";
import { loadProfile } from "@/lib/shop/profile";
import { voiceScenes, voiceWasPaid } from "@/lib/advideo/voice";
import { writeAdSpec } from "@/lib/advideo/write";
import type { AdScene } from "@/lib/advideo/spec";

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

describe("createAdVideo: YouTube", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    vi.clearAllMocks();
    usage.clear();
    plans.current = ["MERCHANT"];
    for (const [name, t] of Object.entries(m)) if (name !== "usage" && name !== "store") for (const f of Object.values(t)) f.mockReset();
    m.store.findFirst.mockReset().mockResolvedValue({ id: "s1" });
    vi.mocked(chooseTier).mockResolvedValue("haiku");
    m.adVideo.count.mockResolvedValue(0);
    m.adVideo.create.mockResolvedValue({ id: "v1" });
  });
  const input = { tenantId: "t1", storeId: "s1", tier: "LITE" as const, topic: "the Hinterkaifeck murders", productId: null, voice: "male", targets: ["FB", "YT"] as ("FB" | "IG" | "YT")[], autoPost: true, source: "AUTO" as const, createdById: null, lang: "en" as const, kind: "story" as const };
  const created = () => (m.adVideo.create.mock.calls[0][0] as { data: { targets: string[]; spec?: Record<string, unknown> } }).data;

  it("keeps the targets as they are asked for (YouTube too) and writes the owner's answers into the spec stub", async () => {
    expect(await createAdVideo({ ...input, youtube: { privacy: "unlisted", madeForKids: false } })).toEqual({ ok: true, id: "v1" });
    expect(created().targets).toEqual(["FB", "YT"]);
    expect(created().spec).toMatchObject({ lang: "en", kind: "story", youtube: { privacy: "unlisted", madeForKids: false } });
  });

  it("writes them for an ad as well, and an ad's stub is then no longer empty", async () => {
    await createAdVideo({ ...input, kind: "ad", topic: null, lang: "ckb", youtube: { privacy: "private", madeForKids: true } });
    expect(created().spec).toEqual({ youtube: { privacy: "private", madeForKids: true } });
  });

  it("writes nothing when the video is not going to YouTube", async () => {
    await createAdVideo({ ...input, targets: ["FB", "IG"], youtube: { privacy: "public", madeForKids: false } });
    expect(created().spec).not.toHaveProperty("youtube");
  });

  it("writes nothing for answers that are not both valid (a video without them is never uploaded: nothing is guessed)", async () => {
    for (const bad of [undefined, { privacy: "everyone", madeForKids: false }, { privacy: "public" }, { privacy: "public", madeForKids: "no" }, { privacy: "", madeForKids: true }]) {
      m.adVideo.create.mockClear();
      usage.clear();
      await createAdVideo({ ...input, youtube: bad as never });
      expect(created().spec ?? {}, JSON.stringify(bad)).not.toHaveProperty("youtube");
      expect(created().targets).toEqual(["FB", "YT"]);
    }
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

  it("keeps the owner's choice of no photographs in the stub spec, only for a documented story", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    const make = async (extra: Record<string, unknown>) => {
      usage.clear();
      await createAdVideo({ ...input, ...extra });
      return rowOf().spec;
    };
    // an English or Arabic story told from what is documented: the choice is kept
    expect(await make({ lang: "en", kind: "story", topic: "the Hinterkaifeck murders, 1922", photos: false })).toEqual({ lang: "en", kind: "story", noPhotos: true });
    expect(await make({ lang: "ar", kind: "story", topic: "قضية هينتركايفك", photos: false })).toEqual({ lang: "ar", kind: "story", noPhotos: true });
    // photographs on (or not mentioned): nothing is written
    expect(await make({ lang: "en", kind: "story", topic: "the Hinterkaifeck murders, 1922", photos: true })).toEqual({ lang: "en", kind: "story" });
    expect(await make({ lang: "en", kind: "story", topic: "the Hinterkaifeck murders, 1922" })).toEqual({ lang: "en", kind: "story" });
    // a Sorani story is told from what is documented as well (the owner's own language): the choice is kept
    expect(await make({ kind: "story", topic: "x", photos: false })).toEqual({ kind: "story", noPhotos: true });
    // an invented story and an ad have no photographs to switch off
    expect(await make({ lang: "en", kind: "story", topic: "a fictional lighthouse mystery", photos: false })).toEqual({ lang: "en", kind: "story" });
    expect(await make({ kind: "story", topic: "چیرۆکێکی خەیاڵی", photos: false })).toEqual({ kind: "story" });
    expect(await make({ lang: "en", photos: false })).toEqual({ lang: "en" });
    usage.clear();
    await createAdVideo({ ...input, photos: false });
    expect(rowOf()).not.toHaveProperty("spec");
  });

  it("keeps the literal telling of a story in the stub spec (the idea was not reviewed), and only for a story", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    const make = async (extra: Record<string, unknown>) => {
      usage.clear();
      await createAdVideo({ ...input, ...extra });
      return rowOf().spec;
    };
    expect(await make({ lang: "en", kind: "story", topic: "x", literal: true })).toEqual({ lang: "en", kind: "story", literal: true });
    expect(await make({ kind: "story", topic: "x", literal: true })).toEqual({ kind: "story", literal: true });
    expect(await make({ lang: "ar", kind: "story", topic: "a fictional tale", literal: true })).toEqual({ lang: "ar", kind: "story", literal: true });
    expect(await make({ lang: "en", kind: "story", topic: "the Hinterkaifeck murders, 1922", literal: true, photos: false })).toEqual({ lang: "en", kind: "story", noPhotos: true, literal: true });
    // not literal, or not mentioned: nothing is written
    expect(await make({ lang: "en", kind: "story", topic: "x", literal: false })).toEqual({ lang: "en", kind: "story" });
    expect(await make({ lang: "en", kind: "story", topic: "x" })).toEqual({ lang: "en", kind: "story" });
    // an ad has no literal telling
    expect(await make({ lang: "en", literal: true })).toEqual({ lang: "en" });
    usage.clear();
    await createAdVideo({ ...input, literal: true });
    expect(rowOf()).not.toHaveProperty("spec");
  });

  it("keeps the wide (16:9) format in the stub spec, only for a story that asked for it", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    const make = async (extra: Record<string, unknown>) => {
      usage.clear();
      await createAdVideo({ ...input, ...extra });
      return rowOf().spec;
    };
    expect(await make({ lang: "en", kind: "story", topic: "x", format: "wide" })).toEqual({ lang: "en", kind: "story", format: "wide" });
    expect(await make({ kind: "story", topic: "x", format: "wide" })).toEqual({ kind: "story", format: "wide" });
    expect(await make({ lang: "ar", kind: "story", topic: "x", format: "wide", photos: false })).toEqual({ lang: "ar", kind: "story", format: "wide", noPhotos: true });
    // vertical, or not mentioned: nothing is written (the reel is the default)
    expect(await make({ lang: "en", kind: "story", topic: "x", format: "vertical" })).toEqual({ lang: "en", kind: "story" });
    expect(await make({ lang: "en", kind: "story", topic: "x" })).toEqual({ lang: "en", kind: "story" });
    // an ad is always vertical
    expect(await make({ lang: "en", format: "wide" })).toEqual({ lang: "en" });
    usage.clear();
    await createAdVideo({ ...input, format: "wide" });
    expect(rowOf()).not.toHaveProperty("spec");
  });

  it("keeps the decision about fiction, taken once from the owner's own words, in the stub spec, only for a story", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    const make = async (extra: Record<string, unknown>) => {
      usage.clear();
      await createAdVideo({ ...input, ...extra });
      return rowOf().spec;
    };
    expect(await make({ lang: "en", kind: "story", topic: "a lighthouse tale", fiction: true })).toEqual({ lang: "en", kind: "story", fiction: true });
    expect(await make({ kind: "story", topic: "x", fiction: true })).toEqual({ kind: "story", fiction: true });
    // decided against (the topic the video holds may have been rewritten by a review): kept, so that nothing reads the topic again
    expect(await make({ lang: "en", kind: "story", topic: "a fictional-sounding review rewrite", fiction: false })).toEqual({ lang: "en", kind: "story", fiction: false });
    // not decided: nothing is written and the topic is read, as it always was
    expect(await make({ lang: "en", kind: "story", topic: "x" })).toEqual({ lang: "en", kind: "story" });
    // an invented story has no photographs to switch off
    expect(await make({ lang: "en", kind: "story", topic: "the Hinterkaifeck murders, 1922", fiction: true, photos: false })).toEqual({ lang: "en", kind: "story", fiction: true });
    // and the flag decides before the topic does
    expect(await make({ lang: "en", kind: "story", topic: "a fictional tale", fiction: false, photos: false })).toEqual({ lang: "en", kind: "story", fiction: false, noPhotos: true });
    // an ad has no such thing
    expect(await make({ lang: "en", fiction: true })).toEqual({ lang: "en" });
    usage.clear();
    await createAdVideo({ ...input, fiction: true });
    expect(rowOf()).not.toHaveProperty("spec");
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
    m.adVideo.findUnique.mockResolvedValue(row({ props: null, model: "m", spec: script(8, { subject: { name: "Mary Celeste", kind: "real" } }) }));
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

describe("prepareAdVideo: a documented story with photographs", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", tries: 0, claimedAt: null, productId: null, topic: "the Hinterkaifeck murders, 1922", voice: "male", spec: { lang: "en", kind: "story" }, ...over });
  const OWN = (n: number) => `https://x.public.blob.vercel-storage.com/own${n}.jpg`;
  const brief = (photos: string[] = []) => ({ name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product: null, catalog: [], photos, refPhotos: photos.length, refIndices: photos.map((_, i) => i), clips: [] });
  const beat = (type: AdScene["type"], i: number, over: Partial<AdScene> = {}): AdScene => ({ type, text: `t${i}`, sub: null, voice: `v${i}`, icon: null, photo: null, clip: null, ...over });
  const script = (over: Record<string, unknown> = {}) => ({
    style: "elegant" as const,
    look: lookFromSeed("s1"),
    kind: "story" as const,
    lang: "en" as const,
    caption: "A true case that was never solved. #unsolved",
    subject: { name: "Hinterkaifeck murders", kind: "real" as const },
    scenes: [
      beat("hook", 0, { queries: ["Hinterkaifeck farm"], visual: "the farm" }),
      beat("story", 1, { queries: ["Bavaria"], visual: "a road" }),
      beat("story", 2, { queries: ["Munich", "Bavaria 1920"], visual: "a city" }),
      beat("story", 3, { queries: ["Schrobenhausen"], visual: "a town" }),
      beat("cta", 4),
    ],
    ...over,
  });
  const credit = (scene: number, over: Partial<PhotoCredit> = {}): PhotoCredit => ({
    scene, title: `File:Photo ${scene}.jpg`, author: "Jane Doe", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    page: `https://commons.wikimedia.org/wiki/File:Photo_${scene}.jpg`, attribution: true, ...over,
  });
  const shot = (scene: number) => ({ scene, url: `https://x.public.blob.vercel-storage.com/merchant/t1/advideo/v1/img-${scene}-run-1.jpg`, credit: credit(scene), via: "article" as const });
  const updates = () => m.adVideo.updateMany.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  const ready = () => updates().at(-1)!;
  const early = () => updates().find((d) => d.spec && !d.status)!;
  type Specish = { scenes: { photo: number | null; queries?: string[] }[]; caption: string; credits?: PhotoCredit[]; noPhotos?: boolean; subject?: unknown };
  type Propsish = { photos: string[]; scenes: { photo: number | null; queries?: string[]; visual?: string }[] };

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
    vi.mocked(loadAdBrief).mockResolvedValue(brief());
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(), model: "m", fallback: false });
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((s, i) => ({ scene: s, url: `https://blob/vo-${i}.wav` })));
    vi.mocked(voiceWasPaid).mockResolvedValue(false);
    vi.mocked(findStoryPhotos).mockReset().mockResolvedValue([]);
    m.adVideo.findUnique.mockResolvedValue(row());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("tells the writer the mode and that photographs will be looked for", async () => {
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ lang: "en", kind: "story", mode: "real", photos: true, topic: "the Hinterkaifeck murders, 1922" });
  });

  it("looks for a photograph for the hook and every beat that has picture queries, with the subject, and not for the closing invitation", async () => {
    await prepareAdVideo("v1");
    expect(findStoryPhotos).toHaveBeenCalledTimes(1);
    const call = vi.mocked(findStoryPhotos).mock.calls[0][0];
    expect(call).toMatchObject({ tenantId: "t1", jobId: "v1", subject: "Hinterkaifeck murders" });
    expect(call.wanted).toEqual([
      { scene: 0, queries: ["Hinterkaifeck farm"] },
      { scene: 1, queries: ["Bavaria"] },
      { scene: 2, queries: ["Munich", "Bavaria 1920"] },
      { scene: 3, queries: ["Schrobenhausen"] },
    ]);
    expect(call.budgetMs).toBeLessThanOrEqual(16_000);
    expect(call.budgetMs).toBeGreaterThanOrEqual(4_000);
  });

  it("appends the photographs after the owner's pictures and points each beat at its own", async () => {
    vi.mocked(loadAdBrief).mockResolvedValue(brief([OWN(0), OWN(1)]));
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0), shot(1), shot(3)]);
    expect(await prepareAdVideo("v1")).toBe(true);
    const props = ready().props as Propsish;
    expect(props.photos).toEqual([OWN(0), OWN(1), shot(0).url, shot(1).url, shot(3).url]);
    expect(props.scenes.map((s) => s.photo)).toEqual([2, 3, null, 4, null]);
    // the writer's picture queries and notes stay out of what the renderer gets
    for (const s of props.scenes) {
      expect(s).not.toHaveProperty("queries");
      expect(s).not.toHaveProperty("visual");
    }
    // the stored script keeps its beats without photographs (they live in the props)
    const spec = ready().spec as Specish;
    expect(spec.scenes.map((s) => s.photo)).toEqual([null, null, null, null, null]);
    expect(spec.scenes[0].queries).toEqual(["Hinterkaifeck farm"]);
  });

  it("keeps the credits in the spec and puts the photos line in the caption, in the spec and in the column", async () => {
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0), shot(2)]);
    await prepareAdVideo("v1");
    const done = ready();
    const spec = done.spec as Specish;
    expect(spec.credits).toEqual([credit(0), credit(2)]);
    expect(spec.caption).toBe(done.caption);
    expect(spec.caption).toContain("Photos: Wikimedia Commons");
    expect(spec.caption).toContain("Jane Doe");
    expect(spec.caption).toContain("A true case that was never solved.");
    expect(spec.caption.endsWith("#unsolved")).toBe(true);
    expect(Array.from(spec.caption).length).toBeLessThanOrEqual(700);
    // the first save of the script (read back by a retry) holds the writer's plain caption
    expect((early().spec as Specish).caption).toBe("A true case that was never solved. #unsolved");
    expect(early().caption).toBe("A true case that was never solved. #unsolved");
  });

  it("adds no photos line, no credits and no props photos when nothing was found", async () => {
    await prepareAdVideo("v1");
    const done = ready();
    expect(done.caption).toBe("A true case that was never solved. #unsolved");
    expect(done.spec).not.toHaveProperty("credits");
    expect((done.props as Propsish).photos).toEqual([]);
    expect((done.props as Propsish).scenes.every((s) => s.photo === null)).toBe(true);
  });

  it("does not search for a beat that already has one of the owner's pictures or clips", async () => {
    vi.mocked(loadAdBrief).mockResolvedValue(brief([OWN(0)]));
    const s = script();
    s.scenes[1] = beat("story", 1, { photo: 0, queries: ["Bavaria"] });
    s.scenes[2] = beat("story", 2, { clip: 0, queries: ["Munich"] });
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: s, model: "m", fallback: false });
    await prepareAdVideo("v1");
    expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([0, 3]);
    // and the owner's own picture stays where the writer put it
    expect((ready().props as Propsish).scenes[1].photo).toBe(0);
  });

  it("does not search when no beat has picture queries", async () => {
    const s = script();
    s.scenes.forEach((x) => delete x.queries);
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: s, model: "m", fallback: false });
    await prepareAdVideo("v1");
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect(ready()).toMatchObject({ status: "READY" });
  });

  it("honours the owner's choice of no photographs, and keeps it across both saves of the spec", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ spec: { lang: "en", kind: "story", noPhotos: true } }));
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ mode: "real", photos: false });
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect((early().spec as Specish).noPhotos).toBe(true);
    expect((ready().spec as Specish).noPhotos).toBe(true);
    expect((ready().props as Propsish).photos).toEqual([]);
    expect(ready().caption).toBe("A true case that was never solved. #unsolved");
  });

  it("keeps that choice on a retry that finds the saved script, and still searches nothing", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: { ...script(), noPhotos: true } }));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(writeAdSpec).not.toHaveBeenCalled();
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect((ready().spec as Specish).noPhotos).toBe(true);
  });

  it("tells an invented story as fiction: no photograph search, the fiction line added by code, and it may still be posted by itself when the owner asked for fiction", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional lighthouse mystery", spec: { lang: "en", kind: "story", fiction: true } }));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "The lighthouse", kind: "fiction" } }), model: "m", fallback: false });
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ mode: "fiction", photos: false });
    expect(findStoryPhotos).not.toHaveBeenCalled();
    const done = ready();
    expect(done.caption).toContain(fictionLine("en"));
    expect((done.spec as Specish).caption).toBe(done.caption);
    expect(done.spec).not.toHaveProperty("credits");
    expect(done).not.toHaveProperty("autoPost");
    expect((done.props as Propsish).scenes.every((s) => !("queries" in s) && s.photo === null)).toBe(true);
  });

  it("leaves the post of a documented story to the choice made when it was queued (the safety rule is below), and never posts a plain storyboard", async () => {
    await prepareAdVideo("v1");
    expect(ready()).toMatchObject({ status: "READY" });
    expect(ready()).not.toHaveProperty("autoPost");
    // a plain storyboard is not posted, as before
    m.adVideo.updateMany.mockClear();
    m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional tale" }));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(), model: "m", fallback: true });
    await prepareAdVideo("v1");
    expect(ready()).toMatchObject({ autoPost: false });
  });

  it("treats a Sorani story like any other documented story: the owner's own language gets the photographs and the credits too", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "shilan", topic: "x", spec: { kind: "story" } }));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ lang: undefined }), model: "m", fallback: false });
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0), shot(2)]);
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ lang: "ckb", kind: "story", mode: "real", photos: true });
    expect(findStoryPhotos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(voiceScenes).mock.calls[0][0]).toMatchObject({ lang: "ckb", kind: "story", voice: "shilan" });
    const done = ready();
    expect(done).toMatchObject({ status: "READY" });
    expect(done).not.toHaveProperty("autoPost");
    expect((done.spec as Specish).credits).toEqual([credit(0), credit(2)]);
    expect(done.caption).toContain("وێنەکان: ویکیمیدیا کۆمۆنز");
    expect((done.props as Propsish).photos).toEqual([shot(0).url, shot(2).url]);
    expect((done.props as Propsish).scenes.map((s) => s.photo)).toEqual([0, null, 1, null, null]);
    // the language of a Sorani video is still not written into its props
    expect(done.props).not.toHaveProperty("lang");
  });

  it("leaves a Sorani ad and an English ad as they were: no search, no credits, no caption change, no autoPost key", async () => {
    // a Sorani ad
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "shilan", topic: "x", spec: null }));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ lang: undefined, kind: undefined, subject: undefined }), model: "m", fallback: false });
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ lang: "ckb", kind: "ad", mode: "classic" });
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).not.toHaveProperty("recentSubjects");
    expect(vi.mocked(writeAdSpec).mock.calls[0][0]).not.toHaveProperty("literal");
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect(ready()).toMatchObject({ status: "READY", caption: "A true case that was never solved. #unsolved" });
    expect(ready()).not.toHaveProperty("autoPost");
    expect(ready().spec).not.toHaveProperty("credits");
    expect((ready().props as Propsish).photos).toEqual([]);
    // an English ad
    m.adVideo.updateMany.mockClear();
    m.adVideo.findUnique.mockResolvedValue(row({ voice: "female", topic: null, spec: { lang: "en" } }));
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ kind: undefined, subject: undefined }), model: "m", fallback: false });
    await prepareAdVideo("v1");
    expect(vi.mocked(writeAdSpec).mock.calls.at(-1)![0]).toMatchObject({ lang: "en", kind: "ad", mode: "classic" });
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect(ready()).not.toHaveProperty("autoPost");
    // an ad never asks the subject questions: its model call is made exactly as before
    for (const call of vi.mocked(writeAdSpec).mock.calls) {
      expect(call[0]).not.toHaveProperty("recentSubjects");
      expect(call[0]).not.toHaveProperty("literal");
    }
    expect(m.adVideo.findMany).toHaveBeenCalledTimes(2); // one look at the recent videos per attempt, none for subjects
  });

  it("fails a story with no subject at once, with the note, and gives the month and the day back (no voice was paid for)", async () => {
    vi.mocked(writeAdSpec).mockRejectedValue(new StorySubjectMissing("none"));
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(updates().at(-1)).toMatchObject({ status: "FAILED", error: NO_SUBJECT_NOTE, claimedAt: null });
    expect(voiceScenes).not.toHaveBeenCalled();
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect(m.usage.updateMany).toHaveBeenCalledTimes(2);
    expect(vi.mocked(voiceWasPaid)).toHaveBeenCalled();
  });

  it("does the same for a subject the writer does not know well enough, on its first and only try", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 0 }));
    vi.mocked(writeAdSpec).mockRejectedValue(new StorySubjectMissing("unknown"));
    await prepareAdVideo("v1");
    expect(updates().at(-1)).toMatchObject({ status: "FAILED", error: UNKNOWN_SUBJECT_NOTE });
    expect(m.usage.updateMany).toHaveBeenCalledTimes(2);
  });

  it("still tries an ordinary failure again", async () => {
    vi.mocked(writeAdSpec).mockRejectedValue(new Error("the story could not be written: no hook scene"));
    await prepareAdVideo("v1");
    expect(updates().at(-1)).toMatchObject({ status: "QUEUED", claimedAt: null });
    expect(m.usage.updateMany).not.toHaveBeenCalled();
  });

  it("starts the photo search while the voice is still being made", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => {
      await gate;
      return scenes.map((s, i) => ({ scene: s, url: `https://blob/vo-${i}.wav` }));
    });
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
    const run = prepareAdVideo("v1");
    await vi.waitFor(() => expect(voiceScenes).toHaveBeenCalledTimes(1));
    expect(findStoryPhotos).toHaveBeenCalledTimes(1);
    release();
    expect(await run).toBe(true);
    expect((ready().props as Propsish).photos).toEqual([shot(0).url]);
  });

  it("goes on without photographs when the finder fails or hangs, and never fails the job for it", async () => {
    vi.mocked(findStoryPhotos).mockRejectedValue(new Error("commons down"));
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(ready()).toMatchObject({ status: "READY" });
    expect((ready().props as Propsish).photos).toEqual([]);

    m.adVideo.updateMany.mockClear();
    vi.useFakeTimers();
    vi.mocked(findStoryPhotos).mockImplementation(() => new Promise(() => undefined));
    const run = prepareAdVideo("v1", Date.now() + 55_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await run).toBe(true);
    expect(ready()).toMatchObject({ status: "READY" });
    expect(ready().spec).not.toHaveProperty("credits");
  });

  it("throws the photo search away when the voice fails, and the job is tried again as before", async () => {
    vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
    expect(await prepareAdVideo("v1")).toBe(false);
    expect(updates().at(-1)).toMatchObject({ status: "QUEUED", claimedAt: null, error: "gemini 429" });
    expect(updates().some((d) => d.status === "READY")).toBe(false);
  });

  it("keeps the search inside the time the call has: its budget is what is left less 8 s, at most 16 s", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
    await prepareAdVideo("v1", Date.now() + 20_000);
    const b = vi.mocked(findStoryPhotos).mock.calls[0][0].budgetMs;
    expect(b).toBeLessThanOrEqual(12_000);
    expect(b).toBeGreaterThan(11_000);
    vi.mocked(findStoryPhotos).mockClear();
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
    await prepareAdVideo("v1", Date.now() + 120_000);
    expect(vi.mocked(findStoryPhotos).mock.calls[0][0].budgetMs).toBe(16_000);
  });

  it("skips the search when less than 4 s of budget would be left for it, and goes on with the voice", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
    expect(await prepareAdVideo("v1", Date.now() + 10_000)).toBe(true);
    expect(findStoryPhotos).not.toHaveBeenCalled();
    expect(voiceScenes).toHaveBeenCalledTimes(1);
    expect(ready().caption).toBe("A true case that was never solved. #unsolved");
  });

  it("uses no photograph when the voice did not keep every beat (the places would not match)", async () => {
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0), shot(3)]);
    vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.filter((_, i) => i !== 2).map((s, i) => ({ scene: s, url: `https://blob/vo-${i}.wav` })));
    await prepareAdVideo("v1");
    expect((ready().props as Propsish).photos).toEqual([]);
    expect(ready().spec).not.toHaveProperty("credits");
    expect(ready().caption).toBe("A true case that was never solved. #unsolved");
  });

  it("reuses a saved script (queries and subject included) on a retry and searches for its photographs then", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
    vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
    expect(await prepareAdVideo("v1")).toBe(true);
    expect(writeAdSpec).not.toHaveBeenCalled();
    expect(vi.mocked(findStoryPhotos).mock.calls[0][0]).toMatchObject({ subject: "Hinterkaifeck murders" });
    expect((ready().spec as Specish).credits).toEqual([credit(0)]);
  });

  // ---- round 2: the subject, the literal telling, the recent subjects, the photo stage's end, the credits that must fit --------

  const withSubject = (over: Record<string, unknown> = {}) => ({ name: "Hinterkaifeck murders", kind: "real" as const, wiki: "Hinterkaifeck murders", url: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders", ...over });

  it("hands the finder the case's name and the pictures of its Wikipedia article, and a signal it can be stopped with", async () => {
    const images = ["File:Hinterkaifeck-Hof (cropped).jpg", "File:Photo - Hinterkaifeck.jpg"];
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: withSubject({ images }) }), model: "m", fallback: false });
    await prepareAdVideo("v1");
    const call = vi.mocked(findStoryPhotos).mock.calls[0][0];
    expect(call).toMatchObject({ subject: "Hinterkaifeck murders", articleImages: images });
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.signal!.aborted).toBe(false);
    // the subject the code set is kept in the saved spec as it is
    expect((ready().spec as Specish).subject).toEqual(withSubject({ images }));
  });

  it("tells the finder nothing about pictures when the subject has none (an older script, Wikipedia unreachable)", async () => {
    await prepareAdVideo("v1");
    expect(vi.mocked(findStoryPhotos).mock.calls[0][0].articleImages).toBeUndefined();
  });

  describe("the literal telling of a story", () => {
    it("goes to the writer as the owner's words alone: no page profile, no wording of the page's earlier videos", async () => {
      vi.mocked(loadProfile).mockResolvedValue({ storeId: "s1", goal: "monetize", goalText: "grow my channel", category: "content", offerLine: "mystery stories" } as never);
      m.adVideo.findMany.mockResolvedValue([{ spec: { kind: "story", look: lookFromSeed("o"), scenes: [{ type: "hook", text: "OLD HOOK" }] } }]);
      m.adVideo.findUnique.mockResolvedValue(row({ spec: { lang: "en", kind: "story", literal: true } }));
      expect(await prepareAdVideo("v1")).toBe(true);
      const w = vi.mocked(writeAdSpec).mock.calls[0][0];
      expect(w).toMatchObject({ kind: "story", literal: true, topic: "the Hinterkaifeck murders, 1922" });
      expect(w.channel).toBeUndefined();
      expect(w.recentHooks).toEqual([]);
      expect(loadProfile).not.toHaveBeenCalled();
      // the flag survives both saves of the spec, so a retry is literal too
      expect((early().spec as Specish & { literal?: boolean }).literal).toBe(true);
      expect((ready().spec as Specish & { literal?: boolean }).literal).toBe(true);
    });

    it("is not literal unless the stub says so: the profile and the earlier hooks go to the writer as before", async () => {
      vi.mocked(loadProfile).mockResolvedValue({ storeId: "s1", goal: "monetize", goalText: "grow my channel", category: "content", offerLine: "mystery stories" } as never);
      m.adVideo.findMany.mockResolvedValue([{ spec: { kind: "story", look: lookFromSeed("o"), scenes: [{ type: "hook", text: "OLD HOOK" }] } }]);
      await prepareAdVideo("v1");
      const w = vi.mocked(writeAdSpec).mock.calls[0][0];
      expect(w.literal).toBe(false);
      expect(w.channel).toEqual({ about: "mystery stories — grow my channel — category: content" });
      expect(w.recentHooks).toEqual(["OLD HOOK"]);
      expect((ready().spec as Specish & { literal?: boolean }).literal).toBeUndefined();
    });

    it("is kept on a retry that finds the saved script", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: { ...script(), literal: true } }));
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(writeAdSpec).not.toHaveBeenCalled();
      expect((ready().spec as Specish & { literal?: boolean }).literal).toBe(true);
    });
  });

  describe("the cases the page's earlier stories were about", () => {
    const rowsFor = (specs: unknown[]) => m.adVideo.findMany.mockImplementation(async (a: { take: number }) => (a.take === 20 ? specs.map((spec) => ({ spec })) : []));

    it("go to the writer, newest first and without repeats, read from the last 20 stories of the store", async () => {
      rowsFor([
        { kind: "story", subject: { name: "Mary Celeste", kind: "real" } },
        { kind: "story", subject: { name: "Dyatlov Pass incident", kind: "real" } },
        { kind: "story", subject: { name: "mary celeste", kind: "real" } },
        { kind: "story", subject: { name: "  The Lighthouse  ", kind: "fiction" } },
      ]);
      await prepareAdVideo("v1");
      expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentSubjects).toEqual(["Mary Celeste", "Dyatlov Pass incident", "The Lighthouse"]);
      const asked = m.adVideo.findMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; take: number; orderBy: unknown });
      const q = asked.find((a) => a.take === 20)!;
      expect(q.where).toMatchObject({ storeId: "s1", id: { not: "v1" }, spec: { path: ["kind"], equals: "story" } });
      expect(q.orderBy).toEqual({ createdAt: "desc" });
    });

    it("are read tolerantly: a spec of another shape, a missing or empty name, a very long name", async () => {
      rowsFor([null, "text", {}, { subject: null }, { subject: "Mary Celeste" }, { subject: { name: 7 } }, { subject: { name: "   " } }, { subject: { name: "A".repeat(300) } }, { subject: { name: "Titanic" } }]);
      await prepareAdVideo("v1");
      expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentSubjects).toEqual(["A".repeat(100), "Titanic"]);
    });

    it("never fail the job when they cannot be read", async () => {
      m.adVideo.findMany.mockImplementation(async (a: { take: number }) => {
        if (a.take === 20) throw new Error("db down");
        return [];
      });
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(vi.mocked(writeAdSpec).mock.calls[0][0].recentSubjects).toEqual([]);
    });

    it("are not read when the script is already written (a retry), and not for an ad", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
      await prepareAdVideo("v1");
      expect(m.adVideo.findMany.mock.calls.some((c) => (c[0] as { take: number }).take === 20)).toBe(false);
    });

    it("unit: subjectsOfSpecs keeps at most 20", () => {
      const many = Array.from({ length: 40 }, (_, i) => ({ spec: { subject: { name: `Case ${i}` } } }));
      expect(subjectsOfSpecs(many)).toHaveLength(20);
      expect(subjectsOfSpecs([])).toEqual([]);
    });
  });

  describe("a script an earlier attempt saved", () => {
    it("is written again, once, when a documented story's script has no subject (a job queued before subjects existed)", async () => {
      const old = script();
      delete (old as { subject?: unknown }).subject;
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: old }));
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(writeAdSpec).toHaveBeenCalledTimes(1);
      // what is saved now carries the subject the writer set, so the next attempt can reuse it
      expect((early().spec as Specish).subject).toMatchObject({ name: "Hinterkaifeck murders", kind: "real" });
    });

    it("is written again when its subject is not a documented one, or has no name", async () => {
      for (const subject of [{ name: "The lighthouse", kind: "fiction" }, { kind: "real" }, { name: 5, kind: "real" }, "Hinterkaifeck", null]) {
        vi.mocked(writeAdSpec).mockClear();
        m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: { ...script(), subject } }));
        await prepareAdVideo("v1");
        expect(writeAdSpec, JSON.stringify(subject)).toHaveBeenCalledTimes(1);
      }
    });

    it("is kept when it carries the subject, however the owner phrased the idea", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: script() }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).not.toHaveBeenCalled();
    });

    it("is judged by the telling: an invented story keeps a fiction script and rewrites a documented one, and an ad keeps its script whatever it holds", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional tale", tries: 1, props: null, model: "m", spec: script({ subject: { name: "A tale", kind: "fiction" } }) }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).not.toHaveBeenCalled();
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional tale", tries: 1, props: null, model: "m", spec: script() }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).toHaveBeenCalledTimes(1);
      vi.mocked(writeAdSpec).mockClear();
      const ad = script({ kind: undefined, subject: undefined });
      m.adVideo.findUnique.mockResolvedValue(row({ topic: null, tries: 1, props: null, model: "m", spec: { ...ad, lang: "en" } }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).not.toHaveBeenCalled();
    });

    it("unit: scriptFitsMode", () => {
      expect(scriptFitsMode(null, "classic")).toBe(true);
      expect(scriptFitsMode({}, "real")).toBe(false);
      expect(scriptFitsMode({ subject: { name: "X", kind: "real" } }, "real")).toBe(true);
      expect(scriptFitsMode({ subject: { name: "X", kind: "real" } }, "fiction")).toBe(false);
      expect(scriptFitsMode({ subject: { name: "X", kind: "fiction" } }, "fiction")).toBe(true);
      expect(scriptFitsMode(undefined, "fiction")).toBe(false);
    });
  });

  describe("the end of the photo stage", () => {
    it("stops the finder when the voice fails and waits for it, so that nothing goes on behind the failure", async () => {
      let stopped = false;
      let over = false;
      vi.mocked(findStoryPhotos).mockImplementation(
        (o) =>
          new Promise((resolve) => {
            o.signal!.addEventListener("abort", () => {
              stopped = true;
              setTimeout(() => ((over = true), resolve([])), 40); // it takes a moment to stop
            });
          }),
      );
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      expect(await prepareAdVideo("v1")).toBe(false);
      expect(stopped).toBe(true);
      expect(over).toBe(true); // the failure is saved only after the finder had stopped
      expect(updates().at(-1)).toMatchObject({ status: "QUEUED", error: "gemini 429" });
    });

    it("does not wait for ever for a finder that will not stop", async () => {
      vi.useFakeTimers();
      vi.mocked(findStoryPhotos).mockImplementation(() => new Promise(() => undefined));
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      const run = prepareAdVideo("v1", Date.now() + 55_000);
      await vi.advanceTimersByTimeAsync(2_600);
      expect(await run).toBe(false);
      expect(updates().at(-1)).toMatchObject({ status: "QUEUED", error: "gemini 429" });
    });

    it("does not stop the finder when the voice works", async () => {
      let signal: AbortSignal | undefined;
      vi.mocked(findStoryPhotos).mockImplementation(async (o) => {
        signal = o.signal;
        return [shot(0)];
      });
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(signal!.aborted).toBe(false);
    });

    it("budgets the search from what is left once the subject is found and the story written (the writer's time is spent first)", async () => {
      vi.useFakeTimers();
      vi.mocked(writeAdSpec).mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(14_000); // the subject step and the writer
        return { spec: script(), model: "m", fallback: false };
      });
      const run = prepareAdVideo("v1", Date.now() + 37_000);
      expect(await run).toBe(true);
      // 37 s - 14 s - 8 s kept back = 15 s for the search
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].budgetMs).toBe(15_000);
    });
  });

  describe("the photographs the caption can name", () => {
    const named = (scene: number, author: string | null, over: Partial<PhotoCredit> = {}) => ({ ...shot(scene), credit: credit(scene, { author, ...over }) });
    const free = (scene: number) => ({ ...shot(scene), credit: credit(scene, { author: "Old Archive", licence: "Public domain", licenceUrl: null, attribution: false }) });
    const props = () => ready().props as Propsish;
    const specOf = () => ready().spec as Specish;

    it("shows a photograph by an author the caption names, and not one whose author nobody knows", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([named(0, "Jane Doe"), named(1, null), named(2, "  "), free(3)]);
      await prepareAdVideo("v1");
      expect(props().photos).toEqual([shot(0).url, shot(3).url]);
      expect(props().scenes.map((s) => s.photo)).toEqual([0, null, null, 1, null]);
      expect(specOf().credits!.map((c) => c.scene)).toEqual([0, 3]);
      expect(ready().caption).toContain("Jane Doe, CC BY-SA 4.0");
    });

    it("drops the photographs whose authors do not fit in the room the caption has, keeps the free ones, and names every author it shows", async () => {
      const longCaption = `${"A true case that was never solved. ".repeat(17).trim()}\n#unsolved`; // about 600 characters
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ caption: longCaption }), model: "m", fallback: false });
      const authors = ["Photographer Number A", "Photographer Number B", "Photographer Number C", "Photographer Number D"];
      vi.mocked(findStoryPhotos).mockResolvedValue([named(0, authors[0]), named(1, authors[1]), free(2), named(3, authors[3])]);
      await prepareAdVideo("v1");
      const caption = ready().caption as string;
      const shown = specOf().credits!;
      // the free photograph is always there; the others only if the room allowed
      expect(shown.map((c) => c.scene)).toContain(2);
      expect(shown.length).toBeLessThan(4);
      for (const c of shown.filter((x) => x.attribution)) expect(caption).toContain(c.author!);
      for (const c of [named(0, authors[0]), named(1, authors[1]), named(3, authors[3])].map((x) => x.credit).filter((c) => !shown.some((s) => s.scene === c.scene))) {
        expect(caption, `dropped: ${c.author}`).not.toContain(c.author!);
      }
      // a photograph that was dropped is not in the props either
      expect(props().photos).toHaveLength(shown.length);
      expect(Array.from(caption).length).toBeLessThanOrEqual(700);
      expect(caption).toContain("A true case that was never solved.");
      expect(caption.endsWith("#unsolved")).toBe(true);
    });

    it("says in the caption, in the video's language, when some photographs are only illustrations", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([{ ...free(0), credit: { ...free(0).credit, illustrative: true } }]);
      await prepareAdVideo("v1");
      expect(ready().caption).toContain("Photos: Wikimedia Commons, illustrative images");
      expect(specOf().credits![0].illustrative).toBe(true);
    });
  });

  describe("the wide (16:9) format", () => {
    const wideRow = (over: Record<string, unknown> = {}) => row({ spec: { lang: "en", kind: "story", format: "wide" }, ...over });
    const named = (scene: number, author: string | null, over: Partial<PhotoCredit> = {}) => ({ ...shot(scene), credit: credit(scene, { author, ...over }) });
    const free = (scene: number) => ({ ...shot(scene), credit: credit(scene, { author: "Old Archive", licence: "Public domain", licenceUrl: null, attribution: false }) });
    type Wideish = { size: number[]; format?: string; credits?: string[]; kind?: string };

    it("is drawn on a 1920x1080 frame: the size and the format are in the render props, and the photograph finder is asked for the wide frame", async () => {
      m.adVideo.findUnique.mockResolvedValue(wideRow());
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
      expect(await prepareAdVideo("v1")).toBe(true);
      const props = ready().props as Wideish;
      expect(props.size).toEqual([1920, 1080]);
      expect(props.format).toBe("wide");
      expect(props.kind).toBe("story");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0]).toMatchObject({ format: "wide" });
    });

    it("is kept in the spec, with the script saved first and with the finished video", async () => {
      m.adVideo.findUnique.mockResolvedValue(wideRow());
      await prepareAdVideo("v1");
      expect((early().spec as { format?: string }).format).toBe("wide");
      expect((ready().spec as { format?: string }).format).toBe("wide");
    });

    it("is the vertical reel as it was when the stub has no format: no format in the props, the 1080x1920 size, the finder asked for the portrait frame", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
      expect(await prepareAdVideo("v1")).toBe(true);
      const props = ready().props as Wideish;
      expect(props.size).toEqual([1080, 1920]);
      expect(props).not.toHaveProperty("format");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0]).toMatchObject({ format: "vertical" });
      expect(ready().spec).not.toHaveProperty("format");
    });

    it("is never an ad's: an ad whose stub says wide is the vertical ad it always was", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: null, spec: { lang: "en", format: "wide" } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ kind: undefined, subject: undefined }), model: "m", fallback: false });
      expect(await prepareAdVideo("v1")).toBe(true);
      const props = ready().props as Wideish;
      expect(props.size).toEqual([1080, 1920]);
      expect(props).not.toHaveProperty("format");
      expect(findStoryPhotos).not.toHaveBeenCalled();
    });

    it("has its photo credits as the few lines of the closing scene: the label, then the authors with their licences", async () => {
      m.adVideo.findUnique.mockResolvedValue(wideRow());
      vi.mocked(findStoryPhotos).mockResolvedValue([named(0, "Jane Doe"), free(1), named(2, "Andreas Biegleder", { licence: "CC BY 2.0" })]);
      await prepareAdVideo("v1");
      const props = ready().props as Wideish;
      expect(props.credits![0]).toBe("Photos: Wikimedia Commons");
      expect(props.credits!.slice(1).join(" ")).toContain("Jane Doe, CC BY-SA 4.0");
      expect(props.credits!.slice(1).join(" ")).toContain("Andreas Biegleder, CC BY 2.0");
      expect(props.credits!.length).toBeLessThanOrEqual(3);
      // the same photographs are named in the post
      expect(ready().caption).toContain("Jane Doe, CC BY-SA 4.0");
    });

    it("writes the credit lines for a vertical story too, and none when no photograph was used (the props of a story with no credits are unchanged)", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([named(0, "Jane Doe")]);
      await prepareAdVideo("v1");
      expect((ready().props as Wideish).credits).toEqual(["Photos: Wikimedia Commons", "Jane Doe, CC BY-SA 4.0"]);
      vi.mocked(findStoryPhotos).mockResolvedValue([]);
      m.adVideo.updateMany.mockClear();
      await prepareAdVideo("v1");
      expect(ready().props).not.toHaveProperty("credits");
      expect(ready().spec).not.toHaveProperty("credits");
    });

    it("keeps only the photographs whose authors fit the closing scene: a vertical frame holds fewer lines than a wide one", async () => {
      const four = [named(0, "Photographer Number A"), named(1, "Photographer Number B"), named(2, "Photographer Number C"), named(3, "Photographer Number D")];
      vi.mocked(findStoryPhotos).mockResolvedValue(four);
      await prepareAdVideo("v1");
      const vertical = ready().spec as Specish;
      expect(vertical.credits!.length).toBeGreaterThan(0);
      expect(vertical.credits!.length).toBeLessThan(4);
      m.adVideo.updateMany.mockClear();
      m.adVideo.findUnique.mockResolvedValue(wideRow());
      await prepareAdVideo("v1");
      expect((ready().spec as Specish).credits).toHaveLength(4);
      // every photograph that is shown is named on the picture
      const lines = ((ready().props as Wideish).credits ?? []).join(" ");
      for (const c of (ready().spec as Specish).credits!) expect(lines).toContain(c.author!);
    });

    it("puts the Sorani credit label in Sorani letters, on the screen and in the post", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ spec: { kind: "story", format: "wide" } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ lang: undefined }), model: "m", fallback: false });
      vi.mocked(findStoryPhotos).mockResolvedValue([named(0, "Jane Doe")]);
      await prepareAdVideo("v1");
      expect((ready().props as Wideish).credits![0]).toBe("وێنەکان: ویکیمیدیا کۆمۆنز");
      expect(ready().caption).toContain("وێنەکان: ویکیمیدیا کۆمۆنز");
    });
  });

  describe("what the photograph finder is told about the story", () => {
    const withTexts = (texts: [number, string][], subject = "Hinterkaifeck murders", caption = "A true case that was never solved. #unsolved") => {
      const s = script({ caption, subject: { name: subject, kind: "real" as const } });
      for (const [i, text] of texts) s.scenes[i] = { ...s.scenes[i], text };
      return s;
    };

    it("gives the years of the story, read from its own words, so that a modern photograph is not used", async () => {
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: withTexts([[0, "Bavaria, March 1922"], [2, "The trial of 1923"]]), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].era).toEqual({ from: 1922, to: 1923 });
    });

    it("gives no years when the story names none, and prefers the subject's own era when the writer set one", async () => {
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].era).toBeNull();
      const s = withTexts([[0, "March 1922"]]);
      (s.subject as unknown as { era: unknown }).era = { from: 1900, to: 1935 };
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: s, model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[1][0].era).toEqual({ from: 1900, to: 1935 });
    });

    it("says whether the story is about a crime or a death, so that photographs of people are refused only for one", async () => {
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].crime).toBe(true);
      const calm = script({ caption: "A town under ash. #history", subject: { name: "Eruption of Vesuvius", kind: "real" as const } });
      calm.scenes = calm.scenes.map((s, i) => ({ ...s, text: `Beat ${i}`, queries: s.queries?.map(() => "Pompeii street"), visual: "a street" }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: calm, model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[1][0].crime).toBe(false);
    });

    it("unit: storyEraOf and storyIsCrime", () => {
      const s = withTexts([[1, "Winter 1921"]]);
      expect(storyEraOf(s)).toEqual({ from: 1921, to: 1921 });
      expect(storyEraOf({ ...s, scenes: [], caption: "", subject: { era: { from: 3000, to: 3001 } } })).toBeNull();
      expect(storyEraOf({ ...s, scenes: [], caption: "", subject: { era: { from: 1950, to: 1940 } } })).toBeNull();
      expect(storyIsCrime(s)).toBe(true);
      expect(storyIsCrime({ scenes: [], caption: "" })).toBe(false);
    });
  });

  describe("the owner's own words decide whether a story is fiction (the stub's flag)", () => {
    it("follows the flag first: a real topic with fiction asked is an invented story, and a topic that says fiction with the flag against is a real one", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "the Hinterkaifeck murders, 1922", spec: { lang: "en", kind: "story", fiction: true } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "A tale", kind: "fiction" as const } }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ mode: "fiction", photos: false });
      expect(findStoryPhotos).not.toHaveBeenCalled();
      expect((early().spec as { fiction?: unknown }).fiction).toBe(true);
      expect((ready().spec as { fiction?: unknown }).fiction).toBe(true);

      vi.mocked(writeAdSpec).mockClear();
      m.adVideo.updateMany.mockClear();
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional tale, rewritten by the review", spec: { lang: "en", kind: "story", fiction: false } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ mode: "real", photos: true });
      // the decision "not fiction" is kept while the video is queued, and is not in the finished spec (which says fiction only when it is)
      expect((early().spec as { fiction?: unknown }).fiction).toBe(false);
      expect(ready().spec).not.toHaveProperty("fiction");
    });

    it("keeps the decision through a retry that reuses the saved script, and still leaves it out of the finished spec when it is 'not fiction'", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional tale", tries: 1, props: null, model: "m", spec: { ...script(), fiction: false } }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).not.toHaveBeenCalled();
      expect(ready().spec).not.toHaveProperty("fiction");
      m.adVideo.updateMany.mockClear();
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "the Hinterkaifeck murders", tries: 1, props: null, model: "m", spec: { ...script({ subject: { name: "A tale", kind: "fiction" as const } }), fiction: true } }));
      await prepareAdVideo("v1");
      expect((ready().spec as { fiction?: unknown }).fiction).toBe(true);
    });

    it("reads the topic only for a stub with no flag (a video queued before the flag existed)", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: "a fictional lighthouse tale", spec: { lang: "en", kind: "story" } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "A tale", kind: "fiction" as const } }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(writeAdSpec).mock.calls[0][0]).toMatchObject({ mode: "fiction" });
    });
  });

  describe("a story told from memory (no article was read)", () => {
    it("shows its photographs as illustrations, says so in the caption and the credits, and is never posted by itself", async () => {
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "Franklin's lost expedition", kind: "real" as const, fromMemory: true } as never }), model: "m", fallback: false });
      vi.mocked(findStoryPhotos).mockResolvedValue([{ ...shot(0), credit: credit(0, { author: "Jane Doe" }) }]);
      await prepareAdVideo("v1");
      expect((ready().spec as Specish).credits![0].illustrative).toBe(true);
      expect(ready().caption).toContain("Photos: Wikimedia Commons, illustrative images");
      expect(ready()).toMatchObject({ autoPost: false });
      expect(((ready().props as { credits?: string[] }).credits ?? [])[0]).toBe("Photos: Wikimedia Commons, illustrative images");
    });

    it("keeps the subject as the writer set it: no link of an article that was not read is added", async () => {
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "Franklin's lost expedition", kind: "real" as const, fromMemory: true } as never }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      const subject = (ready().spec as { subject: Record<string, unknown> }).subject;
      expect(subject).toMatchObject({ name: "Franklin's lost expedition", fromMemory: true });
      expect(subject).not.toHaveProperty("url");
      expect(subject).not.toHaveProperty("wiki");
    });
  });

  describe("the photographs an earlier attempt found (kept in the spec)", () => {
    const stored = (scene: number, over: Record<string, unknown> = {}) => ({ scene, url: `https://x.public.blob.vercel-storage.com/merchant/t1/advideo/v1/img-${scene}-run-1.jpg`, via: "article", credit: credit(scene), ...over });
    const saved = (shots: unknown[], format = "vertical", extra: Record<string, unknown> = {}) => row({ tries: 1, props: null, model: "m", spec: { ...script(), photoCache: { format, shots }, ...extra } });

    it("are used again when the script is reused: only the beats without one are searched for", async () => {
      m.adVideo.findUnique.mockResolvedValue(saved([stored(0), stored(2)]));
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(1)]);
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(writeAdSpec).not.toHaveBeenCalled();
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([1, 3]);
      const props = ready().props as Propsish;
      expect(props.photos).toEqual([stored(0).url, shot(1).url, stored(2).url]);
      expect(props.scenes.map((s) => s.photo)).toEqual([0, 1, 2, null, null]);
      expect((ready().spec as Specish).credits!.map((c) => c.scene)).toEqual([0, 1, 2]);
      // the finished spec does not carry the cache
      expect(ready().spec).not.toHaveProperty("photoCache");
      expect(deletePhotos).not.toHaveBeenCalled();
    });

    it("do not start a search at all when every beat already has one", async () => {
      m.adVideo.findUnique.mockResolvedValue(saved([stored(0), stored(1), stored(2), stored(3)]));
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(findStoryPhotos).not.toHaveBeenCalled();
      expect((ready().props as Propsish).photos).toHaveLength(4);
    });

    it("are used only in the frame they were made for: a wide story's cache is not a vertical one's", async () => {
      m.adVideo.findUnique.mockResolvedValue(saved([stored(0)], "wide"));
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([0, 1, 2, 3]);
      m.adVideo.findUnique.mockResolvedValue(saved([stored(0)], "wide", { format: "wide" }));
      vi.mocked(findStoryPhotos).mockClear();
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([1, 2, 3]);
    });

    it("are ignored when they are not complete or not this video's own (a tampered or stale entry is never used)", async () => {
      m.adVideo.findUnique.mockResolvedValue(
        saved([
          stored(0, { url: "https://x.public.blob.vercel-storage.com/merchant/t2/advideo/v1/img-0-run-1.jpg" }),
          stored(1, { url: "https://x.public.blob.vercel-storage.com/merchant/t1/advideo/v2/img-1-run-1.jpg" }),
          stored(2, { url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Farm.jpg" }),
          stored(3, { via: "elsewhere" }),
          stored(9),
          stored(-1),
          { scene: 1, url: stored(1).url },
          null,
          "x",
        ]),
      );
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([0, 1, 2, 3]);
    });

    it("are not used after a new script (their beats are gone) and are deleted", async () => {
      const old = script();
      delete (old as { subject?: unknown }).subject;
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: { ...old, photoCache: { format: "vertical", shots: [stored(0), stored(1)] } } }));
      await prepareAdVideo("v1");
      expect(writeAdSpec).toHaveBeenCalledTimes(1);
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([0, 1, 2, 3]);
      expect(deletePhotos).toHaveBeenCalledWith([stored(0).url, stored(1).url]);
      expect(ready().spec).not.toHaveProperty("photoCache");
    });

    it("are saved in the spec when the voice fails, with the script, so that the next attempt does not search again", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(0), shot(2)]);
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      expect(await prepareAdVideo("v1")).toBe(false);
      const cacheSave = updates().find((d) => d.spec && (d.spec as { photoCache?: unknown }).photoCache)!;
      expect(cacheSave).toBeTruthy();
      const spec = cacheSave.spec as { photoCache: { format: string; shots: { scene: number; url: string; via: string; credit: PhotoCredit }[] }; scenes: unknown[]; subject: unknown };
      expect(spec.photoCache.format).toBe("vertical");
      expect(spec.photoCache.shots.map((s) => [s.scene, s.url, s.via])).toEqual([[0, shot(0).url, "article"], [2, shot(2).url, "article"]]);
      expect(spec.photoCache.shots[0].credit).toEqual(credit(0));
      // the script is in it as well (the cache is only valid for that script), and the job goes back in the queue
      expect(spec.scenes).toHaveLength(5);
      expect(updates().at(-1)).toMatchObject({ status: "QUEUED", error: "gemini 429" });
      // a retry finds them
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec }));
      vi.mocked(voiceScenes).mockImplementation(async ({ scenes }) => scenes.map((s, i) => ({ scene: s, url: `https://blob/vo-${i}.wav` })));
      vi.mocked(findStoryPhotos).mockClear().mockResolvedValue([]);
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].wanted.map((w) => w.scene)).toEqual([1, 3]);
      expect((ready().props as Propsish).photos).toEqual([shot(0).url, shot(2).url]);
    });

    it("are deleted when the job fails for good, with the ones the last attempt found", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 2, props: null, model: "m", spec: { ...script(), photoCache: { format: "vertical", shots: [stored(0)] } } }));
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(1)]);
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      expect(await prepareAdVideo("v1")).toBe(false);
      expect(updates().at(-1)).toMatchObject({ status: "FAILED" });
      expect(deletePhotos).toHaveBeenLastCalledWith(expect.arrayContaining([stored(0).url, shot(1).url]));
    });

    it("are not deleted when the job will be tried again", async () => {
      vi.mocked(findStoryPhotos).mockResolvedValue([shot(0)]);
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      await prepareAdVideo("v1");
      expect(deletePhotos).not.toHaveBeenCalled();
    });

    it("deletes the ones the video does not use: dropped for their credits, or for a beat the voice lost", async () => {
      const four = [0, 1, 2, 3].map((i) => ({ ...shot(i), credit: credit(i, { author: `Photographer Number ${"ABCD"[i]}` }) }));
      vi.mocked(findStoryPhotos).mockResolvedValue(four);
      await prepareAdVideo("v1");
      const used = new Set((ready().props as Propsish).photos);
      const dropped = four.map((f) => f.url).filter((u) => !used.has(u));
      expect(dropped.length).toBeGreaterThan(0);
      expect(deletePhotos).toHaveBeenLastCalledWith(dropped);
    });

    it("unit: readPhotoCache is tolerant of any spec", () => {
      const o = { tenantId: "t1", jobId: "v1", format: "vertical" as const, scenes: 5 };
      for (const spec of [null, undefined, 5, "x", {}, { photoCache: null }, { photoCache: { format: "vertical" } }, { photoCache: { format: "vertical", shots: "no" } }]) {
        expect(readPhotoCache(spec, o), JSON.stringify(spec)).toEqual([]);
      }
      const one = readPhotoCache({ photoCache: { format: "vertical", shots: [stored(1), stored(1, { url: stored(1).url + "x" })] } }, o);
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ scene: 1, via: "article" });
    });
  });

  describe("the safety rule: what is posted by itself", () => {
    const wanted = (over: Record<string, unknown> = {}) => row({ autoPost: true, source: "AUTO", ...over });
    const told = (subject: Record<string, unknown>) => vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "Hinterkaifeck murders", kind: "real" as const, ...subject } as never }), model: "m", fallback: false });
    const WIKI = { wiki: "Hinterkaifeck murders", url: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders" };

    it("leaves the post to the choice that was made when the story was told from an article that was read, about a case that is not recent", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted());
      told(WIKI);
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(ready()).toMatchObject({ status: "READY", error: null });
      expect(ready()).not.toHaveProperty("autoPost");
    });

    it("keeps a story told from memory as a draft, with a plain note for the owner", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted());
      told({ fromMemory: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ status: "READY", autoPost: false, error: WAIT_MEMORY_NOTE });
    });

    it("keeps a story about a recent case (people in it may be alive) as a draft, with a plain note", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted());
      told({ ...WIKI, recent: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ status: "READY", autoPost: false, error: WAIT_RECENT_NOTE });
    });

    it("names memory before a recent case", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted());
      told({ fromMemory: true, recent: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ autoPost: false, error: WAIT_MEMORY_NOTE });
    });

    it("holds the story of a video the owner made by hand the same way: his choice to post it when it is ready does not outrank the rule", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted({ source: "MANUAL" }));
      told({ fromMemory: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ autoPost: false, error: WAIT_MEMORY_NOTE });
      m.adVideo.updateMany.mockClear();
      m.adVideo.findUnique.mockResolvedValue(wanted({ source: "MANUAL" }));
      told(WIKI);
      await prepareAdVideo("v1");
      expect(ready()).not.toHaveProperty("autoPost");
    });

    it("gives no note to a video that was never meant to be posted (it is a draft either way)", async () => {
      m.adVideo.findUnique.mockResolvedValue(row());
      told({ fromMemory: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ autoPost: false, error: null });
    });

    it("posts an invented story by itself only when the owner's own words asked for fiction (the stub's flag), and holds one told as fiction by a guess", async () => {
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "The lighthouse", kind: "fiction" } }), model: "m", fallback: false });
      m.adVideo.findUnique.mockResolvedValue(wanted({ topic: "a fictional lighthouse mystery", spec: { lang: "en", kind: "story", fiction: true } }));
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ status: "READY", error: null });
      expect(ready()).not.toHaveProperty("autoPost");
      m.adVideo.updateMany.mockClear();
      m.adVideo.findUnique.mockResolvedValue(wanted({ topic: "a fictional lighthouse mystery", spec: { lang: "en", kind: "story" } }));
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ autoPost: false, error: WAIT_FICTION_NOTE });
    });

    it("still holds a plain storyboard (the AI could not write the story), with the note it always had", async () => {
      m.adVideo.findUnique.mockResolvedValue(wanted());
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script(), model: "m", fallback: true });
      await prepareAdVideo("v1");
      expect(ready()).toMatchObject({ autoPost: false, error: PLAIN_VIDEO_NOTE });
    });

    it("never holds or notes an ad (its post is as it always was)", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ autoPost: true, topic: null, spec: { lang: "en" } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ kind: undefined, subject: undefined }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(ready()).not.toHaveProperty("autoPost");
      expect(ready()).toMatchObject({ error: null });
    });
  });

  describe("the owner's answers for YouTube", () => {
    const YT = { privacy: "unlisted" as const, madeForKids: false };

    it("are kept with every save of the spec, and are never part of the picture (the render props)", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ autoPost: true, spec: { lang: "en", kind: "story", youtube: YT } }));
      await prepareAdVideo("v1");
      expect((early().spec as { youtube?: unknown }).youtube).toEqual(YT);
      expect((ready().spec as { youtube?: unknown }).youtube).toEqual(YT);
      expect(JSON.stringify(ready().props)).not.toContain("unlisted");
      expect(ready().props).not.toHaveProperty("youtube");
    });

    it("are kept on a retry that finds the saved script", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 1, props: null, model: "m", spec: { ...script({ subject: { name: "Hinterkaifeck murders", kind: "real" as const } }), youtube: YT } }));
      expect(await prepareAdVideo("v1")).toBe(true);
      expect(writeAdSpec).not.toHaveBeenCalled();
      expect((ready().spec as { youtube?: unknown }).youtube).toEqual(YT);
    });

    it("are read only when both are valid: a stub with a wrong privacy or an audience that is not true or false keeps nothing", async () => {
      for (const bad of [{ privacy: "everyone", madeForKids: false }, { privacy: "public" }, { privacy: "public", madeForKids: "no" }, "public", null]) {
        m.adVideo.updateMany.mockClear();
        m.adVideo.findUnique.mockResolvedValue(row({ spec: { lang: "en", kind: "story", youtube: bad } }));
        await prepareAdVideo("v1");
        expect(ready().spec, JSON.stringify(bad)).not.toHaveProperty("youtube");
      }
    });

    it("go with an ad as well (the daily routine's ad may be posted to YouTube)", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ topic: null, spec: { lang: "en", youtube: YT } }));
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ kind: undefined, subject: undefined }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect((ready().spec as { youtube?: unknown }).youtube).toEqual(YT);
    });
  });

  describe("the photographs, saved as they arrive", () => {
    it("writes the cache of the spec while the voice is still being made, so a function cut off at its time limit leaves the next attempt the list", async () => {
      vi.mocked(findStoryPhotos).mockImplementation(async (o) => {
        o.onPhoto?.(shot(0));
        o.onPhoto?.(shot(2));
        return [shot(0), shot(2)];
      });
      // the voice never answers: the function is killed here, nothing after it runs
      vi.mocked(voiceScenes).mockImplementation(() => new Promise(() => undefined));
      void prepareAdVideo("v1");
      await new Promise((r) => setTimeout(r, 60));
      const saves = updates().filter((d) => d.spec && (d.spec as { photoCache?: unknown }).photoCache);
      expect(saves.length).toBeGreaterThanOrEqual(2);
      const last = saves.at(-1)!.spec as { photoCache: { format: string; shots: { scene: number; url: string }[] }; scenes: unknown[] };
      expect(last.photoCache.shots.map((s) => [s.scene, s.url])).toEqual([[0, shot(0).url], [2, shot(2).url]]);
      expect(last.photoCache.format).toBe("vertical");
      expect(last.scenes).toHaveLength(5);
      // nothing was made READY: the job still waits for the voice
      expect(updates().some((d) => d.status === "READY")).toBe(false);
    });

    it("keeps the stored files on the list of what to delete when the job fails for good, even when the voice failed before the finder returned", async () => {
      m.adVideo.findUnique.mockResolvedValue(row({ tries: 2, props: null, model: "m", spec: script() }));
      vi.mocked(findStoryPhotos).mockImplementation(async (o) => {
        o.onPhoto?.(shot(1));
        return [shot(1)];
      });
      vi.mocked(voiceScenes).mockRejectedValue(new Error("gemini 429"));
      expect(await prepareAdVideo("v1")).toBe(false);
      expect(deletePhotos).toHaveBeenLastCalledWith(expect.arrayContaining([shot(1).url]));
    });

    it("tells the finder that a recent case is recent", async () => {
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[0][0].recent).toBe(false);
      vi.mocked(writeAdSpec).mockResolvedValue({ spec: script({ subject: { name: "Isdal Woman", kind: "real" as const, recent: true } as never }), model: "m", fallback: false });
      await prepareAdVideo("v1");
      expect(vi.mocked(findStoryPhotos).mock.calls[1][0].recent).toBe(true);
    });

    it("hands the finder a callback that records each photograph (it is called after the stage is begun, and an error in saving never reaches it)", async () => {
      await prepareAdVideo("v1");
      expect(typeof vi.mocked(findStoryPhotos).mock.calls[0][0].onPhoto).toBe("function");
    });
  });

  describe("the daily automation's day when its story could not be made", () => {
    const failing = (over: Record<string, unknown> = {}) =>
      row({ source: "AUTO", topic: null, tries: 2, createdAt: new Date("2026-10-21T08:00:00Z"), spec: { lang: "en", kind: "story" }, ...over });

    beforeEach(() => {
      vi.mocked(giveBackAutoDay).mockReset().mockResolvedValue(true);
      vi.mocked(writeAdSpec).mockRejectedValue(new Error("the model is down"));
    });

    it("is offered back (auto-day.ts decides) when the story fails for good before any voice was paid: with the job and 'no voice paid'", async () => {
      m.adVideo.findUnique.mockResolvedValue(failing());
      expect(await prepareAdVideo("v1")).toBe(false);
      expect(updates().at(-1)).toMatchObject({ status: "FAILED" });
      expect(giveBackAutoDay).toHaveBeenCalledTimes(1);
      expect(vi.mocked(giveBackAutoDay).mock.calls[0][0]).toMatchObject({ storeId: "s1", source: "AUTO", createdAt: new Date("2026-10-21T08:00:00Z"), spec: { lang: "en", kind: "story" } });
      expect(vi.mocked(giveBackAutoDay).mock.calls[0][1]).toEqual({ voicePaid: false });
    });

    it("says so when a voice was paid for (the day then stays spent)", async () => {
      vi.mocked(voiceWasPaid).mockResolvedValue(true);
      m.adVideo.findUnique.mockResolvedValue(failing());
      await prepareAdVideo("v1");
      expect(vi.mocked(giveBackAutoDay).mock.calls[0][1]).toEqual({ voicePaid: true });
    });

    it("is not offered while the job will be tried again, nor when the job was not the one that failed (another caller took it)", async () => {
      m.adVideo.findUnique.mockResolvedValue(failing({ tries: 0 }));
      await prepareAdVideo("v1");
      expect(giveBackAutoDay).not.toHaveBeenCalled();
      m.adVideo.findUnique.mockResolvedValue(failing());
      m.adVideo.updateMany.mockImplementation(async (arg: { data?: { status?: string } }) => ({ count: arg?.data?.status === "FAILED" ? 0 : 1 }));
      await prepareAdVideo("v1");
      expect(giveBackAutoDay).not.toHaveBeenCalled();
    });

    it("never changes the outcome of the failure: a giving back that fails is only the housekeeping's problem", async () => {
      vi.mocked(giveBackAutoDay).mockResolvedValue(false);
      m.adVideo.findUnique.mockResolvedValue(failing());
      expect(await prepareAdVideo("v1")).toBe(false);
      expect(updates().at(-1)).toMatchObject({ status: "FAILED" });
    });
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
