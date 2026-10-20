import { describe, expect, it } from "vitest";

import {
  channelAboutOf, defaultVoice, isRtl, isVideoKind, isVideoLang, kindForGoal, langAndKindOf, langFields, storyConceptOf, videoKindOf, videoLangOf, VIDEO_KINDS, VIDEO_LANGS, voiceFor,
} from "@/lib/advideo/lang";
import { PAWAN_VOICES } from "@/lib/voice/voices";

describe("the video language and kind", () => {
  it("knows the three languages and the two kinds", () => {
    expect(VIDEO_LANGS).toEqual(["ckb", "ar", "en"]);
    expect(VIDEO_KINDS).toEqual(["ad", "story"]);
    expect(isVideoLang("en")).toBe(true);
    expect(isVideoLang("ku")).toBe(false);
    expect(isVideoLang(null)).toBe(false);
    expect(isVideoKind("story")).toBe(true);
    expect(isVideoKind("reel")).toBe(false);
  });

  it("reads anything invalid as Sorani and as an ad", () => {
    for (const bad of [undefined, null, "", "EN", "kmr", 3, {}]) {
      expect(videoLangOf(bad)).toBe("ckb");
      expect(videoKindOf(bad)).toBe("ad");
    }
    expect(videoLangOf("ar")).toBe("ar");
    expect(videoKindOf("story")).toBe("story");
  });

  it("writes Sorani and Arabic from right to left and English from left to right", () => {
    expect(isRtl("ckb")).toBe(true);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });

  it("makes stories for the pages that earn from their content and ads for the rest", () => {
    expect(kindForGoal("monetize")).toBe("story");
    expect(kindForGoal("grow")).toBe("story");
    for (const g of ["sell", "leads", "other", "", null, undefined, "nonsense"]) expect(kindForGoal(g)).toBe("ad");
  });
});

describe("the voice of a video", () => {
  it("defaults to Shilan in Sorani and to Gemini's two voices otherwise", () => {
    expect(defaultVoice("ckb")).toBe("shilan");
    expect(defaultVoice("ckb", "story")).toBe("shilan");
    expect(defaultVoice("ar")).toBe("female");
    expect(defaultVoice("en")).toBe("female");
    expect(defaultVoice("en", "story")).toBe("male");
    expect(defaultVoice("ar", "story")).toBe("male");
  });

  it("keeps a Pawan voice for Sorani and replaces anything else", () => {
    for (const v of PAWAN_VOICES) expect(voiceFor("ckb", v)).toBe(v);
    expect(voiceFor("ckb", "Charon")).toBe("shilan");
    expect(voiceFor("ckb", undefined)).toBe("shilan");
    expect(voiceFor("ckb", 7, "story")).toBe("shilan");
  });

  it("keeps only male or female for Arabic and English", () => {
    expect(voiceFor("en", "male")).toBe("male");
    expect(voiceFor("ar", "female", "story")).toBe("female");
    // A Pawan name means nothing to Gemini and no gender is guessed from it.
    expect(voiceFor("en", "shilan")).toBe("female");
    expect(voiceFor("en", "shilan", "story")).toBe("male");
    expect(voiceFor("ar", null)).toBe("female");
  });
});

describe("what a stored video says about itself", () => {
  it("reads the language and kind of a spec or of render props, and defaults for anything missing", () => {
    expect(langAndKindOf({ lang: "en", kind: "story", scenes: [] })).toEqual({ lang: "en", kind: "story" });
    expect(langAndKindOf({ lang: "ar" })).toEqual({ lang: "ar", kind: "ad" });
    expect(langAndKindOf({})).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf(null)).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf("x")).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf({ lang: "xx", kind: 4 })).toEqual({ lang: "ckb", kind: "ad" });
  });

  it("writes only the values that are not the default, so a Sorani ad stores nothing", () => {
    expect(langFields("ckb", "ad")).toEqual({});
    expect(Object.keys(langFields("ckb", "ad"))).toHaveLength(0);
    expect(langFields("en", "ad")).toEqual({ lang: "en" });
    expect(langFields("ckb", "story")).toEqual({ kind: "story" });
    expect(langFields("ar", "story")).toEqual({ lang: "ar", kind: "story" });
    // What is written is read back as the same choice.
    expect(langAndKindOf(langFields("en", "story"))).toEqual({ lang: "en", kind: "story" });
  });
});

describe("what a channel is about", () => {
  it("joins the offer line, the goal in words and the category", () => {
    expect(channelAboutOf({ offerLine: "Mystery stories", goalText: "grow a story channel", category: "content" })).toBe("Mystery stories — grow a story channel — category: content");
    expect(channelAboutOf({ offerLine: null, goalText: "  stories  ", category: null })).toBe("stories");
  });

  it("says nothing when the profile holds no concept (a category of other is none)", () => {
    expect(channelAboutOf(null)).toBeNull();
    expect(channelAboutOf(undefined)).toBeNull();
    expect(channelAboutOf({ offerLine: null, goalText: "", category: null })).toBeNull();
    expect(channelAboutOf({ offerLine: null, goalText: null, category: "other" })).toBeNull();
  });

  it("is cut to a sensible length", () => {
    expect(Array.from(channelAboutOf({ goalText: "x".repeat(900) })!)).toHaveLength(500);
  });
});

describe("the concept a daily story follows", () => {
  it("is what the owner wrote: the offer line and the goal in words, never the category", () => {
    expect(storyConceptOf({ offerLine: "Mystery stories", goalText: "grow a story channel" })).toBe("Mystery stories — grow a story channel");
    expect(storyConceptOf({ offerLine: null, goalText: "  stories  " })).toBe("stories");
    expect(storyConceptOf({ offerLine: "True crime", goalText: null, category: "content" } as never)).toBe("True crime");
  });

  it("is none for a bare category, an empty profile or no profile", () => {
    expect(storyConceptOf(null)).toBeNull();
    expect(storyConceptOf(undefined)).toBeNull();
    expect(storyConceptOf({ offerLine: "  ", goalText: "" })).toBeNull();
    expect(storyConceptOf({ offerLine: null, goalText: null, category: "content" } as never)).toBeNull();
  });

  it("is cut to a sensible length", () => {
    expect(Array.from(storyConceptOf({ goalText: "x".repeat(900) })!)).toHaveLength(500);
  });
});
