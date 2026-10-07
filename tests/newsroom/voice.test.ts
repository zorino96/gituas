import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pcmToWav, providersFor, speak, SpeechUnavailable, speechText, SPEECH_MAX_CHARS } from "@/lib/voice/tts";

const both = { PAWAN_API_KEY: "p", GOOGLE_AI_API_KEY: "g" };

describe("voice routing", () => {
  it("sends Sorani to Pawan first, Gemini as the fallback", () => {
    expect(providersFor("ckb", both)).toEqual(["pawan", "gemini"]);
    expect(providersFor("ckb", { ...both, TTS_SORANI: "gemini" })).toEqual(["gemini", "pawan"]);
    expect(providersFor("ckb", { GOOGLE_AI_API_KEY: "g" })).toEqual(["gemini"]);
  });
  it("never sends Arabic or English to Pawan", () => {
    expect(providersFor("ar", both)).toEqual(["gemini"]);
    expect(providersFor("en", { PAWAN_API_KEY: "p" })).toEqual([]);
  });
});

describe("speechText", () => {
  it("drops links and hashtag signs", () => {
    expect(speechText("هەواڵ https://x.y/z  #هەولێر #Breaking_News")).toBe("هەواڵ هەولێر Breaking News");
  });
  it("cuts a long text after a sentence", () => {
    const s = `${"ا".repeat(800)}. ${"ب".repeat(800)}`;
    expect(speechText(s)).toBe(`${"ا".repeat(800)}.`);
    expect(speechText("x".repeat(3000))).toHaveLength(SPEECH_MAX_CHARS);
  });
});

describe("pcmToWav", () => {
  it("writes a 24 kHz mono 16-bit header", () => {
    const w = pcmToWav(Buffer.alloc(48_000));
    expect(w.toString("ascii", 0, 4)).toBe("RIFF");
    expect(w.readUInt32LE(24)).toBe(24_000);
    expect(w.readUInt32LE(40)).toBe(48_000);
    expect(w).toHaveLength(48_044);
  });
});

describe("speak", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.PAWAN_API_KEY = "p";
    process.env.GOOGLE_AI_API_KEY = "g";
    delete process.env.TTS_SORANI;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("uses Pawan's mp3 for Sorani, with the chosen voice", async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.alloc(2000, 1), { headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await speak({ text: "سڵاو", lang: "ckb", voice: "shilan" });
    expect(s).toMatchObject({ provider: "pawan", mime: "audio/mpeg" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.pawan.krd/v1/audio/speech");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "pkrd/tts-ku", input: "سڵاو", voice: "shilan", response_format: "mp3" });
  });

  it("falls back to Gemini when Pawan fails, and returns a WAV", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "quota" }), { status: 429, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(4800).toString("base64") } }] } }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await speak({ text: "سڵاو", lang: "ckb", gender: "female" });
    expect(s).toMatchObject({ provider: "gemini", mime: "audio/wav" });
    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    expect(body.contents[0].parts[0].text).toMatch(/Central Kurdish \(Sorani\):\nسڵاو$/);
  });

  it("says why when no provider produced audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(speak({ text: "Hello", lang: "en" })).rejects.toBeInstanceOf(SpeechUnavailable);
  });
});
