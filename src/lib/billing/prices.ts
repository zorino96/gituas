export type BillingProduct = "SHOP" | "NEWS";

export const PERIOD_DAYS = 30;
const DAY = 86_400_000;

/** IQD per month. Shop plans are per store (page); newsroom plans per workspace. */
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
