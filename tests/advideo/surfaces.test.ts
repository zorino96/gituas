// The places where owners and members reach the video code: the plan actions, the reference actions,
// the upload route's policy, and the signals the plan is made from.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER" } as { id: string; role: string } | null }));

vi.mock("@/lib/db", () => ({
  db: {
    store: { findFirst: vi.fn(), findUnique: vi.fn() },
    brandKit: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    order: { groupBy: vi.fn() },
    conversationMessage: { groupBy: vi.fn() },
    adVideo: { findMany: vi.fn() },
  },
}));
vi.mock("@/app/app/data", () => ({ currentWorkspace: vi.fn(async () => ws.current) }));
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
vi.mock("@vercel/blob/client", () => ({
  // Hands the route's own policy back, so the test reads exactly what a token would be issued for.
  handleUpload: vi.fn(async (o: { body: { pathname: string }; onBeforeGenerateToken: (p: string) => Promise<unknown> }) => o.onBeforeGenerateToken(o.body.pathname)),
}));

import { db } from "@/lib/db";
import { removeRef } from "@/lib/advideo/refs";
import { getDailyBrief, loadMarketNotes, readTodaysBrief, saveMarketNotes } from "@/lib/advideo/strategy";
import { loadBuyerProfile, ordersByPost } from "@/lib/orders/audience";
import { gatherSignals } from "@/lib/advideo/signals";
import { refreshPlanAction, removeRefAction, saveMarketNotesAction } from "@/app/app/video/actions";
import { POST as uploadRoute } from "@/app/api/app/upload/route";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const plan = (over: Record<string, unknown> = {}) => ({ brief: { date: "d", objective: "trust", why: "x", madeAt: 0, source: "model", ...over }, cached: false });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AD_VIDEO_ENABLED", "1");
  ws.current = { id: "t1", role: "OWNER" };
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
    ws.current = { id: "t1", role: "MEMBER" };
    expect(await refreshPlanAction("s1")).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER" };
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
    ws.current = { id: "t1", role: "MEMBER" };
    expect((await upload("merchant/t1/advideo-ref/s1/1.jpg")).status).toBe(400);
    ws.current = { id: "t1", role: "OWNER" };
    m.store.findFirst.mockResolvedValue(null);
    expect((await upload("merchant/t1/advideo-ref/s7/1.jpg")).status).toBe(400);
    m.store.findFirst.mockResolvedValue({ id: "s1" });
    expect((await upload("merchant/t1/advideo-ref/s1/1.exe")).status).toBe(400);
    expect((await upload("merchant/t2/advideo-ref/s1/1.jpg")).status).toBe(400);
  });

  it("leaves the other uploads as they were", async () => {
    const r = await upload("merchant/t1/photo-1.png");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ maximumSizeInBytes: 250 * 1024 * 1024 });
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
