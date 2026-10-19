// The rule log (RuleRun): one row each time a rule met a message. It is the idempotency key (the pipeline may run a message twice, and a
// message is decided once per rule), the proof of what a rule did, and what the owner reads in "what did my rules do".
//
// A row holds ids, the OWNER's own keyword that matched and the owner's own rendered text. It never holds a buyer's words. It goes
// with its message (cascade) and after 90 days (pruneRuleRuns in db.ts).

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PickResult, RuleRecord, RuleReply } from "./engine";
import { actionsOf } from "./spec";

export type RunStatus = "CLAIMED" | "QUEUED" | "PENDING" | "DONE" | "SKIPPED" | "FAILED" | "DRY";

/** What a rule did (or, in a test run, would have done) on one message. The text is the owner's own. */
export type LoggedAction =
  | { do: "reply"; channel: "private" | "dm"; text: string; textLang: string; lang: string; publicLine: "standard" | "none"; jobId?: string }
  | { do: "flag_owner"; note?: string }
  | { do: "pause_thread" };

export interface RunDraft {
  ruleId: string;
  ruleVersion: number;
  storeId: string;
  messageId: string;
  buyerKey: string | null;
  status: RunStatus;
  /** The first thing that held something back (a reason code), or null. */
  reason: string | null;
  /** The owner's keyword (or "intent:price") that matched. Never the buyer's text. */
  matched: string | null;
  actions: LoggedAction[];
  dueAt: Date | null;
}

/** The rows a pick makes: every rule that matched (acted, waited, or was held back), not the ones whose trigger did not match. */
export function draftsFromPick(
  result: PickResult,
  rules: readonly RuleRecord[],
  ctx: { storeId: string; messageId: string; buyerKey: string | null; now: Date },
  dry: boolean,
): RunDraft[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: RunDraft[] = [];
  for (const t of result.trace) {
    if (t.outcome === "no_match") continue;
    const base = {
      ruleId: t.ruleId,
      ruleVersion: t.ruleVersion,
      storeId: ctx.storeId,
      messageId: ctx.messageId,
      buyerKey: ctx.buyerKey,
      matched: t.matched,
      reason: t.reasons[0] ?? null,
      dueAt: null as Date | null,
    };
    if (t.outcome === "skipped") {
      out.push({ ...base, status: dry ? "DRY" : "SKIPPED", actions: [] });
      continue;
    }
    if (t.outcome === "waiting") {
      const w = result.waiting.find((x) => x.ruleId === t.ruleId);
      out.push({ ...base, status: dry ? "DRY" : "PENDING", actions: [], dueAt: w ? new Date(ctx.now.getTime() + w.minutes * 60_000) : null });
      continue;
    }
    const spec = byId.get(t.ruleId)?.spec;
    const actions: LoggedAction[] = [];
    for (const k of t.did) {
      if (k === "reply" && result.reply && result.reply.ruleId === t.ruleId) actions.push(replyAction(result.reply));
      else if (k === "flag_owner") {
        const note = spec ? actionsOf(spec).flag?.note : undefined;
        actions.push(note ? { do: "flag_owner", note } : { do: "flag_owner" });
      } else if (k === "pause_thread") actions.push({ do: "pause_thread" });
    }
    out.push({ ...base, status: dry ? "DRY" : "CLAIMED", actions });
  }
  return out;
}

const replyAction = (r: RuleReply): LoggedAction => ({ do: "reply", channel: r.channel, text: r.text, textLang: r.textLang, lang: r.lang, publicLine: r.publicLine });

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const dataOf = (d: RunDraft) => ({
  ruleId: d.ruleId,
  ruleVersion: d.ruleVersion,
  storeId: d.storeId,
  messageId: d.messageId,
  buyerKey: d.buyerKey,
  status: d.status,
  reason: d.reason,
  matched: d.matched,
  actions: asJson(d.actions),
  dueAt: d.dueAt,
});

export interface Recorded {
  draft: RunDraft;
  id: string;
  /** false = a row for this rule and message already existed (another run of the same message got there first). */
  created: boolean;
}

const isUnique = (e: unknown): boolean => (e as { code?: string } | null)?.code === "P2002";

/**
 * Writes the rows of a pick. A row that already exists is never overwritten (the first decision about a message is the decision),
 * except a test-run row (DRY), which a live run replaces.
 */
export async function recordRuns(drafts: readonly RunDraft[]): Promise<Recorded[]> {
  const out: Recorded[] = [];
  for (const d of drafts) {
    try {
      const row = await db.ruleRun.create({ data: dataOf(d), select: { id: true } });
      out.push({ draft: d, id: row.id, created: true });
    } catch (e) {
      if (!isUnique(e)) throw e;
      const existing = await db.ruleRun.findUnique({ where: { ruleId_messageId: { ruleId: d.ruleId, messageId: d.messageId } }, select: { id: true, status: true } });
      if (!existing) throw e;
      if (existing.status === "DRY" && d.status !== "DRY") {
        const took = await db.ruleRun.updateMany({ where: { id: existing.id, status: "DRY" }, data: dataOf(d) });
        out.push({ draft: d, id: existing.id, created: took.count > 0 });
      } else {
        out.push({ draft: d, id: existing.id, created: false });
      }
    }
  }
  return out;
}

export interface PriorRun {
  id: string;
  ruleId: string;
  ruleVersion: number;
  status: string;
  matched: string | null;
  reason: string | null;
  actions: LoggedAction[];
}

const asActions = (v: unknown): LoggedAction[] => (Array.isArray(v) ? (v as LoggedAction[]).filter((a) => a && typeof a === "object" && typeof a.do === "string") : []);

/** What the rules already decided about this message (the pipeline runs a message twice when the first run died half-way). */
export async function priorRuns(messageId: string, ruleIds: readonly string[]): Promise<PriorRun[]> {
  if (!ruleIds.length) return [];
  const rows = await db.ruleRun.findMany({
    where: { messageId, ruleId: { in: [...ruleIds] } },
    select: { id: true, ruleId: true, ruleVersion: true, status: true, matched: true, reason: true, actions: true },
  });
  return rows.map((r) => ({ ...r, actions: asActions(r.actions) }));
}

/** The decision of an earlier run, rebuilt from its rows: the pipeline then does exactly what the first run decided. */
export function replayOf(rows: readonly PriorRun[]): { reply: RuleReply | null; flag: boolean; flagNotes: string[]; pause: boolean; live: PriorRun[] } {
  const live = rows.filter((r) => (["CLAIMED", "QUEUED", "DONE", "PENDING"] as string[]).includes(r.status) && r.actions.length);
  let reply: RuleReply | null = null;
  let flag = false;
  let pause = false;
  const notes = new Set<string>();
  for (const r of live) {
    for (const a of r.actions) {
      if (a.do === "reply" && !reply) {
        reply = {
          ruleId: r.ruleId,
          ruleVersion: r.ruleVersion,
          matched: r.matched ?? "",
          channel: a.channel,
          text: a.text,
          lang: a.lang as RuleReply["lang"],
          textLang: a.textLang as RuleReply["textLang"],
          publicLine: a.publicLine,
        };
      } else if (a.do === "flag_owner") {
        flag = true;
        if (a.note) notes.add(a.note);
      } else if (a.do === "pause_thread") pause = true;
    }
  }
  return { reply, flag, flagNotes: [...notes], pause, live };
}

export interface RunUpdate {
  id: string;
  status: RunStatus;
  reason?: string;
  actions?: LoggedAction[];
}

/** Moves rows that are still in progress (CLAIMED or QUEUED) to their next status. A row that is already settled is left alone. */
export async function markRuns(updates: readonly RunUpdate[]): Promise<void> {
  for (const u of updates) {
    await db.ruleRun.updateMany({
      where: { id: u.id, status: { in: ["CLAIMED", "QUEUED"] } },
      data: { status: u.status, ...(u.reason ? { reason: u.reason } : {}), ...(u.actions ? { actions: asJson(u.actions) } : {}) },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the log (for the chat tools)

export interface RunRow {
  id: string;
  ruleId: string;
  ruleVersion: number;
  status: string;
  reason: string | null;
  matched: string | null;
  actions: LoggedAction[];
  createdAt: Date;
  /** The state of the message's outbox job, when the run sent a reply: SENT, PENDING, SKIPPED or FAILED. */
  delivery: string | null;
  /** Why the job was not sent, when the outbox gave one of its own short codes (store_off, thread_paused...); never Meta's free text. */
  deliveryNote: string | null;
}

/** How many runs each rule has had since a time, by status. */
export async function runCounts(ruleIds: readonly string[], since: Date): Promise<Record<string, Record<string, number>>> {
  if (!ruleIds.length) return {};
  const rows = await db.ruleRun.groupBy({ by: ["ruleId", "status"], where: { ruleId: { in: [...ruleIds] }, createdAt: { gte: since } }, _count: { _all: true } });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.ruleId] ??= {})[r.status] = r._count._all;
  return out;
}

/** How often each reason (why nothing was sent) came up since a time. */
export async function reasonCounts(ruleIds: readonly string[], since: Date): Promise<Record<string, number>> {
  if (!ruleIds.length) return {};
  const rows = await db.ruleRun.groupBy({ by: ["reason"], where: { ruleId: { in: [...ruleIds] }, createdAt: { gte: since }, reason: { not: null } }, _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows) if (r.reason) out[r.reason] = r._count._all;
  return out;
}

/**
 * The newest runs of the given rules, with what became of the reply each one queued. A run that was cut off before its end (a dead
 * function: it never wrote the job into its row) is matched to its job by message and kind, so it still shows what became of the reply.
 */
export async function recentRuns(i: { ruleIds: readonly string[]; since: Date; statuses?: readonly string[]; limit: number }): Promise<RunRow[]> {
  if (!i.ruleIds.length) return [];
  const rows = await db.ruleRun.findMany({
    where: { ruleId: { in: [...i.ruleIds] }, createdAt: { gte: i.since }, ...(i.statuses?.length ? { status: { in: [...i.statuses] } } : {}) },
    orderBy: { createdAt: "desc" },
    take: i.limit,
    select: { id: true, ruleId: true, ruleVersion: true, messageId: true, status: true, reason: true, matched: true, actions: true, createdAt: true },
  });
  const shaped = rows.map((r) => ({ ...r, actions: asActions(r.actions) }));
  const jobIds = shaped.flatMap((r) => r.actions.flatMap((a) => (a.do === "reply" && a.jobId ? [a.jobId] : [])));
  // A reply with no job id in its row: look for the message's own job of that kind (one per message and kind).
  const orphan = shaped.filter((r) => r.actions.some((a) => a.do === "reply" && !a.jobId) && ["CLAIMED", "FAILED"].includes(r.status));
  const [jobs, byMessage] = await Promise.all([
    jobIds.length ? db.outboxJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true, lastError: true } }) : Promise.resolve([]),
    orphan.length
      ? db.outboxJob.findMany({
          where: { messageId: { in: orphan.map((r) => r.messageId) }, kind: { in: ["PRIVATE_REPLY", "DM_ANSWER"] } },
          select: { messageId: true, kind: true, status: true, lastError: true },
        })
      : Promise.resolve([]),
  ]);
  const byJob = new Map(jobs.map((j) => [j.id, j]));
  return shaped.map(({ messageId, ...r }) => {
    const reply = r.actions.find((a) => a.do === "reply");
    let job: { status: string; lastError: string | null } | undefined;
    if (reply && reply.do === "reply") {
      job = reply.jobId
        ? byJob.get(reply.jobId)
        : byMessage.find((j) => j.messageId === messageId && j.kind === (reply.channel === "private" ? "PRIVATE_REPLY" : "DM_ANSWER"));
    }
    return { ...r, delivery: job?.status ?? null, deliveryNote: job?.lastError && /^[a-z_]{3,40}$/.test(job.lastError) ? job.lastError : null };
  });
}
