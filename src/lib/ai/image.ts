// AI pictures: OpenAI's image model through the Images API (the owner's choice: the ChatGPT API
// edits the picture). Text models stay Haiku and Opus; this is the one place a picture is made.
//
//   OPENAI_API_KEY        required (set in Vercel; the feature is off without it)
//   OPENAI_IMAGE_MODEL    default gpt-image-2 (gpt-image-1 is shut down by OpenAI on 2026-10-23,
//                         gpt-image-1.5 on 2026-12-01: see developers.openai.com/api/docs/deprecations)
//   AI_IMAGE_ENABLED=0    switches it off (the key may stay)
//
// With reference pictures the Edits endpoint is used (the product stays as the owner's picture shows
// it); without, the Generations endpoint. Every call costs a few cents, so callers claim a slot first
// (src/lib/ai/slots.ts) and the plan's monthly and daily numbers bound the spend.

export type ImageShape = "square" | "portrait";

const SIZE: Record<ImageShape, string> = { square: "1024x1024", portrait: "1024x1536" };
const ENDPOINT = "https://api.openai.com/v1/images";
const QUALITY = "medium";

export function imageEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim() && process.env.AI_IMAGE_ENABLED?.trim() !== "0";
}

export type ImageFailure = "busy" | "refused" | "config" | "failed" | "timeout";

export class ImageError extends Error {
  constructor(readonly kind: ImageFailure) {
    super(`image ${kind}`);
    this.name = "ImageError";
  }
}

export interface ReferencePicture {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/** The picture as PNG bytes. Throws ImageError; never echoes the provider's own message. */
export async function createImage(input: { prompt: string; shape: ImageShape; refs?: ReferencePicture[] }, timeoutMs = 55_000): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || process.env.AI_IMAGE_ENABLED?.trim() === "0") throw new ImageError("config");
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const refs = (input.refs ?? []).slice(0, 4);
  const prompt = input.prompt.trim().slice(0, 3_000);
  if (!prompt) throw new ImageError("failed");

  let res: Response;
  try {
    if (refs.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("size", SIZE[input.shape]);
      form.set("quality", QUALITY);
      form.set("n", "1");
      refs.forEach((r, i) => form.append("image[]", new Blob([new Uint8Array(r.bytes)], { type: r.mime }), `reference-${i}.${r.mime === "image/png" ? "png" : r.mime === "image/webp" ? "webp" : "jpg"}`));
      res = await fetch(`${ENDPOINT}/edits`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(timeoutMs) });
    } else {
      res = await fetch(`${ENDPOINT}/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size: SIZE[input.shape], quality: QUALITY, n: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
  } catch (e) {
    throw new ImageError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "failed");
  }

  // A picture's body is large: reading it can run past the deadline too.
  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw new ImageError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "failed");
  }
  if (!res.ok) {
    // The code tells the kind of failure; the provider's free text can quote the request, so it is never kept.
    let code = "";
    try {
      const b = JSON.parse(raw) as { error?: { code?: unknown; type?: unknown } };
      code = String(b?.error?.code ?? b?.error?.type ?? "");
    } catch {
      /* not JSON */
    }
    if (res.status === 429 || res.status >= 500) throw new ImageError("busy");
    if (res.status === 401 || res.status === 403) throw new ImageError("config");
    if (/moderation|safety|content_policy|policy/i.test(code) || res.status === 400) throw new ImageError("refused");
    throw new ImageError("failed");
  }
  let b64: unknown;
  try {
    const body = JSON.parse(raw) as { data?: { b64_json?: unknown }[]; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    b64 = body.data?.[0]?.b64_json;
    // The tokens OpenAI billed: the only record of what a picture really costs (numbers only, no text).
    console.info("[ai-image] usage", JSON.stringify({ model, shape: input.shape, refs: refs.length, in: body.usage?.input_tokens ?? null, out: body.usage?.output_tokens ?? null }));
  } catch {
    b64 = null;
  }
  if (typeof b64 !== "string" || !b64) throw new ImageError("failed");
  return Buffer.from(b64, "base64");
}
