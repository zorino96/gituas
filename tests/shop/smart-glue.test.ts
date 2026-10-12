import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    brandKit: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    conversationMessage: { findMany: vi.fn() },
    outboxJob: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/shop/quota", () => ({ smartUsed: vi.fn(), countSmart: vi.fn() }));
vi.mock("@/lib/shop/smart", async (orig) => ({ ...(await orig<typeof import("@/lib/shop/smart")>()), smartReply: vi.fn() }));

import { db } from "@/lib/db";
import { countSmart, smartUsed } from "@/lib/shop/quota";
import { smartReply } from "@/lib/shop/smart";
import { deliveryFacts, productFacts, smartTry, type SmartContext, type SmartStore } from "@/lib/shop/smart-glue";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const store = (over: Partial<SmartStore> = {}): SmartStore => ({
  id: "s1",
  tenantId: "t1",
  name: "Botolio",
  plan: "MERCHANT",
  aiReplies: true,
  aiBrief: "Be warm.",
  deliveryFeeMinor: 500000,
  deliveryCurrency: "IQD",
  deliveryTime: "2 days",
  deliveryCityFees: null,
  ...over,
});

const bag = { id: "p1", name: "Black bag", photos: [], variants: [{ label: "M", amountMinor: 2500000, currency: "IQD", inStock: true }] };
const ctx = (over: Partial<SmartContext> = {}): SmartContext => ({
  store: store(),
  kind: "dm_followup",
  lang: "en",
  message: "How much?",
  product: bag,
  waLink: null,
  senderId: "u1",
  ...over,
});

describe("productFacts", () => {
  it("shows a one-price product as its price and a sized one per size, sold-out marked", () => {
    expect(productFacts({ name: "Wallet", photos: [], variants: [{ label: "", amountMinor: 1200000, currency: "IQD", inStock: true }] }, "en").lines).toHaveLength(1);
    const f = productFacts({ name: "Bag", photos: [], variants: [{ label: "M", amountMinor: 2500000, currency: "IQD", inStock: true }, { label: "L", amountMinor: 2700000, currency: "IQD", inStock: false }] }, "en");
    expect(f.lines[0]).toMatch(/^M: /);
    expect(f.lines[1]).toBe("L: Sold out");
  });
});

describe("deliveryFacts", () => {
  it("is empty when the shop set no delivery terms", () => {
    expect(deliveryFacts({ deliveryFeeMinor: null, deliveryCurrency: "IQD", deliveryTime: null }, "en")).toEqual([]);
  });

  it("gives the general line first", () => {
    const lines = deliveryFacts({ deliveryFeeMinor: 500000, deliveryCurrency: "IQD", deliveryTime: "2 days" }, "en");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2 days");
  });
});

describe("smartTry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const t of Object.values(m)) for (const f of Object.values(t)) f.mockReset();
    m.brandKit.findUnique.mockResolvedValue({ tagline: "Women's bags", deliveryNote: null });
    m.product.findMany.mockResolvedValue([]);
    m.conversationMessage.findMany.mockResolvedValue([{ content: "Hello", createdAt: new Date(1_000) }]);
    m.outboxJob.findMany.mockResolvedValue([{ payload: { message: { text: "Welcome!" } }, updatedAt: new Date(2_000) }]);
    vi.mocked(smartUsed).mockResolvedValue(0);
    vi.mocked(smartReply).mockResolvedValue({ text: "It is 25,000 IQD", needsOwner: false, unclear: false, model: "kurdgg/test" });
  });

  it("does nothing, and asks nothing, while smart replies are off", async () => {
    expect(await smartTry(ctx({ store: store({ aiReplies: false }) }))).toBeNull();
    expect(smartReply).not.toHaveBeenCalled();
    expect(smartUsed).not.toHaveBeenCalled();
  });

  it("stops at the plan's monthly allowance", async () => {
    vi.mocked(smartUsed).mockResolvedValue(1500);
    expect(await smartTry(ctx())).toBeNull();
    expect(smartReply).not.toHaveBeenCalled();
  });

  it("answers with the shop's facts, the owner's instructions and the earlier turns, and counts it", async () => {
    const out = await smartTry(ctx());
    expect(out?.text).toBe("It is 25,000 IQD");
    expect(countSmart).toHaveBeenCalledWith("s1");
    const input = vi.mocked(smartReply).mock.calls[0][0];
    expect(input.brief).toBe("Be warm.");
    expect(input.facts.shop).toBe("Botolio");
    expect(input.facts.tagline).toBe("Women's bags");
    expect(input.facts.asked?.name).toBe("Black bag");
    expect(input.history).toEqual([{ from: "buyer", text: "Hello" }, { from: "shop", text: "Welcome!" }]);
  });

  it("does not read the chat for a first message", async () => {
    await smartTry(ctx({ kind: "dm_first", senderId: null }));
    expect(m.conversationMessage.findMany).not.toHaveBeenCalled();
    expect(vi.mocked(smartReply).mock.calls[0][0].history).toEqual([]);
  });

  it("counts nothing when the writing fails the guard", async () => {
    vi.mocked(smartReply).mockResolvedValue(null);
    expect(await smartTry(ctx())).toBeNull();
    expect(countSmart).not.toHaveBeenCalled();
  });

  it("is null, not an error, when the database fails", async () => {
    m.brandKit.findUnique.mockRejectedValue(new Error("db down"));
    expect(await smartTry(ctx())).toBeNull();
  });
});
