import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  studioWallet: { updateMany: vi.fn(), upsert: vi.fn() },
  studioLedger: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    studioWallet: { findUnique: vi.fn() },
  },
}));

import { chargeWallet, refundWallet, topUpWallet } from "@/lib/studio/wallet";

describe("studio wallet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("charges only when the balance covers the price, and records it", async () => {
    tx.studioWallet.updateMany.mockResolvedValue({ count: 1 });
    expect(await chargeWallet("t1", 500, "a1")).toBe(true);
    expect(tx.studioWallet.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", balanceIqd: { gte: 500 } }, data: { balanceIqd: { decrement: 500 } } });
    expect(tx.studioLedger.create).toHaveBeenCalledWith({ data: { tenantId: "t1", deltaIqd: -500, reason: "IMAGE", assetId: "a1" } });
  });

  it("refuses when the balance is short, and writes nothing", async () => {
    tx.studioWallet.updateMany.mockResolvedValue({ count: 0 });
    expect(await chargeWallet("t1", 500, "a1")).toBe(false);
    expect(tx.studioLedger.create).not.toHaveBeenCalled();
  });

  it("never charges zero, negative or fractional amounts", async () => {
    for (const n of [0, -500, 12.5]) expect(await chargeWallet("t1", n, "a1")).toBe(false);
    expect(tx.studioWallet.updateMany).not.toHaveBeenCalled();
  });

  it("refunds and tops up with a ledger row each", async () => {
    await refundWallet("t1", 500, "a1");
    expect(tx.studioLedger.create).toHaveBeenCalledWith({ data: { tenantId: "t1", deltaIqd: 500, reason: "REFUND", assetId: "a1" } });
    await topUpWallet(tx as never, "t1", 10000, "inv1");
    expect(tx.studioWallet.upsert).toHaveBeenLastCalledWith({ where: { tenantId: "t1" }, create: { tenantId: "t1", balanceIqd: 10000 }, update: { balanceIqd: { increment: 10000 } } });
    expect(tx.studioLedger.create).toHaveBeenLastCalledWith({ data: { tenantId: "t1", deltaIqd: 10000, reason: "TOPUP", invoiceId: "inv1" } });
  });
});
