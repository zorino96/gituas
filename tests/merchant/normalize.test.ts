import { describe, it, expect } from "vitest";
import { fromIg, fromFb } from "@/lib/merchant/normalize";
import { commentState, countStates, rankPosts } from "@/lib/merchant/state";

const ig = fromIg(
  [{ id: "m1", caption: "جل", media_type: "IMAGE", media_url: "https://x/1.jpg", comments_count: 2, timestamp: "2026-09-20T10:00:00Z" }],
  {
    m1: [
      {
        id: "c1", text: "چەندە؟", username: "hawkar", timestamp: "2026-09-20T11:00:00Z", hidden: false,
        replies: [{ id: "r1", text: "٣٥٬٠٠٠", username: "zarashop", timestamp: "2026-09-20T11:01:00Z" }],
      },
      { id: "c2", text: "spam", username: "bot", hidden: true, replies: [] },
    ],
  },
  "zarashop",
);
const fb = fromFb(
  [{ id: "p1", message: "پۆست", comments_count: 1, created_time: "2026-09-21T09:00:00Z" }],
  {
    p1: [{
      id: "c3", message: "گەیاندن هەیە؟", username: "Rania", timestamp: "2026-09-21T09:30:00Z", hidden: false,
      replies: [{ id: "r2", message: "بەڵێ", authorId: "999", authorName: "Other", created_time: "2026-09-21T09:40:00Z" }],
    }],
  },
  "PAGE1",
);

describe("normalize", () => {
  it("maps Instagram media and marks our own replies", () => {
    expect(ig[0].platform).toBe("IG");
    expect(ig[0].thumbUrl).toBe("https://x/1.jpg");
    expect(ig[0].comments[0].replies[0].fromUs).toBe(true);
    expect(ig[0].comments[1].hidden).toBe(true);
  });
  it("maps Facebook posts and only trusts the Page id", () => {
    expect(fb[0].platform).toBe("FB");
    expect(fb[0].comments[0].replies[0].fromUs).toBe(false);
  });
});

describe("state", () => {
  it("orders hidden before answered before unanswered", () => {
    expect(commentState(ig[0].comments[0])).toBe("answered");
    expect(commentState(ig[0].comments[1])).toBe("hidden");
    expect(commentState(fb[0].comments[0])).toBe("unanswered");
  });
  it("counts states across posts", () => {
    expect(countStates([...ig, ...fb])).toEqual({ unanswered: 1, answered: 1, hidden: 1 });
  });
  it("ranks posts by comments, then recency", () => {
    expect(rankPosts([...fb, ...ig], 2).map((p) => p.id)).toEqual(["m1", "p1"]);
  });
});
