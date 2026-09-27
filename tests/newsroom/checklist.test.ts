import { describe, it, expect } from "vitest";
import { checklist, checklistDone, type ChecklistState } from "@/lib/newsroom/checklist";

const empty: ChecklistState = { pagesConnected: 0, logoSet: false, keywords: 0, rssFeeds: 0, cardsMade: 0, postsPublished: 0 };

describe("checklist", () => {
  it("lists five steps in order, none done for a new desk", () => {
    const steps = checklist(empty);
    expect(steps.map((s) => s.key)).toEqual(["connect", "brand", "sources", "card", "publish"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(checklistDone(steps)).toBe(false);
  });
  it("counts sources as set by keywords or by an RSS feed", () => {
    expect(checklist({ ...empty, keywords: 3 }).find((s) => s.key === "sources")?.done).toBe(true);
    expect(checklist({ ...empty, rssFeeds: 1 }).find((s) => s.key === "sources")?.done).toBe(true);
  });
  it("links every step to a newsroom page", () => {
    for (const s of checklist(empty)) expect(s.href.startsWith("/newsroom/")).toBe(true);
  });
  it("is done when every step is", () => {
    const all: ChecklistState = { pagesConnected: 2, logoSet: true, keywords: 1, rssFeeds: 0, cardsMade: 4, postsPublished: 1 };
    expect(checklistDone(checklist(all))).toBe(true);
  });
});
