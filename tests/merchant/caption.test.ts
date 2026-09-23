import { describe, it, expect } from "vitest";
import { captionProblems, mergeHashtags, CITY_TAGS } from "@/lib/merchant/caption";

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
