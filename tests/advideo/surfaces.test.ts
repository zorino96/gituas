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
    adVideo: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
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
vi.mock("@/lib/storage", () => ({
  presignPut: vi.fn(async (p: string) => `https://r2/${p}?signed`),
  publicUrl: (p: string) => `https://media.gituas.com/${p}`,
  withRandomSuffix: (p: string) => p,
}));

import { after } from "next/server";
import { db } from "@/lib/db";
import { takeDaily } from "@/lib/ai/slots";
import { reviewIdea } from "@/lib/ai/review-idea";
import { createAdVideo, prepareAdVideo } from "@/lib/advideo/prepare";
import { loadProfile } from "@/lib/shop/profile";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { videoChoice } from "@/app/app/video/choice";
import { removeRef } from "@/lib/advideo/refs";
import { getDailyBrief, loadMarketNotes, readTodaysBrief, saveMarketNotes } from "@/lib/advideo/strategy";
import { loadBuyerProfile, ordersByPost } from "@/lib/orders/audience";
import { gatherSignals } from "@/lib/advideo/signals";
import { createVideoAction, refreshPlanAction, removeRefAction, saveMarketNotesAction, saveVideoAutoAction, videoJobStatusAction } from "@/app/app/video/actions";
import { Prisma } from "@/generated/prisma/client";
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

const MB = 1024 * 1024;
const typeOf = (p: string) => (/\.mp4$/.test(p) ? "video/mp4" : /\.png$/.test(p) ? "image/png" : "image/jpeg");
const upload = async (pathname: string, size = 1000, contentType = typeOf(pathname)) => {
  const res = (await uploadRoute(new Request("http://x/api/app/upload", { method: "POST", body: JSON.stringify({ pathname, contentType, size }) }))) as unknown as { body: Record<string, unknown>; status: number };
  return res;
};

describe("the upload route's policy for reference files", () => {
  it("signs an upload for a picture of a store of this workspace, with that kind's types and size", async () => {
    const r = await upload("merchant/t1/advideo-ref/s1/1.jpg");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ url: "https://media.gituas.com/merchant/t1/advideo-ref/s1/1.jpg", pathname: "merchant/t1/advideo-ref/s1/1.jpg" });
    expect((await upload("merchant/t1/advideo-ref/s1/1.jpg", 12 * MB)).status).toBe(200);
    expect((await upload("merchant/t1/advideo-ref/s1/1.jpg", 12 * MB + 1)).status).toBe(400);
    expect((await upload("merchant/t1/advideo-ref/s1/1.jpg", 1000, "video/mp4")).status).toBe(400);
    expect((await upload("merchant/t1/advideo-ref/s1/1.mp4", 40 * MB)).status).toBe(200);
    expect((await upload("merchant/t1/advideo-ref/s1/1.mp4", 40 * MB + 1)).status).toBe(400);
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
    expect((await upload("merchant/t1/photo-1.png", 250 * MB)).status).toBe(200);
    expect((await upload("merchant/t1/photo-1.png", 250 * MB + 1)).status).toBe(400);
  });

  it("gives a workspace that pays nothing smaller files, and everyone a number of files a day", async () => {
    paid.aiUsd = 0.08;
    expect((await upload("merchant/t1/photo-1.png", 40 * MB)).status).toBe(200);
    expect((await upload("merchant/t1/photo-1.png", 40 * MB + 1)).status).toBe(400);
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
    // The stored job the facts are read back from: none unless a test gives one.
    m.adVideo.findUnique.mockReset();
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

  it("makes a story from the idea alone: no product, the owner's words as typed (literal), and no review unless asked", async () => {
    const idea = "a mystery about a missing letter in an old house";
    expect(await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: false })).toEqual({ ok: true, id: "job1" });
    expect(sent()).toMatchObject({ lang: "en", kind: "story", productId: null, topic: idea, literal: true });
    // Left out, the review is off too.
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "ckb", review: undefined });
    expect(sent()).toMatchObject({ lang: "ckb", kind: "story", topic: idea, literal: true });
    expect(reviewIdea).not.toHaveBeenCalled();
    // An ad never carries the flag: it is made exactly as before.
    await createVideoAction("s1", { ...base });
    expect("literal" in sent()).toBe(false);
  });

  it("reviews a story's idea against the page when the owner asked: the story kind, no product, the rewritten idea goes on and is not literal", async () => {
    vi.mocked(reviewIdea).mockResolvedValue({ kept: false, text: "A cold case from a village. Suggested case: Hinterkaifeck murders", summary: "added the page's angle" } as never);
    const idea = "one of the historical mystery stories, crime";
    expect(await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: true })).toEqual({
      ok: true,
      id: "job1",
      reviewed: { text: "A cold case from a village. Suggested case: Hinterkaifeck murders", summary: "added the page's angle" },
    });
    expect(reviewIdea).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", storeId: "s1", idea, kind: "story", lang: "en", productId: null }));
    expect(sent()).toMatchObject({ kind: "story", productId: null, topic: "A cold case from a village. Suggested case: Hinterkaifeck murders", literal: false });
    // Even a product the form still holds is not given to a story's review.
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: true });
    expect(vi.mocked(reviewIdea).mock.calls.at(-1)![0].productId).toBeNull();
  });

  it("tells the owner plainly that there was nothing to read when the page is not known yet: reviewSkipped, never 'reviewed', and the words go on as written", async () => {
    const idea = "Hinterkaifeck murders 1922";
    const said = "Nothing to read yet: your words were used as written.";
    vi.mocked(reviewIdea).mockResolvedValue({ kept: true, skipped: true, text: idea, summary: said } as never);
    const r = await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: true });
    expect(r).toEqual({ ok: true, id: "job1", reviewSkipped: { summary: said } });
    expect("reviewed" in r).toBe(false);
    expect(sent()).toMatchObject({ topic: idea, literal: false });
    // A kept ad idea has no summary and says nothing, as before.
    vi.mocked(reviewIdea).mockResolvedValue({ kept: true, text: "a short ad", summary: "" } as never);
    expect(await createVideoAction("s1", { ...base, review: true })).toEqual({ ok: true, id: "job1" });
    // A story whose review changed the words is "reviewed", with no skipped note.
    vi.mocked(reviewIdea).mockResolvedValue({ kept: false, text: "a clearer brief", summary: "added the angle" } as never);
    const changed = await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", review: true });
    expect(changed).toEqual({ ok: true, id: "job1", reviewed: { text: "a clearer brief", summary: "added the angle" } });
    expect("reviewSkipped" in changed).toBe(false);
  });

  it("stops before anything is counted when a story's review cannot be done, and says so", async () => {
    const { ReviewFailed } = await import("@/lib/ai/review-idea");
    vi.mocked(reviewIdea).mockRejectedValue(new ReviewFailed());
    expect(await createVideoAction("s1", { ...base, topic: "Hinterkaifeck murders 1922", kind: "story", lang: "en", review: true })).toEqual({ ok: false, error: en.video.errors.reviewFailed });
    expect(createAdVideo).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("hands the photo switch of a story to the pipeline as it was given, and sends none for a Sorani ad or when it is left out", async () => {
    const idea = "the Hinterkaifeck murders, 1922";
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", photos: false });
    expect(sent()).toMatchObject({ lang: "en", kind: "story", productId: null, topic: idea, photos: false });
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "ar", photos: true });
    expect(sent()).toMatchObject({ lang: "ar", kind: "story", photos: true });
    // Left out, nothing is said: the pipeline's own default (photographs on for a true story) applies.
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en" });
    expect(sent().photos).toBeUndefined();
    // An ad is made exactly as before.
    await createVideoAction("s1", { ...base, voice: "rebin" });
    expect(sent()).toMatchObject({ lang: "ckb", kind: "ad", voice: "rebin", productId: "p1", topic: "a short ad", source: "MANUAL", autoPost: false });
    expect(sent().photos).toBeUndefined();
  });

  it("does not judge whether a story names a case: a generic idea starts at once, because the system chooses a real documented case", async () => {
    for (const lang of ["en", "ar", "ckb"]) {
      expect(await createVideoAction("s1", { ...base, topic: "a gripping story about an unsolved case", kind: "story", lang })).toEqual({ ok: true, id: "job1" });
    }
    expect(createAdVideo).toHaveBeenCalledTimes(3);
  });

  it("decides whether a story is fiction ONCE, from the owner's own words, before any review: asked = fiction true is sent, not asked = fiction false is sent (the pipeline follows it and never reads the rewritten idea); an ad sends none", async () => {
    // The owner's words say fiction; the review rewrites them without the word: the decision stays.
    vi.mocked(reviewIdea).mockResolvedValue({ kept: false, text: "A lighthouse keeper vanishes; a quiet, atmospheric tale.", summary: "x" } as never);
    await createVideoAction("s1", { ...base, topic: "a fictional lighthouse mystery", kind: "story", lang: "en", review: true });
    expect(sent()).toMatchObject({ fiction: true, topic: "A lighthouse keeper vanishes; a quiet, atmospheric tale." });
    // The owner's words ask for a real story; the reviewer happens to write the word fictional: the story stays real.
    vi.mocked(reviewIdea).mockResolvedValue({ kept: false, text: "A real case, free of fictional details, told calmly.", summary: "x" } as never);
    await createVideoAction("s1", { ...base, topic: "one of the historical mystery stories, crime", kind: "story", lang: "en", review: true });
    expect(sent().fiction).toBe(false);
    // Sorani: the plain word is a wish for fiction.
    await createVideoAction("s1", { ...base, topic: "چیرۆکێکی خەیاڵی دەربارەی فانۆس", kind: "story", lang: "ckb" });
    expect(sent()).toMatchObject({ fiction: true });
    // An ad never carries it, whatever its words.
    await createVideoAction("s1", { ...base, topic: "a fictional offer" });
    expect("fiction" in sent()).toBe(false);
  });

  it("makes a story wide (16:9, for YouTube) only when asked, and an ad ignores the shape: it is always vertical", async () => {
    const idea = "one of the historical mystery stories, crime";
    await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "ckb", format: "wide" });
    expect(sent()).toMatchObject({ kind: "story", format: "wide" });
    // Vertical, left out and anything else send nothing: absent is vertical, as every video was.
    for (const format of ["vertical", undefined, "square"]) {
      await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "ckb", format });
      expect("format" in sent(), String(format)).toBe(false);
    }
    await createVideoAction("s1", { ...base, format: "wide" });
    expect(sent()).toMatchObject({ kind: "ad" });
    expect("format" in sent()).toBe(false);
    // A fiction can be wide too.
    await createVideoAction("s1", { ...base, topic: "a fictional lighthouse mystery", kind: "story", lang: "en", format: "wide" });
    expect(sent()).toMatchObject({ fiction: true, format: "wide" });
  });

  it("holds the script and the voice to the end of THIS function's 60 seconds, not to 55 seconds from whenever the review let them start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      vi.mocked(prepareAdVideo).mockResolvedValue(true);
      // The review takes 12 seconds.
      vi.mocked(reviewIdea).mockImplementation((async () => {
        vi.setSystemTime(1_012_000);
        return { kept: false, text: "a clearer brief", summary: "x" };
      }) as never);
      await createVideoAction("s1", { ...base, topic: "one of the historical mystery stories, crime", kind: "story", lang: "en", review: true });
      const start = vi.mocked(after).mock.calls.at(-1)![0] as () => unknown;
      await start();
      expect(prepareAdVideo).toHaveBeenLastCalledWith("job1", 1_055_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the facts of the job as it is stored: its language, kind, shape and photographs, read back from the row and not from what was asked", async () => {
    const idea = "one of the historical mystery stories, crime";
    // A wide Sorani-less story with its photographs on.
    m.adVideo.findUnique.mockResolvedValue({ spec: { lang: "en", kind: "story", format: "wide" } });
    expect(await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", format: "wide" })).toEqual({
      ok: true,
      id: "job1",
      facts: { lang: "en", kind: "story", format: "wide", photos: "on" },
    });
    expect(m.adVideo.findUnique).toHaveBeenCalledWith({ where: { id: "job1" }, select: { spec: true } });
    // The pipeline did not keep the shape that was asked: the facts say vertical, because the stored job is vertical.
    m.adVideo.findUnique.mockResolvedValue({ spec: { lang: "en", kind: "story" } });
    const vertical = await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "en", format: "wide" });
    expect(vertical).toMatchObject({ facts: { format: "vertical" } });
    // Photographs switched off, and a fiction.
    m.adVideo.findUnique.mockResolvedValue({ spec: { lang: "ar", kind: "story", noPhotos: true } });
    expect(await createVideoAction("s1", { ...base, topic: idea, kind: "story", lang: "ar", photos: false })).toMatchObject({ facts: { lang: "ar", photos: "off" } });
    m.adVideo.findUnique.mockResolvedValue({ spec: { kind: "story", fiction: true } });
    expect(await createVideoAction("s1", { ...base, topic: "a fictional lighthouse mystery", kind: "story", lang: "ckb" })).toMatchObject({ facts: { lang: "ckb", photos: "fiction", format: "vertical" } });
    // An ad: a language and a kind, always vertical, no photographs word.
    m.adVideo.findUnique.mockResolvedValue({ spec: { lang: "en" } });
    expect(await createVideoAction("s1", { ...base, lang: "en", format: "wide" })).toEqual({ ok: true, id: "job1", facts: { lang: "en", kind: "ad", format: "vertical" } });
    // A job that cannot be read gives no facts at all (never a guess).
    m.adVideo.findUnique.mockRejectedValue(new Error("db down"));
    expect(await createVideoAction("s1", { ...base })).toEqual({ ok: true, id: "job1" });
    m.adVideo.findUnique.mockResolvedValue(null);
    expect(await createVideoAction("s1", { ...base })).toEqual({ ok: true, id: "job1" });
  });

  it("refuses a story with no idea to tell (fewer than four characters), before anything is made, and takes a short word", async () => {
    expect(await createVideoAction("s1", { ...base, topic: "  abc  ", kind: "story" })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(await createVideoAction("s1", { ...base, topic: "", kind: "story", lang: "en" })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(createAdVideo).not.toHaveBeenCalled();
    // A review does not rescue a story with nothing to go on.
    expect(await createVideoAction("s1", { ...base, topic: "ab", kind: "story", lang: "ckb", review: true })).toEqual({ ok: false, error: en.video.errors.topic });
    expect(reviewIdea).not.toHaveBeenCalled();
    // A word is enough: the system chooses or finds the case.
    expect(await createVideoAction("s1", { ...base, topic: " Titanic ", kind: "story", lang: "en" })).toMatchObject({ ok: true });
    expect(sent().topic).toBe("Titanic");
    expect(await createVideoAction("s1", { ...base, topic: "جريمة", kind: "story", lang: "ar" })).toMatchObject({ ok: true });
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

describe("saveVideoAutoAction: the daily video's own plan", () => {
  const input = { mode: "PUBLISH", tier: "LITE", hour: 19 };
  const plan = { brief: "یەکێک لە چیرۆکە نهێنییە مێژووییەکان", kind: "story", review: false, photos: true, targets: ["FB"] };
  const saved = () => (m.store.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;

  beforeEach(() => {
    m.store.findFirst.mockResolvedValue({ id: "s1", fbPageId: "fb1", igUserId: null, videoLang: null });
  });

  it("saves the plan read by parseVideoAutoPlan with the rest, and nothing about a plan when none is given", async () => {
    expect(await saveVideoAutoAction("s1", { ...input, plan })).toEqual({ ok: true });
    expect(saved()).toEqual({ videoAutoMode: "PUBLISH", videoAutoTier: "LITE", videoAutoHour: 19, videoAutoPlan: plan });
    m.store.update.mockClear();
    expect(await saveVideoAutoAction("s1", input)).toEqual({ ok: true });
    expect("videoAutoPlan" in saved()).toBe(false);
  });

  it("reads the plan tolerantly: the owner's words are kept, bad platforms and a bad shape are dropped, YouTube is never saved without both answers", async () => {
    expect(await saveVideoAutoAction("s1", { ...input, plan: { ...plan, brief: `  ${plan.brief}  `, targets: ["FB", "TT", "YT"], format: "square", review: "yes" } })).toEqual({ ok: true });
    expect(saved().videoAutoPlan).toEqual({ brief: plan.brief, kind: "story", review: false, photos: true, targets: ["FB"] });
  });

  it("removes the plan when it is null (the daily video goes back to its usual way) and leaves it alone when it is left out", async () => {
    expect(await saveVideoAutoAction("s1", { tier: "LITE", hour: 19, plan: null })).toEqual({ ok: true });
    expect(saved().videoAutoPlan).toBe(Prisma.DbNull);
    m.store.update.mockClear();
    expect(await saveVideoAutoAction("s1", { tier: "LITE", hour: 19, plan: undefined })).toEqual({ ok: true });
    expect("videoAutoPlan" in saved()).toBe(false);
  });

  it("refuses what is not a plan, and a platform the shop does not have, saving nothing", async () => {
    for (const junk of ["x", 5, [], {}, { kind: "movie" }, { brief: "x" }]) {
      expect(await saveVideoAutoAction("s1", { ...input, plan: junk }), JSON.stringify(junk)).toMatchObject({ ok: false });
    }
    // No Instagram account in this shop, and no YouTube channel in the workspace.
    expect(await saveVideoAutoAction("s1", { ...input, plan: { ...plan, targets: ["IG"] } })).toEqual({ ok: false, error: en.video.errors.targets });
    expect(await saveVideoAutoAction("s1", { ...input, plan: { ...plan, targets: ["YT"], youtube: { privacy: "public", madeForKids: false } } })).toEqual({ ok: false, error: en.video.errors.targets });
    expect(m.store.update).not.toHaveBeenCalled();
  });

  it("is for people who may configure, as the rest of the daily video", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await saveVideoAutoAction("s1", { ...input, plan })).toMatchObject({ ok: false });
    expect(m.store.update).not.toHaveBeenCalled();
  });
});

describe("createVideoAction: the chat's own deadline", () => {
  it("also holds the script and the voice to the chat's deadline plus a short margin, when the chat started the video", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      vi.mocked(prepareAdVideo).mockResolvedValue(true);
      vi.mocked(createAdVideo).mockResolvedValue({ ok: true, id: "job1" } as never);
      // The chat's turn ends 30 s from now: the writer may use 5 s more than that, not the 55 s the Video screen would give.
      await createVideoAction("s1", { tier: "LITE", topic: "one of the historical mystery stories, crime", productId: null, voice: "shilan", publish: false, targets: [], kind: "story", lang: "en", deadline: 1_030_000 });
      await (vi.mocked(after).mock.calls.at(-1)![0] as () => unknown)();
      expect(prepareAdVideo).toHaveBeenLastCalledWith("job1", 1_035_000);
      // With no deadline from the chat it is 55 s from the start, as before.
      await createVideoAction("s1", { tier: "LITE", topic: "one of the historical mystery stories, crime", productId: null, voice: "shilan", publish: false, targets: [], kind: "story", lang: "en" });
      await (vi.mocked(after).mock.calls.at(-1)![0] as () => unknown)();
      expect(prepareAdVideo).toHaveBeenLastCalledWith("job1", 1_055_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("videoJobStatusAction: what the chat needs to show a finished story", () => {
  const row = (spec: unknown, over: Record<string, unknown> = {}) => ({ status: "RENDERED", videoUrl: "https://abc.public.blob.vercel-storage.com/v.mp4", videoPath: "merchant/t1/v.mp4", caption: "A caption", error: null, spec, ...over });

  it("returns the case, the told-from-memory and recent flags, why it was held back, the shape and the credits of a story", async () => {
    m.adVideo.findFirst.mockResolvedValue(
      row(
        {
          lang: "en",
          kind: "story",
          format: "wide",
          subject: { name: "Hinterkaifeck murders", url: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders", chosen: true, recent: true },
          credits: [{ scene: 1, title: "File:Hof.jpg", author: "Alice Example", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:Hof.jpg", attribution: true }],
        },
        { error: "waits for you: a recent case" },
      ),
    );
    const r = await videoJobStatusAction("j1");
    expect(r).toMatchObject({ ok: true, status: "RENDERED", url: "https://abc.public.blob.vercel-storage.com/v.mp4", caption: "A caption" });
    const story = (r as unknown as { story: Record<string, unknown> }).story;
    expect(story).toMatchObject({
      subject: "Hinterkaifeck murders",
      subjectUrl: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders",
      chosen: true,
      fromMemory: false,
      recent: true,
      wide: true,
      waited: en.video.waitRecent,
    });
    expect(story.credits).toEqual([{ title: "File:Hof.jpg", author: "Alice Example", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:Hof.jpg" }]);
  });

  it("gives a story told from memory no article link, and an ad no story part at all", async () => {
    m.adVideo.findFirst.mockResolvedValue(row({ kind: "story", subject: { name: "Mary Celeste", url: "https://en.wikipedia.org/wiki/Mary_Celeste", fromMemory: true } }, { error: "waits for you: told from memory, not from an article" }));
    const memory = (await videoJobStatusAction("j1")) as unknown as { story: { subjectUrl: string | null; fromMemory: boolean; waited: string | null; wide: boolean } };
    expect(memory.story).toMatchObject({ subjectUrl: null, fromMemory: true, waited: en.video.waitMemory, wide: false });
    m.adVideo.findFirst.mockResolvedValue(row({ lang: "en", kind: "ad" }));
    const ad = await videoJobStatusAction("j1");
    expect(ad).toMatchObject({ ok: true, status: "RENDERED" });
    expect("story" in ad).toBe(false);
  });

  it("says nothing of a video that is not ready, and refuses a job of another workspace", async () => {
    m.adVideo.findFirst.mockResolvedValue(row({ kind: "story", subject: { name: "X" } }, { status: "QUEUED" }));
    expect(await videoJobStatusAction("j1")).toMatchObject({ ok: true, status: "QUEUED", url: null });
    m.adVideo.findFirst.mockResolvedValue(null);
    expect(await videoJobStatusAction("j9")).toMatchObject({ ok: false });
    expect((m.adVideo.findFirst.mock.calls.at(-1)![0] as { where: { tenantId: string } }).where.tenantId).toBe("t1");
  });
});
