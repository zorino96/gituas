export type BillingProduct = "SHOP" | "NEWS" | "STUDIO";

export const PERIOD_DAYS = 30;
const DAY = 86_400_000;

/** IQD per month. Shop plans are per store, and one store covers the whole business (Facebook, Instagram, TikTok, YouTube); newsroom plans per workspace. */
export const SHOP_PRICES: Record<string, number> = { MERCHANT: 8000, PRO: 12000 };
export const NEWS_PRICES: Record<string, number> = { LITE: 25000, MANUAL: 155000, AUTO: 390000, ENTERPRISE: 940000 };
/** Studio top-ups: the IQD a shop adds to its prepaid Studio balance (one payment, no period). */
export const STUDIO_PACKS: Record<string, number> = { STUDIO_5K: 5000, STUDIO_10K: 10000, STUDIO_25K: 25000, STUDIO_50K: 50000 };

export const PLAN_LABEL: Record<string, string> = {
  FREE: "بەخۆڕایی",
  MERCHANT: "بازرگان",
  PRO: "پرۆ",
  LITE: "پەیجی بچووک",
  MANUAL: "بنەڕەت",
  AUTO: "پرۆ",
  ENTERPRISE: "دامەزراوە",
  STUDIO_5K: "باڵانسی ستۆدیۆ ٥٬٠٠٠",
  STUDIO_10K: "باڵانسی ستۆدیۆ ١٠٬٠٠٠",
  STUDIO_25K: "باڵانسی ستۆدیۆ ٢٥٬٠٠٠",
  STUDIO_50K: "باڵانسی ستۆدیۆ ٥٠٬٠٠٠",
};

/** The same names in Arabic, for the Arabic UI (they read after "باقة": "شراء باقة تاجر"). */
export const PLAN_LABEL_AR: Record<string, string> = {
  FREE: "مجانية",
  MERCHANT: "تاجر",
  PRO: "احترافية",
  LITE: "صفحة صغيرة",
  MANUAL: "أساسية",
  AUTO: "احترافية",
  ENTERPRISE: "مؤسسات",
  STUDIO_5K: "رصيد الاستوديو 5,000",
  STUDIO_10K: "رصيد الاستوديو 10,000",
  STUDIO_25K: "رصيد الاستوديو 25,000",
  STUDIO_50K: "رصيد الاستوديو 50,000",
};

/** A plan's display name in `lang`; an unknown plan code is shown as it is. */
/** The same names in English. */
export const PLAN_LABEL_EN: Record<string, string> = {
  FREE: "Free",
  MERCHANT: "Merchant",
  PRO: "Pro",
  LITE: "Small page",
  MANUAL: "Basic",
  AUTO: "Pro",
  ENTERPRISE: "Enterprise",
  STUDIO_5K: "Studio balance 5,000",
  STUDIO_10K: "Studio balance 10,000",
  STUDIO_25K: "Studio balance 25,000",
  STUDIO_50K: "Studio balance 50,000",
};

export function planLabel(plan: string, lang: "ckb" | "ar" | "en" = "ckb"): string {
  return (lang === "ar" ? PLAN_LABEL_AR : lang === "en" ? PLAN_LABEL_EN : PLAN_LABEL)[plan] ?? plan;
}

/** The price of a plan that is for sale, or null. */
export function priceFor(product: BillingProduct, plan: string): number | null {
  const table = product === "SHOP" ? SHOP_PRICES : product === "STUDIO" ? STUDIO_PACKS : NEWS_PRICES;
  return Object.hasOwn(table, plan) ? table[plan] : null;
}

/** A payment adds one period after whatever is still running, or from now. */
export function extendPaidUntil(current: Date | null, now: Date, days = PERIOD_DAYS): Date {
  const from = current && current.getTime() > now.getTime() ? current : now;
  return new Date(from.getTime() + days * DAY);
}

/**
 * The new paid-until after paying for `newPlan`. Same plan: stack another period. Different plan
 * while a period is still running: the remaining time is converted at the price ratio (cheap
 * months become a few expensive days, and a downgrade keeps its value), then one period is added.
 */
export function nextPaidUntil(product: BillingProduct, current: { plan: string; paidUntil: Date | null }, newPlan: string, now: Date, days = PERIOD_DAYS): Date {
  const remaining = current.paidUntil && current.paidUntil.getTime() > now.getTime() ? current.paidUntil.getTime() - now.getTime() : 0;
  if (!remaining || current.plan === newPlan) return extendPaidUntil(current.paidUntil, now, days);
  const oldPrice = priceFor(product, current.plan) ?? 0;
  const newPrice = priceFor(product, newPlan) ?? 0;
  const credit = newPrice > 0 ? Math.floor((remaining * oldPrice) / newPrice) : 0;
  return new Date(now.getTime() + credit + days * DAY);
}
