import { beforeEach, describe, expect, it, vi } from "vitest";

// loadLeaks looks up EVERY buyer of the window for an order or a hand-answered thread, in chunks: a buyer beyond the first thousand or two
// must not be counted as "no order recorded" without being checked. The database is replaced.

const db = vi.hoisted(() => ({
  conversationMessage: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  threadPause: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { chunked, loadLeaks, LOOKUP_CHUNK, ROW_CAP } from "@/lib/shop/leaks";

const NOW = Date.parse("2026-10-25T10:00:00Z");
const HOUR = 3_600_000;
const rowFor = (author: string, hoursAgo = 2) => ({ storeId: "s1", authorId: author, createdAt: new Date(NOW - hoursAgo * HOUR), boundProductId: "p1" });

beforeEach(() => {
  vi.clearAllMocks();
  db.order.findMany.mockResolvedValue([]);
  db.threadPause.findMany.mockResolvedValue([]);
});

describe("chunked", () => {
  it("cuts a list into pieces of at most the size, keeping the order", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 3)).toEqual([]);
    expect(chunked([1, 2], 5)).toEqual([[1, 2]]);
  });
});

describe("loadLeaks with many buyers", () => {
  it("looks up every buyer, not only the first 2,000", async () => {
    const buyers = Array.from({ length: 3_500 }, (_, i) => `b${i}`);
    db.conversationMessage.findMany.mockResolvedValue(buyers.map((b) => rowFor(b)));
    await loadLeaks("t1", NOW);
    const asked = new Set<string>();
    for (const c of db.order.findMany.mock.calls) for (const id of c[0].where.buyerKey.in) asked.add(id);
    expect(asked.size).toBe(3_500);
    const pausedAsked = new Set<string>();
    for (const c of db.threadPause.findMany.mock.calls) for (const id of c[0].where.threadKey.in) pausedAsked.add(id);
    expect(pausedAsked.size).toBe(3_500);
    // in chunks, never one huge list
    for (const c of db.order.findMany.mock.calls) expect(c[0].where.buyerKey.in.length).toBeLessThanOrEqual(LOOKUP_CHUNK);
    expect(db.order.findMany).toHaveBeenCalledTimes(4);
  });

  it("does not count a buyer beyond the 2,000th as 'no order recorded' when they have an order or were answered by hand", async () => {
    const buyers = Array.from({ length: 2_600 }, (_, i) => `b${i}`);
    db.conversationMessage.findMany.mockResolvedValue(buyers.map((b) => rowFor(b)));
    // the buyers with the highest numbers are the oldest messages of the window: they used to be left unchecked
    db.order.findMany.mockImplementation(async ({ where }: { where: { buyerKey: { in: string[] } } }) => where.buyerKey.in.filter((id) => id === "b2500" || id === "b2599").map((buyerKey) => ({ buyerKey })));
    db.threadPause.findMany.mockImplementation(async ({ where }: { where: { threadKey: { in: string[] } } }) => where.threadKey.in.filter((id) => id === "b2550").map((threadKey) => ({ threadKey })));
    const out = await loadLeaks("t1", NOW);
    expect(out).toEqual({ hot: 2_600 - 3, quiet: 0, capped: false });
  });

  it("still marks a count as 'at least' only when the row cap was hit", async () => {
    db.conversationMessage.findMany.mockResolvedValue(Array.from({ length: ROW_CAP }, (_, i) => rowFor(`b${i}`)));
    expect((await loadLeaks("t1", NOW))?.capped).toBe(true);
    db.conversationMessage.findMany.mockResolvedValue(Array.from({ length: ROW_CAP - 1 }, (_, i) => rowFor(`b${i}`)));
    expect((await loadLeaks("t1", NOW))?.capped).toBe(false);
  });
});
