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
});
