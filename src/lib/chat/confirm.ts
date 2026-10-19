// Running a held proposal: the person's Confirm (from the card) or the autonomy setting (from the loop). Both go through the same
// function, so a change is checked, counted, run and written down in one way.

import { baghdadDay, takeDaily } from "@/lib/ai/slots";
import { db } from "@/lib/db";
import { can, type Role } from "@/lib/newsroom/roles";
import { scopedAccount, type AccountChoice, type ScopedProvider } from "@/lib/oauth/account-scope";
import { ACTIONS_PER_DAY, LIMITS, NEWS_ACTIONS_PER_DAY, NEWS_POSTS_PER_DAY, POSTS_PER_DAY } from "./budget";
import {
  argsHashOf,
  attachmentsOf,
  cancelRun,
  claimRun,
  effectiveStatus,
  expireRun,
  finishRun,
  getOwnRun,
  loadMessages,
  nextAttachmentId,
  runToDto,
  runsOfThread,
  type ChatRun,
} from "./store";
import { errorText, say } from "./text";
import { withTimeout } from "./util";
import { verifyChange } from "./verify";
import type { Lang } from "@/lib/i18n/lang";
import { isWriteTool, ToolRefusal, type ChatAttachment, type ChatKind, type ChatTool, type RunDecisionResponse, type ToolCtx, type VerifyReport, type WriteResult, type WriteTool } from "./types";

/** Who is acting: everything here comes from the session, never from the request body. */
export interface Actor {
  tenantId: string;
  userId: string;
  role: Role;
  kind: ChatKind;
  lang: Lang;
}

const POST_TOOLS = new Set(["post_now", "schedule_post"]);
const ACTIONS_METRIC = "chat_action_day";
const POSTS_METRIC = "chat_post_day";

const SCOPED: readonly ScopedProvider[] = ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"];

/** The accounts the chat acts as right now (the person's choice for this request; {} when they chose none). A card stores this when it is made. */
export function currentAccounts(): AccountChoice {
  const out: AccountChoice = {};
  for (const p of SCOPED) {
    const id = scopedAccount(p);
    if (id) out[p] = id;
  }
  return out;
}

/**
 * Whether the person changed the accounts since this card was made. A card made before the accounts were stored has nothing to compare
 * with and is not checked. A card made with no choice (`{}`) differs from a request with one: the card was made for the newest
 * connections, and Confirm must not run it as another account.
 */
export function accountsChanged(card: unknown, now: AccountChoice = currentAccounts()): boolean {
  const made = card && typeof card === "object" && !Array.isArray(card) ? (card as { accounts?: unknown }).accounts : undefined;
  if (!made || typeof made !== "object" || Array.isArray(made)) return false;
  const was = made as Record<string, unknown>;
  return SCOPED.some((p) => (typeof was[p] === "string" && was[p] ? was[p] : undefined) !== now[p]);
}

/** A change that did not happen gives its place in the day back. */
async function giveBack(tenantId: string, metric: string): Promise<void> {
  await db.usage.updateMany({ where: { tenantId, month: baghdadDay(), metric, count: { gt: 0 } }, data: { count: { decrement: 1 } } }).catch(() => undefined);
}

export function toolCtx(actor: Actor, o: { threadId: string; attachments: ChatAttachment[]; review: boolean; deadline: number }): ToolCtx {
  return { tenantId: actor.tenantId, userId: actor.userId, role: actor.role, kind: actor.kind, lang: actor.lang, threadId: o.threadId, attachments: o.attachments, review: o.review, deadline: o.deadline };
}

export interface ExecutedRun {
  run: ChatRun;
  ok: boolean;
  /** One plain sentence for the model (and the card). */
  text: string;
  data?: unknown;
  /** The wait ended before the tool did: the change may still have been made, so nobody should repeat it blindly. */
  unknown?: boolean;
  /** The change read back from the live data (only for a tool that has a check). */
  verify?: VerifyReport;
}

/**
 * Runs a run that this call has just claimed (status RUNNING). The arguments are parsed and hashed again (what runs is what was
 * proposed), the role is checked again, the day's caps are taken, the tool's own server action does the work, and the outcome and an
 * audit row are written. A change that did not happen gives its place in the day back.
 */
export async function executeClaimedRun(i: {
  run: ChatRun;
  tool: WriteTool;
  actor: Actor;
  attachments: ChatAttachment[];
  review: boolean;
  deadline: number;
  how: "CONFIRMED" | "AUTO";
}): Promise<ExecutedRun> {
  const { run, tool, actor } = i;
  const fail = async (error: string, extra?: Record<string, unknown>): Promise<ExecutedRun> => {
    const done = await finishRun(run.id, { status: "FAILED", error, result: extra });
    await audit(i, done, false);
    return { run: done, ok: false, text: error, unknown: extra?.unknownOutcome === true };
  };
  if (!can(actor.role, tool.permission)) return fail(errorText("forbidden", actor.lang));
  const parsed = tool.schema.safeParse(run.args);
  if (!parsed.success || argsHashOf(run.args) !== run.argsHash) return fail(errorText("badrequest", actor.lang));
  // A card runs as the accounts it was made under. The person pressing Confirm may have chosen another account since (the choice is read
  // from the request), and the card named the old one: nothing runs, and nothing was counted yet, so there is nothing to give back.
  if (i.how === "CONFIRMED" && accountsChanged(run.card)) return fail(say("accountChanged", actor.lang));

  if ((await takeDaily(actor.tenantId, ACTIONS_METRIC, 1, actor.kind === "news" ? NEWS_ACTIONS_PER_DAY : ACTIONS_PER_DAY)) < 1) return fail(say("actionsLimit", actor.lang));
  const isPost = tool.countsAsPost === true || POST_TOOLS.has(tool.name);
  if (isPost && (await takeDaily(actor.tenantId, POSTS_METRIC, 1, actor.kind === "news" ? NEWS_POSTS_PER_DAY : POSTS_PER_DAY)) < 1) {
    await giveBack(actor.tenantId, ACTIONS_METRIC);
    return fail(say("actionsLimit", actor.lang));
  }
  const refund = async () => {
    await giveBack(actor.tenantId, ACTIONS_METRIC);
    if (isPost) await giveBack(actor.tenantId, POSTS_METRIC);
  };

  let result: WriteResult;
  try {
    result = await withTimeout(tool.execute(toolCtx(actor, { threadId: run.threadId, attachments: i.attachments, review: i.review, deadline: i.deadline }), parsed.data), i.deadline - Date.now());
  } catch (e) {
    if (e instanceof ToolRefusal) {
      await refund();
      return fail(e.message);
    }
    // The wait ended while the tool may still be working (a post being published, a picture being made): the change may be made
    // after all. The counters are kept, the card says so, and the model is told not to repeat it.
    if (e instanceof Error && e.name === "TimeoutError") return fail(say("unknownOutcome", actor.lang), { unknownOutcome: true });
    console.error("[chat] tool failed:", tool.name, e instanceof Error ? e.name : "unknown");
    return fail(errorText("internal", actor.lang));
  }
  if (!result.ok) {
    await refund();
    return fail(result.text);
  }
  const media = result.media ? { ...result.media } : undefined;
  // The picture's id is chosen from the thread as it is NOW (the person may have attached files while it was being made).
  const known = media ? attachmentsOf(await loadMessages(run.threadId), await runsOfThread(run.threadId), actor.tenantId) : i.attachments;
  // The change is read back from the live data while there is room: what the tool said is not the same as what is stored.
  const verify = await verifyChange(
    tool,
    toolCtx(actor, { threadId: run.threadId, attachments: i.attachments, review: i.review, deadline: i.deadline }),
    parsed.data,
    { text: result.text, data: result.data, runId: run.id },
    // An automatic run happens inside a chat turn: the model still needs its own time afterwards to read the report and answer.
    i.deadline - Date.now() - (i.how === "AUTO" ? LIMITS.minStepMs + 1_500 : 0),
  );
  const done = await finishRun(run.id, {
    status: "DONE",
    result: {
      text: result.text,
      ...(media ? { media, attachmentId: nextAttachmentId(known) } : {}),
      ...(result.jobId ? { jobId: result.jobId } : {}),
      ...(verify ? { verify } : {}),
    },
  });
  await audit(i, done, true, verify?.status);
  return { run: done, ok: true, text: result.text, data: result.data, ...(verify ? { verify } : {}) };
}

/** Every change made from the chat is written down: who decided, how, what, and whether it worked. */
async function audit(i: { actor: Actor; tool: WriteTool; how: "CONFIRMED" | "AUTO" }, run: ChatRun, ok: boolean, verified?: "ok" | "problem"): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: i.actor.tenantId,
        actor: i.how === "AUTO" ? "AI_CLAUDE" : "USER",
        action: "chat.run",
        metadata: { runId: run.id, threadId: run.threadId, tool: run.tool, risk: run.risk, decidedBy: i.how, autonomy: run.autonomy, tainted: run.tainted, ok, ...(verified ? { verified } : {}), userId: i.actor.userId },
      },
    });
  } catch {
    // the change is done and recorded on the run; a missing audit row must not undo the answer
  }
}

/**
 * The endpoint's logic: the person presses Confirm or Cancel on a card. Only the person who owns the thread, in the workspace the
 * run belongs to, can decide it; a card decides once; an old card is dead.
 */
export async function decideRun(i: {
  runId: string;
  action: "confirm" | "cancel";
  actor: Actor;
  tools: Map<string, ChatTool>;
  review: boolean;
  deadline: number;
}): Promise<RunDecisionResponse> {
  const { actor } = i;
  const run = await getOwnRun(i.runId, { tenantId: actor.tenantId, userId: actor.userId });
  if (!run) return { ok: false, code: "not_found", message: errorText("not_found", actor.lang) };
  const status = effectiveStatus(run);
  if (status === "EXPIRED") {
    await expireRun(run.id);
    return { ok: false, code: "expired", message: errorText("expired", actor.lang), run: runToDto(run) };
  }
  if (status !== "PROPOSED") return { ok: false, code: "badrequest", message: errorText("badrequest", actor.lang), run: runToDto(run) };

  if (i.action === "cancel") {
    await cancelRun(run.id);
    const again = await getOwnRun(run.id, { tenantId: actor.tenantId, userId: actor.userId });
    return again ? { ok: true, run: runToDto(again) } : { ok: false, code: "not_found", message: errorText("not_found", actor.lang) };
  }

  const tool = i.tools.get(run.tool);
  if (!tool || !isWriteTool(tool) || !tool.kinds.includes(actor.kind) || !can(actor.role, tool.permission)) {
    return { ok: false, code: "forbidden", message: errorText("forbidden", actor.lang), run: runToDto(run) };
  }
  // Only one caller can win this: a second tab, a double press or a replay finds the card already taken.
  if (!(await claimRun(run.id, "CONFIRMED"))) {
    const again = await getOwnRun(run.id, { tenantId: actor.tenantId, userId: actor.userId });
    return { ok: false, code: "badrequest", message: errorText("badrequest", actor.lang), run: again ? runToDto(again) : undefined };
  }
  const claimed = (await getOwnRun(run.id, { tenantId: actor.tenantId, userId: actor.userId })) ?? run;
  const [messages, runs] = await Promise.all([loadMessages(run.threadId), runsOfThread(run.threadId)]);
  const executed = await executeClaimedRun({
    run: claimed,
    tool,
    actor,
    attachments: attachmentsOf(messages, runs, actor.tenantId),
    review: i.review,
    deadline: i.deadline,
    how: "CONFIRMED",
  });
  return { ok: true, run: runToDto(executed.run) };
}
