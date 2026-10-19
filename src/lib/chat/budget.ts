// What a chat may cost. A person's question is ONE chat turn however many model calls and tool calls it takes; every model call is
// metered against the workspace's AI allowance (src/lib/ai/meter.ts), and chat stops at the optional share of it so buyers' messages
// keep theirs. Looking things up through the quick buttons uses no model, so it costs no turn at all.

import type { SlotMetric } from "@/lib/ai/slots";

export const CHAT_SLOTS: SlotMetric = { month: "chat", day: "chat_day" };

/** aiUsd: the workspace's monthly AI allowance in USD. */
export function chatCaps(aiUsd: number): { month: number; day: number } {
  const month = Math.min(5_000, Math.max(10, Math.round(aiUsd * 120)));
  return { month, day: Math.min(500, Math.max(4, Math.ceil(month / 5))) };
}

/** A workspace with no shop has no allowance to count against: it gets a few turns, uncounted, to get started. */
export const NO_SHOP_CHAT_CAPS = { month: 6, day: 3 } as const;

/** Shortcut buttons use no model, but they read live from Meta: a fence per day. */
export const CHAT_QUICK_PER_DAY = 150;
export const NO_SHOP_QUICK_PER_DAY = 30;

/**
 * What one chat turn costs the allowance at the assumed prices (a turn is two or three model calls of about 9,000 tokens in): the
 * turns the screen says are left never exceed what the rest of the allowance can pay for.
 */
export const TURN_COST_MICRO = 25_000;

/** Failed turns given back in a day: a failure that was paid for must not loop for free. */
export const CHAT_REFUNDS_PER_DAY = 5;

/** Confirmed changes a workspace may make in a day, and posts among them (shared with the older assistant's counters). */
export const ACTIONS_PER_DAY = 40;
export const POSTS_PER_DAY = 15;

export const LIMITS = {
  /** Model calls in one turn. */
  maxSteps: 6,
  /** Tool calls the loop honours from one model call (the rest are told to wait). */
  maxToolCallsPerStep: 3,
  /** The whole turn, inside the request's 60 s. */
  deadlineMs: 50_000,
  /** A model call is not started with less than this left. */
  minStepMs: 12_000,
  /** A change is run by itself only with this much of the turn left (a post can take 30 s); else it waits for Confirm. */
  autoRunMinMs: 25_000,
  /** One read tool. */
  readTimeoutMs: 10_000,
  /** Stop a turn that has cost more than this (micro-USD at the assumed prices). */
  turnCostCapMicro: 60_000,
  /** A card that nobody confirmed dies after this. */
  runTtlMs: 30 * 60_000,
  /** The thread lock: a turn that crashed frees its thread after this. */
  lockMs: 70_000,
  /** Messages of history the model sees, and the characters they may take together. */
  historyMessages: 40,
  historyChars: 14_000,
  /** One message of history. */
  historyMessageChars: 1_500,
  /** The person's message. */
  userTextChars: 4_000,
} as const;
