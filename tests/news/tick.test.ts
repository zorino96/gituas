import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    newsSettings: { findMany: vi.fn() },
    tenant: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/news/ingest", () => ({ ingest: vi.fn() }));
vi.mock("@/lib/news/classify", () => ({ classifyPending: vi.fn() }));
vi.mock("@/lib/news/autopilot", () => ({ runAutopilot: vi.fn() }));

import { db } from "@/lib/db";
import { runAutopilot } from "@/lib/news/autopilot";
import { classifyPending } from "@/lib/news/classify";
import { ingest } from "@/lib/news/ingest";
import { dueDesks, secondPassDelay, TICK_GRACE_MS, tickNewsrooms, type Clock } from "@/lib/news/tick";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const NOW = 1_800_000_000_000;
const ago = (sec: number) => new Date(NOW - sec * 1000);

describe("dueDesks", () => {
  it("keeps a desk once its plan interval is up", () => {
    const desks = [
      { id: "ent", plan: "ENTERPRISE", lastFetchedAt: ago(31) },
      { id: "ent-fresh", plan: "ENTERPRISE", lastFetchedAt: ago(1) },
      { id: "lite", plan: "LITE", lastFetchedAt: ago(301) },
      { id: "lite-fresh", plan: "LITE", lastFetchedAt: ago(100) },
    ];
    expect(dueDesks(desks, NOW, 0).map((d) => d.id).sort()).toEqual(["ent", "lite"]);
  });

  it("counts a desk as due a little early, by the grace", () => {
    const lite = [{ plan: "LITE", lastFetchedAt: ago(300 - TICK_GRACE_MS / 1000 + 1) }];
    expect(dueDesks(lite, NOW, 0)).toHaveLength(0);
    expect(dueDesks(lite, NOW, TICK_GRACE_MS)).toHaveLength(1);
    expect(dueDesks([{ plan: "LITE", lastFetchedAt: ago(200) }], NOW, TICK_GRACE_MS)).toHaveLength(0);
  });

  it("serves a desk never fetched, then the most overdue first", () => {
    const desks = [
      { id: "b", plan: "MANUAL", lastFetchedAt: ago(500) },
      { id: "never", plan: "LITE", lastFetchedAt: null },
      { id: "a", plan: "MANUAL", lastFetchedAt: ago(900) },
    ];
    expect(dueDesks(desks, NOW).map((d) => d.id)).toEqual(["never", "a", "b"]);
  });

  it("reads an unknown plan as MANUAL", () => {
    expect(dueDesks([{ plan: "WHAT", lastFetchedAt: ago(100) }], NOW, 0)).toHaveLength(0);
    expect(dueDesks([{ plan: "WHAT", lastFetchedAt: ago(121) }], NOW, 0)).toHaveLength(1);
  });
});

describe("secondPassDelay", () => {
  it("waits until the 30 s mark when a 30-second desk was served early enough", () => {
    expect(secondPassDelay(0, 1)).toBe(30_000);
    expect(secondPassDelay(12_000, 3)).toBe(18_000);
    expect(secondPassDelay(24_999, 1)).toBe(5_001);
  });
  it("does nothing without a 30-second desk, or when the first pass took 25 s or more", () => {
    expect(secondPassDelay(0, 0)).toBeNull();
    expect(secondPassDelay(25_000, 1)).toBeNull();
    expect(secondPassDelay(40_000, 2)).toBeNull();
  });
});

describe("tickNewsrooms", () => {
  let t: number;
  let slept: number[];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
  /** Work that takes `ms` of the fake clock. */
  const takes = (ms: number) => () => {
    t += ms;
  };
  const live = new Date(NOW + 86_400_000);

  function desks(rows: { id: string; plan: string; lastFetchedAt?: Date | null; planPaidUntil?: Date | null }[]) {
    m.newsSettings.findMany.mockResolvedValue(rows.map((r) => ({ tenantId: r.id, lastFetchedAt: r.lastFetchedAt ?? null })));
    m.tenant.findMany.mockResolvedValue(
      rows.map((r) => ({ id: r.id, kind: "NEWS", plan: r.plan, planPaidUntil: r.planPaidUntil === undefined ? live : r.planPaidUntil, trialEndsAt: null })),
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    t = NOW;
    slept = [];
    vi.mocked(ingest).mockResolvedValue({ added: 2, failed: [], skipped: false });
    vi.mocked(classifyPending).mockResolvedValue(0);
    vi.mocked(runAutopilot).mockResolvedValue({ drafted: 1, published: 0 });
  });

  it("does nothing when no desk has the autopilot on", async () => {
    m.newsSettings.findMany.mockResolvedValue([]);
    const r = await tickNewsrooms(clock);
    expect(r).toMatchObject({ desks: 0, served: 0, added: 0, drafted: 0, published: 0, errors: 0 });
    expect(m.tenant.findMany).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("asks only for desks whose autopilot is not OFF, and for newsrooms", async () => {
    desks([]);
    await tickNewsrooms(clock);
    expect(m.newsSettings.findMany.mock.calls[0][0].where).toEqual({ autoMode: { not: "OFF" } });
    m.newsSettings.findMany.mockResolvedValue([{ tenantId: "a", lastFetchedAt: null }]);
    m.tenant.findMany.mockResolvedValue([]);
    await tickNewsrooms(clock);
    expect(m.tenant.findMany.mock.calls[0][0].where).toMatchObject({ kind: "NEWS", id: { in: ["a"] } });
  });

  it("runs ingest, then classify, then the autopilot for a due desk, and totals the counts", async () => {
    desks([{ id: "a", plan: "MANUAL" }]);
    const order: string[] = [];
    vi.mocked(ingest).mockImplementation(async () => (order.push("ingest"), { added: 2, failed: [], skipped: false }));
    vi.mocked(classifyPending).mockImplementation(async () => (order.push("classify"), 0));
    vi.mocked(runAutopilot).mockImplementation(async () => (order.push("autopilot"), { drafted: 1, published: 1 }));

    const r = await tickNewsrooms(clock);

    expect(order).toEqual(["ingest", "classify", "autopilot"]);
    expect(ingest).toHaveBeenCalledWith("a", { graceMs: TICK_GRACE_MS });
    expect(r).toMatchObject({ desks: 1, served: 1, secondPass: 0, added: 2, drafted: 1, published: 1, errors: 0, timedOut: 0 });
  });

  it("skips a desk that is not due yet, and a frozen one", async () => {
    desks([
      { id: "fresh", plan: "LITE", lastFetchedAt: ago(10) },
      { id: "due", plan: "LITE", lastFetchedAt: ago(400) },
      { id: "frozen", plan: "LITE", planPaidUntil: new Date(NOW - 1000) },
    ]);
    const r = await tickNewsrooms(clock);
    expect(vi.mocked(ingest).mock.calls.map((c) => c[0])).toEqual(["due"]);
    expect(r).toMatchObject({ desks: 2, served: 1 });
  });

  it("serves a 30-second desk a second time at the 30 s mark, and only that desk", async () => {
    desks([
      { id: "fast", plan: "ENTERPRISE" },
      { id: "slow", plan: "MANUAL" },
    ]);
    const startedAt: Record<string, number[]> = {};
    vi.mocked(ingest).mockImplementation(async (id) => {
      (startedAt[id] ??= []).push(t - NOW);
      takes(2_000)();
      return { added: 1, failed: [], skipped: false };
    });

    const r = await tickNewsrooms(clock);

    const calls = vi.mocked(ingest).mock.calls.map((c) => c[0]);
    expect(calls.filter((id) => id === "fast")).toHaveLength(2);
    expect(calls.filter((id) => id === "slow")).toHaveLength(1);
    expect(slept).toHaveLength(1);
    // The second pass starts exactly at the 30 s mark.
    expect(startedAt.fast[1]).toBe(30_000);
    expect(r.secondPass).toBe(1);
    expect(r.served).toBe(2);
    expect(r.ms).toBeLessThanOrEqual(50_000);
  });

  it("makes no second pass when the first one already took 25 s", async () => {
    desks([{ id: "fast", plan: "ENTERPRISE" }]);
    vi.mocked(ingest).mockImplementation(async () => (takes(26_000)(), { added: 0, failed: [], skipped: false }));
    const r = await tickNewsrooms(clock);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
    expect(r.secondPass).toBe(0);
  });

  it("makes no second pass without a 30-second desk", async () => {
    desks([{ id: "a", plan: "AUTO" }]);
    await tickNewsrooms(clock);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("carries on with the next step after one fails, and counts it", async () => {
    desks([{ id: "a", plan: "MANUAL" }]);
    vi.mocked(ingest).mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await tickNewsrooms(clock);
    spy.mockRestore();
    expect(classifyPending).toHaveBeenCalledTimes(1);
    expect(runAutopilot).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ served: 1, errors: 1, drafted: 1 });
  });

  it("one bad desk never stops the others", async () => {
    desks([
      { id: "bad", plan: "MANUAL", lastFetchedAt: ago(900) },
      { id: "good", plan: "MANUAL", lastFetchedAt: ago(500) },
    ]);
    vi.mocked(runAutopilot).mockImplementation(async (id) => {
      if (id === "bad") throw new Error("boom");
      return { drafted: 3, published: 2 };
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await tickNewsrooms(clock);
    spy.mockRestore();
    expect(r).toMatchObject({ served: 2, errors: 1, drafted: 3, published: 2 });
  });

  it("stops starting desks once 50 s have passed", async () => {
    desks([
      { id: "a", plan: "MANUAL", lastFetchedAt: ago(900) },
      { id: "b", plan: "MANUAL", lastFetchedAt: ago(800) },
      { id: "c", plan: "MANUAL", lastFetchedAt: ago(700) },
      { id: "d", plan: "MANUAL", lastFetchedAt: ago(600) },
    ]);
    // Three run at once and each eats 51 s of the fake clock; the fourth finds no time left.
    vi.mocked(ingest).mockImplementation(async () => (takes(51_000)(), { added: 0, failed: [], skipped: false }));
    const r = await tickNewsrooms(clock);
    expect(r.timedOut).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(ingest).mock.calls.map((c) => c[0])).not.toContain("d");
  });
});
