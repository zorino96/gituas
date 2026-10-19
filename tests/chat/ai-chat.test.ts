import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatStep, chatTargets, flattenToolHistory, parseChatReply, type ChatMsg } from "@/lib/ai/chat";
import { resetAiCooling } from "@/lib/ai/provider";

const TOOL = [{ type: "function" as const, function: { name: "get_orders_count", description: "x", parameters: { type: "object", properties: {} } } }];

describe("parseChatReply", () => {
  it("reads text and a tool call from a plain JSON body", () => {
    const raw = JSON.stringify({
      model: "claude-haiku-5-5",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ finish_reason: "tool_calls", message: { content: "Let me look.", tool_calls: [{ id: "toolu_1", function: { name: "get_orders_count", arguments: '{"shop":"A"}' } }] } }],
    });
    expect(parseChatReply(raw)).toEqual({
      text: "Let me look.",
      toolCalls: [{ id: "toolu_1", name: "get_orders_count", args: '{"shop":"A"}' }],
      finish: "tool_calls",
      model: "claude-haiku-5-5",
      usage: { in: 100, out: 20 },
    });
  });

  it("joins the fragments of a streamed tool call by index and keeps two calls apart", () => {
    const raw = [
      'data: {"model":"m","choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"c1","function":{"name":"list_orders","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"limit\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"list_products","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"5}"}}]}}]}',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
      "data: [DONE]",
    ].join("\n");
    const r = parseChatReply(raw);
    expect(r.toolCalls).toEqual([
      { id: "c1", name: "list_orders", args: '{"limit":5}' },
      { id: "c2", name: "list_products", args: "{}" },
    ]);
    expect(r.finish).toBe("tool_calls");
    expect(r.usage).toEqual({ in: 7, out: 3 });
  });

  it("reads streamed text and content given as parts", () => {
    const sse = ['data: {"choices":[{"delta":{"content":"سڵ"}}]}', 'data: {"choices":[{"delta":{"content":"او"}}]}', "data: [DONE]"].join("\n");
    expect(parseChatReply(sse).text).toBe("سڵاو");
    const parts = JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] });
    expect(parseChatReply(parts).text).toBe("ab");
  });

  it("gives every call an id when the provider sent none, and drops a call with no name", () => {
    const raw = JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "a", arguments: {} } }, { function: { arguments: "{}" } }] } }] });
    const r = parseChatReply(raw);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: "a", args: "{}" });
    expect(r.toolCalls[0].id).toBeTruthy();
  });

  it("returns nothing for a body that is not a reply", () => {
    expect(parseChatReply("<html>").toolCalls).toEqual([]);
    expect(parseChatReply("").text).toBe("");
  });
});

describe("flattenToolHistory", () => {
  it("writes tool calls and results out as text and leaves other messages alone", () => {
    const m: ChatMsg[] = [
      { role: "system", content: "s" },
      { role: "user", content: "how many?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "orders_summary", arguments: '{"range":"today"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"orders":7}' },
    ];
    const f = flattenToolHistory(m);
    expect(f.map((x) => x.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(JSON.stringify(f)).not.toContain("tool_calls");
    expect(f[2]).toMatchObject({ content: expect.stringContaining('orders_summary({"range":"today"})') });
    expect(f[3]).toMatchObject({ content: expect.stringContaining('{"orders":7}') });
  });
});

describe("chatTargets", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("follows the owner's order and then adds what the order left out, once each", () => {
    process.env.KURDGG_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "d";
    process.env.ALT_AI_BASE_URL = "https://gw.example/v1";
    process.env.ALT_AI_API_KEY = "a";
    process.env.ALT_AI_MODELS = "oc/one,oc/two";
    delete process.env.AI_FALLBACK_ENABLED;
    const keys = chatTargets(["alt:cc/claude-haiku-5-5", "main", "deepseek", "alt"]).map((t) => t.key);
    expect(keys).toEqual(["alt:cc/claude-haiku-5-5", "main", "deepseek", "alt:oc/one", "alt:oc/two"]);
    expect(chatTargets(["deepseek"]).map((t) => t.key)).toEqual(["deepseek", "main", "alt:oc/one", "alt:oc/two"]);
  });

  it("leaves the free open models out when customers' words are in the conversation", () => {
    process.env.KURDGG_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "d";
    process.env.ALT_AI_BASE_URL = "https://gw.example/v1";
    process.env.ALT_AI_API_KEY = "a";
    process.env.ALT_AI_MODELS = "oc/one,cc/claude-haiku-5-5";
    delete process.env.AI_FALLBACK_ENABLED;
    const keys = chatTargets(["alt", "main", "deepseek"], false).map((t) => t.key);
    expect(keys).toEqual(["alt:cc/claude-haiku-5-5", "main", "deepseek"]);
  });
});

describe("chatStep", () => {
  const env = { ...process.env };
  const ok = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });

  beforeEach(() => {
    resetAiCooling();
    process.env.KURDGG_API_KEY = "k";
    process.env.KURDGG_BASE_URL = "https://gw.example/v1";
    process.env.DEEPSEEK_API_KEY = "d";
    delete process.env.ALT_AI_BASE_URL;
    delete process.env.ALT_AI_API_KEY;
    delete process.env.ALT_AI_MODELS;
    delete process.env.AI_FALLBACK_ENABLED;
    process.env.AI_ORDER = "main,deepseek";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("sends the tools and returns the model's tool call", async () => {
    const fetchMock = vi.fn(async () => ok({ model: "m", choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c1", function: { name: "get_orders_count", arguments: "{}" } }] } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await chatStep({ messages: [{ role: "user", content: "hi" }], tools: TOOL, deadlineAt: Date.now() + 30_000 });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "get_orders_count", args: "{}" }]);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tools).toEqual(TOOL);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.stream).toBe(false);
    expect(sent.temperature).toBeUndefined();
  });

  it("goes to the next provider when the first fails, and leaves the failed one alone afterwards", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.startsWith("https://gw.example") ? new Response('{"error":{"type":"overloaded"}}', { status: 503 }) : ok({ choices: [{ message: { content: "from deepseek" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const first = await chatStep({ messages: [{ role: "user", content: "hi" }], tools: TOOL, deadlineAt: Date.now() + 30_000 });
    expect(first.text).toBe("from deepseek");
    expect(first.model.startsWith("deepseek/")).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;
    await chatStep({ messages: [{ role: "user", content: "hi" }], tools: TOOL, deadlineAt: Date.now() + 30_000 });
    // the main provider is cooling: only DeepSeek was asked the second time
    expect(fetchMock.mock.calls.length - callsBefore).toBe(1);
  });

  it("retries a provider that refuses tool calls in the history with the history written out as text", async () => {
    let n = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      n++;
      const body = JSON.parse(init.body as string);
      if (n === 1) return new Response('{"error":{"type":"invalid_request_error"}}', { status: 400 });
      expect(JSON.stringify(body.messages)).not.toContain("tool_calls");
      return ok({ choices: [{ message: { content: "done" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const messages: ChatMsg[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{}" },
    ];
    const r = await chatStep({ messages, tools: TOOL, deadlineAt: Date.now() + 30_000 });
    expect(r.text).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when no provider answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(chatStep({ messages: [{ role: "user", content: "hi" }], tools: TOOL, deadlineAt: Date.now() + 30_000 })).rejects.toThrow();
  });

  it("does not start a try when the deadline is too close", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatStep({ messages: [{ role: "user", content: "hi" }], tools: TOOL, deadlineAt: Date.now() + 1_000 })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
