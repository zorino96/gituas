// What one store can cost at the limits of its plan, against what it pays. The limits in
// src/lib/shop/plans.ts are set so that a store using every one of them to the end of the month
// still leaves a margin; this file is that arithmetic, and tests/billing/economics.test.ts fails
// when a limit or a price is changed in a way that breaks it.
//
// One month of limits per payment is what is worked out. Limits reset with the calendar month while a
// paid period runs 30 days, so a customer can use two months' allowances inside one paid period at most;
// `worstCaseStraddleUsd` is that case, and it must stay below the whole price (a margin of zero or more).
//
// The numbers here are ASSUMPTIONS (the AI prices are the public list prices of the nearest model
// tiers: see src/lib/ai/models.ts), written down in one place so they can be corrected in one place.
// The working, with the reasoning, is in gituas-private/2026-10-13-ai-economics.md.

import { SHOP_PRICES } from "./prices";
import { SHOP_LIMITS, type StorePlan } from "@/lib/shop/plans";

export const ASSUMPTIONS = {
  /** IQD for one US dollar at the Erbil market (the official rate is lower: this is the safer side). */
  iqdPerUsd: 1570,
  /** The payment provider and the bank, as a share of the price. */
  paymentFee: 0.03,
  /** Pawan's Sorani voice, USD per 1000 characters. */
  ttsUsdPer1kChars: 0.15,
  /** Spoken characters in the longest ad: 80 words are the aim, but only words and characters per scene are capped, so 720 is the safe figure. */
  charsPerVideo: 720,
  /** Reading one buyer voice note (speech-to-text). */
  asrUsdPerNote: 0.004,
  /**
   * One AI picture, worst case: OpenAI gpt-image-2, medium quality, portrait (about 1,600 output tokens
   * at $30 per million = $0.05) with four reference pictures read in (about 1,000 tokens each at $8 per
   * million = $0.03) and the prompt, then rounded up to leave room (about $0.12). A typical square picture with one
   * reference is about $0.05.
   * OpenAI's price pages give token prices only, so this is an estimate: check `usage` on a real call.
   */
  imageUsd: 0.12,
  /** Keeping one rendered ad on Blob storage. */
  storageUsdPerVideo: 0.001,
  /** Hosting, database and support share of one paying store, per month. */
  infraUsdPaid: 0.25,
  infraUsdOpus: 0.5,
  /**
   * At the limits, AI + voice + infrastructure may use at most this share of the net price. The unit costs above are
   * deliberately pessimistic, so a plan at 50 % still keeps half of what it brings in; it only loses money if every
   * provider's real price is about twice the pessimistic figure.
   */
  maxCostShare: 0.5,
  /** A free store is the cost of finding customers: it may cost at most this much a month. */
  maxFreeUsd: 0.2,
} as const;

export interface CostBreakdown {
  ai: number;
  videos: number;
  images: number;
  notes: number;
  infra: number;
  total: number;
}

/** USD a month for one store of this plan using every limit to the end. */
export function worstCaseCostUsd(plan: StorePlan): CostBreakdown {
  const a = ASSUMPTIONS;
  const l = SHOP_LIMITS[plan];
  const paid = (SHOP_PRICES[plan] ?? 0) > 0;
  const ai = l.aiUsd;
  const videos = l.videosPerMonth * ((a.ttsUsdPer1kChars * a.charsPerVideo) / 1000 + a.storageUsdPerVideo);
  const notes = l.voiceNotesPerDay * 30 * a.asrUsdPerNote;
  const images = l.imagesPerMonth * a.imageUsd;
  const infra = !paid ? 0 : plan === "MAX" ? a.infraUsdOpus : a.infraUsdPaid;
  return { ai, videos, images, notes, infra, total: ai + videos + images + notes + infra };
}

/** The worst case when a paid period straddles two calendar months: two months of every limit. */
export function worstCaseStraddleUsd(plan: StorePlan): number {
  const c = worstCaseCostUsd(plan);
  return 2 * (c.ai + c.videos + c.images + c.notes) + c.infra;
}

/** What the plan brings in a month after the payment fee, in USD. */
export function netRevenueUsd(plan: StorePlan): number {
  return ((SHOP_PRICES[plan] ?? 0) / ASSUMPTIONS.iqdPerUsd) * (1 - ASSUMPTIONS.paymentFee);
}

/** The share of the net price the worst case uses; Infinity for a plan that pays nothing. */
export function costShare(plan: StorePlan): number {
  const net = netRevenueUsd(plan);
  return net > 0 ? worstCaseCostUsd(plan).total / net : Infinity;
}
