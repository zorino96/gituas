import { describe, expect, it } from "vitest";
import { buildCommentJobs, buildDmJobs } from "@/lib/shop/jobs";

const decision = {
  actions: [
    { kind: "LIKE" as const },
    { kind: "PRIVATE_REPLY" as const, content: "card" as const, whatsapp: false },
    { kind: "PUBLIC_REPLY" as const, style: "answer" as const },
  ],
  flag: null,
};
const card = { text: "CARD TEXT", elements: [{ title: "Hoodie", subtitle: "25,000 IQD" }] };

describe("buildCommentJobs", () => {
  it("orders public reply, like, private reply; Facebook gets the template with a text fallback", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_FACEBOOK", commentId: "C1", authorName: "Aram", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs.map((j) => j.kind)).toEqual(["PUBLIC_REPLY", "LIKE", "PRIVATE_REPLY"]);
    expect(jobs[0].payload).toEqual({ commentId: "C1", text: "سوپاس" });
    expect(jobs[2].payload).toEqual({
      commentId: "C1",
      message: { attachment: { type: "template", payload: { template_type: "generic", elements: card.elements } } },
      fallbackText: "CARD TEXT",
    });
  });
  it("mentions the commenter and sends text on Instagram", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_INSTAGRAM", commentId: "C1", authorName: "shilan", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs[0].payload.text).toBe("@shilan سوپاس");
    expect(jobs.find((j) => j.kind === "PRIVATE_REPLY")!.payload.message).toEqual({ text: "CARD TEXT" });
  });
  it("uses the default DM, and drops jobs that have nothing to send", () => {
    const d = { actions: [{ kind: "PUBLIC_REPLY" as const, style: "answer" as const }, { kind: "PRIVATE_REPLY" as const, content: "default_dm" as const, whatsapp: false }], flag: null };
    expect(buildCommentJobs({ decision: d, platform: "META_FACEBOOK", commentId: "C1", authorName: null, publicText: null, card: null, defaultDm: " سڵاو " })).toEqual([
      { kind: "PRIVATE_REPLY", payload: { commentId: "C1", message: { text: "سڵاو" } } },
    ]);
  });
});

describe("buildDmJobs", () => {
  it("sends up to five photos first, then the answer", () => {
    const photos = Array.from({ length: 7 }, (_, i) => `https://x/${i}.jpg`);
    const jobs = buildDmJobs({ actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "price", whatsapp: false }], recipientId: "S1", photos, answerText: "25,000" });
    expect(jobs).toEqual([
      { kind: "DM_PHOTOS", payload: { recipientId: "S1", urls: photos.slice(0, 5) }, recipientId: "S1" },
      { kind: "DM_ANSWER", payload: { recipientId: "S1", message: { text: "25,000" } }, recipientId: "S1" },
    ]);
  });
  it("skips an answer with no text and photos with none to send", () => {
    expect(buildDmJobs({ actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "hours", whatsapp: false }], recipientId: "S1", photos: [], answerText: null })).toEqual([]);
  });
});
