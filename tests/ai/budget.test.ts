import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, number>());
const plans = vi.hoisted(() => ({ current: ["MERCHANT"] as string[] }));

vi.mock("@/lib/db", () => ({
  db: {
    usage: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; month: string; metric: { in: string[] } } }) =>
        where.metric.in.filter((m) => rows.has(`${where.tenantId}|${where.month}|${m}`)).map((metric) => ({ metric, count: rows.get(`${where.tenantId}|${where.month}|${metric}`)! })),
      ),
      upsert: vi.fn(async ({ where, create, update }: { where: { tenantId_month_metric: { tenantId: string; month: string; metric: string } }; create: { count: number }; update: { count: { increment: number } } }) => {
        const k = `${where.tenantId_month_metric.tenantId}|${where.tenantId_month_metric.month}|${where.tenantId_month_metric.metric}`;
        rows.set(k, rows.has(k) ? rows.get(k)! + update.count.increment : create.count);
      }),
    },
    store: { findMany: vi.fn(async () => plans.current.map((plan) => ({ plan }))) },
  },
}));

import { aiFor, aiForTenant } from "@/lib/ai/for-store";
import { allowanceOf, chooseTier, OPTIONAL_SHARE, recordSpend } from "@/lib/ai/meter";
import { DEFAULT_MODEL, estimateTokens, microUsd, modelFor, tierOfModel } from "@/lib/ai/models";
import { monthKey } from "@/lib/billing/limits";
import { SHOP_LIMITS } from "@/lib/shop/plans";

const month = monthKey();
const key = (scope: string, metric: string) => `${scope}|${month}|${metric}`;
const as = (...p: string[]) => {
  plans.current = p;
};

beforeEach(() => {
  rows.clear();
  as("MERCHANT");
  vi.unstubAllEnvs();
});

describe("what a call costs", () => {
  it("counts tokens at the assumed list prices, in micro-dollars", () => {
    expect(microUsd("haiku", 1000, 100)).toBe(1000 * 1 + 100 * 5);
    expect(microUsd("opus", 1000, 100)).toBe(1000 * 5 + 100 * 25);
  });

  it("never costs nothing, and never goes negative", () => {
    expect(microUsd("haiku", 0, 0)).toBe(1);
    expect(microUsd("haiku", -5, -5)).toBe(1);
  });

  it("scales every price with AI_PRICE_SCALE once the real rate is known", () => {
    vi.stubEnv("AI_PRICE_SCALE", "0.6");
    expect(microUsd("haiku", 1000, 100)).toBe(900);
    // Below 0.6 is not believed until the invoices agree with the count: it is floored.
    vi.stubEnv("AI_PRICE_SCALE", "0.1");
    expect(microUsd("haiku", 1000, 100)).toBe(900);
    vi.stubEnv("AI_PRICE_SCALE", "2");
    expect(microUsd("haiku", 1000, 100)).toBe(3000);
    vi.stubEnv("AI_PRICE_SCALE", "nonsense");
    expect(microUsd("haiku", 1000, 100)).toBe(1500);
  });

  it("estimates tokens high for a script that costs many tokens per letter", () => {
    expect(estimateTokens("س".repeat(230))).toBeGreaterThanOrEqual(100);
    expect(estimateTokens("س".repeat(230))).toBeLessThanOrEqual(101);
    expect(estimateTokens("abc")).toBeGreaterThanOrEqual(1);
  });
});

describe("the two models", () => {
  it("are Haiku and Opus of kurd.gg's cc/ line, and the environment may rename them", () => {
    expect(modelFor("haiku")).toBe(DEFAULT_MODEL.haiku);
    expect(modelFor("opus")).toBe("cc/claude-opus-5-5");
    vi.stubEnv("KURDGG_MODEL_OPUS", "cc/claude-opus-5");
    expect(modelFor("opus")).toBe("cc/claude-opus-5");
  });

  it("tells a model's tier from its name", () => {
    expect(tierOfModel("cc/claude-opus-5-5")).toBe("opus");
    expect(tierOfModel("cc/claude-haiku-5-5")).toBe("haiku");
    expect(tierOfModel("something-else")).toBe("haiku");
  });
});

describe("the monthly allowance of a workspace", () => {
  it("lets a workspace with the Opus plan use Opus until its Opus part is gone, then Haiku, then nothing", async () => {
    as("MAX");
    const m = { scope: "t1" };
    expect(await chooseTier(m, "opus", { essential: true })).toBe("opus");
    rows.set(key("t1", "ai_micro"), SHOP_LIMITS.MAX.aiOpusUsd * 1e6);
    rows.set(key("t1", "ai_micro_opus"), SHOP_LIMITS.MAX.aiOpusUsd * 1e6);
    expect(await chooseTier(m, "opus", { essential: true })).toBe("haiku");
    rows.set(key("t1", "ai_micro"), SHOP_LIMITS.MAX.aiUsd * 1e6);
    expect(await chooseTier(m, "opus", { essential: true })).toBeNull();
    expect(await chooseTier(m, "haiku", { essential: true })).toBeNull();
  });

  it("never gives Opus to a workspace without the Opus plan", async () => {
    for (const p of ["FREE", "MERCHANT", "PRO"]) {
      as(p);
      expect(await chooseTier({ scope: "t2" }, "opus")).toBe("haiku");
    }
  });

  it("stops the optional features at a share of the allowance and keeps the rest for what must go on", async () => {
    as("MERCHANT");
    const cap = SHOP_LIMITS.MERCHANT.aiUsd * 1e6;
    rows.set(key("t3", "ai_micro"), Math.floor(cap * OPTIONAL_SHARE) - 1);
    expect(await chooseTier({ scope: "t3" }, "haiku")).toBe("haiku");
    rows.set(key("t3", "ai_micro"), Math.ceil(cap * OPTIONAL_SHARE));
    expect(await chooseTier({ scope: "t3" }, "haiku")).toBeNull();
    // Labelling a buyer's message still goes on until the whole allowance is used.
    expect(await chooseTier({ scope: "t3" }, "haiku", { essential: true })).toBe("haiku");
    rows.set(key("t3", "ai_micro"), cap);
    expect(await chooseTier({ scope: "t3" }, "haiku", { essential: true })).toBeNull();
  });

  it("is the workspace's, not each store's: paid stores add up and free stores count once", async () => {
    as("PRO", "PRO", "FREE", "FREE", "FREE");
    const a = await allowanceOf({ scope: "t4" });
    expect(a.totalUsd).toBe(SHOP_LIMITS.PRO.aiUsd * 2);
    as("FREE", "FREE", "FREE", "FREE");
    expect((await allowanceOf({ scope: "t4" })).totalUsd).toBe(0.08);
    as();
    expect((await allowanceOf({ scope: "t4" })).totalUsd).toBe(0);
  });

  it("adds a call's cost to the total, and to the Opus part only for an Opus call", async () => {
    const m = { scope: "t5" };
    expect(await recordSpend(m, "haiku", 2000, 200)).toBe(3000);
    expect(rows.get(key("t5", "ai_micro"))).toBe(3000);
    expect(rows.has(key("t5", "ai_micro_opus"))).toBe(false);
    await recordSpend(m, "opus", 1000, 100);
    expect(rows.get(key("t5", "ai_micro"))).toBe(3000 + 7500);
    expect(rows.get(key("t5", "ai_micro_opus"))).toBe(7500);
  });

  it("reports how much is used, in dollars and per cent", async () => {
    rows.set(key("t6", "ai_micro"), SHOP_LIMITS.MERCHANT.aiUsd * 0.5e6);
    const a = await allowanceOf({ scope: "t6" });
    expect(a).toMatchObject({ totalUsd: SHOP_LIMITS.MERCHANT.aiUsd, percent: 50 });
    rows.set(key("t6", "ai_micro"), 5_000_000);
    expect((await allowanceOf({ scope: "t6" })).percent).toBe(100);
  });
});

describe("whose allowance a call is counted against", () => {
  it("is the workspace's, with Opus asked for and the meter deciding whether it is given", async () => {
    expect(aiFor({ tenantId: "t1" }, { opus: true })).toEqual({ tier: "opus", meter: { scope: "t1" } });
    expect(aiFor({ tenantId: "t1" }).tier).toBe("haiku");
    expect(await aiForTenant("t2", { opus: true })).toEqual({ tier: "opus", meter: { scope: "t2" } });
  });
});
