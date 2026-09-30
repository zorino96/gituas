import { describe, it, expect } from "vitest";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";

const now = new Date("2026-10-01T12:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60_000;
const DAY = 86_400_000;

describe("scheduleProblem", () => {
  it("accepts a time a few hours away", () => expect(scheduleProblem(["FB", "IG"], at(3 * 60 * MIN), now)).toBeNull());
  it("never schedules TikTok, whatever the time", () =>
    expect(scheduleProblem(["FB", "TT"], at(DAY), now)).toBe("بۆ تیکتۆک خشتەکردن نییە — ڕاستەوخۆ بڵاوی بکەرەوە."));
  it("rejects less than ten minutes ahead", () =>
    expect(scheduleProblem(["FB"], at(10 * MIN - 1), now)).toBe("کاتەکە دەبێت لانیکەم ١٠ خولەک دوای ئێستا بێت."));
  it("accepts exactly ten minutes ahead", () => expect(scheduleProblem(["FB"], at(10 * MIN), now)).toBeNull());
  it("rejects a time in the past", () => expect(scheduleProblem(["FB"], at(-MIN), now)).toBe("کاتەکە دەبێت لانیکەم ١٠ خولەک دوای ئێستا بێت."));
  it("accepts exactly sixty days ahead", () => expect(scheduleProblem(["FB"], at(60 * DAY), now)).toBeNull());
  it("rejects more than sixty days ahead", () =>
    expect(scheduleProblem(["FB"], at(60 * DAY + 1), now)).toBe("کاتەکە دەبێت لە ماوەی ٦٠ ڕۆژدا بێت."));
  it("rejects an invalid date", () => expect(scheduleProblem(["FB"], new Date(NaN), now)).toBe("کاتەکە دروست نییە."));
});

describe("baghdadLocalToUtc", () => {
  it("reads the input as UTC+3", () => expect(baghdadLocalToUtc("2026-10-01T15:30").toISOString()).toBe("2026-10-01T12:30:00.000Z"));
  it("crosses midnight backwards", () => expect(baghdadLocalToUtc("2026-10-01T01:00").toISOString()).toBe("2026-09-30T22:00:00.000Z"));
  it("crosses the year backwards", () => expect(baghdadLocalToUtc("2027-01-01T02:15").toISOString()).toBe("2026-12-31T23:15:00.000Z"));
  it("handles a leap day", () => expect(baghdadLocalToUtc("2028-02-29T12:00").toISOString()).toBe("2028-02-29T09:00:00.000Z"));
  it("gives an invalid date for malformed input", () => {
    expect(Number.isNaN(baghdadLocalToUtc("").getTime())).toBe(true);
    expect(Number.isNaN(baghdadLocalToUtc("2026-10-01 15:30").getTime())).toBe(true);
    expect(Number.isNaN(baghdadLocalToUtc("2026-10-01T15:30:00").getTime())).toBe(true);
  });
  it("gives an invalid date for an impossible one", () => {
    expect(Number.isNaN(baghdadLocalToUtc("2026-02-31T10:00").getTime())).toBe(true);
    expect(Number.isNaN(baghdadLocalToUtc("2026-13-01T10:00").getTime())).toBe(true);
    expect(Number.isNaN(baghdadLocalToUtc("2026-10-01T25:00").getTime())).toBe(true);
  });
});
