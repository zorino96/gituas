import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/deepseek", () => ({ deepseekConfigured: vi.fn(), deepseekJson: vi.fn() }));
vi.mock("@/lib/ai/gemini-json", () => ({ geminiJson: vi.fn() }));
vi.mock("@/lib/gemini", () => ({ isGeminiConfigured: vi.fn() }));

import { AiUnavailable, completeJson } from "@/lib/ai/provider";
import * as ds from "@/lib/ai/deepseek";
import * as gj from "@/lib/ai/gemini-json";
import * as g from "@/lib/gemini";

const call = { system: "s", user: "u", strength: "fast" as const };

beforeEach(() => vi.resetAllMocks());

describe("completeJson", () => {
  it("uses DeepSeek when it answers", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    vi.mocked(ds.deepseekJson).mockResolvedValue({ data: { a: 1 }, model: "deepseek-flash" });
    expect(await completeJson(call)).toEqual({ data: { a: 1 }, model: "deepseek-flash" });
    expect(gj.geminiJson).not.toHaveBeenCalled();
  });

  it("retries DeepSeek once, then falls back to Gemini", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("down"));
    vi.mocked(g.isGeminiConfigured).mockReturnValue(true);
    vi.mocked(gj.geminiJson).mockResolvedValue({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(await completeJson(call)).toEqual({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(2);
  });

  it("throws AiUnavailable when nothing answers", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(false);
    vi.mocked(g.isGeminiConfigured).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("gives AiUnavailable the name AiUnavailable", () => {
    expect(new AiUnavailable("x").name).toBe("AiUnavailable");
  });

  it("does not retry DeepSeek after a timeout; goes straight to Gemini", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    const timeoutErr = new Error("timed out");
    timeoutErr.name = "TimeoutError";
    vi.mocked(ds.deepseekJson).mockRejectedValue(timeoutErr);
    vi.mocked(g.isGeminiConfigured).mockReturnValue(true);
    vi.mocked(gj.geminiJson).mockResolvedValue({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(await completeJson(call)).toEqual({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
  });

  it("falls back to Gemini when DeepSeek's reply fails validation, but still retries DeepSeek first", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    vi.mocked(ds.deepseekJson).mockResolvedValue({ data: { bad: true }, model: "deepseek-flash" });
    vi.mocked(g.isGeminiConfigured).mockReturnValue(true);
    vi.mocked(gj.geminiJson).mockResolvedValue({ data: { a: 1 }, model: "gemini-2.5-flash" });
    const validate = (d: unknown) => (d && typeof d === "object" && "a" in d ? (d as { a: number }) : null);
    const result = await completeJson(call, validate);
    expect(result).toEqual({ data: { a: 1 }, model: "gemini-2.5-flash" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(2);
  });

  it("attempts nothing further once the overall deadline is gone", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
      vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
      vi.mocked(ds.deepseekJson).mockImplementation(async () => {
        // A slow DeepSeek eats almost the whole 50s deadline.
        vi.setSystemTime(new Date(Date.now() + 45_000));
        throw new Error("slow failure");
      });
      vi.mocked(g.isGeminiConfigured).mockReturnValue(true);
      await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
      expect(ds.deepseekJson).toHaveBeenCalledTimes(1);
      expect(gj.geminiJson).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
