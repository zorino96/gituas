import { describe, expect, it } from "vitest";
import { newsroomAccess, TRIAL_DAYS, trialEndsAtFrom } from "@/lib/billing/trial";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const news = (over: Partial<{ kind: string; plan: string; planPaidUntil: Date | null; trialEndsAt: Date | null }> = {}) => ({
  kind: "NEWS",
  plan: "MANUAL",
  planPaidUntil: null,
  trialEndsAt: null,
  ...over,
});

describe("newsroomAccess", () => {
  it("is 14 days", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("never freezes a workspace that is not a newsroom", () => {
    expect(newsroomAccess(news({ kind: "MERCHANT", trialEndsAt: at(-DAY) }), NOW)).toEqual({ active: true, reason: "paid", daysLeft: null });
  });

  it("is active and paid while the paid plan is running, even after the trial ended", () => {
    expect(newsroomAccess(news({ planPaidUntil: at(DAY), trialEndsAt: at(-DAY) }), NOW)).toEqual({ active: true, reason: "paid", daysLeft: null });
  });

  it("is frozen when a paid plan lapsed and there never was a trial", () => {
    expect(newsroomAccess(news({ planPaidUntil: at(-DAY), trialEndsAt: null }), NOW)).toEqual({ active: false, reason: "frozen", daysLeft: null });
    expect(newsroomAccess(news({ planPaidUntil: NOW, trialEndsAt: null }), NOW)).toMatchObject({ active: false, reason: "frozen" });
  });

  it("is active and legacy when there is no trial and no paid plan", () => {
    expect(newsroomAccess(news(), NOW)).toEqual({ active: true, reason: "legacy", daysLeft: null });
  });

  it("is a trial while trialEndsAt is in the future, with the days left rounded up", () => {
    expect(newsroomAccess(news({ trialEndsAt: at(14 * DAY) }), NOW)).toEqual({ active: true, reason: "trial", daysLeft: 14 });
    expect(newsroomAccess(news({ trialEndsAt: at(2 * DAY + 1) }), NOW)).toEqual({ active: true, reason: "trial", daysLeft: 3 });
    expect(newsroomAccess(news({ trialEndsAt: at(1) }), NOW)).toEqual({ active: true, reason: "trial", daysLeft: 1 });
  });

  it("is frozen once a paid plan lapsed, even if the trial date is still ahead", () => {
    expect(newsroomAccess(news({ planPaidUntil: at(-DAY), trialEndsAt: at(3 * DAY) }), NOW)).toMatchObject({ active: false, reason: "frozen" });
  });

  it("is frozen once the trial is over and nothing is paid", () => {
    expect(newsroomAccess(news({ trialEndsAt: at(-DAY) }), NOW)).toEqual({ active: false, reason: "frozen", daysLeft: null });
  });

  it("is frozen at the exact moment the trial ends", () => {
    expect(newsroomAccess(news({ trialEndsAt: NOW }), NOW)).toEqual({ active: false, reason: "frozen", daysLeft: null });
  });

  it("is frozen when the paid plan lapsed and the trial is over", () => {
    expect(newsroomAccess(news({ planPaidUntil: at(-DAY), trialEndsAt: at(-2 * DAY) }), NOW)).toMatchObject({ active: false, reason: "frozen" });
  });

  it("treats a paid plan that ends exactly now as lapsed", () => {
    expect(newsroomAccess(news({ planPaidUntil: NOW, trialEndsAt: at(-DAY) }), NOW)).toMatchObject({ active: false, reason: "frozen" });
  });
});

describe("trialEndsAtFrom", () => {
  it("is TRIAL_DAYS after the given moment", () => {
    expect(trialEndsAtFrom(NOW).getTime() - NOW.getTime()).toBe(TRIAL_DAYS * DAY);
  });
});
