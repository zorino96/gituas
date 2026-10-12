import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/ai/kurdgg", () => ({ kurdggConfigured: () => false, kurdggJson: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/advideo/signals", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/signals")>()), gatherSignals: vi.fn() }));

import { head, put } from "@vercel/blob";
import { refStoreOf } from "@/lib/advideo/ref-paths";
import { gatherSignals, postIdsOf, type Signals } from "@/lib/advideo/signals";
import { claimProblems, normalizeSpec, type DailyBrief } from "@/lib/advideo/spec";
import { getDailyBrief, readTodaysBrief, ruleBrief, validateBrief } from "@/lib/advideo/strategy";
import type { DirectorCall } from "@/lib/advideo/write";

describe("claims the model must not make up", () => {
  it("finds numbers, percentages, links and discount words", () => {
    expect(claimProblems(["کەمکردنەوە ٥٠٪"], "")).toContain("a percentage");
    expect(claimProblems(["لە ٢٥٠٠ دینار"], "")).toContain("a number");
    expect(claimProblems(["２５"], "")).toContain("a number");
    expect(claimProblems(["بچۆ بۆ www.shop.com"], "")).toContain("a link");
    expect(claimProblems(["shop.iq"], "")).toContain("a link");
    expect(claimProblems(["داشکاندنی تایبەت"], "")).toContain("a price or discount word");
    expect(claimProblems(["بێبەرامبەر بۆ هەموو"], "")).toContain("a price or discount word");
    expect(claimProblems(["خصم كبير"], "")).toContain("a price or discount word");
    expect(claimProblems(["ألف قطعة"], "")).toContain("a price or discount word");
  });

  it("lets through what the owner said or the shop's data says", () => {
    expect(claimProblems(["داشکاندنی جەژن ٢٠٪"], "ئۆفەری جەژن: داشکاندن ٢٠٪")).toEqual([]);
    expect(claimProblems(["لە ٢٥٬٠٠٠ دینار"], "جانتا لە ٢٥٬٠٠٠ دینار")).toEqual([]);
    expect(claimProblems(["Shop 24"], "Shop 24 Erbil")).toEqual([]);
  });

  it("ignores hashtags and plain Kurdish", () => {
    expect(claimProblems(["بەخێربێن #کوردستان #2026 #ئەربیل"], "")).toEqual([]);
    expect(claimProblems(["کوالێتی لە هەموو هەنگاوێکدا"], "")).toEqual([]);
  });
});

const sc = (type: string, over: Record<string, unknown> = {}) => ({ type, text: "کوالێتی", voice: "کوالێتی لە هەموو هەنگاوێکدا", ...over });
const body = (over: Record<string, unknown> = {}) => ({ scenes: [sc("hook"), sc("value", { icon: "gem" }), sc("cta")], caption: "سڵاو #کوردستان", ...over });
const o = { photos: 0, hasTopic: false, maxScenes: 6, seed: "s", allowed: "بوتۆلیۆ" };

describe("normalizeSpec refuses invented claims", () => {
  it("refuses on-screen text, sub-lines and the caption that carry a number, a link or a discount", () => {
    const text = normalizeSpec(body({ scenes: [sc("hook"), sc("value", { text: "داشکاندنی ٥٠٪" }), sc("cta")] }), o);
    expect(text.ok).toBe(false);
    const sub = normalizeSpec(body({ scenes: [sc("hook"), sc("value", { sub: "بۆ www.x.com" }), sc("cta")] }), o);
    expect(sub.ok).toBe(false);
    const caption = normalizeSpec(body({ caption: "نرخی نوێ لە ٥٠٠٠ دینار" }), o);
    expect(caption.ok).toBe(false);
    if (!caption.ok) expect(caption.errors[0]).toContain("caption");
  });

  it("names the problem so the director can correct itself", () => {
    const n = normalizeSpec(body({ scenes: [sc("hook"), sc("value", { text: "هەرزان ٣٠٪" }), sc("cta")] }), o);
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.errors.join(" ")).toMatch(/leave out numbers, prices, discounts and links/);
  });

  it("keeps a number the owner asked for", () => {
    const n = normalizeSpec(body({ scenes: [sc("hook"), sc("value", { text: "داشکاندنی ٢٠٪" }), sc("cta")] }), { ...o, allowed: "ئۆفەر: داشکاندنی ٢٠٪" });
    expect(n.ok).toBe(true);
  });
});

describe("post ids of a Facebook video", () => {
  it("also lists the page-prefixed form the comments arrive under", () => {
    expect(postIdsOf([{ target: "FB", publishId: "777888" }], "123")).toEqual(["777888", "123_777888"]);
    expect(postIdsOf([{ target: "IG", publishId: "999000" }], "123")).toEqual(["999000"]);
    expect(postIdsOf([{ target: "FB", publishId: "123_777888" }], "123")).toEqual(["123_777888"]);
    expect(postIdsOf([{ target: "FB", publishId: "777888" }])).toEqual(["777888"]);
  });
});

describe("reference upload paths", () => {
  it("names the store only for a well-formed path of this workspace", () => {
    expect(refStoreOf("merchant/t1/advideo-ref/s1/12.jpg", "t1")).toBe("s1");
    expect(refStoreOf("merchant/t2/advideo-ref/s1/12.jpg", "t1")).toBeNull();
    expect(refStoreOf("merchant/t1/advideo-ref/s1/a/12.jpg", "t1")).toBeNull();
    expect(refStoreOf("merchant/t1/advideo-ref/s1/12.exe", "t1")).toBeNull();
    expect(refStoreOf("merchant/t1/advideo-ref/s1/..%2f12.jpg", "t1")).toBeNull();
  });
});

const calendar = { weekday: 2, weekend: false, dayOfMonth: 12, season: "autumn" as const, events: [] };
const sig = (shop: Partial<Signals["shop"]> = {}, over: Partial<Signals> = {}): Signals => ({
  calendar,
  shop: { name: "B", tagline: null, cities: ["Erbil"], hours: [], languages: [], orders60: 12, messages60: 30, hasPhone: true, ...shop },
  products: [{ id: "p1", name: "جانتا", priceLine: null, inStock: true, hasPhoto: true, ageDays: 40, asked14: 4, orders30: 1, videoDaysAgo: null }],
  intents: {},
  recentVideos: [],
  notes: "",
  ...over,
});
const model = { objective: "sell_product", productId: "p1", why: "پرسیار زۆرە", boost: { worth: true, cities: ["Erbil", "Basra"], note: "" } };

describe("the plan rests on the shop's data", () => {
  it("claims boosting only when there is enough to learn from", () => {
    expect(validateBrief(model, sig(), "d", "m")?.boost.worth).toBe(true);
    expect(validateBrief(model, sig({ orders60: 1, messages60: 2 }), "d", "m")?.boost.worth).toBe(false);
  });

  it("names only cities from the shop's own orders, whatever their case", () => {
    expect(validateBrief(model, sig({ cities: ["erbil"] }), "d", "m")?.boost.cities).toEqual(["Erbil"]);
    expect(validateBrief(model, sig({ cities: [] }), "d", "m")?.boost.cities).toEqual([]);
  });

  it("does not send buyers to WhatsApp when the shop has no number", () => {
    expect(validateBrief({ ...model, cta: "whatsapp" }, sig({ hasPhone: false }), "d", "m")?.cta).toBe("dm");
    expect(validateBrief({ ...model, cta: "whatsapp" }, sig(), "d", "m")?.cta).toBe("whatsapp");
    expect(ruleBrief(sig({ hasPhone: false }), "d").cta).toBe("dm");
  });

  it("does not lead every day of a long occasion with the same plan", () => {
    const ramadan = (daysUntil: number) => sig({}, { calendar: { ...calendar, events: [{ id: "ramadan", label: "Ramadan", daysUntil, phase: "during", weight: "high" }] }, products: [] });
    expect(ruleBrief(ramadan(-1), "d").objective).toBe("seasonal");
    expect(ruleBrief(ramadan(-12), "d").objective).not.toBe("seasonal");
  });
});

describe("getDailyBrief, the day's cache and the model going away", () => {
  const now = Date.UTC(2026, 9, 12, 9, 0);
  const call: DirectorCall = vi.fn();
  const modelPlan = (over: Partial<DailyBrief> = {}): DailyBrief => ({ ...ruleBrief(sig(), "2026-10-12"), source: "model", model: "haiku", madeAt: now - 60_000, ...over });
  const saved = (b: DailyBrief) => {
    vi.mocked(head).mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/p.json", uploadedAt: new Date(now - 5_000) } as never);
    vi.stubGlobal("fetch", vi.fn(async (_u: string) => new Response(JSON.stringify(b), { status: 200 })));
  };

  beforeEach(() => {
    vi.mocked(call).mockReset();
    vi.mocked(put).mockReset().mockResolvedValue({} as never);
    vi.mocked(head).mockReset().mockRejectedValue(new Error("none"));
    vi.mocked(gatherSignals).mockReset().mockResolvedValue(sig());
    vi.stubEnv("AUTH_SECRET", "test-secret");
  });

  it("asks the storage for the file by its version, so a plan saved a moment ago is not an old copy", async () => {
    saved(modelPlan());
    await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain(`?v=${now - 5_000}`);
    vi.unstubAllGlobals();
  });

  it("tries the model again when the saved plan came from the rules a while ago", async () => {
    saved(modelPlan({ source: "rules", model: "rules", madeAt: now - 30 * 60_000 }));
    vi.mocked(call).mockResolvedValue({ model: "haiku", data: model });
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    expect(call).toHaveBeenCalled();
    expect(r?.brief.source).toBe("model");
    vi.unstubAllGlobals();
  });

  it("keeps a rules plan that is only minutes old", async () => {
    saved(modelPlan({ source: "rules", model: "rules", madeAt: now - 60_000 }));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call });
    expect(call).not.toHaveBeenCalled();
    expect(r?.cached).toBe(true);
    vi.unstubAllGlobals();
  });

  it("never replaces the model's plan of the day with the rules when the model fails", async () => {
    const good = modelPlan({ why: "پلانی باش" });
    saved(good);
    vi.mocked(call).mockRejectedValue(new Error("down"));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call, force: true });
    expect(r).toMatchObject({ cached: true, failed: true });
    expect(r?.brief.why).toBe("پلانی باش");
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says so when a remake fails and there is nothing earlier to keep", async () => {
    vi.mocked(call).mockRejectedValue(new Error("down"));
    const r = await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call, force: true });
    expect(r?.failed).toBe(true);
    expect(r?.brief.source).toBe("rules");
  });

  it("hands the model only as long as the caller can wait", async () => {
    vi.mocked(call).mockResolvedValue({ model: "haiku", data: model });
    await getDailyBrief({ tenantId: "t1", storeId: "s1", tier: "LITE", now, call, timeoutMs: 12_000 });
    expect(vi.mocked(call).mock.calls[0][1]).toBe(12_000);
  });

  it("does not guess a secret: with no AUTH_SECRET nothing is read or written", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(await readTodaysBrief("t1", "s1", now)).toBeNull();
    expect(head).not.toHaveBeenCalled();
  });
});
