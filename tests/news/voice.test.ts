import { describe, expect, it } from "vitest";

import { cleanVoiceNote, sameStoryTooClose, VOICE_NOTE_MAX, voiceFor } from "@/lib/news/voice";

describe("voiceFor", () => {
  it("gives the same desk the same voice every time", () => {
    expect(voiceFor("tenant-abc")).toBe(voiceFor("tenant-abc"));
  });

  it("is a short English house-style paragraph", () => {
    const v = voiceFor("tenant-abc");
    expect(v.startsWith("House style for this outlet: ")).toBe(true);
    expect(v.length).toBeLessThan(240);
    expect(v).toMatch(/start the body with/);
    expect(v).toMatch(/headline/);
    expect(v).toMatch(/sentence/);
  });

  it("gives at least 3 distinct voices across 12 desks", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `cmf0desk${i}x9k2`);
    expect(new Set(ids.map(voiceFor)).size).toBeGreaterThanOrEqual(3);
  });
});

describe("cleanVoiceNote", () => {
  it("is null for nothing", () => {
    expect(cleanVoiceNote(null)).toBeNull();
    expect(cleanVoiceNote(undefined)).toBeNull();
    expect(cleanVoiceNote("  \n ")).toBeNull();
  });
  it("puts the note on one line", () => {
    expect(cleanVoiceNote(" ڕستەی کورت\n\nبێ وشەی بیانی ")).toBe("ڕستەی کورت بێ وشەی بیانی");
  });
  it("cuts the note to 300 characters", () => {
    expect([...cleanVoiceNote("ڕ".repeat(500))!]).toHaveLength(VOICE_NOTE_MAX);
  });
});

describe("sameStoryTooClose", () => {
  const ours = {
    headline: "حکومەتی هەرێم مووچەی مانگی ئەیلوول دابەش دەکات",
    body: "وەزارەتی دارایی ڕایگەیاند کە لە سبەینێوە مووچەی فەرمانبەران دابەش دەکرێت. دابەشکردنەکە سێ ڕۆژ دەخایەنێت.",
  };

  it("finds identical drafts too close", () => {
    expect(sameStoryTooClose(ours, { ...ours })).toBe(true);
  });

  it("finds a draft with one word changed too close, whichever side is longer", () => {
    const theirs = { headline: ours.headline, body: `${ours.body} ئەمە هەواڵێکی نوێیە بۆ هەموو فەرمانبەران لە هەرێمی کوردستان.` };
    expect(sameStoryTooClose(ours, theirs)).toBe(true);
    expect(sameStoryTooClose(theirs, ours)).toBe(true);
  });

  it("lets clearly different drafts through", () => {
    const theirs = {
      headline: "دابەشکردنی مووچە: سبەینێ دەست پێدەکات",
      body: "فەرمانبەرانی هەرێمی کوردستان لە ماوەی سێ ڕۆژدا مووچەکانیان وەردەگرن، بەپێی ڕاگەیەندراوێکی دارایی.",
    };
    expect(sameStoryTooClose(ours, theirs)).toBe(false);
  });
});
