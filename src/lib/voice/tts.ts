// ---------------------------------------------------------------------------
//  Text to speech for the newsroom's videos (the Story Reel builds on this).
// ---------------------------------------------------------------------------
//
//  Sorani goes to Pawan.krd (pkrd/tts-ku, an OpenAI-compatible API; the owner
//  has the provider's permission to use it inside Hawalnoos). Arabic and
//  English go to Gemini 2.5 Flash TTS, which is also Sorani's fallback: the
//  owner approved its Sorani samples on 2026-10-07. TTS_SORANI=gemini puts
//  Gemini first for Sorani without a code change.
//
//  Never throws for a provider failure on its own: the next provider is tried,
//  and SpeechUnavailable is thrown only when none produced audio.

export type VoiceLang = "ckb" | "ar" | "en";
export type VoiceGender = "male" | "female";
export type VoiceProvider = "pawan" | "gemini";

export interface Speech {
  audio: Buffer;
  mime: "audio/mpeg" | "audio/wav";
  provider: VoiceProvider;
}

export class SpeechUnavailable extends Error {
  constructor(public readonly reasons: string[]) {
    super(`No voice available: ${reasons.join("; ") || "no provider configured"}`);
  }
}

/** A Story Reel narration is a few sentences; anything longer is cut at a sentence end. */
export const SPEECH_MAX_CHARS = 1200;
const TIMEOUT_MS = 45_000;

const PAWAN_URL = "https://api.pawan.krd/v1/audio/speech";
const PAWAN_MODEL = "pkrd/tts-ku";
/** Pawan.krd's named voices; "male" and "female" are its defaults. */
export const PAWAN_VOICES = [
  "male", "female", "aram", "rebin", "shwan", "karwan", "hemin", "soran", "bakhtiyar", "kamaran", "dilshad",
  "rostam", "shilan", "lana", "rozhin", "shno", "hawnaz", "nazanin", "kazhal", "sozan", "gulala", "shirin",
] as const;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";
const GEMINI_VOICE: Record<VoiceGender, string> = { male: "Charon", female: "Kore" };
/** The reading style that produced the approved samples. */
const GEMINI_STYLE: Record<VoiceLang, string> = {
  ckb: "Read this as a calm, professional TV news anchor, in Central Kurdish (Sorani):",
  ar: "Read this as a calm, professional TV news anchor, in Modern Standard Arabic:",
  en: "Read this as a calm, professional TV news anchor:",
};

/** What is read aloud: no links or hashtag signs, one line, at most SPEECH_MAX_CHARS (cut after a sentence when possible). */
export function speechText(s: string): string {
  const flat = s
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#(\S+)/g, (_, w: string) => w.replace(/_/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= SPEECH_MAX_CHARS) return flat;
  const cut = flat.slice(0, SPEECH_MAX_CHARS);
  const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("؟"), cut.lastIndexOf("?"), cut.lastIndexOf("!"), cut.lastIndexOf("۔"));
  return end > SPEECH_MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}

/** Which providers to try, in order, given the keys that are set. Pawan.krd only speaks Kurdish. */
export function providersFor(lang: VoiceLang, env: Record<string, string | undefined> = process.env): VoiceProvider[] {
  const pawan = !!env.PAWAN_API_KEY;
  const gemini = !!env.GOOGLE_AI_API_KEY;
  if (lang !== "ckb") return gemini ? ["gemini"] : [];
  const order: VoiceProvider[] = env.TTS_SORANI === "gemini" ? ["gemini", "pawan"] : ["pawan", "gemini"];
  return order.filter((p) => (p === "pawan" ? pawan : gemini));
}

/** 16-bit mono PCM (Gemini's output) wrapped as a WAV file. */
export function pcmToWav(pcm: Buffer, rate = 24_000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function pawan(text: string, gender: VoiceGender, voice?: string): Promise<Speech> {
  const res = await fetch(PAWAN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAWAN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: PAWAN_MODEL,
      input: text,
      voice: voice && (PAWAN_VOICES as readonly string[]).includes(voice) ? voice : gender,
      response_format: "mp3",
      speed: 1,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const audio = Buffer.from(await res.arrayBuffer());
  // A JSON body here is an error message, not audio.
  if (!res.ok || audio.length < 512 || /json/i.test(res.headers.get("content-type") ?? "")) {
    throw new Error(`pawan ${res.status}: ${audio.toString("utf8", 0, 160)}`);
  }
  return { audio, mime: "audio/mpeg", provider: "pawan" };
}

async function gemini(text: string, lang: VoiceLang, gender: VoiceGender): Promise<Speech> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GOOGLE_AI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${GEMINI_STYLE[lang]}\n${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE[gender] } } },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    error?: { message?: string };
  } | null;
  const b64 = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!res.ok || !b64) throw new Error(`gemini ${res.status}: ${(j?.error?.message ?? "no audio").slice(0, 160)}`);
  return { audio: pcmToWav(Buffer.from(b64, "base64")), mime: "audio/wav", provider: "gemini" };
}

/** Read `text` aloud in `lang`: the first provider that answers wins. */
export async function speak(input: { text: string; lang: VoiceLang; gender?: VoiceGender; voice?: string }): Promise<Speech> {
  const text = speechText(input.text);
  const gender = input.gender ?? "male";
  if (!text) throw new SpeechUnavailable(["empty text"]);
  const reasons: string[] = [];
  for (const p of providersFor(input.lang)) {
    try {
      return p === "pawan" ? await pawan(text, gender, input.voice) : await gemini(text, input.lang, gender);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      reasons.push(why);
      console.error("[voice]", why);
    }
  }
  throw new SpeechUnavailable(reasons);
}
