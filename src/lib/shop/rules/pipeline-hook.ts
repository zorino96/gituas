// The bridge between the owner rules and the buyer pipeline (src/lib/shop/pipeline.ts). The pipeline asks ownerRule() once per
// message, at the two places where it knows what it would answer on its own, and then does what the answer says: send the owner's
// fixed text instead of its own reply, and/or put the message on the owner's "needs you" pile.
//
// The one promise of this file: a rule can never break the pipeline. ownerRule() never throws; on any failure (the database, a
// rule that no longer parses, anything) it answers "no rule" and the pipeline carries on exactly as it did before rules existed.
// With the switch off (SHOP_RULES_ENABLED), or a shop without rules, nothing but one cheap check or one indexed query runs.

import { db } from "@/lib/db";
import type { Classification, CommentAction, CommentDecision, DmAction, Intent } from "../policy";
import { loadActiveRules, loadUsage, takeRuleDay } from "./db";
import { rulesDryRun, rulesEnabled } from "./enabled";
import { pickRule, type PickInput, type PickResult, type RuleRecord, type RuleReply } from "./engine";
import { matchTrigger, prepareText } from "./match";
import { draftsFromPick, markRuns, priorRuns, recordRuns, replayOf, type LoggedAction, type PriorRun, type RunUpdate } from "./log";
import { actionsOf } from "./spec";
import type { RuleChannel, RulePlatform } from "./types";

export interface RuleInput {
  channel: RuleChannel;
  tenantId: string;
  storeId: string;
  messageId: string;
  platform: RulePlatform;
  /** The author of a comment, the sender of a chat: whose caps count. Without one no rule runs (a cap cannot be kept). */
  buyerKey: string | null;
  /** Where a pause would be written: the comment's id, or the sender's id. */
  threadKey: string | null;
  /** What the buyer typed (the transcript for a voice note). */
  text: string;
  viaVoice: boolean;
  c: Classification | null;
  canPrivateReply: boolean;
  limited: boolean;
  /** The pipeline's OWN answer to this message is a product card. */
  hasProductCard: boolean;
  orderInProgress: boolean;
  now?: Date;
}

/** What is left to do after the jobs ran: settle the log rows and, if a rule asked for it, pause the thread. */
export interface RuleTail {
  tenantId: string;
  messageId: string;
  platform: RulePlatform;
  threadKey: string | null;
  runs: { id: string; actions: LoggedAction[] }[];
}

export interface RuleOutcome {
  /** The owner's text to send instead of the pipeline's own reply. */
  reply: RuleReply | null;
  /** The message goes on the owner's "needs you" pile. */
  flag: boolean;
  flagNotes: string[];
  /** Pause the thread once the reply is sent. */
  pause: boolean;
  tail: RuleTail | null;
}

/** "No rule acted": every field the pipeline reads is empty. Shared and frozen. */
export const NO_RULE: Readonly<RuleOutcome> = Object.freeze({ reply: null, flag: false, flagNotes: [], pause: false, tail: null });

/** The pipeline carries one of these through a message so that the tail can be settled after the jobs ran. */
export interface RuleCarry {
  tail?: RuleTail | null;
}

const isUnique = (e: unknown): boolean => (e as { code?: string } | null)?.code === "P2002";

/**
 * Which of the shop's rules act on this message. Never throws. See the top of the file for what that means.
 */
export async function ownerRule(i: RuleInput): Promise<Readonly<RuleOutcome>> {
  if (!rulesEnabled()) return NO_RULE;
  if (!i.buyerKey || !i.text.trim()) return NO_RULE;
  try {
    return await decide({ ...i, buyerKey: i.buyerKey });
  } catch (e) {
    console.error("[rules] a rule step failed, the buyer pipeline goes on as before:", e instanceof Error ? e.name : "unknown error");
    return NO_RULE;
  }
}

async function decide(i: RuleInput & { buyerKey: string }): Promise<Readonly<RuleOutcome>> {
  const now = i.now ?? new Date();
  const dry = rulesDryRun();
  const all = await loadActiveRules(i.storeId);
  const rules = all.filter((r) => r.spec.trigger.channel === i.channel && r.spec.trigger.platforms.includes(i.platform));
  if (!rules.length) return NO_RULE;
  const ids = rules.map((r) => r.id);

  // A message is decided once. A second run (the stuck-message sweep, a redelivery) does what the first one decided, and never
  // falls through to the pipeline's own reply: that could send the buyer something else.
  const prior = await priorRuns(i.messageId, ids);
  if (prior.some((p) => p.status !== "DRY")) return dry ? NO_RULE : replay(i, prior);

  // Most messages meet no rule at all (a shop's rules are about a few words). The words are compared first, with no database: when no
  // rule's trigger meets this message, nothing below could change the answer (no row would be written), so the counters, the person's
  // runs and the private-reply count are not read. This stays AFTER the check above on purpose: a re-run classifies the message again,
  // and a label that changed must not make it lose the decision the first run already took.
  const prepared = prepareText(i.text);
  const matching = rules.filter((r) => matchTrigger(r.spec.trigger, { channel: i.channel, platform: i.platform, text: prepared, viaVoice: i.viaVoice, c: i.c }).ok);
  if (!matching.length) return NO_RULE;

  const needsPrivateCheck = i.channel === "comment" && matching.some((r) => !!actionsOf(r.spec).reply);
  const [{ usage, senderRepliesLastHour }, privateReplyUsed] = await Promise.all([
    loadUsage(matching, { storeId: i.storeId, buyerKey: i.buyerKey, now }),
    needsPrivateCheck ? db.outboxJob.count({ where: { messageId: i.messageId, kind: "PRIVATE_REPLY" } }).then((n) => n > 0) : false,
  ]);
  const input: PickInput = {
    channel: i.channel,
    platform: i.platform,
    text: i.text,
    viaVoice: i.viaVoice,
    c: i.c,
    canPrivateReply: i.canPrivateReply,
    privateReplyUsed,
    limited: i.limited,
    hasProductCard: i.hasProductCard,
    orderInProgress: i.orderInProgress,
    usage,
    senderRepliesLastHour,
  };
  const ctx = { storeId: i.storeId, messageId: i.messageId, buyerKey: i.buyerKey, now };

  if (dry) {
    // A test run: what the rules WOULD do is written down; nothing is consumed, sent, flagged or paused.
    await recordRuns(draftsFromPick(pickRule(input, rules), rules, ctx, true));
    return NO_RULE;
  }

  const result = await takeCaps(input, rules);
  const rows = await recordRuns(draftsFromPick(result, rules, ctx, false));
  // A row was already there: another run of this very message decided first. Do what that one decided.
  if (rows.some((r) => !r.created && r.draft.actions.length)) return replay(i, await priorRuns(i.messageId, ids));

  const runs = rows.filter((r) => r.draft.actions.length).map((r) => ({ id: r.id, actions: r.draft.actions }));
  if (!runs.length) return NO_RULE;
  return {
    reply: result.reply,
    flag: result.flag,
    flagNotes: result.flagNotes,
    pause: result.pause,
    tail: { tenantId: i.tenantId, messageId: i.messageId, platform: i.platform, threadKey: i.threadKey, runs },
  };
}

function replay(i: RuleInput, prior: readonly PriorRun[]): Readonly<RuleOutcome> {
  const r = replayOf(prior);
  if (!r.live.length) return NO_RULE;
  return {
    reply: r.reply,
    flag: r.flag,
    flagNotes: r.flagNotes,
    pause: r.pause,
    tail: { tenantId: i.tenantId, messageId: i.messageId, platform: i.platform, threadKey: i.threadKey, runs: r.live.map((x) => ({ id: x.id, actions: x.actions })) },
  };
}

/**
 * Takes one unit of the day from every rule that is about to act (atomic, so two messages at once cannot both take the last one).
 * A rule that is refused has reached its daily limit: it is treated as capped and the pick is made again without it, so a later
 * rule may still answer. The units already taken stay taken (the rules before it still act).
 */
async function takeCaps(input: PickInput, rules: readonly RuleRecord[]): Promise<PickResult> {
  const perDay = new Map(rules.map((r) => [r.id, r.spec.limits.perDay]));
  const usage: Record<string, { today: number; personToday: number } | undefined> = { ...input.usage };
  const taken = new Set<string>();
  let result = pickRule({ ...input, usage }, rules);
  for (let round = 0; round <= rules.length; round++) {
    let refused: string | null = null;
    for (const f of result.fired) {
      if (taken.has(f.ruleId)) continue;
      if (await takeRuleDay(f.ruleId, perDay.get(f.ruleId) ?? 1)) taken.add(f.ruleId);
      else {
        refused = f.ruleId;
        break;
      }
    }
    if (!refused) return result;
    usage[refused] = { today: perDay.get(refused) ?? 1, personToday: usage[refused]?.personToday ?? 0 };
    result = pickRule({ ...input, usage }, rules);
  }
  throw new Error("the rules' daily limits did not settle");
}

// ---------------------------------------------------------------------------------------------------------------------
// What the pipeline does with an answer

/**
 * A comment decision with the owner's reply in place of the pipeline's own: the private reply is the owner's text, the public line is
 * the standard "we sent you a message" (or none, as the rule says), and the likes and hides stay. Nothing else the pipeline planned
 * for the comment (a thank-you, the product card) is sent: the rule's reply replaces it.
 */
export function commentDecisionWithRule(base: CommentDecision, reply: RuleReply): CommentDecision {
  const keep = base.actions.filter((a) => a.kind === "LIKE" || a.kind === "HIDE");
  const actions: CommentAction[] = [];
  if (reply.publicLine === "standard") actions.push({ kind: "PUBLIC_REPLY", style: "answer" });
  actions.push({ kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false });
  actions.push(...keep);
  return { actions, flag: null };
}

/** The actions of a chat message answered by a rule: the pipeline's own answer is replaced by one answer (the rule's text). Photos stay. */
export function dmActionsWithRule(base: readonly DmAction[], intent: Intent): DmAction[] {
  return [...base.filter((a) => a.kind !== "DM_ANSWER"), { kind: "DM_ANSWER", intent, whatsapp: false }];
}

/**
 * After the jobs ran: settle the log rows (a reply that was sent is DONE, one still waiting is QUEUED with its job), and apply a
 * pause now that the reply it came with has gone out. Never throws: the buyer's reply is already on its way.
 */
export async function finishRules(tail: RuleTail | null | undefined): Promise<void> {
  if (!tail || !tail.runs.length) return;
  try {
    const wantsJobs = tail.runs.some((r) => r.actions.some((a) => a.do === "reply"));
    const jobs = wantsJobs
      ? await db.outboxJob.findMany({ where: { messageId: tail.messageId, kind: { in: ["PRIVATE_REPLY", "DM_ANSWER"] } }, select: { id: true, kind: true, status: true } })
      : [];
    const updates: RunUpdate[] = [];
    let pause = false;
    for (const run of tail.runs) {
      const reply = run.actions.find((a) => a.do === "reply");
      const pauses = run.actions.some((a) => a.do === "pause_thread");
      if (!reply || reply.do !== "reply") {
        updates.push({ id: run.id, status: "DONE" });
        if (pauses) pause = true;
        continue;
      }
      const job = jobs.find((j) => j.kind === (reply.channel === "private" ? "PRIVATE_REPLY" : "DM_ANSWER"));
      if (!job) {
        updates.push({ id: run.id, status: "FAILED", reason: "no_job" });
        continue;
      }
      updates.push({ id: run.id, status: job.status === "SENT" ? "DONE" : "QUEUED", actions: run.actions.map((a) => (a.do === "reply" ? { ...a, jobId: job.id } : a)) });
      // "Say this, then stop": the pause waits for the reply to be sent, or the buyer would get silence.
      if (pauses && job.status === "SENT") pause = true;
    }
    await markRuns(updates);
    if (pause && tail.threadKey) {
      try {
        await db.threadPause.create({ data: { tenantId: tail.tenantId, platform: tail.platform, threadKey: tail.threadKey } });
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
  } catch (e) {
    console.error("[rules] settling the rule log failed:", e instanceof Error ? e.name : "unknown error");
  }
}
