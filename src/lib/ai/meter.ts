// A workspace's monthly AI allowance. Every model call made for a workspace names it (a `Meter`);
// before the call the allowance is checked and the model chosen (Opus only while the plan's Opus
// part lasts, else Haiku, else nothing), and after it the cost is added. Kept in the `Usage` table,
// keyed by the workspace id, in micro-dollars at the assumed list prices.
//
// The allowance is the workspace's, not each connected account's: see tenantLimits (plans.ts).

import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { microUsd, opusAvailable, type AiTier } from "./models";

export interface Meter {
  /** The workspace (tenant) the call is for. */
  scope: string;
}

const TOTAL = "ai_micro";
const OPUS = "ai_micro_opus";

/**
 * The share of the allowance that the features which can wait (smart replies, captions, analyses,
 * videos) may use. The rest is kept for the work that must go on: labelling buyers' messages and
 * reading order details, so a busy month never leaves buyers unanswered.
 */
export const OPTIONAL_SHARE = 0.7;

export interface Spent {
  total: number;
  opus: number;
}

export async function spentOf(scope: string, month = monthKey()): Promise<Spent> {
  const rows = await db.usage.findMany({ where: { tenantId: scope, month, metric: { in: [TOTAL, OPUS] } }, select: { metric: true, count: true } });
  const by = new Map(rows.map((r) => [r.metric, r.count]));
  return { total: by.get(TOTAL) ?? 0, opus: by.get(OPUS) ?? 0 };
}

export interface Allowance {
  usedUsd: number;
  totalUsd: number;
  opusUsedUsd: number;
  opusUsd: number;
  /** 0 to 100, of the whole allowance. */
  percent: number;
  /** 0 to 100, of the part the optional features may use. */
  optionalPercent: number;
}

export async function allowanceOf(meter: Meter): Promise<Allowance> {
  const [limit, s] = await Promise.all([limitsOf(meter.scope), spentOf(meter.scope)]);
  const usedUsd = s.total / 1e6;
  const pct = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 100);
  return {
    usedUsd,
    totalUsd: limit.aiUsd,
    opusUsedUsd: s.opus / 1e6,
    opusUsd: limit.aiOpusUsd,
    percent: pct(usedUsd, limit.aiUsd),
    optionalPercent: pct(usedUsd, limit.aiUsd * OPTIONAL_SHARE),
  };
}

/**
 * The tier a call may use: the one asked for if the plan has it and its part of the allowance is not
 * used up, else Haiku, else null (the caller falls back to its rules). An `essential` call may use
 * the whole allowance; an optional one stops at OPTIONAL_SHARE of it.
 */
export async function chooseTier(meter: Meter, wanted: AiTier, opts: { essential?: boolean } = {}): Promise<AiTier | null> {
  const [limit, s] = await Promise.all([limitsOf(meter.scope), spentOf(meter.scope)]);
  const cap = limit.aiUsd * 1e6 * (opts.essential ? 1 : OPTIONAL_SHARE);
  if (s.total >= cap) return null;
  if (wanted === "opus" && opusAvailable() && limit.aiOpusUsd > 0 && s.opus < limit.aiOpusUsd * 1e6) return "opus";
  return "haiku";
}

/** Adds one call's cost. Two calls at once can both pass the check; one call over is accepted. */
export async function recordSpend(meter: Meter, tier: AiTier, tokensIn: number, tokensOut: number): Promise<number> {
  const cost = microUsd(tier, tokensIn, tokensOut);
  const month = monthKey();
  const bump = (metric: string) =>
    db.usage.upsert({
      where: { tenantId_month_metric: { tenantId: meter.scope, month, metric } },
      create: { tenantId: meter.scope, month, metric, count: cost },
      update: { count: { increment: cost } },
    });
  await Promise.all([bump(TOTAL), ...(tier === "opus" ? [bump(OPUS)] : [])]);
  return cost;
}
