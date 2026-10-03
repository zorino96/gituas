export type BillingProduct = "SHOP" | "NEWS";

export const PERIOD_DAYS = 30;
const DAY = 86_400_000;

/** IQD per month. Shop plans are per store, and one store covers the whole business (Facebook, Instagram, TikTok, YouTube); newsroom plans per workspace. */
export const SHOP_PRICES: Record<string, number> = { MERCHANT: 8000, PRO: 12000 };
export const NEWS_PRICES: Record<string, number> = { LITE: 25000, MANUAL: 155000, AUTO: 390000, ENTERPRISE: 940000 };

export const PLAN_LABEL: Record<string, string> = {
  FREE: "بەخۆڕایی",
  MERCHANT: "بازرگان",
  PRO: "پرۆ",
  LITE: "پەیجی بچووک",
  MANUAL: "بنەڕەت",
  AUTO: "پرۆ",
  ENTERPRISE: "دامەزراوە",
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
};

export function planLabel(plan: string, lang: "ckb" | "ar" | "en" = "ckb"): string {
  return (lang === "ar" ? PLAN_LABEL_AR : lang === "en" ? PLAN_LABEL_EN : PLAN_LABEL)[plan] ?? plan;
}

/** The price of a plan that is for sale, or null. */
export function priceFor(product: BillingProduct, plan: string): number | null {
  const table = product === "SHOP" ? SHOP_PRICES : NEWS_PRICES;
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
