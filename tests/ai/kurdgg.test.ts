import { describe, expect, it } from "vitest";

import { extractJson } from "@/lib/ai/kurdgg";

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
