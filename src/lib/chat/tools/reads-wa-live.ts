// WhatsApp for the chat tools: the shop's stored WhatsApp chats, read the way the WhatsApp screen reads them.
//
// The screen's loader (src/app/app/whatsapp/page.tsx) is written inline in the page, so it cannot be called from here. This file is
// the same queries and the same grouping in one place, shared by list_conversations, get_conversation and send_message; the page
// itself is untouched. The one difference is on purpose: a chat is only listed when it has a stored message row, because the chat's
// reference (below) is built from that row.
//
// Privacy: the buyer's WhatsApp id IS their phone number. It lives here as `buyerId`, is what the WhatsApp screen's send action takes,
// and never leaves the server: the model is handed `ref`, an opaque reference, and send_message turns it back into `buyerId` itself.

import { db } from "@/lib/db";
import { withinDeadline } from "./reads-shared";

const DAY = 86_400_000;
/** Chats shown: the last 30 days of WhatsApp messages (the screen's own range). */
export const WA_SINCE_DAYS = 30;
/** The screen lists at most this many chats. */
const WA_CHATS_MAX = 100;
/** The newest rows read (the screen's own number), so a busy shop loses its oldest messages, not its latest. */
const WA_ROWS_MAX = 3000;
/** The assistant's "needs you" and "unclear" marks count for three days, as on the Messages screen. */
const FLAG_DAYS = 3;

export const WA_REF_PREFIX = "wa_";
const REF = /^wa_([A-Za-z0-9_-]{8,64})$/;

/** The reference of a chat: the id of one of its stored messages. It says nothing about the buyer's number, and it stays good after newer messages arrive. */
export const waRef = (messageRowId: string): string => `${WA_REF_PREFIX}${messageRowId}`;
/** The stored message id inside a reference, or null when the text is not a WhatsApp reference. */
export const parseWaRef = (ref: string): string | null => REF.exec(ref.trim())?.[1] ?? null;
export const isWaRef = (ref: string): boolean => parseWaRef(ref) !== null;

export type WaUnreadable = "not_connected" | "no_time" | "timeout" | "failed";

export interface WaLine {
  id: string;
  /** "them" = the buyer, "you" = the owner typing (or a template), "bot" = Gituas' automatic answer. */
  from: "them" | "bot" | "you";
  /** The stored text: plain, a media token such as "[image] caption", or "[template] name". Empty for a bot's photos. */
  text: string;
  /** ISO time. */
  at: string;
  /** A bot's photos: how many were sent. */
  photos?: number;
}

export interface WaChat {
  /** The buyer's WhatsApp id: their phone digits. NEVER for the model. */
  buyerId: string;
  /** What list_conversations hands out and send_message takes. */
  ref: string;
  /** The profile name the buyer's phone gives. */
  name: string | null;
  /** Oldest first. */
  lines: WaLine[];
  /** When the buyer last wrote (ISO), or null when only the shop has written. */
  lastInboundAt: string | null;
  /** The buyer's newest message as stored, to see whether it is a STOP. */
  lastInboundText: string;
  /** Why the assistant left the buyer's last message for the owner. */
  flag?: "needs_you" | "unclear";
  /**
   * When the bot was first silenced in this chat (ISO), if it was. An answer the owner types on the phone (WhatsApp coexistence)
   * is stored nowhere as a message: the webhook only pauses the bot, so this is the one trace of it (see answeredOnPhone).
   */
  pausedAt?: string;
}

export interface WaStore {
  id: string;
  /** The workspace the store belongs to: the bot's pauses are kept per workspace. */
  tenantId: string;
  waPhoneNumberId: string;
}

/** The shop store that holds the WhatsApp number: the same lookup as the WhatsApp screen. */
export async function waStoreOf(tenantId: string): Promise<WaStore | null> {
  const s = await db.store.findFirst({ where: { tenantId, waPhoneNumberId: { not: null } }, select: { id: true, waPhoneNumberId: true } });
  return s?.waPhoneNumberId ? { id: s.id, tenantId, waPhoneNumberId: s.waPhoneNumberId } : null;
}

interface Acc {
  buyerId: string;
  name: string | null;
  lines: WaLine[];
  lastInboundAt: string | null;
  lastInboundText: string;
  reason: string | null;
  newestRow: string | null;
}

/**
 * The chats of one store, newest first: the WhatsApp screen's rows and bot answers, grouped by buyer. With `authorId` only that
 * buyer's chat is read (the same queries, narrowed).
 */
export async function loadWaChats(store: WaStore, opts: { authorId?: string; now?: number } = {}): Promise<WaChat[]> {
  const now = opts.now ?? Date.now();
  const since = new Date(now - WA_SINCE_DAYS * DAY);
  const [rows, jobs] = await Promise.all([
    db.conversationMessage.findMany({
      where: { storeId: store.id, platform: "WHATSAPP", createdAt: { gt: since }, ...(opts.authorId ? { authorId: opts.authorId } : {}) },
      orderBy: { createdAt: "desc" },
      take: WA_ROWS_MAX,
      select: { id: true, direction: true, content: true, authorId: true, authorName: true, createdAt: true, outcomeReason: true },
    }),
    db.outboxJob.findMany({
      where: {
        storeId: store.id,
        status: "SENT",
        kind: { in: ["DM_ANSWER", "DM_PHOTOS"] },
        message: { platform: "WHATSAPP" },
        updatedAt: { gt: since },
        ...(opts.authorId ? { recipientId: opts.authorId } : {}),
      },
      select: { id: true, kind: true, payload: true, recipientId: true, updatedAt: true },
    }),
  ]);

  const byChat = new Map<string, Acc>();
  const chat = (id: string): Acc => {
    let c = byChat.get(id);
    if (!c) byChat.set(id, (c = { buyerId: id, name: null, lines: [], lastInboundAt: null, lastInboundText: "", reason: null, newestRow: null }));
    return c;
  };
  for (const r of [...rows].reverse()) {
    if (!r.authorId) continue;
    const c = chat(r.authorId);
    const inbound = r.direction === "INBOUND";
    if (inbound) {
      c.name = r.authorName ?? c.name;
      c.lastInboundAt = r.createdAt.toISOString();
      c.lastInboundText = r.content ?? "";
      // Only the buyer's newest message counts: once a later one was answered, the chat is out of the pile.
      c.reason = now - r.createdAt.getTime() <= FLAG_DAYS * DAY ? r.outcomeReason : null;
    }
    c.lines.push({ id: r.id, from: inbound ? "them" : "you", text: r.content ?? "", at: r.createdAt.toISOString() });
    c.newestRow = r.id;
  }
  for (const j of jobs) {
    if (!j.recipientId) continue;
    const p = (j.payload ?? {}) as { message?: { text?: string }; urls?: string[] };
    const line: WaLine =
      j.kind === "DM_ANSWER"
        ? { id: j.id, from: "bot", text: p.message?.text ?? "", at: j.updatedAt.toISOString() }
        : { id: j.id, from: "bot", text: "", at: j.updatedAt.toISOString(), photos: p.urls?.length ?? 0 };
    chat(j.recipientId).lines.push(line);
  }

  const chats = [...byChat.values()]
    .filter((c): c is Acc & { newestRow: string } => c.newestRow !== null)
    .map((c): WaChat => ({
      buyerId: c.buyerId,
      ref: waRef(c.newestRow),
      name: c.name,
      lines: [...c.lines].sort((a, b) => a.at.localeCompare(b.at)),
      lastInboundAt: c.lastInboundAt,
      lastInboundText: c.lastInboundText,
      ...(c.reason === "needs_you" || c.reason === "unclear" ? { flag: c.reason } : {}),
    }))
    .sort((a, b) => b.lines[b.lines.length - 1].at.localeCompare(a.lines[a.lines.length - 1].at))
    .slice(0, WA_CHATS_MAX);

  // The bot's pauses, for the chats that are listed only. The webhook pauses a buyer's thread when the owner answers on the phone and
  // stores no message for it, so the pause is the only sign that such a chat was answered. Pauses are kept per workspace.
  if (!chats.length) return chats;
  const pauses = await db.threadPause.findMany({
    where: { tenantId: store.tenantId, platform: "WHATSAPP", threadKey: { in: chats.map((c) => c.buyerId) } },
    select: { threadKey: true, createdAt: true },
  });
  const pausedAt = new Map(pauses.map((p) => [p.threadKey, p.createdAt.toISOString()]));
  return chats.map((c) => (pausedAt.has(c.buyerId) ? { ...c, pausedAt: pausedAt.get(c.buyerId) } : c));
}

export type WaRead = { connected: false } | { connected: true; chats: WaChat[]; orderBuyers: Set<string> };

/** Every recent WhatsApp chat of the workspace, with which buyers have an open order. */
export async function readWaChats(tenantId: string): Promise<WaRead> {
  const store = await waStoreOf(tenantId);
  if (!store) return { connected: false };
  const chats = await loadWaChats(store);
  const ids = chats.map((c) => c.buyerId);
  const orders = ids.length ? await db.order.findMany({ where: { tenantId, buyerKey: { in: ids }, status: { in: ["NEW", "CONFIRMED"] } }, select: { buyerKey: true } }) : [];
  const orderBuyers = new Set<string>();
  for (const o of orders) if (o.buyerKey) orderBuyers.add(o.buyerKey);
  return { connected: true, chats, orderBuyers };
}

export type WaOne = { connected: false } | { connected: true; found: false } | { connected: true; found: true; chat: WaChat; orderOpen: boolean };

/**
 * One chat by its reference. The reference is looked up inside this workspace's WhatsApp store only, so a reference that belongs to
 * anyone else's chat (or to a comment, or to nothing) is simply not found.
 */
export async function readWaChat(tenantId: string, ref: string): Promise<WaOne> {
  const store = await waStoreOf(tenantId);
  if (!store) return { connected: false };
  const rowId = parseWaRef(ref);
  if (!rowId) return { connected: true, found: false };
  const row = await db.conversationMessage.findFirst({ where: { id: rowId, storeId: store.id, platform: "WHATSAPP" }, select: { authorId: true } });
  if (!row?.authorId) return { connected: true, found: false };
  const chat = (await loadWaChats(store, { authorId: row.authorId }))[0];
  if (!chat) return { connected: true, found: false };
  const open = await db.order.findFirst({ where: { tenantId, buyerKey: chat.buyerId, status: { in: ["NEW", "CONFIRMED"] } }, select: { id: true } });
  return { connected: true, found: true, chat, orderOpen: !!open };
}

// The same reads, held to the request's deadline like the Meta reads: a slow database becomes a reason the tool turns into a note.

const DB_WAIT = { minMs: 800, marginMs: 300 } as const;

export type WaListOutcome = { state: "off" } | { state: "failed"; reason: Exclude<WaUnreadable, "not_connected"> } | { state: "ok"; chats: WaChat[]; orderBuyers: Set<string> };

/** list_conversations: "off" = no WhatsApp number is connected. */
export async function readWhatsApp(tenantId: string, deadline: number): Promise<WaListOutcome> {
  const live = await withinDeadline(deadline, () => readWaChats(tenantId), DB_WAIT);
  if (!live.ok) return { state: "failed", reason: live.reason };
  return live.value.connected ? { state: "ok", chats: live.value.chats, orderBuyers: live.value.orderBuyers } : { state: "off" };
}

export type WaOneOutcome =
  | { state: "off" }
  | { state: "failed"; reason: Exclude<WaUnreadable, "not_connected"> }
  | { state: "missing" }
  | { state: "ok"; chat: WaChat; orderOpen: boolean };

/** get_conversation. */
export async function readWhatsAppChat(tenantId: string, ref: string, deadline: number): Promise<WaOneOutcome> {
  const live = await withinDeadline(deadline, () => readWaChat(tenantId, ref), DB_WAIT);
  if (!live.ok) return { state: "failed", reason: live.reason };
  const one = live.value;
  if (!one.connected) return { state: "off" };
  return one.found ? { state: "ok", chat: one.chat, orderOpen: one.orderOpen } : { state: "missing" };
}
