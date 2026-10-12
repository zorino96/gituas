import { beforeEach, describe, expect, it, vi } from "vitest";

const tenant = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => ({ db: { tenant: { findUnique: vi.fn(async () => tenant.row) } } }));
vi.mock("@/lib/ai/slots", () => ({ takeDaily: vi.fn(async (_s: string, _m: string, wanted: number, cap: number) => Math.min(wanted, cap)) }));

import { takeDaily } from "@/lib/ai/slots";
import { draftTriesPerDay, newsItemsAllowed, NEWS_ITEMS_PER_DAY, NEWS_TRIAL_ITEMS_PER_DAY } from "@/lib/news/ai-budget";
import { NEWS_LIMITS } from "@/lib/billing/plans";

const DAY = 86_400_000;
const paid = (plan: string) => ({ kind: "NEWS", plan, planPaidUntil: new Date(Date.now() + DAY), trialEndsAt: null });

beforeEach(() => {
  vi.mocked(takeDaily).mockClear();
  tenant.row = paid("MANUAL");
});

describe("newsItemsAllowed", () => {
  it("lets a plan's desk have that many stories read in a day", async () => {
    for (const plan of ["LITE", "MANUAL", "AUTO", "ENTERPRISE"]) {
      tenant.row = paid(plan);
      expect(await newsItemsAllowed("t1", "news_label_day", 10_000)).toBe(NEWS_ITEMS_PER_DAY[plan]);
    }
  });

  it("gives a trial desk the small number, whatever plan the trial is on", async () => {
    tenant.row = { kind: "NEWS", plan: "MANUAL", planPaidUntil: null, trialEndsAt: new Date(Date.now() + DAY) };
    expect(await newsItemsAllowed("t1", "news_focus_day", 10_000)).toBe(NEWS_TRIAL_ITEMS_PER_DAY);
  });

  it("reads nothing for a desk that is frozen or does not exist, and asks for no counter", async () => {
    tenant.row = { kind: "NEWS", plan: "AUTO", planPaidUntil: new Date(Date.now() - DAY), trialEndsAt: null };
    expect(await newsItemsAllowed("t1", "news_label_day", 50)).toBe(0);
    tenant.row = null;
    expect(await newsItemsAllowed("t1", "news_label_day", 50)).toBe(0);
    expect(takeDaily).not.toHaveBeenCalled();
  });

  it("keeps labelling and the news prompt on separate counters", async () => {
    await newsItemsAllowed("t1", "news_label_day", 5);
    await newsItemsAllowed("t1", "news_focus_day", 5);
    expect(vi.mocked(takeDaily).mock.calls.map((c) => c[1])).toEqual(["news_label_day", "news_focus_day"]);
  });
});

describe("draftTriesPerDay", () => {
  it("is three attempts for each draft a plan allows a day, and never fewer than fifteen", () => {
    expect(draftTriesPerDay("LITE")).toBe(15);
    expect(draftTriesPerDay("MANUAL")).toBe(30);
    expect(draftTriesPerDay("AUTO")).toBe(Math.ceil((NEWS_LIMITS.AUTO.draft / 30) * 3));
    expect(draftTriesPerDay("ENTERPRISE")).toBeGreaterThan(draftTriesPerDay("AUTO"));
    expect(draftTriesPerDay("nonsense")).toBe(draftTriesPerDay("MANUAL"));
  });
});
