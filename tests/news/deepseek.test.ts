import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deepseekAllows, deepseekConfigured, deepseekJson, deepseekModel } from "@/lib/ai/deepseek";

const call = { system: "s", user: "u", strength: "fast" as const };
const reply = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra }), { status: 200 });

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the stand-by switch", () => {
  it("exists only with a key, and can be switched off without removing it", () => {
    expect(deepseekConfigured()).toBe(true);
    vi.stubEnv("AI_FALLBACK_ENABLED", "0");
    expect(deepseekConfigured()).toBe(false);
    vi.stubEnv("AI_FALLBACK_ENABLED", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "  ");
    expect(deepseekConfigured()).toBe(false);
  });

  it("is never offered a call with pictures, because it cannot see", () => {
    expect(deepseekAllows(call)).toBe(true);
    expect(deepseekAllows({ ...call, images: ["data:image/png;base64,AAAA"] })).toBe(false);
  });

  it("uses the careful model for Opus-worthy work and the fast one otherwise", () => {
    expect(deepseekModel(false)).toBe("deepseek-flash");
    expect(deepseekModel(true)).toBe("deepseek-v4-pro");
    vi.stubEnv("DEEPSEEK_MODEL", "my-fast");
    vi.stubEnv("DEEPSEEK_MODEL_PRO", "my-pro");
    expect(deepseekModel(false)).toBe("my-fast");
    expect(deepseekModel(true)).toBe("my-pro");
  });
});

describe("deepseekJson", () => {
  it("sends the fast model without its thinking pass, asks for JSON, and returns the reply with the tokens it used", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"headline":"x"}'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await deepseekJson(call, 5000);
    expect(r).toEqual({ data: { headline: "x" }, model: "deepseek-flash", usage: { in: 120, out: 30 } });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("deepseek-flash");
    expect(sent.thinking).toEqual({ type: "disabled" });
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.max_tokens).toBeGreaterThanOrEqual(3000);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });

  it("lets the careful model think, with room for it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("{}", { model: "deepseek-v4-pro" }));
    vi.stubGlobal("fetch", fetchMock);
    await deepseekJson({ ...call, maxTokens: 700 }, 5000, true);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("deepseek-v4-pro");
    expect(sent).not.toHaveProperty("thinking");
    expect(sent.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("reads a reply wrapped in a code fence, and estimates the tokens when none are stated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }), { status: 200 })));
    const r = await deepseekJson(call, 5000);
    expect(r.data).toEqual({ a: 1 });
    expect(r.usage!.in).toBeGreaterThan(0);
    expect(r.usage!.out).toBeGreaterThan(0);
  });

  it("throws on an empty reply and on a reply that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("   ")));
    await expect(deepseekJson(call, 5000)).rejects.toThrow("empty reply");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("sorry, no")));
    await expect(deepseekJson(call, 5000)).rejects.toThrow();
  });

  it("throws on an HTTP error, even when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"type":"invalid_request_error"}}', { status: 401 })));
    await expect(deepseekJson(call, 5000)).rejects.toThrow("HTTP 401 invalid_request_error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(deepseekJson(call, 5000)).rejects.toThrow("HTTP 502 unknown");
  });

  it("never echoes the provider's free-text error message", async () => {
    const secret = "the key sk-super-secret-123 is invalid";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "authentication_error", message: secret } }), { status: 401 })));
    try {
      await deepseekJson(call, 5000);
      throw new Error("expected it to throw");
    } catch (e) {
      expect((e as Error).message).toContain("authentication_error");
      expect((e as Error).message).not.toContain("sk-super-secret-123");
    }
  });
});

describe("a reply that arrived but is unusable", () => {
  it("carries the tokens it cost, and never quotes the reply in its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("sorry, the buyer Aso 0750 1234567 asked")));
    try {
      await deepseekJson(call, 5000);
      throw new Error("expected it to throw");
    } catch (e) {
      expect((e as Error).name).toBe("DeepseekReplyError");
      expect((e as Error).message).toBe("the reply was not JSON");
      expect((e as { usage: unknown }).usage).toEqual({ in: 120, out: 30 });
    }
  });
});
