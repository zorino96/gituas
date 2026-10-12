import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/db", () => ({
  db: {
    store: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    adVideo: { create: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/advideo/limits", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/limits")>()), videosUsed: vi.fn(), countVideo: vi.fn() }));
vi.mock("@/lib/advideo/brief", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/brief")>()), loadAdBrief: vi.fn() }));
vi.mock("@/lib/advideo/write", () => ({ writeAdSpec: vi.fn() }));
vi.mock("@/lib/advideo/voice", () => ({ voiceScenes: vi.fn() }));

import { db } from "@/lib/db";
import { loadAdBrief } from "@/lib/advideo/brief";
import { countVideo, videosUsed } from "@/lib/advideo/limits";
import { AD_MAX_TRIES, AD_PREPARE_LEASE_MS, createAdVideo, prepareAdVideo } from "@/lib/advideo/prepare";
import { AD_ICONS } from "@/lib/advideo/spec";
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
  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    m.store.findFirst.mockResolvedValue({ id: "s1", plan: "MERCHANT" });
    vi.mocked(videosUsed).mockResolvedValue(0);
    m.adVideo.count.mockResolvedValue(0);
    m.adVideo.create.mockResolvedValue({ id: "v1" });
  });
  const input = { tenantId: "t1", storeId: "s1", tier: "LITE" as const, topic: null, productId: null, voice: "shilan", targets: [], autoPost: false, source: "MANUAL" as const, createdById: null };

  it("queues a video and counts it against the month", async () => {
    expect(await createAdVideo(input)).toEqual({ ok: true, id: "v1" });
    expect(countVideo).toHaveBeenCalledWith("s1", "LITE", 1);
  });

  it("refuses a tier the plan does not have and a month that is used up", async () => {
    expect(await createAdVideo({ ...input, tier: "PRO", ...{} })).toEqual({ ok: true, id: "v1" });
    m.store.findFirst.mockResolvedValue({ id: "s1", plan: "FREE" });
    expect(await createAdVideo({ ...input, tier: "PRO" })).toEqual({ ok: false, error: "tier" });
    vi.mocked(videosUsed).mockResolvedValue(2);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "limit" });
  });

  it("does not take a fourth video while three are in the making", async () => {
    m.adVideo.count.mockResolvedValue(3);
    expect(await createAdVideo(input)).toEqual({ ok: false, error: "busy" });
    expect(m.adVideo.create).not.toHaveBeenCalled();
  });
});

describe("prepareAdVideo", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", storeId: "s1", tier: "LITE", status: "QUEUED", tries: 0, claimedAt: null, productId: null, topic: null, voice: "shilan", ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    vi.stubEnv("AD_VIDEO_ENABLED", "1");
    m.adVideo.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(loadAdBrief).mockResolvedValue({ name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null, product: null, catalog: [], photos: [] });
    vi.mocked(writeAdSpec).mockResolvedValue({ spec: { style: "elegant", scenes: [{ type: "hook", text: "a", sub: null, voice: "ب", icon: null, photo: null }, { type: "cta", text: "b", sub: null, voice: "ب", icon: null, photo: null }], caption: "c" }, model: "m", fallback: false });
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
    expect(countVideo).toHaveBeenCalledWith("s1", "LITE", -1);
  });

  it("keeps the job QUEUED for another go when tries are left", async () => {
    m.adVideo.findUnique.mockResolvedValue(row({ tries: 0 }));
    vi.mocked(voiceScenes).mockRejectedValue(new Error("no voice"));
    expect(await prepareAdVideo("v1")).toBe(false);
    const last = m.adVideo.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(last.data).toMatchObject({ status: "QUEUED", claimedAt: null });
    expect(countVideo).not.toHaveBeenCalled();
  });
});
