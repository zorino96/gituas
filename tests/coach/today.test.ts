import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The growth coach's part of Today: what it says, in each language, with the three reads replaced.

const tiles = vi.hoisted(() => ({ loadOrderTiles: vi.fn() }));
const leaks = vi.hoisted(() => ({ loadLeaks: vi.fn() }));
const read = vi.hoisted(() => ({ latestNote: vi.fn() }));
vi.mock("@/lib/coach/tiles", () => tiles);
vi.mock("@/lib/shop/leaks", () => leaks);
vi.mock("@/lib/coach/read", () => read);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb) };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

import { TodayCoach } from "@/app/app/today-coach";
import { LABEL, LABEL_RULES, renderRules } from "@/lib/coach/text";
import { busyFacts } from "./fixtures";

const render = async (lang: "ckb" | "ar" | "en") => {
  const el = await TodayCoach({ tenantId: "t1", lang });
  return el ? renderToStaticMarkup(el) : "";
};

const openTiles = { week: 5, bySource: { comments: 2, messages: 2, byHand: 1 }, delivered: 3, open: { count: 4, valueMinor: { IQD: 125_000 } } };
const note = (lang: "ckb" | "ar" | "en", source: "ai" | "rules" = "rules") => ({
  week: "2026-W43",
  source,
  madeAt: "2026-10-25T06:30:00.000Z",
  preview: false,
  body: renderRules(busyFacts(), lang),
  facts: busyFacts(),
  label: source === "ai" ? LABEL[lang] : LABEL_RULES[lang],
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BUSINESS_PROFILE_ENABLED = "1";
  tiles.loadOrderTiles.mockResolvedValue(openTiles);
  leaks.loadLeaks.mockResolvedValue({ hot: 2, quiet: 7, capped: false });
  read.latestNote.mockResolvedValue(note("en"));
});
afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("Today's growth coach", () => {
  it("shows nothing, and reads nothing, while the switch is off", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    expect(await render("en")).toBe("");
    expect(tiles.loadOrderTiles).not.toHaveBeenCalled();
    expect(leaks.loadLeaks).not.toHaveBeenCalled();
    expect(read.latestNote).not.toHaveBeenCalled();
  });

  it("shows nothing when there is nothing to show", async () => {
    tiles.loadOrderTiles.mockResolvedValue({ week: 0, bySource: { comments: 0, messages: 0, byHand: 0 }, delivered: 0, open: { count: 0, valueMinor: {} } });
    leaks.loadLeaks.mockResolvedValue({ hot: 0, quiet: 0, capped: false });
    read.latestNote.mockResolvedValue(null);
    expect(await render("en")).toBe("");
  });

  it("labels the order tiles honestly: ordered, not collected, never sales or earnings", async () => {
    const html = await render("en");
    // The heading names no window; each tile names its own (7 days, 30 days, 7 days).
    expect(html).not.toContain("Orders in the last 7 days");
    expect(html).toContain("Orders recorded, last 7 days");
    expect(html).toContain("Ordered, not collected (last 30 days)");
    expect(html).toContain("Delivered orders updated in the last 7 days");
    expect(html).toContain("125,000 IQD");
    expect(html).toContain("not delivered and the money is not collected yet");
    expect(html).toContain("From comments 2");
    expect(html).not.toMatch(/\b(sales|earned|earnings|revenue|profit)\b/i);
  });

  it("calls the leak card 'no order recorded', never a lost sale, with both counts and the reason it is not a loss", async () => {
    const html = await render("en");
    expect(html).toContain("Buyers who wrote, with no order recorded");
    expect(html).toContain("Wrote in the last 24 hours");
    expect(html).toContain("Wrote more than 24 hours ago, within the last 7 days");
    expect(html).toContain("not that the sale was lost");
    expect(html).not.toMatch(/lost sales?\b(?! was lost)/i);
    expect(html).toContain(">2<");
    expect(html).toContain(">7<");
  });

  it("marks a count that hit its cap as 'at least'", async () => {
    leaks.loadLeaks.mockResolvedValue({ hot: 40, quiet: 120, capped: true });
    const html = await render("en");
    expect(html).toContain(">40+<");
    expect(html).toContain(">120+<");
  });

  it("hides the leak card when no buyer is waiting, and keeps the others", async () => {
    leaks.loadLeaks.mockResolvedValue({ hot: 0, quiet: 0, capped: false });
    const html = await render("en");
    expect(html).not.toContain("with no order recorded");
    expect(html).toContain("Ordered, not collected");
    expect(html).toContain("Your week in numbers");
  });

  it("shows the weekly note with its headline, points, things to try and the label line", async () => {
    const html = await render("en");
    expect(html).toContain("Your week in numbers");
    expect(html).toContain("2026-W43");
    expect(html).toContain("Orders are up on last week");
    expect(html).toContain("14 orders were recorded this week");
    expect(html).toContain("Try this");
    expect(html).toContain(LABEL_RULES.en);
    expect(html).toContain("Fixed rules, no AI");
    expect(html).toContain('href="/app/assistant"');
  });

  it("shows the AI label only for a note the AI worded", async () => {
    read.latestNote.mockResolvedValue(note("en", "ai"));
    const html = await render("en");
    expect(html).toContain(LABEL.en);
    expect(html).toContain("Worded by AI");
  });

  it("shows at most four points on Today", async () => {
    const html = await render("en");
    const items = html.match(/<li/g) ?? [];
    // up to four points plus the things to try
    expect(items.length).toBeLessThanOrEqual(4 + 3);
  });

  it("is shown in each language, with no missing word", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      read.latestNote.mockResolvedValue(note(lang));
      const html = await render(lang);
      expect(html.length, lang).toBeGreaterThan(500);
      expect(html, lang).not.toContain("undefined");
      expect(html, lang).not.toContain("NaN");
      expect(html, lang).toContain(LABEL_RULES[lang]);
    }
  });

  it("does not fail the page when a read fails: that card is left out", async () => {
    tiles.loadOrderTiles.mockResolvedValue(null);
    leaks.loadLeaks.mockResolvedValue(null);
    read.latestNote.mockRejectedValue(new Error("db down"));
    expect(await render("en")).toBe("");
  });
});
