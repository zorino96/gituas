import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the three tables the offer touches.
const mem = vi.hoisted(() => ({
  usage: new Map<string, number>(),
  tenants: new Map<string, { kind: string; createdAt: Date; owners: Date[] }>(),
  stores: new Map<string, { tenantId: string; plan: string; planPaidUntil: Date | null }>(),
}));
const k = (w: { tenantId: string; month: string; metric: string }) => `${w.tenantId}|${w.month}|${w.metric}`;
const unique = () => Object.assign(new Error("unique"), { code: "P2002" });

vi.mock("@/lib/db", () => ({
  db: {
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const t = mem.tenants.get(where.id);
        return t ? { kind: t.kind, createdAt: t.createdAt, memberships: t.owners.map((c) => ({ user: { createdAt: c } })) } : null;
      }),
    },
    store: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => mem.stores.get(where.id) ?? null),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { plan: string; planPaidUntil: Date } }) => {
        mem.stores.set(where.id, { ...mem.stores.get(where.id)!, ...data });
        return {};
      }),
    },
    usage: {
      create: vi.fn(async ({ data }: { data: { tenantId: string; month: string; metric: string; count: number } }) => {
        if (mem.usage.has(k(data))) throw unique();
        mem.usage.set(k(data), data.count);
        return data;
      }),
      upsert: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        const key = k(where.tenantId_month_metric);
        mem.usage.set(key, (mem.usage.get(key) ?? 0) + 1);
        return { count: mem.usage.get(key)! };
      }),
      update: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        const key = k(where.tenantId_month_metric);
        mem.usage.set(key, (mem.usage.get(key) ?? 0) - 1);
        return {};
      }),
      delete: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        mem.usage.delete(k(where.tenantId_month_metric));
        return {};
      }),
      findUnique: vi.fn(async ({ where }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } } }) => {
        const v = mem.usage.get(k(where.tenantId_month_metric));
        return v === undefined ? null : { count: v };
      }),
    },
  },
}));

import { claimLaunchPromo, LAUNCH_PROMO, promoPlacesLeft } from "@/lib/billing/promo";

const after = (min: number) => new Date(LAUNCH_PROMO.startsAt.getTime() + min * 60_000);
const now = after(60);
function shop(id: string, opts: { created?: Date; owner?: Date; kind?: string; plan?: string; paidUntil?: Date | null } = {}) {
  mem.tenants.set(id, { kind: opts.kind ?? "MERCHANT", createdAt: opts.created ?? after(10), owners: [opts.owner ?? after(9)] });
  mem.stores.set(`s-${id}`, { tenantId: id, plan: opts.plan ?? "FREE", planPaidUntil: opts.paidUntil ?? null });
}

beforeEach(() => {
  mem.usage.clear();
  mem.tenants.clear();
  mem.stores.clear();
});

describe("the launch offer", () => {
  it("gives the first three new shops Pro for seven days, and nobody after them", async () => {
    for (const id of ["a", "b", "c", "d"]) shop(id);
    expect(await claimLaunchPromo("a", "s-a", now)).toBe(true);
    expect(await claimLaunchPromo("b", "s-b", now)).toBe(true);
    expect(await claimLaunchPromo("c", "s-c", now)).toBe(true);
    expect(await claimLaunchPromo("d", "s-d", now)).toBe(false);
    expect(mem.stores.get("s-a")).toMatchObject({ plan: "PRO" });
    expect(mem.stores.get("s-a")!.planPaidUntil!.getTime() - now.getTime()).toBe(7 * 86_400_000);
    expect(mem.stores.get("s-d")).toMatchObject({ plan: "FREE" });
    expect(await promoPlacesLeft()).toBe(0);
  });

  it("gives a shop its place once", async () => {
    shop("a");
    expect(await claimLaunchPromo("a", "s-a", now)).toBe(true);
    mem.stores.set("s-a2", { tenantId: "a", plan: "FREE", planPaidUntil: null });
    expect(await claimLaunchPromo("a", "s-a2", now)).toBe(false);
    expect(await promoPlacesLeft()).toBe(2);
  });

  it("is not for existing users, older workspaces, news desks, paying shops, someone else's shop or before it starts", async () => {
    shop("old", { created: after(-60) });
    shop("olduser", { owner: after(-60 * 24 * 30) });
    shop("desk", { kind: "NEWS" });
    shop("paid", { plan: "MERCHANT", paidUntil: after(60 * 24 * 20) });
    shop("x");
    expect(await claimLaunchPromo("old", "s-old", now)).toBe(false);
    expect(await claimLaunchPromo("olduser", "s-olduser", now)).toBe(false);
    expect(await claimLaunchPromo("desk", "s-desk", now)).toBe(false);
    expect(await claimLaunchPromo("paid", "s-paid", now)).toBe(false);
    expect(await claimLaunchPromo("x", "s-old", now)).toBe(false);
    expect(await claimLaunchPromo("x", "s-x", after(-5))).toBe(false);
    expect(await promoPlacesLeft()).toBe(3);
  });

  it("gives the place back when it was the fourth", async () => {
    for (const id of ["a", "b", "c", "d"]) shop(id);
    for (const id of ["a", "b", "c"]) await claimLaunchPromo(id, `s-${id}`, now);
    await claimLaunchPromo("d", "s-d", now);
    // the counter stays at three and the fourth shop carries no mark, so a later change of rules could still reach it
    expect(mem.usage.get(`promo:${LAUNCH_PROMO.code}|all|claims`)).toBe(3);
    expect(mem.usage.has(`d|promo|${LAUNCH_PROMO.code}`)).toBe(false);
  });
});
