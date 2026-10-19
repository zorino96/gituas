import { beforeEach, describe, expect, it, vi } from "vitest";

const shop = vi.hoisted(() => ({
  fb: { connected: true, accountId: "fb1", name: "Page" } as { connected: boolean; accountId?: string; name?: string },
  ig: { connected: false } as { connected: boolean; accountId?: string; name?: string },
  fbPages: 1,
  comments: [] as unknown[],
  conversations: [] as unknown[],
}));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn() },
  order: { findFirst: vi.fn() },
  scheduledPost: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: Array.from({ length: shop.fbPages }, () => ({})), META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({ META_FACEBOOK: shop.fb, META_INSTAGRAM: shop.ig, TIKTOK: { connected: false }, YOUTUBE: { connected: false } })),
  loadPosts: vi.fn(async () => ({ posts: [{ platform: "FB", id: "post1", caption: "", commentCount: 1, comments: shop.comments }], errors: [] })),
  loadConversations: vi.fn(async () => ({ conversations: shop.conversations, unreadable: 0, errors: [] })),
}));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (lang: string) => (lang === "ar" ? ar : lang === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/app/app/actions", () => ({
  publishAction: vi.fn(),
  saveWhatsAppAction: vi.fn(),
  replyToCommentAction: vi.fn(),
  setCommentHiddenAction: vi.fn(),
  sendMessageAction: vi.fn(),
}));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn(), cancelScheduledAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/app/orders/actions", () => ({ setOrderStatusAction: vi.fn() }));

import { publishAction, replyToCommentAction, saveWhatsAppAction, sendMessageAction, setCommentHiddenAction } from "@/app/app/actions";
import { archiveProductAction, saveProductAction, saveStoreSettingsAction } from "@/app/app/automation/actions";
import { loadAccountLists, loadConnections, loadConversations, loadPosts } from "@/app/app/data";
import { setOrderStatusAction } from "@/app/app/orders/actions";
import { generateAiImageAction } from "@/app/app/publish/ai-image-action";
import { cancelScheduledAction, schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "@/app/app/video/actions";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import { decide } from "@/lib/chat/guard";
import { riskOf, toolSpecs, toolsFor } from "@/lib/chat/registry";
import { WRITE_TOOLS } from "@/lib/chat/tools/writes";
import { CARD, LABEL, NEW } from "@/lib/chat/tools/writes-words";
import { ToolRefusal, type Card, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";

const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/1.jpg";
const OWN_PNG = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/2.png";
const img = { id: "a1", url: OWN, pathname: "merchant/t1/chat/1.jpg", kind: "image" as const, name: "bag.jpg" };
const png = { id: "a2", url: OWN_PNG, pathname: "merchant/t1/chat/2.png", kind: "image" as const, name: "bag.png" };
const vid = { id: "a3", url: OWN.replace(".jpg", ".mp4"), pathname: "merchant/t1/chat/3.mp4", kind: "video" as const, name: "ad.mp4" };

const ctxOf = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [img, png, vid],
  review: true,
  deadline: Date.now() + 60_000,
  ...over,
});

const tool = (name: string): WriteTool => {
  const t = WRITE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
/** What the loop does: parse with the tool's own schema, then ask for the card. */
const parse = (name: string, args: unknown) => tool(name).schema.parse(args);
const cardOf = (name: string, args: unknown, ctx = ctxOf()): Promise<Card> => tool(name).card(ctx, parse(name, args));
const run = (name: string, args: unknown, ctx = ctxOf()) => tool(name).execute(ctx, parse(name, args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};

const aComment = (over: Record<string, unknown> = {}) => ({ platform: "FB", id: "c1", postId: "post1", author: "Ali", text: "How much is it?", hidden: false, fromUs: false, replies: [], ...over });
const aConversation = (over: Record<string, unknown> = {}) => ({
  platform: "FB",
  id: "conv1",
  participantId: "psid1",
  participantName: "Dana",
  withinWindow: true,
  messages: [{ id: "m1", text: "Is the ring in stock?", fromUs: false }],
  ...over,
});
const photoProduct = (over: Record<string, unknown> = {}) => ({
  id: "p2",
  name: "Silver ring",
  description: "Pure silver",
  photos: [OWN],
  variants: [{ label: "", amountMinor: 25000, currency: "IQD", inStock: true }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  shop.fb = { connected: true, accountId: "fb1", name: "Page" };
  shop.ig = { connected: false };
  shop.fbPages = 1;
  shop.comments = [aComment()];
  shop.conversations = [aConversation()];
  vi.mocked(imageEnabled).mockReturnValue(true);
  vi.mocked(adVideoEnabled).mockReturnValue(true);
  db.store.findMany.mockResolvedValue([
    { id: "s1", name: "Shop one", igUsername: null, fbPageId: "other", igUserId: null },
    { id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null },
  ]);
  db.store.findUnique.mockResolvedValue({ videoAutoHour: 21, videoAutoTier: "LITE" });
  db.product.findMany.mockResolvedValue([
    { id: "p1", name: "Gold ring", storeId: "s1" },
    { id: "p2", name: "Silver ring", storeId: "s2" },
  ]);
  db.product.findFirst.mockResolvedValue(photoProduct());
  db.order.findFirst.mockResolvedValue({ customerName: "Dana", productName: "Silver ring", status: "NEW", amountMinor: 25000, currency: "IQD" });
  db.scheduledPost.findFirst.mockResolvedValue({ runAt: new Date("2026-10-20T16:30:00Z"), input: { caption: "Weekend offer", targets: ["FB", "IG"] } });
});

const EXPECTED = [
  "make_picture",
  "make_video",
  "post_now",
  "schedule_post",
  "set_auto_replies",
  "set_autopilot",
  "set_daily_video",
  "set_shop_options",
  "add_product",
  "archive_product",
  "set_whatsapp_number",
  "set_order_status",
  "hide_comment",
  "reply_to_comment",
  "send_message",
  "cancel_scheduled_post",
  "update_product",
];

describe("the write tool list", () => {
  it("has the eleven older tools and the six new ones, once each, for shops only", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toEqual(EXPECTED);
    expect(new Set(WRITE_TOOLS.map((t) => t.name)).size).toBe(EXPECTED.length);
    for (const t of WRITE_TOOLS) expect(t.kinds).toEqual(["shop"]);
  });

  it("has no tool for payments, plans, connecting accounts, deleting data, tokens or passwords", () => {
    const risky = /pay|plan|billing|checkout|connect|disconnect|delete|remove|purge|token|secret|password|credential|api_?key/i;
    for (const t of WRITE_TOOLS) {
      expect(t.name, t.name).not.toMatch(risky);
      const props = Object.keys((toolSpecs([t])[0].function.parameters as { properties?: Record<string, unknown> }).properties ?? {});
      for (const p of props) expect(p, `${t.name}.${p}`).not.toMatch(risky);
    }
  });

  it("describes every tool for the model as an object schema with a real description", () => {
    for (const spec of toolSpecs(WRITE_TOOLS)) {
      expect((spec.function.parameters as { type: string }).type).toBe("object");
      expect(spec.function.description.length).toBeGreaterThan(40);
    }
  });

  it("offers the write tools to an owner and an admin, and none to a member", () => {
    expect(toolsFor(WRITE_TOOLS, "shop", "OWNER")).toHaveLength(EXPECTED.length);
    expect(toolsFor(WRITE_TOOLS, "shop", "ADMIN")).toHaveLength(EXPECTED.length);
    expect(toolsFor(WRITE_TOOLS, "shop", "MEMBER")).toHaveLength(0);
    expect(toolsFor(WRITE_TOOLS, "news", "OWNER")).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("follow the screens the actions belong to", () => {
    const want: Record<string, string> = {
      make_picture: "publish",
      make_video: "publish",
      post_now: "publish",
      schedule_post: "publish",
      cancel_scheduled_post: "publish",
      set_auto_replies: "configure",
      set_autopilot: "configure",
      set_daily_video: "configure",
      set_shop_options: "configure",
      add_product: "configure",
      archive_product: "configure",
      update_product: "configure",
      set_whatsapp_number: "configure",
      reply_to_comment: "engage",
      send_message: "engage",
      hide_comment: "engage",
      set_order_status: "engage",
    };
    for (const t of WRITE_TOOLS) expect(t.permission, t.name).toBe(want[t.name]);
  });
});

describe("risk", () => {
  it("is fixed for the tools that do not depend on their arguments", () => {
    const fixed: Record<string, string> = {
      make_picture: "money",
      make_video: "money",
      post_now: "public",
      schedule_post: "public",
      add_product: "public",
      // A removal nobody can undo from the app: it always waits for Confirm (see decide() in guard.ts).
      archive_product: "destructive",
      set_whatsapp_number: "standing",
      set_order_status: "low",
      hide_comment: "low",
      reply_to_comment: "outbound",
      send_message: "outbound",
      cancel_scheduled_post: "low",
      update_product: "public",
    };
    for (const [name, risk] of Object.entries(fixed)) {
      expect(tool(name).risk, name).toBe(risk);
      expect(tool(name).riskFor, name).toBeUndefined();
    }
    expect(tool("make_picture").long).toBe(true);
    expect(tool("make_video").long).toBeFalsy();
  });

  it("is standing for automatic replies that are switched on, and low when they are switched off", () => {
    const t = tool("set_auto_replies");
    expect(riskOf(t, { on: true })).toBe("standing");
    expect(riskOf(t, { on: false })).toBe("low");
  });

  it("is standing for an autopilot that publishes by itself, low otherwise", () => {
    expect(riskOf(tool("set_autopilot"), { mode: "PUBLISH" })).toBe("standing");
    expect(riskOf(tool("set_autopilot"), { mode: "DRAFT" })).toBe("low");
    expect(riskOf(tool("set_autopilot"), { mode: "OFF" })).toBe("low");
  });

  it("is standing for a daily video whenever it is on (a draft video still uses the month's videos every day), low only when it is off", () => {
    expect(riskOf(tool("set_daily_video"), { mode: "PUBLISH" })).toBe("standing");
    expect(riskOf(tool("set_daily_video"), { mode: "DRAFT" })).toBe("standing");
    expect(riskOf(tool("set_daily_video"), { mode: "DRAFT", hour: 20 })).toBe("standing");
    expect(riskOf(tool("set_daily_video"), { mode: "OFF" })).toBe("low");
  });

  it("is standing when a switch that acts by itself goes on, public when a text or a delivery term is set or cleared, else low", () => {
    const t = tool("set_shop_options");
    for (const args of [{ aiReplies: true }, { autoHideSpam: true }, { likeComments: true }, { aiReplies: true, defaultDm: "Hello" }, { likeComments: true, deliveryFee: "" }]) {
      expect(riskOf(t, args), JSON.stringify(args)).toBe("standing");
    }
    for (const args of [{ defaultDm: "Hello" }, { aiBrief: "We sell rings" }, { deliveryFee: "5000" }, { deliveryTime: "2 days" }, { aiReplies: false, defaultDm: "Hi" }, { likeComments: false, aiBrief: "" }]) {
      expect(riskOf(t, args), JSON.stringify(args)).toBe("public");
    }
    // A text that is cleared is as public as one that is set.
    for (const args of [{ defaultDm: "" }, { aiBrief: "" }, { deliveryFee: "" }, { deliveryTime: "" }]) expect(riskOf(t, args), JSON.stringify(args)).toBe("public");
    // Switching off, and the number of days, are small.
    for (const args of [{ aiReplies: false }, { autoHideSpam: false }, { likeComments: false }, { expiryDays: 14 }, { likeComments: false, expiryDays: 30 }]) {
      expect(riskOf(t, args), JSON.stringify(args)).toBe("low");
    }
  });

  it("makes the hiding of a product wait for Confirm at every autonomy level, and a cancelled post stay a small change", () => {
    expect(riskOf(tool("archive_product"), { product: "p2" })).toBe("destructive");
    expect(riskOf(tool("cancel_scheduled_post"), { post: "sp1" })).toBe("low");
    for (const autonomy of ["ASK", "LOW", "ALL"] as const) {
      expect(decide({ risk: riskOf(tool("archive_product"), { product: "p2" }), autonomy, tainted: false }), autonomy).toBe("confirm");
    }
  });
});

describe("text fields", () => {
  it("name the arguments that buyers or the public will read", () => {
    const want: Record<string, string[] | undefined> = {
      make_picture: ["idea"],
      make_video: ["idea"],
      post_now: ["caption"],
      schedule_post: ["caption"],
      set_shop_options: ["defaultDm", "aiBrief", "deliveryTime"],
      add_product: ["name", "description"],
      update_product: ["name", "description"],
      reply_to_comment: ["text"],
      send_message: ["text"],
    };
    for (const t of WRITE_TOOLS) {
      expect(t.textFields === undefined ? undefined : [...t.textFields], t.name).toEqual(want[t.name]);
      // Every text field must be an argument the schema has.
      const props = Object.keys((toolSpecs([t])[0].function.parameters as { properties: Record<string, unknown> }).properties);
      for (const f of t.textFields ?? []) expect(props, `${t.name}.${f}`).toContain(f);
    }
  });
});

describe("the older tools' cards", () => {
  it("show the app's own title and values, and the shop the product belongs to", async () => {
    const c = await cardOf("post_now", { caption: "New rings", targets: ["FB"], media: "a1", product: "silver ring" });
    expect(c.title).toBe("Post now");
    expect(c.lines).toEqual(
      expect.arrayContaining([
        { label: "Where", value: "Facebook" },
        { label: "Caption", value: "New rings" },
        { label: "Picture or video", value: "bag.jpg" },
        { label: "Product", value: "Silver ring" },
        { label: "Shop", value: "Shop two" },
      ]),
    );
  });

  it("speak the person's language", async () => {
    const c = await cardOf("set_auto_replies", { on: true }, ctxOf({ lang: "ckb" }));
    expect(c.title).toBe("وەڵامی خۆکار");
    expect(c.lines[0]).toEqual({ label: "چالاک", value: "بەڵێ" });
  });

  it("refuse when there is no shop yet, and when the product is not found exactly", async () => {
    db.store.findMany.mockResolvedValue([]);
    expect(await refusal(cardOf("set_auto_replies", { on: true }))).toMatch(/no shop/i);
    db.store.findMany.mockResolvedValue([{ id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null }]);
    expect(await refusal(cardOf("archive_product", { product: "ring" }))).toMatch(/list_products/);
    expect(await refusal(cardOf("make_video", { idea: "a short ad", product: "nothing" }))).toMatch(/No single product/);
  });

  it("take a product by its id as well as by its name, and show the name it resolved to", async () => {
    const byId = await cardOf("archive_product", { product: "p2" });
    expect(byId.lines).toEqual([
      { label: "Product", value: "Silver ring" },
      { label: "Shop", value: "Shop two" },
      { label: "Note", value: CARD.archiveNote.en },
    ]);
    const byPart = await cardOf("make_video", { idea: "a short ad", product: "silver" });
    expect(byPart.lines).toEqual(expect.arrayContaining([{ label: "Product", value: "Silver ring" }]));
  });

  it("find a file late in a long thread, not only among the first ten", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...img, id: `a${i + 1}`, name: `f${i + 1}.jpg` }));
    const c = await cardOf("post_now", { caption: "x", targets: ["FB"], media: "a12" }, ctxOf({ attachments: many }));
    expect(c.lines).toEqual(expect.arrayContaining([{ label: "Picture or video", value: "f12.jpg" }]));
  });

  it("refuse a switched-off feature", async () => {
    vi.mocked(imageEnabled).mockReturnValue(false);
    expect(await refusal(cardOf("make_picture", { idea: "a ring on marble" }))).toMatch(/switched off/);
    vi.mocked(adVideoEnabled).mockReturnValue(false);
    expect(await refusal(cardOf("make_video", { idea: "a short ad" }))).toMatch(/switched off/);
    expect(await refusal(cardOf("set_daily_video", { mode: "DRAFT" }))).toMatch(/switched off/);
  });

  it("refuse a reference that is a video, and a file that was never attached", async () => {
    expect(await refusal(cardOf("make_picture", { idea: "a ring on marble", references: ["a3"] }))).toMatch(/video/);
    expect(await refusal(cardOf("make_picture", { idea: "a ring on marble", references: ["a9"] }))).toMatch(/not one of the files/);
    expect(await refusal(cardOf("add_product", { name: "Ring", price: "25000", photos: ["a9"] }))).toMatch(/not one of the files/);
  });

  it("do not trust the attachment list of the thread: only this workspace's own uploads count", async () => {
    const foreign = { ...img, id: "a1", url: "https://abc.public.blob.vercel-storage.com/merchant/t2/chat/1.jpg", pathname: "merchant/t2/chat/1.jpg" };
    expect(await refusal(cardOf("post_now", { caption: "x", targets: ["FB"], media: "a1" }, ctxOf({ attachments: [foreign] })))).toMatch(/not one of the files/);
  });

  it("refuse a post to a platform that is not connected, with several Pages, and an Instagram post that cannot work", async () => {
    expect(await refusal(cardOf("post_now", { caption: "x", targets: ["IG"], media: "a1" }))).toMatch(/Instagram is not connected/);
    shop.ig = { connected: true, accountId: "ig1" };
    expect(await refusal(cardOf("post_now", { caption: "x", targets: ["IG"] }))).toMatch(/need an attached picture or video/);
    expect(await refusal(cardOf("post_now", { caption: "x", targets: ["IG"], media: "a2" }))).toMatch(/JPEG/);
    // The schema stops a caption over 2000 characters; Instagram's own extra rule is at most 30 hashtags.
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
    expect(await refusal(cardOf("post_now", { caption: tags, targets: ["IG"], media: "a1" }))).toMatch(/30 hashtags/);
    expect(await refusal(cardOf("post_now", { caption: "", targets: ["FB"] }))).toMatch(/needs a caption or an attached/);
    shop.fbPages = 2;
    expect(await refusal(cardOf("post_now", { caption: "x", targets: ["FB"] }))).toMatch(/several Facebook Pages/);
    // a JPEG picture and a video are fine for Instagram
    shop.fbPages = 1;
    await expect(cardOf("post_now", { caption: "x", targets: ["IG"], media: "a1" })).resolves.toBeTruthy();
    await expect(cardOf("post_now", { caption: "x", targets: ["IG"], media: "a3" })).resolves.toBeTruthy();
  });

  it("refuse a scheduled time that is too soon or too far, and show the Baghdad time of one that is fine", async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000 + 2 * 60_000).toISOString().slice(0, 16);
    expect(await refusal(cardOf("schedule_post", { caption: "x", targets: ["FB"], when: soon }))).toMatch(/Baghdad/);
    expect(await refusal(cardOf("schedule_post", { caption: "x", targets: ["FB"], when: "2030-01-01T10:00" }))).toMatch(/Baghdad/);
    const later = new Date(Date.now() + 3 * 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 16);
    const c = await cardOf("schedule_post", { caption: "x", targets: ["FB"], when: later });
    expect(c.lines).toEqual(expect.arrayContaining([{ label: "When (Baghdad time)", value: later.replace("T", " ") }]));
  });

  it("refuse a price that is not a price and a WhatsApp number that is not a number", async () => {
    expect(await refusal(cardOf("add_product", { name: "Ring", price: "0" }))).toMatch(/positive whole number/);
    expect(await refusal(cardOf("set_whatsapp_number", { number: "12345 678" }))).toMatch(/not a valid phone number/);
    await expect(cardOf("set_whatsapp_number", { number: "0770 123 4567" })).resolves.toMatchObject({ title: "WhatsApp number" });
  });

  it("arguments that do not fit the schema never reach a card", () => {
    expect(() => parse("set_autopilot", { mode: "ALWAYS" })).toThrow();
    expect(() => parse("set_shop_options", {})).toThrow();
    expect(() => parse("post_now", { caption: "x", targets: ["TT"] })).toThrow();
  });
});

describe("the older tools' runs", () => {
  it("make a picture with the chat's review switch and the attached references, and hand the picture back", async () => {
    vi.mocked(generateAiImageAction).mockResolvedValue({ ok: true, media: { url: OWN, pathname: img.pathname, type: "IMAGE" }, prompt: "p", reviewed: true, summary: "" });
    const r = await run("make_picture", { idea: "ring on marble", references: ["a1"], shape: "portrait", product: "silver ring" });
    expect(r).toMatchObject({ ok: true, media: { url: OWN, kind: "image" } });
    expect(vi.mocked(generateAiImageAction).mock.calls[0][0]).toMatchObject({ idea: "ring on marble", refUrls: [OWN], shape: "portrait", review: true, productId: "p2" });
    await run("make_picture", { idea: "ring on marble" }, ctxOf({ review: false }));
    expect(vi.mocked(generateAiImageAction).mock.calls[1][0]).toMatchObject({ review: false });
  });

  it("start a video through the video action and say so", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    expect(await run("make_video", { idea: "a short ad" })).toMatchObject({ ok: true, jobId: "job1" });
    expect(vi.mocked(createVideoAction).mock.calls[0][1]).toMatchObject({ topic: "a short ad", review: true, publish: false });
  });

  it("post through the app's publish action, and report a post that did not go out as a failure", async () => {
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true }] });
    const r = await run("post_now", { caption: "Hello", targets: ["FB"], media: "a1", product: "silver ring" });
    expect(r.ok).toBe(true);
    expect(vi.mocked(publishAction).mock.calls[0][0]).toEqual({ caption: "Hello", targets: ["FB"], media: { url: OWN, pathname: img.pathname, type: "IMAGE" }, productId: "p2" });
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: false }] });
    expect(await run("post_now", { caption: "Hello", targets: ["FB"] })).toMatchObject({ ok: false });
  });

  it("still refuse at run time what the card refuses (a platform that was disconnected since)", async () => {
    shop.ig = { connected: false };
    const r = await run("post_now", { caption: "x", targets: ["IG"], media: "a1" });
    expect(r).toMatchObject({ ok: false });
    expect(publishAction).not.toHaveBeenCalled();
  });

  it("schedule with the Baghdad time as given", async () => {
    vi.mocked(schedulePublishAction).mockResolvedValue({ ok: true, id: "x", runAt: "2026-10-20T16:30:00.000Z" });
    const r = await run("schedule_post", { caption: "Later", targets: ["FB"], when: "2026-10-20T19:30" });
    expect(r).toMatchObject({ ok: true, text: "Scheduled for 2026-10-20 19:30 (Baghdad time).\nShop: Shop two" });
    expect(vi.mocked(schedulePublishAction).mock.calls[0][1]).toBe("2026-10-20T19:30");
  });

  it("switch the automatic replies, the autopilot, the daily video and the shop options for the connected shop", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    expect(await run("set_auto_replies", { on: true })).toMatchObject({ ok: true, text: "Automatic replies are on.\nShop: Shop two" });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { automationEnabled: true });
    await run("set_autopilot", { mode: "PUBLISH", perDay: 2 });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { autoMode: "PUBLISH", autoPerDay: 2 });
    await run("set_shop_options", { likeComments: true, expiryDays: 14 });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { likeComments: true, expiryDays: 14 });
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await run("set_daily_video", { mode: "PUBLISH" });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "PUBLISH", tier: "LITE", hour: 21 });
  });

  it("add a product with the attached photo, hide one by its exact name, and save the WhatsApp number", async () => {
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p9" });
    await run("add_product", { name: "Ring", price: "25000", photos: ["a1"] });
    expect(vi.mocked(saveProductAction).mock.calls[0]).toEqual(["s2", null, { name: "Ring", description: "", photos: [OWN], variants: [{ label: "", price: "25000", currency: "IQD", inStock: true }] }]);
    vi.mocked(archiveProductAction).mockResolvedValue({ ok: true });
    expect(await run("archive_product", { product: "silver ring" })).toMatchObject({ ok: true });
    expect(archiveProductAction).toHaveBeenCalledWith("s2", "p2");
    vi.mocked(saveWhatsAppAction).mockResolvedValue({ ok: true, digits: "9647701234567" });
    expect(await run("set_whatsapp_number", { number: "07701234567" })).toMatchObject({ ok: true });
    expect(saveWhatsAppAction).toHaveBeenCalledWith("07701234567");
  });

  it("say what the action said when it fails", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: false, error: "Not allowed." });
    expect(await run("set_auto_replies", { on: false })).toEqual({ ok: false, text: "Not allowed." });
  });

  it("answer in the person's language", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    expect((await run("set_auto_replies", { on: true }, ctxOf({ lang: "ckb" }))).text).toBe("وەڵامی خۆکار چالاک کرا.\nدووکان: Shop two");
  });
});

describe("set_shop_options: a text that is cleared", () => {
  it("is shown on the card as cleared, in every language, instead of leaving the line out", async () => {
    const args = { likeComments: true, defaultDm: "", deliveryFee: "", deliveryTime: "", aiBrief: "" };
    const en = await cardOf("set_shop_options", args);
    expect(en.lines).toEqual([
      { label: "Like comments", value: "Yes" },
      { label: "Default private message", value: CARD.cleared.en },
      { label: "Delivery fee (IQD)", value: CARD.cleared.en },
      { label: "Delivery time", value: CARD.cleared.en },
      { label: "About the shop, for the AI", value: CARD.cleared.en },
      { label: "Shop", value: "Shop two" },
    ]);
    expect(CARD.cleared.en).toBe("Empty (cleared)");
    for (const lang of ["ckb", "ar"] as const) {
      const card = await cardOf("set_shop_options", args, ctxOf({ lang }));
      expect(card.lines.filter((l) => l.value === CARD.cleared[lang]), lang).toHaveLength(4);
    }
  });

  it("shows a single cleared text as the only change, and a text that is set as itself", async () => {
    const only = await cardOf("set_shop_options", { deliveryTime: "" });
    expect(only.lines).toEqual([
      { label: "Delivery time", value: "Empty (cleared)" },
      { label: "Shop", value: "Shop two" },
    ]);
    const set = await cardOf("set_shop_options", { deliveryTime: "1-2 days", aiBrief: "" });
    expect(set.lines.map((l) => l.value)).toEqual(["1-2 days", "Empty (cleared)", "Shop two"]);
  });

  it("clears it when it runs: the empty text goes to the settings action as it is", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    await run("set_shop_options", { deliveryTime: "", aiBrief: "" });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { deliveryTime: "", aiBrief: "" });
  });

  it("does not show the cleared words for a field that was left out, and does not touch other tools", async () => {
    const c = await cardOf("set_shop_options", { likeComments: false });
    expect(c.lines.map((l) => l.value)).toEqual(["No", "Shop two"]);
    expect(JSON.stringify(await cardOf("add_product", { name: "Ring", price: "25000" }))).not.toContain(CARD.cleared.en);
  });

  it("says in the tool description what an empty string does", () => {
    expect(tool("set_shop_options").description).toMatch(/empty string/i);
    expect(tool("set_shop_options").description).toMatch(/clears/);
  });
});

describe("a product named loosely is pinned to the exact id the card resolved", () => {
  const later = new Date(Date.now() + 3 * 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 16);
  const cases: [string, Record<string, unknown>][] = [
    ["archive_product", { product: "silver ring" }],
    ["update_product", { product: "silver ring", price: "30000" }],
    ["make_picture", { idea: "a ring on marble", product: "silver" }],
    ["make_video", { idea: "a short ad", product: "silver" }],
    ["post_now", { caption: "New rings", targets: ["FB"], product: "Silver ring" }],
    ["schedule_post", { caption: "New rings", targets: ["FB"], product: "silver", when: later }],
  ];

  it("returns the exact product id as the argument to store, and the card still shows the name", async () => {
    for (const [name, args] of cases) {
      const card = await cardOf(name, args);
      expect(card.pin, name).toEqual({ product: "p2" });
      expect(card.lines.some((l) => l.value === "Silver ring"), name).toBe(true);
      expect(card.lines.some((l) => l.value === "p2"), name).toBe(false);
      // What the loop stores is the model's arguments over the pin: it must still fit the tool's schema, and name the product by its id.
      const stored = tool(name).schema.safeParse({ ...parse(name, args), ...card.pin });
      expect(stored.success, name).toBe(true);
      expect((stored as { data: { product: string } }).data.product, name).toBe("p2");
    }
  });

  it("pins nothing when no product was named", async () => {
    expect((await cardOf("make_video", { idea: "a short ad" })).pin).toBeUndefined();
    expect((await cardOf("post_now", { caption: "x", targets: ["FB"] })).pin).toBeUndefined();
    expect((await cardOf("set_auto_replies", { on: true })).pin).toBeUndefined();
    expect((await cardOf("add_product", { name: "Ring", price: "25000" })).pin).toBeUndefined();
    expect((await cardOf("set_whatsapp_number", { number: "0770 123 4567" })).pin).toBeUndefined();
  });

  it("makes Confirm act on the product the card showed even if the name changed in between", async () => {
    const card = await cardOf("archive_product", { product: "silver ring" });
    // The product is renamed before the person presses Confirm: the name in the model's arguments no longer finds it, the id does.
    db.product.findMany.mockResolvedValue([
      { id: "p1", name: "Gold ring", storeId: "s1" },
      { id: "p2", name: "Sterling ring", storeId: "s2" },
    ]);
    vi.mocked(archiveProductAction).mockResolvedValue({ ok: true });
    expect(await run("archive_product", { product: "silver ring" })).toMatchObject({ ok: false });
    expect(archiveProductAction).not.toHaveBeenCalled();
    expect(await run("archive_product", { product: (card.pin as { product: string }).product })).toMatchObject({ ok: true });
    expect(archiveProductAction).toHaveBeenCalledWith("s2", "p2");
  });
});

describe("finding a product", () => {
  const farProduct = { id: "p777", name: "Far product", storeId: "s1" };
  /** A database that answers the way the real one does: the where clause decides. Only the id and the name of one product are known. */
  const database = () =>
    db.product.findMany.mockImplementation(async (q: { where: { OR?: { id?: string }[]; name?: { contains?: string } } }) => {
      if (q.where.OR?.some((o) => o.id === "p777")) return [farProduct];
      if (q.where.name?.contains && farProduct.name.toLowerCase().includes(q.where.name.contains.toLowerCase())) return [farProduct];
      return [];
    });

  it("looks a product up in the database by its id, so a shop with any number of products works", async () => {
    database();
    const c = await cardOf("archive_product", { product: "p777" });
    expect(c.lines).toEqual([
      { label: "Product", value: "Far product" },
      { label: "Shop", value: "Shop one" },
      { label: "Note", value: CARD.archiveNote.en },
    ]);
    expect(c.pin).toEqual({ product: "p777" });
    // Every question to the database is about this workspace's active products, narrow, and about what was named.
    expect(db.product.findMany).toHaveBeenCalled();
    for (const [q] of db.product.findMany.mock.calls) {
      expect(q.where).toMatchObject({ active: true, store: { tenantId: "t1" } });
      expect(q.take).toBeLessThanOrEqual(5);
    }
    expect(db.product.findMany.mock.calls[0][0].where.OR).toEqual([{ id: "p777" }, { name: { equals: "p777", mode: "insensitive" } }]);
  });

  it("finds a product by a part of its name wherever it is, and refuses an id nobody has", async () => {
    database();
    const c = await cardOf("make_video", { idea: "a short ad", product: "far prod" });
    expect(c.lines).toEqual(expect.arrayContaining([{ label: "Product", value: "Far product" }]));
    expect(await refusal(cardOf("archive_product", { product: "p778" }))).toMatch(/No single product/);
  });

  it("refuses a name that two products share, and an exact name that two products share", async () => {
    db.product.findMany.mockResolvedValue([
      { id: "p3", name: "Ring", storeId: "s1" },
      { id: "p4", name: "Ring", storeId: "s2" },
    ]);
    expect(await refusal(cardOf("archive_product", { product: "ring" }))).toMatch(/No single product/);
    expect(await refusal(cardOf("archive_product", { product: "Ri" }))).toMatch(/No single product/);
    // ...but an id still names exactly one.
    expect((await cardOf("archive_product", { product: "p4" })).pin).toEqual({ product: "p4" });
  });

  it("asks the database nothing about products when no product is named", async () => {
    await cardOf("set_auto_replies", { on: true });
    await cardOf("add_product", { name: "Ring", price: "25000" });
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
});

describe("with several shops", () => {
  const oneShop = () => db.store.findMany.mockResolvedValue([{ id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null }]);

  it("names the shop on every card of a settings or product tool", async () => {
    const cards = [
      await cardOf("set_auto_replies", { on: false }),
      await cardOf("set_autopilot", { mode: "OFF" }),
      await cardOf("set_daily_video", { mode: "OFF" }),
      await cardOf("set_shop_options", { expiryDays: 14 }),
      await cardOf("add_product", { name: "Ring", price: "25000" }),
      await cardOf("archive_product", { product: "p1" }),
      await cardOf("update_product", { product: "p1", price: "30000" }),
    ];
    expect(cards.map((c) => c.lines.find((l) => l.label === "Shop")?.value)).toEqual(["Shop two", "Shop two", "Shop two", "Shop two", "Shop two", "Shop one", "Shop one"]);
  });

  it("names the shop in the result sentence, so a 'done' always says which shop it was", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p9" });
    vi.mocked(archiveProductAction).mockResolvedValue({ ok: true });
    const results = [
      await run("set_auto_replies", { on: false }),
      await run("set_autopilot", { mode: "OFF" }),
      await run("set_daily_video", { mode: "OFF" }),
      await run("set_shop_options", { expiryDays: 14 }),
      await run("add_product", { name: "Ring", price: "25000" }),
    ];
    for (const r of results) expect(r.text.split("\n").at(-1)).toBe("Shop: Shop two");
    // A product is in the shop it belongs to, which may not be the shop of the connected Page.
    expect((await run("archive_product", { product: "gold ring" })).text).toBe("The product is hidden.\nShop: Shop one");
    expect(archiveProductAction).toHaveBeenLastCalledWith("s1", "p1");
  });

  it("names the shop in every language", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    expect((await run("set_autopilot", { mode: "OFF" }, ctxOf({ lang: "ar" }))).text.split("\n").at(-1)).toBe(`${dict("ar").assistant.fields.shop}: Shop two`);
    expect((await run("set_autopilot", { mode: "OFF" }, ctxOf({ lang: "ckb" }))).text.split("\n").at(-1)).toBe(`${dict("ckb").assistant.fields.shop}: Shop two`);
  });

  it("leaves the sentence as it is with one shop, and for a number that belongs to the whole workspace", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    vi.mocked(saveWhatsAppAction).mockResolvedValue({ ok: true, digits: "9647701234567" });
    expect(await run("set_auto_replies", { on: true })).toMatchObject({ text: "Automatic replies are on.\nShop: Shop two" });
    expect(await run("set_whatsapp_number", { number: "07701234567" })).toMatchObject({ ok: true, text: "The WhatsApp number is saved." });
    oneShop();
    expect(await run("set_auto_replies", { on: true })).toEqual({ ok: true, text: "Automatic replies are on." });
  });

  it("names a shop that has no name by its place in the list", async () => {
    db.store.findMany.mockResolvedValue([
      { id: "s1", name: "", igUsername: null, fbPageId: "other", igUserId: null },
      { id: "s2", name: "", igUsername: "zana_shop", fbPageId: "fb1", igUserId: null },
      { id: "s3", name: "", igUsername: null, fbPageId: "fb9", igUserId: null },
    ]);
    expect((await cardOf("set_auto_replies", { on: true })).lines.find((l) => l.label === "Shop")?.value).toBe("@zana_shop");
    db.store.findMany.mockResolvedValue([
      { id: "s1", name: "", igUsername: null, fbPageId: "other", igUserId: null },
      { id: "s2", name: "", igUsername: null, fbPageId: "fb1", igUserId: null },
    ]);
    expect((await cardOf("set_auto_replies", { on: true })).lines.find((l) => l.label === "Shop")?.value).toBe("#2");
  });

  it("names the Page on a reply, a hidden comment and a message when the shop has several Pages", async () => {
    shop.fbPages = 2;
    const platformLine = (c: Card) => c.lines.find((l) => l.label === "Platform")?.value;
    expect(platformLine(await cardOf("hide_comment", { platform: "FB", comment: "c1" }))).toBe("Facebook · Page");
    expect(platformLine(await cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "Yes" }))).toBe("Facebook · Page");
    expect(platformLine(await cardOf("send_message", { platform: "FB", conversation: "conv1", text: "Yes" }))).toBe("Facebook · Page");
    shop.fbPages = 1;
    expect(platformLine(await cardOf("hide_comment", { platform: "FB", comment: "c1" }))).toBe("Facebook");
  });

  it("still works when the list of accounts cannot be read", async () => {
    vi.mocked(loadAccountLists).mockRejectedValueOnce(new Error("db down"));
    const c = await cardOf("hide_comment", { platform: "FB", comment: "c1" });
    expect(c.lines[0]).toEqual({ label: "Platform", value: "Facebook" });
  });
});

describe("set_order_status", () => {
  it("shows the order and the change, and runs the orders screen's action", async () => {
    const c = await cardOf("set_order_status", { order: "o1", status: "SENT" });
    expect(c.title).toBe("Change an order's status");
    expect(c.lines).toEqual([
      { label: "Order", value: "Dana · Silver ring · 25,000 IQD" },
      { label: "Status", value: "Sent (was New)" },
    ]);
    vi.mocked(setOrderStatusAction).mockResolvedValue({ ok: true, id: "o1" });
    expect(await run("set_order_status", { order: "o1", status: "SENT" })).toEqual({ ok: true, text: "The order is now “Sent”." });
    expect(setOrderStatusAction).toHaveBeenCalledWith("o1", "SENT");
  });

  it("refuses an order that is not this shop's, a change to the status it already has, and a status that does not exist", async () => {
    db.order.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("set_order_status", { order: "nope", status: "SENT" }))).toMatch(/list_orders/);
    expect(db.order.findFirst.mock.calls[0][0].where).toEqual({ id: "nope", tenantId: "t1" });
    db.order.findFirst.mockResolvedValue({ customerName: "Dana", productName: "", status: "SENT", amountMinor: 0, currency: "IQD" });
    expect(await refusal(cardOf("set_order_status", { order: "o1", status: "SENT" }))).toMatch(/already SENT/);
    expect(() => parse("set_order_status", { order: "o1", status: "PAID" })).toThrow();
  });

  it("passes on the action's own refusal", async () => {
    vi.mocked(setOrderStatusAction).mockResolvedValue({ ok: false, error: "Order not found." });
    expect(await run("set_order_status", { order: "o1", status: "DELIVERED" })).toEqual({ ok: false, text: "Order not found." });
  });
});

describe("hide_comment", () => {
  it("shows the comment that will be hidden, and runs the comments screen's action as the account that was looked at", async () => {
    const c = await cardOf("hide_comment", { platform: "FB", comment: "c1" });
    expect(c.title).toBe("Hide a comment");
    expect(c.lines).toEqual([
      { label: "Platform", value: "Facebook" },
      { label: "Comment", value: "Ali: How much is it?" },
    ]);
    // Only Facebook is read, not Instagram too.
    expect(vi.mocked(loadPosts).mock.calls[0][1]).toMatchObject({ META_INSTAGRAM: { connected: false }, META_FACEBOOK: { connected: true } });
    vi.mocked(setCommentHiddenAction).mockResolvedValue({ ok: true });
    expect(await run("hide_comment", { platform: "FB", comment: "c1" })).toEqual({ ok: true, text: "The comment is hidden." });
    expect(setCommentHiddenAction).toHaveBeenCalledWith("FB", "c1", true, "fb1");
  });

  it("can show a hidden comment again, and refuses a change that is no change", async () => {
    shop.comments = [aComment({ hidden: true })];
    const c = await cardOf("hide_comment", { platform: "FB", comment: "c1", hidden: false });
    expect(c.title).toBe("Show a hidden comment");
    vi.mocked(setCommentHiddenAction).mockResolvedValue({ ok: true });
    expect(await run("hide_comment", { platform: "FB", comment: "c1", hidden: false })).toMatchObject({ ok: true, text: "The comment is visible again." });
    expect(vi.mocked(setCommentHiddenAction).mock.calls[0][2]).toBe(false);
    expect(await refusal(cardOf("hide_comment", { platform: "FB", comment: "c1" }))).toMatch(/already hidden/);
  });

  it("refuses a comment that is not found and a platform that is not connected", async () => {
    expect(await refusal(cardOf("hide_comment", { platform: "FB", comment: "zzz" }))).toMatch(/list_comments/);
    expect(await refusal(cardOf("hide_comment", { platform: "IG", comment: "c1" }))).toMatch(/Instagram is not connected/);
    expect(setCommentHiddenAction).not.toHaveBeenCalled();
  });
});

describe("reply_to_comment", () => {
  it("shows the comment and the reply, and runs the comments screen's action", async () => {
    const c = await cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "It is 25,000 IQD." });
    expect(c.title).toBe("Reply to a comment");
    expect(c.lines).toEqual([
      { label: "Platform", value: "Facebook" },
      { label: "Comment", value: "Ali: How much is it?" },
      { label: "Reply", value: "It is 25,000 IQD." },
    ]);
    vi.mocked(replyToCommentAction).mockResolvedValue({ ok: true });
    expect(await run("reply_to_comment", { platform: "FB", comment: "c1", text: "It is 25,000 IQD." })).toEqual({ ok: true, text: "The reply was sent." });
    expect(replyToCommentAction).toHaveBeenCalledWith("FB", "c1", "It is 25,000 IQD.", "fb1");
  });

  it("warns when the shop already answered, and refuses the shop's own comment", async () => {
    shop.comments = [aComment({ replies: [{ id: "r1", author: "Page", text: "Hi", fromUs: true }] })];
    const c = await cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "Again" });
    expect(c.lines.at(-1)).toEqual({ label: "Note", value: "This comment already has a reply from the shop." });
    shop.comments = [aComment({ fromUs: true })];
    expect(await refusal(cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "x" }))).toMatch(/shop's own account/);
  });

  it("respects the platform's text limit", async () => {
    shop.ig = { connected: true, accountId: "ig1" };
    expect(await refusal(cardOf("reply_to_comment", { platform: "IG", comment: "c1", text: "x".repeat(2201) }))).toMatch(/2200/);
    shop.comments = [aComment({ platform: "FB" })];
    await expect(cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "x".repeat(2201) })).resolves.toBeTruthy();
    expect(() => parse("reply_to_comment", { platform: "FB", comment: "c1", text: "x".repeat(8001) })).toThrow();
  });

  it("runs as the connected account, and says so when the platform was disconnected before Confirm", async () => {
    shop.comments = [];
    vi.mocked(replyToCommentAction).mockResolvedValue({ ok: true });
    // The run does not need the comment itself, only the connected account: it goes on and Meta has the last word.
    expect(await run("reply_to_comment", { platform: "FB", comment: "c1", text: "x" })).toMatchObject({ ok: true });
    shop.fb = { connected: false };
    expect(await run("reply_to_comment", { platform: "FB", comment: "c1", text: "x" })).toEqual({ ok: false, text: NEW.stale.en });
  });
});

describe("send_message", () => {
  it("shows who it goes to, what they last said and the message, and runs the messages screen's action with the recipient", async () => {
    const c = await cardOf("send_message", { platform: "FB", conversation: "conv1", text: "Yes, it is in stock." });
    expect(c.title).toBe("Send a message");
    expect(c.lines).toEqual([
      { label: "Platform", value: "Facebook" },
      { label: "To", value: "Dana" },
      { label: "Their last message", value: "Is the ring in stock?" },
      { label: "Message", value: "Yes, it is in stock." },
    ]);
    vi.mocked(sendMessageAction).mockResolvedValue({ ok: true });
    expect(await run("send_message", { platform: "FB", conversation: "conv1", text: "Yes, it is in stock." })).toEqual({ ok: true, text: "The message was sent." });
    expect(sendMessageAction).toHaveBeenCalledWith("FB", "psid1", "Yes, it is in stock.", "fb1");
    expect(vi.mocked(loadConversations).mock.calls[0][1]).toMatchObject({ META_INSTAGRAM: { connected: false } });
  });

  it("refuses outside Meta's 24-hour window, in the card and again at run time", async () => {
    shop.conversations = [aConversation({ withinWindow: false })];
    expect(await refusal(cardOf("send_message", { platform: "FB", conversation: "conv1", text: "hi" }))).toMatch(/24-hour window/);
    expect(await run("send_message", { platform: "FB", conversation: "conv1", text: "hi" })).toEqual({ ok: false, text: NEW.stale.en });
    expect(sendMessageAction).not.toHaveBeenCalled();
  });

  it("refuses a conversation that is not found or has nobody to write to, and a text over the action's limit", async () => {
    expect(await refusal(cardOf("send_message", { platform: "FB", conversation: "nope", text: "hi" }))).toMatch(/list_conversations/);
    shop.conversations = [aConversation({ participantId: undefined })];
    expect(await refusal(cardOf("send_message", { platform: "FB", conversation: "conv1", text: "hi" }))).toMatch(/no recipient/);
    expect(() => parse("send_message", { platform: "FB", conversation: "conv1", text: "x".repeat(1001) })).toThrow();
    expect(() => parse("send_message", { platform: "WA", conversation: "conv1", text: "hi" })).toThrow();
  });
});

describe("cancel_scheduled_post", () => {
  it("shows when and where the post would have gone, and runs the schedule screen's action", async () => {
    const c = await cardOf("cancel_scheduled_post", { post: "sp1" });
    expect(c.title).toBe("Cancel a scheduled post");
    expect(c.lines.map((l) => l.label)).toEqual(["When (Baghdad time)", "Where", "Caption"]);
    expect(c.lines[1].value).toBe("Facebook + Instagram");
    expect(c.lines[2].value).toBe("Weekend offer");
    expect(db.scheduledPost.findFirst.mock.calls[0][0].where).toEqual({ id: "sp1", tenantId: "t1", status: "PENDING" });
    vi.mocked(cancelScheduledAction).mockResolvedValue({ ok: true });
    expect(await run("cancel_scheduled_post", { post: "sp1" })).toEqual({ ok: true, text: "The scheduled post is cancelled." });
    expect(cancelScheduledAction).toHaveBeenCalledWith("sp1");
  });

  it("refuses a post that is not pending", async () => {
    db.scheduledPost.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("cancel_scheduled_post", { post: "sp1" }))).toMatch(/list_scheduled_posts/);
  });
});

describe("update_product", () => {
  it("changes only what was given and writes back everything else exactly as it was", async () => {
    const c = await cardOf("update_product", { product: "silver ring", price: "30000" });
    expect(c.title).toBe("Change a product");
    expect(c.lines).toEqual([
      { label: "Product", value: "Silver ring" },
      { label: "Price (IQD)", value: "30,000 IQD (was 25,000 IQD)" },
      { label: "Shop", value: "Shop two" },
    ]);
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p2" });
    expect(await run("update_product", { product: "silver ring", price: "30000" })).toEqual({ ok: true, text: "The product is updated.\nShop: Shop two" });
    expect(vi.mocked(saveProductAction).mock.calls[0]).toEqual([
      "s2",
      "p2",
      { name: "Silver ring", description: "Pure silver", photos: [OWN], variants: [{ label: "", price: "30000", currency: "IQD", inStock: true }] },
    ]);
  });

  it("merges a name, a description and the stock switch, and keeps an existing variant label", async () => {
    db.product.findFirst.mockResolvedValue(photoProduct({ description: null, variants: [{ label: "M", amountMinor: 25000, currency: "IQD", inStock: true }] }));
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p2" });
    const c = await cardOf("update_product", { product: "p2", name: "Sterling ring", description: "Hand made", inStock: false });
    expect(c.lines.map((l) => l.value)).toEqual(["Silver ring", "Sterling ring (was Silver ring)", "Hand made (was —)", "No (was Yes)", "Shop two"]);
    await run("update_product", { product: "p2", name: "Sterling ring", description: "Hand made", inStock: false });
    expect(vi.mocked(saveProductAction).mock.calls[0][2]).toEqual({
      name: "Sterling ring",
      description: "Hand made",
      photos: [OWN],
      variants: [{ label: "M", price: "25000", currency: "IQD", inStock: false }],
    });
  });

  it("refuses a product it cannot write back whole: several prices, photos it cannot keep, a price in another currency", async () => {
    db.product.findFirst.mockResolvedValue(photoProduct({ variants: [{ label: "S", amountMinor: 1, currency: "IQD", inStock: true }, { label: "L", amountMinor: 2, currency: "IQD", inStock: true }] }));
    expect(await refusal(cardOf("update_product", { product: "p2", price: "30000" }))).toMatch(/several prices/);
    db.product.findFirst.mockResolvedValue(photoProduct({ photos: ["https://evil.example/x.jpg"] }));
    expect(await refusal(cardOf("update_product", { product: "p2", price: "30000" }))).toMatch(/photos/);
    db.product.findFirst.mockResolvedValue(photoProduct({ photos: Array.from({ length: 6 }, () => OWN) }));
    expect(await refusal(cardOf("update_product", { product: "p2", price: "30000" }))).toMatch(/photos/);
    db.product.findFirst.mockResolvedValue(photoProduct({ variants: [{ label: "", amountMinor: 1999, currency: "USD", inStock: true }] }));
    expect(await refusal(cardOf("update_product", { product: "p2", price: "30000" }))).toMatch(/USD/);
    expect(saveProductAction).not.toHaveBeenCalled();
  });

  it("passes a USD product through unchanged when only its stock changes", async () => {
    db.product.findFirst.mockResolvedValue(photoProduct({ variants: [{ label: "", amountMinor: 1999, currency: "USD", inStock: true }] }));
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p2" });
    await run("update_product", { product: "p2", inStock: false });
    expect(vi.mocked(saveProductAction).mock.calls[0][2].variants).toEqual([{ label: "", price: "19.99", currency: "USD", inStock: false }]);
  });

  it("refuses a product that is not found, a price that is not a price, and a change that changes nothing", async () => {
    expect(await refusal(cardOf("update_product", { product: "ring", price: "30000" }))).toMatch(/No single product/);
    expect(await refusal(cardOf("update_product", { product: "p2", price: "0" }))).toMatch(/positive whole number/);
    expect(await refusal(cardOf("update_product", { product: "p2", name: "Silver ring" }))).toMatch(/Nothing would change/);
    expect(() => parse("update_product", { product: "p2" })).toThrow();
    // an empty description would blank the field: it is not accepted
    expect(() => parse("update_product", { product: "p2", description: "" })).toThrow();
  });

  it("reads the product again when it runs, so a product that grew a second price in the meantime is left alone", async () => {
    db.product.findFirst.mockResolvedValue(photoProduct({ variants: [{ label: "S", amountMinor: 1, currency: "IQD", inStock: true }, { label: "L", amountMinor: 2, currency: "IQD", inStock: true }] }));
    expect(await run("update_product", { product: "p2", price: "30000" })).toEqual({ ok: false, text: NEW.stale.en });
    expect(saveProductAction).not.toHaveBeenCalled();
  });
});

describe("words", () => {
  const LANGS: Lang[] = ["ckb", "ar", "en"];
  // Letters Sorani has and Arabic does not (tests/i18n/dictionaries.test.ts uses the same set).
  const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;

  const leaves = (): { where: string; lang: Lang; text: string }[] => {
    const out: { where: string; lang: Lang; text: string }[] = [];
    const walk = (node: unknown, path: string) => {
      const o = node as Record<string, unknown>;
      if (LANGS.every((l) => l in o)) {
        for (const l of LANGS) out.push({ where: path, lang: l, text: typeof o[l] === "function" ? (o[l] as (...a: string[]) => string)("A", "B") : String(o[l]) });
        return;
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(LABEL, "LABEL");
    walk(NEW, "NEW");
    walk(CARD, "CARD");
    return out;
  };

  it("exist in Sorani, Arabic and English, none empty", () => {
    const all = leaves();
    expect(all.length).toBeGreaterThan(60);
    for (const l of all) expect(l.text.trim(), `${l.where}.${l.lang}`).not.toBe("");
  });

  it("keep Kurdish-only letters out of the Arabic and the Arabic script out of the English", () => {
    for (const l of leaves()) {
      if (l.lang === "ar") expect(KURDISH_ONLY.test(l.text), `${l.where} (ar): ${l.text}`).toBe(false);
      if (l.lang === "en") expect(/[؀-ۿ]/.test(l.text), `${l.where} (en): ${l.text}`).toBe(false);
    }
  });

  it("are the ones the cards show: every new card in every language", async () => {
    shop.comments = [aComment({ replies: [{ id: "r1", author: "Page", text: "Hi", fromUs: true }] })];
    for (const lang of LANGS) {
      const c = ctxOf({ lang });
      const cards = [
        await cardOf("set_order_status", { order: "o1", status: "SENT" }, c),
        await cardOf("hide_comment", { platform: "FB", comment: "c1" }, c),
        await cardOf("reply_to_comment", { platform: "FB", comment: "c1", text: "x" }, c),
        await cardOf("send_message", { platform: "FB", conversation: "conv1", text: "x" }, c),
        await cardOf("cancel_scheduled_post", { post: "sp1" }, c),
        await cardOf("update_product", { product: "p2", price: "30000", inStock: false }, c),
      ];
      for (const card of cards) {
        expect(card.title.trim()).not.toBe("");
        for (const line of card.lines) {
          expect(line.label.trim(), card.title).not.toBe("");
          expect(line.value.trim(), card.title).not.toBe("");
          if (lang === "ar") expect(KURDISH_ONLY.test(line.label), `${card.title}: ${line.label}`).toBe(false);
        }
      }
      expect(tool("hide_comment").label(lang).trim()).not.toBe("");
    }
  });
});
