import { formatMoney } from "@/lib/shop/money";

/** The price a buyer sees on an ad: the lowest in-stock price, with "لە" (from) when the variants differ. */
export function priceLine(variants: { amountMinor: number; currency: string; inStock: boolean }[]): string | null {
  const live = variants.filter((v) => v.inStock);
  const list = live.length ? live : variants;
  if (!list.length) return null;
  const low = list.reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a));
  const same = list.every((v) => v.amountMinor === low.amountMinor && v.currency === low.currency);
  const money = formatMoney(low.amountMinor, low.currency, "ckb");
  return same ? money : `لە ${money}`;
}
