import { describe, expect, it } from "vitest";
import { parseEntry } from "@/lib/shop/webhook-parse";

const fbComment = (value: Record<string, unknown>) => ({ id: "PAGE", changes: [{ field: "feed", value }] });

describe("parseEntry — Facebook", () => {
  it("reads a new top-level comment", () => {
    const ev = parseEntry("page", fbComment({
      item: "comment", verb: "add", comment_id: "P_1_C1", post_id: "P_1", parent_id: "P_1",
      from: { id: "U1", name: "Aram" }, message: "چەندە؟",
    }));
    expect(ev).toEqual([{
      kind: "comment", platform: "META_FACEBOOK", accountId: "PAGE", commentId: "P_1_C1", postId: "P_1",
      parentCommentId: null, authorId: "U1", authorName: "Aram", text: "چەندە؟",
    }]);
  });
  it("keeps the parent of a reply to a comment", () => {
    const [ev] = parseEntry("page", fbComment({
      item: "comment", verb: "add", comment_id: "P_1_C2", post_id: "P_1", parent_id: "P_1_C1", from: { id: "U2" }, message: "منیش",
    }));
    expect(ev).toMatchObject({ parentCommentId: "P_1_C1", authorName: null });
  });
  it("ignores edits, removals, reactions and posts", () => {
    for (const value of [
      { item: "comment", verb: "edited", comment_id: "C", post_id: "P" },
      { item: "comment", verb: "remove", comment_id: "C", post_id: "P" },
      { item: "reaction", verb: "add", post_id: "P" },
      { item: "status", verb: "add", post_id: "P" },
    ]) expect(parseEntry("page", fbComment(value))).toEqual([]);
  });
});

describe("parseEntry — Instagram", () => {
  it("reads a comment and a reply", () => {
    const ev = parseEntry("instagram", { id: "IG", changes: [
      { field: "comments", value: { id: "C1", text: "price?", from: { id: "S1", username: "shilan" }, media: { id: "M1" } } },
      { field: "comments", value: { id: "C2", text: "😍", from: { id: "S2", username: "dara" }, media: { id: "M1" }, parent_id: "C1" } },
    ] });
    expect(ev).toEqual([
      { kind: "comment", platform: "META_INSTAGRAM", accountId: "IG", commentId: "C1", postId: "M1", parentCommentId: null, authorId: "S1", authorName: "shilan", text: "price?" },
      { kind: "comment", platform: "META_INSTAGRAM", accountId: "IG", commentId: "C2", postId: "M1", parentCommentId: "C1", authorId: "S2", authorName: "dara", text: "😍" },
    ]);
  });
});

describe("parseEntry — messages", () => {
  it("reads a DM and skips echoes and our own sends", () => {
    const ev = parseEntry("instagram", { id: "IG", messaging: [
      { sender: { id: "S1" }, message: { mid: "m1", text: "قیاسی L هەیە؟" } },
      { sender: { id: "S1" }, message: { mid: "m2", text: "x", is_echo: true } },
      { sender: { id: "IG" }, message: { mid: "m3", text: "ours" } },
    ] });
    expect(ev).toEqual([{ kind: "dm", platform: "META_INSTAGRAM", accountId: "IG", messageId: "m1", senderId: "S1", text: "قیاسی L هەیە؟" }]);
  });
  it("returns nothing for an entry without an id", () => {
    expect(parseEntry("page", { changes: [] })).toEqual([]);
  });
});
