import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { order: { upsert: vi.fn() } };
vi.mock("@/lib/db", () => ({ db }));

const { autoOrderData, openOrder } = await import("@/lib/orders/auto");

const msg = { id: "m1", authorHandle: "ari.shop", channelType: "COMMENT", store: { id: "s1", tenantId: "t1" } };
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
});

describe("autoOrderData", () => {
  it("prices the order at the first in-stock variant", () => {
    expect(autoOrderData(msg, product)).toEqual({
      tenantId: "t1",
      storeId: "s1",
      customerName: "ari.shop",
      productId: "p1",
      productName: "عەبا",
      variantLabel: "M",
      amountMinor: 25_000,
      currency: "IQD",
      source: "COMMENT",
      sourceMessageId: "m1",
      status: "NEW",
    });
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

describe("openOrder", () => {
  it("upserts by the message id and never touches an existing order", async () => {
    await openOrder(msg, product);
    expect(db.order.upsert).toHaveBeenCalledTimes(1);
    const arg = db.order.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ sourceMessageId: "m1" });
    expect(arg.update).toEqual({});
    expect(arg.create).toMatchObject({ tenantId: "t1", storeId: "s1", sourceMessageId: "m1" });
  });

  it("swallows a database failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.order.upsert.mockRejectedValue(new Error("db down"));
    await expect(openOrder(msg, product)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
