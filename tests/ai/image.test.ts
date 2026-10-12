import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImage, ImageError, imageEnabled } from "@/lib/ai/image";

const PNG = Buffer.from("not really a png");
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 });
const fail = (status: number, code = "") => new Response(JSON.stringify({ error: { code, message: "quoted request text must not leak" } }), { status });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  vi.stubEnv("AI_IMAGE_ENABLED", "");
  vi.stubEnv("OPENAI_IMAGE_MODEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("imageEnabled", () => {
  it("needs the key, and can be switched off without removing it", () => {
    expect(imageEnabled()).toBe(true);
    vi.stubEnv("AI_IMAGE_ENABLED", "0");
    expect(imageEnabled()).toBe(false);
    vi.stubEnv("AI_IMAGE_ENABLED", "");
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(imageEnabled()).toBe(false);
  });
});

describe("createImage", () => {
  it("generates from words alone with the Generations endpoint", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => (calls.push({ url, body: init.body }), ok())));
    const out = await createImage({ prompt: "a bag on a marble table", shape: "portrait" });
    expect(out.equals(PNG)).toBe(true);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(calls[0].body)).toMatchObject({ model: "gpt-image-2", size: "1024x1536", quality: "medium", n: 1 });
  });

  it("edits with the Edits endpoint when there are reference pictures, at most four", async () => {
    const seen: { url: string; form: FormData }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: FormData }) => (seen.push({ url, form: init.body }), ok())));
    const ref = { bytes: Buffer.from([1, 2, 3]), mime: "image/jpeg" as const };
    await createImage({ prompt: "keep the product, new scene", shape: "square", refs: [ref, ref, ref, ref, ref, ref] });
    expect(seen[0].url).toBe("https://api.openai.com/v1/images/edits");
    expect(seen[0].form.getAll("image[]")).toHaveLength(4);
    expect(seen[0].form.get("size")).toBe("1024x1024");
    expect(seen[0].form.get("model")).toBe("gpt-image-2");
  });

  it("sends the key only in the header, and the model the environment names", async () => {
    vi.stubEnv("OPENAI_IMAGE_MODEL", "gpt-image-1-mini");
    let header = "";
    let body = "";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { headers: Record<string, string>; body: string }) => ((header = init.headers.Authorization), (body = init.body), ok())));
    await createImage({ prompt: "x y z", shape: "square" });
    expect(header).toBe("Bearer sk-test-key");
    expect(body).not.toContain("sk-test-key");
    expect(JSON.parse(body).model).toBe("gpt-image-1-mini");
  });

  it("names the kind of failure and never keeps the provider's own words", async () => {
    const kind = async (res: Response) => {
      vi.stubGlobal("fetch", vi.fn(async () => res));
      try {
        await createImage({ prompt: "a picture", shape: "square" });
      } catch (e) {
        expect(e).toBeInstanceOf(ImageError);
        expect(String((e as Error).message)).not.toContain("quoted");
        return (e as ImageError).kind;
      }
      return "none";
    };
    expect(await kind(fail(429))).toBe("busy");
    expect(await kind(fail(503))).toBe("busy");
    expect(await kind(fail(401))).toBe("config");
    expect(await kind(fail(400, "moderation_blocked"))).toBe("refused");
    expect(await kind(new Response("{}", { status: 200 }))).toBe("failed");
    expect(await kind(new Response("not json", { status: 200 }))).toBe("failed");
  });

  it("times out and reports it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("the operation timed out"), { name: "TimeoutError" }))));
    await expect(createImage({ prompt: "a picture", shape: "square" })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("refuses to call without a key or with an empty prompt", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(createImage({ prompt: "a picture", shape: "square" })).rejects.toMatchObject({ kind: "config" });
    vi.stubEnv("OPENAI_API_KEY", "sk-x");
    await expect(createImage({ prompt: "   ", shape: "square" })).rejects.toMatchObject({ kind: "failed" });
    expect(f).not.toHaveBeenCalled();
  });
});
