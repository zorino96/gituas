import { cityLabel, type CityLang } from "./cities";

export const UNKNOWN_CITY = "نەزانراو";
export const UNKNOWN_CITY_AR = "غير معروف";
export const UNKNOWN_CITY_EN = "Unknown";

export interface CityRow {
  city: string;
  count: number;
  totalMinor: number;
}

export interface BuyerProfile {
  /** Governorate codes, most orders first: the locations to target when boosting. */
  cities: string[];
  /** Baghdad hours (0-23) buyers write most, busiest first: when the ad should run. */
  hours: number[];
  /** Languages buyers write in, most first: the ad's language. */
  languages: string[];
  /** Product names, most ordered first: what to boost. */
  products: string[];
  /** Messages and orders this was built from; too few and it is only a guess. */
  messages: number;
  orders: number;
}

const top = <K>(counts: Map<K, number>, n: number): K[] => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Who actually buys, from the shop's own buyer messages and orders: the audience
 * to give Meta when the merchant boosts, so the money goes to the cities, hours and
 * language that already turn into orders instead of a broad guess.
 */
export function buyerProfile(
  messages: { createdAt: Date; language: string | null }[],
  orders: { city: string | null; productName: string; status: string }[],
): BuyerProfile {
  const cities = new Map<string, number>();
  const products = new Map<string, number>();
  const hours = new Map<number, number>();
  const langs = new Map<string, number>();
  const real = orders.filter((o) => o.status !== "CANCELLED" && o.status !== "RETURNED");
  for (const o of real) {
    if (o.city) bump(cities, o.city);
    if (o.productName) bump(products, o.productName);
  }
  for (const m of messages) {
    bump(hours, (m.createdAt.getUTCHours() + 3) % 24);
    if (m.language) bump(langs, m.language);
  }
  return { cities: top(cities, 5), hours: top(hours, 4).sort((a, b) => a - b), languages: top(langs, 2), products: top(products, 3), messages: messages.length, orders: real.length };
}

/**
 * Orders grouped by governorate for the "by city" card. Cancelled and returned
 * orders never happened as far as sales go, so they are left out. A missing or
 * unrecognised city is shown as نەزانراو (غير معروف in Arabic). Busiest city first; ties keep the
 * larger total first, then the name, so the list never jumps between renders.
 */
export function ordersByCity(orders: { city: string | null; amountMinor: number; status: string }[], lang: CityLang = "ckb"): CityRow[] {
  const rows = new Map<string, CityRow>();
  for (const o of orders) {
    if (o.status === "CANCELLED" || o.status === "RETURNED") continue;
    const label = cityLabel(o.city, lang) || (lang === "ar" ? UNKNOWN_CITY_AR : lang === "en" ? UNKNOWN_CITY_EN : UNKNOWN_CITY);
    const row = rows.get(label) ?? { city: label, count: 0, totalMinor: 0 };
    row.count += 1;
    row.totalMinor += o.amountMinor;
    rows.set(label, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.totalMinor - a.totalMinor || a.city.localeCompare(b.city));
}
