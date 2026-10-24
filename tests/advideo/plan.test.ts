import { describe, expect, it } from "vitest";

// The daily routine's plan: the owner's own words and choices, stored on the store and read back tolerantly.
import { parseVideoAutoPlan, planBrief, planLine, PLAN_BRIEF_MAX, type VideoAutoPlan } from "@/lib/advideo/plan";

const full = {
  brief: "one of the historical mystery stories, crime genre",
  kind: "story",
  format: "wide",
  review: false,
  photos: true,
  targets: ["FB", "IG", "YT"],
  youtube: { privacy: "unlisted", madeForKids: false },
};

describe("reading a stored plan", () => {
  it("keeps a complete plan as it is, with the platforms in a fixed order", () => {
    expect(parseVideoAutoPlan(full)).toEqual({
      brief: "one of the historical mystery stories, crime genre",
      kind: "story",
      format: "wide",
      review: false,
      photos: true,
      targets: ["FB", "IG", "YT"],
      youtube: { privacy: "unlisted", madeForKids: false },
    });
    expect(parseVideoAutoPlan({ ...full, targets: ["YT", "FB", "FB"] })?.targets).toEqual(["FB", "YT"]);
  });

  it("is null for anything that is not a plan", () => {
    for (const junk of [null, undefined, 0, 5, true, "", "not json", [], [full], {}, { kind: "podcast" }, { kind: 1 }, { brief: "x" }]) {
      expect(parseVideoAutoPlan(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it("reads a plan that was stored as JSON text", () => {
    expect(parseVideoAutoPlan(JSON.stringify(full))?.kind).toBe("story");
    expect(parseVideoAutoPlan("[1,2]")).toBeNull();
  });

  it("keeps the owner's words verbatim, trimmed, cut at 600 characters, and may leave them empty", () => {
    const words = "  Make it about the Titanic.\nNo music, please.  ";
    expect(parseVideoAutoPlan({ ...full, brief: words })?.brief).toBe("Make it about the Titanic.\nNo music, please.");
    expect(parseVideoAutoPlan({ ...full, brief: "x".repeat(900) })?.brief).toHaveLength(PLAN_BRIEF_MAX);
    // (cut by characters, so a Sorani letter is never split)
    const sorani = "چیرۆکێک ".repeat(200);
    expect(Array.from(parseVideoAutoPlan({ ...full, brief: sorani })!.brief)).toHaveLength(PLAN_BRIEF_MAX - 1);
    for (const brief of ["", "   ", undefined, null, 5]) expect(parseVideoAutoPlan({ ...full, brief })?.brief, String(brief)).toBe("");
    expect(planBrief("a\u0000b\u0007c")).toBe("abc");
  });

  it("uses the owner's words literally unless he asked for the review: no review is the default", () => {
    expect(parseVideoAutoPlan({ ...full, review: undefined })?.review).toBe(false);
    expect(parseVideoAutoPlan({ ...full, review: "true" })?.review).toBe(false);
    expect(parseVideoAutoPlan({ ...full, review: true })?.review).toBe(true);
  });

  it("looks for photographs unless he switched them off", () => {
    expect(parseVideoAutoPlan({ ...full, photos: undefined })?.photos).toBe(true);
    expect(parseVideoAutoPlan({ ...full, photos: false })?.photos).toBe(false);
  });

  it("is wide only for a story: an ad is always vertical, and any other shape is dropped", () => {
    expect(parseVideoAutoPlan({ ...full, kind: "ad" })).not.toHaveProperty("format");
    expect(parseVideoAutoPlan({ ...full, format: "vertical" })).not.toHaveProperty("format");
    expect(parseVideoAutoPlan({ ...full, format: "square" })).not.toHaveProperty("format");
  });

  it("drops platforms that are not Facebook, Instagram or YouTube", () => {
    expect(parseVideoAutoPlan({ ...full, targets: ["FB", "TT", 5, null, "ig", "IG"] })?.targets).toEqual(["FB", "IG"]);
    expect(parseVideoAutoPlan({ ...full, targets: "FB" })?.targets).toEqual([]);
    expect(parseVideoAutoPlan({ ...full, targets: undefined })?.targets).toEqual([]);
  });

  it("never guesses YouTube's declarations: without both of them YouTube is not in the plan", () => {
    for (const youtube of [undefined, null, {}, { privacy: "public" }, { madeForKids: true }, { privacy: "secret", madeForKids: false }, { privacy: "public", madeForKids: "no" }, "private"]) {
      const plan = parseVideoAutoPlan({ ...full, youtube })!;
      expect(plan.targets, JSON.stringify(youtube)).toEqual(["FB", "IG"]);
      expect(plan).not.toHaveProperty("youtube");
    }
    for (const privacy of ["public", "unlisted", "private"]) {
      expect(parseVideoAutoPlan({ ...full, youtube: { privacy, madeForKids: true } })?.youtube).toEqual({ privacy, madeForKids: true });
    }
  });

  it("leaves the declarations out when YouTube is not wanted", () => {
    const plan = parseVideoAutoPlan({ ...full, targets: ["FB"] })!;
    expect(plan.targets).toEqual(["FB"]);
    expect(plan).not.toHaveProperty("youtube");
  });
});

describe("one plain line for a card or a screen", () => {
  const plan = parseVideoAutoPlan(full) as VideoAutoPlan;

  it("says the kind, the shape, the idea in his words, how the words are used and where the video goes, in the three languages", () => {
    expect(planLine(plan, "en")).toBe(
      "Story video, wide (16:9): “one of the historical mystery stories, crime genre”; uses exactly your words; Facebook, Instagram, YouTube",
    );
    const ar = planLine(plan, "ar");
    expect(ar).toContain("فيديو قصة");
    expect(ar).toContain("يوتيوب");
    expect(ar).toContain("one of the historical mystery stories, crime genre");
    const ckb = planLine(plan, "ckb");
    expect(ckb).toContain("ڤیدیۆی چیرۆک");
    expect(ckb).toContain("یوتیوب");
    expect(ckb).toContain("ڕێک بە وشەکانی خۆت");
    // Sorani letters only around his words (the idea itself is his).
    expect(ckb.replace("one of the historical mystery stories, crime genre", "")).not.toMatch(/[A-Za-z]/);
  });

  it("says when the page is read first, when the video is only kept as a draft, and when there are no words of his own", () => {
    const draft = parseVideoAutoPlan({ ...full, review: true, targets: [], brief: "", kind: "ad", format: undefined, youtube: undefined })!;
    expect(planLine(draft, "en")).toBe("Ad video, vertical: the usual; Gituas reads your page first; kept as a draft for you to read");
    expect(planLine(draft, "ckb")).toContain("وەک ڕەشنووس دەمێنێتەوە");
  });

  it("joins two platforms with 'and' and cuts a long idea to one line", () => {
    const two = parseVideoAutoPlan({ ...full, targets: ["FB", "IG"], youtube: undefined })!;
    expect(planLine(two, "en")).toContain("Facebook and Instagram");
    const long = parseVideoAutoPlan({ ...full, brief: `a\n${"very long idea ".repeat(30)}` })!;
    const line = planLine(long, "en");
    expect(line).not.toContain("\n");
    expect(line).toContain("…");
  });
});
