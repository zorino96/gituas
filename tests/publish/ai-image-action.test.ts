import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const usage = vi.hoisted(() => new Map<string, number>());
const limits = vi.hoisted(() => ({ images: 8, imagesPerDay: 5 }));

vi.mock("@/lib/db", () => ({
  db: {
    product: { findFirst: vi.fn() },
    store: { findFirst: vi.fn(async () => ({ id: "s1" })) },
    usage: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        const k = `${where.tenantId_month_metric.tenantId}|${where.tenantId_month_metric.month}|${where.tenantId_month_metric.metric}`;
        return usage.has(k) ? { count: usage.get(k)! } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } }; create: { count: number }; update: { count: { increment: number } } }) => {
        const k = `${where.tenantId_month_metric.tenantId}|${where.tenantId_month_metric.month}|${where.tenantId_month_metric.metric}`;
        usage.set(k, usage.has(k) ? usage.get(k)! + update.count.increment : create.count);
        return { count: usage.get(k)! };
      }),
      updateMany: vi.fn(async ({ where }: { where: { tenantId: string; month: string; metric: string } }) => {
        const k = `${where.tenantId}|${where.month}|${where.metric}`;
        if ((usage.get(k) ?? 0) > 0) usage.set(k, usage.get(k)! - 1);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/app/app/data", () => ({ currentWorkspace: vi.fn(async () => ws.current) }));
vi.mock("@/lib/i18n", async () => {
  const { en } = await import("@/lib/i18n/en");
  return { dict: () => en, getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ images: limits.images, imagesPerDay: limits.imagesPerDay })) }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/ai/image", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/image")>()), createImage: vi.fn(), imageEnabled: vi.fn(() => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ put: vi.fn(async (pathname: string) => ({ url: `https://x.public.blob.vercel-storage.com/${pathname}`, pathname })) }));

import { createImage, ImageError, imageEnabled } from "@/lib/ai/image";
import { completeJson } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { put } from "@/lib/storage";
import { baghdadDay } from "@/lib/ai/slots";
import { monthKey } from "@/lib/billing/limits";
import { generateAiImageAction } from "@/app/app/publish/ai-image-action";

const input = { idea: "the bag on a marble table", productId: null as string | null, refUrls: [] as string[], shape: "square" as const };
let png: Buffer;

beforeEach(async () => {
  vi.clearAllMocks();
  usage.clear();
  limits.images = 8;
  limits.imagesPerDay = 5;
  ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
  vi.mocked(imageEnabled).mockReturnValue(true);
  png ??= await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).png().toBuffer();
  vi.mocked(createImage).mockResolvedValue(png);
  vi.mocked(completeJson).mockResolvedValue({ data: { text: "A bag on a marble table, soft morning light, product exactly as in the reference.", summary: "Made the light and the setting clear." }, model: "m" });
});

describe("generateAiImageAction", () => {
  it("makes a JPEG in the workspace's own folder and hands it back as the post's media", async () => {
    const r = await generateAiImageAction(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.media.type).toBe("IMAGE");
    expect(r.media.pathname).toMatch(/^merchant\/t1\/ai-\d+\.jpg$/);
    const [, bytes, opts] = vi.mocked(put).mock.calls[0] as unknown as [string, Buffer, { contentType: string }];
    expect(opts.contentType).toBe("image/jpeg");
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");
  });

  it("has Haiku review the idea against the brand first, counted against the workspace, and shows what was asked", async () => {
    const r = await generateAiImageAction(input);
    expect(vi.mocked(completeJson).mock.calls[0][0]).toMatchObject({ tier: "haiku", meter: { scope: "t1" }, maxTokens: 500 });
    expect(vi.mocked(createImage).mock.calls[0][0].prompt).toContain("marble table");
    expect(r).toMatchObject({ ok: true, reviewed: true, summary: "Made the light and the setting clear." });
    if (r.ok) expect(r.prompt).toContain("marble table");
  });

  it("sends the idea exactly as typed, with no review call, when the owner switched the review off", async () => {
    const r = await generateAiImageAction({ ...input, review: false });
    expect(completeJson).not.toHaveBeenCalled();
    expect(vi.mocked(createImage).mock.calls[0][0].prompt).toBe("the bag on a marble table");
    expect(r).toMatchObject({ ok: true, reviewed: false, prompt: "the bag on a marble table" });
  });

  it("stops without taking a place or spending anything when a review was asked for and cannot be done", async () => {
    vi.mocked(completeJson).mockRejectedValue(new Error("this month's AI allowance is used up"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await generateAiImageAction(input);
    expect(r).toMatchObject({ ok: false });
    expect(createImage).not.toHaveBeenCalled();
    expect([...usage.values()].every((v) => v === 0)).toBe(true);
  });

  it("sends the product's photo and the owner's references, own storage only", async () => {
    vi.mocked(db.product.findFirst).mockResolvedValue({
      name: "جانتا",
      description: null,
      photos: ["https://abc.public.blob.vercel-storage.com/merchant/t1/p.jpg", "https://evil.example/p2.jpg"],
    } as never);
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => (fetched.push(u), new Response(new Uint8Array(png), { status: 200 }))),
    );
    await generateAiImageAction({
      ...input,
      productId: "p1",
      refUrls: ["https://abc.public.blob.vercel-storage.com/merchant/t1/ref1.png", "https://abc.public.blob.vercel-storage.com/merchant/t2/other-tenant.png", "https://evil.example/x.png"],
    });
    expect(fetched).toEqual(["https://abc.public.blob.vercel-storage.com/merchant/t1/p.jpg", "https://abc.public.blob.vercel-storage.com/merchant/t1/ref1.png"]);
    expect(vi.mocked(createImage).mock.calls[0][0].refs).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("is for people who may publish, in a shop, with the key set and a plan that has pictures", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect((await generateAiImageAction(input)).ok).toBe(false);
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
    expect((await generateAiImageAction(input)).ok).toBe(false);
    ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
    vi.mocked(imageEnabled).mockReturnValue(false);
    expect((await generateAiImageAction(input)).ok).toBe(false);
    vi.mocked(imageEnabled).mockReturnValue(true);
    limits.images = 0;
    expect(await generateAiImageAction(input)).toMatchObject({ ok: false });
    expect(createImage).not.toHaveBeenCalled();
    ws.current = null;
    expect((await generateAiImageAction(input)).ok).toBe(false);
  });

  it("crops the tall picture to 4:5, the tallest Instagram's feed takes", async () => {
    await generateAiImageAction({ ...input, shape: "portrait" });
    const [, bytes] = vi.mocked(put).mock.calls[0] as unknown as [string, Buffer];
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1280]);
  });

  it("answers a used-up day or month before it downloads any reference", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const refUrls = ["https://abc.public.blob.vercel-storage.com/merchant/t1/ref1.png"];
    usage.set(`t1|${baghdadDay()}|ai_image_day`, 5);
    expect(await generateAiImageAction({ ...input, refUrls })).toMatchObject({ ok: false });
    usage.clear();
    usage.set(`t1|${monthKey()}|ai_image`, 8);
    expect(await generateAiImageAction({ ...input, refUrls })).toMatchObject({ ok: false });
    expect(fetched).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never reads a reference past 12 MB, by its declared size or by its bytes, and spends nothing", async () => {
    const refUrls = ["https://abc.public.blob.vercel-storage.com/merchant/t1/ref1.png"];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(8), { status: 200, headers: { "content-length": String(13 * 1024 * 1024) } })));
    expect(await generateAiImageAction({ ...input, refUrls })).toMatchObject({ ok: false });
    const big = new Uint8Array(13 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200 })));
    expect(await generateAiImageAction({ ...input, refUrls })).toMatchObject({ ok: false });
    expect(createImage).not.toHaveBeenCalled();
    expect([...usage.values()].every((v) => v === 0)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("asks for an idea of a few words", async () => {
    expect(await generateAiImageAction({ ...input, idea: " a " })).toMatchObject({ ok: false });
    expect(createImage).not.toHaveBeenCalled();
  });

  it("makes at most the daily and the monthly number, and parallel requests cannot all pass", async () => {
    limits.imagesPerDay = 1;
    const results = await Promise.all(Array.from({ length: 6 }, () => generateAiImageAction(input)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(createImage).toHaveBeenCalledTimes(1);
    limits.imagesPerDay = 5;
    limits.images = 1;
    const again = await generateAiImageAction(input);
    expect(again.ok).toBe(false);
  });

  it("gives the place back, and says why, when OpenAI refused to make the picture", async () => {
    for (const kind of ["refused", "busy", "config"] as const) {
      vi.mocked(createImage).mockRejectedValue(new ImageError(kind));
      expect(await generateAiImageAction(input)).toMatchObject({ ok: false });
      expect([...usage.values()].every((v) => v === 0)).toBe(true);
    }
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps the place when the request went out and the picture may still be paid for", async () => {
    vi.mocked(createImage).mockRejectedValue(new ImageError("timeout"));
    expect((await generateAiImageAction(input)).ok).toBe(false);
    expect([...usage.values()].some((v) => v > 0)).toBe(true);
    usage.clear();
    vi.mocked(createImage).mockRejectedValue(new ImageError("failed"));
    expect((await generateAiImageAction(input)).ok).toBe(false);
    expect([...usage.values()].some((v) => v > 0)).toBe(true);
    usage.clear();
    // The picture came back, but storing it failed: it was made, so it counts.
    vi.mocked(createImage).mockResolvedValue(png);
    vi.mocked(put).mockRejectedValueOnce(new Error("blob down"));
    expect((await generateAiImageAction(input)).ok).toBe(false);
    expect([...usage.values()].some((v) => v > 0)).toBe(true);
  });
});
