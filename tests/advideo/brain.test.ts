import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/ai/kurdgg", () => ({ kurdggConfigured: () => false, kurdggJson: vi.fn() }));
vi.mock("@/lib/storage", () => ({ put: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/advideo/signals", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/signals")>()), gatherSignals: vi.fn() }));

import { head, put } from "@/lib/storage";
import { describeCalendar, hijriOf, marketCalendar } from "@/lib/advideo/calendar";
import type { AdBrief } from "@/lib/advideo/brief";
import { isRefPath, refImagesForModel, refKind, refPrefix, type RefItem } from "@/lib/advideo/refs";
import { gatherSignals, postIdsOf, type Signals } from "@/lib/advideo/signals";
import { lookDistance, lookFromSeed, lookKey, LOOK_VOCAB, normalizeLook, normalizeSpec, styleOf, type DailyBrief } from "@/lib/advideo/spec";
import { baghdadDate, getDailyBrief, ruleBrief, validateBrief } from "@/lib/advideo/strategy";
import { directorUser, fallbackSpec, writeAdSpec, type DirectorCall } from "@/lib/advideo/write";

const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h);

describe("the market calendar", () => {
  it("sees Newroz coming and knows it is the weekend on a Friday", () => {
    const c = marketCalendar(at(2026, 3, 18));
    const newroz = c.events.find((e) => e.id === "newroz");
    expect(newroz).toMatchObject({ daysUntil: 3, phase: "before", weight: "high" });
    expect(c.weekend).toBe(false);
    expect(marketCalendar(at(2026, 3, 20)).weekend).toBe(true);
    expect(describeCalendar(marketCalendar(at(2026, 3, 20)))).toContain("(weekend)");
  });

  it("says an occasion is on while it is on", () => {
    expect(marketCalendar(at(2026, 3, 21)).events.find((e) => e.id === "newroz")?.phase).toBe("during");
  });

  it("finds Black Friday on the last Friday of November", () => {
    const e = marketCalendar(at(2026, 11, 27)).events.find((x) => x.id === "black_friday");
    expect(e?.phase).toBe("during");
    expect(marketCalendar(at(2026, 11, 20)).events.find((x) => x.id === "black_friday")?.daysUntil).toBe(7);
  });

  it("counts the Hijri year with the platform's own calendar", () => {
    expect(hijriOf(at(2026, 10, 12))?.year).toBe(1448);
  });

  it("is quiet when nothing is close", () => {
    expect(marketCalendar(at(2026, 10, 12)).events.every((e) => e.daysUntil > 0 || e.phase !== "during")).toBe(true);
  });
});

describe("the look system", () => {
  it("is the same for the same brand and day, and different across brands", () => {
    expect(lookFromSeed("s1:2026-10-12")).toEqual(lookFromSeed("s1:2026-10-12"));
    const keys = new Set(Array.from({ length: 24 }, (_, i) => lookKey(lookFromSeed(`store-${i}:2026-10-12`))));
    expect(keys.size).toBeGreaterThan(14);
  });

  it("uses only words from the vocabulary", () => {
    const l = lookFromSeed("x") as unknown as Record<string, string>;
    for (const k of Object.keys(LOOK_VOCAB) as (keyof typeof LOOK_VOCAB)[]) expect(LOOK_VOCAB[k] as readonly string[]).toContain(l[k]);
  });

  it("keeps clear of the looks used lately", () => {
    const old = [lookFromSeed("a"), lookFromSeed("b"), lookFromSeed("c")];
    for (const seed of ["a", "b", "c", "d"]) {
      const l = lookFromSeed(seed, old);
      for (const o of old) expect(lookDistance(l, o)).toBeLessThan(5);
    }
  });

  it("keeps the director's good choices and fills the rest", () => {
    const l = normalizeLook({ palette: "cream", layout: "nonsense", background: 4, motion: "punchy" }, "seed");
    expect(l.palette).toBe("cream");
    expect(l.motion).toBe("punchy");
    expect(l.layout).toBe(lookFromSeed("seed").layout);
    expect(l.background).toBe(lookFromSeed("seed").background);
  });

  it("names a music family from the look", () => {
    expect(styleOf({ ...lookFromSeed("x"), palette: "brand-flood" })).toBe("bold");
    expect(styleOf({ ...lookFromSeed("x"), palette: "cream", motion: "calm" })).toBe("clean");
    expect(styleOf({ ...lookFromSeed("x"), palette: "midnight", motion: "float" })).toBe("elegant");
  });
});

const sc = (type: string, over: Record<string, unknown> = {}) => ({ type, text: "کوالێتی", voice: "کوالێتی لە هەموو هەنگاوێکدا", ...over });
const raw = (extra: Record<string, unknown> = {}) => ({
  scenes: [sc("hook"), sc("footage", { text: "", clip: 1 }), sc("value", { icon: "gem" }), sc("product", { photo: 0 }), sc("cta")],
  caption: "سڵاو\n#کوردستان",
  ...extra,
});
const base = { photos: 2, hasTopic: false, maxScenes: 7, seed: "s1:2026-10-12" };

describe("normalizeSpec with looks, plans and clips", () => {
  it("drops a footage scene when the shop has no clip", () => {
    const n = normalizeSpec(raw(), { ...base, clips: 0 });
    expect(n.ok).toBe(true);
    if (n.ok) expect(n.spec.scenes.some((s) => s.type === "footage")).toBe(false);
  });

  it("keeps a footage scene and a clip number that exists", () => {
    const n = normalizeSpec(raw(), { ...base, clips: 2 });
    expect(n.ok).toBe(true);
    if (n.ok) expect(n.spec.scenes.find((s) => s.type === "footage")?.clip).toBe(1);
    const wrong = normalizeSpec(raw({ scenes: [sc("hook"), sc("footage", { text: "", clip: 9 }), sc("value"), sc("cta")] }), { ...base, clips: 2 });
    if (wrong.ok) expect(wrong.spec.scenes.find((s) => s.type === "footage")?.clip).toBe(0);
  });

  it("gives every spec a look in the vocabulary, and the director's own palette wins", () => {
    const n = normalizeSpec(raw({ look: { palette: "midnight", transition: "iris" } }), { ...base, clips: 0 });
    expect(n.ok && n.spec.look.palette).toBe("midnight");
    expect(n.ok && n.spec.look.transition).toBe("iris");
  });

  it("moves a look that is nearly the same as a recent one", () => {
    const recent = lookFromSeed("recent");
    const n = normalizeSpec(raw({ look: recent }), { ...base, clips: 0, avoid: [recent] });
    expect(n.ok).toBe(true);
    if (n.ok) expect(lookDistance(n.spec.look, recent)).toBeLessThan(6);
  });

  it("keeps the plan's words only for known objectives", () => {
    const ok = normalizeSpec(raw({ plan: { objective: "trust", why: "لەبەر متمانە", priceMode: "conversion", cta: "dm", format: "offer" } }), { ...base, clips: 0 });
    expect(ok.ok && ok.spec.plan).toMatchObject({ objective: "trust", priceMode: "conversion", cta: "dm" });
    const bad = normalizeSpec(raw({ plan: { objective: "get-rich" } }), { ...base, clips: 0 });
    expect(bad.ok && bad.spec.plan).toBeUndefined();
  });
});

const calendar = { weekday: 2, weekend: false, dayOfMonth: 12, season: "autumn" as const, events: [] };
const product = (over: Partial<Signals["products"][number]> = {}): Signals["products"][number] => ({
  id: "p1", name: "جانتا", priceLine: "٢٥٬٠٠٠ دینار", inStock: true, hasPhoto: true, ageDays: 40, asked14: 0, orders30: 0, videoDaysAgo: null, ...over,
});
const sig = (over: Partial<Signals> = {}): Signals => ({
  calendar,
  shop: { name: "بوتۆلیۆ", tagline: null, cities: ["Sulaymaniyah", "Erbil"], hours: [20, 21], languages: ["ckb"], orders60: 12, messages60: 30, hasPhone: true },
  products: [product()],
  intents: {},
  recentVideos: [],
  notes: "",
  ...over,
});

describe("the daily plan", () => {
  it("accepts a good model plan and keeps it to what the shop can do", () => {
    const b = validateBrief(
      { objective: "sell_product", productId: "p1", why: "  جانتا زۆر پرسیاری لێکراوە  ", format: "made-up", priceMode: "conversion", cta: "dm", urgent: true, avoid: ["a", "b", "c", "d"], boost: { worth: true, cities: ["Erbil", "Mars"], note: "ن" } },
      sig(),
      "2026-10-12",
      "haiku",
    );
    expect(b).toMatchObject({ objective: "sell_product", productId: "p1", format: "showcase", priceMode: "conversion", cta: "dm", urgent: true, source: "model" });
    expect(b?.avoid).toHaveLength(3);
    expect(b?.boost.cities).toEqual(["Erbil"]);
    expect(b?.boost.worth).toBe(true);
    expect(b?.why).toBe("جانتا زۆر پرسیاری لێکراوە");
  });

  it("refuses an unknown objective or a plan with no reason", () => {
    expect(validateBrief({ objective: "go-viral", why: "x" }, sig(), "d", "m")).toBeNull();
    expect(validateBrief({ objective: "trust", why: " " }, sig(), "d", "m")).toBeNull();
  });

  it("never aims at a product that is sold out, has no photo, or is not the shop's", () => {
    const s = sig({ products: [product({ id: "gone", inStock: false }), product({ id: "bare", hasPhoto: false })] });
    for (const id of ["gone", "bare", "nope"]) expect(validateBrief({ objective: "trust", why: "x", productId: id }, s, "d", "m")?.productId).toBeNull();
  });

  it("falls back on rules: the occasion first", () => {
    const events = [{ id: "newroz", label: "Newroz", daysUntil: 5, phase: "before" as const, weight: "high" as const }];
    const b = ruleBrief(sig({ calendar: { ...calendar, events } }), "2026-03-16");
    expect(b).toMatchObject({ objective: "seasonal", urgent: true, source: "rules" });
  });

  it("then the product buyers ask about, then what is new, then trust", () => {
    expect(ruleBrief(sig({ products: [product({ asked14: 6, orders30: 2 })] }), "d")).toMatchObject({ objective: "sell_product", productId: "p1", priceMode: "conversion" });
    expect(ruleBrief(sig({ products: [product({ ageDays: 3 })] }), "d")).toMatchObject({ objective: "new_arrival", productId: "p1" });
    expect(ruleBrief(sig({ products: [] }), "d")).toMatchObject({ objective: "trust", productId: null });
  });

  it("does not repeat a product that just had a video", () => {
    const b = ruleBrief(sig({ products: [product({ asked14: 9, videoDaysAgo: 1 })] }), "d");
    expect(b.objective).not.toBe("sell_product");
  });

  it("keeps boost advice honest when there is little to learn from", () => {
    const b = ruleBrief(sig({ shop: { ...sig().shop, orders60: 0, messages60: 2 }, products: [product({ asked14: 1 })] }), "d");
    expect(b.boost.worth).toBe(false);
  });

  it("reads the day in Baghdad", () => {
    expect(baghdadDate(Date.UTC(2026, 9, 12, 21, 30))).toBe("2026-10-13");
    expect(baghdadDate(Date.UTC(2026, 9, 12, 20, 30))).toBe("2026-10-12");
  });
});

describe("getDailyBrief", () => {
  const now = Date.UTC(2026, 9, 12, 9, 0);
  const call: DirectorCall = vi.fn();

  beforeEach(() => {
    vi.mocked(call).mockReset();
    vi.mocked(put).mockReset().mockResolvedValue({} as never);
    vi.mocked(head).mockReset().mockRejectedValue(new Error("none"));
    vi.mocked(gatherSignals).mockReset().mockResolvedValue(sig({ products: [product({ asked14: 5 })] }));
    vi.stubEnv("AUTH_SECRET", "test-secret");
  });

  it("uses the model's plan and saves it with the time it was made", async () => {
    vi.mocked(call).mockResolvedValue({ model: "haiku", data: { objective: "sell_product", productId: "p1", why: "پرسیار زۆرە", format: "showcase", priceMode: "engagement", cta: "whatsapp" } });
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    expect(r?.brief).toMatchObject({ source: "model", productId: "p1", madeAt: now, date: "2026-10-12" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("falls back on the rules when the model fails, and still has a plan", async () => {
    vi.mocked(call).mockRejectedValue(new Error("down"));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    expect(r?.brief.source).toBe("rules");
    expect(r?.brief.objective).toBeTruthy();
  });

  it("answers from the day's saved plan without asking the model again", async () => {
    const saved: DailyBrief = { ...ruleBrief(sig(), "2026-10-12"), madeAt: now - 1000 };
    vi.mocked(head).mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/p.json", uploadedAt: new Date(now) } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(saved), { status: 200 })));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    expect(r).toMatchObject({ cached: true });
    expect(call).not.toHaveBeenCalled();
    expect(gatherSignals).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("makes it again when asked to", async () => {
    vi.mocked(head).mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/p.json" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ruleBrief(sig(), "2026-10-12")), { status: 200 })));
    vi.mocked(call).mockRejectedValue(new Error("down"));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call, force: true });
    expect(r?.cached).toBe(false);
    expect(gatherSignals).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("how a video did", () => {
  it("reads the post ids a publish left behind", () => {
    expect(postIdsOf([{ publishId: "123_456" }, { publishId: 5 }, {}, null, { publishId: "ab" }])).toEqual(["123_456"]);
    expect(postIdsOf(null)).toEqual([]);
    expect(postIdsOf({ error: "x" })).toEqual([]);
  });
});

describe("reference files", () => {
  const pre = refPrefix("t1", "s1");

  it("knows pictures from clips and nothing else", () => {
    expect(refKind(`${pre}1.JPG`)).toBe("image");
    expect(refKind(`${pre}1.webp`)).toBe("image");
    expect(refKind(`${pre}1.mov`)).toBe("video");
    expect(refKind(`${pre}1.exe`)).toBeNull();
  });

  it("accepts only paths inside this store's own folder", () => {
    expect(isRefPath(`${pre}1.jpg`, "t1", "s1")).toBe(true);
    expect(isRefPath(`merchant/t1/advideo-ref/s2/1.jpg`, "t1", "s1")).toBe(false);
    expect(isRefPath(`merchant/t2/advideo-ref/s1/1.jpg`, "t1", "s1")).toBe(false);
    expect(isRefPath(`${pre}../../x.jpg`, "t1", "s1")).toBe(false);
    expect(isRefPath(`${pre}a%2f..%2fb.jpg`, "t1", "s1")).toBe(false);
    expect(isRefPath(`${pre}a.txt`, "t1", "s1")).toBe(false);
    expect(isRefPath(5, "t1", "s1")).toBe(false);
  });

  it("shows the model small JPEGs, and skips what it cannot read", async () => {
    const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#c33" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("bad") ? new Response("nope", { status: 404 }) : new Response(new Uint8Array(big), { status: 200 }))));
    const item = (name: string, kind: RefItem["kind"]): RefItem => ({ url: `https://x.public.blob.vercel-storage.com/${name}`, pathname: `${pre}${name}`, kind, name, size: 1, uploadedAt: "2026-10-12T00:00:00Z" });
    const out = await refImagesForModel([item("a.png", "image"), item("bad.png", "image"), item("c.mp4", "video")]);
    expect(out).toHaveLength(1);
    expect(out[0].startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(Buffer.from(out[0].split(",")[1], "base64")).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(768);
    vi.unstubAllGlobals();
  });
});

const brief: AdBrief = {
  name: "بوتۆلیۆ",
  tagline: null,
  deliveryNote: null,
  deliveryLine: null,
  primary: "#0B2545",
  accent: "#E0A526",
  logoUrl: null,
  handle: null,
  phone: null,
  product: { id: "p1", name: "جانتا", description: null, priceLine: null, photos: ["https://x/p1.jpg"], inStock: true },
  catalog: [],
  photos: ["https://x/p1.jpg"],
  refPhotos: 0,
  refIndices: [],
  clips: ["https://x/c.mp4"],
};
const plan: DailyBrief = { ...ruleBrief(sig(), "2026-10-12"), objective: "engage", priceMode: "engagement", cta: "comment", why: "بۆ پرسیار" };

describe("the director with a plan", () => {
  it("is told the plan, the looks used lately, the hooks and the pictures", () => {
    const text = directorUser(brief, null, undefined, { plan, avoidLooks: [lookFromSeed("old")], recentHooks: ["هۆکی کۆن"], refPictures: 2 });
    expect(text).toContain("todays_plan");
    expect(text).toContain('"objective": "engage"');
    expect(text).toContain(lookKey(lookFromSeed("old")));
    expect(text).toContain("هۆکی کۆن");
    expect(text).toContain("2 picture(s) are attached");
    expect(text).toContain("Do not speak or show a price");
    expect(text).toContain("write in the comments");
    expect(text).toContain("clips_available");
  });

  it("makes the plain storyboard in a look of its own, carrying the plan", () => {
    const old = [lookFromSeed("botolio:1")];
    const spec = fallbackSpec(brief, "botolio:2", old, plan);
    expect(lookDistance(spec.look, old[0])).toBeLessThan(5);
    expect(spec.plan).toMatchObject({ objective: "engage", priceMode: "engagement" });
    expect(spec.scenes.every((s) => "clip" in s)).toBe(true);
  });

  it("sends the pictures with the call and keeps the strategist's plan over the model's", async () => {
    const call: DirectorCall = vi.fn(async () => ({
      model: "m",
      data: { ...raw({ plan: { objective: "sell_product", why: "x", priceMode: "conversion", cta: "dm" } }) },
    }));
    const out = await writeAdSpec({ tier: "LITE", brief, topic: null, plan, images: ["data:image/jpeg;base64,AAAA"], call, seed: "s1:d" });
    expect(out.fallback).toBe(false);
    expect(vi.mocked(call).mock.calls[0][0].images).toEqual(["data:image/jpeg;base64,AAAA"]);
    expect(out.spec.plan).toMatchObject({ objective: "engage", priceMode: "engagement", cta: "comment" });
  });
});
