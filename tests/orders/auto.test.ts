import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { order: { upsert: vi.fn(), findFirst: vi.fn() } };
vi.mock("@/lib/db", () => ({ db }));

const { autoOrderData, buyerKeyOf, duplicateOrderWhere, openOrder, DUPLICATE_WINDOW_MS } = await import("@/lib/orders/auto");

const msg = { id: "m1", authorId: "u1", externalThreadId: "post9", authorHandle: "ari.shop", channelType: "COMMENT", store: { id: "s1", tenantId: "t1" } };
const product = {
  id: "p1",
  name: "عەبا",
  variants: [
    { label: "S", amountMinor: 30_000, currency: "IQD", inStock: false },
    { label: "M", amountMinor: 25_000, currency: "IQD", inStock: true },
    { label: "L", amountMinor: 27_000, currency: "IQD", inStock: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.order.upsert.mockResolvedValue({});
  db.order.findFirst.mockResolvedValue(null);
});

describe("autoOrderData", () => {
  it("prices the order at the first in-stock variant", () => {
    expect(autoOrderData(msg, product)).toEqual({
      tenantId: "t1",
      storeId: "s1",
      city: null,
      deliveryFeeMinor: null,
      customerName: "ari.shop",
      productId: "p1",
      productName: "عەبا",
      variantLabel: "M",
      amountMinor: 25_000,
      currency: "IQD",
      source: "COMMENT",
      sourceMessageId: "m1",
      buyerKey: "u1",
      status: "NEW",
    });
  });

  it("keeps the buyer's city and its delivery fee", () => {
    expect(autoOrderData(msg, product, { city: "erbil", deliveryFeeMinor: 3000 })).toMatchObject({ city: "erbil", deliveryFeeMinor: 3000 });
  });

  it("marks a DM as coming from a DM and keeps the variant's own currency", () => {
    const d = autoOrderData({ ...msg, channelType: "DM" }, { ...product, variants: [{ label: "", amountMinor: 1_999, currency: "USD", inStock: true }] });
    expect(d).toMatchObject({ source: "DM", amountMinor: 1_999, currency: "USD", variantLabel: "" });
  });

  it("leaves the amount at 0 with no product, or nothing in stock", () => {
    expect(autoOrderData(msg, null)).toMatchObject({ productId: null, productName: "", amountMinor: 0, currency: "IQD" });
    expect(autoOrderData(msg, { ...product, variants: [{ label: "S", amountMinor: 30_000, currency: "IQD", inStock: false }] })).toMatchObject({ productId: "p1", amountMinor: 0 });
  });

  it("uses an empty customer name when the author has no handle", () => {
    expect(autoOrderData({ ...msg, authorHandle: null }, null).customerName).toBe("");
  });
});

describe("buyerKeyOf", () => {
  it("is the author id", () => {
    expect(buyerKeyOf(msg)).toBe("u1");
    expect(buyerKeyOf({ ...msg, channelType: "DM" })).toBe("u1");
  });

  it("falls back to the thread id for a DM only, because a comment's thread is the post, not the buyer", () => {
    expect(buyerKeyOf({ ...msg, authorId: null, channelType: "DM" })).toBe("post9");
    expect(buyerKeyOf({ ...msg, authorId: null })).toBeNull();
  });

  it("is null when nothing identifies the buyer, never an empty string", () => {
    expect(buyerKeyOf({ ...msg, authorId: "", externalThreadId: "", channelType: "DM" })).toBeNull();
    const { authorId: _a, externalThreadId: _t, ...bare } = msg;
    expect(buyerKeyOf(bare)).toBeNull();
  });
});

describe("duplicateOrderWhere", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("matches the same buyer, the same product, open orders, from the last day", () => {
    const w = duplicateOrderWhere({ tenantId: "t1", buyerKey: "u1", productId: "p1" }, now);
    expect(w).toEqual({
      tenantId: "t1",
      buyerKey: "u1",
      productId: "p1",
      status: { in: ["NEW", "CONFIRMED"] },
      createdAt: { gt: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
    });
    expect(DUPLICATE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("matches orders with no product by IS NULL, never by 'any product'", () => {
    expect(duplicateOrderWhere({ tenantId: "t1", buyerKey: "u1", productId: null }, now).productId).toBeNull();
    expect(duplicateOrderWhere({ tenantId: "t1", buyerKey: "u1", productId: undefined }, now).productId).toBeNull();
  });
});

describe("openOrder", () => {
  it("upserts by the message id and never touches an existing order", async () => {
    await openOrder(msg, product);
    expect(db.order.upsert).toHaveBeenCalledTimes(1);
    const arg = db.order.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ sourceMessageId: "m1" });
    expect(arg.update).toEqual({});
    expect(arg.create).toMatchObject({ tenantId: "t1", storeId: "s1", sourceMessageId: "m1" });
  });

  it("opens no second order for the same buyer and product within a day", async () => {
    db.order.findFirst.mockResolvedValue({ id: "o1" });
    await openOrder({ ...msg, id: "m2" }, product);
    expect(db.order.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", buyerKey: "u1", productId: "p1", status: { in: ["NEW", "CONFIRMED"] } });
    expect(db.order.upsert).not.toHaveBeenCalled();
  });

  it("does not look for a duplicate when the buyer is unknown", async () => {
    await openOrder({ ...msg, authorId: null }, product);
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(db.order.upsert).toHaveBeenCalledTimes(1);
  });

  it("swallows a database failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.order.upsert.mockRejectedValue(new Error("db down"));
    await expect(openOrder(msg, product)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
