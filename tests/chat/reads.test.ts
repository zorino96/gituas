import { beforeEach, describe, expect, it, vi } from "vitest";

// The read tools talk to the database and to Meta; here both are replaced, so what is tested is the part that is ours: every query is
// scoped by the workspace, a foreign id is refused, the model's copy of a result holds no phone number or street address, and the
// person's copy holds everything in their own language.

const db = vi.hoisted(() => ({
  order: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  product: { findMany: vi.fn(), count: vi.fn() },
  scheduledPost: { findMany: vi.fn() },
  adVideo: { findMany: vi.fn() },
  // findFirst: the WhatsApp number's store (list_conversations looks for WhatsApp chats next to Meta's); no WhatsApp number here, so it answers nothing.
  store: { findMany: vi.fn(), findFirst: vi.fn() },
  tenant: { findUnique: vi.fn() },
  postAutomation: { count: vi.fn() },
  outboxJob: { count: vi.fn() },
  conversationMessage: { count: vi.fn(), findMany: vi.fn() },
  auditLog: { count: vi.fn() },
}));
const data = vi.hoisted(() => ({
  loadAccountLists: vi.fn(),
  loadConnections: vi.fn(),
  loadPosts: vi.fn(),
  loadConversations: vi.fn(),
  loadInsights: vi.fn(),
  loadYouTube: vi.fn(),
}));
const advideo = vi.hoisted(() => ({ enabled: vi.fn(() => true) }));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => data);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/assistant/state", () => ({ loadAssistantState: vi.fn(async () => ({ today: "2026-10-19", shops: [], connectedAccounts: {}, aiAllowance: null, messagesWaitingForOwnerThisWeek: 0, productNames: [] })) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: advideo.enabled }));
vi.mock("@/lib/advideo/limits", () => ({
  workspaceVideos: vi.fn(async () => ({ LITE: { limit: 16, used: 4, left: 12 }, PRO: { limit: 0, used: 0, left: 0 }, today: { used: 0, max: 1 } })),
}));
vi.mock("@/lib/ai/image-left", () => ({ imagesLeft: vi.fn(async () => ({ month: 5, day: 2 })) }));
vi.mock("@/lib/ai/meter", () => ({ allowanceOf: vi.fn(async () => ({ percent: 31 })), OPTIONAL_SHARE: 0.7 }));
vi.mock("@/lib/shop/quota", () => ({ aiVaryUsed: vi.fn(async () => 3), smartUsed: vi.fn(async () => 7) }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 1.25, images: 6 })) }));
vi.mock("@/lib/shop/state", () => ({ loadCommentOutcomes: vi.fn(async () => ({})) }));

import { loadAssistantState } from "@/lib/assistant/state";
import { ToolRefusal, type ToolCtx } from "@/lib/chat/types";
import { READ_TOOLS } from "@/lib/chat/tools/reads";
import {
  baghdadIso,
  clip,
  majorUnits,
  modelText,
  parseSince,
  scrubContacts,
  startOfBaghdadDay,
  withinDeadline,
} from "@/lib/chat/tools/reads-shared";
import { orderDetailForModel, orderForModel, primaryStoreId, summarise, whatsappNumberForModel, type OrderRow } from "@/lib/chat/tools/reads-shape";
import { words } from "@/lib/chat/tools/reads-words";
import { dict } from "@/lib/i18n";
import { withAccounts } from "@/lib/oauth/account-scope";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [],
  review: true,
  deadline: Date.now() + 50_000,
  ...over,
});

const tool = (name: string) => {
  const t = READ_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
/** Runs a tool the way the loop does: the arguments go through the tool's own schema first. */
const call = (name: string, args: unknown = {}, c: ToolCtx = ctx()) => tool(name).run(c, tool(name).schema.parse(args));
const json = (v: unknown) => JSON.stringify(v);

const PHONE = "9647501234567";
const ADDRESS = "Gulan street, house 12, near the blue mosque";
const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: "ord_1",
  customerName: "Ari Karim",
  phone: PHONE,
  city: "erbil",
  address: ADDRESS,
  productName: "Leather bag",
  variantLabel: "red",
  amountMinor: 25_000,
  currency: "IQD",
  deliveryFeeMinor: 3_000,
  cod: true,
  status: "NEW",
  source: "DM",
  note: "please call 0750 123 4567 after five",
  collect: null,
  createdAt: new Date("2026-10-19T07:00:00Z"),
  updatedAt: new Date("2026-10-19T08:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  advideo.enabled.mockReturnValue(true);
  data.loadConnections.mockResolvedValue({
    META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" },
    META_INSTAGRAM: { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  });
  data.loadAccountLists.mockResolvedValue({ META_FACEBOOK: [{ id: "fb1", name: "Page", avatarUrl: null }], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] });
});

describe("the catalogue", () => {
  it("has the thirteen tools, all read tools for the shop with the right permission and trust", () => {
    expect(READ_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "get_account_state",
        "get_conversation",
        "get_insights",
        "get_order",
        "get_plan_usage",
        "get_settings",
        "list_comments",
        "list_conversations",
        "list_orders",
        "list_products",
        "list_scheduled_posts",
        "list_videos",
        "orders_summary",
      ].sort(),
    );
    for (const t of READ_TOOLS) {
      expect(t.risk).toBe("read");
      // The reads that need nothing of a shop (comments, messages, scheduled posts) serve the news desk as well.
      expect(t.kinds).toEqual(["list_comments", "list_conversations", "get_conversation", "list_scheduled_posts"].includes(t.name) ? ["shop", "news"] : ["shop"]);
      expect(t.permission).toBe(["get_settings", "get_plan_usage"].includes(t.name) ? "configure" : "read");
      // Only what carries customers' (or visitors') words is untrusted: get_insights shows post captions, and a Page's feed holds
      // posts that visitors write on it.
      // (list_scheduled_posts is untrusted only on a news desk, whose captions are written from feeds: a function of the context.)
      const untrustedForShop = typeof t.untrusted === "function" ? t.untrusted({ kind: "shop" } as never) : !!t.untrusted;
      expect(untrustedForShop).toBe(["list_orders", "get_order", "list_comments", "list_conversations", "get_conversation", "get_insights"].includes(t.name));
      if (t.name === "list_scheduled_posts") expect(typeof t.untrusted === "function" && t.untrusted({ kind: "news" } as never)).toBe(true);
    }
  });

  it("describes each tool in at most four sentences, and says what to do with the ids", () => {
    const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    expect(READ_TOOLS.filter((t) => sentencesOf(t.description) > 4).map((t) => `${t.name}: ${sentencesOf(t.description)}`)).toEqual([]);
    for (const t of READ_TOOLS) expect(t.description.length, t.name).toBeGreaterThan(40);
    expect(tool("list_orders").description).toContain("`id`");
    expect(tool("list_comments").description).toMatch(/`id`.*`platform`/);
    expect(tool("list_scheduled_posts").description).toContain("cancel_scheduled_post");
  });

  it("has a working sentence in every language for every tool, and no Kurdish-only letters in the Arabic", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      for (const t of READ_TOOLS) expect(t.label(lang), `${t.name}/${lang}`).toMatch(/\S/);
    }
    const arabic = JSON.stringify(words("ar"), (_k, v) => (typeof v === "function" ? v("٣", "x") : v));
    expect(arabic).not.toMatch(/[ەێۆڵڕڤگپچژ]/);
  });

  it("rejects unknown arguments and out-of-range limits", () => {
    expect(() => tool("list_orders").schema.parse({ limit: 99 })).toThrow();
    expect(() => tool("list_orders").schema.parse({ status: "SHIPPED" })).toThrow();
    expect(() => tool("list_orders").schema.parse({ phone: "0750" })).toThrow();
    expect(() => tool("get_order").schema.parse({})).toThrow();
    expect(() => tool("orders_summary").schema.parse({ range: "year" })).toThrow();
    expect(() => tool("get_insights").schema.parse({ days: 400 })).toThrow();
  });
});

describe("what the model may read", () => {
  it("never carries a phone number or a street address of an order", () => {
    const text = json([orderForModel(order()), orderDetailForModel(order())]);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain("7501234567");
    expect(text).not.toContain("0750 123 4567");
    expect(text).not.toContain("Gulan");
    expect(text).not.toContain("mosque");
    // ...but says that they exist, so the model can tell the person what is missing.
    const detail = orderDetailForModel(order()) as Record<string, unknown>;
    expect(detail.hasPhone).toBe(true);
    expect(detail.hasAddress).toBe(true);
    expect(detail.amountToCollect).toBe(28_000);
  });

  it("takes a phone number out of customer text, in any digits, and an email too", () => {
    expect(scrubContacts("call 0750 123 4567 now")).toBe("call [number] now");
    expect(scrubContacts("+964 750 123 4567")).toBe("[number]");
    expect(scrubContacts("زنگ بدە ٠٧٥٠١٢٣٤٥٦٧")).toBe("زنگ بدە [number]");
    expect(scrubContacts("07501234567")).toBe("[number]");
    expect(scrubContacts("(0750) 123 4567")).not.toMatch(/\d/);
    expect(scrubContacts("0750 - 123 - 4567")).toBe("[number]");
    expect(scrubContacts("whatsapp: 0750-123-4567.")).toBe("whatsapp: [number].");
    expect(scrubContacts("write ari@example.com please")).toBe("write [email] please");
  });

  // Hidden characters, built from code points so that none is written into this file.
  const ZWSP = String.fromCodePoint(0x200b);
  const RLM = String.fromCodePoint(0x200f);
  const RLO = String.fromCodePoint(0x202e);
  const SHY = String.fromCodePoint(0xad);
  const WORD_JOINER = String.fromCodePoint(0x2060);

  it("takes out a number split by a hidden character, however the character is placed", () => {
    expect(scrubContacts(`0750${ZWSP}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${RLM}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${RLO}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${SHY}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${WORD_JOINER}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${ZWSP} 123 4567`)).toBe("[number]");
    expect(scrubContacts(`0${ZWSP}7${ZWSP}5${ZWSP}0${ZWSP}1234567`)).toBe("[number]");
    expect(scrubContacts(`call 0750${ZWSP}1234567 please`)).toBe("call [number] please");
    expect(scrubContacts(`ari@exa${ZWSP}mple.com`)).toBe("[email]");
  });

  it("takes out a number glued to letters, or separated by a slash, a comma or a run of dashes", () => {
    expect(scrubContacts("shop07501234567")).toBe("shop[number]");
    expect(scrubContacts("x07501234567")).toBe("x[number]");
    expect(scrubContacts("phone07501234567now")).toBe("phone[number]now");
    expect(scrubContacts("0750/1234567")).toBe("[number]");
    expect(scrubContacts("0750 / 123 / 4567")).toBe("[number]");
    expect(scrubContacts("0750,1234567")).toBe("[number]");
    expect(scrubContacts("0750 - - 1234567")).toBe("[number]");
    // Digits in any script, and full-width digits, count as well.
    expect(scrubContacts("٠٧٥٠/١٢٣٤٥٦٧")).toBe("[number]");
    expect(scrubContacts("call ０７５０１２３４５６７")).toBe("call [number]");
  });

  it("takes out a number whose groups are joined by any kind of dash, a dot, a bullet, an underscore, an asterisk or the Arabic comma", () => {
    // Built from code points, so no look-alike character is written into this file.
    const d = (cp: number) => `0750${String.fromCodePoint(cp)}123${String.fromCodePoint(cp)}4567`;
    for (const cp of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe63, 0xb7, 0x2022, 0x2219, 0x22c5, 0x5f, 0x2a, 0x60c]) {
      expect(scrubContacts(d(cp)), cp.toString(16)).toBe("[number]");
      expect(scrubContacts(`call ${d(cp)} now`), cp.toString(16)).toBe("call [number] now");
    }
    expect(scrubContacts(`0750 ${String.fromCodePoint(0x2013)} 123 ${String.fromCodePoint(0x2013)} 4567`)).toBe("[number]");
    expect(scrubContacts(`+964${String.fromCodePoint(0x2011)}750${String.fromCodePoint(0x2011)}123${String.fromCodePoint(0x2011)}4567`)).toBe("[number]");
    // Digits in another script, with the Arabic comma between the groups.
    expect(scrubContacts("٠٧٥٠،١٢٣،٤٥٦٧")).toBe("[number]");
    // The joiners that Arabic-script text is written with are kept in text, so a number split by one is still a number.
    const ZWNJ = String.fromCodePoint(0x200c);
    const ZWJ = String.fromCodePoint(0x200d);
    expect(scrubContacts(`0750${ZWNJ}123${ZWNJ}4567`)).toBe("[number]");
    expect(scrubContacts(`0750${ZWJ}1234567`)).toBe("[number]");
    expect(scrubContacts(`0750${ZWNJ} 123${ZWJ} 4567`)).toBe("[number]");
    // ...and a word written with one is not damaged.
    expect(scrubContacts(`کتێب${ZWNJ}ەکان`)).toBe(`کتێب${ZWNJ}ەکان`);
  });

  it("takes out an address whatever letters it holds", () => {
    expect(scrubContacts("write ahmed\u{e9}@example.com please")).toBe("write [email] please");
    expect(scrubContacts("ئیمەیل: دانا@example.com")).toBe("ئیمەیل: [email]");
    expect(scrubContacts("a.b+c@sub.example.co.uk")).toBe("[email]");
  });

  it("leaves prices, sizes, quantities, times and dates alone, whichever dash or comma they use", () => {
    const en = String.fromCodePoint(0x2013);
    const em = String.fromCodePoint(0x2014);
    const minus = String.fromCodePoint(0x2212);
    const arComma = String.fromCodePoint(0x60c);
    expect(scrubContacts("open 10:30 - 12:45")).toBe("open 10:30 - 12:45");
    expect(scrubContacts(`open 08:00 ${en} 20:00 daily`)).toBe(`open 08:00 ${en} 20:00 daily`);
    expect(scrubContacts("open ٠٨:٠٠ - ٢٠:٠٠")).toBe("open ٠٨:٠٠ - ٢٠:٠٠");
    for (const date of [`2026${en}10${en}19`, `2026${em}10${em}19`, `2026${minus}10${minus}19`, `19${en}10${en}2026`, "2026_10_19", "١٩/١٠/٢٠٢٦"]) {
      expect(scrubContacts(`deliver on ${date} please`), date).toBe(`deliver on ${date} please`);
    }
    // The Arabic comma groups thousands as well as the plain one, and the list of sizes keeps its spaces.
    expect(scrubContacts(`it costs 25${arComma}000${arComma}000 IQD`)).toBe(`it costs 25${arComma}000${arComma}000 IQD`);
    expect(scrubContacts(`sizes 38${arComma} 39${arComma} 40${arComma} 41${arComma} 42`)).toBe(`sizes 38${arComma} 39${arComma} 40${arComma} 41${arComma} 42`);
    expect(scrubContacts("sizes 38, 39, 40, 41, 42 and 5 * 6 * 7")).toBe("sizes 38, 39, 40, 41, 42 and 5 * 6 * 7");
  });

  it("leaves prices, sizes, quantities and dates alone", () => {
    expect(scrubContacts("25000 dinar, size 42, 3 pieces")).toBe("25000 dinar, size 42, 3 pieces");
    expect(scrubContacts("deliver on 2026-10-19 please")).toBe("deliver on 2026-10-19 please");
    expect(scrubContacts("deliver on 19-10-2026 please")).toBe("deliver on 19-10-2026 please");
    expect(scrubContacts("deliver on 19/10/2026 please")).toBe("deliver on 19/10/2026 please");
    expect(scrubContacts("deliver on 2026/10/19 please")).toBe("deliver on 2026/10/19 please");
    expect(scrubContacts("deliver on 19.10.2026 please")).toBe("deliver on 19.10.2026 please");
    expect(scrubContacts("on 2026-10-19 14:30 sharp")).toBe("on 2026-10-19 14:30 sharp");
    // A price with thousands separators is not a number to call, and neither is a list of sizes.
    expect(scrubContacts("it costs 25,000,000 IQD")).toBe("it costs 25,000,000 IQD");
    expect(scrubContacts("it costs 250,000,000 IQD")).toBe("it costs 250,000,000 IQD");
    expect(scrubContacts("1,250,000 and 25,000,000.50")).toBe("1,250,000 and 25,000,000.50");
    expect(scrubContacts("sizes 38, 39, 40, 41, 42")).toBe("sizes 38, 39, 40, 41, 42");
    expect(scrubContacts("5 / 6 / 7 pieces")).toBe("5 / 6 / 7 pieces");
  });

  it("cuts customer text to 300 characters and keeps emoji whole", () => {
    expect(Array.from(modelText("a".repeat(900))).length).toBe(300);
    expect(modelText("a".repeat(900)).endsWith("…")).toBe(true);
    expect(modelText("  two   words \n here ")).toBe("two words here");
    const cut = clip("😀".repeat(50), 10);
    expect(Array.from(cut).length).toBe(10);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("writes dates in Baghdad time and money as plain numbers", () => {
    expect(baghdadIso(new Date("2026-10-19T07:00:00Z"))).toBe("2026-10-19T10:00:00+03:00");
    expect(baghdadIso("2026-10-19T22:30:00Z")).toBe("2026-10-20T01:30:00+03:00");
    expect(baghdadIso(undefined)).toBeNull();
    expect(baghdadIso("not a date")).toBeNull();
    expect(majorUnits(25_000, "IQD")).toBe(25_000);
    expect(majorUnits(1_250, "USD")).toBe(12.5);
    // 22:00 UTC is already tomorrow in Baghdad.
    expect(baghdadIso(startOfBaghdadDay(Date.parse("2026-10-19T22:00:00Z")))).toBe("2026-10-20T00:00:00+03:00");
  });

  it("only gives the last four digits of the shop's own WhatsApp number", () => {
    expect(whatsappNumberForModel("9647501234567")).toEqual({ set: true, endsWith: "4567" });
    expect(whatsappNumberForModel(null)).toEqual({ set: false });
  });

  it("parses the date a model writes, or refuses it", () => {
    expect(parseSince("2026-10-01")?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(parseSince("2026-10-01T09:00:00+03:00")?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(parseSince("last week")).toBeNull();
    expect(parseSince("2026-13-45")).toBeNull();
  });

  it("reads a time without a zone as Baghdad time, whatever zone the server runs in, and refuses a day that does not exist", () => {
    expect(parseSince("2026-10-01T09:00:00")?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(parseSince("2026-10-01T09:00")?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(parseSince("2026-10-01T09:00:00.500")?.toISOString()).toBe("2026-10-01T06:00:00.500Z");
    // A zone that was given is kept.
    expect(parseSince("2026-10-01T09:00:00Z")?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(parseSince("2026-10-01T09:00:00-05:00")?.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(parseSince("2026-10-01T09:00:00+0300")?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    // 30 February and 31 April are not rolled over into the next month.
    expect(parseSince("2026-02-30")).toBeNull();
    expect(parseSince("2026-04-31")).toBeNull();
    expect(parseSince("2026-02-30T10:00:00+03:00")).toBeNull();
    expect(parseSince("2028-02-29")?.toISOString()).toBe("2028-02-28T21:00:00.000Z");
    expect(parseSince("2026-10-01T25:00:00")).toBeNull();
  });

  it("counts a cancelled or returned order out of the sales, and never mixes currencies", () => {
    const base = { createdAt: new Date(), city: "erbil" };
    const s = summarise([
      { ...base, amountMinor: 10_000, currency: "IQD", status: "NEW", productName: "Bag" },
      { ...base, amountMinor: 5_000, currency: "IQD", status: "DELIVERED", productName: "Bag" },
      { ...base, amountMinor: 99_000, currency: "IQD", status: "CANCELLED", productName: "Shoe" },
      { ...base, amountMinor: 2_000, currency: "USD", status: "SENT", productName: "Shoe" },
    ]);
    expect(s.orders).toBe(3);
    expect(s.lost).toBe(1);
    expect(s.salesMinor).toEqual({ IQD: 15_000, USD: 2_000 });
    expect(s.topProducts[0]).toEqual({ name: "Bag", orders: 2 });
  });
});

describe("tenant isolation", () => {
  it("looks an order up inside the session's workspace only, and refuses another's", async () => {
    db.order.findFirst.mockResolvedValue(null);
    await expect(call("get_order", { id: "someone-elses-order" })).rejects.toBeInstanceOf(ToolRefusal);
    expect(db.order.findFirst).toHaveBeenCalledWith({ where: { id: "someone-elses-order", tenantId: "t1" } });
  });

  it("scopes the order list by the workspace, whatever the model asks for", async () => {
    db.order.findMany.mockResolvedValue([]);
    db.order.count.mockResolvedValue(0);
    await call("list_orders", { status: "NEW", limit: 5, since: "2026-10-01" });
    const where = db.order.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.status).toBe("NEW");
    expect(where.createdAt.gte).toEqual(new Date("2026-09-30T21:00:00.000Z"));
    expect(db.order.findMany.mock.calls[0][0].take).toBe(5);
    expect(db.order.count.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("refuses a date it cannot read instead of listing everything", async () => {
    await expect(call("list_orders", { since: "yesterday" })).rejects.toBeInstanceOf(ToolRefusal);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it("scopes products, scheduled posts, videos and summaries by the workspace", async () => {
    db.product.findMany.mockResolvedValue([]);
    db.product.count.mockResolvedValue(0);
    await call("list_products", { query: "bag" });
    expect(db.product.findMany.mock.calls[0][0].where).toMatchObject({ active: true, store: { tenantId: "t1" }, name: { contains: "bag" } });

    db.scheduledPost.findMany.mockResolvedValue([]);
    await call("list_scheduled_posts");
    expect(db.scheduledPost.findMany.mock.calls[0][0].where.tenantId).toBe("t1");

    db.adVideo.findMany.mockResolvedValue([]);
    await call("list_videos");
    expect(db.adVideo.findMany.mock.calls[0][0].where.tenantId).toBe("t1");

    db.order.findMany.mockResolvedValue([]);
    await call("orders_summary", { range: "week" });
    expect(db.order.findMany.mock.calls.at(-1)?.[0].where.tenantId).toBe("t1");
  });

  it("does not look up a product's name through another workspace's stores", async () => {
    db.adVideo.findMany.mockResolvedValue([
      { id: "v1", status: "RENDERED", source: "MANUAL", tier: "LITE", topic: "Eid", caption: "c", productId: "p1", createdAt: new Date(), postedAt: null, error: null, videoUrl: "https://x.example/v.mp4" },
    ]);
    db.product.findMany.mockResolvedValue([{ id: "p1", name: "Bag" }]);
    const r = await call("list_videos");
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["p1"] }, store: { tenantId: "t1" } });
    expect(json(r.data)).toContain("Bag");
  });
});

describe("orders", () => {
  it("passes ids through and cuts the model's copy while the person's table keeps everything", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => order({ id: `ord_${i}`, note: "x".repeat(900), phone: PHONE }));
    db.order.findMany.mockResolvedValue(rows);
    db.order.count.mockResolvedValue(40);
    const r = await call("list_orders", { limit: 3 });
    const d = r.data as { total: number; shown: number; truncated: boolean; orders: { id: string; note: string }[] };
    expect(d.orders.map((o) => o.id)).toEqual(["ord_0", "ord_1", "ord_2"]);
    expect(d).toMatchObject({ total: 40, shown: 3, truncated: true });
    expect(Array.from(d.orders[0].note).length).toBeLessThanOrEqual(300);
    expect(json(r.data)).not.toContain("7501234567");

    const table = r.view?.[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.rows).toHaveLength(3);
    expect(table.more).toBe(37);
    // The person sees the name, the phone, the address and the total (price plus delivery) in full.
    const row = table.rows[0].join(" | ");
    expect(row).toContain("Ari Karim");
    expect(row).toContain(`+${PHONE}`);
    expect(row).toContain("Gulan street");
    expect(row).toContain("28,000 IQD");
    expect(row).toContain("Erbil");
  });

  it("opens one order: the model learns a phone exists, the person reads it", async () => {
    db.order.findFirst.mockResolvedValue(order());
    const r = await call("get_order", { id: "ord_1" });
    expect(json(r.data)).not.toContain("7501234567");
    expect(json(r.data)).not.toContain("Gulan");
    const view = r.view?.[0];
    expect(view?.kind).toBe("stats");
    if (view?.kind !== "stats") return;
    expect(view.items.map((i) => i.value).join(" | ")).toContain(`+${PHONE}`);
    expect(view.items.map((i) => i.value).join(" | ")).toContain("Gulan street");
  });

  it("answers in the person's language", async () => {
    db.order.findMany.mockResolvedValue([order()]);
    db.order.count.mockResolvedValue(1);
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await call("list_orders", {}, ctx({ lang }));
      const table = r.view?.[0];
      if (table?.kind !== "table") throw new Error("no table");
      expect(table.columns).toEqual([words(lang).customer, words(lang).phone, words(lang).address, words(lang).product, words(lang).total, words(lang).status, words(lang).date]);
      expect(table.columns.every((c) => c.length > 0)).toBe(true);
    }
    // The status word is the app's own.
    const ckbTable = (await call("list_orders", {}, ctx({ lang: "ckb" }))).view?.[0];
    if (ckbTable?.kind === "table") expect(ckbTable.rows[0]).toContain("نوێ");
  });

  it("says plainly that there are no orders", async () => {
    db.order.findMany.mockResolvedValue([]);
    db.order.count.mockResolvedValue(0);
    const r = await call("list_orders");
    expect(r.view).toEqual([{ kind: "note", text: "No orders found." }]);
  });

  it("summarises today against the day before", async () => {
    const midnight = startOfBaghdadDay(Date.now());
    db.order.findMany.mockResolvedValue([
      { createdAt: new Date(midnight + 1000), amountMinor: 10_000, currency: "IQD", status: "NEW", productName: "Bag", city: "erbil" },
      { createdAt: new Date(midnight - 1000), amountMinor: 7_000, currency: "IQD", status: "DELIVERED", productName: "Bag", city: "baghdad" },
    ]);
    const r = await call("orders_summary", { range: "today" });
    const d = r.data as { orders: number; sales: Record<string, number>; ordersInThePeriodBefore: number; topCities: { city: string }[] };
    expect(d.orders).toBe(1);
    expect(d.sales).toEqual({ IQD: 10_000 });
    expect(d.ordersInThePeriodBefore).toBe(1);
    expect(d.topCities[0].city).toBe("Erbil");
    expect(db.order.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(midnight - 86_400_000));
  });
});

describe("products and scheduled posts", () => {
  it("passes a product's id and name on, with prices as plain numbers", async () => {
    db.product.findMany.mockResolvedValue([
      {
        id: "p1",
        storeId: "s1",
        name: "Leather bag",
        description: "Hand made",
        photos: ["a", "b"],
        store: { id: "s1", name: "Shop", igUsername: null },
        variants: [
          { label: "M", amountMinor: 25_000, currency: "IQD", inStock: true },
          { label: "L", amountMinor: 27_000, currency: "IQD", inStock: false },
        ],
      },
    ]);
    db.product.count.mockResolvedValue(1);
    const r = await call("list_products");
    const d = r.data as { products: { id: string; name: string; prices: { price: number; inStock: boolean }[]; photos: number }[] };
    expect(d.products[0]).toMatchObject({ id: "p1", name: "Leather bag", photos: 2 });
    expect(d.products[0].prices.map((p) => p.price)).toEqual([25_000, 27_000]);
  });

  it("passes a scheduled post's id on and shows the model a short caption", async () => {
    db.scheduledPost.findMany.mockResolvedValue([
      { id: "sp1", runAt: new Date("2026-10-20T12:00:00Z"), status: "PENDING", lastError: null, input: { caption: "c".repeat(500), targets: ["FB", "IG"], media: { url: "https://x" } } },
    ]);
    const r = await call("list_scheduled_posts");
    const d = r.data as { posts: { id: string; runAt: string; targets: string[]; caption: string; hasMedia: boolean }[] };
    expect(d.posts[0]).toMatchObject({ id: "sp1", runAt: "2026-10-20T15:00:00+03:00", targets: ["FB", "IG"], hasMedia: true });
    expect(Array.from(d.posts[0].caption).length).toBeLessThanOrEqual(120);
    const list = r.view?.[0];
    expect(list?.kind).toBe("list");
  });
});

describe("live reads from Meta", () => {
  const post = (comments: object[]) => ({ platform: "FB", id: "post1", caption: "New bags", createdAt: "2026-10-19T05:00:00+0000", commentCount: comments.length, comments });
  const comment = (over: object = {}) => ({ platform: "FB", id: "c1", postId: "post1", author: "Sara", text: "How much? call me 0750 123 4567", createdAt: "2026-10-19T06:00:00+0000", hidden: false, fromUs: false, replies: [], ...over });

  it("lists the comments waiting for a reply with the id and the platform to pass on, and no phone number", async () => {
    data.loadPosts.mockResolvedValue({
      posts: [post([comment(), comment({ id: "c2", replies: [{ id: "r1", author: "Shop", text: "ok", fromUs: true }] }), comment({ id: "c3", fromUs: true })])],
      errors: [],
    });
    const r = await call("list_comments");
    const d = r.data as { total: number; waitingForReply: number; comments: { id: string; platform: string; text: string; state: string }[] };
    expect(d.comments).toHaveLength(1);
    expect(d.comments[0]).toMatchObject({ id: "c1", platform: "FB", state: "unanswered" });
    expect(d.comments[0].text).toContain("[number]");
    expect(json(r.data)).not.toContain("7501234567");
    // The person's list keeps the number they were given.
    const list = r.view?.[0];
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items[0].title).toContain("0750 123 4567");
  });

  it("includes answered comments when asked, but never the shop's own", async () => {
    data.loadPosts.mockResolvedValue({ posts: [post([comment(), comment({ id: "c2", hidden: true }), comment({ id: "c3", fromUs: true })])], errors: [] });
    const r = await call("list_comments", { unanswered: false });
    const ids = (r.data as { comments: { id: string }[] }).comments.map((c) => c.id).sort();
    expect(ids).toEqual(["c1", "c2"]);
  });

  it("answers with a note, not a throw, when nothing is connected", async () => {
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } });
    const r = await call("list_comments");
    expect((r.data as { available: boolean }).available).toBe(false);
    expect(r.view?.[0]).toMatchObject({ kind: "note", text: words("en").notConnectedMeta });
    expect(data.loadPosts).not.toHaveBeenCalled();
    const ckb = await call("list_conversations", {}, ctx({ lang: "ckb" }));
    expect(ckb.view?.[0]).toMatchObject({ kind: "note", text: words("ckb").notConnectedMeta });
  });

  it("does not start a Graph call it cannot finish", async () => {
    const r = await call("list_comments", {}, ctx({ deadline: Date.now() + 1_000 }));
    expect((r.data as { reason: string }).reason).toBe("no_time");
    expect(data.loadPosts).not.toHaveBeenCalled();
  });

  it("turns a failed platform call into a note", async () => {
    data.loadPosts.mockRejectedValue(new Error("boom"));
    const r = await call("list_comments");
    expect((r.data as { reason: string }).reason).toBe("failed");
    expect(r.view?.[0]).toMatchObject({ kind: "note", tone: "warn" });
  });

  it("reports a platform that failed while the other one answered", async () => {
    data.loadPosts.mockResolvedValue({ posts: [post([comment()])], errors: [{ platform: "IG", message: "IG media failed (190)" }] });
    const r = await call("list_comments");
    const d = r.data as { problems: { platform: string; problem: string }[] };
    expect(d.problems[0].platform).toBe("IG");
    expect(r.view?.some((b) => b.kind === "note" && b.tone === "warn")).toBe(true);
  });

  const conv = (over: object = {}) => ({
    platform: "IG",
    id: "conv1",
    participantId: "psid1",
    participantName: "sara_k",
    withinWindow: true,
    updatedAt: "2026-10-19T06:00:00+0000",
    messages: [
      { id: "m1", text: "Hello", fromUs: true, createdAt: "2026-10-19T05:00:00+0000" },
      { id: "m2", text: "my number is 0750 123 4567, price?", fromUs: false, createdAt: "2026-10-19T06:00:00+0000" },
    ],
    ...over,
  });

  it("lists the conversations whose last word is the buyer's, with the ids to pass on", async () => {
    data.loadConversations.mockResolvedValue({ conversations: [conv(), conv({ id: "conv2", messages: [{ id: "m3", text: "thanks", fromUs: true }] })], unreadable: 0, errors: [] });
    db.order.findMany.mockResolvedValue([{ buyerKey: "psid1" }]);
    db.conversationMessage.findMany.mockResolvedValue([{ authorId: "psid1", outcomeReason: "needs_you" }]);
    const r = await call("list_conversations");
    const d = r.data as { conversations: { id: string; platform: string; last: string; canReply: boolean; needsYou: string; openOrder: boolean }[] };
    expect(d.conversations).toHaveLength(1);
    expect(d.conversations[0]).toMatchObject({ id: "conv1", platform: "IG", canReply: true, needsYou: "needs_you", openOrder: true });
    expect(d.conversations[0].last).toContain("[number]");
    expect(json(r.data)).not.toContain("7501234567");
    // The buyer's own id on the platform is not handed to the model: sending goes by the conversation id.
    expect(json(r.data)).not.toContain("psid1");
    // Conversations are looked up through this workspace's own accounts and stores.
    expect(data.loadConversations.mock.calls[0][0]).toBe("t1");
    expect(db.order.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.conversationMessage.findMany.mock.calls[0][0].where.store).toEqual({ tenantId: "t1" });
  });

  it("counts as waiting only the chats Meta still lets the shop answer, like the Messages screen, and counts the closed ones apart", async () => {
    const closed = (id: string) => conv({ id, withinWindow: false });
    data.loadConversations.mockResolvedValue({ conversations: [conv(), conv({ id: "conv2" }), closed("conv3"), closed("conv4"), closed("conv5")], unreadable: 0, errors: [] });
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    const r = await call("list_conversations");
    const d = r.data as { total: number; waitingForReply: number; olderUnanswered: number; conversations: { id: string; canReply: boolean }[] };
    expect(d.waitingForReply).toBe(2);
    expect(d.olderUnanswered).toBe(3);
    // The closed chats are still listed, with their badge: the shop can still answer them another way.
    expect(d.total).toBe(5);
    expect(d.conversations.filter((c) => !c.canReply)).toHaveLength(3);
    // Nothing closed: no extra field for the model to read.
    data.loadConversations.mockResolvedValue({ conversations: [conv()], unreadable: 0, errors: [] });
    const open = (await call("list_conversations")).data as { waitingForReply: number; olderUnanswered?: number };
    expect(open.waitingForReply).toBe(1);
    expect(open.olderUnanswered).toBeUndefined();
  });

  describe("with several Pages or Instagram accounts", () => {
    const connected = () =>
      data.loadConnections.mockResolvedValue({
        META_FACEBOOK: { connected: true, name: "Newest Page", accountId: "fb2" },
        META_INSTAGRAM: { connected: true, name: "shop_ig", accountId: "ig1" },
        TIKTOK: { connected: false },
        YOUTUBE: { connected: false },
      });
    const threePages = () =>
      data.loadAccountLists.mockResolvedValue({
        META_FACEBOOK: [
          { id: "fb1", name: "Old Page", avatarUrl: null },
          { id: "fb2", name: "Newest Page", avatarUrl: null },
          { id: "fb3", name: "Third Page", avatarUrl: null },
        ],
        META_INSTAGRAM: [{ id: "ig1", name: "shop_ig", avatarUrl: null }],
        TIKTOK: [],
        YOUTUBE: [],
      });
    const noteText = (b: { kind: string; text?: string } | undefined) => (b?.kind === "note" ? (b.text ?? "") : "");

    it("tells the person and the model which Page the comments come from, and how many others were not read", async () => {
      connected();
      threePages();
      data.loadPosts.mockResolvedValue({ posts: [post([comment()])], errors: [] });
      const r = await call("list_comments");
      // The person chose nothing in the chat: the newest account was read, and the Accounts button chooses another (no screen is named).
      expect(noteText(r.view?.[0])).toBe(words("en").newestAccount("Facebook", "Newest Page", "2"));
      expect(noteText(r.view?.[0])).toContain("Newest Page");
      expect(noteText(r.view?.[0])).toContain("Accounts button");
      expect(noteText(r.view?.[0])).not.toMatch(/Comments|Messages|screen|Settings/);
      // Instagram has one account: nothing to say about it.
      expect(r.view?.filter((b) => b.kind === "note")).toHaveLength(1);
      expect((r.data as { accounts: unknown }).accounts).toEqual({ FB: { account: "Newest Page", otherAccountsNotRead: 2 } });
      // Asking for the platform that has one account leaves the note out.
      const ig = await call("list_comments", { platform: "IG" });
      expect(ig.view?.some((b) => noteText(b).includes("Newest Page"))).toBe(false);
      expect((ig.data as { accounts?: unknown }).accounts).toBeUndefined();
    });

    it("says it in the person's language, also when the list is empty", async () => {
      connected();
      threePages();
      data.loadPosts.mockResolvedValue({ posts: [], errors: [] });
      for (const lang of ["ckb", "ar", "en"] as const) {
        const r = await call("list_comments", {}, ctx({ lang }));
        const t = dict(lang);
        expect(noteText(r.view?.[0]), lang).toBe(words(lang).newestAccount(t.platform.FB, "Newest Page", t.fmt.num(2)));
        expect(noteText(r.view?.[0]), lang).not.toContain(t.nav.comments);
        expect(noteText(r.view?.[1]), lang).toBe(words(lang).noCommentsWaiting);
      }
    });

    it("does the same for the messages, and names nothing when each platform has one account", async () => {
      connected();
      threePages();
      data.loadConversations.mockResolvedValue({ conversations: [conv()], unreadable: 0, errors: [] });
      db.order.findMany.mockResolvedValue([]);
      db.conversationMessage.findMany.mockResolvedValue([]);
      const r = await call("list_conversations");
      expect(noteText(r.view?.[0])).toBe(words("en").newestAccount("Facebook", "Newest Page", "2"));
      expect((r.data as { accounts: unknown }).accounts).toEqual({ FB: { account: "Newest Page", otherAccountsNotRead: 2 } });
      data.loadAccountLists.mockResolvedValue({ META_FACEBOOK: [{ id: "fb2", name: "Newest Page", avatarUrl: null }], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] });
      const single = await call("list_conversations");
      expect(single.view?.some((b) => b.kind === "note")).toBe(false);
      expect((single.data as { accounts?: unknown }).accounts).toBeUndefined();
    });

    it("with an account the person chose in the chat, says it read that one, by name, and that the Accounts button changes it", async () => {
      data.loadConnections.mockResolvedValue({
        META_FACEBOOK: { connected: true, name: "Old Page", accountId: "fb1" },
        META_INSTAGRAM: { connected: true, name: "shop_ig", accountId: "ig1" },
        TIKTOK: { connected: false },
        YOUTUBE: { connected: false },
      });
      threePages();
      data.loadPosts.mockResolvedValue({ posts: [post([comment()])], errors: [] });
      data.loadConversations.mockResolvedValue({ conversations: [conv()], unreadable: 0, errors: [] });
      db.order.findMany.mockResolvedValue([]);
      db.conversationMessage.findMany.mockResolvedValue([]);
      for (const lang of ["ckb", "ar", "en"] as const) {
        const t = dict(lang);
        const c = await withAccounts({ META_FACEBOOK: "fb1" }, () => call("list_comments", {}, ctx({ lang })));
        expect(noteText(c.view?.[0]), lang).toBe(words(lang).chosenAccount(t.platform.FB, "Old Page", t.fmt.num(2)));
        expect(noteText(c.view?.[0]), lang).not.toContain(t.nav.comments);
        expect(noteText(c.view?.[0]), lang).not.toBe(words(lang).newestAccount(t.platform.FB, "Old Page", t.fmt.num(2)));
        const m = await withAccounts({ META_FACEBOOK: "fb1" }, () => call("list_conversations", {}, ctx({ lang })));
        expect(noteText(m.view?.[0]), lang).toBe(words(lang).chosenAccount(t.platform.FB, "Old Page", t.fmt.num(2)));
      }
      // The model learns that it is the person's own choice; without a choice the field is not there.
      const r = await withAccounts({ META_FACEBOOK: "fb1" }, () => call("list_comments"));
      expect((r.data as { accounts: unknown }).accounts).toEqual({ FB: { account: "Old Page", otherAccountsNotRead: 2, chosenInChat: true } });
      expect(noteText(r.view?.[0])).toBe(words("en").chosenAccount("Facebook", "Old Page", "2"));
      expect(noteText(r.view?.[0])).toContain("Old Page");
      expect(noteText(r.view?.[0])).toContain("you chose in the chat");
    });

    it("a news desk has no choice in its chat: its note still names the screen that switches", async () => {
      connected();
      threePages();
      data.loadPosts.mockResolvedValue({ posts: [], errors: [] });
      const t = dict("en");
      const r = await call("list_comments", {}, ctx({ kind: "news" }));
      expect(noteText(r.view?.[0])).toBe(words("en").severalAccounts("Facebook", "Newest Page", "2", t.nr.shell.nav.items.comments));
    });

    it("no wording of the chat sends the person to Settings or to a screen to connect or switch accounts", () => {
      for (const lang of ["ckb", "ar", "en"] as const) {
        const w = words(lang);
        expect(w.notConnectedMeta, lang).not.toMatch(/Settings|ڕێکخستن|الإعدادات/);
        expect(w.newestAccount("Facebook", "A", "2"), lang).not.toMatch(/Settings|ڕێکخستن|الإعدادات|screen|شاشة|بەشی/);
        expect(w.chosenAccount("Facebook", "A", "2"), lang).not.toMatch(/Settings|ڕێکخستن|الإعدادات|screen|شاشة|بەشی/);
      }
      expect(words("en").notConnectedMeta).toContain("Accounts button");
    });

    it("still answers when the list of accounts cannot be read", async () => {
      connected();
      data.loadAccountLists.mockRejectedValue(new Error("db down"));
      data.loadPosts.mockResolvedValue({ posts: [post([comment()])], errors: [] });
      const r = await call("list_comments");
      expect((r.data as { comments: unknown[] }).comments).toHaveLength(1);
      expect((r.data as { accounts?: unknown }).accounts).toBeUndefined();
    });
  });

  it("opens a conversation by its id and refuses an id that is not this shop's", async () => {
    data.loadConversations.mockResolvedValue({ conversations: [conv()], unreadable: 0, errors: [] });
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    const r = await call("get_conversation", { id: "conv1" });
    const d = r.data as { id: string; messages: { from: string; text: string }[] };
    expect(d.id).toBe("conv1");
    expect(d.messages.map((m) => m.from)).toEqual(["shop", "buyer"]);
    expect(json(r.data)).not.toContain("7501234567");
    await expect(call("get_conversation", { id: "conv-of-another-shop" })).rejects.toBeInstanceOf(ToolRefusal);
  });
});

describe("settings and plan", () => {
  const store = {
    id: "s1",
    name: "My shop",
    igUsername: "myshop",
    plan: "PRO",
    planPaidUntil: new Date(Date.now() + 10 * 86_400_000),
    fbPageId: "fb1",
    igUserId: null,
    automationEnabled: true,
    pausedReason: null,
    aiReplies: true,
    aiBrief: "Be warm. Never promise delivery times.",
    likeComments: true,
    autoHideSpam: false,
    expiryDays: 30,
    stopBefore: null,
    defaultDm: "Hello!",
    deliveryFeeMinor: 3_000,
    deliveryCurrency: "IQD",
    deliveryTime: "1-2 days",
    deliveryCityFees: { erbil: 2_000 },
    autoMode: "PUBLISH",
    autoPerDay: 2,
    autoLastAt: null,
    videoAutoMode: "OFF",
    videoAutoTier: "LITE",
    videoAutoHour: 18,
    videoAutoLastAt: null,
    waPhoneNumberId: "wa1",
  };

  it("reads the settings with the names set_shop_options uses, and never the WhatsApp number", async () => {
    db.store.findMany.mockResolvedValue([store]);
    db.tenant.findUnique.mockResolvedValue({ whatsappNumber: PHONE });
    const r = await call("get_settings");
    const d = r.data as { shops: { id: string; primary: boolean; replies: Record<string, unknown>; shop: Record<string, unknown> }[]; whatsappOrderLinkNumber: unknown };
    expect(d.shops[0].id).toBe("s1");
    expect(d.shops[0].primary).toBe(true);
    expect(d.shops[0].replies).toMatchObject({ aiReplies: true, likeComments: true, autoHideSpam: false, expiryDays: 30, defaultDm: "Hello!" });
    expect(d.shops[0].shop).toMatchObject({ deliveryFee: 3_000, deliveryTime: "1-2 days" });
    expect(d.whatsappOrderLinkNumber).toEqual({ set: true, endsWith: "4567" });
    expect(json(r.data)).not.toContain(PHONE);
    // The store query asks for named columns only, so a secret column is never even loaded.
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
    expect(db.store.findMany.mock.calls[0][0].select.waPinEncrypted).toBeUndefined();
    expect(db.store.findMany.mock.calls[0][0].select).toBeDefined();
    // The person sees their own number.
    const stats = r.view?.find((b) => b.kind === "stats" && b.items.some((i) => i.value.includes(PHONE)));
    expect(stats).toBeDefined();
  });

  it("tells the model the shop's video language by a readable name and its code, Sorani when none is saved, and shows it on the screen", async () => {
    db.store.findMany.mockResolvedValue([store]);
    const plain = await call("get_settings", { area: "video" });
    const daily = (plain.data as { shops: { dailyVideo: Record<string, unknown> }[] }).shops[0].dailyVideo;
    expect(daily).toMatchObject({ mode: "OFF", afterHourBaghdad: 18, videoLanguage: "Sorani Kurdish (ckb)" });
    db.store.findMany.mockResolvedValue([{ ...store, videoLang: "en" }]);
    const english = await call("get_settings", { area: "video" });
    expect((english.data as { shops: { dailyVideo: Record<string, unknown> }[] }).shops[0].dailyVideo.videoLanguage).toBe("English (en)");
    db.store.findMany.mockResolvedValue([{ ...store, videoLang: "klingon" }]);
    expect(((await call("get_settings", { area: "video" })).data as { shops: { dailyVideo: Record<string, unknown> }[] }).shops[0].dailyVideo.videoLanguage).toBe("Sorani Kurdish (ckb)");
    // The query asks for the column, and the card shows the language by its name.
    expect(db.store.findMany.mock.calls[0][0].select.videoLang).toBe(true);
    db.store.findMany.mockResolvedValue([{ ...store, videoLang: "ar" }]);
    const view = (await call("get_settings", { area: "video" })).view;
    const items = (view?.[0] as { items: { label: string; value: string }[] }).items;
    expect(items).toContainEqual({ label: "Video language", value: "Arabic" });
    // The other areas do not carry it.
    const shop = (await call("get_settings", { area: "autopilot" })).data as { shops: Record<string, unknown>[] };
    expect(shop.shops[0].dailyVideo).toBeUndefined();
  });

  it("limits the answer to the area asked for", async () => {
    db.store.findMany.mockResolvedValue([store]);
    const r = await call("get_settings", { area: "autopilot" });
    const shop = (r.data as { shops: Record<string, unknown>[] }).shops[0];
    expect(shop.autopilot).toMatchObject({ mode: "PUBLISH", postsPerDay: 2 });
    expect(shop.replies).toBeUndefined();
    expect(shop.shop).toBeUndefined();
  });

  it("picks the shop of the connected account as the main one", () => {
    const stores = [
      { id: "a", fbPageId: "x", igUserId: null },
      { id: "b", fbPageId: "fb1", igUserId: null },
    ];
    expect(primaryStoreId(stores, ["fb1"])).toBe("b");
    expect(primaryStoreId(stores, [])).toBe("a");
    expect(primaryStoreId([], ["fb1"])).toBeUndefined();
  });

  it("reports the plan and what is used, per shop and for the workspace", async () => {
    db.store.findMany.mockResolvedValue([{ id: "s1", name: "My shop", igUsername: null, plan: "MERCHANT", planPaidUntil: new Date(Date.now() - 86_400_000), dailyCap: null }]);
    db.postAutomation.count.mockResolvedValue(4);
    db.outboxJob.count.mockResolvedValue(12);
    const r = await call("get_plan_usage");
    const d = r.data as { shops: { plan: string; planDaysRanOut: boolean; repliesToday: { used: number; limit: number }; smartRepliesThisMonth: { used: number } }[]; workspace: { aiAllowancePercentUsed: number } };
    // A plan whose days ran out works as Free.
    expect(d.shops[0]).toMatchObject({ plan: "FREE", planDaysRanOut: true });
    expect(d.shops[0].repliesToday).toEqual({ used: 12, limit: 100 });
    expect(d.shops[0].smartRepliesThisMonth.used).toBe(7);
    expect(d.workspace.aiAllowancePercentUsed).toBe(31);
    expect(db.postAutomation.count.mock.calls[0][0].where.storeId).toBe("s1");
  });
});

describe("account, insights and videos", () => {
  it("reads the account snapshot for the session's workspace", async () => {
    const r = await call("get_account_state");
    expect(vi.mocked(loadAssistantState).mock.calls[0][0]).toBe("t1");
    expect(vi.mocked(loadAssistantState).mock.calls[0][1]).toMatchObject({ facebook: { connected: true, name: "Page" }, instagram: { connected: false } });
    expect((r.data as { now: string }).now).toMatch(/\+03:00$/);
    expect(r.view?.[0].kind).toBe("stats");
  });

  const quiet = () => {
    db.conversationMessage.count.mockResolvedValue(30);
    db.conversationMessage.findMany.mockResolvedValue([]);
    db.order.count.mockResolvedValue(9);
    db.order.findMany.mockResolvedValue([]);
    db.auditLog.count.mockResolvedValue(2);
    db.product.findMany.mockResolvedValue([]);
    data.loadPosts.mockResolvedValue({ posts: [], errors: [] });
    data.loadYouTube.mockResolvedValue(null);
  };

  it("gathers the shop's own numbers and the platforms' numbers, scoped to the workspace", async () => {
    quiet();
    data.loadConnections.mockResolvedValue({
      META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" },
      META_INSTAGRAM: { connected: true, name: "ig", accountId: "ig1" },
      TIKTOK: { connected: false },
      YOUTUBE: { connected: false },
    });
    data.loadInsights.mockResolvedValue({ fbFollowers: 120, fbMetrics: [], igMetrics: [{ name: "followers", value: 50 }], waTaps7d: 2, notes: [] });
    const r = await call("get_insights", { days: 14 });
    const d = r.data as { days: number; shop: { buyerMessages: number; orders: number }; facebookFollowers: number; instagram: { followers: number }; whatsappTapsLast7Days: number };
    expect(d).toMatchObject({ days: 14, shop: { buyerMessages: 30, orders: 9 }, facebookFollowers: 120, instagram: { followers: 50 }, whatsappTapsLast7Days: 2 });
    expect(db.conversationMessage.count.mock.calls[0][0].where.store).toEqual({ tenantId: "t1" });
    expect(db.order.count.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(db.auditLog.count.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("writes the unit of the period once in a tile label, in every language", async () => {
    quiet();
    data.loadInsights.mockResolvedValue({ fbFollowers: 120, fbMetrics: [], igMetrics: [], waTaps7d: 2, notes: [] });
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await call("get_insights", { days: 28 }, ctx({ lang }));
      const stats = r.view?.[0];
      if (stats?.kind !== "stats") throw new Error("no stats");
      const period = words(lang).days(28);
      const labels = stats.items.slice(0, 3).map((i) => i.label);
      expect(labels, lang).toEqual([words(lang).dmsLabel(period), words(lang).commentsLabel(period), words(lang).ordersLabel(period)]);
      // The unit stands once in each label: the period (number and unit) is not followed by the unit again.
      const unit = period.replace(/[0-9\u0660-\u0669\s]/g, "");
      expect(unit.length, lang).toBeGreaterThan(0);
      for (const label of labels) expect(label.split(unit).length - 1, `${lang}: ${label}`).toBe(1);
    }
    // One day and two days in Arabic have their own forms, and still only once.
    const ar = words("ar");
    for (const n of [1, 2]) {
      const label = ar.dmsLabel(ar.days(n));
      expect(label.split(ar.days(n)).length - 1).toBe(1);
      expect(label).not.toMatch(/\u064A\u0648\u0645 \u064A\u0648\u0645/);
    }
  });

  it("still answers with the shop's own numbers when Meta fails, and says what is missing", async () => {
    quiet();
    data.loadInsights.mockRejectedValue(new Error("Graph down"));
    const r = await call("get_insights");
    const d = r.data as { shop: { buyerMessages: number }; notAvailable: string[]; facebookFollowers?: number };
    expect(d.shop.buyerMessages).toBe(30);
    expect(d.facebookFollowers).toBeUndefined();
    expect(d.notAvailable).toContain("facebook_and_instagram_numbers");
    expect(r.view?.some((b) => b.kind === "note" && b.tone === "warn")).toBe(true);
  });

  it("does not call Meta for insights when the time is almost out", async () => {
    quiet();
    const r = await call("get_insights", {}, ctx({ deadline: Date.now() + 500 }));
    expect(data.loadInsights).not.toHaveBeenCalled();
    expect((r.data as { notAvailable: string[] }).notAvailable).toContain("facebook_and_instagram_numbers");
  });

  it("says plainly when AI video is off, without reading any jobs", async () => {
    advideo.enabled.mockReturnValue(false);
    const r = await call("list_videos");
    expect((r.data as { available: boolean }).available).toBe(false);
    expect(db.adVideo.findMany).not.toHaveBeenCalled();
    expect(r.view?.[0]).toMatchObject({ kind: "note", text: words("en").videosOff });
  });

  it("hands the model a video's id and whether it is ready, and never the file address", async () => {
    db.adVideo.findMany.mockResolvedValue([
      { id: "v1", status: "RENDERED", source: "AUTO", tier: "LITE", topic: "Eid sale", caption: "c", productId: null, createdAt: new Date(), postedAt: null, error: null, videoUrl: "https://blob.example/v1.mp4" },
      { id: "v2", status: "QUEUED", source: "MANUAL", tier: "LITE", topic: null, caption: null, productId: null, createdAt: new Date(), postedAt: null, error: null, videoUrl: "https://blob.example/v2.mp4" },
    ]);
    const r = await call("list_videos");
    const d = r.data as { videos: { id: string; ready: boolean }[]; leftThisMonth: { fastModel: number } };
    expect(d.videos.map((v) => [v.id, v.ready])).toEqual([["v1", true], ["v2", false]]);
    expect(d.leftThisMonth.fastModel).toBe(12);
    expect(json(r.data)).not.toContain("blob.example");
    // The person can open a finished video, not one still being made.
    const list = r.view?.find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items.map((i) => i.href)).toEqual(["https://blob.example/v1.mp4", undefined]);
  });
});

describe("withinDeadline", () => {
  it("does not start work when there is not enough time left", async () => {
    const fn = vi.fn(async () => 1);
    expect(await withinDeadline(Date.now() + 1_000, fn)).toEqual({ ok: false, reason: "no_time" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the value when the work finishes in time", async () => {
    expect(await withinDeadline(Date.now() + 20_000, async () => 7)).toEqual({ ok: true, value: 7 });
  });

  it("turns a throw into a failure value", async () => {
    expect(await withinDeadline(Date.now() + 20_000, async () => Promise.reject(new Error("x")))).toEqual({ ok: false, reason: "failed" });
    expect(
      await withinDeadline(Date.now() + 20_000, () => {
        throw new Error("sync");
      }),
    ).toEqual({ ok: false, reason: "failed" });
  });

  it("stops waiting at the deadline", async () => {
    vi.useFakeTimers();
    try {
      const pending = withinDeadline(Date.now() + 10_000, () => new Promise<never>(() => {}));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
