import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const h = vi.hoisted(() => ({
  createImage: vi.fn(),
  put: vi.fn(),
  claimSlot: vi.fn(),
  refundSlot: vi.fn(),
  designFrame: vi.fn(),
  storeFrame: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  settingsFind: vi.fn(),
  kitFind: vi.fn(),
  settingsUpsert: vi.fn(),
  workspace: { id: "t1", kind: "NEWS", role: "OWNER" } as { id: string; kind: string; role: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    newsFrame: { upsert: h.upsert, deleteMany: h.deleteMany, updateMany: h.updateMany },
    newsSettings: { findUnique: h.settingsFind, upsert: h.settingsUpsert },
    brandKit: { findUnique: h.kitFind },
  },
}));
vi.mock("@/app/app/data", () => ({ currentWorkspace: async () => h.workspace, loadAccountLists: vi.fn(), loadConnections: vi.fn() }));
vi.mock("@/lib/i18n", async (orig) => {
  const real = await orig<typeof import("@/lib/i18n")>();
  return { ...real, getLang: async () => "en" };
});
vi.mock("@/lib/billing/limits", async (orig) => {
  const real = await orig<typeof import("@/lib/billing/limits")>();
  return { ...real, newsroomFrozenError: async () => null };
});
vi.mock("@/lib/ai/slots", () => ({ claimSlot: h.claimSlot, refundSlot: h.refundSlot }));
vi.mock("@/lib/ai/image", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/image")>();
  return { ...real, createImage: h.createImage, imageEnabled: () => true };
});
vi.mock("@vercel/blob", () => ({ head: vi.fn(), put: h.put, del: vi.fn() }));

import { brandWithFrame, categoryOfStory, frameFor, FRAME_SECTIONS, isFrameSection } from "@/lib/news/frames-shared";
import { designFrame as realDesignFrame, FrameDesignError, framePrompt, keyOutMagenta } from "@/lib/news/frame-design";
import { brandFrom } from "@/lib/cards/brand";

const frames = [
  { section: "economy", framePath: "merchant/t1/frame-economy-1.png", frameText: "top" },
  { section: "breaking", framePath: "merchant/t1/frame-breaking-1.png", frameText: "middle" },
];

describe("frames by section", () => {
  it("offers breaking news and every option of the source filter", () => {
    expect(FRAME_SECTIONS[0]).toBe("breaking");
    for (const s of ["politics", "economy", "sports", "security", "health", "tech", "society", "culture", "other"]) expect(isFrameSection(s)).toBe(true);
    expect(isFrameSection("nope")).toBe(false);
    expect(isFrameSection(null)).toBe(false);
  });

  it("maps a draft's Sorani label back to the taxonomy", () => {
    expect(categoryOfStory("sports", "ئابووری")).toBe("sports");
    expect(categoryOfStory(null, "ئابووری")).toBe("economy");
    expect(categoryOfStory("weird", "نەناسراو")).toBeNull();
  });

  it("uses the breaking frame for breaking cards, then the section's own, else the main frame", () => {
    expect(frameFor(frames, "BREAKING", "economy")?.section).toBe("breaking");
    expect(frameFor(frames, "STANDARD", "economy")?.section).toBe("economy");
    expect(frameFor(frames, "STANDARD", "sports")).toBeNull();
    expect(frameFor(frames, "BREAKING", "sports")?.section).toBe("breaking");
    expect(frameFor([frames[0]], "BREAKING", "sports")).toBeNull();
    expect(frameFor(frames, "STANDARD", null)).toBeNull();
  });

  it("swaps only the frame of the brand", () => {
    const base = brandFrom({ logoPath: "merchant/t1/logo.png", primary: "#111111", accent: "#222222", text: "#ffffff", headingFont: "sans", framePath: "merchant/t1/main.png", frameText: "bottom" }, "Page");
    const own = brandWithFrame(base, frames, "STANDARD", "economy");
    expect(own.frameSrc).toBe("/m/merchant/t1/frame-economy-1.png");
    expect(own.frameText).toBe("top");
    expect(own.primary).toBe("#111111");
    expect(own.logoSrc).toBe(base.logoSrc);
    expect(brandWithFrame(base, frames, "STANDARD", "sports")).toBe(base);
  });
});

describe("designing a frame", () => {
  it("asks for a magenta photo area, no text, and passes the desk's own words as data", () => {
    const p = framePrompt({ section: "sports", frameText: "bottom", designPrompt: "deep blue", note: "green", hasMain: true, hasReference: true });
    expect(p).toMatch(/#FF00FF/);
    expect(p).toMatch(/NO text/);
    expect(p).toContain('"deep blue"');
    expect(p).toContain('"green"');
    expect(p).toMatch(/first reference image is the agency's MAIN frame/);
    expect(framePrompt({ section: "x", frameText: "top", designPrompt: "", note: "", hasMain: false, hasReference: false })).not.toMatch(/reference image/);
    expect(framePrompt({ section: "x", frameText: "top", designPrompt: "y".repeat(5000), note: "", hasMain: false, hasReference: false }).length).toBeLessThanOrEqual(3000);
  });

  it("keys the magenta out and reports how much it cleared", () => {
    const px = Buffer.from([255, 0, 255, 255, 10, 20, 90, 255, 250, 5, 250, 255, 200, 200, 200, 255]);
    const share = keyOutMagenta(px);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(255);
    expect(px[11]).toBe(0);
    expect(px[15]).toBe(255);
    expect(share).toBeCloseTo(0.5, 1);
  });

  async function frameWithWindow(window: boolean): Promise<Buffer> {
    const navy = { r: 10, g: 30, b: 80 };
    const base = sharp({ create: { width: 1024, height: 1536, channels: 3, background: window ? { r: 255, g: 0, b: 255 } : navy } });
    if (!window) return base.png().toBuffer();
    // The model's picture is 1536 tall and is cropped 135 px (of 1620) top and bottom: this covers the bottom band.
    const band = await sharp({ create: { width: 1024, height: 700, channels: 3, background: navy } }).png().toBuffer();
    return base.composite([{ input: band, top: 836, left: 0 }]).png().toBuffer();
  }

  it("makes a 1080x1350 frame with a transparent photo area", async () => {
    h.createImage.mockResolvedValueOnce(await frameWithWindow(true));
    const onSent = vi.fn();
    const png = await realDesignFrame({ section: "economy", frameText: "bottom", designPrompt: "", note: "", mainFramePath: null, referencePath: null, logoPath: null, onSent });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1350]);
    expect(data[(300 * 1080 + 500) * 4 + 3]).toBe(0);
    expect(data[(1250 * 1080 + 500) * 4 + 3]).toBe(255);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("describes the headline band where it ends up on the card, after the model's picture is cropped", () => {
    // bottom band: 64%..93% of the card is 66.7%..99.7% of the 1620 px picture, less 135 px of crop at both ends
    const p = framePrompt({ section: "x", frameText: "bottom", designPrompt: "", note: "", hasMain: false, hasReference: false });
    const m = /between (\d+)% and (\d+)%/.exec(p)!;
    expect(Number(m[1])).toBe(Math.round(((0.64 * 1350 + 135) / 1620) * 100));
    expect(Number(m[2])).toBe(Math.round(((0.93 * 1350 + 135) / 1620) * 100));
    expect(p).toMatch(/no magenta, hot pink or purple/i);
  });

  it("does not offer a frame that is all window, or whose headline band is a hole", async () => {
    const all = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer();
    h.createImage.mockResolvedValueOnce(all);
    await expect(realDesignFrame({ section: "e", frameText: "bottom", designPrompt: "", note: "", mainFramePath: null, referencePath: null, logoPath: null })).rejects.toMatchObject({ kind: "noWindow" });
    // a window with the band left open
    const top = await sharp({ create: { width: 1024, height: 300, channels: 3, background: { r: 10, g: 30, b: 80 } } }).png().toBuffer();
    h.createImage.mockResolvedValueOnce(await sharp(all).composite([{ input: top, top: 0, left: 0 }]).png().toBuffer());
    await expect(realDesignFrame({ section: "e", frameText: "bottom", designPrompt: "", note: "", mainFramePath: null, referencePath: null, logoPath: null })).rejects.toMatchObject({ kind: "noWindow" });
  });

  it("does not offer a frame that leaves no photo area", async () => {
    h.createImage.mockResolvedValueOnce(await frameWithWindow(false));
    await expect(realDesignFrame({ section: "economy", frameText: "bottom", designPrompt: "", note: "", mainFramePath: null, referencePath: null, logoPath: null })).rejects.toMatchObject({ kind: "noWindow" });
  });
});

describe("the desk's frame actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.workspace = { id: "t1", kind: "NEWS", role: "OWNER" };
    h.claimSlot.mockResolvedValue({ ok: true, month: 1, day: 1 });
    h.kitFind.mockResolvedValue({ logoPath: null, framePath: "merchant/t1/main.png" });
    h.settingsFind.mockResolvedValue({ designPrompt: "calm" });
    h.upsert.mockResolvedValue({});
    h.refundSlot.mockResolvedValue(undefined);
  });

  async function actions() {
    vi.doMock("@/lib/news/frame-design", async (orig) => {
      const real = await orig<typeof import("@/lib/news/frame-design")>();
      return { ...real, designFrame: h.designFrame, storeFrame: h.storeFrame };
    });
    vi.resetModules();
    return import("@/app/newsroom/(desk)/news/actions");
  }

  it("saves a section frame only from the desk's own PNG and a known section", async () => {
    const a = await actions();
    expect((await a.saveSectionFrameAction({ section: "sports", framePath: "merchant/t2/x.png" })).ok).toBe(false);
    expect((await a.saveSectionFrameAction({ section: "sports", framePath: "merchant/t1/x.jpg" })).ok).toBe(false);
    expect((await a.saveSectionFrameAction({ section: "nope", framePath: "merchant/t1/x.png" })).ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
    expect((await a.saveSectionFrameAction({ section: "sports", framePath: "merchant/t1/x.png", frameText: "top" })).ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: "t1", section: "sports", frameText: "top" }) }));
  });

  it("is for desk members who may configure, and not for other kinds of workspace", async () => {
    const a = await actions();
    h.workspace = { id: "t1", kind: "SHOP", role: "OWNER" };
    expect((await a.removeSectionFrameAction("sports")).ok).toBe(false);
    h.workspace = { id: "t1", kind: "NEWS", role: "VIEWER" };
    expect((await a.removeSectionFrameAction("sports")).ok).toBe(false);
    expect(h.deleteMany).not.toHaveBeenCalled();
  });

  it("designs a frame from the desk's main frame and words, and stores it for the section", async () => {
    const a = await actions();
    h.designFrame.mockResolvedValueOnce(Buffer.from("png"));
    h.storeFrame.mockResolvedValueOnce("merchant/t1/frame-sports-9.png");
    const r = await a.designSectionFrameAction({ section: "sports", referencePath: "merchant/t1/ref.png", note: "green" });
    expect(r).toEqual({ ok: true, framePath: "merchant/t1/frame-sports-9.png" });
    expect(h.designFrame).toHaveBeenCalledWith(expect.objectContaining({ section: "sports", designPrompt: "calm", note: "green", mainFramePath: "merchant/t1/main.png", referencePath: "merchant/t1/ref.png" }));
    expect(h.refundSlot).not.toHaveBeenCalled();
  });

  it("refuses a reference from another desk before anything is spent", async () => {
    const a = await actions();
    const r = await a.designSectionFrameAction({ section: "sports", referencePath: "merchant/t2/ref.png" });
    expect(r.ok).toBe(false);
    expect(h.claimSlot).not.toHaveBeenCalled();
    expect(h.designFrame).not.toHaveBeenCalled();
  });

  it("stops at the day's allowance", async () => {
    const a = await actions();
    h.claimSlot.mockResolvedValueOnce({ ok: false });
    const r = await a.designSectionFrameAction({ section: "sports" });
    expect(r.ok).toBe(false);
    expect(h.designFrame).not.toHaveBeenCalled();
  });

  it("gives the place back when the request never left or was refused, and keeps it when it may have been billed", async () => {
    const a = await actions();
    const FDE = (await import("@/lib/news/frame-design")).FrameDesignError;
    h.designFrame.mockRejectedValueOnce(new FDE("refs"));
    expect((await a.designSectionFrameAction({ section: "sports" })).ok).toBe(false);
    expect(h.refundSlot).toHaveBeenCalledTimes(1);

    h.refundSlot.mockClear();
    h.designFrame.mockRejectedValueOnce(new FDE("refused"));
    await a.designSectionFrameAction({ section: "sports" });
    expect(h.refundSlot).toHaveBeenCalledTimes(1);

    h.refundSlot.mockClear();
    h.designFrame.mockImplementationOnce(async (input: { onSent?: () => void }) => {
      input.onSent?.();
      throw new FDE("noWindow");
    });
    const r = await a.designSectionFrameAction({ section: "sports" });
    expect(r.ok).toBe(false);
    expect(h.refundSlot).not.toHaveBeenCalled();
  });

  it("keeps the desk's words short and clean", async () => {
    const a = await actions();
    h.settingsUpsert.mockResolvedValue({});
    const r = await a.saveDesignPromptAction(`  blue\u0000 ${"x".repeat(3000)}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.designPrompt.length).toBe(1200);
      expect(r.designPrompt).not.toContain("\u0000");
    }
  });
});

describe("FrameDesignError", () => {
  it("carries its kind", () => {
    expect(new FrameDesignError("busy").kind).toBe("busy");
  });
});
