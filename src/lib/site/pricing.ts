// The plans table of the pricing page, read from the same constants the product runs on, so it cannot drift.

import { DAILY_ANALYSES } from "@/lib/boost/cache";
import { maxPlanOpen, SHOP_PRICES } from "@/lib/billing/prices";
import { SHOP_ACCOUNT_CAP } from "@/lib/oauth/account-limit";
import { SHOP_LIMITS, type StorePlan } from "@/lib/shop/plans";

export interface PlanRow {
  plan: StorePlan;
  price: number;
  /** null = every post. */
  posts: number | null;
  repliesPerDay: number;
  aiRepliesPerMonth: number;
  voiceNotesPerDay: number;
  boostPerDay: number;
  videosPerMonth: number;
  picturesPerMonth: number;
  accounts: number;
  opus: boolean;
}

/** Free, Merchant and Pro always; Max only while it is on sale. */
export function planRows(): PlanRow[] {
  const plans: StorePlan[] = ["FREE", "MERCHANT", "PRO", ...(maxPlanOpen() ? (["MAX"] as const) : [])];
  return plans.map((plan) => {
    const l = SHOP_LIMITS[plan];
    return {
      plan,
      price: SHOP_PRICES[plan] ?? 0,
      posts: l.posts,
      repliesPerDay: l.repliesPerDay,
      aiRepliesPerMonth: l.smartPerMonth,
      voiceNotesPerDay: l.voiceNotesPerDay,
      boostPerDay: DAILY_ANALYSES[plan] ?? 1,
      videosPerMonth: l.videosPerMonth,
      picturesPerMonth: l.imagesPerMonth,
      accounts: SHOP_ACCOUNT_CAP[plan],
      opus: l.aiOpusUsd > 0,
    };
  });
}
