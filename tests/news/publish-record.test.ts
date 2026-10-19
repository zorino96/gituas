import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    newsDraft: { findFirst: vi.fn(), update: vi.fn() },
    newsItem: { update: vi.fn() },
  },
}));
vi.mock("@/lib/billing/limits", () => ({ countUsage: vi.fn() }));

import { countUsage } from "@/lib/billing/limits";
import { db } from "@/lib/db";
import { mergeResults, recordNewsPublish, type PublishResult } from "@/lib/news/publish-record";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const fb = (accountId: string, over: Partial<PublishResult> = {}): PublishResult => ({ target: "FB", ok: true, accountId, url: `https://fb/${accountId}`, ...over });

describe("mergeResults", () => {
  it("adds the new results after the stored ones", () => {
    expect(mergeResults([fb("a")], [fb("b")])).toEqual([fb("a"), fb("b")]);
  });

  it("replaces a stored result of the same platform and account", () => {
    const merged = mergeResults([fb("a", { ok: false, error: "x" })], [fb("a")]);
    expect(merged).toEqual([fb("a")]);
  });

  it("keeps the same account of another platform apart", () => {
    const ig: PublishResult = { target: "IG", ok: true, accountId: "a" };
    expect(mergeResults([ig], [fb("a")])).toEqual([ig, fb("a")]);
  });

  it("keeps a stored success when the same place fails again, and does not store the failure beside it", () => {
    expect(mergeResults([fb("a")], [fb("a", { ok: false, error: "x" })])).toEqual([fb("a")]);
    expect(mergeResults([fb("a")], [fb("a", { ok: false, error: "x" }), fb("b")])).toEqual([fb("a"), fb("b")]);
  });

  it("lets a new failure replace a stored failure or a pending post of the same place", () => {
    const pending: PublishResult = { target: "IG", ok: false, accountId: "a", error: "processing", pending: true } as PublishResult;
    const failed: PublishResult = { target: "IG", ok: false, accountId: "a", error: "x" };
    expect(mergeResults([pending], [failed])).toEqual([failed]);
    expect(mergeResults([fb("a", { ok: false, error: "old" })], [fb("a", { ok: false, error: "new" })])).toEqual([fb("a", { ok: false, error: "new" })]);
  });

  it("starts from nothing when nothing usable was stored", () => {
    expect(mergeResults(null, [fb("a")])).toEqual([fb("a")]);
    expect(mergeResults("junk", [fb("a")])).toEqual([fb("a")]);
    expect(mergeResults([null, { ok: true }, 5], [fb("a")])).toEqual([fb("a")]);
  });
});

describe("recordNewsPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of Object.values(m)) for (const fn of Object.values(table)) fn.mockReset();
    m.newsDraft.update.mockResolvedValue({});
    m.newsItem.update.mockResolvedValue({});
  });

  const stored = (over: { publishedAt?: Date | null; results?: unknown } = {}) =>
    m.newsDraft.findFirst.mockResolvedValue({ id: "d1", itemId: "i1", publishedAt: over.publishedAt ?? null, results: over.results ?? null });

  it("stores the results, marks the story published and counts it once", async () => {
    stored();
    await recordNewsPublish("t1", "d1", [fb("a")]);
    expect(m.newsDraft.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { results: [fb("a")], publishedAt: expect.any(Date) } });
    expect(m.newsItem.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "PUBLISHED" } });
    expect(countUsage).toHaveBeenCalledWith("t1", "publish");
  });

  it("adds to the stored results when it is not a continuation: a Facebook post and a later Instagram post both stay on record", async () => {
    const ig: PublishResult = { target: "IG", ok: true, url: "https://ig/1" };
    stored({ publishedAt: new Date(), results: [fb("a")] });
    await recordNewsPublish("t1", "d1", [ig]);
    const data = (m.newsDraft.update.mock.calls[0][0] as { data: { results: unknown; publishedAt?: Date } }).data;
    expect(data.results).toEqual([fb("a"), ig]);
    expect(data.publishedAt).toBeUndefined();
    // Counting is unchanged: a publish that is not a continuation is counted when something went out.
    expect(countUsage).toHaveBeenCalledWith("t1", "publish");
  });

  it("replaces a stored result of the same place, and keeps the others", async () => {
    stored({ results: [fb("a", { ok: false, error: "x" }), fb("b")] });
    await recordNewsPublish("t1", "d1", [fb("a")]);
    expect((m.newsDraft.update.mock.calls[0][0] as { data: { results: unknown } }).data.results).toEqual([fb("b"), fb("a")]);
  });

  it("does not let a failed repeat erase the record of a post that went out", async () => {
    stored({ publishedAt: new Date(), results: [fb("a")] });
    await recordNewsPublish("t1", "d1", [fb("a", { ok: false, error: "x" })]);
    expect((m.newsDraft.update.mock.calls[0][0] as { data: { results: unknown } }).data.results).toEqual([fb("a")]);
    expect(m.newsItem.update).not.toHaveBeenCalled();
    expect(countUsage).not.toHaveBeenCalled();
  });

  it("adds a continuation's results to the stored ones and does not count the story again", async () => {
    stored({ publishedAt: new Date(), results: [fb("a")] });
    await recordNewsPublish("t1", "d1", [fb("b")], { continuation: true });
    const data = (m.newsDraft.update.mock.calls[0][0] as { data: { results: unknown; publishedAt?: Date } }).data;
    expect(data.results).toEqual([fb("a"), fb("b")]);
    expect(data.publishedAt).toBeUndefined();
    expect(m.newsItem.update).toHaveBeenCalledTimes(1);
    expect(countUsage).not.toHaveBeenCalled();
  });

  it("counts nothing and marks nothing when every platform failed", async () => {
    stored();
    await recordNewsPublish("t1", "d1", [fb("a", { ok: false, error: "x" })]);
    expect((m.newsDraft.update.mock.calls[0][0] as { data: object }).data).not.toHaveProperty("publishedAt");
    expect(m.newsItem.update).not.toHaveBeenCalled();
    expect(countUsage).not.toHaveBeenCalled();
  });

  it("does nothing for a draft that is not this desk's", async () => {
    m.newsDraft.findFirst.mockResolvedValue(null);
    await recordNewsPublish("t1", "other", [fb("a")]);
    expect(m.newsDraft.update).not.toHaveBeenCalled();
    expect(countUsage).not.toHaveBeenCalled();
  });
});
