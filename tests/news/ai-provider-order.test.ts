import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));
vi.mock("@/lib/ai/deepseek", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/deepseek")>()), deepseekAllows: vi.fn(), deepseekJson: vi.fn() }));
vi.mock("@/lib/ai/alt", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/alt")>()), altAllows: vi.fn(), altJson: vi.fn(), altModels: vi.fn() }));

import { AiUnavailable, completeJson, mainOrder, resetAiCooling, videoOrder } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";
import * as ds from "@/lib/ai/deepseek";
import * as alt from "@/lib/ai/alt";

const call = { system: "s", user: "u", strength: "fast" as const };
const ok = (data: unknown = { from: "haiku" }) => ({ data, model: "kurdgg/claude-haiku-5-5", usage: { in: 1000, out: 100 } });
const dsOk = (data: unknown = { from: "deepseek" }) => ({ data, model: "deepseek-flash", usage: { in: 400, out: 50 } });
const altOk = (model: string, data: unknown = { from: "alt" }) => ({ data, model: `alt/${model}`, usage: { in: 300, out: 40 } });

beforeEach(() => {
  vi.unstubAllEnvs();
  resetAiCooling();
  vi.resetAllMocks();
  vi.mocked(kg.kurdggConfigured).mockReturnValue(true);
  vi.mocked(ds.deepseekAllows).mockReturnValue(true);
  vi.mocked(alt.altAllows).mockReturnValue(false);
  vi.mocked(alt.altModels).mockReturnValue([]);
});

describe("call.prefer = video (AI video scripts)", () => {
  beforeEach(() => {
    vi.mocked(alt.altAllows).mockReturnValue(true);
    vi.mocked(alt.altModels).mockReturnValue(["oc/deepseek-v4.1-flash-free", "oc/glm-5.3-flash-free", "oc/longcat-2.5-preview-free"]);
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
  });
  const altCalls = () => vi.mocked(alt.altJson).mock.calls.map((c) => c[2]);

  it("has the owner's default order", () => {
    expect(videoOrder()).toEqual(["deepseek", "alt:oc/deepseek-v4.1-flash-free", "alt:cc/claude-haiku-5-5", "main", "alt"]);
  });

  it("asks DeepSeek first and nothing else when it answers", async () => {
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    const out = await completeJson({ ...call, prefer: "video" });
    expect(out).toEqual({ data: { from: "deepseek" }, model: "deepseek-flash" });
    expect(kg.kurdggJson).not.toHaveBeenCalled();
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("goes to the free DeepSeek V4.1 Flash of the gateway when the DeepSeek API fails", async () => {
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 503 unknown"));
    vi.mocked(alt.altJson).mockResolvedValue(altOk("deepseek-v4.1-flash-free"));
    const out = await completeJson({ ...call, prefer: "video" });
    expect(out.model).toBe("alt/deepseek-v4.1-flash-free");
    expect(altCalls()).toEqual(["oc/deepseek-v4.1-flash-free"]);
    expect(kg.kurdggJson).not.toHaveBeenCalled();
  });

  it("then to the gateway's own Claude, and only then to Haiku", async () => {
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 503 unknown"));
    vi.mocked(alt.altJson).mockRejectedValueOnce(new Error("HTTP 400 server_error")).mockResolvedValueOnce(altOk("claude-haiku-5-5"));
    const out = await completeJson({ ...call, prefer: "video" });
    expect(out.model).toBe("alt/claude-haiku-5-5");
    expect(altCalls()).toEqual(["oc/deepseek-v4.1-flash-free", "cc/claude-haiku-5-5"]);
    expect(kg.kurdggJson).not.toHaveBeenCalled();
  });

  it("goes to Haiku when those have failed, and afterwards to the other alternative models, none asked twice", async () => {
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 503 unknown"));
    vi.mocked(alt.altJson).mockRejectedValue(new Error("HTTP 429 unknown"));
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    expect((await completeJson({ ...call, prefer: "video" })).data).toEqual({ from: "haiku" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
    expect(altCalls()).toEqual(["oc/deepseek-v4.1-flash-free", "cc/claude-haiku-5-5"]);
    // when Haiku fails too: the rest of the alternative models, and the ones already tried are not repeated
    vi.mocked(alt.altJson).mockClear();
    vi.mocked(ds.deepseekJson).mockClear();
    resetAiCooling(); // the first call left the failed steps cooling
    vi.mocked(kg.kurdggJson).mockReset().mockRejectedValue(new Error("HTTP 400 invalid_request_error"));
    await expect(completeJson({ ...call, prefer: "video" })).rejects.toBeInstanceOf(AiUnavailable);
    expect(altCalls()).toEqual(["oc/deepseek-v4.1-flash-free", "cc/claude-haiku-5-5", "oc/glm-5.3-flash-free", "oc/longcat-2.5-preview-free"]);
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
  });

  it("goes to Haiku first for a call the others cannot take (pictures)", async () => {
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    vi.mocked(alt.altAllows).mockReturnValue(false);
    const out = await completeJson({ ...call, prefer: "video", images: ["data:image/png;base64,AAAA"] });
    expect(out.data).toEqual({ from: "haiku" });
    expect(ds.deepseekJson).not.toHaveBeenCalled();
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("follows AI_VIDEO_ORDER when it is set, and ignores steps it does not know", async () => {
    vi.stubEnv("AI_VIDEO_ORDER", "main, deepseek, rm -rf, alt:bad id, alt");
    expect(videoOrder()).toEqual(["main", "deepseek", "alt"]);
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    expect((await completeJson({ ...call, prefer: "video" })).data).toEqual({ from: "haiku" });
    expect(ds.deepseekJson).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("counts every step like a Haiku call, and still refuses past a used-up allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, prefer: "video", meter: { scope: "t1" } });
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 400, 50);
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    await expect(completeJson({ ...call, prefer: "video", meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
  });

  it("keeps time for Haiku: a step before it leaves the reserve", async () => {
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, prefer: "video", budgetMs: 30_000 });
    // 30 s budget less 0.5 s less the 10 s kept for Haiku, capped at the fast try's 18 s
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][1]).toBeLessThanOrEqual(19_500);
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][1]).toBeGreaterThanOrEqual(4_000);
  });
});

describe("the alternative models", () => {
  beforeEach(() => {
    vi.stubEnv("AI_ORDER", "main,deepseek,alt");
    vi.mocked(alt.altAllows).mockReturnValue(true);
    vi.mocked(alt.altModels).mockReturnValue(["m1", "m2", "m3"]);
    vi.mocked(kg.kurdggJson).mockRejectedValue(new Error("HTTP 400 invalid_request_error"));
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 503 unknown"));
  });

  it("are tried one after the other, after Haiku and DeepSeek, and the first that answers wins", async () => {
    vi.mocked(alt.altJson).mockRejectedValueOnce(new Error("HTTP 429 unknown")).mockResolvedValueOnce(altOk("m2"));
    const out = await completeJson(call);
    expect(out).toEqual({ data: { from: "alt" }, model: "alt/m2" });
    expect(vi.mocked(alt.altJson).mock.calls.map((c) => c[2])).toEqual(["m1", "m2"]);
  });

  it("count as a Haiku call, also when their reply was billed but unusable", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(alt.altJson).mockRejectedValueOnce(new alt.AltReplyError("empty reply", { in: 200, out: 900 })).mockResolvedValueOnce(altOk("m2"));
    await completeJson({ ...call, meter: { scope: "t1" } });
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 200, 900);
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 300, 40);
  });

  it("are not used while an earlier provider answers", async () => {
    vi.mocked(kg.kurdggJson).mockReset().mockResolvedValue(ok());
    await completeJson(call);
    expect(alt.altJson).not.toHaveBeenCalled();
    vi.mocked(kg.kurdggJson).mockReset().mockRejectedValue(new Error("HTTP 400 x"));
    vi.mocked(ds.deepseekJson).mockReset().mockResolvedValue(dsOk());
    await completeJson(call);
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("are not used when they are not allowed (not configured, or a call with pictures), and the call fails as before", async () => {
    vi.mocked(alt.altAllows).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("answer when nothing else is configured at all", async () => {
    vi.mocked(kg.kurdggConfigured).mockReturnValue(false);
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    vi.mocked(alt.altJson).mockResolvedValue(altOk("m1"));
    expect((await completeJson(call)).model).toBe("alt/m1");
    expect(kg.kurdggJson).not.toHaveBeenCalled();
    vi.mocked(alt.altAllows).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toThrow(/no AI provider/);
  });

  it("never get around a refused allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    await expect(completeJson({ ...call, meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
    expect(alt.altJson).not.toHaveBeenCalled();
  });
});

describe("a DeepSeek reply that ran into its cap", () => {
  it("is not asked again with the same cap", async () => {
    vi.mocked(kg.kurdggJson).mockRejectedValue(new Error("HTTP 400 invalid_request_error"));
    vi.mocked(ds.deepseekJson).mockRejectedValue(new ds.DeepseekReplyError("the reply was not JSON", { in: 300, out: 3000 }, true));
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
  });
});

describe("the main order: Haiku through the gateway, then the official API", () => {
  beforeEach(() => {
    vi.mocked(alt.altAllows).mockReturnValue(true);
    vi.mocked(alt.altModels).mockReturnValue(["oc/deepseek-v4.1-flash-free", "oc/glm-5.3-flash-free"]);
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has the owner's default order", () => {
    expect(mainOrder()).toEqual(["alt:cc/claude-haiku-5-5", "main", "deepseek", "alt"]);
  });

  it("asks the gateway's Haiku first, and the official API only when the gateway cannot", async () => {
    vi.mocked(alt.altJson).mockResolvedValue(altOk("claude-haiku-5-5"));
    expect((await completeJson(call)).model).toBe("alt/claude-haiku-5-5");
    expect(vi.mocked(alt.altJson).mock.calls[0][2]).toBe("cc/claude-haiku-5-5");
    expect(kg.kurdggJson).not.toHaveBeenCalled();
    resetAiCooling();
    vi.mocked(alt.altJson).mockReset().mockRejectedValue(new Error("HTTP 503 unknown"));
    expect((await completeJson(call)).data).toEqual({ from: "haiku" });
    expect(kg.kurdggJson).toHaveBeenCalledTimes(1);
    expect(ds.deepseekJson).not.toHaveBeenCalled();
  });

  it("leaves a gateway that just failed alone for a while, so the next call goes straight to the official API", async () => {
    vi.mocked(alt.altJson).mockRejectedValue(new Error("HTTP 503 unknown"));
    await completeJson(call);
    await completeJson(call);
    await completeJson(call);
    expect(alt.altJson).toHaveBeenCalledTimes(1);
    expect(kg.kurdggJson).toHaveBeenCalledTimes(3);
  });

  it("does not cool a step for a reply of the wrong shape", async () => {
    const needsA = (d: unknown) => ((d as { a?: number })?.a ? (d as { a: number }) : null);
    vi.mocked(alt.altJson).mockResolvedValue(altOk("claude-haiku-5-5", { wrong: true }));
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok({ a: 1 }));
    await completeJson(call, needsA);
    await completeJson(call, needsA);
    expect(alt.altJson).toHaveBeenCalledTimes(2);
  });

  it("goes to the official API first for a call that wants Opus (the gateway step is Haiku)", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("opus");
    vi.mocked(alt.altJson).mockResolvedValue(altOk("claude-haiku-5-5"));
    vi.mocked(kg.kurdggJson).mockResolvedValue({ data: { from: "opus" }, model: "kurdgg/claude-opus-5-5", usage: { in: 10, out: 10 } });
    const out = await completeJson({ ...call, tier: "opus", meter: { scope: "t1" } });
    expect(out.data).toEqual({ from: "opus" });
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("goes to the official API first for a call with pictures (the gateway step cannot see)", async () => {
    vi.mocked(alt.altAllows).mockReturnValue(false);
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    const out = await completeJson({ ...call, images: ["data:image/png;base64,AAAA"] });
    expect(out.data).toEqual({ from: "haiku" });
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("is the official API alone when the gateway is not configured, as before", async () => {
    vi.mocked(alt.altAllows).mockReturnValue(false);
    expect((await completeJson(call)).data).toEqual({ from: "haiku" });
    expect(alt.altJson).not.toHaveBeenCalled();
  });

  it("follows AI_ORDER when it is set", async () => {
    vi.stubEnv("AI_ORDER", "main,alt");
    expect(mainOrder()).toEqual(["main", "alt"]);
    vi.mocked(alt.altJson).mockResolvedValue(altOk("claude-haiku-5-5"));
    expect((await completeJson(call)).data).toEqual({ from: "haiku" });
    expect(alt.altJson).not.toHaveBeenCalled();
  });
});
