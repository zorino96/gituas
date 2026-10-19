import { describe, expect, it } from "vitest";

import { baghdadClock, inCoachWindow, isoWeekKey, weekWindows } from "@/lib/coach/week";

/** A Baghdad wall-clock time as an instant (Baghdad is UTC+3 all year). */
const baghdad = (iso: string): number => Date.parse(`${iso}+03:00`);

describe("the Baghdad ISO week", () => {
  it("names the week like 2026-W43", () => {
    expect(isoWeekKey(baghdad("2026-10-19T12:00:00"))).toBe("2026-W43"); // a Monday
    expect(isoWeekKey(baghdad("2026-10-25T10:00:00"))).toBe("2026-W43"); // the Sunday that ends it
    expect(isoWeekKey(baghdad("2026-10-26T00:00:00"))).toBe("2026-W44");
  });

  it("changes at midnight in Baghdad, not in UTC", () => {
    // 23:59 Sunday in Baghdad is 20:59 UTC; one minute later it is Monday in Baghdad.
    expect(isoWeekKey(baghdad("2026-10-25T23:59:00"))).toBe("2026-W43");
    expect(isoWeekKey(baghdad("2026-10-26T00:00:00"))).toBe("2026-W44");
    // 02:00 Monday in Baghdad is still Sunday in UTC.
    expect(isoWeekKey(Date.parse("2026-10-25T23:00:00Z"))).toBe("2026-W44");
  });

  it("puts the first days of January in the last week of the year before when their Thursday is there", () => {
    expect(isoWeekKey(baghdad("2027-01-03T10:00:00"))).toBe("2026-W53");
    expect(isoWeekKey(baghdad("2027-01-04T10:00:00"))).toBe("2027-W01");
    expect(isoWeekKey(baghdad("2026-12-31T10:00:00"))).toBe("2026-W53");
    expect(isoWeekKey(baghdad("2026-01-01T10:00:00"))).toBe("2026-W01");
  });

  it("pads the week to two digits", () => {
    expect(isoWeekKey(baghdad("2026-01-07T10:00:00"))).toBe("2026-W02");
  });

  it("reads the wall clock of Baghdad", () => {
    const c = baghdadClock(Date.parse("2026-10-25T06:30:00Z"));
    expect(c).toEqual({ year: 2026, month: 10, day: 25, weekday: 0, hour: 9, minute: 30 });
  });
});

describe("the Sunday-morning window", () => {
  it("is open from 09:00 up to 12:00 on a Sunday in Baghdad", () => {
    expect(inCoachWindow(baghdad("2026-10-25T09:00:00"))).toBe(true);
    expect(inCoachWindow(baghdad("2026-10-25T11:59:59"))).toBe(true);
    expect(inCoachWindow(baghdad("2026-10-25T12:00:00"))).toBe(false);
    expect(inCoachWindow(baghdad("2026-10-25T08:59:59"))).toBe(false);
  });

  it("is closed on every other day, at the same hours", () => {
    for (const day of ["2026-10-24", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) {
      expect(inCoachWindow(baghdad(`${day}T10:00:00`)), day).toBe(false);
    }
  });

  it("follows Baghdad time, not UTC", () => {
    // 06:00 UTC on Sunday is 09:00 in Baghdad: open. 09:00 UTC is 12:00 in Baghdad: closed.
    expect(inCoachWindow(Date.parse("2026-10-25T06:00:00Z"))).toBe(true);
    expect(inCoachWindow(Date.parse("2026-10-25T09:00:00Z"))).toBe(false);
    // 08:00 Sunday in UTC is 11:00 in Baghdad: open even though a UTC clock would say 08:00.
    expect(inCoachWindow(Date.parse("2026-10-25T08:00:00Z"))).toBe(true);
  });
});

describe("the two windows of numbers", () => {
  it("is the last 7 days and the 7 before them", () => {
    const now = baghdad("2026-10-25T10:00:00");
    const w = weekWindows(now);
    expect(w.now - w.thisStart).toBe(7 * 86_400_000);
    expect(w.thisStart - w.beforeStart).toBe(7 * 86_400_000);
  });
});
