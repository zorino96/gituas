import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));

import { AiUnavailable, completeJson } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";
import { KurdggReplyError } from "@/lib/ai/kurdgg";

const call = { system: "s", user: "u", strength: "fast" as const };
const ok = (data: unknown = { a: 1 }) => ({ data, model: "kurdgg/claude-haiku-5-5", usage: { in: 1000, out: 100 } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(kg.kurdggConfigured).mockReturnValue(true);
});

describe("completeJson", () => {
  it("answers through kurd.gg with Haiku unless Opus is asked for", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    expect(await completeJson(call)).toEqual({ data: { a: 1 }, model: "kurdgg/claude-haiku-5-5" });
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][2]).toBe("haiku");
    vi.mocked(meter.chooseTier).mockResolvedValue("opus");
    await completeJson({ ...call, tier: "opus", meter: { scope: "t1" } });
    expect(vi.mocked(kg.kurdggJson).mock.calls[1][2]).toBe("opus");
  });

  it("throws AiUnavailable when kurd.gg is not configured", async () => {
    vi.mocked(kg.kurdggConfigured).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(kg.kurdggJson).not.toHaveBeenCalled();
  });

  it("refuses the call when the store's monthly allowance is used up", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
    expect(kg.kurdggJson).not.toHaveBeenCalled();
  });

  it("makes the call with the tier the allowance grants, and counts what it cost", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    const m = { scope: "t1" };
    await completeJson({ ...call, tier: "opus", meter: m });
    expect(meter.chooseTier).toHaveBeenCalledWith(m, "opus", { essential: undefined });
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][2]).toBe("haiku");
    expect(meter.recordSpend).toHaveBeenCalledWith(m, "haiku", 1000, 100);
  });

  it("does not count a call that has no store", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson(call);
    expect(meter.chooseTier).not.toHaveBeenCalled();
    expect(meter.recordSpend).not.toHaveBeenCalled();
  });

  it("tries once more after a provider error, and not after a timeout", async () => {
    vi.mocked(kg.kurdggJson).mockRejectedValueOnce(new Error("HTTP 503 overloaded")).mockResolvedValueOnce(ok({ b: 2 }));
    expect((await completeJson(call)).data).toEqual({ b: 2 });
    vi.mocked(kg.kurdggJson).mockReset();
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.mocked(kg.kurdggJson).mockRejectedValue(timeout);
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
  });

  it("does not retry a client error", async () => {
    vi.mocked(kg.kurdggJson).mockRejectedValue(new Error("HTTP 400 invalid_request"));
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
  });

  it("pays for a reply of the wrong shape and asks once more", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok({ wrong: true }));
    const needsA = (d: unknown) => ((d as { a?: number })?.a ? (d as { a: number }) : null);
    await expect(completeJson({ ...call, meter: { scope: "t1" } }, needsA)).rejects.toBeInstanceOf(AiUnavailable);
    expect(kg.kurdggJson).toHaveBeenCalledTimes(2);
    expect(meter.recordSpend).toHaveBeenCalledTimes(2);
  });

  it("lets an essential call use the whole allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson({ ...call, meter: { scope: "t1" }, essential: true });
    expect(meter.chooseTier).toHaveBeenCalledWith({ scope: "t1" }, "haiku", { essential: true });
  });

  it("never makes an Opus call that is not counted against a workspace", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson({ ...call, tier: "opus" });
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][2]).toBe("haiku");
  });

  it("answers with Haiku when Opus fails or is not available to the key", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("opus");
    vi.mocked(kg.kurdggJson).mockRejectedValueOnce(new Error("HTTP 403 model_not_allowed")).mockResolvedValueOnce(ok({ b: 2 }));
    const out = await completeJson({ ...call, strength: "strong", tier: "opus", meter: { scope: "t1" } });
    expect(out.data).toEqual({ b: 2 });
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["opus", "haiku"]);
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 1000, 100);
  });

  it("counts a reply that was paid for but could not be read, and does not ask again when it was cut off", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockRejectedValue(new KurdggReplyError("the reply was not JSON", { in: 700, out: 160 }, true));
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toBeInstanceOf(AiUnavailable);
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 700, 160);
  });

  it("falls back to Haiku when the allowance cannot be read", async () => {
    vi.mocked(meter.chooseTier).mockRejectedValue(new Error("db down"));
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson({ ...call, tier: "opus", meter: { scope: "t1" } });
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][2]).toBe("haiku");
  });

  it("gives AiUnavailable the name AiUnavailable", () => {
    expect(new AiUnavailable("x").name).toBe("AiUnavailable");
  });
});
