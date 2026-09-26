import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { DEEPSEEK_MODELS, deepseekJson } from "@/lib/ai/deepseek";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("deepseekJson", () => {
  it("sends the model for the strength and parses the JSON reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: '{"headline":"x"}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await deepseekJson({ system: "s", user: "u", strength: "fast" });
    expect(r).toEqual({ data: { headline: "x" }, model: "deepseek-flash" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe(DEEPSEEK_MODELS.fast);
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("throws on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 })));
    await expect(deepseekJson({ system: "s", user: "u", strength: "strong" })).rejects.toThrow("HTTP 401");
  });
});
