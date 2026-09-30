import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = { id: "t1", role: "OWNER" as "OWNER" | "MEMBER" };
const db = {
  product: { findFirst: vi.fn() },
  order: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/app/data", () => ({ currentWorkspace: async () => ws }));

const { saveOrderAction, setOrderStatusAction } = await import("@/app/app/orders/actions");

const input = {
  customerName: "ئاری",
  phone: "0750 123 4567",
  city: "erbil",
  address: "",
  productId: "",
  variantLabel: "",
  price: "25,000",
  currency: "IQD",
  deliveryFee: "",
  cod: true,
  status: "NEW",
  note: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  ws.role = "OWNER";
  db.order.create.mockResolvedValue({ id: "o1" });
  db.order.findFirst.mockResolvedValue({ id: "o1" });
  db.order.updateMany.mockResolvedValue({ count: 1 });
});

describe("saveOrderAction", () => {
  it("creates a manual order for the session's workspace with a normalised phone and parsed price", async () => {
    expect(await saveOrderAction(null, input)).toEqual({ ok: true, id: "o1" });
    expect(db.order.create).toHaveBeenCalledTimes(1);
    const data = db.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", storeId: null, source: "MANUAL", phone: "9647501234567", city: "erbil", amountMinor: 25_000, currency: "IQD", deliveryFeeMinor: null, status: "NEW" });
  });

  it("refuses roles that may not engage", async () => {
    ws.role = "MEMBER";
    expect((await saveOrderAction(null, input)).ok).toBe(false);
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown city, a bad phone, a bad price and a bad status", async () => {
    expect((await saveOrderAction(null, { ...input, city: "atlantis" })).ok).toBe(false);
    expect((await saveOrderAction(null, { ...input, phone: "abc" })).ok).toBe(false);
    expect((await saveOrderAction(null, { ...input, price: "12x" })).ok).toBe(false);
    expect((await saveOrderAction(null, { ...input, status: "DONE" })).ok).toBe(false);
    expect((await saveOrderAction(null, { ...input, customerName: "  " })).ok).toBe(false);
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("looks a product up inside the workspace's own stores and refuses someone else's", async () => {
    db.product.findFirst.mockResolvedValue(null);
    const r = await saveOrderAction(null, { ...input, productId: "p-other" });
    expect(r.ok).toBe(false);
    expect(db.product.findFirst.mock.calls[0][0].where).toEqual({ id: "p-other", store: { tenantId: "t1" } });
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("fills the product name and store from the product", async () => {
    db.product.findFirst.mockResolvedValue({ id: "p1", name: "عەبا", storeId: "s1" });
    await saveOrderAction(null, { ...input, productId: "p1" });
    expect(db.order.create.mock.calls[0][0].data).toMatchObject({ productId: "p1", productName: "عەبا", storeId: "s1", tenantId: "t1" });
  });

  it("edits only an order of this workspace", async () => {
    db.order.findFirst.mockResolvedValue(null);
    expect((await saveOrderAction("o9", input)).ok).toBe(false);
    expect(db.order.findFirst.mock.calls[0][0].where).toEqual({ id: "o9", tenantId: "t1" });
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("never rewrites where an order came from when editing", async () => {
    await saveOrderAction("o1", input);
    const data = db.order.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("source");
    expect(data).not.toHaveProperty("tenantId");
  });
});

describe("setOrderStatusAction", () => {
  it("scopes the update to the workspace", async () => {
    expect(await setOrderStatusAction("o1", "SENT")).toEqual({ ok: true, id: "o1" });
    expect(db.order.updateMany).toHaveBeenCalledWith({ where: { id: "o1", tenantId: "t1" }, data: { status: "SENT" } });
  });

  it("refuses an unknown status, a foreign order and a role that may not engage", async () => {
    expect((await setOrderStatusAction("o1", "DONE")).ok).toBe(false);
    db.order.updateMany.mockResolvedValue({ count: 0 });
    expect((await setOrderStatusAction("o1", "SENT")).ok).toBe(false);
    ws.role = "MEMBER";
    db.order.updateMany.mockClear();
    expect((await setOrderStatusAction("o1", "SENT")).ok).toBe(false);
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
});
