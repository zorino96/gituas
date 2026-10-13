import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn() },
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
vi.mock("@/app/app/actions", () => ({ publishAction: vi.fn() }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));

import { takeDaily } from "@/lib/ai/slots";
import { publishAction } from "@/app/app/actions";
import { saveStoreSettingsAction } from "@/app/app/automation/actions";
import { generateAiImageAction } from "@/app/app/publish/ai-image-action";
import { schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "@/app/app/video/actions";
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
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad" } })).toMatchObject({ ok: true, jobId: "job1" });
    expect(vi.mocked(createVideoAction).mock.calls[0][1]).toMatchObject({ topic: "a short ad", review: true, publish: false });
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
