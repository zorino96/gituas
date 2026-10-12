import { describe, expect, it } from "vitest";

import { parseEntry } from "@/lib/shop/webhook-parse";
import { metaMediaUrl, voiceContent, voiceNoteAllowed } from "@/lib/shop/voice-note";
import { parseWaPayload, typedText } from "@/lib/whatsapp/webhook";
import { attemptTimeout, cleanTranscript, STT_BUDGET_MS, sttOrder } from "@/lib/voice/stt";

describe("voice notes", () => {
  it("an Instagram voice note becomes a dm with its audio url", () => {
    const evs = parseEntry("instagram", {
      id: "IG1",
      messaging: [{ sender: { id: "U1" }, message: { mid: "m1", attachments: [{ type: "audio", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }] } }],
    });
    expect(evs).toEqual([
      { kind: "dm", platform: "META_INSTAGRAM", accountId: "IG1", messageId: "m1", senderId: "U1", text: "[audio]", audioUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" },
    ]);
  });

  it("a text dm has no audio url", () => {
    const [ev] = parseEntry("page", { id: "P1", messaging: [{ sender: { id: "U2" }, message: { mid: "m2", text: "hi" } }] });
    expect(ev).toMatchObject({ kind: "dm", text: "hi", audioUrl: null });
  });

  it("a WhatsApp voice note keeps its media id", () => {
    const [ev] = parseWaPayload({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN" }, messages: [{ id: "w1", from: "9647501", type: "audio", audio: { id: "MEDIA9", mime_type: "audio/ogg; codecs=opus" } }] } }] }],
    });
    expect(ev).toMatchObject({ kind: "message", text: "[audio]", audioId: "MEDIA9" });
  });

  it("the transcript is what the AI reads", () => {
    expect(voiceContent("  جانتاکە بە چەندە؟ ")).toBe("[audio] جانتاکە بە چەندە؟");
    expect(typedText(voiceContent("بە چەندە؟"))).toBe("بە چەندە؟");
    expect(typedText("[audio]")).toBe("");
  });

  it("only Meta's own CDNs are fetched", () => {
    expect(metaMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")).toBe(true);
    expect(metaMediaUrl("https://scontent.xx.fbcdn.net/v/t42/voice.mp4")).toBe(true);
    expect(metaMediaUrl("https://evil.example.com/fbcdn.net")).toBe(false);
    expect(metaMediaUrl("http://scontent.xx.fbcdn.net/a")).toBe(false);
    expect(metaMediaUrl("not a url")).toBe(false);
  });

  it("engines are tried only when their key is set, Pawan first", () => {
    expect(sttOrder({ PAWAN_API_KEY: "p", GOOGLE_AI_API_KEY: "g" })).toEqual(["pawan-asr", "gemini", "whisper"]);
    expect(sttOrder({ PAWAN_API_KEY: "p", GOOGLE_AI_API_KEY: "g", KURDGG_API_KEY: "k" })).toEqual(["pawan-asr", "gemini3", "gemini", "whisper"]);
    expect(sttOrder({ GOOGLE_AI_API_KEY: "g" })).toEqual(["gemini"]);
    expect(sttOrder({ STT_ORDER: "gemini,pawan-asr", PAWAN_API_KEY: "p", GOOGLE_AI_API_KEY: "g" })).toEqual(["gemini", "pawan-asr"]);
    expect(sttOrder({})).toEqual([]);
  });

  it("labels models add are taken off", () => {
    expect(cleanTranscript('Transcript: "سڵاو"')).toBe("سڵاو");
    expect(cleanTranscript("  hello \n world ")).toBe("hello world");
  });

  it("a voice note is read only while automation is on, and up to the plan's daily number", () => {
    const base = { automationEnabled: true, pausedReason: null, plan: "FREE", todayCount: 1 };
    expect(voiceNoteAllowed(base)).toBe(true);
    expect(voiceNoteAllowed({ ...base, automationEnabled: false })).toBe(false);
    expect(voiceNoteAllowed({ ...base, pausedReason: "token_expired" })).toBe(false);
    expect(voiceNoteAllowed({ ...base, todayCount: 10 })).toBe(true);
    expect(voiceNoteAllowed({ ...base, todayCount: 11 })).toBe(false);
    expect(voiceNoteAllowed({ ...base, plan: "MERCHANT", todayCount: 100 })).toBe(true);
    expect(voiceNoteAllowed({ ...base, plan: "MERCHANT", todayCount: 101 })).toBe(false);
    expect(voiceNoteAllowed({ ...base, plan: "PRO", todayCount: 400 })).toBe(true);
    expect(voiceNoteAllowed({ ...base, plan: "SOMETHING_NEW", todayCount: 11 })).toBe(false);
  });

  it("engines share one time budget, so a hanging provider cannot hold the reply", () => {
    expect(attemptTimeout("pawan-asr", STT_BUDGET_MS)).toBe(10_000);
    expect(attemptTimeout("gemini3", STT_BUDGET_MS)).toBe(14_000);
    expect(attemptTimeout("gemini", 5_000)).toBe(5_000);
    expect(attemptTimeout("gemini", 2_999)).toBeNull();
    // Worst case: Pawan hangs (10 s) and Gemini 3 hangs (14 s): 4 s are left for Gemini 2.5.
    expect(attemptTimeout("gemini", STT_BUDGET_MS - 10_000 - 14_000)).toBe(4_000);
  });
});
