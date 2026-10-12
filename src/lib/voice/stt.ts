// ---------------------------------------------------------------------------
//  Speech to text: buyers' voice messages, so the shop's AI can read them.
// ---------------------------------------------------------------------------
//
//  Engines (all keys stay on the server):
//    pawan-asr  Pawan.Krd's Kurdish model (pkrd/asr-ku-large), through kurd.gg (KURDGG_API_KEY)
//               or, without it, api.pawan.krd (PAWAN_API_KEY)
//    whisper    OpenAI Whisper large-v3, through kurd.gg
//    gemini     Gemini 2.5 Flash with the audio inline (GOOGLE_AI_API_KEY)
//    gemini3    Gemini 3.x Flash through kurd.gg's chat API (OpenAI "input_audio" part)
//
//  transcribe() is what the product uses: the order in STT_ORDER (default below), first engine that
//  answers with text wins; null when none could. Never throws.

export type SttEngine = "pawan-asr" | "whisper" | "gemini" | "gemini3";

export interface Transcript {
  text: string;
  engine: SttEngine;
  model: string;
  ms: number;
}

/** WhatsApp/Instagram voice notes are short; anything bigger is not read (cost and time). */
export const STT_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 40_000;
const KURDGG_BASE = () => (process.env.KURDGG_BASE_URL?.trim() || "https://api.kurd.gg/v1").replace(/\/$/, "");
const PAWAN_BASE = "https://api.pawan.krd/v1";
const GEMINI3_MODEL = () => process.env.STT_GEMINI3_MODEL?.trim() || "ag/gemini-3.8-flash";

const PROMPT =
  "Transcribe this voice message word for word. It is usually Central Kurdish (Sorani): write it in the Kurdish Arabic script. " +
  "If it is Badini/Kurmanji, write it in the Kurdish Arabic script too. If it is Arabic or English, write it in that language. " +
  "Output only the transcript, nothing else.";

/** The default order, chosen by the 2026-10-12 comparison (scratchpad asr test); STT_ORDER overrides it. */
export const DEFAULT_ORDER: SttEngine[] = ["pawan-asr", "gemini", "whisper"];

export function sttOrder(env: Record<string, string | undefined> = process.env): SttEngine[] {
  const all: SttEngine[] = ["pawan-asr", "whisper", "gemini", "gemini3"];
  const wanted = (env.STT_ORDER ?? "").split(",").map((s) => s.trim()).filter((s): s is SttEngine => (all as string[]).includes(s));
  const order = wanted.length ? wanted : DEFAULT_ORDER;
  return order.filter((e) => engineReady(e, env));
}

export function engineReady(e: SttEngine, env: Record<string, string | undefined> = process.env): boolean {
  const kurdgg = !!env.KURDGG_API_KEY?.trim();
  if (e === "pawan-asr") return kurdgg || !!env.PAWAN_API_KEY?.trim();
  if (e === "whisper" || e === "gemini3") return kurdgg;
  return !!env.GOOGLE_AI_API_KEY?.trim();
}

/** A short, safe reason: the status and the provider's error type, never its free text (it can echo the request). */
async function failure(res: Response, what: string): Promise<Error> {
  let code = "";
  try {
    const b = (await res.json()) as { error?: { type?: string; code?: string } | string; message?: string };
    code = typeof b?.error === "object" ? String(b.error.type ?? b.error.code ?? "") : "";
    if (!code && typeof b?.message === "string" && /credit|quota|discord/i.test(b.message)) code = "no-credits";
  } catch {}
  return new Error(`${what} HTTP ${res.status}${code ? ` ${code}` : ""}`);
}

function extFor(mime: string): string {
  if (/ogg|opus/.test(mime)) return "ogg";
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/wav/.test(mime)) return "wav";
  if (/webm/.test(mime)) return "webm";
  return "bin";
}

async function openAiTranscription(base: string, key: string, model: string, audio: Buffer, mime: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${extFor(mime)}`);
  fd.append("model", model);
  fd.append("response_format", "json");
  const res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw await failure(res, model);
  const raw = await res.text();
  try {
    const j = JSON.parse(raw) as { text?: unknown };
    if (typeof j.text === "string") return j.text;
  } catch {}
  // Some gateways answer plain text for response_format=json.
  return raw.trim().startsWith("{") ? "" : raw.trim();
}

async function geminiDirect(audio: Buffer, mime: string): Promise<string> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GOOGLE_AI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: audio.toString("base64") } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(res, "gemini-2.5-flash");
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

async function gemini3(audio: Buffer, mime: string): Promise<string> {
  const { sseContent } = await import("../ai/kurdgg");
  const res = await fetch(`${KURDGG_BASE()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KURDGG_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI3_MODEL(),
      stream: false,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "input_audio", input_audio: { data: audio.toString("base64"), format: extFor(mime) } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(res, GEMINI3_MODEL());
  const raw = await res.text();
  if (raw.trimStart().startsWith("data:")) return sseContent(raw).content.trim();
  const b = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
  const c = b.choices?.[0]?.message?.content;
  return typeof c === "string" ? c.trim() : "";
}

/** One engine, for the comparison endpoint and for transcribe(). Throws on failure. */
export async function transcribeWith(engine: SttEngine, audio: Buffer, mime: string): Promise<Transcript> {
  const t0 = Date.now();
  let text = "";
  let model = "";
  const kurdgg = process.env.KURDGG_API_KEY?.trim();
  if (engine === "pawan-asr") {
    model = "pkrd/asr-ku-large";
    text = kurdgg
      ? await openAiTranscription(KURDGG_BASE(), kurdgg, model, audio, mime)
      : await openAiTranscription(PAWAN_BASE, process.env.PAWAN_API_KEY!.trim(), model, audio, mime);
  } else if (engine === "whisper") {
    model = "pkrd/openai/whisper-large-v3";
    text = await openAiTranscription(KURDGG_BASE(), kurdgg!, model, audio, mime);
  } else if (engine === "gemini") {
    model = "gemini-2.5-flash";
    text = await geminiDirect(audio, mime);
  } else {
    model = GEMINI3_MODEL();
    text = await gemini3(audio, mime);
  }
  return { text: cleanTranscript(text), engine, model, ms: Date.now() - t0 };
}

/** Quotes, a "Transcript:" label or surrounding whitespace some models add are taken off. */
export function cleanTranscript(s: string): string {
  return s
    .replace(/^\s*(transcript|transcription)\s*:\s*/i, "")
    .replace(/^["«“]+|["»”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The product path: the first engine in the configured order that hears words. */
export async function transcribe(audio: Buffer, mime: string, env: Record<string, string | undefined> = process.env): Promise<Transcript | null> {
  if (!audio.length || audio.length > STT_MAX_BYTES) return null;
  for (const engine of sttOrder(env)) {
    try {
      const t = await transcribeWith(engine, audio, mime);
      if (t.text) return t;
    } catch (e) {
      console.error("[stt]", e instanceof Error ? e.message : "failed");
    }
  }
  return null;
}
