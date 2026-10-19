import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ order: { groupBy: vi.fn(), count: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { loadOrderTiles, OPEN_STATUSES } from "@/lib/coach/tiles";

const NOW = Date.parse("2026-10-25T07:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.order.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
    by[0] === "currency"
      ? [
          { currency: "IQD", _count: { _all: 3 }, _sum: { amountMinor: 125_000 } },
          { currency: "USD", _count: { _all: 1 }, _sum: { amountMinor: 2_050 } },
        ]
      : [
          { source: "COMMENT", _count: { _all: 2 } },
          { source: "DM", _count: { _all: 3 } },
          { source: "MANUAL", _count: { _all: 1 } },
        ],
  );
  db.order.count.mockResolvedValue(4);
});

describe("loadOrderTiles", () => {
  it("counts the open orders and their ordered value by currency, never adding currencies together", async () => {
    const t = await loadOrderTiles("t1", NOW);
    expect(t?.open).toEqual({ count: 4, valueMinor: { IQD: 125_000, USD: 2_050 } });
  });

  it("counts the orders recorded this week by where they came from, and the delivered ones", async () => {
    const t = await loadOrderTiles("t1", NOW);
    expect(t).toMatchObject({ week: 6, bySource: { comments: 2, messages: 3, byHand: 1 }, delivered: 4 });
  });

  it("asks the database to add up: grouped, scoped to the workspace, open statuses only, cancelled and returned left out", async () => {
    await loadOrderTiles("t1", NOW);
    const open = db.order.groupBy.mock.calls.find((c) => c[0].by[0] === "currency")![0];
    expect(open.where).toEqual({ tenantId: "t1", status: { in: [...OPEN_STATUSES] } });
    expect(OPEN_STATUSES).toEqual(["NEW", "CONFIRMED", "SENT"]);
    const week = db.order.groupBy.mock.calls.find((c) => c[0].by[0] === "source")![0];
    expect(week.where).toMatchObject({ tenantId: "t1", status: { notIn: ["CANCELLED", "RETURNED"] } });
    expect(week.where.createdAt.gt.getTime()).toBe(NOW - 7 * 86_400_000);
    expect(db.order.count.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", status: "DELIVERED" });
  });

  it("leaves out a currency whose open orders add up to nothing", async () => {
    db.order.groupBy.mockImplementation(async ({ by }: { by: string[] }) => (by[0] === "currency" ? [{ currency: "IQD", _count: { _all: 2 }, _sum: { amountMinor: 0 } }] : []));
    const t = await loadOrderTiles("t1", NOW);
    expect(t?.open).toEqual({ count: 2, valueMinor: {} });
    expect(t?.week).toBe(0);
  });

  it("returns null, never throws, when the database fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.order.groupBy.mockRejectedValue(new Error("db down"));
    expect(await loadOrderTiles("t1", NOW)).toBeNull();
    spy.mockRestore();
  });
});
