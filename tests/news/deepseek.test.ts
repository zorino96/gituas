import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { DEEPSEEK_MODELS, deepseekJson } from "@/lib/ai/deepseek";

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("deepseekJson", () => {
  it("sends the model for the strength and parses the JSON reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: '{"headline":"x"}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await deepseekJson({ system: "s", user: "u", strength: "fast" }, 5000);
    expect(r).toEqual({ data: { headline: "x" }, model: "deepseek-flash" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe(DEEPSEEK_MODELS.fast);
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("throws on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"type":"invalid_request_error"}}', { status: 401 })));
    await expect(deepseekJson({ system: "s", user: "u", strength: "strong" }, 5000)).rejects.toThrow("HTTP 401");
  });

  it("never echoes the provider's free-text error message, only the status and error type/code", async () => {
    const secretBearingMessage = "the key sk-super-secret-123 is invalid";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { type: "authentication_error", code: "invalid_api_key", message: secretBearingMessage } }), {
          status: 401,
        }),
      ),
    );
    await expect(deepseekJson({ system: "s", user: "u", strength: "fast" }, 5000)).rejects.toThrow("authentication_error");
    try {
      await deepseekJson({ system: "s", user: "u", strength: "fast" }, 5000);
      throw new Error("expected deepseekJson to throw");
    } catch (e) {
      expect((e as Error).message).not.toContain(secretBearingMessage);
      expect((e as Error).message).not.toContain("sk-super-secret-123");
    }
  });
});
