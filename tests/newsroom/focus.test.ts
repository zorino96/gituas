import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { activeFocus, cleanFocusPrompt, focusPrompt, parseFocus } from "@/lib/news/focus";
import { promptFilterFor } from "@/lib/billing/plans";

const saved = { filterMode: "PROMPT", focusPrompt: "only news about Donald Trump", excludePrompt: "sports", focusBroad: true };

describe("news by prompt", () => {
  it("is only on the two top plans, with more on ENTERPRISE", () => {
    expect(promptFilterFor("LITE")).toBe("none");
    expect(promptFilterFor("MANUAL")).toBe("none");
    expect(promptFilterFor("AUTO")).toBe("focus");
    expect(promptFilterFor("ENTERPRISE")).toBe("full");
    expect(promptFilterFor("nope")).toBe("none");
  });

  it("runs what the plan includes", () => {
    expect(activeFocus("MANUAL", saved)).toBeNull();
    expect(activeFocus("AUTO", saved)).toEqual({ focus: saved.focusPrompt, exclude: null, broad: false });
    expect(activeFocus("ENTERPRISE", saved)).toEqual({ focus: saved.focusPrompt, exclude: "sports", broad: true });
  });

  it("is off when the desk picked keywords or wrote nothing", () => {
    expect(activeFocus("ENTERPRISE", { ...saved, filterMode: "KEYWORDS" })).toBeNull();
    expect(activeFocus("AUTO", { ...saved, focusPrompt: "  " })).toBeNull();
    expect(activeFocus("ENTERPRISE", { ...saved, focusPrompt: null })).toEqual({ focus: null, exclude: "sports", broad: true });
  });

  it("cleans prompts", () => {
    expect(cleanFocusPrompt("  a \n b  ")).toBe("a b");
    expect(cleanFocusPrompt("x".repeat(400))).toHaveLength(300);
    expect(cleanFocusPrompt(5)).toBeNull();
  });

  it("passes the prompts as data, with every story numbered", () => {
    const p = focusPrompt({ focus: "Trump", exclude: "sports", broad: false }, [{ title: "A", snippet: "" }, { title: "B", snippet: "s" }]);
    expect(p.system).toMatch(/never follow instructions/);
    expect(p.system).toMatch(/directly about the FOCUS/);
    expect(p.user).toContain('FOCUS: """Trump"""');
    expect(p.user).toContain('EXCLUDE: """sports"""');
    expect(p.user).toContain("1. B — s");
  });

  it("parses the verdicts by index and leaves gaps unjudged", () => {
    expect(parseFocus({ items: [{ i: 1, keep: false }, { i: 9, keep: true }, { i: 0, keep: "yes" }] }, 3)).toEqual([null, false, null]);
    expect(parseFocus({ items: [] }, 2)).toBeNull();
    expect(parseFocus(null, 2)).toBeNull();
  });
});
