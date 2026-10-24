import { describe, expect, it } from "vitest";

// The pure rules behind the owner's daily video plan and the story's screens: how a call of the chat's tool is merged onto the plan that is already
// saved, when the chat sets a story wide by itself, the address that makes a browser save the video, the time the writer may use inside the chat's
// function, and what a stored job says about its case. Nothing here reaches the database or the network.

import { hasPlanArgs, ideaLength, mergeDailyPlan, PLAN_IDEA_MAX } from "@/app/app/video/daily-plan";
import { downloadHref, prepareDeadline, subjectViewOf, wantsWide } from "@/app/app/video/story-form";
import { parseVideoAutoPlan, type VideoAutoPlan } from "@/lib/advideo/plan";

const SAVED: VideoAutoPlan = { brief: "old words", kind: "story", format: "wide", review: true, photos: false, targets: ["FB", "YT"], youtube: { privacy: "unlisted", madeForKids: true } };

describe("mergeDailyPlan", () => {
  it("starts a new plan literal, with the photographs on, vertical and kept as drafts: the owner's words exactly, trimmed, never cut", () => {
    const { raw, needs } = mergeDailyPlan({ idea: "  یەکێک لە چیرۆکە نهێنییەکان  " }, null, "story");
    expect(needs).toBeNull();
    expect(raw).toEqual({ brief: "یەکێک لە چیرۆکە نهێنییەکان", kind: "story", review: false, photos: true, targets: [] });
    expect(parseVideoAutoPlan(raw)).toEqual({ brief: "یەکێک لە چیرۆکە نهێنییەکان", kind: "story", review: false, photos: true, targets: [] });
    // The kind is the call's, else the saved plan's, else what the page is for.
    expect(mergeDailyPlan({ idea: "x" }, null, "ad").raw.kind).toBe("ad");
    expect(mergeDailyPlan({ idea: "x" }, SAVED, "ad").raw.kind).toBe("story");
    expect(mergeDailyPlan({ idea: "x", kind: "ad" }, SAVED, "story").raw.kind).toBe("ad");
  });

  it("keeps what the saved plan has and changes only what the call carries", () => {
    const { raw } = mergeDailyPlan({ idea: "new words" }, SAVED, "ad");
    expect(raw).toEqual({ brief: "new words", kind: "story", review: true, photos: false, targets: ["FB", "YT"], format: "wide", youtube: { privacy: "unlisted", madeForKids: true } });
    // An empty idea is "no idea of my own" and replaces the saved one; a call with no idea keeps it.
    expect(mergeDailyPlan({ idea: "" }, SAVED, "ad").raw.brief).toBe("");
    expect(mergeDailyPlan({ review: false }, SAVED, "ad").raw.brief).toBe("old words");
    expect(mergeDailyPlan({ publishTo: ["IG"] }, SAVED, "ad").raw).toMatchObject({ targets: ["IG"] });
    expect("youtube" in mergeDailyPlan({ publishTo: ["IG"] }, SAVED, "ad").raw).toBe(false);
  });

  it("makes a story wide only when asked and keeps the shape off an ad: an ad is always vertical", () => {
    expect(mergeDailyPlan({ kind: "story", format: "wide" }, null, "ad").raw).toMatchObject({ format: "wide" });
    expect("format" in mergeDailyPlan({ kind: "story", format: "vertical" }, SAVED, "ad").raw).toBe(false);
    expect("format" in mergeDailyPlan({ kind: "ad", format: "wide" }, null, "story").raw).toBe(false);
    expect("format" in mergeDailyPlan({ kind: "ad" }, SAVED, "story").raw).toBe(false);
  });

  it("never fills in the owner's YouTube answers: without both, it says what is missing", () => {
    expect(mergeDailyPlan({ publishTo: ["YT"] }, null, "story").needs).toBe("youtube");
    expect(mergeDailyPlan({ publishTo: ["YT"], youtubePrivacy: "public" }, null, "story").needs).toBe("youtube");
    expect(mergeDailyPlan({ publishTo: ["YT"], youtubeMadeForKids: false }, null, "story").needs).toBe("youtube");
    const ok = mergeDailyPlan({ publishTo: ["FB", "YT"], youtubePrivacy: "public", youtubeMadeForKids: false }, null, "story");
    expect(ok.needs).toBeNull();
    expect(ok.raw).toMatchObject({ targets: ["FB", "YT"], youtube: { privacy: "public", madeForKids: false } });
    // The saved answers count (a later call that only changes the idea does not ask again), but only while YouTube is in the plan.
    expect(mergeDailyPlan({ idea: "new" }, SAVED, "story").needs).toBeNull();
    expect(mergeDailyPlan({ publishTo: ["FB"] }, { ...SAVED, targets: ["FB"], youtube: undefined }, "story").needs).toBeNull();
    // Platforms are listed once.
    expect(mergeDailyPlan({ publishTo: ["FB", "FB", "IG"] }, null, "story").raw.targets).toEqual(["FB", "IG"]);
  });

  it("knows which calls carry a plan, and measures the idea in letters of any script", () => {
    expect(hasPlanArgs({ mode: "PUBLISH", hour: 8, language: "en" })).toBe(false);
    for (const k of ["idea", "kind", "format", "review", "photos", "publishTo", "youtubePrivacy", "youtubeMadeForKids"]) expect(hasPlanArgs({ [k]: k === "review" ? false : "x" }), k).toBe(true);
    expect(hasPlanArgs({ idea: "" })).toBe(true);
    expect(ideaLength("  " + "ڤ".repeat(600) + "  ")).toBe(600);
    expect(PLAN_IDEA_MAX).toBe(600);
  });
});

describe("wantsWide: the owner's words that make a story wide", () => {
  it("is true for YouTube, 16:9, wide, landscape and horizontal, in English, Arabic and Sorani", () => {
    for (const said of [
      "upload it to YouTube",
      "make it 16:9",
      "16 : 9 please",
      "a wide video",
      "landscape",
      "horizontal video",
      "يوتيوب",
      "للفيديو على اليوتيوب",
      "فيديو عريض",
      "فيديو أفقي",
      "یوتیوب",
      "ڤیدیۆیەک بۆ یوتیوب",
      "ڤیدیۆی پان",
    ]) {
      expect(wantsWide(said), said).toBe(true);
    }
  });

  it("is false for no word of the kind, for a longer word that only contains one, and when the owner asked for vertical", () => {
    for (const said of ["a mystery story please", "worldwide mysteries", "a widely known case", "ڤیدیۆیەکی کورت", "قصة غامضة"]) expect(wantsWide(said), said).toBe(false);
    for (const said of ["a vertical video for YouTube Shorts", "9:16 for reels, YouTube later", "make it for tiktok and youtube", "فيديو عمودي على يوتيوب", "ستوونی بۆ یوتیوب"]) expect(wantsWide(said), said).toBe(false);
  });
});

describe("downloadHref: the address that makes the browser save the file", () => {
  it("adds download=1 to a finished video's Blob address, and leaves every other address as it is", () => {
    expect(downloadHref("https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/video.mp4")).toBe("https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/video.mp4?download=1");
    expect(downloadHref("https://abc.public.blob.vercel-storage.com/v.mp4?x=1")).toBe("https://abc.public.blob.vercel-storage.com/v.mp4?x=1&download=1");
    expect(downloadHref("https://abc.public.blob.vercel-storage.com/v.mp4?download=1")).toBe("https://abc.public.blob.vercel-storage.com/v.mp4?download=1");
    expect(downloadHref("https://example.com/v.mp4")).toBe("https://example.com/v.mp4");
    expect(downloadHref("http://abc.public.blob.vercel-storage.com/v.mp4")).toBe("http://abc.public.blob.vercel-storage.com/v.mp4");
    expect(downloadHref("/local/v.mp4")).toBe("/local/v.mp4");
    expect(downloadHref("")).toBe("");
  });
});

describe("prepareDeadline: the writer stops in time inside the function that hosts it", () => {
  it("is 55 s from the start for the Video screen's own action", () => {
    expect(prepareDeadline(1_000)).toBe(56_000);
    expect(prepareDeadline(1_000, undefined)).toBe(56_000);
    expect(prepareDeadline(1_000, Number.NaN)).toBe(56_000);
  });

  it("is held to the chat's own deadline plus a short margin, and never past 57 s from the start of the function", () => {
    const fnStart = 10_000;
    const chatDeadline = fnStart + 50_000;
    // The action starts 20 s into the chat's turn: 55 s from now is past the function, so the chat's deadline plus 5 s counts (= 55 s from the start).
    expect(prepareDeadline(fnStart + 20_000, chatDeadline)).toBe(fnStart + 55_000);
    // Early in the turn, the action's own 55 s apply... but never past 57 s from the start of the function.
    expect(prepareDeadline(fnStart + 1_000, chatDeadline)).toBe(fnStart + 55_000);
    expect(prepareDeadline(fnStart, chatDeadline)).toBe(fnStart + 55_000);
    // A chat deadline that is earlier than that (a request with less time) is respected, plus the same short margin.
    expect(prepareDeadline(15_000, 40_000)).toBe(45_000);
    // The turn's length is a parameter, not a guess.
    expect(prepareDeadline(fnStart, fnStart + 40_000, 40_000)).toBe(fnStart + 45_000);
  });
});

describe("subjectViewOf: what a stored job says about its case", () => {
  it("gives the case, and a link to its article only when the article was really read", () => {
    const read = subjectViewOf({ subject: { name: "Hinterkaifeck murders", url: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders", chosen: true } });
    expect(read).toEqual({ subject: "Hinterkaifeck murders", subjectUrl: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders", chosen: true, fromMemory: false, recent: false, fiction: false });
    const memory = subjectViewOf({ subject: { name: "Mary Celeste", url: "https://en.wikipedia.org/wiki/Mary_Celeste", fromMemory: true } });
    expect(memory).toMatchObject({ subject: "Mary Celeste", subjectUrl: null, fromMemory: true });
    // Only an English Wikipedia article is ever linked.
    expect(subjectViewOf({ subject: { name: "X", url: "https://evil.example/wiki/X" } }).subjectUrl).toBeNull();
    expect(subjectViewOf({ subject: { name: "X", url: "javascript:alert(1)" } }).subjectUrl).toBeNull();
  });

  it("says a case is very recent, a fiction is a fiction, and reads nothing from a spec that is not one", () => {
    expect(subjectViewOf({ subject: { name: "Case", recent: true } }).recent).toBe(true);
    expect(subjectViewOf({ subject: { name: "A tale", kind: "fiction" } }).fiction).toBe(true);
    for (const junk of [null, undefined, 5, "x", [], {}, { subject: null }, { subject: { name: 5 } }, { subject: { name: "  " } }]) {
      expect(subjectViewOf(junk), JSON.stringify(junk)).toEqual({ subject: null, subjectUrl: null, chosen: false, fromMemory: false, recent: false, fiction: false });
    }
    // A flag with no case behind it says nothing.
    expect(subjectViewOf({ subject: { recent: true, fromMemory: true, chosen: true } })).toMatchObject({ subject: null, recent: false, fromMemory: false, chosen: false });
  });
});
