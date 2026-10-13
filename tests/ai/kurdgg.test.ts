import { describe, expect, it, vi } from "vitest";

import { describeEmpty, extractJson, partsText, sseContent } from "@/lib/ai/kurdgg";

describe("extractJson", () => {
  it("reads plain JSON, fenced JSON and JSON inside a sentence", () => {
    expect(extractJson('{"text":"سڵاو"}')).toEqual({ text: "سڵاو" });
    expect(extractJson('```json\n{"keep": true}\n```')).toEqual({ keep: true });
    expect(extractJson('Here it is: {"ids":["a"]} done')).toEqual({ ids: ["a"] });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("sseContent", () => {
  it("joins streamed chunks and keeps the model", () => {
    const raw = [
      'data: {"model":"claude-haiku-5-5","choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"text\\": \\"سڵا"}}]}',
      'data: {"choices":[{"delta":{"content":"و\\"}"}}]}',
      "data: [DONE]",
    ].join("\n");
    expect(sseContent(raw)).toEqual({ content: '{"text": "سڵاو"}', model: "claude-haiku-5-5" });
  });
});

describe("replyUsage", () => {
  it("reads the token counts of a plain reply and of a streamed one", async () => {
    const { replyUsage } = await import("@/lib/ai/kurdgg");
    expect(replyUsage('{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}')).toEqual({ in: 120, out: 30 });
    const sse = ['data: {"choices":[{"delta":{"content":"{}"}}]}', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}', "data: [DONE]"].join("\n");
    expect(replyUsage(sse)).toEqual({ in: 10, out: 2 });
  });

  it("says nothing when the provider gave no counts", async () => {
    const { replyUsage } = await import("@/lib/ai/kurdgg");
    expect(replyUsage('{"choices":[]}')).toBeNull();
    expect(replyUsage("data: [DONE]")).toBeNull();
    expect(replyUsage("not json")).toBeNull();
  });
});

describe("kurdggJson", () => {
  it("asks for the tier's model, caps the answer, and reports usage (an estimate when the provider gives none)", async () => {
    const { kurdggJson } = await import("@/lib/ai/kurdgg");
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        seen.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ model: "claude-haiku-5-5", choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
      }),
    );
    vi.stubEnv("KURDGG_API_KEY", "k");
    const r = await kurdggJson({ system: "sys", user: "hello", strength: "fast", maxTokens: 150 }, 5_000, "opus");
    expect(seen[0]).toMatchObject({ model: "cc/claude-opus-5-5", max_tokens: 150 });
    expect(r.data).toEqual({ ok: true });
    expect(r.usage!.in).toBeGreaterThan(0);
    expect(r.usage!.out).toBeGreaterThan(0);
    await kurdggJson({ system: "sys", user: "hello", strength: "fast" }, 5_000);
    expect(seen[1]).toMatchObject({ model: "cc/claude-haiku-5-5", max_tokens: 2000 });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("replies that are not a plain string", () => {
  it("reads a list of content parts as text", () => {
    expect(partsText([{ type: "text", text: "{\"a\":" }, { type: "text", text: "1}" }])).toBe("{\"a\":1}");
    expect(partsText("x")).toBe("x");
    expect(partsText(null)).toBe("");
    expect(partsText([{ type: "thinking", thinking: "..." }])).toBe("");
  });

  it("joins streamed parts whether the delta is a string or a list of parts", () => {
    const raw = [
      `data: ${JSON.stringify({ model: "m", choices: [{ delta: { content: [{ type: "text", text: "{\"ok\":" }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "true}" } }] })}`,
      "data: [DONE]",
    ].join("\n");
    expect(sseContent(raw).content).toBe("{\"ok\":true}");
  });

  it("describes an empty answer by its shape only, never its words", () => {
    const raw = [`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: null }, finish_reason: "content_filter" }], note: "quoted request text" })}`, "data: [DONE]"].join("\n");
    const d = describeEmpty(raw);
    expect(d).toContain("finish:content_filter");
    expect(d).toContain("content:null");
    expect(d).not.toContain("quoted request text");
  });
});
