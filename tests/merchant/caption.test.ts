import { describe, it, expect } from "vitest";
import { captionProblems, isJpegPath, mergeHashtags, youtubeProblem, youtubeTitle, CAPTION_LIMITS, CITY_TAGS, YT_VIDEO_ONLY } from "@/lib/merchant/caption";

describe("captionProblems", () => {
  it("passes a normal caption everywhere", () => {
    expect(captionProblems("جلی نوێ", ["FB", "IG", "TT"])).toEqual([]);
  });
  it("flags Instagram and TikTok over 2200 characters but not Facebook", () => {
    const long = "ا".repeat(2201);
    expect(captionProblems(long, ["FB", "IG", "TT"]).map((p) => p.target)).toEqual(["IG", "TT"]);
  });
  it("flags more than 30 hashtags on Instagram", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(captionProblems(tags, ["IG"])).toEqual([{ target: "IG", problem: "hashtags" }]);
  });
});

describe("YouTube", () => {
  it("allows a description up to 5000 characters and flags more", () => {
    expect(CAPTION_LIMITS.YT).toBe(5000);
    expect(captionProblems("ا".repeat(5000), ["YT"])).toEqual([]);
    expect(captionProblems("ا".repeat(5001), ["YT"])).toEqual([{ target: "YT", problem: "length" }]);
  });
  it("takes a video and nothing else", () => {
    expect(youtubeProblem(["YT"], { type: "VIDEO" })).toBeNull();
    expect(youtubeProblem(["YT"], { type: "IMAGE" })).toBe("یوتیوب تەنها ڤیدیۆ وەردەگرێت.");
    expect(youtubeProblem(["YT"], undefined)).toBe(YT_VIDEO_ONLY);
  });
  it("ignores a post that is not going to YouTube", () => {
    expect(youtubeProblem(["FB", "IG"], { type: "IMAGE" })).toBeNull();
    expect(youtubeProblem(["FB"], undefined)).toBeNull();
  });
  it("titles the video with the caption's first line", () => {
    expect(youtubeTitle("جلی نوێ\nنرخ: ١٠ هەزار")).toBe("جلی نوێ");
    expect(youtubeTitle("\n  \r\nسەرەتا\r\nدووەم")).toBe("سەرەتا");
  });
  it("cuts the title to 100 characters, not UTF-16 units", () => {
    expect(Array.from(youtubeTitle("ا".repeat(150)))).toHaveLength(100);
    expect(Array.from(youtubeTitle("😀".repeat(150)))).toHaveLength(100);
  });
  it("falls back to the word for video when the caption is empty", () => {
    expect(youtubeTitle("")).toBe("ڤیدیۆ");
    expect(youtubeTitle("   \n  ")).toBe("ڤیدیۆ");
  });
});

describe("isJpegPath", () => {
  it("accepts .jpg and .jpeg, any case", () => {
    expect(isJpegPath("merchant/x/card.jpg")).toBe(true);
    expect(isJpegPath("merchant/x/card.jpeg")).toBe(true);
    expect(isJpegPath("merchant/x/card.JPG")).toBe(true);
    expect(isJpegPath("merchant/x/card.JPEG")).toBe(true);
  });
  it("rejects PNG, WebP and extension-less paths", () => {
    expect(isJpegPath("merchant/x/card.png")).toBe(false);
    expect(isJpegPath("merchant/x/card.webp")).toBe(false);
    expect(isJpegPath("merchant/x/card")).toBe(false);
  });
});

describe("mergeHashtags", () => {
  it("appends tags that are missing, once", () => {
    expect(mergeHashtags("جلی نوێ #جلی_کوردی", ["#جلی_کوردی", "#hawler"])).toBe("جلی نوێ #جلی_کوردی\n\n#hawler");
  });
  it("leaves the caption alone when every tag is present", () => {
    expect(mergeHashtags("x #a #b", ["#a", "#b"])).toBe("x #a #b");
  });
  it("ships the dual-script multi-city tags", () => {
    expect(CITY_TAGS).toContain("#کوردستان_هەولێر_سلێمانی");
    expect(CITY_TAGS).toContain("#hawler_slemani_dhok_karkuk_hallabja");
  });
});
