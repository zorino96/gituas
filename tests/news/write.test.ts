import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { newsDraft: { findMany: vi.fn() } } }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { voiceFor } from "@/lib/news/voice";
import { writeDraft } from "@/lib/news/write";

const findMany = (db as unknown as { newsDraft: { findMany: ReturnType<typeof vi.fn> } }).newsDraft.findMany;
const ai = completeJson as unknown as ReturnType<typeof vi.fn>;

const item = { url: "https://example.com/a", sourceName: "Example", title: "Salaries will be paid tomorrow", snippet: "The finance ministry said so." };
const draft = (headline: string, body: string) => ({ headline, body, category: "ئابووری", cardKind: "STANDARD", stat: null, quote: null, speaker: null });

const FIRST = draft(
  "حکومەتی هەرێم مووچەی مانگی ئەیلوول دابەش دەکات",
  "وەزارەتی دارایی ڕایگەیاند کە لە سبەینێوە مووچەی فەرمانبەران دابەش دەکرێت.",
);
const SECOND = draft("دابەشکردنی مووچە: سبەینێ دەست پێدەکات", "فەرمانبەران لە سبەینێوە مووچەکانیان وەردەگرن، بەپێی ڕاگەیەندراوی دارایی.");
/** Another desk's draft: ours, plus one word of their own that must never reach the model. */
const OTHER = { headline: FIRST.headline, body: `${FIRST.body} نهێنییەکەیان` };

const calls = () => ai.mock.calls.map((c) => c[0] as { system: string; user: string; strength: string });

beforeEach(() => {
  findMany.mockReset();
  ai.mockReset();
});

describe("writeDraft", () => {
  it("writes once, in the desk's voice, when no other desk has the story", async () => {
    findMany.mockResolvedValue([]);
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" });
    const r = await writeDraft("desk-a", item, "fast", { startedAt: Date.now(), voiceNote: "ڕستەی کورت" });
    expect(r).toEqual({ draft: FIRST, model: "m1", part: null });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(calls()[0].system).toContain(voiceFor("desk-a"));
    expect(calls()[0].system).toContain("ڕستەی کورت");
  });

  it("looks only at other desks' drafts of the same article, from the last week, five at most", async () => {
    findMany.mockResolvedValue([]);
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" });
    const before = Date.now();
    await writeDraft("desk-a", item, "fast", { startedAt: before });
    const q = findMany.mock.calls[0][0];
    expect(q.where.tenantId).toEqual({ not: "desk-a" });
    expect(q.where.item).toEqual({ url: item.url });
    expect(before - q.where.updatedAt.gte.getTime()).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 5);
    expect(q.take).toBe(5);
    expect(q.select).toEqual({ headline: true, body: true });
  });

  it("writes once more when another desk's draft reads the same, showing the model only our own draft", async () => {
    findMany.mockResolvedValue([OTHER]);
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" }).mockResolvedValueOnce({ data: SECOND, model: "m2" });
    const r = await writeDraft("desk-a", item, "fast", { startedAt: Date.now() });
    expect(r.draft).toEqual(SECOND);
    expect(r.model).toBe("m2");
    expect(ai).toHaveBeenCalledTimes(2);
    const second = calls()[1];
    expect(second.strength).toBe("fast");
    expect(second.user).toContain(FIRST.headline);
    expect(second.user).toContain(FIRST.body);
    expect(second.user).toMatch(/Another outlet already published this story/);
    for (const c of calls()) expect(c.system + c.user).not.toContain("نهێنییەکەیان");
  });

  it("writes only once more, even when the rewrite is still close", async () => {
    findMany.mockResolvedValue([OTHER]);
    ai.mockResolvedValue({ data: FIRST, model: "m1" });
    const r = await writeDraft("desk-a", item, "fast", { startedAt: Date.now() });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(r.draft).toEqual(FIRST);
  });

  it("keeps the first draft when the rewrite copies the source", async () => {
    findMany.mockResolvedValue([OTHER]);
    const copied = draft(item.title, `${item.title} ${item.snippet}`);
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" }).mockResolvedValueOnce({ data: copied, model: "m2" });
    const r = await writeDraft("desk-a", item, "fast", { startedAt: Date.now() });
    expect(r).toEqual({ draft: FIRST, model: "m1", part: null });
  });

  it("keeps the first draft when the check or the rewrite fails", async () => {
    findMany.mockRejectedValueOnce(new Error("db down"));
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" });
    expect((await writeDraft("desk-a", item, "fast", { startedAt: Date.now() })).draft).toEqual(FIRST);

    findMany.mockResolvedValue([OTHER]);
    ai.mockReset();
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" }).mockRejectedValueOnce(new Error("ai down"));
    expect((await writeDraft("desk-a", item, "fast", { startedAt: Date.now() })).draft).toEqual(FIRST);
  });

  it("skips the cross-desk check once the deadline has passed", async () => {
    findMany.mockResolvedValue([OTHER]);
    ai.mockResolvedValueOnce({ data: FIRST, model: "m1" });
    await writeDraft("desk-a", item, "fast", { startedAt: Date.now() - 36_000 });
    expect(findMany).not.toHaveBeenCalled();
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it("still redrafts a draft that copies the source, with feedback", async () => {
    findMany.mockResolvedValue([]);
    const copied = draft(item.title, `${item.title} ${item.snippet}`);
    ai.mockResolvedValueOnce({ data: copied, model: "m1" }).mockResolvedValueOnce({ data: FIRST, model: "m2" });
    const r = await writeDraft("desk-a", item, "fast", { startedAt: Date.now() });
    expect(r).toEqual({ draft: FIRST, model: "m2", part: null });
    expect(calls()[1].user).toContain("YOUR PREVIOUS DRAFT COPIED THE SOURCE");
  });
});
