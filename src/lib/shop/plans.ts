export type StorePlan = "FREE" | "MERCHANT" | "PRO";

export interface ShopLimits {
  /** How many of the newest posts are automated; null means all. */
  posts: number | null;
  repliesPerDay: number;
  aiVaryPerMonth: number;
  /** Buyer voice messages read (transcribed) per day; each one costs speech-to-text credits. */
  voiceNotesPerDay: number;
}

export const SHOP_LIMITS: Record<StorePlan, ShopLimits> = {
  FREE: { posts: 3, repliesPerDay: 100, aiVaryPerMonth: 30, voiceNotesPerDay: 10 },
  MERCHANT: { posts: 25, repliesPerDay: 1000, aiVaryPerMonth: 500, voiceNotesPerDay: 100 },
  PRO: { posts: null, repliesPerDay: 5000, aiVaryPerMonth: 3000, voiceNotesPerDay: 400 },
};

/** The store's own cap applies when it is lower than the plan's. */
export function dailyCap(plan: StorePlan, storeCap: number | null): number {
  const planCap = SHOP_LIMITS[plan].repliesPerDay;
  return storeCap != null && storeCap < planCap ? storeCap : planCap;
}
