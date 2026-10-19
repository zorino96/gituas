// The owner rules' storage: the rules themselves (ShopRule), the counters a rule is held to, and the daily clean-up. Everything that
// touches the database for the rules lives in this file, log.ts (the RuleRun log) and pipeline-hook.ts (the bridge to the buyer
// pipeline); the rest of this folder is pure.
//
// Nothing here reads a model, the network or a buyer's account. A rule is always looked up inside one workspace (tenantId) or one
// shop (storeId): an id that is not theirs is simply not found.

import type { Prisma } from "@/generated/prisma/client";
import { baghdadDay, takeDaily } from "@/lib/ai/slots";
import { db } from "@/lib/db";
import { typedText } from "@/lib/whatsapp/webhook";
import type { RuleRecord, RuleUsage } from "./engine";
import type { StoredMessage } from "./preview";
import { parseRuleSpec, specHash, type RuleSpecT } from "./spec";
import { MAX_ACTIVE_RULES } from "./types";

/** How many rules (any status but ARCHIVED) one shop may hold: a pile of paused rules is clutter, not safety. */
export const MAX_STORED_RULES = 30;
/** The rule log is kept this many days. */
export const RUN_KEEP_DAYS = 90;
/** The metric of the per-rule, per-day counter (Usage). */
export const RULE_DAY_METRIC = "rule_day";
/** Counter scope of one rule. */
export const ruleScope = (ruleId: string): string => `rule:${ruleId}`;

/** RuleRun statuses that mean "the rule acted on that message": they count towards a person's cap and the sender-per-hour ceiling. */
export const ACTED_STATUSES = ["CLAIMED", "QUEUED", "PENDING", "DONE"] as const;

export type RuleStatus = "ACTIVE" | "PAUSED" | "PAUSED_AUTO" | "ARCHIVED";
const LIVE_STATUSES: RuleStatus[] = ["ACTIVE", "PAUSED", "PAUSED_AUTO"];

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Midnight in Baghdad (UTC+3 all year), where the shops' days begin. The same rule as startOfShopDay in the pipeline, kept here so this file never imports it. */
function shopDayStart(d: Date): Date {
  const BAGHDAD = 3 * HOUR;
  return new Date(Math.floor((d.getTime() + BAGHDAD) / DAY) * DAY - BAGHDAD);
}

/**
 * Whether the pipeline runs this rule in this version. A rule that waits for a timer needs the sweep, which does not exist yet: it
 * is left alone rather than half-run (its trigger would match and nothing would ever act).
 */
export function runnable(spec: RuleSpecT): boolean {
  return !spec.wait;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading rules for the pipeline

/** The ACTIVE rules of a shop the pipeline may run. A stored rule that no longer parses is skipped (and said so in the log), never run. */
export async function loadActiveRules(storeId: string): Promise<RuleRecord[]> {
  const rows = await db.shopRule.findMany({
    where: { storeId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: MAX_ACTIVE_RULES * 3,
    select: { id: true, version: true, priority: true, createdAt: true, spec: true },
  });
  const out: RuleRecord[] = [];
  for (const r of rows) {
    const parsed = parseRuleSpec(r.spec);
    if (!parsed.ok) {
      console.warn(`[rules] rule ${r.id} no longer parses and is skipped`);
      continue;
    }
    if (!runnable(parsed.spec)) continue;
    out.push({ id: r.id, version: r.version, priority: r.priority, createdAt: r.createdAt, spec: parsed.spec });
  }
  return out;
}

/** What a message has already used up of each rule, and of the sender, as the engine's inputs. Reads only; nothing is consumed here. */
export async function loadUsage(
  rules: readonly { id: string }[],
  i: { storeId: string; buyerKey: string; now: Date },
): Promise<{ usage: Record<string, RuleUsage>; senderRepliesLastHour: number }> {
  const ids = rules.map((r) => r.id);
  const [day, person, hour] = await Promise.all([
    db.usage.findMany({
      where: { tenantId: { in: ids.map(ruleScope) }, month: baghdadDay(i.now.getTime()), metric: RULE_DAY_METRIC },
      select: { tenantId: true, count: true },
    }),
    db.ruleRun.findMany({
      where: { ruleId: { in: ids }, buyerKey: i.buyerKey, createdAt: { gte: shopDayStart(i.now) }, status: { in: [...ACTED_STATUSES] } },
      select: { ruleId: true },
      take: 500,
    }),
    db.ruleRun.findMany({
      where: { storeId: i.storeId, buyerKey: i.buyerKey, createdAt: { gt: new Date(i.now.getTime() - HOUR) }, status: { in: [...ACTED_STATUSES] } },
      select: { actions: true },
      take: 50,
    }),
  ]);
  const usage: Record<string, RuleUsage> = {};
  for (const id of ids) usage[id] = { today: 0, personToday: 0 };
  for (const u of day) {
    const id = u.tenantId.slice("rule:".length);
    if (usage[id]) usage[id].today = u.count;
  }
  for (const p of person) if (usage[p.ruleId]) usage[p.ruleId].personToday += 1;
  // Only runs that REPLIED count towards the ceiling on replies to one sender.
  const senderRepliesLastHour = hour.filter((h) => Array.isArray(h.actions) && (h.actions as { do?: string }[]).some((a) => a?.do === "reply")).length;
  return { usage, senderRepliesLastHour };
}

/** Takes one unit of the rule's day (atomic, like every other daily counter). False = the rule's limit for today is used up. */
export async function takeRuleDay(ruleId: string, perDay: number): Promise<boolean> {
  return (await takeDaily(ruleScope(ruleId), RULE_DAY_METRIC, 1, perDay)) >= 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// The owner's list (what the chat tools show and change)

export interface StoredRule {
  id: string;
  tenantId: string;
  storeId: string;
  /** The shop's name, or "@handle", for a workspace with several shops. */
  shopName: string;
  name: string;
  sentence: string;
  status: string;
  version: number;
  priority: number;
  /** null when the stored JSON no longer parses (the rule is shown but never run). */
  spec: RuleSpecT | null;
  specHash: string;
  pausedReason: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const RULE_SELECT = {
  id: true, tenantId: true, storeId: true, name: true, sentence: true, status: true, version: true, priority: true, spec: true,
  specHash: true, pausedReason: true, activatedAt: true, createdAt: true, updatedAt: true,
  store: { select: { name: true, igUsername: true } },
} as const;

type RuleRow = {
  id: string; tenantId: string; storeId: string; name: string; sentence: string; status: string; version: number; priority: number;
  spec: unknown; specHash: string; pausedReason: string | null; activatedAt: Date | null; createdAt: Date; updatedAt: Date;
  store: { name: string; igUsername: string | null };
};

function shape(r: RuleRow): StoredRule {
  const parsed = parseRuleSpec(r.spec);
  const shopName = r.store.name || (r.store.igUsername ? `@${r.store.igUsername}` : "");
  return {
    id: r.id, tenantId: r.tenantId, storeId: r.storeId, shopName, name: r.name, sentence: r.sentence, status: r.status, version: r.version,
    priority: r.priority, spec: parsed.ok ? parsed.spec : null, specHash: r.specHash, pausedReason: r.pausedReason,
    activatedAt: r.activatedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/** The most rules one listing returns. */
const LIST_MAX = 100;

/**
 * The workspace's rules that are not deleted (or those with the given statuses), oldest first.
 * `newestFirst`: the NEWEST rules first, so a workspace that has replaced its rules many times (a deleted rule is only archived,
 * never purged) still sees its current ones inside the limit.
 * `archivedSince`: of the deleted rules keep only those changed since then. A rule deleted longer ago than the log is kept has
 * nothing left to show, and would only take a place in the list.
 */
export async function listStoredRules(
  tenantId: string,
  opts: { statuses?: readonly string[]; storeId?: string; newestFirst?: boolean; archivedSince?: Date } = {},
): Promise<StoredRule[]> {
  const statuses = [...(opts.statuses ?? LIVE_STATUSES)];
  const cut = opts.archivedSince && statuses.includes("ARCHIVED");
  const status = cut
    ? { OR: [{ status: { in: statuses.filter((x) => x !== "ARCHIVED") } }, { status: "ARCHIVED", updatedAt: { gte: opts.archivedSince } }] }
    : { status: { in: statuses } };
  const rows = await db.shopRule.findMany({
    where: { tenantId, ...(opts.storeId ? { storeId: opts.storeId } : {}), ...status },
    orderBy: { createdAt: opts.newestFirst ? "desc" : "asc" },
    take: LIST_MAX,
    select: RULE_SELECT,
  });
  return (rows as unknown as RuleRow[]).map(shape);
}

export type FoundRule = { ok: true; rule: StoredRule } | { ok: false; why: "none" | "ambiguous" };

/** A rule of this workspace by the id the list gives, else by its exact name (when only one rule has it). A deleted rule is never found by name. */
export async function findStoredRule(tenantId: string, hint: string): Promise<FoundRule> {
  const h = hint.trim();
  if (!h) return { ok: false, why: "none" };
  const byId = await db.shopRule.findFirst({ where: { tenantId, id: h }, select: RULE_SELECT });
  if (byId) return { ok: true, rule: shape(byId as unknown as RuleRow) };
  const byName = await db.shopRule.findMany({
    where: { tenantId, status: { in: LIVE_STATUSES }, name: { equals: h, mode: "insensitive" } },
    take: 3,
    select: RULE_SELECT,
  });
  if (byName.length === 1) return { ok: true, rule: shape(byName[0] as unknown as RuleRow) };
  return { ok: false, why: byName.length > 1 ? "ambiguous" : "none" };
}

/** The other ACTIVE rules of a shop, for the lint (never the rule being checked). Rules that no longer parse are left out. */
export async function activeOthers(storeId: string, exceptId?: string): Promise<{ id: string; name: string; spec: RuleSpecT }[]> {
  const rows = await db.shopRule.findMany({
    where: { storeId, status: "ACTIVE", ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { createdAt: "asc" },
    take: MAX_ACTIVE_RULES * 3,
    select: { id: true, name: true, spec: true },
  });
  const out: { id: string; name: string; spec: RuleSpecT }[] = [];
  for (const r of rows) {
    const parsed = parseRuleSpec(r.spec);
    if (parsed.ok) out.push({ id: r.id, name: r.name, spec: parsed.spec });
  }
  return out;
}

/** The shop's own master switches that decide whether any rule can act: automatic replies on, and not paused (an expired page access). */
export async function storeSwitches(storeId: string): Promise<{ automatic: boolean; pausedReason: string | null } | null> {
  const s = await db.store.findUnique({ where: { id: storeId }, select: { automationEnabled: true, pausedReason: true } });
  return s ? { automatic: s.automationEnabled, pausedReason: s.pausedReason } : null;
}

/** How many rules the shop holds that are not deleted. */
export function countStored(storeId: string): Promise<number> {
  return db.shopRule.count({ where: { storeId, status: { in: LIVE_STATUSES } } });
}

/** Stores a new rule, ACTIVE from this moment (the person's Confirm is the activation). Returns its id. */
export async function insertRule(i: { tenantId: string; storeId: string; userId: string; spec: RuleSpecT; sentence: string }): Promise<string> {
  const row = await db.shopRule.create({
    data: {
      tenantId: i.tenantId,
      storeId: i.storeId,
      name: i.spec.name,
      sentence: i.sentence.slice(0, 1000),
      status: "ACTIVE",
      version: 1,
      priority: 100,
      spec: i.spec as unknown as Prisma.InputJsonValue,
      specHash: specHash(i.spec),
      createdBy: i.userId,
      activatedAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/** Moves a rule from one of the given statuses to another inside the workspace. False = it was not in one of those statuses any more. */
export async function setRuleStatus(tenantId: string, id: string, from: readonly string[], to: RuleStatus, reason: string | null): Promise<boolean> {
  const r = await db.shopRule.updateMany({
    where: { id, tenantId, status: { in: [...from] } },
    data: { status: to, pausedReason: reason, ...(to === "ACTIVE" ? { activatedAt: new Date() } : {}) },
  });
  return r.count > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The shop's own stored messages (for a backtest)

/**
 * The shop's recent INBOUND messages of the kind the rule watches, with the labels the pipeline stored on them. These are buyers'
 * words: they go to the person's screen, never to the model.
 */
export async function recentInbound(storeId: string, spec: RuleSpecT, days: number, take = 400, now = new Date()): Promise<StoredMessage[]> {
  const rows = await db.conversationMessage.findMany({
    where: {
      storeId,
      direction: "INBOUND",
      channelType: spec.trigger.channel === "comment" ? "COMMENT" : "DM",
      platform: { in: [...spec.trigger.platforms] },
      createdAt: { gte: new Date(now.getTime() - days * DAY) },
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, content: true, platform: true, commentType: true, intent: true, language: true, confidence: true },
  });
  return rows
    .filter((r) => (r.content ?? "").trim())
    .map((r) => {
      const content = r.content ?? "";
      return {
        id: r.id,
        text: spec.trigger.channel === "dm" ? typedText(content).trim() : content.trim(),
        channel: spec.trigger.channel,
        platform: r.platform as StoredMessage["platform"],
        viaVoice: spec.trigger.channel === "dm" && content.trimStart().startsWith("[audio]"),
        type: r.commentType,
        intent: r.intent,
        language: r.language,
        confidence: r.confidence,
      };
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Clean-up

/** A log row that has been CLAIMED this long without being settled was left behind by a run that died: nothing will settle it. */
export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Settles the rows a dead run left CLAIMED (the function was cut during the pause before sending, or the send threw, so the end of
 * the message never ran): after 10 minutes they become FAILED with the reason "stale", so the log never says "in progress" for ever.
 * Only rows whose message has an outcome are touched: a message without one is still the stuck-message sweep's to finish, and that
 * run follows the first decision from these very rows. Idempotent. Returns how many rows were settled.
 */
export async function settleStaleRuns(now = new Date()): Promise<number> {
  const r = await db.ruleRun.updateMany({
    where: { status: "CLAIMED", updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) }, message: { outcome: { not: null } } },
    data: { status: "FAILED", reason: "stale" },
  });
  return r.count;
}

/**
 * The daily clean-up: the rule log keeps 90 days (a deleted rule's log included: it is only hidden, and goes the same way), and
 * the rows a dead run left CLAIMED are settled first. Returns how many log rows were removed.
 */
export async function pruneRuleRuns(now = new Date()): Promise<number> {
  await settleStaleRuns(now).catch(() => 0);
  const r = await db.ruleRun.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RUN_KEEP_DAYS * DAY) } } });
  return r.count;
}
