import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/db", () => ({
  db: {
    usage: {
      upsert: vi.fn(async ({ where, create, update }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } }; create: { count: number }; update: { count: { increment: number } } }) => {
        const w = where.tenantId_month_metric;
        const k = `${w.tenantId}|${w.month}|${w.metric}`;
        rows.set(k, rows.has(k) ? rows.get(k)! + update.count.increment : create.count);
        return { count: rows.get(k)! };
      }),
      updateMany: vi.fn(async ({ where }: { where: { tenantId: string; month: string; metric: string } }) => {
        const k = `${where.tenantId}|${where.month}|${where.metric}`;
        if ((rows.get(k) ?? 0) > 0) rows.set(k, rows.get(k)! - 1);
        return { count: 1 };
      }),
    },
  },
}));

import { baghdadDay, claimSlot, IMAGE_SLOTS, refundSlot, takeDaily } from "@/lib/ai/slots";

beforeEach(() => rows.clear());

describe("takeDaily", () => {
  it("gives what is left of the day and no more", async () => {
    expect(await takeDaily("t1", "x", 30, 100)).toBe(30);
    expect(await takeDaily("t1", "x", 60, 100)).toBe(60);
    // 10 left: only 10 of the 50 asked for.
    expect(await takeDaily("t1", "x", 50, 100)).toBe(10);
    expect(await takeDaily("t1", "x", 5, 100)).toBe(0);
    expect(rows.get(`t1|${baghdadDay()}|x`)).toBe(100);
  });

  it("cannot be passed by parallel callers", async () => {
    const got = await Promise.all(Array.from({ length: 10 }, () => takeDaily("t2", "y", 3, 12)));
    expect(got.reduce((a, b) => a + b, 0)).toBe(12);
    expect(rows.get(`t2|${baghdadDay()}|y`)).toBe(12);
  });

  it("gives nothing for nothing asked or a cap of nothing", async () => {
    expect(await takeDaily("t3", "z", 0, 10)).toBe(0);
    expect(await takeDaily("t3", "z", 5, 0)).toBe(0);
  });
});

describe("claimSlot and refundSlot", () => {
  it("refunds to the periods the place was claimed in", async () => {
    const c = await claimSlot("t4", IMAGE_SLOTS, { month: 5, day: 5 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    // The place was claimed yesterday's night: the refund goes to those periods, not to today's.
    const other = { month: "2026-01", day: "2026-01-31" };
    rows.set(`t4|${other.month}|${IMAGE_SLOTS.month}`, 1);
    rows.set(`t4|${other.day}|${IMAGE_SLOTS.day}`, 1);
    await refundSlot("t4", IMAGE_SLOTS, c);
    expect(rows.get(`t4|${c.month}|${IMAGE_SLOTS.month}`)).toBe(0);
    expect(rows.get(`t4|${c.day}|${IMAGE_SLOTS.day}`)).toBe(0);
    expect(rows.get(`t4|${other.month}|${IMAGE_SLOTS.month}`)).toBe(1);
  });
});
