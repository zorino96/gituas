// How many questions a workspace may ask the assistant. An answer is one Haiku call: the knowledge sheet (about
// 2,500 tokens), the account's state and up to eight turns go in, and up to a few hundred tokens come out, so about
// a cent; at the worst case (the answer runs to the 3,000-token floor of the gateway) about $0.02. The number
// follows the plan's AI allowance and is sized to about a third of it at that worst case, so the assistant cannot
// take the allowance the shop's own replies need.

import type { SlotMetric } from "@/lib/ai/slots";

export const ASSISTANT_SLOTS: SlotMetric = { month: "assistant", day: "assistant_day" };

/** aiUsd: the workspace's monthly AI allowance in USD. */
export function assistantCaps(aiUsd: number): { month: number; day: number } {
  const month = Math.max(3, Math.floor(aiUsd * 12));
  return { month, day: Math.max(2, Math.ceil(month / 6)) };
}

/** A workspace with no shop has no allowance to count against: it gets a few questions, uncounted, to get started. */
export const NO_SHOP_CAPS = { month: 6, day: 3 } as const;
/** Failed answers given back in a day: a failure that was paid for must not loop for free. */
export const REFUNDS_PER_DAY = 3;
