import { beforeEach, describe, expect, it, vi } from "vitest";

// The read-back of the shop's changes. The database is replaced; what is tested is the part that is ours: each check compares the
// stored data with the arguments, says a problem only on a clear mismatch (a row is missing, a value differs), says nothing when it
// cannot tell, never looks outside the workspace (tenantId), uses at most three queries, and speaks all three languages.

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  tenant: { findUnique: vi.fn() },
  product: { findMany: vi.fn() },
  order: { findFirst: vi.fn() },
  scheduledPost: { findMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { findMany: vi.fn(), findFirst: vi.fn() },
  conversationMessage: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: (raw: unknown) => raw, runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn() }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import type { ToolCtx, VerifyReport } from "@/lib/chat/types";
import { parseVerify } from "@/lib/chat/verify/report";
import { SHOP_VERIFIERS } from "@/lib/chat/verify/shop";
import { en } from "@/lib/i18n/en";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});
const PID = `c${"a".repeat(24)}`;
const SID = `c${"s".repeat(24)}`;
const run = (tool: string, args: unknown, c = ctx()): Promise<VerifyReport | null> => SHOP_VERIFIERS[tool](c, args, { text: "done", runId: "run1" });
const all = (r: VerifyReport | null) => [...(r?.checked ?? []), ...(r?.problems ?? [])].join("\n");
const queries = () => Object.values(db).flatMap((m) => Object.values(m)).reduce((n, f) => n + f.mock.calls.length, 0);
/** The where clause of the last call to a query. */
const whereOf = (f: { mock: { calls: unknown[][] } }) => (f.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
const ago = (ms: number) => new Date(Date.now() - ms);
const MIN = 60_000;

beforeEach(() => {
  vi.resetAllMocks();
  db.store.findMany.mockResolvedValue([]);
  db.tenant.findUnique.mockResolvedValue(null);
  db.product.findMany.mockResolvedValue([]);
  db.order.findFirst.mockResolvedValue(null);
  db.scheduledPost.findMany.mockResolvedValue([]);
  db.scheduledPost.findFirst.mockResolvedValue(null);
  db.auditLog.findMany.mockResolvedValue([]);
  db.auditLog.findFirst.mockResolvedValue(null);
  db.conversationMessage.findFirst.mockResolvedValue(null);
});

const TOOLS = [
  "post_now", "schedule_post", "set_auto_replies", "set_autopilot", "set_daily_video", "set_shop_options", "add_product", "archive_product",
  "set_whatsapp_number", "set_order_status", "cancel_scheduled_post", "update_product",
];

describe("the shop's checks", () => {
  it("has one check for every tool that can be read back, and none for the ones that cannot", () => {
    expect(Object.keys(SHOP_VERIFIERS).sort()).toEqual([...TOOLS].sort());
    expect(SHOP_VERIFIERS.make_picture).toBeUndefined();
    expect(SHOP_VERIFIERS.make_video).toBeUndefined();
  });

  it("has no check for hiding a comment, replying to one or sending a message: the only record is the one the action writes itself", async () => {
    for (const tool of ["hide_comment", "reply_to_comment", "send_message"]) expect(SHOP_VERIFIERS[tool]).toBeUndefined();
  });

  it("says nothing when the arguments are not what a tool takes", async () => {
    for (const tool of TOOLS) {
      for (const args of [null, undefined, "x", 5, [], {}]) expect(await run(tool, args)).toBeNull();
    }
    expect(queries()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Settings

const store = (over: Record<string, unknown> = {}) => ({
  id: "s1", updatedAt: ago(1_000), automationEnabled: false, autoMode: "OFF", autoPerDay: 1, videoAutoMode: "OFF", videoAutoHour: 18,
  plan: "MERCHANT", pausedReason: null, fbPageId: "fb1", igUserId: "ig1",
  likeComments: true, autoHideSpam: false, aiReplies: false, expiryDays: 30, defaultDm: null, deliveryFeeMinor: null, deliveryTime: null, aiBrief: null, ...over,
});

describe("set_auto_replies", () => {
  it("is ok when the shop holds the asked value, and reads only this workspace's shops", async () => {
    db.store.findMany.mockResolvedValue([store({ automationEnabled: true })]);
    const r = await run("set_auto_replies", { on: true });
    expect(r).toMatchObject({ status: "ok", problems: [] });
    expect(all(r)).toBe("Automatic replies: on");
    expect(whereOf(db.store.findMany)).toMatchObject({ tenantId: "t1" });
    expect(queries()).toBe(1);
  });

  it("is a problem when the value differs, and says how to put it right", async () => {
    db.store.findMany.mockResolvedValue([store({ automationEnabled: false })]);
    const r = await run("set_auto_replies", { on: true });
    expect(r?.status).toBe("problem");
    expect(r?.problems[0]).toBe("Automatic replies: off, not on as you asked.");
    expect(r?.fix).toBe("Call set_auto_replies with on=true.");
    const off = await run("set_auto_replies", { on: false }, ctx());
    expect(off?.status).toBe("ok");
  });

  it("says nothing without a shop, or with several shops and no way to tell which one was saved", async () => {
    expect(await run("set_auto_replies", { on: true })).toBeNull();
    db.store.findMany.mockResolvedValue([store({ id: "a", updatedAt: ago(2 * MIN) }), store({ id: "b", updatedAt: ago(2 * MIN) })]);
    expect(await run("set_auto_replies", { on: true })).toBeNull();
    db.store.findMany.mockResolvedValue([store({ id: "a", updatedAt: ago(60 * MIN) }), store({ id: "b", updatedAt: ago(60 * MIN) })]);
    expect(await run("set_auto_replies", { on: true })).toBeNull();
  });

  it("with several shops reads the one that was saved a moment ago", async () => {
    db.store.findMany.mockResolvedValue([store({ id: "a", updatedAt: ago(90 * MIN), automationEnabled: false }), store({ id: "b", updatedAt: ago(1_000), automationEnabled: true })]);
    expect((await run("set_auto_replies", { on: true }))?.status).toBe("ok");
    expect((await run("set_auto_replies", { on: false }))?.status).toBe("problem");
  });
});

describe("set_autopilot and set_daily_video", () => {
  it("compares the mode and the posts per day", async () => {
    db.store.findMany.mockResolvedValue([store({ autoMode: "PUBLISH", autoPerDay: 2 })]);
    const ok = await run("set_autopilot", { mode: "PUBLISH", perDay: 2 });
    expect(ok?.status).toBe("ok");
    expect(ok?.checked).toEqual(["Automatic posts: publishing by itself", "Posts per day: 2"]);
    const bad = await run("set_autopilot", { mode: "DRAFT", perDay: 3 });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems).toEqual(["Automatic posts: publishing by itself, not preparing posts for review as you asked.", "Posts per day: 2, not 3 as you asked."]);
    expect(bad?.fix).toBe("Call set_autopilot with mode=DRAFT and perDay=3.");
  });

  it("leaves out the posts per day when it was not asked", async () => {
    db.store.findMany.mockResolvedValue([store({ autoMode: "OFF", autoPerDay: 3 })]);
    const r = await run("set_autopilot", { mode: "OFF" });
    expect(r?.checked).toEqual(["Automatic posts: off"]);
  });

  it("checks the daily video's mode and hour", async () => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "DRAFT", videoAutoHour: 20 })]);
    expect((await run("set_daily_video", { mode: "DRAFT", hour: 20 }))?.status).toBe("ok");
    const bad = await run("set_daily_video", { mode: "DRAFT", hour: 9 });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems).toEqual(["Hour of the daily video: 20, not 9 as you asked."]);
    expect(bad?.fix).toBe("Call set_daily_video with hour=9.");
    expect((await run("set_daily_video", { mode: "DRAFT" }))?.checked).toEqual(["The daily video: making the video for review"]);
  });

  it("checks the video language only when it was asked, and says how to put it right", async () => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "OFF", videoLang: "en" })]);
    const ok = await run("set_daily_video", { mode: "OFF", language: "en" });
    expect(ok?.status).toBe("ok");
    expect(ok?.checked).toEqual(["The daily video: off", "The video language: English"]);
    const bad = await run("set_daily_video", { mode: "OFF", language: "ar" });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems).toEqual(["The video language: English, not Arabic as you asked."]);
    expect(bad?.fix).toBe("Call set_daily_video with language=ar.");
    // Left out, the saved language stays and is not compared; so is something that is not a language.
    expect((await run("set_daily_video", { mode: "OFF" }))?.checked).toEqual(["The daily video: off"]);
    expect((await run("set_daily_video", { mode: "OFF", language: "fr" }))?.checked).toEqual(["The daily video: off"]);
    // A shop with no saved language makes its videos in Sorani.
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "OFF" })]);
    expect((await run("set_daily_video", { mode: "OFF", language: "ckb" }))?.status).toBe("ok");
    expect((await run("set_daily_video", { mode: "OFF", language: "en" }))?.problems).toEqual(["The video language: Sorani Kurdish, not English as you asked."]);
    // The mode and the language are read back together.
    const both = await run("set_daily_video", { mode: "DRAFT", language: "ar" });
    expect(both?.fix).toBe("Call set_daily_video with mode=DRAFT and language=ar.");
  });

  it("reads back a change of only the language or the hour (no mode): the mode is not compared, whatever the daily video is doing", async () => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH", videoAutoHour: 20, videoLang: "en" })]);
    const language = await run("set_daily_video", { language: "en" });
    expect(language).toMatchObject({ status: "ok", checked: ["The video language: English"] });
    const bad = await run("set_daily_video", { language: "ar" });
    expect(bad?.problems).toEqual(["The video language: English, not Arabic as you asked."]);
    expect(bad?.fix).toBe("Call set_daily_video with language=ar.");
    expect(all(bad)).not.toMatch(/daily video:/i);
    const hour = await run("set_daily_video", { hour: 20 });
    expect(hour).toMatchObject({ status: "ok", checked: ["Hour of the daily video: 20"] });
    // Nothing that can be compared (not a language, no hour): nothing is read.
    const before = queries();
    expect(await run("set_daily_video", { language: "fr" })).toBeNull();
    expect(queries()).toBe(before);
  });

  it("names the video language in Arabic and Sorani, with no Kurdish-only letter in the Arabic", async () => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "OFF", videoLang: "en" })]);
    const arabic = await run("set_daily_video", { mode: "OFF", language: "ckb" }, ctx({ lang: "ar" }));
    expect(arabic?.problems).toEqual(["لغة الفيديو: الإنجليزية، وليس الكردية السورانية كما طلبت."]);
    expect(/[کیەێۆڕڵڤپچژگ]/.test(all(arabic))).toBe(false);
    const sorani = await run("set_daily_video", { mode: "OFF", language: "ckb" }, ctx({ lang: "ckb" }));
    expect(sorani?.problems).toEqual(["زمانی ڤیدیۆ: ئینگلیزی، نەک کوردی سۆرانی وەک داوات کردبوو."]);
    expect(/[؀-ۿ]/.test(all(await run("set_daily_video", { mode: "OFF", language: "ar" }, ctx({ lang: "en" }))))).toBe(false);
  });

  it("reads the video language in the same single query as the rest", async () => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "OFF" })]);
    await run("set_daily_video", { mode: "OFF", language: "en" });
    expect(queries()).toBe(1);
    expect((db.store.findMany.mock.calls[0][0] as { select: Record<string, boolean> }).select.videoLang).toBe(true);
  });

  it("says nothing for a mode the app does not have", async () => {
    db.store.findMany.mockResolvedValue([store()]);
    expect(await run("set_autopilot", { mode: "constructor" })).toBeNull();
    expect(await run("set_daily_video", { mode: "ALWAYS" })).toBeNull();
  });

  it("words the modes as noun phrases, so the mismatch sentence is grammatical in every language", async () => {
    db.store.findMany.mockResolvedValue([store({ autoMode: "DRAFT", videoAutoMode: "PUBLISH" })]);
    const post = await run("set_autopilot", { mode: "PUBLISH" }, ctx({ lang: "ar" }));
    expect(post?.problems).toEqual(["المنشورات التلقائية: تحضير المنشورات للمراجعة، وليس النشر التلقائي كما طلبت."]);
    const video = await run("set_daily_video", { mode: "DRAFT" }, ctx({ lang: "en" }));
    expect(video?.problems).toEqual(["The daily video: making the video and publishing it by itself, not making the video for review as you asked."]);
    expect((await run("set_daily_video", { mode: "DRAFT" }, ctx({ lang: "ar" })))?.problems).toEqual([
      "الفيديو اليومي: إنتاج الفيديو ونشره تلقائياً، وليس إنتاج الفيديو للمراجعة كما طلبت.",
    ]);
  });

  it("shows the counts in Arabic-Indic digits in Sorani and Arabic, as the money is, and in Latin digits in English", async () => {
    db.store.findMany.mockResolvedValue([store({ autoMode: "DRAFT", autoPerDay: 2, videoAutoMode: "DRAFT", videoAutoHour: 20 })]);
    const indic = new RegExp(`[${String.fromCodePoint(0x660)}-${String.fromCodePoint(0x669)}]`);
    const ckbPost = await run("set_autopilot", { mode: "DRAFT", perDay: 3 }, ctx({ lang: "ckb" }));
    expect(ckbPost?.problems[0]).toMatch(indic);
    expect(ckbPost?.problems[0]).not.toMatch(/[0-9]/);
    expect((await run("set_autopilot", { mode: "DRAFT", perDay: 2 }, ctx({ lang: "ar" })))?.checked[1]).toMatch(indic);
    const hour = await run("set_daily_video", { mode: "DRAFT", hour: 9 }, ctx({ lang: "ar" }));
    expect(hour?.problems[0]).toMatch(indic);
    expect(hour?.problems[0]).not.toMatch(/[0-9]/);
    expect((await run("set_daily_video", { mode: "DRAFT", hour: 9 }))?.problems[0]).toBe("Hour of the daily video: 20, not 9 as you asked.");
  });

  describe("a mode that is saved but that the engine will not carry out", () => {
    const FREE = store({ plan: "FREE", autoMode: "PUBLISH", videoAutoMode: "PUBLISH" });

    it("is a problem for publishing by itself on the free plan, and tells the model to talk to the person, not to run the tool again", async () => {
      db.store.findMany.mockResolvedValue([FREE]);
      const r = await run("set_autopilot", { mode: "PUBLISH" });
      expect(r?.status).toBe("problem");
      expect(r?.problems).toEqual(["Saved, but on the free plan the posts are only prepared for review; publishing by itself needs a paid plan."]);
      expect(r?.checked).toEqual([]);
      expect(r?.fix).toContain("Do not call set_autopilot with PUBLISH again");
      expect(r?.fix).toContain("Tell the person");
      expect(r?.fix).toContain("mode=DRAFT");
      expect(r?.fix).not.toMatch(/with \./);
      expect(queries()).toBe(1);
    });

    it("keeps the posts per day as its own line", async () => {
      db.store.findMany.mockResolvedValue([{ ...FREE, autoPerDay: 2 }]);
      const r = await run("set_autopilot", { mode: "PUBLISH", perDay: 2 });
      expect(r?.status).toBe("problem");
      expect(r?.checked).toEqual(["Posts per day: 2"]);
      expect(r?.problems).toHaveLength(1);
      const wrong = await run("set_autopilot", { mode: "PUBLISH", perDay: 3 });
      expect(wrong?.problems).toHaveLength(2);
      expect(wrong?.fix).toContain("Call set_autopilot with perDay=3.");
      expect(wrong?.fix).toContain("Tell the person");
    });

    it("does not warn about preparing posts on the free plan, nor about a paid plan with a page connected", async () => {
      db.store.findMany.mockResolvedValue([{ ...FREE, autoMode: "DRAFT" }]);
      expect(await run("set_autopilot", { mode: "DRAFT" })).toMatchObject({ status: "ok", checked: ["Automatic posts: preparing posts for review"] });
      db.store.findMany.mockResolvedValue([store({ plan: "UNLIMITED", autoMode: "PUBLISH", fbPageId: null })]);
      expect((await run("set_autopilot", { mode: "PUBLISH" }))?.status).toBe("ok");
      db.store.findMany.mockResolvedValue([store({ plan: "PRO", autoMode: "PUBLISH", fbPageId: null, igUserId: "ig1" })]);
      expect((await run("set_autopilot", { mode: "PUBLISH" }))?.status).toBe("ok");
    });

    it("is a problem when the shop is paused, for preparing posts as well as for publishing", async () => {
      for (const mode of ["DRAFT", "PUBLISH"]) {
        db.store.findMany.mockResolvedValue([store({ pausedReason: "token", autoMode: mode })]);
        const r = await run("set_autopilot", { mode });
        expect(r?.status).toBe("problem");
        expect(r?.problems).toEqual(["Saved, but the page's access has expired, so no posts are prepared until the page is connected again."]);
        expect(r?.fix).toContain("Do not call the tool again");
        expect(r?.fix).toContain("connect the page again");
      }
    });

    it("is a problem when nothing is connected to publish to", async () => {
      db.store.findMany.mockResolvedValue([store({ autoMode: "PUBLISH", fbPageId: null, igUserId: null })]);
      const r = await run("set_autopilot", { mode: "PUBLISH" });
      expect(r?.problems).toEqual(["Saved, but no Facebook or Instagram page is connected, so the posts are only prepared and do not go out by themselves."]);
      expect(r?.fix).toContain("connect a page first");
      db.store.findMany.mockResolvedValue([store({ autoMode: "DRAFT", fbPageId: null, igUserId: null })]);
      expect((await run("set_autopilot", { mode: "DRAFT" }))?.status).toBe("ok");
    });

    it("says only the mismatch when the stored mode is not the asked one", async () => {
      db.store.findMany.mockResolvedValue([{ ...FREE, autoMode: "OFF" }]);
      const r = await run("set_autopilot", { mode: "PUBLISH" });
      expect(r?.problems).toEqual(["Automatic posts: off, not publishing by itself as you asked."]);
      expect(r?.fix).toBe("Call set_autopilot with mode=PUBLISH.");
    });

    it("says nothing extra when the automation is switched off", async () => {
      db.store.findMany.mockResolvedValue([store({ plan: "FREE", pausedReason: "token", autoMode: "OFF" })]);
      expect(await run("set_autopilot", { mode: "OFF" })).toMatchObject({ status: "ok", checked: ["Automatic posts: off"] });
      db.store.findMany.mockResolvedValue([store({ plan: "FREE", pausedReason: "token", videoAutoMode: "OFF" })]);
      expect(await run("set_daily_video", { mode: "OFF" })).toMatchObject({ status: "ok", checked: ["The daily video: off"] });
    });

    it("is a problem for a daily video on the free plan, in either mode, since none is ever made", async () => {
      for (const mode of ["DRAFT", "PUBLISH"]) {
        db.store.findMany.mockResolvedValue([store({ plan: "FREE", videoAutoMode: mode })]);
        const r = await run("set_daily_video", { mode });
        expect(r?.status).toBe("problem");
        expect(r?.problems).toEqual(["Saved, but the free plan has no daily video, so no video is made until a paid plan is active."]);
        expect(r?.fix).toContain("Do not call set_daily_video again");
        expect(r?.fix).toContain("Tell the person");
        expect(r?.fix).not.toMatch(/with \./);
      }
    });

    it("is a problem for a daily video of a paused shop, and for publishing the video with nothing connected", async () => {
      db.store.findMany.mockResolvedValue([store({ pausedReason: "token", videoAutoMode: "DRAFT" })]);
      expect((await run("set_daily_video", { mode: "DRAFT" }))?.problems).toEqual(["Saved, but the page's access has expired, so no video is made until the page is connected again."]);
      db.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH", fbPageId: null, igUserId: null })]);
      const r = await run("set_daily_video", { mode: "PUBLISH" });
      expect(r?.problems).toEqual(["Saved, but no Facebook or Instagram page is connected, so the video is made but not posted."]);
      expect(r?.fix).toContain("mode=DRAFT");
      db.store.findMany.mockResolvedValue([store({ videoAutoMode: "DRAFT", fbPageId: null, igUserId: null })]);
      expect((await run("set_daily_video", { mode: "DRAFT" }))?.status).toBe("ok");
    });

    it("keeps the hour as its own line next to the video note", async () => {
      db.store.findMany.mockResolvedValue([store({ plan: "FREE", videoAutoMode: "DRAFT", videoAutoHour: 20 })]);
      const r = await run("set_daily_video", { mode: "DRAFT", hour: 20 });
      expect(r?.checked).toEqual(["Hour of the daily video: 20"]);
      expect(r?.problems).toHaveLength(1);
    });

    it("writes the plain sentence in the person's language", async () => {
      db.store.findMany.mockResolvedValue([FREE]);
      expect((await run("set_autopilot", { mode: "PUBLISH" }, ctx({ lang: "ar" })))?.problems[0]).toBe(
        "تم الحفظ، لكن في الباقة المجانية تُحضَّر المنشورات للمراجعة فقط؛ النشر التلقائي يحتاج إلى باقة مدفوعة.",
      );
      expect((await run("set_autopilot", { mode: "PUBLISH" }, ctx({ lang: "ckb" })))?.problems[0]).toContain("پلانی بەخۆڕایی");
    });
  });
});

describe("set_shop_options", () => {
  it("compares only the fields that were given", async () => {
    db.store.findMany.mockResolvedValue([store({ aiReplies: true, expiryDays: 14, deliveryTime: "1-2 days", deliveryFeeMinor: 5000, defaultDm: "Hello, thanks for writing" })]);
    const r = await run("set_shop_options", { aiReplies: true, expiryDays: 14, deliveryTime: " 1-2 days ", deliveryFee: "5,000", defaultDm: "Hello, thanks for writing" });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual([
      "Smart AI replies: on",
      "Days a post keeps getting replies: 14",
      "The default private message: Hello, thanks for writing",
      "The delivery time: 1-2 days",
      "The delivery fee: 5,000 IQD",
    ]);
  });

  it("finds each value that differs", async () => {
    db.store.findMany.mockResolvedValue([store({ likeComments: true, expiryDays: 30, deliveryFeeMinor: 3000, deliveryTime: "same day" })]);
    const r = await run("set_shop_options", { likeComments: false, expiryDays: 10, deliveryFee: "5000", deliveryTime: "1-2 days" });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual([
      "Liking comments: on, not off as you asked.",
      "Days a post keeps getting replies: 30, not 10 as you asked.",
      "The delivery time: same day, not 1-2 days as you asked.",
      "The delivery fee: 3,000 IQD, not 5,000 IQD as you asked.",
    ]);
    expect(r?.fix).toContain("Call set_shop_options with likeComments=false, expiryDays=10");
    expect((r?.fix ?? "").length).toBeLessThanOrEqual(300);
  });

  it("checks a cleared text or fee", async () => {
    db.store.findMany.mockResolvedValue([store({ defaultDm: null, deliveryFeeMinor: null })]);
    const ok = await run("set_shop_options", { defaultDm: "", deliveryFee: "" });
    expect(ok?.checked).toEqual(["The default private message: empty", "The delivery fee: none"]);
    db.store.findMany.mockResolvedValue([store({ defaultDm: "Old text", deliveryFeeMinor: 2000 })]);
    const bad = await run("set_shop_options", { defaultDm: "", deliveryFee: "" });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems).toEqual(["The default private message: Old text, not empty as you asked.", "The delivery fee: 2,000 IQD, not none as you asked."]);
  });

  it("compares a text the way the app stores it (cut to its length) and shows at most 40 characters of it", async () => {
    const long = "x".repeat(70);
    db.store.findMany.mockResolvedValue([store({ deliveryTime: "x".repeat(60) })]);
    const r = await run("set_shop_options", { deliveryTime: long });
    expect(r?.status).toBe("ok");
    expect(r?.checked[0]).toBe(`The delivery time: ${"x".repeat(40)}…`);
  });

  it("never puts a cut text into the fix: a short text is written whole, a long one only as its field", async () => {
    const brief = `${"The shop sells shoes and bags. ".repeat(20)}End.`;
    db.store.findMany.mockResolvedValue([store({ aiBrief: "old brief", deliveryTime: "same day" })]);
    const r = await run("set_shop_options", { aiBrief: brief, deliveryTime: "1-2 days" });
    expect(r?.status).toBe("problem");
    expect(r?.fix).toContain('deliveryTime="1-2 days"');
    expect(r?.fix).toContain("aiBrief (the person's exact full text");
    expect(r?.fix).not.toContain("…");
    expect(r?.fix).not.toContain("aiBrief=");
    expect(r?.fix).not.toContain("The shop sells");
    expect(r?.fix).toMatch(/\.$/);
    // The line for the person may still show the first characters; only the fix is whole.
    expect(r?.problems[1]).toContain("…");
  });

  it("writes a text of exactly the longest size whole, and a text with line breaks or doubled spaces as its field", async () => {
    const edge = "y".repeat(60);
    db.store.findMany.mockResolvedValue([store({ defaultDm: "old" })]);
    expect((await run("set_shop_options", { defaultDm: edge }))?.fix).toBe(`Call set_shop_options with defaultDm="${edge}".`);
    expect((await run("set_shop_options", { defaultDm: `${edge}y` }))?.fix).toContain("defaultDm (the person's exact full text");
    const lines = await run("set_shop_options", { defaultDm: "Hello\nthere" });
    expect(lines?.fix).toContain("defaultDm (the person's exact full text");
    expect(lines?.fix).not.toContain("Hello");
    expect((await run("set_shop_options", { defaultDm: "Hello  there" }))?.fix).toContain("defaultDm (the person's exact full text");
  });

  it("keeps the fix whole and uncut even when all three texts differ", async () => {
    const long = "z".repeat(300);
    db.store.findMany.mockResolvedValue([store({ defaultDm: "a", deliveryTime: "b", aiBrief: "c" })]);
    const r = await run("set_shop_options", { defaultDm: long, deliveryTime: long, aiBrief: long });
    expect(r?.problems).toHaveLength(3);
    expect(r?.fix).not.toContain("…");
    // The delivery time is stored at 60 characters at most, so it fits whole.
    expect(r?.fix).toContain(`deliveryTime="${"z".repeat(60)}"`);
    for (const k of ["defaultDm", "aiBrief"]) expect(r?.fix).toContain(`${k} (the person's exact full text`);
    expect((r?.fix ?? "").length).toBeLessThanOrEqual(299);
  });

  it("shows the days in Arabic-Indic digits in Sorani", async () => {
    db.store.findMany.mockResolvedValue([store({ expiryDays: 30 })]);
    const r = await run("set_shop_options", { expiryDays: 10 }, ctx({ lang: "ckb" }));
    expect(r?.problems[0]).toMatch(new RegExp(`[${String.fromCodePoint(0x660)}-${String.fromCodePoint(0x669)}]`));
    expect(r?.problems[0]).not.toMatch(/[0-9]/);
  });

  it("says nothing about a fee it cannot read", async () => {
    db.store.findMany.mockResolvedValue([store()]);
    expect(await run("set_shop_options", { deliveryFee: "5.5" })).toBeNull();
  });
});

describe("set_whatsapp_number", () => {
  it("compares the saved number with the asked one in the form the app saves", async () => {
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647701234567" });
    const r = await run("set_whatsapp_number", { number: "0770 123 4567" });
    expect(r).toMatchObject({ status: "ok", checked: ["The WhatsApp number: +9647701234567"] });
    expect(db.tenant.findUnique.mock.calls[0][0].where).toEqual({ id: "t1" });
  });

  it("is a problem when another number or none is saved", async () => {
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647709999999" });
    const r = await run("set_whatsapp_number", { number: "07701234567" });
    expect(r?.problems).toEqual(["The WhatsApp number: +9647709999999, not +9647701234567 as you asked."]);
    expect(r?.fix).toBe('Call set_whatsapp_number with number="9647701234567".');
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: null });
    expect((await run("set_whatsapp_number", { number: "07701234567" }))?.problems[0]).toBe("The WhatsApp number: none, not +9647701234567 as you asked.");
  });

  it("spells WhatsApp in Sorani the way the rest of the app does", async () => {
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: "9647701234567" });
    const r = await run("set_whatsapp_number", { number: "07701234567" }, ctx({ lang: "ckb" }));
    expect(r?.checked[0]).toMatch(/^ژمارەی واتسئەپ: /);
  });

  it("says nothing for a number that is not valid, or a workspace it cannot read", async () => {
    expect(await run("set_whatsapp_number", { number: "123" })).toBeNull();
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
    expect(await run("set_whatsapp_number", { number: "07701234567" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Products

const variant = (over: Record<string, unknown> = {}) => ({ amountMinor: 25000, currency: "IQD", inStock: true, ...over });
const product = (over: Record<string, unknown> = {}) => ({
  id: PID, name: "Shoes", description: null, photos: [] as string[], active: true, createdAt: ago(5_000), variants: [variant()], ...over,
});
const photo = (id: string, kind: "image" | "video" = "image") => ({ id, url: `https://x/${id}.jpg`, pathname: `merchant/t1/${id}.jpg`, kind, name: id });

describe("add_product", () => {
  it("finds the new product and says its price", async () => {
    db.product.findMany.mockResolvedValue([product()]);
    const r = await run("add_product", { name: "Shoes", price: "25,000", inStock: true });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual(["Product “Shoes” is saved at 25,000 IQD", "Availability of “Shoes”: in stock"]);
    const w = whereOf(db.product.findMany);
    expect(w).toMatchObject({ active: true, name: "Shoes", store: { tenantId: "t1" } });
    expect(queries()).toBe(1);
  });

  it("is a problem when the price, the stock, the text or the photos differ", async () => {
    db.product.findMany.mockResolvedValue([product({ variants: [variant({ amountMinor: 20000, inStock: false })], description: "old", photos: ["https://x/a1.jpg"] })]);
    const r = await run(
      "add_product",
      { name: "Shoes", price: "25000", inStock: true, description: "Leather shoes", photos: ["a1", "a2"] },
      ctx({ attachments: [photo("a1"), photo("a2")] }),
    );
    expect(r?.status).toBe("problem");
    expect(r?.checked).toEqual(["Product “Shoes” is saved"]);
    expect(r?.problems).toEqual([
      "The price of “Shoes”: 20,000 IQD, not 25,000 IQD as you asked.",
      "Availability of “Shoes”: out of stock, not in stock as you asked.",
      "The description of “Shoes”: old, not Leather shoes as you asked.",
      "Photos of “Shoes”: 1, not 2 as you asked.",
    ]);
    expect(r?.fix).toContain(`Call update_product with product=${PID} and price=25000, inStock=true, description="Leather shoes".`);
    expect(r?.fix).toContain("Photos cannot be changed from the chat");
  });

  it("counts the photos the way the run does (attached pictures only)", async () => {
    db.product.findMany.mockResolvedValue([product({ photos: ["https://x/a1.jpg"] })]);
    const files = ctx({ attachments: [photo("a1"), photo("a2", "video")] });
    const r = await run("add_product", { name: "Shoes", price: "25000", photos: ["a1", "a2"] }, files);
    expect(r?.status).toBe("ok");
    expect(r?.checked).toContain("Photos of “Shoes”: 1");
  });

  it("is a problem when no active product of that name exists", async () => {
    const r = await run("add_product", { name: "Shoes", price: "25000" });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["I found no active product named “Shoes” in the shop."]);
    expect(r?.fix).toContain("add_product");
  });

  it("says nothing when the only product of that name is an old one", async () => {
    db.product.findMany.mockResolvedValue([product({ createdAt: ago(3 * 24 * 60 * MIN) })]);
    expect(await run("add_product", { name: "Shoes", price: "25000" })).toBeNull();
  });

  it("looks for the name the app stores (trimmed, at most 80 characters) and shows at most 40", async () => {
    const long = "n".repeat(100);
    db.product.findMany.mockResolvedValue([product({ name: "n".repeat(80) })]);
    const r = await run("add_product", { name: `  ${long} `, price: "25000" });
    expect(whereOf(db.product.findMany).name).toBe("n".repeat(80));
    expect(r?.checked[0]).toBe(`Product “${"n".repeat(40)}…” is saved at 25,000 IQD`);
  });

  it("shows the photo counts in Arabic-Indic digits in Arabic", async () => {
    db.product.findMany.mockResolvedValue([product({ photos: ["https://x/a1.jpg"] })]);
    const r = await run("add_product", { name: "Shoes", photos: ["a1", "a2"] }, ctx({ lang: "ar", attachments: [photo("a1"), photo("a2")] }));
    const line = r?.problems.find((p) => p.startsWith("صور"));
    expect(line).toBe("صور «Shoes»: ١، وليس ٢ كما طلبت.");
  });

  it("never puts a cut name or description into the fix", async () => {
    const longName = "n".repeat(70);
    const none = await run("add_product", { name: longName, price: "25000" });
    expect(none?.fix).toContain("Call add_product again with name (the person's exact full text");
    expect(none?.fix).not.toContain("…");
    expect(none?.fix).not.toContain("nnnn");
    expect((await run("add_product", { name: "Shoes", price: "25000" }))?.fix).toContain('name="Shoes"');
    const longDesc = "Leather shoes, made by hand. ".repeat(10);
    db.product.findMany.mockResolvedValue([product({ description: "old" })]);
    const r = await run("add_product", { name: "Shoes", price: "25000", description: longDesc });
    expect(r?.fix).toBe(`Call update_product with product=${PID} and description (the person's exact full text; if you lost it, ask them to send it again).`);
  });

  it("does not say anything about the price of a product with several prices", async () => {
    db.product.findMany.mockResolvedValue([product({ variants: [variant(), variant({ amountMinor: 1 })] })]);
    const r = await run("add_product", { name: "Shoes", price: "25000" });
    expect(r?.checked).toEqual(["Product “Shoes” is saved"]);
  });
});

describe("update_product", () => {
  it("is ok when every changed field holds the asked value", async () => {
    db.product.findMany.mockResolvedValue([product({ name: "Boots", description: "Warm boots", variants: [variant({ amountMinor: 30000, inStock: false })] })]);
    const r = await run("update_product", { product: PID, name: "Boots", description: "Warm boots", price: "30,000", inStock: false });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual([
      "The name of “Boots”: Boots",
      "The description of “Boots”: Warm boots",
      "The price of “Boots”: 30,000 IQD",
      "Availability of “Boots”: out of stock",
    ]);
    expect(whereOf(db.product.findMany)).toMatchObject({ store: { tenantId: "t1" } });
    expect(queries()).toBe(1);
  });

  it("is a problem when a field still holds the old value", async () => {
    db.product.findMany.mockResolvedValue([product({ variants: [variant({ amountMinor: 20000 })] })]);
    const r = await run("update_product", { product: PID, price: "25000", inStock: true });
    expect(r?.status).toBe("problem");
    expect(r?.checked).toEqual(["Availability of “Shoes”: in stock"]);
    expect(r?.problems).toEqual(["The price of “Shoes”: 20,000 IQD, not 25,000 IQD as you asked."]);
    expect(r?.fix).toBe(`Call update_product with product=${PID} and price=25000.`);
  });

  it("writes a short name or description into the fix whole, and a long one as its field only", async () => {
    db.product.findMany.mockResolvedValue([product({ name: "Shoes", description: "old" })]);
    const short = await run("update_product", { product: PID, name: "Boots", description: "Warm boots" });
    expect(short?.fix).toBe(`Call update_product with product=${PID} and name="Boots", description="Warm boots".`);
    const long = await run("update_product", { product: PID, name: "b".repeat(75), description: "d".repeat(400) });
    expect(long?.status).toBe("problem");
    expect(long?.fix).not.toContain("…");
    expect(long?.fix).not.toContain("bbbb");
    expect(long?.fix).not.toContain("dddd");
    expect(long?.fix).toContain("name (the person's exact full text");
    expect(long?.fix).toContain("description (the person's exact full text");
  });

  it("finds the product by a name that only one product has", async () => {
    db.product.findMany.mockResolvedValue([product()]);
    expect((await run("update_product", { product: "shoes", price: "25000" }))?.status).toBe("ok");
  });

  it("says nothing when it cannot tell which product, or when nothing asked can be compared", async () => {
    expect(await run("update_product", { product: "Shoes", price: "25000" })).toBeNull();
    db.product.findMany.mockResolvedValue([product({ id: "x1" }), product({ id: "x2" })]);
    expect(await run("update_product", { product: "Shoes", price: "25000" })).toBeNull();
    db.product.findMany.mockResolvedValue([product({ variants: [variant(), variant()] })]);
    expect(await run("update_product", { product: PID, price: "25000" })).toBeNull();
  });

  it("is a problem when the product with that id is gone", async () => {
    const r = await run("update_product", { product: PID, price: "25000" });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["I can no longer find the product in the shop."]);
  });
});

describe("archive_product", () => {
  it("is ok when the product is no longer active", async () => {
    db.product.findMany.mockResolvedValue([product({ active: false })]);
    const r = await run("archive_product", { product: PID });
    expect(r).toMatchObject({ status: "ok", checked: ["Product “Shoes” is removed from the shop"] });
    expect(whereOf(db.product.findMany)).toMatchObject({ store: { tenantId: "t1" } });
  });

  it("is a problem when it is still active", async () => {
    db.product.findMany.mockResolvedValue([product({ active: true })]);
    const r = await run("archive_product", { product: PID });
    expect(r?.problems).toEqual(["Product “Shoes” is still in the shop."]);
    expect(r?.fix).toBe(`Call archive_product with product=${PID}.`);
  });

  it("says nothing when the product cannot be found or named", async () => {
    expect(await run("archive_product", { product: PID })).toBeNull();
    expect(await run("archive_product", { product: "Shoes" })).toBeNull();
    db.product.findMany.mockResolvedValue([product({ id: "x1", active: false }), product({ id: "x2", active: false })]);
    expect(await run("archive_product", { product: "Shoes" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Orders

describe("set_order_status", () => {
  it("compares the order's status, inside this workspace", async () => {
    db.order.findFirst.mockResolvedValue({ status: "SENT" });
    const r = await run("set_order_status", { order: "ord1", status: "SENT" });
    expect(r).toMatchObject({ status: "ok", checked: [`The order status: ${en.orders.status.SENT}`] });
    expect(whereOf(db.order.findFirst)).toEqual({ id: "ord1", tenantId: "t1" });
  });

  it("is a problem when the status differs or the order is gone", async () => {
    db.order.findFirst.mockResolvedValue({ status: "NEW" });
    const r = await run("set_order_status", { order: "ord1", status: "DELIVERED" });
    expect(r?.problems).toEqual([`The order status: ${en.orders.status.NEW}, not ${en.orders.status.DELIVERED} as you asked.`]);
    expect(r?.fix).toBe("Call set_order_status with order=ord1 and status=DELIVERED.");
    db.order.findFirst.mockResolvedValue(null);
    expect((await run("set_order_status", { order: "ord1", status: "DELIVERED" }))?.problems).toEqual(["I can no longer find the order."]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Posts

const published = (target: string, over: Record<string, unknown> = {}) => ({ action: "app.publish", metadata: { target, url: "https://p" }, ...over });
const failed = (target: string, error = "Token expired") => ({ action: "app.publish_failed", metadata: { target, error } });

describe("post_now", () => {
  it("is ok when each asked platform has a record of a published post", async () => {
    db.auditLog.findMany.mockResolvedValue([published("IG"), published("FB")]);
    const r = await run("post_now", { caption: "Hi", targets: ["FB", "IG"] });
    expect(r).toMatchObject({ status: "ok", problems: [] });
    expect(r?.checked).toEqual(["The post on Facebook is on record as published", "The post on Instagram is on record as published"]);
    const w = whereOf(db.auditLog.findMany) as { tenantId: string; action: { in: string[] }; createdAt: { gte: Date } };
    expect(w.tenantId).toBe("t1");
    expect(w.action.in).toEqual(["app.publish", "app.publish_failed"]);
    expect(Date.now() - w.createdAt.gte.getTime()).toBeLessThanOrEqual(10 * MIN);
    expect(queries()).toBe(1);
  });

  it("is a problem for a platform whose record says it failed, and keeps the one that went out as checked", async () => {
    db.auditLog.findMany.mockResolvedValue([published("FB"), failed("IG")]);
    const r = await run("post_now", { caption: "Hi", targets: ["FB", "IG"], media: "a1" });
    expect(r?.status).toBe("problem");
    expect(r?.checked).toEqual(["The post on Facebook is on record as published"]);
    expect(r?.problems).toEqual(["Instagram: the post is on record as failed."]);
    expect(r?.fix).toContain('post_now with targets=["IG"]');
    expect(r?.fix).toContain("Token expired");
  });

  it("goes by the newest record of a platform", async () => {
    db.auditLog.findMany.mockResolvedValue([published("FB"), failed("FB")]);
    expect((await run("post_now", { caption: "Hi", targets: ["FB"] }))?.status).toBe("ok");
    db.auditLog.findMany.mockResolvedValue([failed("FB"), published("FB")]);
    expect((await run("post_now", { caption: "Hi", targets: ["FB"] }))?.status).toBe("problem");
  });

  it("is a problem when a platform has no record at all", async () => {
    db.auditLog.findMany.mockResolvedValue([published("FB")]);
    const r = await run("post_now", { caption: "Hi", targets: ["FB", "IG"], media: "a1" });
    expect(r?.problems).toEqual(["Instagram: I found no record of the post going out."]);
    expect(r?.fix).toContain('post_now with targets=["IG"]');
  });

  it("does not call a video that Instagram is still preparing a failure", async () => {
    db.auditLog.findMany.mockResolvedValue([published("FB"), failed("IG", en.actions.publish.igProcessing)]);
    const r = await run("post_now", { caption: "Hi", targets: ["FB", "IG"], media: "a1" });
    expect(r).toMatchObject({ status: "ok", checked: ["The post on Facebook is on record as published"] });
    db.auditLog.findMany.mockResolvedValue([failed("IG", en.actions.publish.igProcessing)]);
    expect(await run("post_now", { caption: "Hi", targets: ["IG"], media: "a1" })).toBeNull();
  });

  it("says in Sorani and Arabic that the post is on record as published, or that publishing failed", async () => {
    db.auditLog.findMany.mockResolvedValue([published("FB"), failed("IG")]);
    const ckbR = await run("post_now", { caption: "Hi", targets: ["FB", "IG"] }, ctx({ lang: "ckb" }));
    expect(ckbR?.checked).toEqual(["پۆستەکە لە فەیسبووک وەک بڵاوکراو تۆمار کراوە"]);
    const arR = await run("post_now", { caption: "Hi", targets: ["FB", "IG"] }, ctx({ lang: "ar" }));
    expect(arR?.checked).toEqual(["تم تسجيل نشر المنشور على فيسبوك"]);
    expect(arR?.problems).toEqual(["إنستغرام: سُجِّل أن نشر المنشور فشل."]);
  });

  it("ignores platforms it does not know", async () => {
    expect(await run("post_now", { caption: "Hi", targets: ["TT"] })).toBeNull();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("schedule_post", () => {
  const WHEN = "2026-10-20T18:30";
  const RUN_AT = new Date("2026-10-20T15:30:00Z"); // Baghdad is UTC+3
  const scheduled = (over: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
    runAt: RUN_AT, input: { caption: "Sale today", targets: ["FB", "IG"], ...input }, ...over,
  });

  it("is ok when a pending post with that time and those platforms exists", async () => {
    db.scheduledPost.findMany.mockResolvedValue([scheduled()]);
    const r = await run("schedule_post", { caption: " Sale today ", targets: ["IG", "FB"], when: WHEN, media: "a1" });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual(["Scheduled time (Baghdad): 2026-10-20 18:30", "Platforms: Facebook + Instagram"]);
    expect(whereOf(db.scheduledPost.findMany)).toMatchObject({ tenantId: "t1", status: "PENDING" });
    expect(queries()).toBe(1);
  });

  it("compares the time to the minute", async () => {
    db.scheduledPost.findMany.mockResolvedValue([scheduled({ runAt: new Date("2026-10-20T15:30:40Z") })]);
    expect((await run("schedule_post", { caption: "Sale today", targets: ["FB", "IG"], when: WHEN }))?.status).toBe("ok");
  });

  it("is a problem when the time or the platforms differ", async () => {
    db.scheduledPost.findMany.mockResolvedValue([scheduled({ runAt: new Date("2026-10-20T16:30:00Z") }, { targets: ["FB"] })]);
    const r = await run("schedule_post", { caption: "Sale today", targets: ["FB", "IG"], when: WHEN });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["Scheduled time (Baghdad): 2026-10-20 19:30, not 2026-10-20 18:30 as you asked.", "Platforms: Facebook, not Facebook + Instagram as you asked."]);
    expect(r?.fix).toContain(`when="${WHEN}"`);
    expect(r?.fix).toContain("list_scheduled_posts");
  });

  it("prefers the post of that very time when several have the same caption", async () => {
    db.scheduledPost.findMany.mockResolvedValue([scheduled({ runAt: new Date("2026-10-21T15:30:00Z") }), scheduled()]);
    expect((await run("schedule_post", { caption: "Sale today", targets: ["FB", "IG"], when: WHEN }))?.status).toBe("ok");
  });

  it("is a problem when no scheduled post with that caption exists", async () => {
    const r = await run("schedule_post", { caption: "Sale today", targets: ["FB"], when: WHEN });
    expect(r?.problems).toEqual(["I could not find the scheduled post in your scheduled list."]);
    db.scheduledPost.findMany.mockResolvedValue([scheduled({}, { caption: "Another post" })]);
    expect((await run("schedule_post", { caption: "Sale today", targets: ["FB"], when: WHEN }))?.status).toBe("problem");
  });

  it("says nothing for a time it cannot read", async () => {
    expect(await run("schedule_post", { caption: "x", targets: ["FB"], when: "tomorrow" })).toBeNull();
    expect(await run("schedule_post", { caption: "x", targets: ["FB"], when: "2026-02-31T10:00" })).toBeNull();
    expect(queries()).toBe(0);
  });
});

describe("cancel_scheduled_post", () => {
  it("is ok when the post is cancelled", async () => {
    db.scheduledPost.findFirst.mockResolvedValue({ status: "CANCELLED" });
    expect(await run("cancel_scheduled_post", { post: "sp1" })).toMatchObject({ status: "ok", checked: ["The scheduled post is cancelled and will not go out"] });
    expect(whereOf(db.scheduledPost.findFirst)).toEqual({ id: "sp1", tenantId: "t1" });
  });

  it("is a problem when it is still pending", async () => {
    db.scheduledPost.findFirst.mockResolvedValue({ status: "PENDING" });
    const r = await run("cancel_scheduled_post", { post: "sp1" });
    expect(r?.problems).toEqual(["The scheduled post is still waiting and was not cancelled."]);
    expect(r?.fix).toBe("Call cancel_scheduled_post with post=sp1.");
  });

  it("says nothing when the post is gone or in another state", async () => {
    expect(await run("cancel_scheduled_post", { post: "sp1" })).toBeNull();
    db.scheduledPost.findFirst.mockResolvedValue({ status: "DONE" });
    expect(await run("cancel_scheduled_post", { post: "sp1" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The words

describe("the words", () => {
  // Letters of Kurdish only: Arabic text must not use them (code points, so no escapes are typed here).
  const KURDISH_ONLY = new RegExp(`[${[0x6a9, 0x6cc, 0x6d5, 0x6ce, 0x6c6, 0x695, 0x6b5, 0x6a4, 0x67e, 0x686, 0x6af, 0x698].map((c) => String.fromCodePoint(c)).join("")}]`);
  const ARABIC_SCRIPT = new RegExp(`[${String.fromCodePoint(0x600)}-${String.fromCodePoint(0x6ff)}]`);
  const BACKSLASH_U = new RegExp(`${String.fromCharCode(92)}${String.fromCharCode(92)}u[0-9a-fA-F]{4}`);

  /** A case of every kind of report: a good one and a bad one for each tool. */
  async function cases(lang: "ckb" | "ar" | "en") {
    const c = ctx({ lang, attachments: [photo("a1")] });
    const out: VerifyReport[] = [];
    const add = async (tool: string, args: unknown) => {
      const before = queries();
      const r = await SHOP_VERIFIERS[tool](c, args, { text: "done", runId: "r" });
      expect(queries() - before).toBeLessThanOrEqual(3);
      if (r) out.push(r);
    };
    const WHEN = "2026-10-20T18:30";
    for (const good of [true, false]) {
      db.store.findMany.mockResolvedValue([store({ automationEnabled: good, autoMode: good ? "PUBLISH" : "OFF", autoPerDay: good ? 2 : 1, videoAutoMode: good ? "DRAFT" : "OFF", videoAutoHour: good ? 20 : 9, aiReplies: good, expiryDays: good ? 14 : 30, defaultDm: good ? "Hi" : null, deliveryTime: good ? "1-2 days" : null, deliveryFeeMinor: good ? 5000 : null })]);
      await add("set_auto_replies", { on: true });
      await add("set_autopilot", { mode: "PUBLISH", perDay: 2 });
      await add("set_daily_video", { mode: "DRAFT", hour: 20 });
      await add("set_shop_options", { aiReplies: true, expiryDays: 14, defaultDm: "Hi", deliveryTime: "1-2 days", deliveryFee: "5000" });
      db.tenant.findUnique.mockResolvedValue({ whatsappNumber: good ? "9647701234567" : null });
      await add("set_whatsapp_number", { number: "07701234567" });
      db.product.findMany.mockResolvedValue(good ? [product({ photos: ["https://x/a1.jpg"] })] : [product({ variants: [variant({ amountMinor: 1, inStock: false })], photos: [], description: "old" })]);
      await add("add_product", { name: "Shoes", price: "25000", description: "Leather", photos: ["a1"] });
      await add("update_product", { product: PID, name: "Shoes", price: "25000", inStock: true });
      db.product.findMany.mockResolvedValue([product({ active: !good })]);
      await add("archive_product", { product: PID });
      db.product.findMany.mockResolvedValue([]);
      await add("add_product", { name: "Shoes", price: "25000" });
      await add("update_product", { product: PID, price: "25000" });
      db.order.findFirst.mockResolvedValue(good ? { status: "SENT" } : null);
      await add("set_order_status", { order: "o1", status: "SENT" });
      db.auditLog.findMany.mockResolvedValue(good ? [published("FB"), published("IG")] : [failed("FB"), failed("IG")]);
      await add("post_now", { caption: "Hi", targets: ["FB", "IG"] });
      db.auditLog.findMany.mockResolvedValue([]);
      await add("post_now", { caption: "Hi", targets: ["FB", "IG"] });
      db.scheduledPost.findMany.mockResolvedValue(good ? [{ runAt: new Date("2026-10-20T15:30:00Z"), input: { caption: "Hi", targets: ["FB"] } }] : []);
      await add("schedule_post", { caption: "Hi", targets: ["FB", "IG"], when: WHEN });
      db.scheduledPost.findFirst.mockResolvedValue({ status: good ? "CANCELLED" : "PENDING" });
      await add("cancel_scheduled_post", { post: "sp1" });
      // A mode that is saved but that the engine will not carry out as asked.
      db.store.findMany.mockResolvedValue([store({ plan: "FREE", autoMode: "PUBLISH", videoAutoMode: "DRAFT" })]);
      await add("set_autopilot", { mode: "PUBLISH" });
      await add("set_daily_video", { mode: "DRAFT", hour: 18 });
      db.store.findMany.mockResolvedValue([store({ pausedReason: "token", autoMode: "DRAFT", videoAutoMode: "PUBLISH" })]);
      await add("set_autopilot", { mode: "DRAFT" });
      await add("set_daily_video", { mode: "PUBLISH" });
      db.store.findMany.mockResolvedValue([store({ fbPageId: null, igUserId: null, autoMode: "PUBLISH", videoAutoMode: "PUBLISH" })]);
      await add("set_autopilot", { mode: "PUBLISH" });
      await add("set_daily_video", { mode: "PUBLISH" });
    }
    return out;
  }

  it.each(["ckb", "ar", "en"] as const)("every line exists in %s, is short enough to be kept whole, and is plain", async (lang) => {
    const reports = await cases(lang);
    expect(reports.length).toBeGreaterThan(30);
    for (const r of reports) {
      for (const line of [...r.checked, ...r.problems]) {
        expect(line.trim()).not.toBe("");
        expect(line).not.toMatch(/undefined|null|NaN|\[object|\$\{/);
        expect(line.length).toBeLessThanOrEqual(lang === "en" ? 190 : 200);
        expect(line).not.toContain(PID);
        if (lang === "ar") expect(line).not.toMatch(KURDISH_ONLY);
        if (lang !== "en") expect(line).toMatch(ARABIC_SCRIPT);
      }
      if (r.status === "ok") expect(r.fix).toBeUndefined();
      else {
        expect(r.problems.length).toBeGreaterThan(0);
        expect(r.fix).toBeTruthy();
        expect((r.fix ?? "").length).toBeLessThanOrEqual(300);
      }
      // What the screen and the model are given is exactly what was made.
      expect(parseVerify(r)).toEqual({ ...r, checked: r.checked.slice(0, 6), problems: r.problems.slice(0, 4) });
    }
  });

  it("Sorani and Arabic say the same things as English (a problem stays a problem in every language)", async () => {
    const shape = (rs: VerifyReport[]) => rs.map((r) => `${r.status}:${r.checked.length}:${r.problems.length}`);
    const [a, b, c] = [await cases("ckb"), await cases("ar"), await cases("en")];
    expect(shape(a)).toEqual(shape(c));
    expect(shape(b)).toEqual(shape(c));
  });

  it("never types a backslash escape into a line", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) for (const r of await cases(lang)) expect(all(r)).not.toMatch(BACKSLASH_U);
  });
});

describe("set_daily_video: the owner's daily plan is read back from the shop", () => {
  const PLAN = { brief: "یەکێک لە چیرۆکە نهێنییەکان", kind: "story", review: false, photos: true, targets: ["FB", "YT"], youtube: { privacy: "unlisted", madeForKids: false } };
  const ASKED = { mode: "PUBLISH", idea: PLAN.brief, kind: "story", review: false, photos: true, publishTo: ["FB", "YT"], youtubePrivacy: "unlisted", youtubeMadeForKids: false, format: "vertical" };
  const withPlan = (plan: unknown, over: Record<string, unknown> = {}) => {
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "PUBLISH", ...over })]);
    db.store.findUnique.mockResolvedValue({ videoAutoPlan: plan });
  };

  it("is ok when the saved plan is the one that was asked, one line for each thing, in the owner's language", async () => {
    withPlan(PLAN);
    const ok = await run("set_daily_video", ASKED);
    expect(ok?.status).toBe("ok");
    expect(ok?.checked).toEqual([
      "The daily video: making the video and publishing it by itself",
      `The idea of the daily video: ${PLAN.brief}`,
      "The kind of the daily video: story",
      "The shape of the daily video: vertical 9:16",
      "Improving the idea first: no",
      "Photographs in the daily video: yes",
      "Where the daily video is posted: Facebook + YouTube",
      "YouTube: who can watch: unlisted",
      "YouTube: made for kids: no",
    ]);
    // The plan is read on its own, only this shop's row.
    expect((db.store.findUnique.mock.calls.at(-1)![0] as { where: { id: string } }).where).toEqual({ id: "s1" });
    // In Sorani and Arabic the same lines are in their words, with no Kurdish-only letter in the Arabic.
    const ar = await run("set_daily_video", ASKED, ctx({ lang: "ar" }));
    expect(ar?.status).toBe("ok");
    expect(/[کیەێۆڕڵڤپچژگ]/.test((ar?.checked ?? []).join(" ").replace(PLAN.brief, ""))).toBe(false);
    const ckb = await run("set_daily_video", ASKED, ctx({ lang: "ckb" }));
    expect(ckb?.status).toBe("ok");
    expect(ckb?.checked.length).toBe(9);
    expect(ckb?.checked[1]).toContain(PLAN.brief);
  });

  it("says each thing that is not as asked, with how to put it right, and never calls a different idea fine", async () => {
    withPlan({ ...PLAN, brief: "other words", review: true, kind: "ad", targets: ["FB"], youtube: undefined });
    const r = await run("set_daily_video", ASKED);
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("The idea of the daily video: other words, not"),
        "The kind of the daily video: ad, not story as you asked.",
        "Improving the idea first: yes, not no as you asked.",
        "Where the daily video is posted: Facebook, not Facebook + YouTube as you asked.",
      ]),
    );
    // No shape or photographs line for an ad, and no YouTube answers when YouTube is not in the saved plan.
    expect(all(r)).not.toContain("YouTube: who can watch");
    expect(all(r)).not.toContain("The shape of the daily video");
    expect(r?.fix).toMatch(/^Call set_daily_video with /);
    expect(r?.fix).toContain("kind=story");
    expect(r?.fix).toContain("review=false");
    expect(r?.fix).toContain('publishTo=["FB","YT"]');
  });

  it("compares the owner's two YouTube answers when YouTube is in the plan, and does not guess one that was not asked", async () => {
    withPlan({ ...PLAN, youtube: { privacy: "public", madeForKids: true } });
    const bad = await run("set_daily_video", { publishTo: ["FB", "YT"], youtubePrivacy: "unlisted", youtubeMadeForKids: false });
    expect(bad?.problems).toEqual(["YouTube: who can watch: public, not unlisted as you asked.", "YouTube: made for kids: yes, not no as you asked."]);
    // Only the privacy was asked: the kids answer is not compared.
    const some = await run("set_daily_video", { youtubePrivacy: "public" });
    expect(some?.checked).toEqual(["YouTube: who can watch: public"]);
  });

  it("says plainly when the plan is not saved, or cannot be read; and a plan is not read at all when the call carried none", async () => {
    withPlan(null);
    const none = await run("set_daily_video", ASKED);
    expect(none?.status).toBe("problem");
    expect(none?.problems).toContain("Saved, but the daily video's plan was not found in the settings.");
    expect(none?.fix).toContain("The plan was not saved: call set_daily_video again with the owner's whole plan");
    db.store.findUnique.mockRejectedValue(new Error("db down"));
    const down = await run("set_daily_video", ASKED);
    expect(down?.problems).toContain("Could not check that the daily video's plan was saved.");
    // An old call (no plan in it) reads no plan.
    db.store.findUnique.mockClear();
    db.store.findMany.mockResolvedValue([store({ videoAutoMode: "DRAFT", videoAutoHour: 20 })]);
    expect((await run("set_daily_video", { mode: "DRAFT", hour: 20 }))?.status).toBe("ok");
    expect(db.store.findUnique).not.toHaveBeenCalled();
    // A call that only changed the plan (no mode, hour or language) is read back too.
    withPlan(PLAN);
    expect((await run("set_daily_video", { idea: PLAN.brief }))?.status).toBe("ok");
  });

  it("does not say that a daily video that posts only to YouTube has no account to post to", async () => {
    const ytOnly = { ...PLAN, targets: ["YT"] };
    withPlan(ytOnly, { fbPageId: null, igUserId: null });
    expect((await run("set_daily_video", { mode: "PUBLISH", publishTo: ["YT"], youtubePrivacy: "unlisted" }))?.status).toBe("ok");
    // Without YouTube in the plan the old note stays.
    withPlan({ ...PLAN, targets: ["FB"], youtube: undefined }, { fbPageId: null, igUserId: null });
    const noAccount = await run("set_daily_video", { mode: "PUBLISH", publishTo: ["FB"] });
    expect(noAccount?.status).toBe("problem");
    expect(noAccount?.problems[0]).toContain("no Facebook or Instagram page is connected");
  });
});
