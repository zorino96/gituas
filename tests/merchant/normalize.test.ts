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
  { username: "zarashop" },
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

describe("recognising our own account", () => {
  const posts = fromIg(
    [{ id: "m9", caption: "x", comments_count: 3 }],
    {
      m9: [
        // our own top-level comment — the account wrote on its own post
        { id: "a", text: "We deliver same day", username: "rwbn2026", from: { id: "IG1", username: "rwbn2026" } },
        // a customer, answered by us — matched by id even though the stored name has an @
        { id: "b", text: "Do you deliver?", from: { id: "U7", username: "zrng" },
          replies: [{ id: "b1", text: "Yes", from: { id: "IG1", username: "rwbn2026" } }] },
        // a customer with the username only under `from`
        { id: "c", text: "How much?", from: { id: "U8", username: "dilan" } },
      ],
    },
    { id: "IG1", username: "@rwbn2026" },
  );
  const [ours, answered, open] = posts[0].comments;

  it("does not count our own comments as waiting for a reply", () => {
    expect(ours.fromUs).toBe(true);
    expect(commentState(ours)).toBe("answered");
  });
  it("matches our replies by account id", () => {
    expect(answered.replies[0].fromUs).toBe(true);
    expect(commentState(answered)).toBe("answered");
  });
  it("reads the commenter name from `from` when the flat field is missing", () => {
    expect(open.author).toBe("dilan");
    expect(commentState(open)).toBe("unanswered");
  });
  it("tolerates a stored name with a leading @", () => {
    const p = fromIg([{ id: "m1" }], { m1: [{ id: "z", text: "hi", username: "rwbn2026" }] }, { username: "@rwbn2026" });
    expect(p[0].comments[0].fromUs).toBe(true);
  });
});

// The exact shape graph.instagram.com returned on 2026-09-23: replies carry only
// id/text/timestamp, and each of our replies is ALSO listed top-level with `from`.
describe("Instagram replies without an author", () => {
  const posts = fromIg(
    [{ id: "m1", comments_count: 4 }],
    {
      m1: [
        { id: "R1", text: "Yes! We deliver", username: "rwbn2026", from: { id: "IG1", username: "rwbn2026" } },
        { id: "Q1", text: "Do you deliver?", from: { id: "U1", username: "zrngvz" }, replies: [{ id: "R1", text: "Yes! We deliver" }] },
        { id: "R2", text: "Send us a DM", username: "rwbn2026", from: { id: "IG1", username: "rwbn2026" } },
        { id: "Q2", text: "How do I order?", from: { id: "U1", username: "zrngvz" }, replies: [{ id: "R2", text: "Send us a DM" }] },
      ],
    },
    { id: "IG1", username: "@rwbn2026" },
  );
  const comments = posts[0].comments;

  it("lists a reply once, under its question, not again as a comment", () => {
    expect(comments.map((c) => c.id)).toEqual(["Q1", "Q2"]);
  });
  it("takes the reply's author from its top-level twin", () => {
    expect(comments[0].replies[0].fromUs).toBe(true);
    expect(comments[0].replies[0].author).toBe("rwbn2026");
  });
  it("therefore counts both questions as answered", () => {
    expect(countStates(posts)).toEqual({ unanswered: 0, answered: 2, hidden: 0 });
  });
});
