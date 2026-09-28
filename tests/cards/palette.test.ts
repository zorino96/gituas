import { describe, expect, it } from "vitest";
import { dominantColors, readableOn, toHex } from "@/lib/cards/palette";

/** A fake RGBA image: `count` pixels of each colour, in order. */
function image(parts: Array<{ rgba: [number, number, number, number]; count: number }>): Uint8ClampedArray {
  const px = parts.flatMap((p) => Array.from({ length: p.count }, () => p.rgba));
  return new Uint8ClampedArray(px.flat());
}

describe("toHex", () => {
  it("writes #rrggbb", () => {
    expect(toHex(11, 37, 69)).toBe("#0b2545");
    expect(toHex(255, 255, 255)).toBe("#ffffff");
  });
});

describe("dominantColors", () => {
  it("lists the main colours, most common first", () => {
    const img = image([
      { rgba: [208, 0, 0, 255], count: 70 },
      { rgba: [0, 40, 200, 255], count: 30 },
    ]);
    expect(dominantColors(img)).toEqual(["#d00000", "#0028c8"]);
  });
  it("skips see-through pixels (a logo's transparent background)", () => {
    const img = image([
      { rgba: [255, 255, 255, 0], count: 90 },
      { rgba: [224, 165, 38, 255], count: 10 },
    ]);
    expect(dominantColors(img)).toEqual(["#e0a526"]);
  });
  it("merges near-identical shades instead of listing both", () => {
    const img = image([
      { rgba: [10, 40, 200, 255], count: 50 },
      { rgba: [14, 44, 206, 255], count: 40 },
      { rgba: [240, 240, 240, 255], count: 10 },
    ]);
    const out = dominantColors(img);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe("#f0f0f0");
  });
  it("returns at most `count` colours", () => {
    const img = image(
      Array.from({ length: 10 }, (_, i) => ({ rgba: [i * 25, 255 - i * 25, (i * 60) % 256, 255] as [number, number, number, number], count: 5 })),
    );
    expect(dominantColors(img, 4).length).toBeLessThanOrEqual(4);
  });
});

describe("readableOn", () => {
  it("picks white on dark and near-black on light backgrounds", () => {
    expect(readableOn("#0b2545")).toBe("#ffffff");
    expect(readableOn("#ffe000")).toBe("#111111");
  });
});
