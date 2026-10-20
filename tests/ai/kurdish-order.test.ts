import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Text written in Sorani goes to Gemini first (the owner's choice, after the six-task comparison); every other call keeps the usual order.

import { completeJson, DEFAULT_KURDISH_ORDER, kurdishOrder, mainOrder, resetAiCooling, writesSorani } from "@/lib/ai/provider";

const ok = (text: string) => new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify({ text }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

let models: string[];
function gateway(fail: string[] = []) {
  models = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const model = JSON.parse(init.body).model as string;
      models.push(model);
      return fail.includes(model) ? new Response(JSON.stringify({ error: { type: "overloaded" } }), { status: 503 }) : ok(`from ${model}`);
    }),
  );
}

beforeEach(() => {
  resetAiCooling();
  vi.stubEnv("ALT_AI_BASE_URL", "https://gw.example/v1");
  vi.stubEnv("ALT_AI_API_KEY", "k-test");
  vi.stubEnv("ALT_AI_MODELS", "cc/claude-haiku-5-5,ag/gemini-3.8-flash");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SORANI = "Write the text in Central Kurdish (Sorani, Arabic script). Reply with JSON only.";
const ENGLISH = "Write a short English caption. Reply with JSON only.";

describe("the Sorani order", () => {
  it("puts Gemini 3.8 Flash first, then the gateway's Haiku, the main provider and the rest", () => {
    expect(kurdishOrder()).toEqual(["alt:ag/gemini-3.8-flash", "alt:cc/claude-haiku-5-5", "main", "deepseek", "alt"]);
    expect(DEFAULT_KURDISH_ORDER.startsWith("alt:ag/gemini-3.8-flash")).toBe(true);
    expect(mainOrder()[0]).toBe("alt:cc/claude-haiku-5-5");
  });
  it("can be changed from the environment (Gemini Pro first once it is stable)", () => {
    vi.stubEnv("AI_KURDISH_ORDER", "alt:ag/gemini-3.1-pro-high,alt:ag/gemini-3.8-flash");
    expect(kurdishOrder()).toEqual(["alt:ag/gemini-3.1-pro-high", "alt:ag/gemini-3.8-flash"]);
  });
});

describe("which calls write Sorani", () => {
  it("is a call that says so, or whose prompt asks for Sorani / Central Kurdish", () => {
    expect(writesSorani({ prefer: "kurdish", system: "x" })).toBe(true);
    expect(writesSorani({ system: SORANI })).toBe(true);
    expect(writesSorani({ system: "Write a reply in Sorani Kurdish." })).toBe(true);
  });
  it("is not an English call, and not a call that chose another order", () => {
    expect(writesSorani({ system: ENGLISH })).toBe(false);
    expect(writesSorani({ prefer: "video", system: SORANI })).toBe(false);
  });
});

describe("completeJson", () => {
  it("sends a Sorani call to Gemini first", async () => {
    gateway();
    const r = await completeJson<{ text: string }>({ system: SORANI, user: "u", strength: "fast" }, (d) => (typeof (d as { text?: unknown })?.text === "string" ? (d as { text: string }) : null));
    expect(models).toEqual(["ag/gemini-3.8-flash"]);
    expect(r.data.text).toBe("from ag/gemini-3.8-flash");
  });

  it("keeps the usual order for any other call", async () => {
    gateway();
    await completeJson({ system: ENGLISH, user: "u", strength: "fast" });
    expect(models).toEqual(["cc/claude-haiku-5-5"]);
  });

  it("goes on to Haiku when Gemini cannot answer, and leaves Gemini alone for a while", async () => {
    gateway(["ag/gemini-3.8-flash"]);
    const r = await completeJson<{ text: string }>({ system: SORANI, user: "u", strength: "fast" }, (d) => (typeof (d as { text?: unknown })?.text === "string" ? (d as { text: string }) : null));
    expect(models).toEqual(["ag/gemini-3.8-flash", "cc/claude-haiku-5-5"]);
    expect(r.data.text).toBe("from cc/claude-haiku-5-5");
    models.length = 0;
    await completeJson({ system: SORANI, user: "u", strength: "fast" });
    expect(models).toEqual(["cc/claude-haiku-5-5"]);
  });

  it("follows the usual order when the Sorani order is switched off", async () => {
    vi.stubEnv("AI_KURDISH_ORDER", "off");
    gateway();
    await completeJson({ system: SORANI, user: "u", strength: "fast" });
    expect(models).toEqual(["cc/claude-haiku-5-5"]);
  });
});
