import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));
vi.mock("@/lib/ai/deepseek", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/deepseek")>()), deepseekAllows: vi.fn(), deepseekJson: vi.fn() }));
vi.mock("@/lib/ai/alt", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/alt")>()), altAllows: vi.fn(), altJson: vi.fn(), altModels: vi.fn() }));

import { AiUnavailable, completeJson } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";
import * as ds from "@/lib/ai/deepseek";
import * as alt from "@/lib/ai/alt";

const call = { system: "s", user: "u", strength: "fast" as const };
const ok = (data: unknown = { from: "haiku" }) => ({ data, model: "kurdgg/claude-haiku-5-5", usage: { in: 1000, out: 100 } });
const dsOk = (data: unknown = { from: "deepseek" }) => ({ data, model: "deepseek-flash", usage: { in: 400, out: 50 } });
const altOk = (model: string, data: unknown = { from: "alt" }) => ({ data, model: `alt/${model}`, usage: { in: 300, out: 40 } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(kg.kurdggConfigured).mockReturnValue(true);
  vi.mocked(ds.deepseekAllows).mockReturnValue(true);
  vi.mocked(alt.altAllows).mockReturnValue(false);
  vi.mocked(alt.altModels).mockReturnValue([]);
});

describe("call.prefer = deepseek (AI video scripts)", () => {
  it("asks DeepSeek first and never touches Haiku when DeepSeek answers", async () => {
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    const out = await completeJson({ ...call, prefer: "deepseek" });
    expect(out).toEqual({ data: { from: "deepseek" }, model: "deepseek-flash" });
    expect(kg.kurdggJson).not.toHaveBeenCalled();
  });

  it("goes to Haiku when DeepSeek fails, and does not ask DeepSeek a second time afterwards", async () => {
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("HTTP 503 unknown"));
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    const out = await completeJson({ ...call, prefer: "deepseek" });
    expect(out.data).toEqual({ from: "haiku" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
    // and when Haiku fails too, there is no second DeepSeek try either
    vi.mocked(kg.kurdggJson).mockReset().mockRejectedValue(new Error("HTTP 400 invalid_request_error"));
    await expect(completeJson({ ...call, prefer: "deepseek" })).rejects.toBeInstanceOf(AiUnavailable);
    expect(ds.deepseekJson).toHaveBeenCalledTimes(2);
  });

  it("goes to Haiku first for a call DeepSeek cannot take (pictures)", async () => {
    vi.mocked(ds.deepseekAllows).mockReturnValue(false);
    vi.mocked(kg.kurdggJson).mockResolvedValue(ok());
    const out = await completeJson({ ...call, prefer: "deepseek", images: ["data:image/png;base64,AAAA"] });
    expect(out.data).toEqual({ from: "haiku" });
    expect(ds.deepseekJson).not.toHaveBeenCalled();
  });

  it("counts the DeepSeek call like a Haiku call, and still refuses past a used-up allowance", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, prefer: "deepseek", meter: { scope: "t1" } });
    expect(meter.recordSpend).toHaveBeenCalledWith({ scope: "t1" }, "haiku", 400, 50);
    vi.mocked(meter.chooseTier).mockResolvedValue(null);
    await expect(completeJson({ ...call, prefer: "deepseek", meter: { scope: "t1" } })).rejects.toThrow(/allowance/);
  });

  it("keeps time for Haiku: DeepSeek's timeout leaves the reserve", async () => {
    vi.mocked(ds.deepseekJson).mockResolvedValue(dsOk());
    await completeJson({ ...call, prefer: "deepseek", budgetMs: 30_000 });
    // 30 s budget less 0.5 s less the 10 s kept for Haiku, capped at the fast try's 18 s
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][1]).toBeLessThanOrEqual(19_500);
    expect(vi.mocked(ds.deepseekJson).mock.calls[0][1]).toBeGreaterThanOrEqual(4_000);
  });
});

describe("the alternative models", () => {
  beforeEach(() => {
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
