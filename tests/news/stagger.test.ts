import { describe, expect, it } from "vitest";

import { isStaggered, splitForStagger, STAGGER_GAP_MIN } from "@/lib/news/stagger";

describe("splitForStagger", () => {
  it("sends the first account of each platform now and the others a gap apart", () => {
    const { now, later } = splitForStagger({ FB: ["a", "b", "c"], IG: ["x", "y"] });
    expect(now).toEqual({ FB: ["a"], IG: ["x"] });
    expect(later).toEqual([
      { target: "FB", accountId: "b", afterMin: STAGGER_GAP_MIN },
      { target: "FB", accountId: "c", afterMin: STAGGER_GAP_MIN * 2 },
      { target: "IG", accountId: "y", afterMin: STAGGER_GAP_MIN },
    ]);
  });

  it("leaves a single account alone: nothing later", () => {
    expect(splitForStagger({ FB: ["a"] })).toEqual({ now: { FB: ["a"] }, later: [] });
  });

  it("uses the gap it is given", () => {
    expect(splitForStagger({ FB: ["a", "b"] }, 12).later).toEqual([{ target: "FB", accountId: "b", afterMin: 12 }]);
  });

  it("has nothing to split when no account list was chosen (the publisher's default Page)", () => {
    expect(splitForStagger(undefined)).toEqual({ now: undefined, later: [] });
    expect(splitForStagger({})).toEqual({ now: undefined, later: [] });
    expect(splitForStagger({ FB: [] })).toEqual({ now: undefined, later: [] });
  });

  it("keeps a platform that has none out of the immediate post", () => {
    expect(splitForStagger({ FB: [], IG: ["x", "y"] })).toEqual({
      now: { IG: ["x"] },
      later: [{ target: "IG", accountId: "y", afterMin: STAGGER_GAP_MIN }],
    });
  });

  it("does not change the list it was given", () => {
    const given = { FB: ["a", "b"] };
    splitForStagger(given);
    expect(given).toEqual({ FB: ["a", "b"] });
  });
});

describe("isStaggered", () => {
  it("is true only for a stored post marked as the later part of a story", () => {
    expect(isStaggered({ caption: "x", stagger: true })).toBe(true);
    expect(isStaggered({ caption: "x", stagger: false })).toBe(false);
    expect(isStaggered({ caption: "x", stagger: "true" })).toBe(false);
    expect(isStaggered({ caption: "x" })).toBe(false);
    expect(isStaggered(null)).toBe(false);
    expect(isStaggered("stagger")).toBe(false);
    expect(isStaggered(undefined)).toBe(false);
  });
});
