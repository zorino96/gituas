import { describe, it, expect } from "vitest";
import { captionProblems, isJpegPath, isKnownTarget, isOwnBlobUrl, isOwnPathname, mergeHashtags, youtubeProblem, youtubeTitle, CAPTION_LIMITS, CITY_TAGS, YT_VIDEO_ONLY, youtubeOptionProblems } from "@/lib/merchant/caption";

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

describe("isKnownTarget", () => {
  it("accepts exactly the platforms we publish to", () => {
    for (const t of ["FB", "IG", "TT", "YT"]) expect(isKnownTarget(t)).toBe(true);
  });
  it("rejects anything else, including Object.prototype names", () => {
    for (const t of ["", "fb", "X", "toString", "__proto__", "constructor", 1, null, undefined]) expect(isKnownTarget(t)).toBe(false);
  });
});

describe("isOwnBlobUrl", () => {
  const ok = "https://abc123.public.blob.vercel-storage.com/merchant/ws1/video.mp4";
  it("accepts a file in this workspace's folder on Vercel Blob", () => {
    expect(isOwnBlobUrl(ok, "ws1")).toBe(true);
  });
  it("rejects another workspace's folder", () => {
    expect(isOwnBlobUrl(ok, "ws2")).toBe(false);
    expect(isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/merchant/ws10/video.mp4", "ws1")).toBe(false);
  });
  it("rejects http, other hosts and look-alike hosts", () => {
    expect(isOwnBlobUrl(ok.replace("https:", "http:"), "ws1")).toBe(false);
    expect(isOwnBlobUrl("https://evil.example/merchant/ws1/video.mp4", "ws1")).toBe(false);
    expect(isOwnBlobUrl("https://x.public.blob.vercel-storage.com.evil.example/merchant/ws1/video.mp4", "ws1")).toBe(false);
    expect(isOwnBlobUrl("https://public.blob.vercel-storage.com/merchant/ws1/video.mp4", "ws1")).toBe(false);
    expect(isOwnBlobUrl("https://evil.example/x.public.blob.vercel-storage.com/merchant/ws1/a.mp4", "ws1")).toBe(false);
  });
  it("rejects a path that only reaches the folder by dot-segments and junk that is not a URL", () => {
    expect(isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/merchant/ws1/../ws2/a.mp4", "ws1")).toBe(false);
    expect(isOwnBlobUrl("not a url", "ws1")).toBe(false);
    expect(isOwnBlobUrl("", "ws1")).toBe(false);
  });
});

describe("youtubeOptionProblems", () => {
  const ok = { title: "Kirkuk news", description: "Today in Kirkuk", privacy: "unlisted" as const, madeForKids: false };

  it("accepts a title, a description and a chosen privacy", () => {
    expect(youtubeOptionProblems(ok)).toEqual([]);
    expect(youtubeOptionProblems({ ...ok, description: "" })).toEqual([]);
  });

  it("needs a title of at most 100 characters and a privacy the person chose", () => {
    expect(youtubeOptionProblems({ ...ok, title: "  " })).toEqual(["title"]);
    expect(youtubeOptionProblems({ ...ok, title: "ک".repeat(101) })).toEqual(["title"]);
    expect(youtubeOptionProblems({ ...ok, title: "ک".repeat(100) })).toEqual([]);
    expect(youtubeOptionProblems({ ...ok, privacy: null })).toEqual(["privacy"]);
  });

  it("rejects what YouTube refuses: angle brackets and descriptions over 5000 bytes", () => {
    expect(youtubeOptionProblems({ ...ok, title: "a <b>" })).toEqual(["brackets"]);
    expect(youtubeOptionProblems({ ...ok, description: "x".repeat(5001) })).toEqual(["description"]);
    // Kurdish letters are two bytes each: 2500 fit, 2501 do not.
    expect(youtubeOptionProblems({ ...ok, description: "ک".repeat(2500) })).toEqual([]);
    expect(youtubeOptionProblems({ ...ok, description: "ک".repeat(2501) })).toEqual(["description"]);
  });

  it("needs the person to say whether the video is made for kids, every time", () => {
    expect(youtubeOptionProblems({ ...ok, madeForKids: true })).toEqual([]);
    expect(youtubeOptionProblems({ ...ok, madeForKids: null })).toEqual(["audience"]);
  });
});

describe("isOwnPathname", () => {
  it("accepts a file in the workspace's own folder", () => {
    expect(isOwnPathname("merchant/w1/1712345678.mp4", "w1")).toBe(true);
    expect(isOwnPathname("merchant/w1/photos/a-x1Y.jpg", "w1")).toBe(true);
  });
  it("refuses anything that could reach another workspace's files once it is a URL", () => {
    for (const p of ["merchant/w2/a.mp4", "merchant/w1/../w2/a.mp4", "merchant/w1/%2e%2e/w2/a.mp4", "merchant/w1/%2E%2E/w2/a.mp4", "merchant/w1/..\w2/a.mp4", "merchant/w1//a.mp4", null]) {
      expect(isOwnPathname(p, "w1")).toBe(false);
    }
  });
});
