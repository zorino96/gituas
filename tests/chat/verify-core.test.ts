import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { VerifyFn, ToolCtx } from "@/lib/chat/types";

const ctx = { tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th", attachments: [], review: false, deadline: Date.now() + 50_000 } as unknown as ToolCtx;
const done = { text: "Done", runId: "r1" };

async function load(fns: Record<string, VerifyFn>) {
  vi.resetModules();
  vi.doMock("@/lib/chat/verify/shop", () => ({ SHOP_VERIFIERS: fns }));
  vi.doMock("@/lib/chat/verify/rules", () => ({ RULE_VERIFIERS: {} }));
  vi.doMock("@/lib/chat/verify/accounts", () => ({ ACCOUNT_VERIFIERS: {} }));
  vi.doMock("@/lib/chat/verify/reset", () => ({ RESET_VERIFIERS: {} }));
  vi.doMock("@/lib/chat/verify/news", () => ({ NEWS_VERIFIERS: {} }));
  return await import("@/lib/chat/verify");
}

describe("parseVerify", () => {
  it("makes the status follow the problems, trims long lines and drops the rest", async () => {
    const { parseVerify } = await import("@/lib/chat/verify/report");
    const r = parseVerify({ status: "ok", checked: ["a", "  ", 5, "b".repeat(300)], problems: ["wrong price"], fix: "update_product" });
    expect(r?.status).toBe("problem");
    expect(r?.checked).toHaveLength(2);
    expect(Array.from(r!.checked[1]).length).toBeLessThanOrEqual(160);
    expect(r?.fix).toBe("update_product");
  });
  it("keeps a fix only with a problem and returns nothing for an empty report", async () => {
    const { parseVerify } = await import("@/lib/chat/verify/report");
    expect(parseVerify({ status: "ok", checked: ["x"], problems: [], fix: "nope" })).toEqual({ status: "ok", checked: ["x"], problems: [] });
    expect(parseVerify({ status: "ok", checked: [], problems: [] })).toBeUndefined();
    expect(parseVerify(null)).toBeUndefined();
    expect(parseVerify([1])).toBeUndefined();
    expect(parseVerify("ok")).toBeUndefined();
  });
});

describe("verifyChange", () => {
  beforeEach(() => {
    delete process.env.CHAT_VERIFY;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CHAT_VERIFY;
  });

  it("runs the tool's check and cleans its report", async () => {
    const { verifyChange } = await load({ add_product: async () => ({ status: "ok", checked: ["Saved at 25,000 IQD"], problems: [] }) });
    const r = await verifyChange({ name: "add_product" }, ctx, {}, done, 30_000);
    expect(r).toEqual({ status: "ok", checked: ["Saved at 25,000 IQD"], problems: [] });
  });

  it("has nothing to say for a tool without a check", async () => {
    const { verifyChange } = await load({});
    expect(await verifyChange({ name: "make_picture" }, ctx, {}, done, 30_000)).toBeUndefined();
  });

  it("says nothing when the check throws or answers null", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { verifyChange } = await load({
      boom: async () => {
        throw new Error("db down");
      },
      empty: async () => null,
    });
    expect(await verifyChange({ name: "boom" }, ctx, {}, done, 30_000)).toBeUndefined();
    expect(await verifyChange({ name: "empty" }, ctx, {}, done, 30_000)).toBeUndefined();
    err.mockRestore();
  });

  it("is skipped when the request has too little time left, and by the kill switch", async () => {
    const check = vi.fn(async () => ({ status: "ok" as const, checked: ["x"], problems: [] }));
    const { verifyChange } = await load({ t: check });
    expect(await verifyChange({ name: "t" }, ctx, {}, done, 2_000)).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
    process.env.CHAT_VERIFY = "0";
    expect(await verifyChange({ name: "t" }, ctx, {}, done, 30_000)).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("gives up on a check that is too slow instead of holding the answer", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { verifyChange } = await load({ slow: () => new Promise(() => undefined) });
    const p = verifyChange({ name: "slow" }, ctx, {}, done, 30_000);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await p).toBeUndefined();
    err.mockRestore();
  });
});

describe("verifyForModel", () => {
  it("tells the model to say a problem plainly and to propose the fix", async () => {
    const { verifyForModel } = await load({});
    const bad = verifyForModel({ status: "problem", checked: [], problems: ["Price is 20,000"], fix: "update_product price=25000" });
    expect(bad.status).toBe("problem");
    expect(JSON.stringify(bad)).toMatch(/Never say it is fine/);
    expect(bad.fix).toBe("update_product price=25000");
    expect(verifyForModel({ status: "ok", checked: ["x"], problems: [] })).toEqual({ status: "ok", checked: ["x"] });
  });
});
