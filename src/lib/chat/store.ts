// The chat's rows: threads, messages and the runs (proposals) the server holds. Every function takes the workspace and the person
// it is for and puts both in the query, so a thread or run of another workspace or person is simply not found.

import { createHash } from "node:crypto";

import type { ChatMessage, ChatRun, ChatThread, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isOwnBlobUrl } from "@/lib/merchant/caption";
import type { Lang } from "@/lib/i18n/lang";
import { LIMITS } from "./budget";
import { say } from "./text";
import { isAutonomy, type Autonomy, type Card, type ChatAttachment, type ChatKind, type MessageDto, type Risk, type RunDto, type RunStatus, type ThreadSummary, type ViewBlock } from "./types";

export type { ChatMessage, ChatRun, ChatThread };

// ---------------------------------------------------------------------------------------------------------------------
// Threads

export async function createThread(i: { tenantId: string; userId: string; kind: ChatKind; title: string }): Promise<ChatThread> {
  return db.chatThread.create({ data: { tenantId: i.tenantId, userId: i.userId, kind: i.kind, title: i.title.slice(0, 80) } });
}

/** The thread, only if it is this person's in this workspace. */
export async function getOwnThread(id: string, who: { tenantId: string; userId: string }): Promise<ChatThread | null> {
  if (!id || id.length > 40) return null;
  return db.chatThread.findFirst({ where: { id, tenantId: who.tenantId, userId: who.userId } });
}

/** Takes the thread for a turn. False = another turn of it is still running (a crashed turn frees it after the lock time). */
export async function lockThread(id: string, now = Date.now()): Promise<boolean> {
  const r = await db.chatThread.updateMany({
    where: { id, OR: [{ busyUntil: null }, { busyUntil: { lt: new Date(now) } }] },
    data: { busyUntil: new Date(now + LIMITS.lockMs) },
  });
  return r.count === 1;
}

export async function unlockThread(id: string): Promise<void> {
  await db.chatThread.updateMany({ where: { id }, data: { busyUntil: null } });
}

export async function setTaintedSeq(id: string, seq: number): Promise<void> {
  await db.chatThread.updateMany({ where: { id }, data: { taintedSeq: seq } });
}

export async function setTitle(id: string, title: string): Promise<void> {
  await db.chatThread.updateMany({ where: { id }, data: { title: title.slice(0, 80) } });
}

export const toSummary = (t: Pick<ChatThread, "id" | "title" | "pinned" | "lastMessageAt">): ThreadSummary => ({
  id: t.id,
  title: t.title,
  pinned: t.pinned,
  lastMessageAt: t.lastMessageAt.toISOString(),
});

/** The person's threads, pinned first and then newest first; `q` searches titles and what was said. */
export async function listThreads(who: { tenantId: string; userId: string }, o: { q?: string; limit?: number } = {}): Promise<ThreadSummary[]> {
  const q = o.q?.trim().slice(0, 80);
  const where: Prisma.ChatThreadWhereInput = {
    tenantId: who.tenantId,
    userId: who.userId,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { messages: { some: { role: { in: ["user", "assistant"] }, content: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const rows = await db.chatThread.findMany({ where, orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }], take: Math.min(o.limit ?? 100, 200), select: { id: true, title: true, pinned: true, lastMessageAt: true } });
  return rows.map(toSummary);
}

export async function renameThread(id: string, who: { tenantId: string; userId: string }, title: string): Promise<boolean> {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!t) return false;
  return (await db.chatThread.updateMany({ where: { id, tenantId: who.tenantId, userId: who.userId }, data: { title: t } })).count === 1;
}

export async function pinThread(id: string, who: { tenantId: string; userId: string }, pinned: boolean): Promise<boolean> {
  return (await db.chatThread.updateMany({ where: { id, tenantId: who.tenantId, userId: who.userId }, data: { pinned } })).count === 1;
}

export async function deleteThread(id: string, who: { tenantId: string; userId: string }): Promise<boolean> {
  return (await db.chatThread.deleteMany({ where: { id, tenantId: who.tenantId, userId: who.userId } })).count === 1;
}

export async function deleteAllThreads(who: { tenantId: string; userId: string }): Promise<number> {
  return (await db.chatThread.deleteMany({ where: { tenantId: who.tenantId, userId: who.userId } })).count;
}

// ---------------------------------------------------------------------------------------------------------------------
// Messages

export interface NewMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { id: string; name: string; args: string }[];
  toolCallId?: string;
  meta?: Record<string, unknown>;
  tainted?: boolean;
}

/** Saves a message at the next number of the thread (the number is taken with one atomic increment, so turns cannot clash). */
export async function appendMessage(threadId: string, m: NewMessage): Promise<ChatMessage> {
  const t = await db.chatThread.update({ where: { id: threadId }, data: { nextSeq: { increment: 1 }, lastMessageAt: new Date() }, select: { nextSeq: true } });
  return db.chatMessage.create({
    data: {
      threadId,
      seq: t.nextSeq - 1,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ? (m.toolCalls as unknown as Prisma.InputJsonValue) : undefined,
      toolCallId: m.toolCallId,
      meta: m.meta ? (m.meta as Prisma.InputJsonValue) : undefined,
      tainted: m.tainted ?? false,
    },
  });
}

export async function updateMessage(id: string, patch: { content?: string; meta?: Record<string, unknown>; tainted?: boolean }): Promise<ChatMessage> {
  return db.chatMessage.update({
    where: { id },
    data: { content: patch.content, meta: patch.meta ? (patch.meta as Prisma.InputJsonValue) : undefined, tainted: patch.tainted },
  });
}

/** The thread's messages in order; with `last`, only that many from the end. */
export async function loadMessages(threadId: string, o: { last?: number } = {}): Promise<ChatMessage[]> {
  if (o.last) {
    const rows = await db.chatMessage.findMany({ where: { threadId }, orderBy: { seq: "desc" }, take: o.last });
    return rows.reverse();
  }
  return db.chatMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs: the proposals the server holds

/** Canonical JSON (keys sorted), so the same arguments always hash the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export const argsHashOf = (args: unknown): string => createHash("sha256").update(canonicalJson(args)).digest("hex");

export interface StoredCard extends Card {
  /** A card that takes long (a picture): run from its own request. */
  long: boolean;
}

export async function createRun(i: {
  threadId: string;
  tenantId: string;
  userId: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  autonomy: Autonomy;
  tainted: boolean;
  card: StoredCard;
  now?: number;
}): Promise<ChatRun> {
  const now = i.now ?? Date.now();
  try {
    return await db.chatRun.create({
      data: {
        threadId: i.threadId,
        tenantId: i.tenantId,
        userId: i.userId,
        toolCallId: i.toolCallId,
        tool: i.tool,
        args: i.args as Prisma.InputJsonValue,
        argsHash: argsHashOf(i.args),
        risk: i.risk,
        autonomy: i.autonomy,
        tainted: i.tainted,
        card: i.card as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(now + LIMITS.runTtlMs),
      },
    });
  } catch (e) {
    // A retried step finds the run it already made (same thread, same call id) instead of making a second one, but only when it
    // is the very same proposal: another tool or other arguments under a repeated call id must never come back as the old run.
    if ((e as { code?: string })?.code === "P2002") {
      const again = await db.chatRun.findUnique({ where: { threadId_toolCallId: { threadId: i.threadId, toolCallId: i.toolCallId } } });
      if (again && again.tool === i.tool && again.argsHash === argsHashOf(i.args)) return again;
    }
    throw e;
  }
}

/** The run, only if it belongs to this person in this workspace. */
export async function getOwnRun(id: string, who: { tenantId: string; userId: string }): Promise<ChatRun | null> {
  if (!id || id.length > 40) return null;
  return db.chatRun.findFirst({ where: { id, tenantId: who.tenantId, userId: who.userId } });
}

/** PROPOSED -> RUNNING in one atomic update: only one caller can win, whatever the screen does. */
export async function claimRun(id: string, by: "CONFIRMED" | "AUTO", now = Date.now()): Promise<boolean> {
  const r = await db.chatRun.updateMany({
    where: { id, status: "PROPOSED", expiresAt: { gt: new Date(now) } },
    data: { status: "RUNNING", decidedBy: by, decidedAt: new Date(now) },
  });
  return r.count === 1;
}

export async function cancelRun(id: string): Promise<boolean> {
  return (await db.chatRun.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "CANCELLED", decidedAt: new Date() } })).count === 1;
}

export async function expireRun(id: string): Promise<void> {
  await db.chatRun.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "EXPIRED" } });
}

export async function finishRun(id: string, patch: { status: "DONE" | "FAILED"; result?: Record<string, unknown>; error?: string }): Promise<ChatRun> {
  return db.chatRun.update({
    where: { id },
    data: { status: patch.status, result: patch.result ? (patch.result as Prisma.InputJsonValue) : undefined, error: patch.error?.slice(0, 500), finishedAt: new Date() },
  });
}

/**
 * A run left RUNNING by a function that was cut off (the 60 s limit) is settled as FAILED with the "may have gone through"
 * sentence: whether the change was made is unknown, and a spinner that never ends helps nobody.
 */
export async function settleStaleRuns(threadId: string, lang: Lang, now = Date.now()): Promise<number> {
  const r = await db.chatRun.updateMany({
    where: { threadId, status: "RUNNING", decidedAt: { lt: new Date(now - 3 * 60_000) } },
    data: { status: "FAILED", error: say("unknownOutcome", lang), finishedAt: new Date(now) },
  });
  return r.count;
}

export async function runsOfThread(threadId: string): Promise<ChatRun[]> {
  return db.chatRun.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// What the screen receives

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The status the person should see: a card nobody confirmed in time reads EXPIRED even before anything marked it. */
export function effectiveStatus(r: Pick<ChatRun, "status" | "expiresAt">, now = Date.now()): RunStatus {
  return r.status === "PROPOSED" && r.expiresAt.getTime() <= now ? "EXPIRED" : (r.status as RunStatus);
}

export function runToDto(r: ChatRun, now = Date.now()): RunDto {
  const card = asObject(r.card);
  const result = asObject(r.result);
  const media = asObject(result.media);
  const hasMedia = typeof media.url === "string" && typeof media.pathname === "string";
  return {
    id: r.id,
    tool: r.tool,
    risk: r.risk as Risk,
    title: typeof card.title === "string" ? card.title : r.tool,
    lines: Array.isArray(card.lines) ? (card.lines as RunDto["lines"]) : [],
    status: effectiveStatus(r, now),
    decidedBy: r.decidedBy === "CONFIRMED" || r.decidedBy === "AUTO" ? r.decidedBy : null,
    tainted: r.tainted,
    expiresAt: r.expiresAt.toISOString(),
    resultText: typeof result.text === "string" ? result.text : undefined,
    error: r.error ?? undefined,
    media: hasMedia ? { url: String(media.url), pathname: String(media.pathname), kind: media.kind === "video" ? "video" : "image", name: String(media.name ?? "") } : undefined,
    jobId: typeof result.jobId === "string" ? result.jobId : undefined,
    long: card.long === true,
  };
}

/** A message as the screen shows it; tool messages are not shown (their views live on the assistant message). */
export function messageToDto(m: ChatMessage, runs: Map<string, ChatRun>, now = Date.now()): MessageDto | null {
  if (m.role !== "user" && m.role !== "assistant") return null;
  const meta = asObject(m.meta);
  const runIds = Array.isArray(meta.runIds) ? (meta.runIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    id: m.id,
    seq: m.seq,
    role: m.role,
    text: m.content,
    blocks: Array.isArray(meta.blocks) ? (meta.blocks as ViewBlock[]) : [],
    runs: runIds.map((id) => runs.get(id)).filter((r): r is ChatRun => !!r).map((r) => runToDto(r, now)),
    followups: [],
    attachments: m.role === "user" && Array.isArray(meta.attachments) ? (meta.attachments as ChatAttachment[]) : [],
    createdAt: m.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Attachments of a thread

const ATTACHMENT_ID = /^a\d{1,2}$/;

/** The next free "aN" for a thread. */
export function nextAttachmentId(existing: { id: string }[]): string {
  const used = new Set(existing.map((a) => a.id));
  for (let n = 1; n < 100; n++) if (!used.has(`a${n}`)) return `a${n}`;
  return "a99";
}

/** One attachment is the workspace's own upload: its address and its path both say so. */
export function isOwnAttachment(a: Partial<ChatAttachment> | null | undefined, tenantId: string): a is ChatAttachment {
  return (
    !!a &&
    typeof a.id === "string" &&
    ATTACHMENT_ID.test(a.id) &&
    typeof a.url === "string" &&
    typeof a.pathname === "string" &&
    (a.kind === "image" || a.kind === "video") &&
    isOwnBlobUrl(a.url, tenantId) &&
    a.pathname.startsWith(`merchant/${tenantId}/`) &&
    !a.pathname.includes("..")
  );
}

/**
 * Every file the thread can refer to: what the person attached to their messages, and the pictures its finished runs made. The
 * ids ("a1", "a2"…) are the ones saved with them; a file that is not the workspace's own is left out.
 */
export function attachmentsOf(messages: Pick<ChatMessage, "role" | "meta">[], runs: Pick<ChatRun, "status" | "result">[], tenantId: string): ChatAttachment[] {
  const out: ChatAttachment[] = [];
  for (const m of messages) {
    const list = m.role === "user" ? asObject(m.meta).attachments : undefined;
    if (Array.isArray(list)) for (const a of list) if (isOwnAttachment(a, tenantId) && !out.some((x) => x.id === a.id)) out.push(a);
  }
  for (const r of runs) {
    if (r.status !== "DONE") continue;
    const res = asObject(r.result);
    const media = asObject(res.media);
    const saved = typeof res.attachmentId === "string" && ATTACHMENT_ID.test(res.attachmentId) ? res.attachmentId : "";
    // Two pictures (or a picture and a file attached meanwhile) can have been given the same id: the later one takes the next free id.
    const id = saved && !out.some((x) => x.id === saved) ? saved : nextAttachmentId(out);
    const a = { id, url: media.url, pathname: media.pathname, kind: media.kind, name: typeof media.name === "string" ? media.name : "" } as Partial<ChatAttachment>;
    if (isOwnAttachment(a, tenantId) && !out.some((x) => x.url === a.url)) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The workspace's autonomy setting

export async function getAutonomy(tenantId: string): Promise<Autonomy> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { chatAutonomy: true } });
  return isAutonomy(t?.chatAutonomy) ? t.chatAutonomy : "ASK";
}

export async function setAutonomy(tenantId: string, autonomy: Autonomy): Promise<void> {
  await db.tenant.update({ where: { id: tenantId }, data: { chatAutonomy: autonomy } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retention: what customers wrote must not sit in chat rows for long

const DAY = 86_400_000;
const EXPIRED = "[expired]";

/**
 * Daily housekeeping. Tool results (which can hold customers' words) are blanked after a day, the tables and lists shown with an
 * answer are dropped after 30 days, and a thread nobody touched for 180 days is deleted with everything in it.
 */
export async function pruneChats(now = Date.now()): Promise<{ tools: number; blocks: number; cards: number; threads: number }> {
  const dayAgo = new Date(now - DAY);
  const monthAgo = new Date(now - 30 * DAY);
  const tools = (await db.chatMessage.updateMany({ where: { role: "tool", createdAt: { lt: dayAgo }, NOT: { content: EXPIRED } }, data: { content: EXPIRED } })).count;
  const blocks = Number(await db.$executeRaw`UPDATE "ChatMessage" SET "meta" = "meta" - 'blocks' WHERE "role" = 'assistant' AND "createdAt" < ${monthAgo} AND jsonb_exists("meta", 'blocks')`);
  // The values on a card can quote a customer (the comment being answered, the last message): they go with the tables.
  const cards = Number(await db.$executeRaw`UPDATE "ChatRun" SET "card" = jsonb_set("card", '{lines}', '[]'::jsonb) WHERE "createdAt" < ${monthAgo} AND jsonb_array_length("card"->'lines') > 0`);
  const threads = (await db.chatThread.deleteMany({ where: { lastMessageAt: { lt: new Date(now - 180 * DAY) } } })).count;
  return { tools, blocks, cards, threads };
}

/**
 * When an account is disconnected or the platform asks us to delete a person's data: the chat rows of the workspace that may hold
 * customers' words go at once (tool results and the tables shown with answers).
 */
export async function purgeBuyerData(tenantId: string): Promise<void> {
  await db.$executeRaw`UPDATE "ChatMessage" m SET "content" = ${EXPIRED} FROM "ChatThread" t WHERE m."threadId" = t."id" AND t."tenantId" = ${tenantId} AND m."role" = 'tool'`;
  await db.$executeRaw`UPDATE "ChatMessage" m SET "meta" = m."meta" - 'blocks' FROM "ChatThread" t WHERE m."threadId" = t."id" AND t."tenantId" = ${tenantId} AND m."role" = 'assistant' AND jsonb_exists(m."meta", 'blocks')`;
  // The cards that quote a customer's comment or message.
  await db.$executeRaw`UPDATE "ChatRun" SET "card" = jsonb_set("card", '{lines}', '[]'::jsonb) WHERE "tenantId" = ${tenantId} AND "tool" IN ('reply_to_comment', 'send_message', 'hide_comment', 'set_order_status') AND jsonb_array_length("card"->'lines') > 0`;
}
