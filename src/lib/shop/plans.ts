import { opusAvailable } from "@/lib/ai/models";
/** UNLIMITED is never sold or listed: a code the owner minted puts a test account on it (src/lib/shop/redeem.ts). */
export type StorePlan = "FREE" | "MERCHANT" | "PRO" | "MAX" | "UNLIMITED";

/** The plans on sale, in order (everything that lists or prices plans uses this, so UNLIMITED never shows). */
export type SoldPlan = Exclude<StorePlan, "UNLIMITED">;
export const STORE_PLANS: readonly SoldPlan[] = ["FREE", "MERCHANT", "PRO", "MAX"];

export interface ShopLimits {
  /** How many of the newest posts are automated; null means all. */
  posts: number | null;
  repliesPerDay: number;
  aiVaryPerMonth: number;
  /** Smart replies written by the assistant in the owner's words (comments and chats) per month. */
  smartPerMonth: number;
  /** Buyer voice messages read (transcribed) per day; each one costs speech-to-text credits. */
  voiceNotesPerDay: number;
  /**
   * What the AI may cost this plan per month, in USD at the assumed list prices (src/lib/ai/models.ts):
   * every model call, of every feature, is counted against it. When it is used up the AI features rest
   * until next month and the shop's fixed templates and rules go on answering.
   */
  aiUsd: number;
  /** The part of aiUsd that may be spent on Claude Opus (0 = this plan never uses Opus). The rest is Haiku. */
  aiOpusUsd: number;
  /** AI video ads per month. On a plan with Opus they are scripted by Opus, on the others by Haiku. */
  videosPerMonth: number;
  /** Pictures made by the AI (OpenAI's image model) per month: each costs real money, a few cents. */
  imagesPerMonth: number;
}

/** However many a plan allows in a month, no workspace makes more videos than this in one day (Baghdad time) per paid store. */
export const VIDEOS_PER_DAY = 1;
/** The same for AI pictures. */
export const IMAGES_PER_DAY = 5;

/**
 * The limits are set from what each plan pays (src/lib/billing/prices.ts) so that a store using every
 * one of them to the end of the month still leaves a margin; the working is in
 * gituas-private/2026-10-13-ai-economics.md and the check in src/lib/billing/economics.ts. Opus is a
 * plan feature, not a per-video choice.
 */
export const SHOP_LIMITS: Record<StorePlan, ShopLimits> = {
  FREE: { posts: 3, repliesPerDay: 100, aiVaryPerMonth: 10, smartPerMonth: 10, voiceNotesPerDay: 0, aiUsd: 0.08, aiOpusUsd: 0, videosPerMonth: 0, imagesPerMonth: 0 },
  MERCHANT: { posts: 25, repliesPerDay: 1000, aiVaryPerMonth: 150, smartPerMonth: 400, voiceNotesPerDay: 4, aiUsd: 1.25, aiOpusUsd: 0, videosPerMonth: 16, imagesPerMonth: 6 },
  PRO: { posts: null, repliesPerDay: 5000, aiVaryPerMonth: 300, smartPerMonth: 800, voiceNotesPerDay: 8, aiUsd: 2, aiOpusUsd: 0, videosPerMonth: 24, imagesPerMonth: 12 },
  MAX: { posts: null, repliesPerDay: 5000, aiVaryPerMonth: 1000, smartPerMonth: 1500, voiceNotesPerDay: 12, aiUsd: 7.5, aiOpusUsd: 5, videosPerMonth: VIDEOS_PER_DAY * 30, imagesPerMonth: 30 },
  // Test accounts: no limit anyone would meet while testing. The AI figures are a safety ceiling against a runaway loop, not a plan:
  // $100 a month in all, $60 of it on Opus, per workspace.
  UNLIMITED: { posts: null, repliesPerDay: 100_000, aiVaryPerMonth: 100_000, smartPerMonth: 100_000, voiceNotesPerDay: 2_000, aiUsd: 100, aiOpusUsd: 60, videosPerMonth: 3_000, imagesPerMonth: 3_000 },
};

/** Videos and AI pictures a day for a store of this plan (the same two numbers for every sold plan). */
export const videosPerDayOf = (plan: StorePlan): number => (plan === "UNLIMITED" ? 500 : VIDEOS_PER_DAY);
export const imagesPerDayOf = (plan: StorePlan, monthly: number): number => (plan === "UNLIMITED" ? 500 : monthly > 0 ? IMAGES_PER_DAY : 0);

export function isStorePlan(v: unknown): v is StorePlan {
  return typeof v === "string" && Object.hasOwn(SHOP_LIMITS, v);
}

/** Whether a plan includes Claude Opus (replies, analysis and video scripts). */
export function planUsesOpus(plan: StorePlan): boolean {
  // Not while Opus is switched off (AI_OPUS_ENABLED=0): every video is then a Lite video.
  return opusAvailable() && SHOP_LIMITS[plan].aiOpusUsd > 0;
}

/** The store's own cap applies when it is lower than the plan's. */
export function dailyCap(plan: StorePlan, storeCap: number | null): number {
  const planCap = SHOP_LIMITS[plan].repliesPerDay;
  return storeCap != null && storeCap < planCap ? storeCap : planCap;
}

export interface TenantLimits {
  aiUsd: number;
  aiOpusUsd: number;
  /** Haiku videos a month and Opus videos a month. */
  videos: { LITE: number; PRO: number };
  /** Videos a day, of both kinds. */
  videosPerDay: number;
  /** AI pictures a month and a day. */
  images: number;
  imagesPerDay: number;
}

/**
 * What a workspace may use in all: the AI and the videos belong to the workspace, not to each
 * connected account, so another Facebook Page or Instagram account does not bring another free
 * allowance. Every paid store brings its plan's allowance; free stores bring one allowance in all,
 * and only when there is no paid store.
 */
export function tenantLimits(plans: readonly StorePlan[]): TenantLimits {
  const paid = plans.filter((p) => p !== "FREE");
  // A workspace with no shop has nothing to spend the free allowance on.
  const counted: StorePlan[] = paid.length ? paid : plans.length ? ["FREE"] : [];
  const out: TenantLimits = { aiUsd: 0, aiOpusUsd: 0, videos: { LITE: 0, PRO: 0 }, videosPerDay: 0, images: 0, imagesPerDay: 0 };
  let testSeen = false;
  for (const p of counted) {
    // A test workspace counts once however many shops it has, so the AI ceiling is per workspace, not per shop.
    if (p === "UNLIMITED") {
      if (testSeen) continue;
      testSeen = true;
    }
    const l = SHOP_LIMITS[p];
    out.aiUsd += l.aiUsd;
    out.aiOpusUsd += l.aiOpusUsd;
    // Both kinds of video are open to a test account (while Opus is switched off there is only the one kind).
    if (p === "UNLIMITED" && planUsesOpus(p)) out.videos.LITE += l.videosPerMonth;
    out.videos[planUsesOpus(p) ? "PRO" : "LITE"] += l.videosPerMonth;
    out.videosPerDay += videosPerDayOf(p);
    out.images += l.imagesPerMonth;
    out.imagesPerDay += imagesPerDayOf(p, l.imagesPerMonth);
  }
  return out;
}
