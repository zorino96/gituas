"use server";

// The chat's threads and settings, for the screen: list, search, open, rename, pin, delete, and the autonomy setting.
// Every action takes the person and the workspace from the session and puts both in the query.

import { allowanceOf } from "@/lib/ai/meter";
import { db } from "@/lib/db";
import { remainingOf } from "@/lib/chat/turn";
import { actorFromSession } from "@/lib/chat/session";
import {
  deleteAllThreads,
  deleteThread,
  getAutonomy,
  getOwnThread,
  listThreads,
  loadMessages,
  messageToDto,
  pinThread,
  renameThread,
  runsOfThread,
  setAutonomy,
  settleStaleRuns,
  toSummary,
} from "@/lib/chat/store";
import { isAutonomy, type Autonomy, type ChatErrorCode, type MessageDto, type ThreadSummary } from "@/lib/chat/types";

type Fail = { ok: false; code: ChatErrorCode };

export async function listThreadsAction(input?: { q?: string }): Promise<{ ok: true; threads: ThreadSummary[] } | Fail> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false, code: who.code };
  const threads = await listThreads({ tenantId: who.actor.tenantId, userId: who.actor.userId }, { q: typeof input?.q === "string" ? input.q : undefined });
  return { ok: true, threads };
}

export async function getThreadAction(
  input: { id: string },
): Promise<{ ok: true; thread: ThreadSummary; messages: MessageDto[]; remaining: { day: number; month: number }; /** A turn of this thread is still running on the server. */ busy: boolean } | Fail> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false, code: who.code };
  const thread = await getOwnThread(String(input?.id ?? ""), { tenantId: who.actor.tenantId, userId: who.actor.userId });
  if (!thread) return { ok: false, code: "not_found" };
  // A card left RUNNING by a function that was cut off is settled now, so it does not spin for ever.
  await settleStaleRuns(thread.id, who.actor.lang).catch(() => undefined);
  const [rows, runs, remaining] = await Promise.all([loadMessages(thread.id), runsOfThread(thread.id), remainingOf(who.actor.tenantId)]);
  const runMap = new Map(runs.map((r) => [r.id, r]));
  const now = Date.now();
  const messages = rows
    .map((m) => messageToDto(m, runMap, now))
    .filter((m): m is MessageDto => !!m && (m.role === "user" || !!m.text || m.blocks.length > 0 || m.runs.length > 0));
  return { ok: true, thread: toSummary(thread), messages, remaining, busy: !!thread.busyUntil && thread.busyUntil.getTime() > now };
}

export async function renameThreadAction(input: { id: string; title: string }): Promise<{ ok: boolean }> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false };
  return { ok: await renameThread(String(input?.id ?? ""), { tenantId: who.actor.tenantId, userId: who.actor.userId }, String(input?.title ?? "")) };
}

export async function pinThreadAction(input: { id: string; pinned: boolean }): Promise<{ ok: boolean }> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false };
  return { ok: await pinThread(String(input?.id ?? ""), { tenantId: who.actor.tenantId, userId: who.actor.userId }, input?.pinned === true) };
}

export async function deleteThreadAction(input: { id: string }): Promise<{ ok: boolean }> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false };
  return { ok: await deleteThread(String(input?.id ?? ""), { tenantId: who.actor.tenantId, userId: who.actor.userId }) };
}

export async function deleteAllThreadsAction(input: { workspaceId: string }): Promise<{ ok: boolean; deleted: number }> {
  const who = await actorFromSession();
  // The screen names the workspace it was opened for: a tab left behind on another workspace must not delete these chats.
  if (!who.ok || input?.workspaceId !== who.actor.tenantId) return { ok: false, deleted: 0 };
  return { ok: true, deleted: await deleteAllThreads({ tenantId: who.actor.tenantId, userId: who.actor.userId }) };
}

export async function getChatStateAction(): Promise<{ ok: true; autonomy: Autonomy; canSetAutonomy: boolean; remaining: { day: number; month: number }; allowancePercent: number } | Fail> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false, code: who.code };
  const [autonomy, remaining, allowance] = await Promise.all([getAutonomy(who.actor.tenantId), remainingOf(who.actor.tenantId), allowanceOf({ scope: who.actor.tenantId }).catch(() => null)]);
  // The session already means an owner or an admin (the chat is closed to anyone else).
  return { ok: true, autonomy, canSetAutonomy: true, remaining, allowancePercent: allowance?.percent ?? 0 };
}

/** How far the chat may act without a card. Written down: a change of this setting is a decision about everything else. */
export async function setAutonomyAction(input: { autonomy: Autonomy; workspaceId: string }): Promise<{ ok: boolean; autonomy: Autonomy }> {
  const who = await actorFromSession();
  const keep = who.ok ? await getAutonomy(who.actor.tenantId) : "ASK";
  // The screen names the workspace it was opened for: a tab left behind on another workspace must not change this one's setting.
  if (!who.ok || input?.workspaceId !== who.actor.tenantId || !isAutonomy(input?.autonomy)) return { ok: false, autonomy: keep };
  await setAutonomy(who.actor.tenantId, input.autonomy);
  await db.auditLog
    .create({ data: { tenantId: who.actor.tenantId, actor: "USER", action: "chat.autonomy", metadata: { from: keep, to: input.autonomy, userId: who.actor.userId } } })
    .catch(() => undefined);
  return { ok: true, autonomy: input.autonomy };
}
