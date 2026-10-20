// The places where owners and members reach the video code: the plan actions, the reference actions,
// the upload route's policy, and the signals the plan is made from.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const paid = vi.hoisted(() => ({ aiUsd: 2 }));

vi.mock("@/lib/db", () => ({
  db: {
    store: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    brandKit: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    order: { groupBy: vi.fn() },
    conversationMessage: { groupBy: vi.fn() },
    adVideo: { findMany: vi.fn() },
  },
}));
vi.mock("@/app/app/data", () => ({ currentWorkspace: vi.fn(async () => ws.current) }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: paid.aiUsd })) }));
vi.mock("@/lib/ai/slots", () => ({ takeDaily: vi.fn(async () => 1) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn(), NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } }));
vi.mock("@/lib/i18n", async () => {
  const { en } = await import("@/lib/i18n/en");
  return { dict: () => en, getLang: async () => "en" };
});
vi.mock("@/lib/orders/audience", () => ({ loadBuyerProfile: vi.fn(), ordersByPost: vi.fn() }));
vi.mock("@/lib/advideo/strategy", () => ({
  getDailyBrief: vi.fn(),
  loadMarketNotes: vi.fn(),
  readTodaysBrief: vi.fn(),
  saveMarketNotes: vi.fn(),
}));
vi.mock("@/lib/advideo/refs", () => ({ isRefPath: (p: unknown) => typeof p === "string" && p.startsWith("merchant/t1/advideo-ref/s1/"), removeRef: vi.fn(async () => true) }));
vi.mock("@/lib/advideo/prepare", () => ({ createAdVideo: vi.fn(), prepareAdVideo: vi.fn() }));
vi.mock("@/lib/advideo/publish", () => ({ publishAdVideo: vi.fn() }));
vi.mock("@/lib/ai/review-idea", () => ({ reviewIdea: vi.fn(), ReviewFailed: class ReviewFailed extends Error {} }));
vi.mock("@/lib/shop/profile", async (original) => ({ ...(await original<typeof import("@/lib/shop/profile")>()), loadProfile: vi.fn(async () => null) }));
vi.mock("@vercel/blob/client", () => ({
  // Hands the route's own policy back, so the test reads exactly what a token would be issued for.
  handleUpload: vi.fn(async (o: { body: { pathname: string }; onBeforeGenerateToken: (p: string) => Promise<unknown> }) => o.onBeforeGenerateToken(o.body.pathname)),
}));

import { after } from "next/server";
import { db } from "@/lib/db";
import { takeDaily } from "@/lib/ai/slots";
import { reviewIdea } from "@/lib/ai/review-idea";
import { createAdVideo } from "@/lib/advideo/prepare";
import { loadProfile } from "@/lib/shop/profile";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { videoChoice } from "@/app/app/video/choice";
import { removeRef } from "@/lib/advideo/refs";
import { getDailyBrief, loadMarketNotes, readTodaysBrief, saveMarketNotes } from "@/lib/advideo/strategy";
import { loadBuyerProfile, ordersByPost } from "@/lib/orders/audience";
import { gatherSignals } from "@/lib/advideo/signals";
import { createVideoAction, refreshPlanAction, removeRefAction, saveMarketNotesAction, saveVideoAutoAction } from "@/app/app/video/actions";
import { POST as uploadRoute } from "@/app/api/app/upload/route";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const plan = (over: Record<string, unknown> = {}) => ({ brief: { date: "d", objective: "trust", why: "x", madeAt: 0, source: "model", ...over }, cached: false });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AD_VIDEO_ENABLED", "1");
  ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
  m.store.findFirst.mockResolvedValue({ id: "s1", fbPageId: null, igUserId: null });
});

describe("the plan actions", () => {
  it("does not ask the model again within a minute and a half of the last plan", async () => {
    vi.mocked(readTodaysBrief).mockResolvedValue({ madeAt: Date.now() - 30_000 } as never);
    expect(await refreshPlanAction("s1")).toEqual({ ok: true });
    expect(getDailyBrief).not.toHaveBeenCalled();
  });

  it("makes the plan again after that, and says so when the model could not", async () => {
    vi.mocked(readTodaysBrief).mockResolvedValue({ madeAt: Date.now() - 5 * 60_000 } as never);
    vi.mocked(getDailyBrief).mockResolvedValue({ ...plan(), failed: true } as never);
    const r = await refreshPlanAction("s1");
    expect(getDailyBrief).toHaveBeenCalledWith(expect.objectContaining({ force: true, storeId: "s1", tenantId: "t1" }));
    expect(r).toMatchObject({ ok: false });
  });

  it("makes the plan again for new notes at once, with no waiting period", async () => {
    vi.mocked(loadMarketNotes).mockResolvedValue("کۆن");
    vi.mocked(readTodaysBrief).mockResolvedValue({ madeAt: Date.now() - 5_000 } as never);
    vi.mocked(getDailyBrief).mockResolvedValue(plan() as never);
    expect(await saveMarketNotesAction("s1", "نوێ: ڕکابەرێک نرخی دابەزاند")).toEqual({ ok: true });
    expect(saveMarketNotes).toHaveBeenCalledWith("t1", "s1", "نوێ: ڕکابەرێک نرخی دابەزاند");
    expect(getDailyBrief).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("leaves the model alone when the notes did not change", async () => {
    vi.mocked(loadMarketNotes).mockResolvedValue("هەمان");
    expect(await saveMarketNotesAction("s1", "  هەمان ")).toEqual({ ok: true });
    expect(getDailyBrief).not.toHaveBeenCalled();
  });

  it("keeps the notes and tells the owner when the new plan could not be made", async () => {
    vi.mocked(loadMarketNotes).mockResolvedValue("");
    vi.mocked(getDailyBrief).mockResolvedValue({ ...plan(), failed: true } as never);
    const r = await saveMarketNotesAction("s1", "تێبینی");
    expect(saveMarketNotes).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false });
  });

  it("is for people who may publish, and only for stores of the workspace", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await refreshPlanAction("s1")).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
    m.store.findFirst.mockResolvedValue(null);
    expect(await saveMarketNotesAction("s9", "x")).toMatchObject({ ok: false });
    expect(saveMarketNotes).not.toHaveBeenCalled();
  });

  it("removes only this store's own reference files", async () => {
    expect(await removeRefAction("s1", "merchant/t2/advideo-ref/s1/a.jpg")).toMatchObject({ ok: false });
    expect(removeRef).not.toHaveBeenCalled();
    expect(await removeRefAction("s1", "merchant/t1/advideo-ref/s1/a.jpg")).toEqual({ ok: true });
    expect(removeRef).toHaveBeenCalledWith("t1", "s1", "merchant/t1/advideo-ref/s1/a.jpg");
  });
});

const upload = async (pathname: string) => {
  const res = (await uploadRoute(new Request("http://x/api/app/upload", { method: "POST", body: JSON.stringify({ pathname }) }))) as unknown as { body: Record<string, unknown>; status: number };
  return res;
};

describe("the upload route's policy for reference files", () => {
  it("issues a token for a picture of a store of this workspace, with that kind's types and size", async () => {
    const r = await upload("merchant/t1/advideo-ref/s1/1.jpg");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ allowedContentTypes: ["image/jpeg", "image/png", "image/webp"], maximumSizeInBytes: 12 * 1024 * 1024 });
    const v = await upload("merchant/t1/advideo-ref/s1/1.mp4");
    expect(v.body).toMatchObject({ allowedContentTypes: ["video/mp4", "video/quicktime"], maximumSizeInBytes: 40 * 1024 * 1024 });
  });

  it("refuses a member, a store of another workspace and a path that is not a reference file", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect((await upload("merchant/t1/advideo-ref/s1/1.jpg")).status).toBe(400);
    ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
    m.store.findFirst.mockResolvedValue(null);
    expect((await upload("merchant/t1/advideo-ref/s7/1.jpg")).status).toBe(400);
    m.store.findFirst.mockResolvedValue({ id: "s1" });
    expect((await upload("merchant/t1/advideo-ref/s1/1.exe")).status).toBe(400);
    expect((await upload("merchant/t2/advideo-ref/s1/1.jpg")).status).toBe(400);
  });

  it("leaves the other uploads as they were for a paying workspace", async () => {
    const r = await upload("merchant/t1/photo-1.png");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ maximumSizeInBytes: 250 * 1024 * 1024 });
  });

  it("gives a workspace that pays nothing smaller files, and everyone a number of files a day", async () => {
    paid.aiUsd = 0.08;
    expect((await upload("merchant/t1/photo-1.png")).body).toMatchObject({ maximumSizeInBytes: 40 * 1024 * 1024 });
    expect(vi.mocked(takeDaily).mock.calls.at(-1)).toEqual(["t1", "upload_day", 1, 20]);
    paid.aiUsd = 2;
    await upload("merchant/t1/photo-1.png");
    expect(vi.mocked(takeDaily).mock.calls.at(-1)).toEqual(["t1", "upload_day", 1, 100]);
    vi.mocked(takeDaily).mockResolvedValueOnce(0);
    expect((await upload("merchant/t1/photo-2.png")).status).toBe(400);
  });
});

describe("the signals the plan is made from", () => {
  const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1";
  const NOW = Date.UTC(2026, 9, 12, 9, 0);

  beforeEach(() => {
    m.store.findUnique.mockResolvedValue({ id: "s1", tenantId: "t1", name: "B", igUsername: null, fbPageId: "123", tenant: { whatsappNumber: "9647501234567" } });
    m.brandKit.findUnique.mockResolvedValue({ tagline: null });
    m.product.findMany.mockResolvedValue([
      { id: "new", name: "نوێ", photos: [`${OWN}/new.jpg`], createdAt: new Date(NOW - 2 * 86_400_000), variants: [] },
      { id: "wanted", name: "داواکراو", photos: [`${OWN}/wanted.jpg`], createdAt: new Date(NOW - 90 * 86_400_000), variants: [{ amountMinor: 25000, currency: "IQD", inStock: true }] },
      { id: "nophoto", name: "بێ وێنە", photos: ["https://evil.example/x.jpg", `${OWN}/p.png`], createdAt: new Date(NOW - 5 * 86_400_000), variants: [] },
    ]);
    m.conversationMessage.groupBy.mockImplementation(async (a: { by: string[] }) => {
      if (a.by[0] === "boundProductId") return [{ boundProductId: "wanted", _count: { boundProductId: 7 } }];
      if (a.by[0] === "intent") return [{ intent: "price", _count: { intent: 5 } }];
      return [{ externalThreadId: "123_777888", _count: { _all: 4 } }];
    });
    m.order.groupBy.mockResolvedValue([{ productId: "wanted", _count: { productId: 2 } }]);
    m.adVideo.findMany.mockResolvedValue([
      { id: "v1", productId: "wanted", spec: { look: null, scenes: [] }, status: "POSTED", postedAt: new Date(NOW - 86_400_000), results: [{ target: "FB", publishId: "777888" }], createdAt: new Date(NOW - 86_400_000) },
    ]);
    vi.mocked(loadBuyerProfile).mockResolvedValue({ cities: ["Erbil"], hours: [20], languages: ["ckb"], orders: 3, messages: 9 } as never);
    vi.mocked(ordersByPost).mockResolvedValue({ "123_777888": 1 });
  });

  it("counts only questions and orders as demand, and not the intent 'none'", async () => {
    await gatherSignals("s1", "", NOW);
    const asked = m.conversationMessage.groupBy.mock.calls.find((c) => c[0].by[0] === "boundProductId")![0];
    expect(asked.where.commentType).toEqual({ in: ["QUESTION", "ORDER"] });
    const intents = m.conversationMessage.groupBy.mock.calls.find((c) => c[0].by[0] === "intent")![0];
    expect(intents.where.intent).toEqual({ not: null, notIn: ["none"] });
  });

  it("looks only at videos that were really made", async () => {
    await gatherSignals("s1", "", NOW);
    expect(m.adVideo.findMany.mock.calls[0][0].where).toEqual({ storeId: "s1", status: { in: ["RENDERED", "POSTING", "POSTED"] } });
  });

  it("puts the products buyers want first, and counts a photo only when the renderer can use it", async () => {
    const s = await gatherSignals("s1", "", NOW);
    expect(s?.products[0]).toMatchObject({ id: "wanted", asked14: 7, orders30: 2, hasPhoto: true, inStock: true });
    expect(s?.products.find((p) => p.id === "nophoto")?.hasPhoto).toBe(false);
    expect(s?.products.find((p) => p.id === "new")?.hasPhoto).toBe(true);
  });

  it("reads a Facebook video's comments and orders under the page-prefixed id, in one query each", async () => {
    const s = await gatherSignals("s1", "", NOW);
    expect(s?.recentVideos[0]).toMatchObject({ posted: true, comments: 4, orders: 1 });
    expect(vi.mocked(ordersByPost)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ordersByPost).mock.calls[0][1]).toEqual(["777888", "123_777888"]);
  });

  it("knows whether the shop has a number buyers can message", async () => {
    expect((await gatherSignals("s1", "", NOW))?.shop.hasPhone).toBe(true);
    m.store.findUnique.mockResolvedValue({ id: "s1", tenantId: "t1", name: "B", igUsername: null, fbPageId: null, tenant: { whatsappNumber: null } });
    expect((await gatherSignals("s1", "", NOW))?.shop.hasPhone).toBe(false);
  });
});

describe("createVideoAction: the language and the kind of a video", () => {
  const base = { tier: "LITE", topic: "a short ad", productId: "p1", voice: "shilan", publish: false, targets: [] as string[], review: false };
  const sent = () => vi.mocked(createAdVideo).mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.mocked(createAdVideo).mockResolvedValue({ ok: true, id: "job1" } as never);
    vi.mocked(loadProfile).mockResolvedValue(null);
    m.store.findFirst.mockResolvedValue({ id: "s1", plan: "MERCHANT", fbPageId: null, igUserId: null, videoLang: null });
  });

  it("keeps a Sorani ad exactly as it was: Sorani, an ad, the chosen Kurdish voice, the product", async () => {
    expect(await createVideoAction("s1", { ...base, voice: "rebin" })).toEqual({ ok: true, id: "job1" });
    expect(sent()).toMatchObject({ lang: "ckb", kind: "ad", voice: "rebin", productId: "p1", topic: "a short ad", source: "MANUAL", autoPost: false });
    // A voice that is not a Kurdish voice is the same default as before.
    await createVideoAction("s1", { ...base, voice: "male-ish" });
    expect(sent().voice).toBe("shilan");
    expect(vi.mocked(after)).toHaveBeenCalled();
  });

  it("uses the store's video language when none is given, and the one given over it, never the language of the screen", async () => {
    m.store.findFirst.mockResolvedValue({ id: "s1", plan: "MERCHANT", fbPageId: null, igUserId: null, videoLang: "ar" });
    await createVideoAction("s1", base);
    expect(sent()).toMatchObject({ lang: "ar", kind: "ad" });
    await createVideoAction("s1", { ...base, lang: "en" });
    expect(sent()).toMatchObject({ lang: "en" });
    // The screen's language here is English; the video stays in the language chosen for it.
    await createVideoAction("s1", { ...base, lang: "ckb" });
    expect(sent()).toMatchObject({ lang: "ckb" });
    // Something that is not a language is the store's own.
    await createVideoAction("s1", { ...base, lang: "fr" });
    expect(sent()).toMatchObject({ lang: "ar" });
  });

  it("gives Arabic and English a male or a female voice, and the language's default when the voice is a Kurdish one", async () => {
    await createVideoAction("s1", { ...base, lang: "en", voice: "female" });
    expect(sent()).toMatchObject({ lang: "en", voice: "female" });
    await createVideoAction("s1", { ...base, lang: "en", voice: "male" });
    expect(sent().voice).toBe("male");
    // The chat always sends "shilan": for another language that is no voice of it.
    await createVideoAction("s1", { ...base, lang: "ar", voice: "shilan" });
    expect(sent().voice).toBe("female");
    await createVideoAction("s1", { ...base, lang: "en", voice: "shilan", kind: "story", topic: "a mystery about a missing letter" });
    expect(sent().voice).toBe("male");
  });

  it("makes a story from the idea alone: no product, no review, a story's own kind", async () => {
    const idea = "a mystery about a missing letter in an old house";
    expect(await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: true })).toEqual({ ok: true, id: "job1" });
    expect(sent()).toMatchObject({ lang: "en", kind: "story", productId: null, topic: idea });
    expect(reviewIdea).not.toHaveBeenCalled();
  });

  it("refuses a story with no idea to tell, before anything is made", async () => {
    expect(await createVideoAction("s1", { ...base, topic: "  short  ", kind: "story" })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(await createVideoAction("s1", { ...base, topic: "", kind: "story", lang: "en" })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(createAdVideo).not.toHaveBeenCalled();
    // An ad needs no idea at all.
    expect(await createVideoAction("s1", { ...base, topic: "" })).toMatchObject({ ok: true });
    expect(sent().topic).toBeNull();
  });

  it("still reviews an ad's idea in the language of the screen, whatever language the video has", async () => {
    vi.mocked(reviewIdea).mockResolvedValue({ kept: true, text: "a short ad", summary: "" } as never);
    await createVideoAction("s1", { ...base, review: true, lang: "en" });
    expect(reviewIdea).toHaveBeenCalledWith(expect.objectContaining({ idea: "a short ad", kind: "video", lang: "en", productId: "p1" }));
    vi.mocked(reviewIdea).mockResolvedValue({ kept: false, text: "a better ad", summary: "sharper" } as never);
    expect(await createVideoAction("s1", { ...base, review: true, lang: "ar" })).toMatchObject({ ok: true, reviewed: { text: "a better ad" } });
    expect(sent()).toMatchObject({ topic: "a better ad", lang: "ar" });
  });

  it("follows what the page is for when no kind and no product are given, and the person's kind when it is", async () => {
    vi.mocked(loadProfile).mockResolvedValue({ goal: "monetize" } as never);
    await createVideoAction("s1", { ...base, productId: null, topic: "a mystery about a missing letter" });
    expect(sent()).toMatchObject({ kind: "story", productId: null });
    await createVideoAction("s1", { ...base, kind: "ad" });
    expect(sent()).toMatchObject({ kind: "ad", productId: "p1" });
    vi.mocked(loadProfile).mockResolvedValue({ goal: "sell" } as never);
    await createVideoAction("s1", { ...base, productId: null });
    expect(sent()).toMatchObject({ kind: "ad" });
    // A profile that cannot be read is an ad.
    vi.mocked(loadProfile).mockRejectedValue(new Error("down"));
    expect(await createVideoAction("s1", { ...base, productId: null })).toMatchObject({ ok: true });
    expect(sent()).toMatchObject({ kind: "ad" });
  });

  it("makes a video of a chosen product an ad even on a page that grows or earns from its content, and sends the product on", async () => {
    for (const goal of ["monetize", "grow"]) {
      vi.mocked(loadProfile).mockResolvedValue({ goal } as never);
      // No kind: the Publish page's panel before it sent one, and a chat make_video that names a product.
      expect(await createVideoAction("s1", { ...base, topic: "" })).toMatchObject({ ok: true });
      expect(sent()).toMatchObject({ kind: "ad", productId: "p1", topic: null });
      // The Publish page's panel says so itself.
      await createVideoAction("s1", { ...base, topic: "ab", kind: "ad" });
      expect(sent()).toMatchObject({ kind: "ad", productId: "p1" });
      // A short idea is no problem for an ad (the story-topic refusal is for stories only).
      expect(await createVideoAction("s1", { ...base, topic: "ring" })).toMatchObject({ ok: true });
    }
    // The person's own kind still wins over the product: a story drops it.
    await createVideoAction("s1", { ...base, kind: "story", topic: "a mystery about a missing letter" });
    expect(sent()).toMatchObject({ kind: "story", productId: null });
  });

  it("tells the person when there is no voice for the language, and what the pipeline refused otherwise", async () => {
    vi.mocked(createAdVideo).mockResolvedValue({ ok: false, error: "voice" } as never);
    expect(await createVideoAction("s1", { ...base, lang: "en" })).toEqual({ ok: false, error: en.video.errors.voice });
    vi.mocked(createAdVideo).mockResolvedValue({ ok: false, error: "topic" } as never);
    expect(await createVideoAction("s1", { ...base, lang: "en" })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(after).not.toHaveBeenCalled();
  });

  it("names the video's own errors in every language, none empty, none in the wrong script", () => {
    for (const d of [ckb, ar, en]) {
      expect(d.video.errors.voice.trim()).not.toBe("");
      expect(d.video.errors.topic.trim()).not.toBe("");
    }
    expect(/[کیەێۆڕڵڤپچژگ]/.test(ar.video.errors.voice + ar.video.errors.topic)).toBe(false);
    expect(/[؀-ۿ]/.test(en.video.errors.voice + en.video.errors.topic)).toBe(false);
  });
});

describe("saveVideoAutoAction: the store's video language", () => {
  const input = { mode: "DRAFT", tier: "LITE", hour: 19 };

  it("saves the language with the rest when it is one of the three", async () => {
    for (const lang of ["ckb", "ar", "en"]) {
      m.store.update.mockClear();
      expect(await saveVideoAutoAction("s1", { ...input, lang })).toEqual({ ok: true });
      expect(m.store.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { videoAutoMode: "DRAFT", videoAutoTier: "LITE", videoAutoHour: 19, videoLang: lang } });
    }
  });

  it("keeps the saved mode when none is given: a change of only the language or the hour does not switch the daily video off", async () => {
    expect(await saveVideoAutoAction("s1", { tier: "LITE", hour: 19, lang: "en" })).toEqual({ ok: true });
    expect(m.store.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { videoAutoTier: "LITE", videoAutoHour: 19, videoLang: "en" } });
    expect("videoAutoMode" in (m.store.update.mock.calls[0][0] as { data: object }).data).toBe(false);
    // A mode that is given still has to be one of the three (null is not "left out").
    m.store.update.mockClear();
    expect(await saveVideoAutoAction("s1", { ...input, mode: null as unknown as string })).toMatchObject({ ok: false });
    expect(await saveVideoAutoAction("s1", { ...input, mode: "" })).toMatchObject({ ok: false });
    expect(m.store.update).not.toHaveBeenCalled();
  });

  it("does not touch the saved language when none is given", async () => {
    expect(await saveVideoAutoAction("s1", input)).toEqual({ ok: true });
    expect(m.store.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { videoAutoMode: "DRAFT", videoAutoTier: "LITE", videoAutoHour: 19 } });
    expect("videoLang" in (m.store.update.mock.calls[0][0] as { data: object }).data).toBe(false);
  });

  it("refuses a language that is not one, saving nothing", async () => {
    for (const lang of ["fr", "", "CKB", "kurdish"]) {
      expect(await saveVideoAutoAction("s1", { ...input, lang })).toEqual({ ok: false, error: en.video.errors.tier });
    }
    expect(m.store.update).not.toHaveBeenCalled();
  });

  it("keeps its other rules: a mode, a tier and an hour that exist, and a person who may configure", async () => {
    expect(await saveVideoAutoAction("s1", { ...input, mode: "ALWAYS" })).toMatchObject({ ok: false });
    expect(await saveVideoAutoAction("s1", { ...input, hour: 31 })).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await saveVideoAutoAction("s1", { ...input, lang: "en" })).toMatchObject({ ok: false });
    expect(m.store.update).not.toHaveBeenCalled();
  });
});

describe("videoChoice: one rule for the screen's action and the chat's card", () => {
  it("is explicit, then the store's, then Sorani; and the kind is explicit, then the page's goal, then an ad", async () => {
    vi.mocked(loadProfile).mockResolvedValue(null);
    expect(await videoChoice("s1", null, {})).toEqual({ lang: "ckb", kind: "ad" });
    expect(await videoChoice("s1", undefined, {})).toEqual({ lang: "ckb", kind: "ad" });
    expect(await videoChoice("s1", "en", {})).toEqual({ lang: "en", kind: "ad" });
    expect(await videoChoice("s1", "en", { lang: "ar" })).toEqual({ lang: "ar", kind: "ad" });
    expect(await videoChoice("s1", "klingon", {})).toEqual({ lang: "ckb", kind: "ad" });
    vi.mocked(loadProfile).mockResolvedValue({ goal: "grow" } as never);
    expect(await videoChoice("s1", null, {})).toEqual({ lang: "ckb", kind: "story" });
    expect(await videoChoice("s1", null, { kind: "ad" })).toEqual({ lang: "ckb", kind: "ad" });
    expect(await videoChoice("s1", null, { kind: "documentary" })).toEqual({ lang: "ckb", kind: "story" });
  });

  it("makes a named or chosen product an ad, whatever the page is for; an explicit kind still wins", async () => {
    vi.mocked(loadProfile).mockResolvedValue({ goal: "monetize" } as never);
    expect(await videoChoice("s1", null, { hasProduct: true })).toEqual({ lang: "ckb", kind: "ad" });
    vi.mocked(loadProfile).mockResolvedValue({ goal: "grow" } as never);
    expect(await videoChoice("s1", "en", { hasProduct: true })).toEqual({ lang: "en", kind: "ad" });
    expect(await videoChoice("s1", "en", { hasProduct: true, kind: "story" })).toEqual({ lang: "en", kind: "story" });
    // No product: the goal decides, as before.
    expect(await videoChoice("s1", null, { hasProduct: false })).toEqual({ lang: "ckb", kind: "story" });
  });

  it("does not read the profile when the kind was given, or a product was", async () => {
    vi.mocked(loadProfile).mockClear();
    await videoChoice("s1", null, { kind: "story" });
    await videoChoice("s1", null, { hasProduct: true });
    expect(loadProfile).not.toHaveBeenCalled();
  });
});
