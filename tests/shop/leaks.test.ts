import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversationMessage: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  threadPause: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { classifyLeaks, HOT_MS, loadLeaks, ROW_CAP, type LeakRow } from "@/lib/shop/leaks";

const NOW = Date.parse("2026-10-25T10:00:00Z");
const HOUR = 3_600_000;
const row = (author: string, hoursAgo: number, product: string | null = "p1", store = "s1"): LeakRow => ({
  storeId: store,
  authorId: author,
  createdAt: new Date(NOW - hoursAgo * HOUR),
  boundProductId: product,
});

describe("classifyLeaks", () => {
  it("counts a buyer who wrote about a product under 24 hours ago as hot, and an older one as gone quiet", () => {
    const out = classifyLeaks([row("a", 2), row("b", 30), row("c", 100)], new Set(), new Set(), NOW);
    expect(out).toEqual({ hot: 1, quiet: 2 });
  });

  it("puts the line at exactly 24 hours: under is hot, 24 hours and over is quiet", () => {
    expect(classifyLeaks([row("a", 23.99)], new Set(), new Set(), NOW)).toEqual({ hot: 1, quiet: 0 });
    expect(classifyLeaks([row("a", HOT_MS / HOUR)], new Set(), new Set(), NOW)).toEqual({ hot: 0, quiet: 1 });
  });

  it("counts one buyer once, by the latest message", () => {
    const out = classifyLeaks([row("a", 50), row("a", 3), row("a", 90)], new Set(), new Set(), NOW);
    expect(out).toEqual({ hot: 1, quiet: 0 });
  });

  it("counts only buyers who wrote about a product (some earlier message had one bound)", () => {
    const noProduct = classifyLeaks([row("a", 2, null)], new Set(), new Set(), NOW);
    expect(noProduct).toEqual({ hot: 0, quiet: 0 });
    // asked about a product yesterday, wrote "thanks" an hour ago: the conversation is hot
    const later = classifyLeaks([row("a", 1, null), row("a", 30, "p1")], new Set(), new Set(), NOW);
    expect(later).toEqual({ hot: 1, quiet: 0 });
  });

  it("leaves out a buyer with an order recorded, and a thread the owner took over by hand", () => {
    const out = classifyLeaks([row("a", 2), row("b", 2), row("c", 2)], new Set(["a"]), new Set(["b"]), NOW);
    expect(out).toEqual({ hot: 1, quiet: 0 });
  });

  it("leaves out rows older than a week and rows from the future", () => {
    const out = classifyLeaks([row("a", 24 * 8), row("b", -2)], new Set(), new Set(), NOW);
    expect(out).toEqual({ hot: 0, quiet: 0 });
  });

  it("keeps two shops' buyers apart", () => {
    const out = classifyLeaks([row("a", 2, "p1", "s1"), row("a", 2, "p2", "s2")], new Set(), new Set(), NOW);
    expect(out.hot).toBe(2);
  });

  it("ignores a row with no author", () => {
    expect(classifyLeaks([{ storeId: "s1", authorId: null, createdAt: new Date(NOW - HOUR), boundProductId: "p1" }], new Set(), new Set(), NOW)).toEqual({ hot: 0, quiet: 0 });
  });
});

describe("loadLeaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.order.findMany.mockResolvedValue([]);
    db.threadPause.findMany.mockResolvedValue([]);
  });

  it("reads no text column: only an opaque id, a time and the bound product", async () => {
    db.conversationMessage.findMany.mockResolvedValue([]);
    await loadLeaks("t1", NOW);
    const args = db.conversationMessage.findMany.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual(["authorId", "boundProductId", "createdAt", "storeId"]);
    // direct messages from buyers in this workspace, last 7 days; spam, abuse and history rows are excluded without dropping rows that have no label
    expect(args.where).toMatchObject({ store: { tenantId: "t1" }, channelType: "DM", direction: "INBOUND" });
    expect(JSON.stringify(args.where.AND)).toContain("SPAM");
    expect(JSON.stringify(args.where.AND)).toContain("history");
    expect(JSON.stringify(args.where.AND)).toContain('"commentType":null');
    expect(JSON.stringify(args.where.AND)).toContain('"outcomeReason":null');
  });

  it("counts hot and quiet buyers without an order, from the rows", async () => {
    db.conversationMessage.findMany.mockResolvedValue([row("a", 2), row("b", 40), row("c", 5), row("d", 60)]);
    db.order.findMany.mockResolvedValue([{ buyerKey: "c" }]);
    db.threadPause.findMany.mockResolvedValue([{ threadKey: "d" }]);
    const out = await loadLeaks("t1", NOW);
    expect(out).toEqual({ hot: 1, quiet: 1, capped: false });
    // the order and pause lookups are scoped to this workspace
    expect(db.order.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1" });
    expect(db.threadPause.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1" });
  });

  it("says when the read hit its row cap", async () => {
    db.conversationMessage.findMany.mockResolvedValue(Array.from({ length: ROW_CAP }, (_, i) => row(`b${i}`, 2)));
    const out = await loadLeaks("t1", NOW);
    expect(out?.capped).toBe(true);
  });

  it("answers zero without more queries when nobody wrote", async () => {
    db.conversationMessage.findMany.mockResolvedValue([]);
    expect(await loadLeaks("t1", NOW)).toEqual({ hot: 0, quiet: 0, capped: false });
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it("returns null, never throws, when the database cannot be read", async () => {
    db.conversationMessage.findMany.mockRejectedValue(new Error("connection lost"));
    expect(await loadLeaks("t1", NOW)).toBeNull();
  });

  it("returns only numbers: nothing of a buyer's can be in the result", async () => {
    db.conversationMessage.findMany.mockResolvedValue([{ ...row("a", 2), content: "call me 0750 123 4567", authorName: "Secret Buyer" }]);
    const out = await loadLeaks("t1", NOW);
    expect(JSON.stringify(out)).not.toMatch(/0750|Secret|call me/);
    expect(Object.keys(out ?? {}).sort()).toEqual(["capped", "hot", "quiet"]);
  });
});
