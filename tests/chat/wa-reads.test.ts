import { beforeEach, describe, expect, it, vi } from "vitest";

// WhatsApp in the chat's read tools. The database and Meta are replaced; what is tested is the part that is ours: the chats are read
// the way the WhatsApp screen reads them, scoped to the workspace's own WhatsApp store, the 24-hour window and STOP are flagged, and
// the model's copy never holds a phone number (the chat's id is an opaque reference) while the person's copy does.

const db = vi.hoisted(() => ({
  order: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  product: { findMany: vi.fn(), count: vi.fn() },
  scheduledPost: { findMany: vi.fn() },
  adVideo: { findMany: vi.fn() },
  store: { findMany: vi.fn(), findFirst: vi.fn() },
  tenant: { findUnique: vi.fn() },
  postAutomation: { count: vi.fn() },
  outboxJob: { count: vi.fn(), findMany: vi.fn() },
  conversationMessage: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  threadPause: { findMany: vi.fn() },
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

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => data);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/assistant/state", () => ({ loadAssistantState: vi.fn(async () => ({})) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/limits", () => ({ workspaceVideos: vi.fn(async () => null) }));
vi.mock("@/lib/ai/image-left", () => ({ imagesLeft: vi.fn(async () => null) }));
vi.mock("@/lib/ai/meter", () => ({ allowanceOf: vi.fn(async () => null), OPTIONAL_SHARE: 0.7 }));
vi.mock("@/lib/shop/quota", () => ({ aiVaryUsed: vi.fn(async () => 0), smartUsed: vi.fn(async () => 0) }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 1, images: 0 })) }));
vi.mock("@/lib/shop/state", () => ({ loadCommentOutcomes: vi.fn(async () => ({})) }));

import { wrapForModel } from "@/lib/chat/wrap";
import { ToolRefusal, type ToolCtx } from "@/lib/chat/types";
import { READ_TOOLS } from "@/lib/chat/tools/reads";
import { isWaRef, loadWaChats, parseWaRef, waRef } from "@/lib/chat/tools/reads-wa-live";
import { answeredOnPhone, askedToStop, waItems, waLabel, waPlain, windowOpen } from "@/lib/chat/tools/reads-wa-shape";
import { words } from "@/lib/chat/tools/reads-words";
import { dict } from "@/lib/i18n";

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
const call = (name: string, args: unknown = {}, c: ToolCtx = ctx()) => tool(name).run(c, tool(name).schema.parse(args));
const json = (v: unknown) => JSON.stringify(v);

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);
const PHONE_A = "9647501234567";
const PHONE_B = "9647709876543";
const PHONE_C = "9647511112222";

let seq = 0;
interface Row {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  outcomeReason: string | null;
}
const row = (over: Partial<Row> = {}): Row => ({
  id: `cmsg${String(++seq).padStart(8, "0")}`,
  direction: "INBOUND",
  content: "hello",
  authorId: PHONE_A,
  authorName: "Dana",
  createdAt: hoursAgo(1),
  outcomeReason: null,
  ...over,
});
const job = (over: Record<string, unknown> = {}) => ({ id: `job${++seq}`, kind: "DM_ANSWER", payload: { message: { text: "Yes, we have it." } }, recipientId: PHONE_A, updatedAt: hoursAgo(0.5), ...over });

/** A pause the bot was given in a chat: the one trace of an answer the owner typed on the phone. */
const pause = (threadKey: string, createdAt: Date) => ({ threadKey, createdAt });

/** The database as the loader's queries see it: narrowed by the buyer when the query asks for one. */
function install(rows: Row[], jobs: ReturnType<typeof job>[] = [], connected = true, pauses: ReturnType<typeof pause>[] = []) {
  db.store.findFirst.mockResolvedValue(connected ? { id: "s1", waPhoneNumberId: "pn1" } : null);
  db.threadPause.findMany.mockImplementation(async (q: { where: { threadKey: { in: string[] } } }) => pauses.filter((p) => q.where.threadKey.in.includes(p.threadKey)));
  db.conversationMessage.findMany.mockImplementation(async (q: { where: { authorId?: string } }) =>
    rows.filter((r) => !q.where.authorId || r.authorId === q.where.authorId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );
  db.conversationMessage.findFirst.mockImplementation(async (q: { where: { id: string; storeId: string; platform: string } }) => {
    const r = rows.find((x) => x.id === q.where.id);
    return r && q.where.storeId === "s1" && q.where.platform === "WHATSAPP" ? { authorId: r.authorId } : null;
  });
  db.outboxJob.findMany.mockImplementation(async (q: { where: { recipientId?: string } }) => jobs.filter((j) => !q.where.recipientId || j.recipientId === q.where.recipientId));
  db.order.findMany.mockResolvedValue([]);
  db.order.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  vi.resetAllMocks();
  seq = 0;
  data.loadConnections.mockResolvedValue({
    META_FACEBOOK: { connected: false },
    META_INSTAGRAM: { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  });
  data.loadAccountLists.mockResolvedValue({ META_FACEBOOK: [], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] });
  data.loadConversations.mockResolvedValue({ conversations: [], unreadable: 0, errors: [] });
});

interface Item {
  id: string;
  platform: string;
  with?: string;
  lastFrom: string;
  last?: string;
  canReply: boolean;
  askedToStop?: boolean;
  windowClosesAt?: string;
  needsYou?: string;
  openOrder?: boolean;
  answeredOnPhone?: boolean;
}
type ListData = { total: number; shown: number; waitingForReply: number; olderUnanswered?: number; conversations: Item[]; problems?: { platform: string; problem: string }[]; accounts?: unknown; available?: boolean; reason?: string };

describe("the reference of a WhatsApp chat", () => {
  it("is 'wa_' and a stored message id, and nothing else counts", () => {
    expect(waRef("cmsg00000001")).toBe("wa_cmsg00000001");
    expect(parseWaRef("wa_cmsg00000001")).toBe("cmsg00000001");
    expect(isWaRef("wa_cmsg00000001")).toBe(true);
    for (const bad of ["", "wa_", "wa_short", PHONE_A, `wa_${PHONE_A}!`, "t_10153", "aWdfZAG1", "wa_x y z w v u"]) expect(isWaRef(bad), bad).toBe(false);
  });
});

describe("list_conversations with platform WA", () => {
  it("lists the unanswered chats with the 24-hour window, and never hands the model a phone number", async () => {
    install([
      row({ authorId: PHONE_A, authorName: "Dana", content: "Is the ring in stock? my number is 0750 123 4567", createdAt: hoursAgo(2) }),
      row({ authorId: PHONE_B, authorName: "Karwan", content: "Thanks!", createdAt: hoursAgo(30) }),
      row({ authorId: PHONE_C, authorName: null, content: "[image] this one?", createdAt: hoursAgo(5) }),
    ]);
    const r = await call("list_conversations", { platform: "WA" });
    const d = r.data as ListData;
    expect(d.total).toBe(3);
    expect(d.conversations.map((c) => c.with)).toEqual(["Dana", undefined, "Karwan"]);
    const dana = d.conversations[0];
    expect(dana).toMatchObject({ platform: "WA", lastFrom: "buyer", canReply: true });
    expect(dana.id).toMatch(/^wa_cmsg\d{8}$/);
    expect(dana.last).toContain("[number]");
    expect(dana.windowClosesAt).toMatch(/\+03:00$/);
    // The chat from 30 hours ago is listed, but the window is closed and nothing says it can be answered.
    expect(d.conversations[2]).toMatchObject({ with: "Karwan", canReply: false });
    expect(d.conversations[2].windowClosesAt).toBeUndefined();
    expect(d.waitingForReply).toBe(2);
    expect(d.olderUnanswered).toBe(1);
    // A photo is a word in brackets for the model, not a file or a link.
    expect(d.conversations[1].last).toBe("[image] this one?");
    // No number, in any shape, anywhere in what the model reads.
    for (const phone of [PHONE_A, PHONE_B, PHONE_C, "7501234567", "501234567"]) expect(json(r.data)).not.toContain(phone);
    expect(wrapForModel(r.data, { untrusted: true })).not.toMatch(/96475|96477|7501234567/);
  });

  it("shows the person the number next to the name, in their own view only", async () => {
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "price?" }), row({ authorId: PHONE_C, authorName: null, content: "hi", createdAt: hoursAgo(3) })]);
    const r = await call("list_conversations", { platform: "WA" });
    const list = r.view?.find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items[0].title).toContain("Dana");
    expect(list.items[0].title).toContain(PHONE_A);
    // A chat without a name is told apart by its number.
    expect(list.items[1].title).toContain(PHONE_C);
    expect(list.items[0].badge).toContain("WhatsApp");
    expect(list.href).toBe("/app/whatsapp");
  });

  it("counts a chat the bot or the owner already answered as answered, and lists it when asked for everything", async () => {
    install(
      [
        row({ authorId: PHONE_A, content: "price?", createdAt: hoursAgo(3) }),
        row({ authorId: PHONE_B, authorName: "Karwan", content: "do you deliver?", createdAt: hoursAgo(4) }),
        row({ authorId: PHONE_B, authorName: "Karwan", direction: "OUTBOUND", content: "Yes, to Erbil.", createdAt: hoursAgo(3.5) }),
        row({ authorId: PHONE_C, authorName: "Sara", content: "size?", createdAt: hoursAgo(6) }),
      ],
      [job({ recipientId: PHONE_C, updatedAt: hoursAgo(5.9), payload: { message: { text: "M and L." } } })],
    );
    const waiting = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(waiting.conversations.map((c) => c.with)).toEqual(["Dana"]);
    const all = (await call("list_conversations", { platform: "WA", unanswered: false })).data as ListData;
    expect(all.total).toBe(3);
    expect(all.conversations.find((c) => c.with === "Karwan")).toMatchObject({ lastFrom: "shop" });
    expect(all.conversations.find((c) => c.with === "Sara")).toMatchObject({ lastFrom: "shop" });
  });

  it("does not offer a chat whose buyer wrote STOP, and says so", async () => {
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "stop", createdAt: hoursAgo(1) }), row({ authorId: PHONE_B, authorName: "Karwan", content: "price?", createdAt: hoursAgo(2) })]);
    const r = await call("list_conversations", { platform: "WA" });
    const d = r.data as ListData;
    expect(d.conversations.find((c) => c.with === "Dana")).toMatchObject({ canReply: false, askedToStop: true });
    expect(d.conversations.find((c) => c.with === "Karwan")?.askedToStop).toBeUndefined();
    expect(d.waitingForReply).toBe(1);
    const list = r.view?.find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items.find((i) => i.title.includes("Dana"))?.badge).toContain(words("en").askedToStop);
    expect(list.items.find((i) => i.title.includes("Dana"))?.badge).not.toContain(dict("en").messages.outsideWindow);
  });

  it("carries the assistant's marks and the open orders like the Messenger list does", async () => {
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "?", outcomeReason: "needs_you" }), row({ authorId: PHONE_B, authorName: "Karwan", content: "ok", createdAt: hoursAgo(2), outcomeReason: "price" })]);
    db.order.findMany.mockResolvedValue([{ buyerKey: PHONE_B }]);
    const d = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(d.conversations.find((c) => c.with === "Dana")).toMatchObject({ needsYou: "needs_you" });
    expect(d.conversations.find((c) => c.with === "Karwan")).toMatchObject({ openOrder: true });
    expect(d.conversations.find((c) => c.with === "Karwan")?.needsYou).toBeUndefined();
    expect(db.order.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("ignores a mark older than three days, as the Messages screen does", async () => {
    install([row({ content: "?", createdAt: hoursAgo(80), outcomeReason: "needs_you" })]);
    const d = (await call("list_conversations", { platform: "WA", unanswered: false })).data as ListData;
    expect(d.conversations[0].needsYou).toBeUndefined();
  });

  it("clips a long sender name and a long message, and takes a number out of a name", async () => {
    install([row({ authorName: `Dana ${"x".repeat(200)} 0750 123 4567`, content: "y".repeat(900) })]);
    const d = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect((d.conversations[0].with ?? "").length).toBeLessThanOrEqual(60);
    expect((d.conversations[0].last ?? "").length).toBeLessThanOrEqual(300);
    install([row({ authorName: "Dana 0750 123 4567", content: "hi" })]);
    const n = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(n.conversations[0].with).toBe("Dana [number]");
  });

  it("takes a number out of a name or a message however its groups are joined", async () => {
    // An en dash (a phone keyboard turns "-" into one), a middle dot, an asterisk, an underscore, the Arabic comma.
    install([row({ authorId: PHONE_A, authorName: "0750\u{2013}123\u{2013}4567", content: "call 0750\u{b7}123\u{b7}4567 or 0750*123*4567 or 0750_123_4567 or 0750\u{60c}123\u{60c}4567" })]);
    const r = await call("list_conversations", { platform: "WA" });
    const c = (r.data as ListData).conversations[0];
    expect(c.with).toBe("[number]");
    expect(c.last).toBe("call [number] or [number] or [number] or [number]");
    expect(json(r.data)).not.toMatch(/0750|4567/);
    const said = "see you at 10:30 - 12:45 on 2026\u{2013}10\u{2013}19, it costs 25,000,000";
    install([row({ authorId: PHONE_A, content: said })]);
    const fine = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(fine.conversations[0].last).toBe(said);
  });

  it("limits the list, newest first, and says how many were left out", async () => {
    install(Array.from({ length: 6 }, (_, i) => row({ authorId: `96475000000${i}`, authorName: `Buyer ${i}`, content: "hi", createdAt: hoursAgo(i + 1) })));
    const d = (await call("list_conversations", { platform: "WA", limit: 3 })).data as ListData & { truncated: boolean };
    expect(d.total).toBe(6);
    expect(d.shown).toBe(3);
    expect(d.truncated).toBe(true);
    expect(d.conversations.map((c) => c.with)).toEqual(["Buyer 0", "Buyer 1", "Buyer 2"]);
  });

  it("asks for nothing from Meta, and reads only this workspace's own WhatsApp store", async () => {
    install([row()]);
    await call("list_conversations", { platform: "WA" });
    expect(data.loadConversations).not.toHaveBeenCalled();
    expect(db.store.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", waPhoneNumberId: { not: null } });
    const q = db.conversationMessage.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ storeId: "s1", platform: "WHATSAPP" });
    expect(q.take).toBe(3000);
    expect(q.orderBy).toEqual({ createdAt: "desc" });
    const days = (NOW - q.where.createdAt.gt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const j = db.outboxJob.findMany.mock.calls[0][0];
    expect(j.where).toMatchObject({ storeId: "s1", status: "SENT", message: { platform: "WHATSAPP" } });
  });

  it("answers with a note, not a throw, when WhatsApp is not connected or cannot be read", async () => {
    install([], [], false);
    const off = await call("list_conversations", { platform: "WA" }, ctx({ lang: "ckb" }));
    expect((off.data as ListData).available).toBe(false);
    expect((off.data as ListData).reason).toBe("not_connected");
    expect(off.view?.[0]).toMatchObject({ kind: "note", text: words("ckb").notConnectedWa });
    db.store.findFirst.mockRejectedValue(new Error("db down"));
    const failed = await call("list_conversations", { platform: "WA" });
    expect((failed.data as ListData).reason).toBe("failed");
    expect(failed.view?.[0]).toMatchObject({ kind: "note", tone: "warn", text: words("en").waFailed });
    const slow = await call("list_conversations", { platform: "WA" }, ctx({ deadline: Date.now() + 500 }));
    expect((slow.data as ListData).reason).toBe("no_time");
  });

  it("keeps a WhatsApp chat out of the Facebook and Instagram lists", async () => {
    install([row()]);
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } });
    const r = await call("list_conversations", { platform: "FB" });
    expect((r.data as ListData).total).toBe(0);
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });
});

describe("list_conversations next to Messenger and Instagram", () => {
  const meta = (over: object = {}) => ({
    platform: "IG",
    id: "igconv1",
    participantId: "psid1",
    participantName: "sara_k",
    withinWindow: true,
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
    messages: [{ id: "m2", text: "price?", fromUs: false, createdAt: new Date(NOW - 3_600_000).toISOString() }],
    ...over,
  });
  const connectMeta = () =>
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: true, name: "shop_ig", accountId: "ig1" }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } });

  it("puts both in one list, the newest first, each with its own platform and id", async () => {
    connectMeta();
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "hi", createdAt: hoursAgo(0.2) })]);
    data.loadConversations.mockResolvedValue({ conversations: [meta()], unreadable: 0, errors: [] });
    const d = (await call("list_conversations")).data as ListData;
    expect(d.conversations.map((c) => [c.platform, c.with])).toEqual([
      ["WA", "Dana"],
      ["IG", "sara_k"],
    ]);
    expect(d.conversations[1].id).toBe("igconv1");
    expect(d.waitingForReply).toBe(2);
  });

  it("is exactly the Meta answer when the shop has no WhatsApp", async () => {
    connectMeta();
    install([], [], false);
    data.loadConversations.mockResolvedValue({ conversations: [meta()], unreadable: 0, errors: [] });
    const d = (await call("list_conversations")).data as ListData;
    expect(d.conversations.map((c) => c.platform)).toEqual(["IG"]);
    expect(d.problems).toBeUndefined();
  });

  it("works for a shop that has only WhatsApp, without a note about Facebook and Instagram", async () => {
    install([row({ content: "hi" })]);
    const r = await call("list_conversations");
    expect((r.data as ListData).available).toBeUndefined();
    expect((r.data as ListData).conversations).toHaveLength(1);
    expect(json(r.view)).not.toContain(words("en").notConnectedMeta);
  });

  it("still says Facebook and Instagram are not connected when WhatsApp is not either", async () => {
    install([], [], false);
    const r = await call("list_conversations");
    expect(r.view?.[0]).toMatchObject({ kind: "note", text: words("en").notConnectedMeta });
  });

  it("gives the WhatsApp chats and tells the person that Meta could not be read", async () => {
    connectMeta();
    install([row({ content: "hi" })]);
    data.loadConversations.mockRejectedValue(new Error("boom"));
    const r = await call("list_conversations");
    const d = r.data as ListData;
    expect(d.conversations).toHaveLength(1);
    expect(d.problems?.[0].platform).toBe("FB_IG");
    expect(r.view?.some((b) => b.kind === "note" && b.tone === "warn" && b.text === words("en").metaFailed)).toBe(true);
  });

  it("gives the Meta chats and tells the person that WhatsApp could not be read", async () => {
    connectMeta();
    data.loadConversations.mockResolvedValue({ conversations: [meta()], unreadable: 0, errors: [] });
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    db.store.findFirst.mockRejectedValue(new Error("db down"));
    const r = await call("list_conversations");
    const d = r.data as ListData;
    expect(d.conversations.map((c) => c.platform)).toEqual(["IG"]);
    expect(d.problems).toEqual([{ platform: "WA", problem: expect.stringContaining("WhatsApp") }]);
    expect(r.view?.some((b) => b.kind === "note" && b.tone === "warn" && b.text === words("en").waFailed)).toBe(true);
  });

  it("does not look for WhatsApp in a news desk, and refuses to be asked for it", async () => {
    connectMeta();
    data.loadConversations.mockResolvedValue({ conversations: [meta()], unreadable: 0, errors: [] });
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    const desk = ctx({ kind: "news" });
    const d = (await call("list_conversations", {}, desk)).data as ListData;
    expect(d.conversations).toHaveLength(1);
    expect(db.store.findFirst).not.toHaveBeenCalled();
    await expect(call("list_conversations", { platform: "WA" }, desk)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(call("get_conversation", { id: "wa_cmsg00000001" }, desk)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(call("get_conversation", { id: "x", platform: "WA" }, desk)).rejects.toBeInstanceOf(ToolRefusal);
  });
});

describe("get_conversation for WhatsApp", () => {
  it("opens a chat by the reference list_conversations gave, oldest first, with no number for the model", async () => {
    install(
      [
        row({ authorId: PHONE_A, authorName: "Dana", content: "Hi, price of the ring? 0750 123 4567", createdAt: hoursAgo(5) }),
        row({ authorId: PHONE_A, direction: "OUTBOUND", content: "[template] order_update", createdAt: hoursAgo(4) }),
        row({ authorId: PHONE_A, authorName: "Dana", content: "[image] this one", createdAt: hoursAgo(1) }),
        row({ authorId: PHONE_B, authorName: "Karwan", content: "other chat", createdAt: hoursAgo(1) }),
      ],
      [job({ recipientId: PHONE_A, updatedAt: hoursAgo(4.9) })],
    );
    const list = (await call("list_conversations", { platform: "WA" })).data as ListData;
    const id = list.conversations.find((c) => c.with === "Dana")!.id;
    const r = await call("get_conversation", { id });
    const d = r.data as Item & { messages: { from: string; text: string; automatic?: boolean }[] };
    expect(d.id).toBe(id);
    expect(d.platform).toBe("WA");
    expect(d.messages.map((m) => m.from)).toEqual(["buyer", "shop", "shop", "buyer"]);
    expect(d.messages[1]).toMatchObject({ automatic: true, text: "Yes, we have it." });
    expect(d.messages[2].text).toBe("[template sent: order_update]");
    expect(d.messages[3].text).toBe("[image] this one");
    expect(d.messages[0].text).toContain("[number]");
    expect(d.canReply).toBe(true);
    // Only this buyer's rows were read.
    expect(db.conversationMessage.findMany.mock.calls.at(-1)?.[0].where.authorId).toBe(PHONE_A);
    for (const phone of [PHONE_A, PHONE_B, "7501234567"]) expect(json(r.data)).not.toContain(phone);
    // The person's view has the number and the words of the WhatsApp screen.
    const view = r.view?.[0];
    if (view?.kind !== "list") throw new Error("no list");
    expect(view.title).toContain(PHONE_A);
    expect(view.items).toHaveLength(4);
    expect(view.items[2].title).toBe(`📋 order_update`);
    expect(view.items[3].title).toBe(`${dict("en").wa.media.image} · this one`);
    expect(view.items[1].sub).toContain(dict("en").wa.bot);
  });

  it("also takes the reference with platform WA, and an older reference of the same chat", async () => {
    const first = row({ authorId: PHONE_A, content: "first", createdAt: hoursAgo(6) });
    install([first, row({ authorId: PHONE_A, content: "second", createdAt: hoursAgo(1) })]);
    const r = await call("get_conversation", { id: waRef(first.id), platform: "WA" });
    expect((r.data as { messages: unknown[] }).messages).toHaveLength(2);
    expect((r.data as { id: string }).id).toBe(waRef(first.id));
  });

  it("refuses a reference that is not among this shop's WhatsApp chats", async () => {
    install([row({ authorId: PHONE_A })]);
    await expect(call("get_conversation", { id: "wa_cmsg99999999" })).rejects.toBeInstanceOf(ToolRefusal);
    // A phone number is not a reference, whatever the model is tempted to pass.
    await expect(call("get_conversation", { id: PHONE_A, platform: "WA" })).rejects.toBeInstanceOf(ToolRefusal);
    expect(db.conversationMessage.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: PHONE_A }) }));
    // A message of another workspace's store is not found: the lookup is bound to this workspace's store.
    db.conversationMessage.findFirst.mockImplementation(async (q: { where: { storeId: string } }) => (q.where.storeId === "someone-else" ? { authorId: PHONE_A } : null));
    await expect(call("get_conversation", { id: "wa_cmsg00000001" })).rejects.toBeInstanceOf(ToolRefusal);
    expect(db.conversationMessage.findFirst.mock.calls.at(-1)?.[0].where).toMatchObject({ storeId: "s1", platform: "WHATSAPP" });
  });

  it("answers with a note when WhatsApp is not connected, and still sends a Meta id to Meta", async () => {
    install([], [], false);
    const off = await call("get_conversation", { id: "wa_cmsg00000001" });
    expect((off.data as ListData).reason).toBe("not_connected");
    // An id that is not a WhatsApp reference never touches the WhatsApp store.
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: true, name: "Page", accountId: "fb1" }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } });
    data.loadConversations.mockResolvedValue({
      conversations: [{ platform: "FB", id: "t_100", participantId: "psid1", participantName: "Ali", withinWindow: true, messages: [{ id: "m1", text: "hi", fromUs: false }] }],
      unreadable: 0,
      errors: [],
    });
    db.store.findFirst.mockClear();
    const meta = await call("get_conversation", { id: "t_100" });
    expect((meta.data as { id: string }).id).toBe("t_100");
    expect(db.store.findFirst).not.toHaveBeenCalled();
    await expect(call("get_conversation", { id: "t_100", platform: "IG" })).rejects.toBeInstanceOf(ToolRefusal);
  });

  it("warns the person when the window is closed or the buyer wrote STOP", async () => {
    install([row({ authorId: PHONE_A, content: "price?", createdAt: hoursAgo(40) }), row({ authorId: PHONE_B, content: "STOP", createdAt: hoursAgo(1) })]);
    const a = (await call("list_conversations", { platform: "WA" })).data as ListData;
    const closed = await call("get_conversation", { id: a.conversations.find((c) => !c.askedToStop && !c.canReply)!.id });
    expect(closed.view?.at(-1)).toMatchObject({ kind: "note", tone: "warn", text: dict("en").wa.outsideWindow });
    expect((closed.data as Item).canReply).toBe(false);
    const stop = await call("get_conversation", { id: a.conversations.find((c) => c.askedToStop)!.id });
    expect(stop.view?.at(-1)).toMatchObject({ kind: "note", tone: "warn", text: dict("en").wa.errors.optedOut });
    expect((stop.data as Item).askedToStop).toBe(true);
  });
});

describe("a chat the owner answered on the phone", () => {
  // With "keep the number on the WhatsApp Business app" the owner can answer from the phone. The webhook stores no message for that;
  // it only pauses the bot in the chat. So the chat still ends on the buyer's line, and the pause that came after that line is the
  // one sign that it was answered: listing it as waiting would have the model propose a second answer.
  it("is not waiting, is not marked 'needs you' any more, and says why when everything is listed", async () => {
    install(
      [
        row({ authorId: PHONE_A, authorName: "Dana", content: "price?", createdAt: hoursAgo(3), outcomeReason: "needs_you" }),
        row({ authorId: PHONE_B, authorName: "Karwan", content: "do you deliver?", createdAt: hoursAgo(2) }),
      ],
      [],
      true,
      [pause(PHONE_A, hoursAgo(2.5))],
    );
    const waiting = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(waiting.conversations.map((c) => c.with)).toEqual(["Karwan"]);
    expect(waiting.waitingForReply).toBe(1);
    const all = await call("list_conversations", { platform: "WA", unanswered: false });
    const d = all.data as ListData;
    const dana = d.conversations.find((c) => c.with === "Dana");
    expect(dana).toMatchObject({ lastFrom: "buyer", answeredOnPhone: true, canReply: true });
    expect(dana?.needsYou).toBeUndefined();
    expect(d.conversations.find((c) => c.with === "Karwan")?.answeredOnPhone).toBeUndefined();
    const list = all.view?.find((b) => b.kind === "list");
    if (list?.kind !== "list") throw new Error("no list");
    expect(list.items.find((i) => i.title.includes("Dana"))?.badge).toContain(words("en").answeredOnPhone);
    expect(list.items.find((i) => i.title.includes("Karwan"))?.badge).not.toContain(words("en").answeredOnPhone);
  });

  it("is waiting again when the buyer writes after the pause", async () => {
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "one more thing", createdAt: hoursAgo(1) })], [], true, [pause(PHONE_A, hoursAgo(20))]);
    const d = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(d.conversations.map((c) => c.with)).toEqual(["Dana"]);
    expect(d.conversations[0].answeredOnPhone).toBeUndefined();
    expect(d.waitingForReply).toBe(1);
  });

  it("looks at the pauses of this workspace's WhatsApp chats only, and one buyer's pause does not answer another's chat", async () => {
    install(
      [row({ authorId: PHONE_A, authorName: "Dana", createdAt: hoursAgo(3) }), row({ authorId: PHONE_B, authorName: "Karwan", createdAt: hoursAgo(2) })],
      [],
      true,
      [pause(PHONE_C, hoursAgo(1)), pause(PHONE_B, hoursAgo(1))],
    );
    const d = (await call("list_conversations", { platform: "WA" })).data as ListData;
    expect(d.conversations.map((c) => c.with)).toEqual(["Dana"]);
    const q = db.threadPause.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ tenantId: "t1", platform: "WHATSAPP" });
    expect([...q.where.threadKey.in].sort()).toEqual([PHONE_A, PHONE_B].sort());
  });

  it("is told apart from a chat answered from the Gituas screen (a stored line of the owner's) and from the bot's own answer", async () => {
    install(
      [
        row({ authorId: PHONE_A, authorName: "Dana", content: "price?", createdAt: hoursAgo(3) }),
        row({ authorId: PHONE_A, direction: "OUTBOUND", content: "20,000 IQD", createdAt: hoursAgo(2.5) }),
        row({ authorId: PHONE_B, authorName: "Karwan", content: "size?", createdAt: hoursAgo(3) }),
      ],
      [job({ recipientId: PHONE_B, updatedAt: hoursAgo(2.9) })],
      true,
      [pause(PHONE_A, hoursAgo(2.5)), pause(PHONE_B, hoursAgo(1))],
    );
    const d = (await call("list_conversations", { platform: "WA", unanswered: false })).data as ListData;
    expect(d.conversations.map((c) => [c.with, c.lastFrom, c.answeredOnPhone])).toEqual([
      ["Dana", "shop", undefined],
      ["Karwan", "shop", undefined],
    ]);
  });

  it("opens with the same answer, and tells the person in their language", async () => {
    install([row({ authorId: PHONE_A, authorName: "Dana", content: "price?", createdAt: hoursAgo(3) })], [], true, [pause(PHONE_A, hoursAgo(2))]);
    const id = ((await call("list_conversations", { platform: "WA", unanswered: false })).data as ListData).conversations[0].id;
    for (const lang of ["en", "ar", "ckb"] as const) {
      const r = await call("get_conversation", { id }, ctx({ lang }));
      expect((r.data as Item).answeredOnPhone).toBe(true);
      expect(r.view?.at(-1)).toMatchObject({ kind: "note", text: words(lang).answeredOnPhone });
    }
  });

  it("is decided by answeredOnPhone: the buyer's line is the last one, and the pause came after it", () => {
    const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    const line = (from: "them" | "bot" | "you", h: number) => ({ id: "l", from, text: "x", at: at(h) });
    expect(answeredOnPhone({ lines: [line("them", 3)], pausedAt: at(2) })).toBe(true);
    expect(answeredOnPhone({ lines: [line("them", 3)], pausedAt: at(4) })).toBe(false);
    expect(answeredOnPhone({ lines: [line("them", 3)] })).toBe(false);
    expect(answeredOnPhone({ lines: [line("them", 3), line("bot", 2.9)], pausedAt: at(2) })).toBe(false);
    expect(answeredOnPhone({ lines: [], pausedAt: at(2) })).toBe(false);
  });
});

describe("the WhatsApp loader is the screen's", () => {
  it("groups by buyer, takes the name from the buyer's own messages, orders chats by their last line and drops a chat it cannot refer to", async () => {
    const a1 = row({ authorId: PHONE_A, authorName: "Dana", content: "one", createdAt: hoursAgo(10) });
    const a2 = row({ authorId: PHONE_A, authorName: "Dana K", content: "two", createdAt: hoursAgo(2) });
    const aOut = row({ authorId: PHONE_A, authorName: "Shop owner", direction: "OUTBOUND", content: "reply", createdAt: hoursAgo(1.5) });
    const b1 = row({ authorId: PHONE_B, authorName: "Karwan", content: "hello", createdAt: hoursAgo(3) });
    install([a1, a2, aOut, b1, row({ authorId: null, content: "no author" })], [job({ recipientId: PHONE_C, updatedAt: hoursAgo(1) }), job({ recipientId: PHONE_B, updatedAt: hoursAgo(0.5), kind: "DM_PHOTOS", payload: { urls: ["u1", "u2"] } })]);
    const chats = await loadWaChats({ id: "s1", tenantId: "t1", waPhoneNumberId: "pn1" });
    expect(chats.map((c) => c.buyerId)).toEqual([PHONE_B, PHONE_A]);
    const a = chats[1];
    expect(a.name).toBe("Dana K");
    expect(a.lines.map((l) => l.from)).toEqual(["them", "them", "you"]);
    expect(a.ref).toBe(waRef(aOut.id));
    expect(a.lastInboundAt).toBe(a2.createdAt.toISOString());
    const b = chats[0];
    expect(b.lines.at(-1)).toMatchObject({ from: "bot", photos: 2 });
    // The chat that only the bot answered (no stored message row) cannot be referred to, so it is not listed.
    expect(chats.some((c) => c.buyerId === PHONE_C)).toBe(false);
  });

  it("lists at most a hundred chats", async () => {
    install(Array.from({ length: 130 }, (_, i) => row({ authorId: `96475${String(i).padStart(7, "0")}`, createdAt: hoursAgo(1 + i / 100) })));
    expect(await loadWaChats({ id: "s1", tenantId: "t1", waPhoneNumberId: "pn1" })).toHaveLength(100);
  });
});

describe("the WhatsApp words", () => {
  const chat = (over: object = {}) => ({ buyerId: PHONE_A, ref: "wa_cmsg00000001", name: "Dana", lines: [], lastInboundAt: new Date(NOW - 3_600_000).toISOString(), lastInboundText: "hi", ...over });

  it("labels media, templates and the bot's photos the way the screen does, and plainly for the model", () => {
    const en = dict("en");
    expect(waLabel({ text: "[image] cap" }, en)).toBe(`${en.wa.media.image} · cap`);
    expect(waLabel({ text: "[audio]" }, en)).toBe(en.wa.media.audio);
    expect(waLabel({ text: "[template] hello_1" }, en)).toBe("📋 hello_1");
    expect(waLabel({ text: "", photos: 3 }, en)).toBe(`${en.wa.media.image} × 3`);
    expect(waPlain({ text: "[image] cap" })).toBe("[image] cap");
    expect(waPlain({ text: "[document]" })).toBe("[document]");
    expect(waPlain({ text: "[template] hello_1" })).toBe("[template sent: hello_1]");
    expect(waPlain({ text: "", photos: 2 })).toBe("[image x2]");
    expect(waPlain({ text: "plain words" })).toBe("plain words");
  });

  it("reads the 24 hours as the send action does, and a STOP in any of its spellings", () => {
    expect(windowOpen(chat(), NOW)).toBe(true);
    expect(windowOpen(chat({ lastInboundAt: new Date(NOW - 24 * 3_600_000 - 1000).toISOString() }), NOW)).toBe(false);
    expect(windowOpen(chat({ lastInboundAt: null }), NOW)).toBe(false);
    for (const stop of ["STOP", "stop.", "Unsubscribe", "وەستان", "توقف", "إلغاء"]) expect(askedToStop({ lastInboundText: stop }), stop).toBe(true);
    for (const fine of ["", "please stop the video", "ok", "stop it now"]) expect(askedToStop({ lastInboundText: fine }), fine).toBe(false);
  });

  it("builds items that hold the number only in the field the model never reads", () => {
    const items = waItems([{ ...chat({ lines: [{ id: "l1", from: "them", text: "hi", at: new Date(NOW - 3_600_000).toISOString() }] }) }], new Set([PHONE_A]), NOW, dict("en"));
    expect(items[0]).toMatchObject({ id: "wa_cmsg00000001", platform: "WA", phone: PHONE_A, orderOpen: true, unanswered: true, canReply: true });
    expect(tool("list_conversations").description).toContain("WA");
    expect(tool("get_conversation").description).toContain("WA");
  });

  it("exist in Sorani, Arabic and English, with no Kurdish-only letter in the Arabic", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const w = words(lang);
      for (const text of [w.notConnectedWa, w.waTooSlow, w.waFailed, w.askedToStop, w.answeredOnPhone]) expect(text.trim(), lang).not.toBe("");
    }
    const ar = words("ar");
    for (const text of [ar.notConnectedWa, ar.waTooSlow, ar.waFailed, ar.askedToStop, ar.answeredOnPhone]) expect(text).not.toMatch(/[کیەێۆڕڵڤپچژگ]/);
    expect(words("en").notConnectedWa).not.toMatch(/[؀-ۿ]/);
  });
});
