import { describe, expect, it } from "vitest";

import { extractJson, sseContent } from "@/lib/ai/kurdgg";

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
