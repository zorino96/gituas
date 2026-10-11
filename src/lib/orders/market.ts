// Market signals from the shop's own buyers: which products people ask about but don't buy,
// where they haggle, and what they keep asking. Pure; the insights page feeds it.

export interface ProductSignal {
  productId: string;
  name: string;
  asks: number;
  orders: number;
  haggles: number;
}

export type Advice =
  | { kind: "lowConversion"; name: string; asks: number; orders: number }
  | { kind: "priceHigh"; name: string; pct: number }
  | { kind: "topIntent"; intent: string; pct: number };

/** Below this many asks a product's numbers are noise. */
const MIN_ASKS = 10;

export function marketSignals(
  messages: { boundProductId: string | null; commentType: string | null; intent: string | null }[],
  orders: { productId: string | null; status: string }[],
  names: Record<string, string>,
): { products: ProductSignal[]; advice: Advice[] } {
  const by = new Map<string, ProductSignal>();
  const row = (id: string) => by.get(id) ?? by.set(id, { productId: id, name: names[id] ?? "", asks: 0, orders: 0, haggles: 0 }).get(id)!;
  const intents = new Map<string, number>();
  let questions = 0;
  for (const m of messages) {
    if (m.commentType === "QUESTION") {
      questions++;
      if (m.intent && m.intent !== "none") intents.set(m.intent, (intents.get(m.intent) ?? 0) + 1);
    }
    if (!m.boundProductId || !names[m.boundProductId]) continue;
    if (m.commentType === "QUESTION" || m.commentType === "ORDER") row(m.boundProductId).asks++;
    if (m.commentType === "NEGOTIATION") row(m.boundProductId).haggles++;
  }
  for (const o of orders) {
    if (o.productId && names[o.productId] && o.status !== "CANCELLED" && o.status !== "RETURNED") row(o.productId).orders++;
  }
  const products = [...by.values()].sort((a, b) => b.asks - a.asks || b.orders - a.orders);

  const advice: Advice[] = [];
  for (const p of products) {
    if (p.asks < MIN_ASKS) continue;
    if (p.orders / p.asks < 0.05) advice.push({ kind: "lowConversion", name: p.name, asks: p.asks, orders: p.orders });
    const pct = Math.round((p.haggles / (p.asks + p.haggles)) * 100);
    if (pct >= 20) advice.push({ kind: "priceHigh", name: p.name, pct });
  }
  const top = [...intents.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && questions >= MIN_ASKS) advice.push({ kind: "topIntent", intent: top[0], pct: Math.round((top[1] / questions) * 100) });
  return { products: products.slice(0, 8), advice };
}

/** Meta's public Ad Library: every active ad in Iraq that mentions the words, from any page. */
export function adLibraryUrl(query: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IQ&media_type=all&search_type=keyword_unordered&q=${encodeURIComponent(query)}`;
}
