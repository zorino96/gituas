import { beforeEach, describe, expect, it, vi } from "vitest";

// send_message on WhatsApp. The database and the WhatsApp screen's send action are replaced; what is tested is the part that is ours:
// the chat is found only inside this workspace's own WhatsApp store by the reference list_conversations gave, the card names the
// person (never the number) and shows the exact words, a closed window, a STOP, a news desk or an unknown chat is a clear refusal,
// and the run hands the screen's action the number the chat was found by, never anything the model wrote.

const world = vi.hoisted(() => ({
  messageRows: [] as { id: string; storeId: string; direction: "INBOUND" | "OUTBOUND"; content: string | null; authorId: string | null; authorName: string | null; createdAt: Date; outcomeReason: string | null }[],
  jobs: [] as { id: string; kind: string; payload: unknown; recipientId: string | null; updatedAt: Date }[],
  store: { id: "s1", waPhoneNumberId: "pn1" } as { id: string; waPhoneNumberId: string } | null,
}));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn() },
  order: { findFirst: vi.fn() },
  scheduledPost: { findFirst: vi.fn() },
  conversationMessage: { findMany: vi.fn(), findFirst: vi.fn() },
  outboxJob: { findMany: vi.fn() },
  threadPause: { findMany: vi.fn() },
}));
const actions = vi.hoisted(() => ({
  sendWhatsAppAction: vi.fn(),
  sendMessageAction: vi.fn(),
  newsCardGuard: vi.fn(),
  newsRunGuard: vi.fn(),
  loadConversations: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: [], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({ META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } })),
  loadPosts: vi.fn(async () => ({ posts: [], errors: [] })),
  loadConversations: actions.loadConversations,
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
  sendMessageAction: actions.sendMessageAction,
}));
vi.mock("@/app/app/whatsapp/actions", () => ({ sendWhatsAppAction: actions.sendWhatsAppAction }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn(), cancelScheduledAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/app/orders/actions", () => ({ setOrderStatusAction: vi.fn() }));
// The desk's own two checks are tested with the desk's tools (writes-news.test.ts); here they only have to be asked.
vi.mock("@/lib/chat/tools/writes-news-common", async (original) => ({
  ...(await original<typeof import("@/lib/chat/tools/writes-news-common")>()),
  newsCardGuard: actions.newsCardGuard,
  newsRunGuard: actions.newsRunGuard,
}));

import { decide } from "@/lib/chat/guard";
import { toolSpecs } from "@/lib/chat/registry";
import { waRef } from "@/lib/chat/tools/reads-wa-live";
import { WRITE_TOOLS } from "@/lib/chat/tools/writes";
import { findWhatsAppChat } from "@/lib/chat/tools/writes-wa";
import { NEW } from "@/lib/chat/tools/writes-words";
import { ToolRefusal, type Card, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";

const ctxOf = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [],
  review: true,
  deadline: Date.now() + 60_000,
  ...over,
});
const send = WRITE_TOOLS.find((t) => t.name === "send_message") as WriteTool;
const parse = (args: unknown) => send.schema.parse(args);
const cardOf = (args: unknown, ctx = ctxOf()): Promise<Card> => send.card(ctx, parse(args));
const run = (args: unknown, ctx = ctxOf()) => send.execute(ctx, parse(args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);
const PHONE = "9647501234567";
const OTHER = "9647709876543";
let seq = 0;
const message = (over: Partial<(typeof world.messageRows)[number]> = {}) => {
  const m = {
    id: `cmsg${String(++seq).padStart(8, "0")}`,
    storeId: "s1",
    direction: "INBOUND" as const,
    content: "Is the ring in stock?",
    authorId: PHONE as string | null,
    authorName: "Dana" as string | null,
    createdAt: hoursAgo(1),
    outcomeReason: null,
    ...over,
  };
  world.messageRows.push(m);
  return m;
};
const REF = () => waRef(world.messageRows[0].id);

beforeEach(() => {
  vi.resetAllMocks();
  seq = 0;
  world.messageRows = [];
  world.jobs = [];
  world.store = { id: "s1", waPhoneNumberId: "pn1" };
  db.store.findFirst.mockImplementation(async () => world.store);
  // The database as the loader's queries see it: narrowed by the store, the platform and the buyer.
  db.conversationMessage.findMany.mockImplementation(async (q: { where: { storeId: string; authorId?: string } }) =>
    world.messageRows.filter((r) => r.storeId === q.where.storeId && (!q.where.authorId || r.authorId === q.where.authorId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );
  db.conversationMessage.findFirst.mockImplementation(async (q: { where: { id: string; storeId: string } }) => {
    const r = world.messageRows.find((x) => x.id === q.where.id && x.storeId === q.where.storeId);
    return r ? { authorId: r.authorId } : null;
  });
  db.outboxJob.findMany.mockImplementation(async () => world.jobs);
  db.threadPause.findMany.mockResolvedValue([]);
  db.order.findFirst.mockResolvedValue(null);
  actions.newsCardGuard.mockResolvedValue(undefined);
  actions.newsRunGuard.mockResolvedValue(null);
  actions.loadConversations.mockResolvedValue({ conversations: [], unreadable: 0, errors: [] });
});

describe("send_message: the tool", () => {
  it("takes WA next to FB and IG, and nothing else, and still always asks for a card", () => {
    expect(parse({ platform: "WA", conversation: "wa_cmsg00000001", text: "Yes" })).toMatchObject({ platform: "WA" });
    for (const platform of ["FB", "IG"]) expect(parse({ platform, conversation: "c", text: "Yes" })).toMatchObject({ platform });
    for (const platform of ["TT", "WHATSAPP", "wa", ""]) expect(() => parse({ platform, conversation: "c", text: "Yes" }), platform).toThrow();
    expect(() => parse({ platform: "WA", conversation: "wa_cmsg00000001", text: "x".repeat(1001) })).toThrow();
    // A number the model adds as an extra argument goes nowhere: the schema drops it, and the run takes the number from the chat.
    expect(parse({ platform: "WA", conversation: "wa_cmsg00000001", text: "Yes", to: PHONE })).toEqual({ platform: "WA", conversation: "wa_cmsg00000001", text: "Yes" });
    expect(send.risk).toBe("outbound");
    expect(send.riskFor).toBeUndefined();
    expect(send.textFields).toEqual(["text"]);
    expect(send.permission).toBe("engage");
    expect(send.kinds).toEqual(["shop", "news"]);
    // A message to a named person never runs by itself, whatever the autonomy.
    for (const autonomy of ["ASK", "LOW", "ALL"] as const) expect(decide({ risk: send.risk, autonomy, tainted: false }), autonomy).toBe("confirm");
  });

  it("tells the model what WhatsApp can and cannot do here", () => {
    const spec = toolSpecs([send])[0].function;
    expect(spec.description).toMatch(/WA \(WhatsApp/);
    expect(spec.description).toMatch(/templates are not part of the chat/i);
    expect(spec.description).toMatch(/STOP/);
    expect(spec.description).not.toMatch(/WhatsApp is not supported/);
    expect(JSON.stringify(spec.parameters)).toContain('"WA"');
  });
});

describe("send_message on WhatsApp: the card", () => {
  it("shows to whom (the name), what they last said and the exact words, and that the bot will stay out", async () => {
    message({ content: "Is the ring in stock? call me 0750 123 4567" });
    const c = await cardOf({ platform: "WA", conversation: REF(), text: "Yes, it is in stock." });
    expect(c.title).toBe("Send a message");
    expect(c.lines).toEqual([
      { label: "Platform", value: "WhatsApp" },
      { label: "To", value: "Dana" },
      { label: "Their last message", value: "Is the ring in stock? call me 0750 123 4567" },
      { label: "Message", value: "Yes, it is in stock." },
      { label: "Note", value: NEW.waBotPaused.en },
    ]);
    // The person's buyer is told apart by name: the number is on no line of the card.
    expect(JSON.stringify(c)).not.toContain(PHONE);
    expect(JSON.stringify(c)).not.toContain("wa_cmsg");
    expect(actions.sendWhatsAppAction).not.toHaveBeenCalled();
    expect(actions.loadConversations).not.toHaveBeenCalled();
  });

  it("words a photo as the WhatsApp screen does, and a buyer without a name as a customer", async () => {
    message({ content: "[image] this one?", authorName: null });
    const c = await cardOf({ platform: "WA", conversation: REF(), text: "Yes" });
    expect(c.lines.find((l) => l.label === "To")?.value).toBe(dict("en").messages.customer);
    expect(c.lines.find((l) => l.label === "Their last message")?.value).toBe(`${dict("en").wa.media.image} · this one?`);
  });

  it("is complete in Sorani, Arabic and English", async () => {
    message();
    for (const lang of ["ckb", "ar", "en"] as Lang[]) {
      const c = await cardOf({ platform: "WA", conversation: REF(), text: "x" }, ctxOf({ lang }));
      expect(c.title.trim()).not.toBe("");
      expect(c.lines).toHaveLength(5);
      for (const l of c.lines) {
        expect(l.label.trim(), lang).not.toBe("");
        expect(l.value.trim(), lang).not.toBe("");
        if (lang === "ar") expect(l.label).not.toMatch(/[کیەێۆڕڵڤپچژگ]/);
      }
      expect(c.lines.at(-1)?.value).toBe(NEW.waBotPaused[lang]);
      expect(c.lines[0].value).toBe(dict(lang).wa.nav);
    }
  });

  it("says on the card that the bot's silence is for good and cannot be switched back on, in all three languages", () => {
    for (const lang of ["ckb", "ar", "en"] as Lang[]) expect(NEW.waBotPaused[lang].trim(), lang).not.toBe("");
    expect(NEW.waBotPaused.en).toMatch(/for good/);
    expect(NEW.waBotPaused.en).toMatch(/cannot be switched back on/);
    // Arabic without a Kurdish-only letter; Sorani is its own wording, not the Arabic one.
    expect(NEW.waBotPaused.ar).not.toMatch(/[کیەێۆڕڵڤپچژگ]/);
    expect(NEW.waBotPaused.ar).toMatch(/نهائياً/);
    expect(NEW.waBotPaused.ar).toMatch(/لا يمكن إعادة تشغيله/);
    expect(NEW.waBotPaused.ckb).toMatch(/بۆ هەمیشە/);
    expect(NEW.waBotPaused.ckb).toMatch(/ناتوانرێت/);
    expect(NEW.waBotPaused.ckb).not.toMatch(/[كي]/);
  });

  it("refuses a closed window and says that templates are not part of the chat", async () => {
    message({ createdAt: hoursAgo(25) });
    const why = await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }));
    expect(why).toMatch(/24-hour window is closed/);
    expect(why).toMatch(/templates are not part of the chat/i);
    expect(why).toMatch(/WhatsApp screen/);
    // The buyer's own latest message decides, not an earlier one or the shop's own.
    world.messageRows = [];
    const old = message({ createdAt: hoursAgo(30) });
    message({ createdAt: hoursAgo(2), direction: "OUTBOUND", content: "We reply" });
    expect(await refusal(cardOf({ platform: "WA", conversation: waRef(old.id), text: "hi" }))).toMatch(/24-hour window/);
  });

  it("refuses a buyer whose newest message is STOP", async () => {
    message({ content: "STOP" });
    const why = await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }));
    expect(why).toMatch(/STOP/);
    expect(why).toMatch(/Do not write/);
  });

  it("treats STOP first: a buyer who opted out and whose window is closed too is never pointed at a template", async () => {
    message({ content: "STOP", createdAt: hoursAgo(30) });
    const why = await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }));
    expect(why).toMatch(/STOP/);
    expect(why).toMatch(/nothing can be sent/);
    expect(why).not.toMatch(/template/i);
    expect(why).not.toMatch(/24-hour window is closed:/);
    // The run looks the same way, so a card that waited past the window still sends nothing.
    expect(await run({ platform: "WA", conversation: REF(), text: "hi" })).toEqual({ ok: false, text: NEW.stale.en });
    expect(actions.sendWhatsAppAction).not.toHaveBeenCalled();
    // A closed window without a STOP keeps its own wording, with the template pointer.
    world.messageRows = [];
    message({ content: "price?", createdAt: hoursAgo(30) });
    expect(await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }))).toMatch(/approved template/);
  });

  it("writes again after the buyer writes again, even if an earlier message was STOP", async () => {
    message({ content: "stop", createdAt: hoursAgo(5) });
    message({ content: "sorry, I changed my mind: price?", createdAt: hoursAgo(1) });
    const c = await cardOf({ platform: "WA", conversation: waRef(world.messageRows[0].id), text: "Of course" });
    expect(c.lines.find((l) => l.label === "Their last message")?.value).toContain("price?");
  });

  it("refuses a chat that is not this shop's, a phone number, and a shop with no WhatsApp", async () => {
    message();
    expect(await refusal(cardOf({ platform: "WA", conversation: "wa_cmsg99999999", text: "hi" }))).toMatch(/list_conversations/);
    // A number is not a reference: nothing is looked up, nothing is sent.
    expect(await refusal(cardOf({ platform: "WA", conversation: PHONE, text: "hi" }))).toMatch(/list_conversations/);
    expect(db.conversationMessage.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: PHONE }) }));
    // A message of another workspace's store: the lookup is bound to this workspace's store.
    world.messageRows[0].storeId = "other-store";
    expect(await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }))).toMatch(/was not found/);
    expect(db.store.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", waPhoneNumberId: { not: null } });
    world.store = null;
    expect(await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }))).toMatch(/not connected/);
  });

  it("is refused for a news desk, after the desk's own checks", async () => {
    message();
    const desk = ctxOf({ kind: "news" });
    expect(await refusal(cardOf({ platform: "WA", conversation: REF(), text: "hi" }, desk))).toMatch(/news desk has no WhatsApp/);
    expect(actions.newsCardGuard).toHaveBeenCalledTimes(1);
    expect(await run({ platform: "WA", conversation: REF(), text: "hi" }, desk).then((r) => r.text)).toBe(NEW.stale.en);
    expect(actions.newsRunGuard).toHaveBeenCalledTimes(1);
    expect(actions.sendWhatsAppAction).not.toHaveBeenCalled();
    await expect(findWhatsAppChat(desk, REF())).rejects.toBeInstanceOf(ToolRefusal);
  });
});

describe("send_message on WhatsApp: the run", () => {
  it("hands the WhatsApp screen's action the buyer's number it found the chat by, and the exact words", async () => {
    message();
    message({ authorId: OTHER, authorName: "Karwan", content: "other chat" });
    actions.sendWhatsAppAction.mockResolvedValue({ ok: true });
    expect(await run({ platform: "WA", conversation: REF(), text: "Yes, it is in stock." })).toEqual({ ok: true, text: "The message was sent." });
    expect(actions.sendWhatsAppAction).toHaveBeenCalledTimes(1);
    expect(actions.sendWhatsAppAction).toHaveBeenCalledWith(PHONE, "Yes, it is in stock.");
    // Messenger and Instagram are not touched.
    expect(actions.sendMessageAction).not.toHaveBeenCalled();
    expect(actions.loadConversations).not.toHaveBeenCalled();
    expect(await run({ platform: "WA", conversation: waRef(world.messageRows[1].id), text: "Hello" }, ctxOf({ lang: "ckb" }))).toEqual({ ok: true, text: NEW.done.sent.ckb });
    expect(actions.sendWhatsAppAction).toHaveBeenLastCalledWith(OTHER, "Hello");
  });

  it("passes on the action's own sentence when the action refuses", async () => {
    message();
    actions.sendWhatsAppAction.mockResolvedValue({ ok: false, error: "More than 24 hours: send a template." });
    expect(await run({ platform: "WA", conversation: REF(), text: "hi" })).toEqual({ ok: false, text: "More than 24 hours: send a template." });
  });

  it("looks again before sending: a card that waited past the 24 hours, or past a STOP, sends nothing", async () => {
    const m = message({ createdAt: hoursAgo(1) });
    actions.sendWhatsAppAction.mockResolvedValue({ ok: true });
    const args = { platform: "WA", conversation: waRef(m.id), text: "hi" };
    // The card is fine now ...
    await cardOf(args);
    // ... and the window closes before Confirm.
    m.createdAt = hoursAgo(25);
    expect(await run(args)).toEqual({ ok: false, text: NEW.stale.en });
    // The buyer writes STOP while the card waits.
    m.createdAt = hoursAgo(3);
    await cardOf(args);
    message({ createdAt: hoursAgo(1), content: "STOP" });
    expect(await run(args)).toEqual({ ok: false, text: NEW.stale.en });
    // The number is disconnected while the card waits.
    world.messageRows.pop();
    world.store = null;
    expect(await run(args)).toEqual({ ok: false, text: NEW.stale.en });
    expect(actions.sendWhatsAppAction).not.toHaveBeenCalled();
  });
});

describe("send_message on Messenger and Instagram", () => {
  it("is as it was: Meta's list, Meta's action, and WhatsApp never asked", async () => {
    actions.loadConversations.mockResolvedValue({
      conversations: [{ platform: "FB", id: "conv1", participantId: "psid1", participantName: "Dana", withinWindow: true, messages: [{ id: "m1", text: "Is the ring in stock?", fromUs: false }] }],
      unreadable: 0,
      errors: [],
    });
    actions.sendMessageAction.mockResolvedValue({ ok: true });
    // (the Facebook account must be connected for this shop)
    const data = await import("@/app/app/data");
    vi.mocked(data.loadConnections).mockResolvedValue({ META_FACEBOOK: { connected: true, accountId: "fb1", name: "Page" }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } } as never);
    const c = await cardOf({ platform: "FB", conversation: "conv1", text: "Yes" });
    expect(c.lines[0]).toEqual({ label: "Platform", value: "Facebook" });
    expect(await run({ platform: "FB", conversation: "conv1", text: "Yes" })).toEqual({ ok: true, text: "The message was sent." });
    expect(actions.sendMessageAction).toHaveBeenCalledWith("FB", "psid1", "Yes", "fb1");
    expect(actions.sendWhatsAppAction).not.toHaveBeenCalled();
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });
});
