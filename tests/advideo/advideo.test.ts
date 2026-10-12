import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/ai/kurdgg", () => ({ kurdggConfigured: () => false, kurdggJson: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));
vi.mock("@/lib/voice/tts", () => ({ speak: vi.fn() }));
vi.mock("@/lib/news/video", () => ({ isNotSoraniRefusal: (e: unknown) => e instanceof Error && /70%/.test(e.message) }));
vi.mock("@/lib/shop/pipeline", () => ({ startOfShopDay: (d: Date) => new Date(Math.floor((d.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000) }));
vi.mock("@/lib/advideo/publish", () => ({ publishAdVideo: vi.fn() }));
vi.mock("@/lib/advideo/prepare", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/prepare")>()), prepareQueued: vi.fn() }));

import { allowance, VIDEO_LIMITS } from "@/lib/advideo/limits";
import { baghdadHour, isVideoDue, pickProductForVideo } from "@/lib/advideo/auto";
import { displayPhone, priceLineOf, usablePhotos, type AdBrief } from "@/lib/advideo/brief";
import { buildRenderProps } from "@/lib/advideo/prepare";
import { normalizeSpec } from "@/lib/advideo/spec";
import { voiceScenes } from "@/lib/advideo/voice";
import { directorUser, fallbackSpec, modelFor, writeAdSpec, type DirectorCall } from "@/lib/advideo/write";

const scene = (type: string, over: Record<string, unknown> = {}) => ({ type, text: "کوالێتی", voice: "کوالێتی لە هەموو هەنگاوێکدا", ...over });
const good = {
  style: "elegant",
  scenes: [scene("hook"), scene("value", { icon: "gem" }), scene("value", { icon: "not-an-icon" }), scene("product", { photo: 0 }), scene("cta")],
  caption: "سڵاو\n#کوردستان",
};
const opts = { photos: 2, hasTopic: false, maxScenes: 6 };

describe("normalizeSpec", () => {
  it("keeps a good script and gives value scenes an icon from the list", () => {
    const r = normalizeSpec(good, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.scenes.map((s) => s.type)).toEqual(["hook", "value", "value", "product", "cta"]);
    expect(r.spec.scenes[1].icon).toBe("gem");
    expect(r.spec.scenes[2].icon).toBe("sparkles");
    expect(r.spec.scenes[3].photo).toBe(0);
  });

  it("puts the hook first and the call to action last whatever the order", () => {
    const r = normalizeSpec({ ...good, scenes: [scene("cta"), scene("value"), scene("hook")] }, opts);
    expect(r.ok && r.spec.scenes.map((s) => s.type)).toEqual(["hook", "value", "cta"]);
  });

  it("drops a product scene when there is no photo and an offer when the owner asked for none", () => {
    const r = normalizeSpec({ ...good, scenes: [scene("hook"), scene("product"), scene("offer"), scene("cta")] }, { photos: 0, hasTopic: false, maxScenes: 6 });
    expect(r.ok).toBe(false);
    const ok = normalizeSpec({ ...good, scenes: [scene("hook"), scene("value"), scene("product"), scene("offer"), scene("cta")] }, { photos: 0, hasTopic: true, maxScenes: 6 });
    expect(ok.ok && ok.spec.scenes.map((s) => s.type)).toEqual(["hook", "value", "offer", "cta"]);
  });

  it("refuses digits in a spoken line", () => {
    const r = normalizeSpec({ ...good, scenes: [scene("hook"), scene("value", { voice: "تەنیا ٢٥ هەزار دینار" }), scene("value"), scene("cta")] }, opts);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toMatch(/digits/);
  });

  it("cuts words and scenes to the limits and points a bad photo index at a real photo", () => {
    const long = Array.from({ length: 40 }, (_, i) => `وشە${i}`).join(" ");
    const r = normalizeSpec(
      { ...good, scenes: [scene("hook", { text: long }), ...Array.from({ length: 9 }, () => scene("value")), scene("product", { photo: 99 }), scene("cta")] },
      { photos: 2, hasTopic: false, maxScenes: 6 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.scenes).toHaveLength(6);
    expect(r.spec.scenes[0].text.split(" ").length).toBeLessThanOrEqual(5);
  });

  it("needs a caption", () => {
    expect(normalizeSpec({ ...good, caption: "" }, opts).ok).toBe(false);
  });
});

describe("limits", () => {
  it("has more videos and the PRO tier on higher plans", () => {
    expect(VIDEO_LIMITS.FREE.PRO).toBe(0);
    expect(VIDEO_LIMITS.MERCHANT.LITE).toBeGreaterThan(VIDEO_LIMITS.FREE.LITE);
    expect(VIDEO_LIMITS.PRO.PRO).toBeGreaterThan(VIDEO_LIMITS.MERCHANT.PRO);
  });

  it("works out what is left", () => {
    expect(allowance("MERCHANT", "LITE", 12)).toEqual({ limit: VIDEO_LIMITS.MERCHANT.LITE, used: 12, left: VIDEO_LIMITS.MERCHANT.LITE - 12 });
    expect(allowance("FREE", "PRO", 0).left).toBe(0);
    expect(allowance("FREE", "LITE", 99).left).toBe(0);
  });
});

describe("brief helpers", () => {
  it("shows an Iraqi mobile number the way people write it", () => {
    expect(displayPhone("9647501234567")).toBe("0750 123 4567");
    expect(displayPhone("+964 750 123 4567")).toBe("0750 123 4567");
    expect(displayPhone("")).toBeNull();
    expect(displayPhone(null)).toBeNull();
  });

  it("takes the lowest price in stock and says 'from' when they differ", () => {
    expect(priceLineOf([{ amountMinor: 25000, currency: "IQD", inStock: true }])).toBeTruthy();
    const many = priceLineOf([{ amountMinor: 25000, currency: "IQD", inStock: true }, { amountMinor: 27000, currency: "IQD", inStock: true }]);
    expect(many?.startsWith("لە ")).toBe(true);
    expect(priceLineOf([{ amountMinor: 25000, currency: "IQD", inStock: false }])).toBeNull();
  });

  it("keeps only this workspace's JPEG photos", () => {
    const own = "https://abc.public.blob.vercel-storage.com/merchant/t1/photo.jpg";
    expect(usablePhotos([own, "https://abc.public.blob.vercel-storage.com/merchant/t2/photo.jpg", "https://abc.public.blob.vercel-storage.com/merchant/t1/photo.png", "https://evil.example/merchant/t1/a.jpg"], "t1")).toEqual([own]);
  });
});

const brief: AdBrief = {
  name: "بوتۆلیۆ",
  tagline: "جانتای ژنانە",
  deliveryNote: null,
  deliveryLine: "گەیاندن: ٥٬٠٠٠ دینار",
  primary: "#0B2545",
  accent: "#E0A526",
  logoUrl: null,
  handle: "@botolio",
  phone: "0750 123 4567",
  product: { id: "p1", name: "جانتای ڕەش", description: null, priceLine: "٢٥٬٠٠٠ دینار", photos: ["https://x/p1.jpg"] },
  catalog: [{ name: "جزدان", priceLine: null }],
  photos: ["https://x/p1.jpg"],
};

describe("the director", () => {
  it("uses Claude Opus 5.5 for PRO and the video model for LITE", () => {
    expect(modelFor("PRO")).toBe("cc/claude-opus-5-5");
    vi.stubEnv("KURDGG_MODEL_VIDEO_LITE", "cc/claude-haiku-5-5");
    expect(modelFor("LITE")).toBe("cc/claude-haiku-5-5");
    vi.unstubAllEnvs();
  });

  it("tells the model the facts and what the owner asked for", () => {
    const u = directorUser(brief, "ئۆفەری جەژن");
    expect(u).toContain("بوتۆلیۆ");
    expect(u).toContain("ئۆفەری جەژن");
    expect(u).toContain('"photos_available": 1');
    expect(directorUser(brief, null, ["no hook scene"])).toContain("no hook scene");
  });

  it("returns the model's storyboard when it is usable", async () => {
    const call: DirectorCall = async () => ({ data: good, model: "kurdgg/test" });
    const w = await writeAdSpec({ tier: "LITE", brief, topic: null, call });
    expect(w.fallback).toBe(false);
    expect(w.spec.scenes[0].type).toBe("hook");
  });

  it("asks once more with the problems, then falls back to the plain storyboard", async () => {
    const call = vi.fn<DirectorCall>(async () => ({ data: { scenes: [] }, model: "kurdgg/test" }));
    const w = await writeAdSpec({ tier: "PRO", brief, topic: null, call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(w.fallback).toBe(true);
    expect(normalizeSpec(w.spec, { photos: 1, hasTopic: false, maxScenes: 7 }).ok).toBe(true);
  });

  it("falls back when the model is down", async () => {
    const w = await writeAdSpec({ tier: "LITE", brief, topic: null, call: async () => { throw new Error("down"); } });
    expect(w.fallback).toBe(true);
    expect(w.spec.scenes.at(-1)?.type).toBe("cta");
  });

  it("makes a plain storyboard from facts alone, with a product scene only when there is a photo", () => {
    expect(fallbackSpec(brief).scenes.some((s) => s.type === "product")).toBe(true);
    expect(fallbackSpec({ ...brief, photos: [], product: null }).scenes.some((s) => s.type === "product")).toBe(false);
  });
});

describe("voiceScenes", () => {
  const scenes = normalizeSpec(good, opts).ok ? (normalizeSpec(good, opts) as { ok: true; spec: ReturnType<typeof fallbackSpec> }).spec.scenes : [];
  const audio = (s: string) => ({ audio: Buffer.from(s), mime: "audio/mpeg" as const });

  it("reads every scene and stores each clip next to the video", async () => {
    const stored: string[] = [];
    const out = await voiceScenes({
      tenantId: "t1", jobId: "j1", voice: "shilan", scenes,
      say: async (text) => audio(text),
      store: async (path) => { stored.push(path); return `https://blob/${path}`; },
    });
    expect(out).toHaveLength(scenes.length);
    expect(stored[0]).toBe("merchant/t1/advideo/j1/vo-0.mp3");
    expect(out[0].url).toBe("https://blob/merchant/t1/advideo/j1/vo-0.mp3");
  });

  it("says a refused line again in plainer Sorani", async () => {
    let first = true;
    const out = await voiceScenes({
      tenantId: "t1", jobId: "j1", voice: "shilan", scenes: scenes.slice(0, 2),
      say: async (text) => {
        if (first) { first = false; throw new Error("At least 70% of the text must be Central Kurdish (Sorani)."); }
        return audio(text);
      },
      resay: async () => "ڕستەیەکی ڕوونتر",
      store: async (p) => `https://blob/${p}`,
    });
    expect(out[0].scene.voice).toBe("ڕستەیەکی ڕوونتر");
  });

  it("drops a middle scene that cannot be voiced but fails when the hook cannot", async () => {
    const BAD = "ناتوانرێت";
    const say = async (text: string) => {
      if (text === BAD) throw new Error("no voice");
      return audio(text);
    };
    const mid = [{ ...scenes[0], voice: "سەرەتا" }, { ...scenes[1], voice: BAD }, { ...scenes[scenes.length - 1], voice: "کۆتایی" }];
    const out = await voiceScenes({ tenantId: "t1", jobId: "j1", voice: "x", scenes: mid, say, store: async (p) => p });
    expect(out.map((o) => o.scene.type)).toEqual(["hook", "cta"]);
    await expect(voiceScenes({ tenantId: "t1", jobId: "j1", voice: "x", scenes: [{ ...scenes[0], voice: BAD }], say, store: async (p) => p })).rejects.toThrow();
  });
});

describe("buildRenderProps", () => {
  it("hands the renderer the brand, the photos and each scene with its voice clip, and nothing secret", () => {
    const spec = fallbackSpec(brief);
    const props = buildRenderProps(brief, "bold", spec.scenes.map((s, i) => ({ scene: s, url: `https://blob/vo-${i}.mp3` })));
    expect(props.version).toBe(1);
    expect(props.style).toBe("bold");
    expect(props.size).toEqual([1080, 1920]);
    expect(props.brand).toMatchObject({ name: "بوتۆلیۆ", phone: "0750 123 4567", handle: "@botolio" });
    expect(props.photos).toEqual(["https://x/p1.jpg"]);
    expect(props.scenes[0].audio).toBe("https://blob/vo-0.mp3");
    expect(props.music.style).toBe("drive");
    expect(JSON.stringify(props)).not.toMatch(/token|secret|authorization/i);
  });
});

describe("the daily automation's clock", () => {
  const at = (h: number, day = 12) => Date.UTC(2026, 9, day, h - 3, 30); // h:30 in Baghdad

  it("reads the hour in Baghdad", () => {
    expect(baghdadHour(at(18))).toBe(18);
    expect(baghdadHour(Date.UTC(2026, 9, 12, 21, 5))).toBe(0);
  });

  it("is due from the chosen hour, once per shop day", () => {
    const store = { videoAutoHour: 18, videoAutoLastAt: null as Date | null };
    expect(isVideoDue(store, at(17))).toBe(false);
    expect(isVideoDue(store, at(18))).toBe(true);
    expect(isVideoDue({ ...store, videoAutoLastAt: new Date(at(18)) }, at(21))).toBe(false);
    expect(isVideoDue({ ...store, videoAutoLastAt: new Date(at(18, 11)) }, at(18, 12))).toBe(true);
  });

  it("features the product that has gone longest without a video, photos only", () => {
    const products = [{ id: "a", hasPhoto: true }, { id: "b", hasPhoto: true }, { id: "c", hasPhoto: false }];
    expect(pickProductForVideo(products, new Map([["a", 200], ["b", 100]]))).toBe("b");
    expect(pickProductForVideo(products, new Map([["a", 200]]))).toBe("b");
    expect(pickProductForVideo([{ id: "c", hasPhoto: false }], new Map())).toBeNull();
  });
});
