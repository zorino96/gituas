import { SHOP_LIMITS, type StorePlan } from "@/lib/shop/plans";
import { NEWS_LIMITS, type Plan } from "./plans";
import type { BillingProduct } from "./prices";

/** What a feature row is about; the billing dictionary has a label under `billing.features.label` for each. */
export type FeatureKey =
  | "refresh"
  | "drafts"
  | "improves"
  | "publishes"
  | "sources"
  | "seats"
  | "desks"
  | "mode"
  | "shopPosts"
  | "shopReplies"
  | "shopAi";

/**
 * A number is a count (for `refresh`, a number of seconds); the words are the few values that are
 * not numbers: the two autopilot modes, and "every post" for a shop plan with no post cap.
 */
export type FeatureValue = number | "autoDraft" | "autoPublish" | "all";

export interface PlanFeature {
  key: FeatureKey;
  value: FeatureValue;
}

/** What a plan includes, in the order the billing page lists it. An unknown plan includes nothing. */
export function planFeatures(product: BillingProduct, plan: string): PlanFeature[] {
  if (product === "NEWS") {
    if (!Object.hasOwn(NEWS_LIMITS, plan)) return [];
    const l = NEWS_LIMITS[plan as Plan];
    return [
      { key: "refresh", value: l.refreshSec },
      { key: "drafts", value: l.draft },
      { key: "improves", value: l.improve },
      { key: "publishes", value: l.publish },
      { key: "sources", value: l.sources },
      { key: "seats", value: l.seats },
      { key: "desks", value: l.desks },
      { key: "mode", value: l.autoPublish ? "autoPublish" : "autoDraft" },
    ];
  }
  if (!Object.hasOwn(SHOP_LIMITS, plan)) return [];
  const l = SHOP_LIMITS[plan as StorePlan];
  return [
    { key: "shopPosts", value: l.posts ?? "all" },
    { key: "shopReplies", value: l.repliesPerDay },
    { key: "shopAi", value: l.aiVaryPerMonth },
  ];
}
