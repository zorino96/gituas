import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));
vi.mock("@/lib/ai/router", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/router")>()), routerJson: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";
import * as rt from "@/lib/ai/router";

const call = { system: "s", user: "u", strength: "fast" as const };
const paid = { data: { from: "paid" }, model: "kurdgg/claude-haiku-5-5", usage: { in: 100, out: 10 } };
const free = { data: { from: "free" }, model: "router/free-combo", usage: { in: 100, out: 10 } };
const KEYS = ["ROUTER_BASE_URL", "ROUTER_API_KEY", "ROUTER_MODEL", "ROUTER_SCOPE", "ROUTER_ENABLED"] as const;

beforeEach(() => {
  vi.resetAllMocks();
  rt.resetRouterCooling();
  vi.mocked(kg.kurdggConfigured).mockReturnValue(true);
  vi.mocked(kg.kurdggJson).mockResolvedValue(paid);
  process.env.ROUTER_BASE_URL = "https://router.example/v1";
  process.env.ROUTER_API_KEY = "test-value";
  process.env.ROUTER_MODEL = "free-combo";
  delete process.env.ROUTER_SCOPE;
  delete process.env.ROUTER_ENABLED;
});
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("the free router in front of kurd.gg", () => {
  it("answers a public call without touching kurd.gg or the allowance", async () => {
    vi.mocked(rt.routerJson).mockResolvedValue(free);
    const r = await completeJson({ ...call, free: "light" });
    expect(r).toEqual({ data: { from: "free" }, model: "router/free-combo" });
    expect(kg.kurdggJson).not.toHaveBeenCalled();
    expect(meter.chooseTier).not.toHaveBeenCalled();
    expect(meter.recordSpend).not.toHaveBeenCalled();
  });

  it("never carries a call that is not marked free, or one that asks for Opus or pictures", async () => {
    await completeJson(call);
    await completeJson({ ...call, free: "light", tier: "opus" });
    await completeJson({ ...call, free: "light", images: ["https://x/y.jpg"] });
    expect(rt.routerJson).not.toHaveBeenCalled();
    expect(kg.kurdggJson).toHaveBeenCalledTimes(3);
  });

  it("keeps the drafts on kurd.gg until the scope is widened", async () => {
    await completeJson({ ...call, free: "draft" });
    expect(rt.routerJson).not.toHaveBeenCalled();
    process.env.ROUTER_SCOPE = "draft";
    vi.mocked(rt.routerJson).mockResolvedValue(free);
    expect((await completeJson({ ...call, free: "draft" })).model).toBe("router/free-combo");
  });

  it("goes on to kurd.gg when the router is out of quota, and leaves the router alone for a while", async () => {
    vi.mocked(rt.routerJson).mockRejectedValue(new Error("HTTP 429 rate_limit"));
    expect((await completeJson({ ...call, free: "light" })).data).toEqual({ from: "paid" });
    expect(rt.routerJson).toHaveBeenCalledTimes(1);
    await completeJson({ ...call, free: "light" });
    expect(rt.routerJson).toHaveBeenCalledTimes(1); // cooling: not asked again
    expect(kg.kurdggJson).toHaveBeenCalledTimes(2);
  });

  it("goes on to kurd.gg when the router's reply does not have the shape needed", async () => {
    vi.mocked(rt.routerJson).mockResolvedValue({ ...free, data: { wrong: true } });
    const r = await completeJson({ ...call, free: "light" }, (d) => ((d as { from?: string }).from === "paid" ? (d as { from: string }) : null));
    expect(r.data).toEqual({ from: "paid" });
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
  });

  it("is off when it is not configured or switched off", async () => {
    process.env.ROUTER_ENABLED = "0";
    await completeJson({ ...call, free: "light" });
    delete process.env.ROUTER_ENABLED;
    delete process.env.ROUTER_API_KEY;
    await completeJson({ ...call, free: "light" });
    expect(rt.routerJson).not.toHaveBeenCalled();
  });

  it("works when only the router is configured, and fails cleanly when it fails too", async () => {
    vi.mocked(kg.kurdggConfigured).mockReturnValue(false);
    vi.mocked(rt.routerJson).mockResolvedValue(free);
    expect((await completeJson({ ...call, free: "light" })).model).toBe("router/free-combo");
    vi.mocked(rt.routerJson).mockRejectedValue(new Error("HTTP 500 boom"));
    rt.resetRouterCooling();
    await expect(completeJson({ ...call, free: "light" })).rejects.toThrow(/no paid provider/);
    await expect(completeJson(call)).rejects.toThrow(/no AI provider/);
  });
});
