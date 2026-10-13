import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/advideo/brief", () => ({ loadAdBrief: vi.fn() }));

import { loadAdBrief } from "@/lib/advideo/brief";
import { completeJson } from "@/lib/ai/provider";
import { ReviewFailed, reviewIdea, usesOnlyKnownNumbers } from "@/lib/ai/review-idea";

const brief = {
  name: "Moon Shine",
  tagline: "جوانی بێ سنوور",
  deliveryNote: "گەیاندن بۆ هەموو شارەکان",
  deliveryLine: null,
  primary: "#112233",
  accent: "#E0A526",
  logoUrl: null,
  handle: "@moonshine",
  phone: null,
  product: { id: "p1", name: "سێرۆمی ڤیتامین C", description: "30 مل", priceLine: "25٬000 دینار", photos: [], inStock: true },
  catalog: [{ name: "کرێم", priceLine: "10٬000 دینار" }],
  photos: [],
  refPhotos: 0,
  refIndices: [],
  clips: [],
};

const input = { tenantId: "t1", storeId: "s1", productId: "p1", idea: "ڤیدیۆیەک بۆ سێرۆمەکە", kind: "video" as const, lang: "ckb" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAdBrief).mockResolvedValue(brief as never);
  vi.mocked(completeJson).mockResolvedValue({ data: { text: "ڤیدیۆیەکی کورت بۆ سێرۆمی ڤیتامین C ی Moon Shine", summary: "ڕوونم کردەوە" }, model: "m" });
});

describe("reviewIdea", () => {
  it("gives Haiku the idea next to the brand's own data, counted against the workspace", async () => {
    const r = await reviewIdea(input);
    expect(r).toMatchObject({ kept: false, summary: "ڕوونم کردەوە" });
    const call = vi.mocked(completeJson).mock.calls[0][0];
    expect(call).toMatchObject({ tier: "haiku", meter: { scope: "t1" } });
    const sent = JSON.parse(call.user);
    expect(sent.owner_idea).toBe(input.idea);
    expect(sent.brand).toMatchObject({ name: "Moon Shine", tagline: "جوانی بێ سنوور", product: { name: "سێرۆمی ڤیتامین C" } });
  });

  it("fails with ReviewFailed when the AI does not answer, so the caller can stop before anything is spent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(completeJson).mockRejectedValue(new Error("this month's AI allowance is used up"));
    await expect(reviewIdea(input)).rejects.toBeInstanceOf(ReviewFailed);
  });

  it("throws away a video brief that brings in a number nobody wrote, and keeps the owner's words", async () => {
    vi.mocked(completeJson).mockResolvedValue({ data: { text: "ڤیدیۆیەک بۆ داشکاندنی ٥٠٪ لەسەر سێرۆمەکە", summary: "x" }, model: "m" });
    const r = await reviewIdea(input);
    expect(r).toEqual({ text: input.idea, summary: "", kept: true });
  });

  it("lets a video brief use numbers the shop already has, in any script", async () => {
    vi.mocked(completeJson).mockResolvedValue({ data: { text: "ڤیدیۆیەک بۆ سێرۆمی ٣٠ مل", summary: "x" }, model: "m" });
    const r = await reviewIdea(input);
    expect(r.kept).toBe(false);
  });

  it("does not check numbers in a picture prompt, which puts no words on the picture", async () => {
    vi.mocked(completeJson).mockResolvedValue({ data: { text: "A serum bottle on a marble table, 3 soft lights, shallow depth of field", summary: "x" }, model: "m" });
    const r = await reviewIdea({ ...input, kind: "image", shape: "square" });
    expect(r.kept).toBe(false);
  });

  it("still reviews when the brand cannot be loaded", async () => {
    vi.mocked(loadAdBrief).mockRejectedValue(new Error("db"));
    const r = await reviewIdea(input);
    expect(r.kept).toBe(false);
    expect(JSON.parse(vi.mocked(completeJson).mock.calls[0][0].user).brand).toBeNull();
  });
});

describe("usesOnlyKnownNumbers", () => {
  it("reads Arabic-Indic, Persian and ASCII digits as the same numbers", () => {
    expect(usesOnlyKnownNumbers("٣٠ و ۲۵", ["30 ml", "25"])).toBe(true);
    expect(usesOnlyKnownNumbers("٣١", ["30 ml"])).toBe(false);
    expect(usesOnlyKnownNumbers("no numbers", [])).toBe(true);
  });
});
