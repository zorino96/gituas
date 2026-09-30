import { cityLabel } from "./cities";

export const UNKNOWN_CITY = "نەزانراو";

export interface CityRow {
  city: string;
  count: number;
  totalMinor: number;
}

/**
 * Orders grouped by governorate for the "by city" card. Cancelled and returned
 * orders never happened as far as sales go, so they are left out. A missing or
 * unrecognised city is shown as نەزانراو. Busiest city first; ties keep the
 * larger total first, then the name, so the list never jumps between renders.
 */
export function ordersByCity(orders: { city: string | null; amountMinor: number; status: string }[]): CityRow[] {
  const rows = new Map<string, CityRow>();
  for (const o of orders) {
    if (o.status === "CANCELLED" || o.status === "RETURNED") continue;
    const label = cityLabel(o.city, "ckb") || UNKNOWN_CITY;
    const row = rows.get(label) ?? { city: label, count: 0, totalMinor: 0 };
    row.count += 1;
    row.totalMinor += o.amountMinor;
    rows.set(label, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.totalMinor - a.totalMinor || a.city.localeCompare(b.city));
}
