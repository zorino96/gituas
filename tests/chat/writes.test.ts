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
  businessProfile: { findUnique: vi.fn() },
  chatMessage: { findMany: vi.fn() },
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
import { STORY_VIDEO_ARGS, STORY_VIDEO_RULES } from "@/lib/assistant/tools";
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
  vi.unstubAllEnvs();
  db.businessProfile.findUnique.mockResolvedValue(null);
  // The thread's messages (the owner's own words a story's idea is compared with): none unless a test gives some.
  db.chatMessage.findMany.mockReset();
  db.chatMessage.findMany.mockResolvedValue([]);
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
    // Four of them (answering and hiding comments, messages, cancelling a scheduled post) serve a news desk too.
    for (const t of WRITE_TOOLS) expect(t.kinds).toEqual(["hide_comment", "reply_to_comment", "send_message", "cancel_scheduled_post"].includes(t.name) ? ["shop", "news"] : ["shop"]);
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
    expect(toolsFor(WRITE_TOOLS, "news", "OWNER")).toHaveLength(4);
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
      cancel_scheduled_post: "destructive",
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
    expect(riskOf(tool("cancel_scheduled_post"), { post: "sp1" })).toBe("destructive");
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
      set_daily_video: ["idea"],
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
        { label: "Accounts", value: "Shop two" },
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
    expect(await refusal(cardOf("set_auto_replies", { on: true }))).toMatch(/nothing is connected yet/i);
    db.store.findMany.mockResolvedValue([{ id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null }]);
    expect(await refusal(cardOf("archive_product", { product: "ring" }))).toMatch(/list_products/);
    expect(await refusal(cardOf("make_video", { idea: "a short ad", product: "nothing" }))).toMatch(/No single product/);
  });

  it("take a product by its id as well as by its name, and show the name it resolved to", async () => {
    const byId = await cardOf("archive_product", { product: "p2" });
    expect(byId.lines).toEqual([
      { label: "Product", value: "Silver ring" },
      { label: "Accounts", value: "Shop two" },
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
    expect(r).toMatchObject({ ok: true, text: "Scheduled for 2026-10-20 19:30 (Baghdad time).\nAccounts: Shop two" });
    expect(vi.mocked(schedulePublishAction).mock.calls[0][1]).toBe("2026-10-20T19:30");
  });

  it("switch the automatic replies, the autopilot, the daily video and the shop options for the connected shop", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    expect(await run("set_auto_replies", { on: true })).toMatchObject({ ok: true, text: "Automatic replies are on.\nAccounts: Shop two" });
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
    expect((await run("set_auto_replies", { on: true }, ctxOf({ lang: "ckb" }))).text).toBe("وەڵامی خۆکار چالاک کرا.\nئەکاونتەکان: Shop two");
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
      { label: "Accounts", value: "Shop two" },
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
      { label: "Accounts", value: "Shop two" },
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
      { label: "Accounts", value: "Shop one" },
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
    expect(cards.map((c) => c.lines.find((l) => l.label === "Accounts")?.value)).toEqual(["Shop two", "Shop two", "Shop two", "Shop two", "Shop two", "Shop one", "Shop one"]);
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
    for (const r of results) expect(r.text.split("\n").at(-1)).toBe("Accounts: Shop two");
    // A product is in the shop it belongs to, which may not be the shop of the connected Page.
    expect((await run("archive_product", { product: "gold ring" })).text).toBe("The product is hidden.\nAccounts: Shop one");
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
    expect(await run("set_auto_replies", { on: true })).toMatchObject({ text: "Automatic replies are on.\nAccounts: Shop two" });
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
    expect((await cardOf("set_auto_replies", { on: true })).lines.find((l) => l.label === "Accounts")?.value).toBe("@zana_shop");
    db.store.findMany.mockResolvedValue([
      { id: "s1", name: "", igUsername: null, fbPageId: "other", igUserId: null },
      { id: "s2", name: "", igUsername: null, fbPageId: "fb1", igUserId: null },
    ]);
    expect((await cardOf("set_auto_replies", { on: true })).lines.find((l) => l.label === "Accounts")?.value).toBe("#2");
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
    // WhatsApp is a platform of send_message now (see tests/chat/wa-write.test.ts); TikTok is not.
    expect(() => parse("send_message", { platform: "TT", conversation: "conv1", text: "hi" })).toThrow();
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
      { label: "Accounts", value: "Shop two" },
    ]);
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p2" });
    expect(await run("update_product", { product: "silver ring", price: "30000" })).toEqual({ ok: true, text: "The product is updated.\nAccounts: Shop two" });
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

describe("the video's language and kind", () => {
  const languageOf = (c: Card) => c.lines.find((l) => l.label === "Video language" || l.label === "زمانی ڤیدیۆ" || l.label === "لغة الفيديو")?.value;
  const kindRow = (c: Card) => c.lines.find((l) => l.label === "Kind");
  const noteLine = (c: Card) => c.lines.find((l) => l.label === "Note");
  const UI: Lang[] = ["ckb", "ar", "en"];
  const KURDISH = /[کیەێۆڕڵڤپچژگ]/;
  const stores = (over: Record<string, unknown> = {}) => [
    { id: "s1", name: "Shop one", igUsername: null, fbPageId: "other", igUserId: null },
    { id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null, ...over },
  ];
  const profileOf = (goal: string) => ({ storeId: "s2", goal, goalText: null, category: null, offerLine: null, customer: [], sellsTo: [], language: null, tone: null, facts: [], interview: {} });

  it("tells the model that the language is the owner's choice and what a story is", () => {
    const d = tool("make_video").description;
    expect(d).toMatch(/"ckb".*"ar".*"en"/);
    expect(d).toMatch(/story/);
    expect(d).toMatch(/no product, price, delivery line or phone/);
    expect(d).toMatch(/no multi-minute/);
    expect(tool("set_daily_video").description).toMatch(/language/);
    // The language is the owner's explicit word: the language of the chat message says nothing about it.
    expect(d).toMatch(/only when the owner explicitly names the video language/);
    expect(d).toMatch(/the language of their chat message or of their idea says nothing about it/);
    expect(d).not.toMatch(/writes the story or idea in another/);
    expect(tool("set_daily_video").description).toMatch(/Pass it only when the owner explicitly names the video language/);
    expect(tool("set_daily_video").description).toMatch(/the language of their chat message says nothing about it/);
    // Mode is optional: a change of only the language leaves the daily video on or off as it was. The old claim that OFF just saves it is gone.
    expect(tool("set_daily_video").description).toMatch(/Leave mode out to keep the daily video exactly as it is now/);
    expect(tool("set_daily_video").description).not.toMatch(/mode OFF with a language/);
    expect(tool("set_daily_video").description).not.toMatch(/mode is always required/);
    const props = (toolSpecs([tool("make_video")])[0].function.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["idea", "product", "language", "kind", "photos", "review"]));
  });

  it("tells the model what a story is, once: the options (review, photos, shape) are in the tool, the story rule is in the system prompt and not repeated here", () => {
    const d = tool("make_video").description;
    expect(d).toContain(STORY_VIDEO_ARGS);
    expect(d).toMatch(/review: true only when the owner asks Gituas to improve or rewrite the idea first/);
    expect(d).toMatch(/photos: false removes the photographs/);
    expect(d).toMatch(/format: "vertical" \(the default, 9:16, for Reels\) or "wide" \(16:9, for YouTube\)/);
    expect(d).toMatch(/pass "wide" whenever the owner mentions YouTube, 16:9, wide, landscape or horizontal/);
    expect(d).toMatch(/an ad of about 35 seconds or a story of about 60 to 70 seconds \(a story aims for about 30 seconds when its idea asks for a short video, with no promise\)/);
    expect(d).toMatch(/There is still no multi-minute documentary, and a video made now is not uploaded to YouTube from here/);
    // The two answers agree: no "cannot be chosen" any more, and the review wording is the tool's own (the chat's switch decides when the owner said nothing).
    expect(d).not.toMatch(/cannot be chosen/);
    expect(d).toMatch(/left out, the owner's own "review my idea" switch in the chat decides/);
    // Act first: a generic idea is enough, the owner is never asked for a case, a country or an era.
    expect(d).toMatch(/Act first: a generic idea/);
    expect(d).toMatch(/never ask the owner to name a case, a country or an era/);
    expect(d).toMatch(/the result lists the shape, the language and the photographs as they really are: report exactly that/);
    // The story rule itself (NEVER ask the owner to name a case, the owner's own words...) is the system prompt's, ONCE per prompt.
    expect(d).not.toContain(STORY_VIDEO_RULES);
    expect(d).not.toMatch(/NEVER ask the owner to name a case/);
    // The round-1 rules (one named subject, ask one question, offer three cases) and the old claim that the AI invents every story are gone.
    expect(d).not.toMatch(/the idea must name the SPECIFIC subject/);
    expect(d).not.toMatch(/ask ONE short question/);
    expect(d).not.toMatch(/offer three real documented cases/);
    expect(d).not.toMatch(/the AI invents the story/);
  });

  it("always shows the language the video will really use: the one asked, else the shop's own, else Sorani", async () => {
    expect(languageOf(await cardOf("make_video", { idea: "a short ad" }))).toBe("Sorani Kurdish");
    db.store.findMany.mockResolvedValue(stores({ videoLang: "en" }));
    expect(languageOf(await cardOf("make_video", { idea: "a short ad" }))).toBe("English");
    expect(languageOf(await cardOf("make_video", { idea: "a short ad", language: "ar" }))).toBe("Arabic");
    // A value nobody can have in the column is Sorani, as everywhere else.
    db.store.findMany.mockResolvedValue(stores({ videoLang: "fr" }));
    expect(languageOf(await cardOf("make_video", { idea: "a short ad" }))).toBe("Sorani Kurdish");
  });

  it("names the language in the person's language, with no Kurdish-only letter in the Arabic and no Arabic script in the English", async () => {
    db.store.findMany.mockResolvedValue(stores({ videoLang: "en" }));
    expect(languageOf(await cardOf("make_video", { idea: "a short ad" }, ctxOf({ lang: "ckb" })))).toBe("ئینگلیزی");
    expect(languageOf(await cardOf("make_video", { idea: "a short ad", language: "ckb" }, ctxOf({ lang: "ar" })))).toBe("الكردية السورانية");
    for (const lang of UI) {
      for (const language of ["ckb", "ar", "en"]) {
        const c = await cardOf("make_video", { idea: "a short ad", language, kind: "story" }, ctxOf({ lang }));
        expect(c.lines.length).toBeGreaterThan(3);
        for (const l of c.lines) {
          expect(l.label.trim()).not.toBe("");
          expect(l.value.trim()).not.toBe("");
          if (lang === "ar") expect(KURDISH.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
          if (lang === "en") expect(/[؀-ۿ]/.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
        }
      }
    }
  });

  // A story card with no files attached in the chat: the lines of the story itself. (The default context holds a picture and a video, which the
  // card adds its "Not used" lines for: they have their own tests below.)
  const bare = (over: Partial<ToolCtx> = {}) => ctxOf({ attachments: [], ...over });

  it("shows a story, in every video language, as the owner's idea with its shape and the Wikimedia Commons photographs and a note to read it first; no product row", async () => {
    for (const language of ["ckb", "ar", "en"]) {
      const c = await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language, product: "silver" }, bare());
      // The length and the YouTube sentence are on the card, BEFORE Confirm.
      expect(c.lines.map((l) => l.label), language).toEqual(["Idea", "Video language", "Kind", "Shape", "Photos", "Accounts", "Note", "Length", "YouTube"]);
      expect(c.lines[0]).toEqual({ label: "Idea", value: "Hinterkaifeck murders 1922" });
      expect(kindRow(c)).toEqual({ label: "Kind", value: "Story" });
      expect(c.lines).toContainEqual({ label: "Shape", value: "Vertical 9:16 (Reels)" });
      expect(c.lines).toContainEqual({ label: "Photos", value: "Wikimedia Commons" });
      expect(noteLine(c)).toEqual({ label: "Note", value: CARD.videoStoryReal.en });
      expect(c.lines).toContainEqual({ label: "Length", value: dict("en").assistant.done.videoLengthStory });
      expect(c.lines).toContainEqual({ label: "YouTube", value: dict("en").assistant.done.videoNotYouTube });
      expect(c.lines.some((l) => l.label === "Product" || l.label === "Subject" || l.label === "Improve the idea first")).toBe(false);
    }
    // The shop's own video language decides when the model named none.
    db.store.findMany.mockResolvedValue(stores({ videoLang: "ar" }));
    const own = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story" }, bare());
    expect(languageOf(own)).toBe("Arabic");
    expect(own.lines).toContainEqual({ label: "Photos", value: "Wikimedia Commons" });
    // An ad shows no kind row, no shape and no note: it is always vertical and is made as it was.
    const ad = await cardOf("make_video", { idea: "a short ad", kind: "ad" }, bare());
    expect(kindRow(ad)).toBeUndefined();
    expect(ad.lines.some((l) => l.label === "Note" || l.label === "Shape")).toBe(false);
  });

  it("states the shape on a story's card: wide 16:9 for YouTube when asked, vertical 9:16 otherwise, in the person's language; an ad never has one", async () => {
    const wide = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", format: "wide" }, bare());
    expect(wide.lines).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    expect(wide.lines.some((l) => l.value === "Vertical 9:16 (Reels)")).toBe(false);
    for (const format of ["vertical", undefined]) {
      const c = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", ...(format ? { format } : {}) }, bare());
      expect(c.lines).toContainEqual({ label: "Shape", value: "Vertical 9:16 (Reels)" });
    }
    // The page decides the kind when the model gave none: a content page's wide request is a wide story.
    for (const lang of UI) {
      const t = dict(lang).assistant.fields;
      const c = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", format: "wide" }, bare({ lang }));
      expect(c.lines).toContainEqual({ label: t.format, value: t.formatWide });
      const v = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story" }, bare({ lang }));
      expect(v.lines).toContainEqual({ label: t.format, value: t.formatVertical });
    }
    // An ad cannot be wide: the card is refused with the plain facts for the model to tell the owner, and nothing is made.
    const said = await refusal(cardOf("make_video", { idea: "a short ad", kind: "ad", format: "wide" }, bare()));
    expect(said).toMatch(/An ad is always vertical \(9:16\); only a story can be wide \(16:9, for YouTube\)/);
    expect(said).toMatch(/Tell the owner that plainly, and offer a vertical ad or a wide story: never swap one for the other without saying so/);
    expect(await refusal(cardOf("make_video", { idea: "a short ad about the ring", product: "silver ring", format: "wide" }, bare()))).toMatch(/An ad is always vertical/);
    // An ad that asks for vertical is fine, and says nothing about it.
    const ok = await cardOf("make_video", { idea: "a short ad", kind: "ad", format: "vertical" }, bare());
    expect(ok.lines.some((l) => l.label === "Shape")).toBe(false);
  });

  it("says the case is chosen by Gituas only when none is named, that the article is read when it can be, and that the owner reads it first", () => {
    expect(CARD.videoStoryReal.en).toMatch(/or, when you named none, one Gituas chooses and shows on the video card/);
    expect(CARD.videoStoryReal.en).toMatch(/retold from its Wikipedia article when that can be read; otherwise the video card says it was told from memory/);
    expect(CARD.videoStoryReal.en).toMatch(/Free photographs from Wikimedia Commons are used where they are found, and credited in the caption and on the last scene/);
    expect(CARD.videoStoryReal.en).toMatch(/Read it before it is posted/);
    expect(CARD.videoStoryRealNoPhotos.en).toMatch(/or, when you named none, one Gituas chooses and shows on the video card/);
    expect(CARD.videoStoryRealNoPhotos.en).toMatch(/otherwise the video card says it was told from memory/);
    // Nothing promises a photograph for every part, or that a story is "never invented".
    for (const note of [CARD.videoStoryReal, CARD.videoStoryRealNoPhotos]) for (const lang of UI) expect(note[lang]).not.toMatch(/never invented|every part/);
  });

  it("says 'no photographs' on the card, and drops the photographs from the note, when the owner switched them off", async () => {
    for (const language of ["ckb", "en"]) {
      const c = await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language, photos: false }, bare());
      expect(c.lines).toContainEqual({ label: "Photos", value: "No photographs" });
      expect(c.lines.some((l) => l.value === "Wikimedia Commons")).toBe(false);
      expect(c.lines[0]).toEqual({ label: "Idea", value: "Hinterkaifeck murders 1922" });
      expect(noteLine(c)).toEqual({ label: "Note", value: CARD.videoStoryRealNoPhotos.en });
    }
    expect(CARD.videoStoryRealNoPhotos.en).not.toMatch(/Wikimedia/);
  });

  it("shows the review line only when the owner asked Gituas to improve the idea first", async () => {
    const asked = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", language: "en", review: true }, bare());
    expect(asked.lines).toContainEqual({ label: "Improve the idea first", value: "Yes" });
    expect(asked.lines[0]).toEqual({ label: "Idea", value: "one of the historical mystery stories, crime" });
    for (const review of [false, undefined]) {
      const c = await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", language: "en", ...(review === undefined ? {} : { review }) }, bare());
      expect(c.lines.some((l) => l.label === "Improve the idea first")).toBe(false);
    }
  });

  it("shows a story whose idea says fiction as a fiction, in any video language: no photographs line, the fiction note", async () => {
    for (const language of ["en", "ckb"]) {
      for (const idea of ["a fictional lighthouse mystery", "fiction: a keeper who vanishes", "قصة خيالية عن منارة", "چیرۆکێکی خەیاڵی دەربارەی فانۆس"]) {
        const c = await cardOf("make_video", { idea, kind: "story", language }, bare());
        expect(c.lines.some((l) => l.label === "Photos")).toBe(false);
        expect(c.lines[0]).toEqual({ label: "Idea", value: idea });
        expect(noteLine(c)).toEqual({ label: "Note", value: CARD.videoStoryFiction.en });
        // A fiction has one length (the short aim is only for a real story).
        expect(c.lines).toContainEqual({ label: "Length", value: dict("en").assistant.done.videoLengthFiction });
      }
    }
    // "Non-fiction" asks for the opposite.
    const real = await cardOf("make_video", { idea: "a non-fiction account of the Hinterkaifeck murders", kind: "story", language: "en" }, bare());
    expect(noteLine(real)).toEqual({ label: "Note", value: CARD.videoStoryReal.en });
  });

  it("decides fiction from the idea as the owner said it, once: the card and the action use the same words", async () => {
    // The card reads the idea the model proposed (the owner's words, no review has run yet); the action reads the same words again at Confirm.
    const idea = "a fictional lighthouse mystery";
    const c = await cardOf("make_video", { idea, kind: "story", language: "en", review: true }, bare());
    expect(noteLine(c)).toEqual({ label: "Note", value: CARD.videoStoryFiction.en });
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await run("make_video", { idea, kind: "story", language: "en", review: true }, bare());
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ topic: idea, kind: "story", review: true });
  });

  it("says the same in the person's language, with no Kurdish-only letter in the Arabic and no Arabic script in the English", async () => {
    for (const lang of UI) {
      const real = await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language: "en" }, bare({ lang }));
      expect(real.lines.find((l) => l.label === NEW.field.note[lang])).toEqual({ label: NEW.field.note[lang], value: CARD.videoStoryReal[lang] });
      const fiction = await cardOf("make_video", { idea: "a fictional lighthouse mystery", kind: "story", language: "en" }, bare({ lang }));
      expect(fiction.lines.find((l) => l.label === NEW.field.note[lang])).toEqual({ label: NEW.field.note[lang], value: CARD.videoStoryFiction[lang] });
      for (const l of [...real.lines, ...fiction.lines]) {
        expect(l.label.trim()).not.toBe("");
        expect(l.value.trim()).not.toBe("");
        if (lang === "ar") expect(KURDISH.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
        if (lang === "en") expect(/[؀-ۿ]/.test(l.label + l.value), `${l.label}: ${l.value}`).toBe(false);
      }
    }
    // The Sorani card spells Wikimedia Commons in Sorani letters, in the note and in the Photos row; the Latin name stays out of the Sorani words.
    expect(CARD.videoStoryReal.ckb).toContain("ویکیمیدیا کۆمۆنز");
    expect(CARD.videoStoryReal.ckb).not.toMatch(/[A-Za-z]{3}/);
    expect(CARD.videoStoryReal.ar).toContain("ويكيميديا كومنز");
    const ckbCard = await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language: "en" }, bare({ lang: "ckb" }));
    expect(ckbCard.lines).toContainEqual({ label: dict("ckb").assistant.fields.storyPhotos, value: "ویکیمیدیا کۆمۆنز" });
    const arCard = await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language: "en" }, bare({ lang: "ar" }));
    expect(arCard.lines).toContainEqual({ label: dict("ar").assistant.fields.storyPhotos, value: "ويكيميديا كومنز" });
  });

  describe("what the owner attached and a story cannot use is said first, on the card", () => {
    const NOT_USED = "Not used";
    const idea = "one of the historical mystery stories, crime";

    it("says an attached video was NOT used, before everything else, and an attached picture too; one line each", async () => {
      const c = await cardOf("make_video", { idea, kind: "story", language: "en", format: "wide" }, ctxOf({ attachments: [vid, img], latestAttachments: ["a3", "a1"] }));
      expect(c.lines[0]).toEqual({ label: NOT_USED, value: "The attached video was NOT used: Gituas cannot learn from a video yet." });
      expect(c.lines[1]).toEqual({ label: NOT_USED, value: "The attached picture was NOT used: Gituas cannot use your pictures in a story yet." });
      expect(c.lines[2]).toEqual({ label: "Idea", value: idea });
      // Only the video: one line.
      const only = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [vid], latestAttachments: ["a3"] }));
      expect(only.lines.filter((l) => l.label === NOT_USED)).toHaveLength(1);
      // The same in the person's language.
      for (const lang of UI) {
        const t = dict(lang).assistant.done;
        const card = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ lang, attachments: [vid], latestAttachments: ["a3"] }));
        expect(card.lines[0]).toEqual({ label: CARD.notUsedLabel[lang], value: t.videoNotUsedVideo });
        if (lang === "ar") expect(KURDISH.test(card.lines[0].label + card.lines[0].value)).toBe(false);
      }
    });

    it("says nothing when nothing is attached, when the only picture is one the chat made itself, and on an ad", async () => {
      const none = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [], latestAttachments: [] }));
      expect(none.lines.some((l) => l.label === NOT_USED)).toBe(false);
      // A picture the chat made is not in the owner's latest message: it is excluded by id, whatever its name says (here a name in another language).
      const made = { ...img, id: "a9", name: dict("ckb").assistant.done.pictureName };
      const mine = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [made], latestAttachments: [] }));
      expect(mine.lines.some((l) => l.label === NOT_USED)).toBe(false);
      const ad = await cardOf("make_video", { idea: "a short ad", kind: "ad" }, ctxOf({ attachments: [vid, img], latestAttachments: ["a3", "a1"] }));
      expect(ad.lines.some((l) => l.label === NOT_USED)).toBe(false);
    });

    it("counts only the files of the owner's LATEST message: an earlier video, or a product photo attached days ago, is not part of this story", async () => {
      // The whole thread holds a video and two pictures; the latest message attached nothing (or only one of them).
      const old = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [vid, img, png], latestAttachments: [] }));
      expect(old.lines.some((l) => l.label === NOT_USED)).toBe(false);
      const one = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [vid, img, png], latestAttachments: ["a2"] }));
      expect(one.lines.filter((l) => l.label === NOT_USED)).toEqual([{ label: NOT_USED, value: dict("en").assistant.done.videoNotUsedPicture }]);
    });

    it("reads the latest message from the thread when the context does not carry it (a run after Confirm), and claims nothing when it cannot be read", async () => {
      // The owner's last message attached the video.
      db.chatMessage.findMany.mockResolvedValue([
        { role: "user", content: "older", seq: 1, meta: { attachments: [{ id: "a1" }] } },
        { role: "assistant", content: "ok", seq: 2, meta: null },
        { role: "user", content: "make the story", seq: 3, meta: { attachments: [{ id: "a3" }] } },
      ]);
      const c = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [vid, img] }));
      expect(c.lines.filter((l) => l.label === NOT_USED)).toEqual([{ label: NOT_USED, value: dict("en").assistant.done.videoNotUsedVideo }]);
      // A thread that cannot be read: no claim at all (never a guess), and the card still comes.
      db.chatMessage.findMany.mockRejectedValue(new Error("db down"));
      const down = await cardOf("make_video", { idea, kind: "story", language: "en" }, ctxOf({ attachments: [vid, img] }));
      expect(down.lines.some((l) => l.label === NOT_USED)).toBe(false);
    });
  });

  describe("the idea is the owner's own words: a country, an era or a year the model added is refused", () => {
    // The real chat: the owner wrote "one of the historical mystery stories, crime" and the idea came back with "Egyptian".
    // The thread's rows as the store returns them, newest first (a fresh copy on every read).
    const owner = (...texts: string[]) =>
      db.chatMessage.findMany.mockImplementation(async () => [...texts].reverse().map((content, i) => ({ role: "user", content, seq: texts.length - i })));

    it("refuses the real log's idea: the owner said 'mystery history', the idea said 'Egyptian'", async () => {
      owner("a video for my YouTube mystery-history channel, one of the historical mystery stories, crime genre, very eye-catching");
      const said = await refusal(cardOf("make_video", { idea: "A historical Egyptian crime mystery, very eye-catching", kind: "story", language: "ckb" }, bare()));
      expect(said).toMatch(/The idea has words the owner did not say: Egypt/);
      expect(said).toMatch(/exactly as they said them/);
      expect(said).toMatch(/Remove them and propose again with the owner's words only/);
      expect(said).toMatch(/Do not ask the owner anything/);
    });

    it("refuses a country, a people, an era and a year the owner never said, and names each one", async () => {
      owner("make a mystery story for my channel");
      const cases: [string, string][] = [
        ["a mystery in ancient Rome", "Rome, ancient times"],
        ["a medieval murder", "the Middle Ages"],
        ["a Victorian poisoning", "the Victorian era"],
        ["an Ottoman palace secret", "the Ottoman era"],
        ["a Greek tragedy of a vanished fleet", "Greece"],
        ["a crime from 1922", "1922"],
        ["a crime from the 1920s", "1920"],
        ["جريمة غامضة في مصر القديمة", "Egypt"],
        ["چیرۆکێکی نهێنی لە میسر", "Egypt"],
        ["مرموزی ڕووداوێک لە ڕۆمای کۆن", "Rome"],
      ];
      for (const [idea, words] of cases) {
        const said = await refusal(cardOf("make_video", { idea, kind: "story", language: "en" }, bare()));
        for (const w of words.split(", ")) expect(said, idea).toContain(w);
      }
    });

    it("allows what the owner said, in any of the three languages, and years the owner wrote, in any digits", async () => {
      owner("جريمة في مصر القديمة، سنة ١٩٢٢");
      expect((await cardOf("make_video", { idea: "An Egyptian crime, 1922", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      owner("a story about the Hinterkaifeck murders, 1922");
      expect((await cardOf("make_video", { idea: "Hinterkaifeck murders 1922", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      owner("چیرۆکێک دەربارەی میسر");
      expect((await cardOf("make_video", { idea: "Egyptian pharaohs mystery", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      // An owner who named the topic a few messages before saying "yes, make it" is still the one who said it.
      owner("mystery stories from ancient Egypt", "yes", "ok, make it");
      expect((await cardOf("make_video", { idea: "an Egyptian mystery", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
    });

    it("does not mistake other words for those: a romance is not Rome, and a plain idea passes", async () => {
      owner("a romantic mystery story");
      expect((await cardOf("make_video", { idea: "A romance and a mystery, told calmly", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      owner("قصة رومانسية غامضة");
      expect((await cardOf("make_video", { idea: "قصة رومانسية غامضة", kind: "story", language: "ar" }, bare())).lines.length).toBeGreaterThan(3);
      owner("one of the historical mystery stories, crime");
      expect((await cardOf("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
    });

    it("judges nothing it cannot read: no thread rows, or a thread that cannot be loaded, lets the card through; an ad is never checked", async () => {
      db.chatMessage.findMany.mockResolvedValue([]);
      expect((await cardOf("make_video", { idea: "An Egyptian crime, 1922", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      db.chatMessage.findMany.mockRejectedValue(new Error("db down"));
      expect((await cardOf("make_video", { idea: "An Egyptian crime, 1922", kind: "story", language: "en" }, bare())).lines.length).toBeGreaterThan(3);
      owner("make a short ad");
      expect((await cardOf("make_video", { idea: "an ad with a Roman theme in 1922", kind: "ad" }, bare())).lines.length).toBeGreaterThan(2);
    });
  });

  describe("the result of a video start, in the owner's language: the facts of the job, and what was not used", () => {
    const idea = "one of the historical mystery stories, crime";
    const facts = { lang: "ckb", kind: "story", format: "wide", photos: "on" } as const;

    it("lists the shape, the language, the photographs and the credits, and that nothing was posted to YouTube, in each language", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts });
      for (const lang of UI) {
        const t = dict(lang).assistant;
        const r = await run("make_video", { idea, kind: "story", format: "wide" }, bare({ lang }));
        const lines = r.text.split("\n").filter((x) => !x.startsWith(t.fields.shop));
        expect(lines, lang).toEqual([
          t.done.videoStarted,
          t.done.videoFormatWide,
          t.done.videoLanguage(t.fields.languages["ckb"]),
          t.done.videoLengthStory,
          t.done.videoCase,
          t.done.videoPhotosOn,
          t.done.videoCredits,
          t.done.videoNotYouTube,
          // No review ran (the mocked action reports none): the result says the idea was used exactly as written.
          t.done.videoUsedAsWritten,
        ]);
        if (lang === "ar") expect(KURDISH.test(r.text), r.text).toBe(false);
        if (lang === "en") expect(/[؀-ۿ]/.test(r.text), r.text).toBe(false);
      }
    });

    it("says the attached video was NOT used as the very first line of the result, in each language", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts });
      for (const lang of UI) {
        const t = dict(lang).assistant.done;
        const r = await run("make_video", { idea, kind: "story", format: "wide" }, ctxOf({ lang, attachments: [vid], latestAttachments: ["a3"] }));
        expect(r.text.split("\n")[0], lang).toBe(t.videoNotUsedVideo);
        // The same file from an earlier message is not part of this request: nothing is said about it.
        const later = await run("make_video", { idea, kind: "story", format: "wide" }, ctxOf({ lang, attachments: [vid], latestAttachments: [] }));
        expect(later.text, lang).not.toContain(t.videoNotUsedVideo);
      }
      expect(dict("en").assistant.done.videoNotUsedVideo).toBe("The attached video was NOT used: Gituas cannot learn from a video yet.");
    });

    it("writes the shape of a vertical story and of an ad as vertical, and carries the Sorani spelling of Wikimedia Commons in Sorani letters", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "story", format: "vertical", photos: "on" } });
      const r = await run("make_video", { idea, kind: "story" }, bare({ lang: "ckb" }));
      expect(r.text).toContain(dict("ckb").assistant.done.videoFormatVertical);
      expect(r.text).toContain("ویکیمیدیا کۆمۆنز");
      expect(r.text).not.toContain("Wikimedia");
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "ad", format: "vertical" } });
      const ad = await run("make_video", { idea: "a short ad", kind: "ad" }, bare());
      expect(ad.text.split("\n").filter((x) => !x.startsWith("Accounts"))).toEqual([dict("en").assistant.done.videoStarted, "Format: vertical 9:16.", "Language: English.", "Length: about 35 seconds; an ad's length is fixed."]);
    });
  });

  it("passes the shape on only when it is vertical or wide", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await run("make_video", { idea: "one of the historical mystery stories, crime", kind: "story", format: "wide" }, bare());
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ kind: "story", format: "wide" });
    await run("make_video", { idea: "one of the historical mystery stories, crime", kind: "story" }, bare());
    expect("format" in vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toBe(false);
    expect(() => parse("make_video", { idea: "one of the historical mystery stories, crime", format: "square" })).toThrow();
    const props = (toolSpecs([tool("make_video")])[0].function.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain("format");
  });

  it("follows what the page is for when the model gave no kind, and the model's kind when it did", async () => {
    vi.stubEnv("BUSINESS_PROFILE_ENABLED", "1");
    db.businessProfile.findUnique.mockResolvedValue(profileOf("monetize"));
    expect(kindRow(await cardOf("make_video", { idea: "a mystery about a missing letter" }))).toEqual({ label: "Kind", value: "Story" });
    expect(kindRow(await cardOf("make_video", { idea: "a short ad about the new ring", kind: "ad" }))).toBeUndefined();
    db.businessProfile.findUnique.mockResolvedValue(profileOf("sell"));
    expect(kindRow(await cardOf("make_video", { idea: "a short ad" }))).toBeUndefined();
    expect(kindRow(await cardOf("make_video", { idea: "a mystery about a missing letter", kind: "story" }))).toEqual({ label: "Kind", value: "Story" });
    // A profile that cannot be read is an ad.
    db.businessProfile.findUnique.mockRejectedValue(new Error("down"));
    expect(kindRow(await cardOf("make_video", { idea: "a short ad" }))).toBeUndefined();
  });

  it("makes a video of a named product an ad, whatever the page is for, unless the kind says otherwise", async () => {
    vi.stubEnv("BUSINESS_PROFILE_ENABLED", "1");
    db.businessProfile.findUnique.mockResolvedValue(profileOf("monetize"));
    const ad = await cardOf("make_video", { idea: "a short ad about the ring", product: "silver ring" });
    expect(kindRow(ad)).toBeUndefined();
    expect(ad.lines).toContainEqual({ label: "Product", value: "Silver ring" });
    expect(ad.lines.some((l) => l.label === "Note")).toBe(false);
    // The older goal "grow" reads the same way; with no product the page decides, as before.
    db.businessProfile.findUnique.mockResolvedValue(profileOf("grow"));
    expect(kindRow(await cardOf("make_video", { idea: "a short ad about the ring", product: "silver ring" }))).toBeUndefined();
    expect(kindRow(await cardOf("make_video", { idea: "a mystery about a missing letter" }))).toEqual({ label: "Kind", value: "Story" });
    // An explicit kind wins over the product.
    const story = await cardOf("make_video", { idea: "a mystery about a missing letter", product: "silver ring", kind: "story" });
    expect(kindRow(story)).toEqual({ label: "Kind", value: "Story" });
    expect(story.lines.some((l) => l.label === "Product")).toBe(false);
  });

  it("refuses a story with no idea to go on (fewer than four characters), tells the model not to ask the owner for a case, and takes a short word", async () => {
    const said = await refusal(cardOf("make_video", { idea: "abc", kind: "story" }));
    expect(said).toMatch(/story/);
    expect(said).toMatch(/Do not ask them to name a case: Gituas chooses a real one when none is named/);
    expect((await cardOf("make_video", { idea: "abc", kind: "ad" })).lines.length).toBeGreaterThan(0);
    // A word is enough for a story: the system finds or chooses the case.
    expect((await cardOf("make_video", { idea: "Titanic", kind: "story", language: "en" })).lines.length).toBeGreaterThan(0);
    expect((await cardOf("make_video", { idea: "tell it", kind: "story" })).lines.length).toBeGreaterThan(0);
  });

  it("passes the language and kind on only when the model gave them", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await run("make_video", { idea: "a short ad" });
    const plain = vi.mocked(createVideoAction).mock.calls[0][1];
    expect("lang" in plain || "kind" in plain).toBe(false);
    expect(plain.voice).toBe("shilan");
    await run("make_video", { idea: "a mystery about a missing letter", language: "en", kind: "story" });
    expect(vi.mocked(createVideoAction).mock.calls[1][1]).toMatchObject({ topic: "a mystery about a missing letter", lang: "en", kind: "story", voice: "shilan" });
  });

  it("passes the photo switch on only when the model gave a true or false", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await run("make_video", { idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", photos: false });
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ topic: "Hinterkaifeck murders 1922", lang: "en", kind: "story", photos: false });
    await run("make_video", { idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", photos: true });
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ photos: true });
    await run("make_video", { idea: "Hinterkaifeck murders 1922", language: "en", kind: "story" });
    expect("photos" in vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toBe(false);
    // Anything but a true or false is no call at all.
    expect(() => parse("make_video", { idea: "Hinterkaifeck murders 1922", photos: "off" })).toThrow();
  });

  it("a story's review is what the owner said in words (review true or false), else the chat's own switch; an ad keeps the chat's switch", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const idea = "one of the historical mystery stories, crime";
    const last = () => vi.mocked(createVideoAction).mock.calls.at(-1)![1];
    // The chat's switch is OFF and the model said nothing: the idea goes straight to the video maker (the story is literal).
    await run("make_video", { idea, language: "en", kind: "story" }, ctxOf({ review: false }));
    expect(last()).toMatchObject({ kind: "story", topic: idea, review: false });
    // The switch is ON and the model said nothing: the switch decides (args.review ?? ctx.review).
    await run("make_video", { idea, language: "en", kind: "story" });
    expect(last()).toMatchObject({ kind: "story", topic: idea, review: true });
    // What the owner said in words wins over the switch, in both directions.
    await run("make_video", { idea, language: "en", kind: "story", review: false });
    expect(last()).toMatchObject({ review: false });
    await run("make_video", { idea, language: "en", kind: "story", review: true }, ctxOf({ review: false }));
    expect(last()).toMatchObject({ kind: "story", review: true });
    // The page decides the kind when the model gave none: a content page makes a story, which follows the same rule.
    vi.stubEnv("BUSINESS_PROFILE_ENABLED", "1");
    db.businessProfile.findUnique.mockResolvedValue(profileOf("monetize"));
    await run("make_video", { idea }, ctxOf({ review: false }));
    expect(last()).toMatchObject({ review: false });
    await run("make_video", { idea });
    expect(last()).toMatchObject({ review: true });
    // An ad is reviewed as the chat's switch says (the owner's review of ideas in general), as before.
    await run("make_video", { idea: "a short ad", kind: "ad" });
    expect(last()).toMatchObject({ review: true });
    await run("make_video", { idea: "a short ad", kind: "ad" }, ctxOf({ review: false }));
    expect(last()).toMatchObject({ review: false });
    // Anything but a true or false is no call at all.
    expect(() => parse("make_video", { idea, review: "yes" })).toThrow();
    expect(() => parse("make_video", { idea, review: "true" })).toThrow();
  });

  it("tells the owner what the review changed, after the video starts", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", reviewed: { text: "a clearer brief", summary: "added the page's angle" } });
    const r = await run("make_video", { idea: "one of the historical mystery stories, crime", language: "en", kind: "story", review: true });
    expect(r).toMatchObject({ ok: true, jobId: "job1" });
    expect((r as { text: string }).text).toContain("Reviewed: added the page's angle");
  });

  it("saves the daily video's language only when it was given, and shows it only then", async () => {
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await run("set_daily_video", { mode: "OFF", language: "en" });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "OFF", tier: "LITE", hour: 21, lang: "en" });
    await run("set_daily_video", { mode: "DRAFT" });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "DRAFT", tier: "LITE", hour: 21 });
    expect(languageOf(await cardOf("set_daily_video", { mode: "OFF", language: "ar" }))).toBe("Arabic");
    expect(languageOf(await cardOf("set_daily_video", { mode: "DRAFT" }))).toBeUndefined();
  });

  it("changes only the language of the daily video when no mode is given: no mode on the card, none saved, and a small risk", async () => {
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    const card = await cardOf("set_daily_video", { language: "en" });
    expect(languageOf(card)).toBe("English");
    expect(card.lines.some((l) => l.label === "Mode")).toBe(false);
    await run("set_daily_video", { language: "en" });
    const sent = vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1];
    expect(sent).toEqual({ tier: "LITE", hour: 21, lang: "en" });
    expect("mode" in sent).toBe(false);
    expect(riskOf(tool("set_daily_video"), { language: "en" })).toBe("standing");
    expect(riskOf(tool("set_daily_video"), { hour: 8 })).toBe("low");
    // Nothing to change is no call at all.
    expect(() => parse("set_daily_video", {})).toThrow();
  });

  it("keeps the risk of the daily video as it was: only OFF is small, with or without a language", () => {
    expect(riskOf(tool("set_daily_video"), { mode: "OFF", language: "en" })).toBe("low");
    expect(riskOf(tool("set_daily_video"), { mode: "DRAFT", language: "en" })).toBe("standing");
    expect(riskOf(tool("make_video"), { idea: "a short ad", language: "en", kind: "story" })).toBe("money");
  });
});
