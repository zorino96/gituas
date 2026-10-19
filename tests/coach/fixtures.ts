// Shared by the growth-coach tests: a busy shop's facts, and a way to change them.

import type { CoachFacts } from "@/lib/coach/facts";

export const busyFacts = (over: Partial<CoachFacts> = {}): CoachFacts => ({
  v: 1,
  week: "2026-W43",
  goal: { kind: "sell", text: null },
  lang: "ckb",
  profile: [],
  orders: {
    week: 14,
    before: 10,
    cancelled: 2,
    sales: { IQD: 1_250_000 },
    salesBefore: { IQD: 900_000 },
    changePct: 40,
    byStatus: { NEW: 5, DELIVERED: 9 },
    top: [{ name: "Red bag", orders: 6 }],
  },
  interest: [{ name: "Red bag", asks: 40, orders: 1, haggles: 12, haggleSharePct: 23 }],
  messages: { dm: 55, dmBefore: 40, comments: 120, commentsBefore: 100 },
  waiting: 4,
  posts: { published: 3, byAutopilot: 2 },
  buyers: { cities: ["erbil", "sulaymaniyah"], hours: [20, 21, 22], messages: 55, orders: 14 },
  ...over,
});

// ---------------------------------------------------------------------------------------------------------------------
// A mocked database for the tests that run the real collectFacts.

/** Words a buyer or staff member typed: none of them may reach a tool's result. */
export const SECRETS = ["SECRET-BUYER-NAME", "SECRET-NOTE call 07501234567", "SECRET-ADDRESS Gulan street", "SECRET-MESSAGE text", "SECRET-PHONE", "SECRET-TRANSCRIPT"];
/** Columns that hold free text; no query may select one. */
export const FREE_TEXT_COLUMNS = ["content", "note", "customerName", "phone", "address", "authorName", "authorHandle", "transcript", "generatedReply", "reasoning", "variantLabel", "lastError"];

type Fn = { mockResolvedValue(v: unknown): unknown; mockImplementation(f: (...a: never[]) => unknown): unknown };
export interface ShopDbMock {
  store: { findMany: Fn };
  order: { findMany: Fn };
  product: { findMany: Fn };
  conversationMessage: { findMany: Fn; count: Fn };
  auditLog: { count: Fn };
  businessProfile: { findMany: Fn };
}

/** A small shop: three orders this week (one more cancelled), two the week before, 12 questions about a bag, 4 messages waiting. */
export function seedShopDb(db: ShopDbMock, now: number): void {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(now - days * DAY);
  const order = (over: Record<string, unknown>) => ({
    createdAt: ago(1),
    amountMinor: 25_000,
    currency: "IQD",
    status: "NEW",
    productId: "p1",
    city: "erbil",
    // columns the code must never ask for; a careless query would bring them in
    customerName: SECRETS[0],
    note: SECRETS[1],
    address: SECRETS[2],
    phone: SECRETS[4],
    ...over,
  });
  db.store.findMany.mockResolvedValue([{ id: "s1" }]);
  db.product.findMany.mockResolvedValue([
    { id: "p1", name: "Red bag" },
    { id: "p2", name: "Blue shoe" },
  ]);
  db.order.findMany.mockResolvedValue([
    order({ createdAt: ago(1) }),
    order({ createdAt: ago(2), status: "DELIVERED" }),
    order({ createdAt: ago(3), productId: "p2", amountMinor: 40_000, city: "duhok" }),
    order({ createdAt: ago(4), status: "CANCELLED" }),
    order({ createdAt: ago(9) }),
    order({ createdAt: ago(10), amountMinor: 30_000 }),
    order({ createdAt: ago(20) }),
  ]);
  db.conversationMessage.findMany.mockImplementation((async ({ where }: { where: { commentType?: unknown } }) => {
    if (where.commentType) {
      return [
        ...Array.from({ length: 12 }, () => ({ boundProductId: "p1", commentType: "QUESTION", intent: "price", content: SECRETS[3] })),
        ...Array.from({ length: 2 }, () => ({ boundProductId: "p1", commentType: "NEGOTIATION", intent: null, content: SECRETS[3] })),
      ];
    }
    return Array.from({ length: 12 }, (_, i) => ({ createdAt: new Date(now - i * 3_600_000), language: "ckb", content: SECRETS[3], transcript: SECRETS[5], authorName: SECRETS[0] }));
  }) as never);
  db.conversationMessage.count.mockImplementation((async ({ where }: { where: { outcome?: string; channelType?: string; createdAt: { lte?: Date } } }) => {
    if (where.outcome === "FLAGGED") return 4;
    const before = !!where.createdAt.lte;
    if (where.channelType === "DM") return before ? 40 : 55;
    return before ? 100 : 120;
  }) as never);
  db.auditLog.count.mockImplementation((async ({ where }: { where: { action: string } }) => (where.action === "app.publish" ? 3 : 2)) as never);
  db.businessProfile.findMany.mockResolvedValue([]);
}
