import { describe, expect, it } from "vitest";

import { cleanCloneSeconds, cleanCloneText, cloneExt, clonePaths } from "@/lib/voice/clone";
import { CUSTOM_VOICE, deskVoice } from "@/lib/voice/voices";

describe("the desk's own voice", () => {
  it("is only for ENTERPRISE; other values fall back to a ready-made voice", () => {
    expect(deskVoice(CUSTOM_VOICE, "ENTERPRISE")).toBe(CUSTOM_VOICE);
    expect(deskVoice(CUSTOM_VOICE, "AUTO")).toBe("male");
    expect(deskVoice("shilan", "MANUAL")).toBe("shilan");
    expect(deskVoice("nobody", "ENTERPRISE")).toBe("male");
  });

  it("keeps the recording at a path that cannot be guessed from the desk id", () => {
    const a = clonePaths("cmdesk1", "secret-one");
    const b = clonePaths("cmdesk1", "secret-two");
    expect(a.meta).toMatch(/^merchant\/cmdesk1\/voice-clone\/[0-9a-f]{24}\.json$/);
    expect(a.ref("wav")).toMatch(/^merchant\/cmdesk1\/voice-clone\/[0-9a-f]{24}-ref\.wav$/);
    expect(a.meta).not.toBe(b.meta);
    expect(clonePaths("cmdesk1", "secret-one").meta).toBe(a.meta);
  });

  it("accepts a short recording with its words", () => {
    expect(cleanCloneSeconds(8.876)).toBe(8.88);
    expect(cleanCloneSeconds(2)).toBeNull();
    expect(cleanCloneSeconds(45)).toBeNull();
    expect(cleanCloneSeconds("x")).toBeNull();
    expect(cleanCloneText("  ئەمڕۆ  ڕۆژێکی جوانە \n")).toBe("ئەمڕۆ ڕۆژێکی جوانە");
    expect(cleanCloneText("")).toBeNull();
    expect(cleanCloneText("a".repeat(401))).toBeNull();
  });

  it("knows the audio types Pawan takes", () => {
    expect(cloneExt("audio/wav")).toBe("wav");
    expect(cloneExt("audio/mpeg")).toBe("mp3");
    expect(cloneExt("audio/x-m4a")).toBe("m4a");
    expect(cloneExt("video/mp4")).toBe("m4a");
    expect(cloneExt("image/png")).toBeNull();
  });
});
