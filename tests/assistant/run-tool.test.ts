import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn() },
  newsFrame: { findUnique: vi.fn() },
  brandKit: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  currentWorkspace: vi.fn(async () => ws.current),
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: [{}], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({
    META_FACEBOOK: { connected: true, accountId: "fb1", name: "Page" },
    META_INSTAGRAM: { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  })),
}));
vi.mock("@/lib/i18n", async () => {
  const { en } = await import("@/lib/i18n/en");
  return { dict: () => en, getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/lib/ai/slots", () => ({ claimSlot: vi.fn(), refundSlot: vi.fn(), takeDaily: vi.fn(async () => 1) }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/app/app/actions", () => ({ publishAction: vi.fn(), saveWhatsAppAction: vi.fn() }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/newsroom/(desk)/news/actions", () => ({
  designSectionFrameAction: vi.fn(),
  saveDesignPromptAction: vi.fn(),
  saveSectionFrameTextAction: vi.fn(),
  removeSectionFrameAction: vi.fn(),
}));

import { takeDaily } from "@/lib/ai/slots";
import { publishAction, saveWhatsAppAction } from "@/app/app/actions";
import { archiveProductAction, saveProductAction, saveStoreSettingsAction } from "@/app/app/automation/actions";
import { generateAiImageAction } from "@/app/app/publish/ai-image-action";
import { schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "@/app/app/video/actions";
import { designSectionFrameAction, removeSectionFrameAction, saveDesignPromptAction, saveSectionFrameTextAction } from "@/app/newsroom/(desk)/news/actions";
import { runToolAction } from "@/app/app/assistant/actions";

const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/1.jpg";
const seen = new Set<string>();
let n = 0;
const nonce = () => `${(++n).toString(16).padStart(16, "0")}`;
const att = { id: "a1", url: OWN, pathname: "merchant/t1/chat/1.jpg", kind: "image" as const, name: "bag.jpg" };

beforeEach(() => {
  vi.clearAllMocks();
  ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
  vi.mocked(takeDaily).mockResolvedValue(1);
  db.store.findUnique.mockResolvedValue({ videoAutoHour: 21, videoAutoTier: "LITE" });
  db.store.findMany.mockResolvedValue([
    { id: "s1", name: "Shop one", igUsername: null, fbPageId: "other", igUserId: null },
    { id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null },
  ]);
  db.newsFrame.findUnique.mockResolvedValue(null);
  db.brandKit.findUnique.mockResolvedValue({ frameText: "top" });
  db.product.findMany.mockResolvedValue([
    { id: "p1", name: "Gold ring", storeId: "s1" },
    { id: "p2", name: "Silver ring", storeId: "s2" },
  ]);
});

describe("runToolAction", () => {
  it("runs one card once: the same nonce again does nothing, and another workspace's screen is refused", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    const same = nonce();
    // The first claim of a nonce passes; its second does not (the counter says one is the most).
    vi.mocked(takeDaily).mockImplementation(async (_w, metric) => (String(metric).startsWith("chatrun_") && seen.has(String(metric)) ? 0 : (seen.add(String(metric)), 1)));
    const first = await runToolAction({ workspaceId: "t1", nonce: same, tool: "set_auto_replies", args: { on: true } });
    const again = await runToolAction({ workspaceId: "t1", nonce: same, tool: "set_auto_replies", args: { on: true } });
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).toHaveBeenCalledTimes(1);
    expect(await runToolAction({ workspaceId: "t2", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: "not-a-nonce", tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
  });

  it("runs a post through the app's own publish action, with the shop's own picture, for a connected platform", async () => {
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true }] });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "Hello", targets: ["FB"], media: "a1", product: "silver ring" }, attachments: [att] });
    expect(r.ok).toBe(true);
    expect(vi.mocked(publishAction).mock.calls[0][0]).toEqual({
      caption: "Hello",
      targets: ["FB"],
      media: { url: OWN, pathname: att.pathname, type: "IMAGE" },
      productId: "p2",
    });
  });

  it("refuses a platform that is not connected, without publishing", async () => {
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["IG"], media: "a1" }, attachments: [att] });
    expect(r).toMatchObject({ ok: false });
    expect(publishAction).not.toHaveBeenCalled();
  });

  it("does not trust an attachment address from the screen: only this workspace's own uploads count", async () => {
    const foreign = { ...att, url: "https://abc.public.blob.vercel-storage.com/merchant/t2/chat/1.jpg", pathname: "merchant/t2/chat/1.jpg" };
    const evil = { ...att, id: "a2", url: "https://evil.example/x.jpg", pathname: "merchant/t1/chat/x.jpg" };
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["FB"], media: "a1" }, attachments: [foreign, evil] });
    expect(r).toMatchObject({ ok: false });
    expect(publishAction).not.toHaveBeenCalled();
  });

  it("refuses a tool that is not on the list and arguments that do not fit", async () => {
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_plan", args: { plan: "MAX" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_autopilot", args: { mode: "ALWAYS" } })).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).not.toHaveBeenCalled();
  });

  it("stops when the day's actions are used up, and when the product is not found exactly", async () => {
    vi.mocked(takeDaily).mockResolvedValueOnce(0);
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", product: "ring" } })).toMatchObject({ ok: false });
    expect(createVideoAction).not.toHaveBeenCalled();
  });

  it("turns the automatic replies, the autopilot and the daily video on through the app's own actions, for the connected shop", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } });
    expect(saveStoreSettingsAction).toHaveBeenCalledWith("s2", { automationEnabled: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_autopilot", args: { mode: "PUBLISH", perDay: 2 } });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { autoMode: "PUBLISH", autoPerDay: 2 });
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "DRAFT", hour: 20 } });
    expect(saveVideoAutoAction).toHaveBeenCalledWith("s2", { mode: "DRAFT", tier: "LITE", hour: 20 });
    // No hour on the card: the one already chosen stays.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "PUBLISH" } });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "PUBLISH", tier: "LITE", hour: 21 });
  });

  it("makes a picture with the reviewed idea and the attached references, and a video through the video action", async () => {
    vi.mocked(generateAiImageAction).mockResolvedValue({ ok: true, media: { url: OWN, pathname: att.pathname, type: "IMAGE" }, prompt: "p", reviewed: true, summary: "" });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "ring on marble", references: ["a1"], shape: "portrait" }, attachments: [att] });
    expect(r).toMatchObject({ ok: true, media: { url: OWN, kind: "image" } });
    expect(vi.mocked(generateAiImageAction).mock.calls[0][0]).toMatchObject({ idea: "ring on marble", refUrls: [OWN], shape: "portrait", review: true });
    // The owner's switch is passed on: off means the words go through as typed.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "ring on marble" }, review: false });
    expect(vi.mocked(generateAiImageAction).mock.calls[1][0]).toMatchObject({ review: false });
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad" } })).toMatchObject({ ok: true, jobId: "job1" });
    expect(vi.mocked(createVideoAction).mock.calls[0][1]).toMatchObject({ topic: "a short ad", review: true, publish: false });
  });

  it("changes only the shop options that were given, adds a product with the attached photo, hides one by its exact name, and saves the number", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_shop_options", args: { likeComments: true, expiryDays: 14 } });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { likeComments: true, expiryDays: 14 });
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p9" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "add_product", args: { name: "Ring", price: "25000", photos: ["a1"] }, attachments: [att] });
    expect(vi.mocked(saveProductAction).mock.calls[0]).toEqual([
      "s2",
      null,
      { name: "Ring", description: "", photos: [OWN], variants: [{ label: "", price: "25000", currency: "IQD", inStock: true }] },
    ]);
    vi.mocked(archiveProductAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "archive_product", args: { product: "silver ring" } })).toMatchObject({ ok: true });
    expect(archiveProductAction).toHaveBeenCalledWith("s2", "p2");
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "archive_product", args: { product: "ring" } })).toMatchObject({ ok: false });
    vi.mocked(saveWhatsAppAction).mockResolvedValue({ ok: true, digits: "9647701234567" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_whatsapp_number", args: { number: "07701234567" } })).toMatchObject({ ok: true });
    expect(saveWhatsAppAction).toHaveBeenCalledWith("07701234567");
  });

  it("schedules through the schedule action with the Baghdad time as given", async () => {
    vi.mocked(schedulePublishAction).mockResolvedValue({ ok: true, id: "x", runAt: "2026-10-20T16:30:00.000Z" });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "schedule_post", args: { caption: "Later", targets: ["FB"], when: "2026-10-20T19:30" } });
    expect(r.ok).toBe(true);
    expect(vi.mocked(schedulePublishAction).mock.calls[0][1]).toBe("2026-10-20T19:30");
  });

  it("is for people who can configure the shop, in a shop, signed in", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    ws.current = null;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).not.toHaveBeenCalled();
  });
});

describe("runToolAction in a news desk", () => {
  beforeEach(() => {
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
  });

  it("designs a section's frame through the desk's own action, with the attached picture as the reference", async () => {
    vi.mocked(designSectionFrameAction).mockResolvedValue({ ok: true, framePath: "merchant/t1/frame-sports-1.png" });
    const r = await runToolAction({
      workspaceId: "t1",
      nonce: nonce(),
      tool: "design_section_frame",
      args: { section: "sports", note: "green", reference: "a1" },
      attachments: [att],
    });
    expect(r.ok).toBe(true);
    expect(designSectionFrameAction).toHaveBeenCalledWith({ section: "sports", referencePath: att.pathname, note: "green", frameText: "top" });
  });

  it("keeps the headline place a section's frame already has", async () => {
    db.newsFrame.findUnique.mockResolvedValue({ frameText: "middle" });
    vi.mocked(designSectionFrameAction).mockResolvedValue({ ok: true, framePath: "merchant/t1/f.png" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "economy" } });
    expect(vi.mocked(designSectionFrameAction).mock.calls[0][0]).toMatchObject({ section: "economy", referencePath: null, frameText: "middle" });
  });

  it("takes only a picture the desk attached as a reference", async () => {
    // not attached at all: the card is not even a proposal
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "sports", reference: "a1" } })).toMatchObject({ ok: false });
    // a video is not a reference
    const video = { ...att, kind: "video" as const, pathname: "merchant/t1/chat/1.mp4", url: OWN.replace(".jpg", ".mp4") };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "sports", reference: "a1" }, attachments: [video] })).toMatchObject({ ok: false });
    expect(designSectionFrameAction).not.toHaveBeenCalled();
  });

  it("knows only the sections of the news, and none of the shop's tools", async () => {
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "../../x" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "a ring" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["FB"] } })).toMatchObject({ ok: false });
    expect(designSectionFrameAction).not.toHaveBeenCalled();
  });

  it("saves the desk's words, moves a headline only on a frame the section has, and removes a frame", async () => {
    vi.mocked(saveDesignPromptAction).mockResolvedValue({ ok: true, designPrompt: "deep blue" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_design_prompt", args: { text: "deep blue" } })).toMatchObject({ ok: true });
    expect(saveDesignPromptAction).toHaveBeenCalledWith("deep blue");

    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_frame_text", args: { section: "sports", position: "top" } })).toMatchObject({ ok: false });
    expect(saveSectionFrameTextAction).not.toHaveBeenCalled();
    db.newsFrame.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(saveSectionFrameTextAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_frame_text", args: { section: "sports", position: "top" } })).toMatchObject({ ok: true });
    expect(saveSectionFrameTextAction).toHaveBeenCalledWith("sports", "top");

    vi.mocked(removeSectionFrameAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "breaking" } })).toMatchObject({ ok: true });
    expect(removeSectionFrameAction).toHaveBeenCalledWith("breaking");
  });

  it("is for people who can configure, and a shop cannot run the desk's tools", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "NEWS" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "sports" } })).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "sports" } })).toMatchObject({ ok: false });
    expect(removeSectionFrameAction).not.toHaveBeenCalled();
  });
});
