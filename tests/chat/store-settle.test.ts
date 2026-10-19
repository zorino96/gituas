import { beforeEach, describe, expect, it, vi } from "vitest";

// settleStaleRuns: a run left RUNNING by a function that was cut off is settled as FAILED, with the "may have gone through" sentence
// AND the same marker (result.unknownOutcome) that a change timing out in confirm.ts stores, so the health check tells such a run from a
// plain failure and never invites the owner to ask again.

const db = vi.hoisted(() => ({ chatRun: { updateMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { settleStaleRuns } from "@/lib/chat/store";
import { say } from "@/lib/chat/text";

const NOW = Date.parse("2026-10-19T09:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  db.chatRun.updateMany.mockResolvedValue({ count: 2 });
});

describe("settleStaleRuns", () => {
  it("fails the thread's runs that have been RUNNING for over 3 minutes, with the sentence and the unknownOutcome marker", async () => {
    expect(await settleStaleRuns("th1", "en", NOW)).toBe(2);
    expect(db.chatRun.updateMany).toHaveBeenCalledTimes(1);
    const a = db.chatRun.updateMany.mock.calls[0][0];
    expect(a.where).toMatchObject({ threadId: "th1", status: "RUNNING" });
    expect(a.where.decidedAt.lt.getTime()).toBe(NOW - 3 * 60_000);
    expect(a.data).toMatchObject({ status: "FAILED", error: say("unknownOutcome", "en"), result: { unknownOutcome: true } });
    expect(a.data.finishedAt.getTime()).toBe(NOW);
  });

  it("writes the sentence in the person's language", async () => {
    await settleStaleRuns("th1", "ckb", NOW);
    await settleStaleRuns("th1", "ar", NOW);
    const errors = db.chatRun.updateMany.mock.calls.map((c) => c[0].data.error);
    expect(errors).toEqual([say("unknownOutcome", "ckb"), say("unknownOutcome", "ar")]);
    expect(new Set(errors).size).toBe(2);
    for (const c of db.chatRun.updateMany.mock.calls) expect(c[0].data.result).toEqual({ unknownOutcome: true });
  });
});
