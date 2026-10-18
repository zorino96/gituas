import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { altAllows, altConfigured, altJson, altModels } from "@/lib/ai/alt";

const call = { system: "s", user: "u", strength: "fast" as const };

beforeEach(() => {
  vi.stubEnv("ALT_AI_BASE_URL", "https://gw.example/v1/");
  vi.stubEnv("ALT_AI_API_KEY", "k-test");
  vi.stubEnv("ALT_AI_MODELS", "model-a, vendor/model-b:free ,model-c");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the alternative models' settings", () => {
  it("reads the model ids in order, drops odd ones and keeps at most four", () => {
    expect(altModels()).toEqual(["model-a", "vendor/model-b:free", "model-c"]);
    vi.stubEnv("ALT_AI_MODELS", "a,b,c,d,e,f");
    expect(altModels()).toEqual(["a", "b", "c", "d"]);
    vi.stubEnv("ALT_AI_MODELS", "ok, bad id with spaces,,\"quoted\", fine/one");
    expect(altModels()).toEqual(["ok", "fine/one"]);
  });

  it("exist only with an address, a key and a model, and can be switched off with the other stand-bys", () => {
    expect(altConfigured()).toBe(true);
    vi.stubEnv("ALT_AI_API_KEY", " ");
    expect(altConfigured()).toBe(false);
    vi.stubEnv("ALT_AI_API_KEY", "k");
    vi.stubEnv("ALT_AI_MODELS", "");
    expect(altConfigured()).toBe(false);
    vi.stubEnv("ALT_AI_MODELS", "a");
    vi.stubEnv("AI_FALLBACK_ENABLED", "0");
    expect(altConfigured()).toBe(false);
  });

  it("are never offered a call with pictures", () => {
    expect(altAllows(call)).toBe(true);
    expect(altAllows({ ...call, images: ["data:image/png;base64,AAAA"] })).toBe(false);
  });
});

describe("altJson", () => {
  const reply = (content: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ model: "m-real", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 }, ...extra }), { status: 200 });

  it("sends the model with the key, no temperature and no response_format, and returns the answer with its tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await altJson(call, 5000, "model-a");
    expect(r).toEqual({ data: { a: 1 }, model: "alt/m-real", usage: { in: 50, out: 20 } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://gw.example/v1/chat/completions");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: "model-a", stream: false });
    expect(sent.max_tokens).toBeGreaterThanOrEqual(3000);
    expect(sent).not.toHaveProperty("temperature");
    expect(sent).not.toHaveProperty("response_format");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer k-test");
  });

  it("reads a streamed answer and a fenced one", async () => {
    const sse = ['data: {"model":"m-real","choices":[{"delta":{"content":"{\\"a\\":"}}]}', 'data: {"choices":[{"delta":{"content":"2}"}}]}', "data: [DONE]"].join("\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sse, { status: 200 })));
    expect((await altJson(call, 5000, "m")).data).toEqual({ a: 2 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply('```json\n{"a":3}\n```')));
    expect((await altJson(call, 5000, "m")).data).toEqual({ a: 3 });
  });

  it("throws on an HTTP error with only the status and the error type, never the gateway's words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "rate_limit", message: "the key sk-secret-1 is over its quota" } }), { status: 429 })));
    try {
      await altJson(call, 5000, "m");
      throw new Error("expected it to throw");
    } catch (e) {
      expect((e as Error).message).toBe("HTTP 429 rate_limit");
    }
  });

  it("carries the tokens of a reply that was billed but is empty or not JSON, and says whether it was cut", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("sorry, the buyer Aso 0750 1234567 asked")));
    try {
      await altJson(call, 5000, "m");
      throw new Error("expected it to throw");
    } catch (e) {
      expect((e as Error).name).toBe("AltReplyError");
      expect((e as Error).message).toBe("the reply was not JSON");
      expect((e as { usage: unknown }).usage).toEqual({ in: 50, out: 20 });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 5, completion_tokens: 3000 } }), { status: 200 })));
    await expect(altJson(call, 5000, "m")).rejects.toMatchObject({ name: "AltReplyError", truncated: true });
  });
});
