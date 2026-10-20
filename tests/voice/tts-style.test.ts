import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { speak } from "@/lib/voice/tts";

// The reading style Gemini is given before the text: the news anchor's by default (the newsroom's reels sound as
// they always did), and the caller's own when one is passed (an ad is read warmly, a story like a storyteller).

const answer = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(1200, 1).toString("base64") } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });

describe("speak: the style line", () => {
  let fetchMock: MockInstance<typeof fetch>;
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { contents: { parts: { text: string }[] }[]; generationConfig?: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } } });

  beforeEach(() => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "g");
    vi.stubEnv("PAWAN_API_KEY", "");
    vi.stubEnv("TTS_SORANI", "");
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer());
  });
  afterEach(() => {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  });

  it("uses the news anchor style when no style is given, in each language", async () => {
    await speak({ text: "Good evening", lang: "en" });
    await speak({ text: "مساء الخير", lang: "ar" });
    vi.stubEnv("TTS_SORANI", "gemini");
    await speak({ text: "ئێوارە باش", lang: "ckb" });
    const texts = bodies().map((b) => b.contents[0].parts[0].text);
    expect(texts[0]).toBe("Read this as a calm, professional TV news anchor:\nGood evening");
    expect(texts[1]).toBe("Read this as a calm, professional TV news anchor, in Modern Standard Arabic:\nمساء الخير");
    expect(texts[2]).toBe("Read this as a calm, professional TV news anchor, in Central Kurdish (Sorani):\nئێوارە باش");
  });

  it("replaces the default with the given style, and only then", async () => {
    const style = "Read this as a calm, engaging storyteller telling a story to a listener:";
    await speak({ text: "The lights were on.", lang: "en", style });
    const text = bodies()[0].contents[0].parts[0].text;
    expect(text).toBe(`${style}\nThe lights were on.`);
    expect(text).not.toContain("news anchor");
  });

  it("falls back to the default style when the style is empty", async () => {
    await speak({ text: "Hello", lang: "en", style: "   " });
    await speak({ text: "Hello", lang: "en", style: "" });
    for (const b of bodies()) expect(b.contents[0].parts[0].text).toBe("Read this as a calm, professional TV news anchor:\nHello");
  });

  it("does not change the voice: the style and the gender are separate", async () => {
    await speak({ text: "Hello", lang: "en", gender: "female", style: "Read warmly:" });
    await speak({ text: "Hello", lang: "en", gender: "male", style: "Read warmly:" });
    await speak({ text: "Hello", lang: "en" });
    const voices = bodies().map((b) => b.generationConfig?.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName);
    expect(voices).toEqual(["Kore", "Charon", "Charon"]);
  });

  it("is ignored by Pawan, which has no style", async () => {
    vi.stubEnv("PAWAN_API_KEY", "p");
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(1200, 1), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const s = await speak({ text: "ئێوارە باش", lang: "ckb", voice: "shilan", style: "Read warmly:" });
    expect(s.provider).toBe("pawan");
    expect(String(fetchMock.mock.calls[0][0])).toContain("pawan.krd");
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).not.toContain("Read warmly");
  });
});
