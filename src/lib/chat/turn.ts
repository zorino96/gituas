// The request side of a chat turn: who may ask, which thread, the lock, the plan's chat turns, the attachments, and then the loop.
// The route handler only turns the session into an Actor and the response into a stream; everything that decides is here.

import { z } from "zod";

import { chatStep } from "@/lib/ai/chat";
import { aiForTenant } from "@/lib/ai/for-store";
import { claimSlot, refundSlot, slotsUsed, takeDaily } from "@/lib/ai/slots";
import { plainName } from "@/lib/assistant/ask";
import { db } from "@/lib/db";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { OPTIONAL_SHARE, spentOf } from "@/lib/ai/meter";
import { CHAT_QUICK_PER_DAY, CHAT_REFUNDS_PER_DAY, CHAT_SLOTS, chatCaps, LIMITS, NO_SHOP_CHAT_CAPS, NO_SHOP_QUICK_PER_DAY, TURN_COST_MICRO } from "./budget";
import type { Actor } from "./confirm";
import { titleFrom } from "./guard";
import { quickTitle, runQuick, runTurn, type TurnDeps } from "./loop";
import { QUICK_PLAN } from "./quick";
import { toolsFor } from "./registry";
import { snapshotFor } from "./snapshot";
import {
  attachmentsOf,
  createThread,
  getAutonomy,
  getOwnThread,
  isOwnAttachment,
  loadMessages,
  lockThread,
  nextAttachmentId,
  runsOfThread,
  setTitle,
  unlockThread,
  type ChatThread,
} from "./store";
import { errorText } from "./text";
import { titleFor } from "./title";
import { ALL_TOOLS } from "./tools";
import { isQuickId, type ChatAttachment, type ChatErrorCode, type ChatEvent, type ChatTool, type QuickId } from "./types";

const Body = z.object({
  workspaceId: z.string().min(1).max(60),
  threadId: z.string().max(40).optional(),
  text: z.string().max(LIMITS.userTextChars * 2).default(""),
  attachments: z.array(z.unknown()).max(12).optional(),
  review: z.boolean().optional(),
  quick: z.string().max(20).optional(),
});

/** The files the person attached: only the workspace's own uploads, at most six, each with the next free id of the thread. */
export function cleanIncoming(raw: unknown[] | undefined, tenantId: string, existing: { id: string }[]): ChatAttachment[] {
  const out: ChatAttachment[] = [];
  for (const x of (raw ?? []).slice(0, 6)) {
    const a = (x ?? {}) as Partial<ChatAttachment>;
    const candidate = { ...a, id: nextAttachmentId([...existing, ...out]) };
    if (isOwnAttachment(candidate, tenantId)) out.push({ id: candidate.id, url: candidate.url, pathname: candidate.pathname, kind: candidate.kind, name: plainName(String(a.name ?? "")).slice(0, 80) });
  }
  return out;
}

/** What the person's own shop says about itself (so a number or handle the model repeats from it is not taken for a stranger's). */
async function ownerFactsOf(tenantId: string): Promise<string[]> {
  const [tenant, stores] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { whatsappNumber: true } }),
    db.store.findMany({ where: { tenantId }, select: { igUsername: true, name: true }, take: 15 }),
  ]);
  return [tenant?.whatsappNumber, ...stores.flatMap((s) => [s.igUsername ? `@${s.igUsername}` : null, s.name])].filter((x): x is string => !!x);
}

export interface ServiceDeps extends Pick<TurnDeps, "step" | "now"> {
  tools: ChatTool[];
  snapshot: TurnDeps["snapshot"];
}

export function defaultDeps(actor: Actor): ServiceDeps {
  return { step: chatStep, now: Date.now, tools: toolsFor(ALL_TOOLS, actor.kind, actor.role), snapshot: () => snapshotFor(actor) };
}

/**
 * One chat request. Everything the person sees is sent through `emit`, in order. Never throws.
 * The caller has already checked the session, the workspace kind and the role (the route does); this checks the rest.
 */
export async function executeChatRequest(actor: Actor, rawBody: unknown, emit: (e: ChatEvent) => void, deps: ServiceDeps = defaultDeps(actor)): Promise<void> {
  const started = deps.now();
  const fail = (code: ChatErrorCode, contact = false) => emit({ t: "error", code, message: errorText(code, actor.lang), contact });
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return fail("badrequest");
  const body = parsed.data;
  if (body.workspaceId !== actor.tenantId) return fail("workspace");
  const quick: QuickId | undefined = isQuickId(body.quick) ? body.quick : undefined;
  if (body.quick !== undefined && !quick) return fail("badrequest");
  const text = body.text.replace(/\u0000/g, "").trim().slice(0, LIMITS.userTextChars);
  if (!quick && !text) return fail("badrequest");

  let slot: Awaited<ReturnType<typeof claimSlot>> | null = null;
  let locked: ChatThread | null = null;
  // Work that follows the `done` event (the screen is already free): a better title for a new thread.
  let afterDone: (() => Promise<void>) | null = null;
  // Nothing usable was made: the place goes back, once. A failure that may have been paid for gives it back a few times a day only
  // (so it cannot loop for free); a refusal before any work (busy, no such thread) costs nothing and always gives it back.
  let refunded = false;
  const giveBackSlot = async (free = false) => {
    if (!slot?.ok || refunded) return;
    refunded = true;
    if (free || (await takeDaily(actor.tenantId, "chat_refund_day", 1, CHAT_REFUNDS_PER_DAY).catch(() => 0)) > 0) await refundSlot(actor.tenantId, CHAT_SLOTS, slot).catch(() => undefined);
  };
  try {
    // The plan's chat turns: one per question, whatever the number of model calls it takes. A shortcut takes none.
    const limits = await limitsOf(actor.tenantId);
    const noShop = limits.aiUsd <= 0;
    const caps = noShop ? NO_SHOP_CHAT_CAPS : chatCaps(limits.aiUsd);
    if (!quick) {
      slot = await claimSlot(actor.tenantId, CHAT_SLOTS, caps);
      if (!slot.ok) return fail(slot.error === "daily" ? "limit_day" : "limit_month");
    } else if ((await takeDaily(actor.tenantId, "chat_quick_day", 1, noShop ? NO_SHOP_QUICK_PER_DAY : CHAT_QUICK_PER_DAY)) < 1) {
      return fail("limit_day");
    }

    let thread: ChatThread | null;
    let isNew = false;
    if (body.threadId) {
      thread = await getOwnThread(body.threadId, { tenantId: actor.tenantId, userId: actor.userId });
      if (!thread) {
        await giveBackSlot(true);
        return fail("not_found");
      }
    } else {
      thread = await createThread({ tenantId: actor.tenantId, userId: actor.userId, kind: actor.kind, title: quick ? quickTitle(actor.lang, quick) : titleFrom(text) });
      isNew = true;
    }
    emit({ t: "thread", id: thread.id, title: thread.title, isNew });
    if (!(await lockThread(thread.id, deps.now()))) {
      await giveBackSlot(true);
      return fail("busy");
    }
    locked = thread;

    if (quick) {
      await runQuick({ actor, thread, emit }, quick, QUICK_PLAN[quick], { tools: deps.tools, now: deps.now });
    } else {
      const [messages, runs] = await Promise.all([loadMessages(thread.id), runsOfThread(thread.id)]);
      const attachments = cleanIncoming(body.attachments, actor.tenantId, attachmentsOf(messages, runs, actor.tenantId));
      const [autonomy, ownerFacts, ai] = await Promise.all([getAutonomy(actor.tenantId), ownerFactsOf(actor.tenantId), aiForTenant(actor.tenantId)]);
      const outcome = await runTurn(
        { actor, thread, text, attachments, review: body.review !== false, autonomy, ownerFacts, emit },
        { step: deps.step, tools: deps.tools, snapshot: deps.snapshot, meter: noShop ? undefined : ai.meter, now: deps.now },
      );
      if (!outcome.answered) await giveBackSlot();
      if (outcome.error) fail(outcome.error, outcome.error === "unavailable");
      if (isNew && outcome.answered && !outcome.error) {
        const id = thread.id;
        afterDone = async () => {
          const title = await titleFor(text, actor.lang, noShop ? undefined : ai.meter);
          if (title) await setTitle(id, title);
        };
      }
    }
    emit({ t: "done", remaining: await remainingOf(actor.tenantId), ms: deps.now() - started });
    if (afterDone) await afterDone().catch(() => undefined);
  } catch (e) {
    console.error("[chat] turn failed:", e instanceof Error ? e.name : "unknown");
    await giveBackSlot();
    fail("internal");
  } finally {
    if (locked) await unlockThread(locked.id).catch(() => undefined);
  }
}

/** What is left of the plan's chat turns today and this month. */
export async function remainingOf(tenantId: string): Promise<{ day: number; month: number }> {
  const limits = await limitsOf(tenantId);
  const caps = limits.aiUsd <= 0 ? NO_SHOP_CHAT_CAPS : chatCaps(limits.aiUsd);
  const used = await slotsUsed(tenantId, CHAT_SLOTS).catch(() => ({ day: 0, month: 0 }));
  let month = caps.month - used.month;
  // Never promise more turns than the rest of the allowance can pay for (chat stops at the optional share of it).
  if (limits.aiUsd > 0) {
    const spent = await spentOf(tenantId).catch(() => ({ total: 0, opus: 0 }));
    month = Math.min(month, Math.max(0, Math.floor((limits.aiUsd * 1e6 * OPTIONAL_SHARE - spent.total) / TURN_COST_MICRO)));
  }
  month = Math.max(0, month);
  return { day: Math.max(0, Math.min(caps.day - used.day, month)), month };
}
