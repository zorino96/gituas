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
  it("orders private reply, public reply, like; Facebook gets the template with a text fallback", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_FACEBOOK", commentId: "C1", authorName: "Aram", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs.map((j) => j.kind)).toEqual(["PRIVATE_REPLY", "PUBLIC_REPLY", "LIKE"]);
    expect(jobs[0].payload).toEqual({
      commentId: "C1",
      message: { attachment: { type: "template", payload: { template_type: "generic", elements: card.elements } } },
      fallbackText: "CARD TEXT",
    });
    expect(jobs[1].payload).toEqual({ commentId: "C1", text: "سوپاس", requiresPrivate: true });
  });
  it("mentions the commenter and sends text on Instagram", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_INSTAGRAM", commentId: "C1", authorName: "shilan", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs.find((j) => j.kind === "PUBLIC_REPLY")!.payload.text).toBe("@shilan سوپاس");
    expect(jobs.find((j) => j.kind === "PRIVATE_REPLY")!.payload.message).toEqual({ text: "CARD TEXT" });
  });
  it("a public thank-you does not wait for a private reply", () => {
    const d = { actions: [{ kind: "PUBLIC_REPLY" as const, style: "thanks" as const }], flag: null };
    const jobs = buildCommentJobs({ decision: d, platform: "META_FACEBOOK", commentId: "C1", authorName: null, publicText: "سوپاس", card: null, defaultDm: null });
    expect(jobs).toEqual([{ kind: "PUBLIC_REPLY", payload: { commentId: "C1", text: "سوپاس" } }]);
    expect(jobs[0].payload).not.toHaveProperty("requiresPrivate");
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
