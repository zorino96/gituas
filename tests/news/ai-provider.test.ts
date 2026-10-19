import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));
vi.mock("@/lib/ai/deepseek", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/deepseek")>()), deepseekAllows: vi.fn(), deepseekJson: vi.fn() }));

import { AiUnavailable, completeJson, resetAiCooling } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";
import * as ds from "@/lib/ai/deepseek";
import { KurdggReplyError } from "@/lib/ai/kurdgg";

const call = { system: "s", user: "u", strength: "fast" as const };
const ok = (data: unknown = { a: 1 }) => ({ data, model: "kurdgg/claude-haiku-5-5", usage: { in: 1000, out: 100 } });

beforeEach(() => {
  resetAiCooling();
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

describe("the DeepSeek stand-by", () => {
  const dsOk = (data: unknown = { from: "deepseek" }) => ({ data, model: "deepseek-flash", usage: { in: 400, out: 50 } });
  const down = () => vi.mocked(kg.kurdggJson).mockRejectedValue(new Error("HTTP 503 unknown"));
  beforeEach(() => {
    vi.mocked(ds.deepseekAllows).mockReturnValue(true);
  });

  it("answers when kurd.gg is down, after kurd.gg has had its two tries", async () => {
    down();
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    const out = await completeJson(call);
    expect(out).toEqual({ data: { from: "deepseek" }, model: "deepseek-flash" });
    expect(kg.kurdggJson).toHaveBeenCalledTimes(2);
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][2]).toBe(false);
  });

  it("is not used while kurd.gg answers", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson(call);
    expect(ds.deepseekJson).not.toHaveBeenCalled();
  });

  it("counts what it cost as a Haiku call against the workspace's allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    down();
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, meter: { scope: "t1" } });
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 400, 50);
  });

  it("uses the careful model when the call was worth Opus", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("opus");
    down();
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, strength: "strong", tier: "opus", meter: { scope: "t1" } });
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][2]).toBe(true);
  });

  it("never gets around a refused allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
    expect(ds.deepseekJson).not.toHaveBeenCalled();
  });

  it("is not tried for a call it cannot take (pictures), and the call fails as before", async () => {
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    down();
    await expect(completeJson({ ...call, images: ["data:image/png;base64,AAAA"] })).rejects.toBeInstanceOf(AiUnavailable);
    expect(ds.deepseekJson).not.toHaveBeenCalled();
  });

  it("gets a second go when the first DeepSeek reply did not fit, or the call failed in a way another try may fix", async () => {
    down();
    const needsA = (d: unknown) => ((d as { a?: number })?.a ? (d as { a: number }) : null);
    vi.mocked(ds.deepseekJson).mockResolvedValueOnce(dsOk({ wrong: true })).mockResolvedValueOnce(dsOk({ a: 7 }));
    expect((await completeJson(call, needsA)).data).toEqual({ a: 7 });
    vi.mocked(ds.deepseekJson).mockReset();
    vi.mocked(ds.deepseekJson).mockRejectedValueOnce(new Error("HTTP 503 unknown")).mockResolvedValueOnce(dsOk({ a: 8 }));
    expect((await completeJson(call, needsA)).data).toEqual({ a: 8 });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a DeepSeek call that was refused for good (a client error)", async () => {
    down();
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 401 unknown"));
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
  });

  it("fails with both reasons when DeepSeek fails too", async () => {
    down();
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 429 unknown"));
    await expect(completeJson(call)).rejects.toThrow(/HTTP 503.*deepseek: HTTP 429/);
  });

  it("pays for a DeepSeek reply of the wrong shape, and fails", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    down();
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk({ wrong: true }));
    const needsA = (d: unknown) => ((d as { a?: number })?.a ? (d as { a: number }) : null);
    await expect(completeJson({ ...call, meter: { scope: "t1" } }, needsA)).rejects.toBeInstanceOf(AiUnavailable);
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 400, 50);
  });

  it("answers after a kurd.gg timeout too, with the time that is left", async () => {
    vi.mocked(kg.kurdggJson).mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    expect((await completeJson({ ...call, budgetMs: 30_000 })).data).toEqual({ from: "deepseek" });
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][1]).toBeGreaterThanOrEqual(4_000);
  });

  it("takes no time from a healthy kurd.gg: its first try gets what it always had", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson({ ...call, budgetMs: 30_000 });
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][1]).toBe(18_000);
    vi.mocked(meter.chooseTier).mockResolvedValue("opus");
    await completeJson({ ...call, budgetMs: 30_000, tier: "opus", meter: { scope: "t1" } });
    // Opus: the 30 s budget less 1 s and the 9 s kept for a Haiku try after it, as before the stand-by existed
    expect(vi.mocked(kg.kurdggJson).mock.calls[1][1]).toBe(20_000);
  });

  it("is the provider when there is no kurd.gg key, after the allowance check", async () => {
    vi.mocked(kg.kurdggConfigured).mockReturnValue(false);
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    expect((await completeJson(call)).data).toEqual({ from: "deepseek" });
    expect(kg.kurdggJson).not.toHaveBeenCalled();
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toThrow(/no AI provider/);
  });

  it("counts a DeepSeek reply that was billed but could not be read, and a DeepSeek timeout", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    down();
    vi.mocked(ds.deepseekJson).mockRejectedValueOnce(new ds.DeepseekReplyError("empty reply", { in: 300, out: 900 }));
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toBeInstanceOf(AiUnavailable);
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 300, 900);
    vi.mocked(meter.recordSpend).mockClear();
    resetAiCooling(); // the first failure left DeepSeek cooling
    vi.mocked(ds.deepseekJson).mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toBeInstanceOf(AiUnavailable);
    expect(meter.recordSpend).toHaveBeenCalledTimes(1);
  });

  it("logs only the status of a failure, never a piece of a reply", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(kg.kurdggJson).mockRejectedValue(new Error(`Unexpected token "s", "sorry, the buyer Aso 0750 1234567 asked" is not valid JSON`));
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson(call);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("DeepSeek takes over");
    expect(logged).not.toContain("Aso");
    expect(logged).not.toContain("0750");
    warn.mockRestore();
  });
});

describe("Opus switched off (AI_OPUS_ENABLED=0)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_OPUS_ENABLED", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks kurd.gg for Haiku even when the call wants Opus, for a workspace and for a system call", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    await completeJson({ ...call, strength: "strong", tier: "opus", meter: { scope: "t1" } });
    await completeJson({ ...call, strength: "strong", opus: "always" });
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["haiku", "haiku"]);
    expect(vi.mocked(meter.chooseTier).mock.calls[0][1]).toBe("haiku");
  });

  it("does not move to Opus after a reply that did not fit", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok({ wrong: true }));
    const needsA = (d: unknown) => ((d as { a?: number })?.a ? (d as { a: number }) : null);
    await expect(completeJson({ ...call, opus: "retry" }, needsA)).rejects.toBeInstanceOf(AiUnavailable);
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["haiku", "haiku"]);
  });
});
