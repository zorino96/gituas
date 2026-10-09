import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    oAuthCredential: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), update: vi.fn() },
    newsDraft: { findMany: vi.fn(), update: vi.fn() },
    scheduledPost: { findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/vault", () => ({ vaultDecrypt: vi.fn(), vaultEncrypt: vi.fn() }));

import { db } from "@/lib/db";
import { scrubYouTubeLinks } from "@/lib/publishers/youtube-upkeep";

const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const m = db as unknown as {
  oAuthCredential: { findMany: ReturnType<typeof vi.fn> };
  auditLog: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  newsDraft: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  scheduledPost: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

describe("scrubYouTubeLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Workspace t1 still has channel A connected; channel B was disconnected.
    m.oAuthCredential.findMany.mockResolvedValue([{ tenantId: "t1", providerAccountId: "A" }]);
    m.auditLog.findMany.mockResolvedValue([]);
    m.newsDraft.findMany.mockResolvedValue([]);
    m.scheduledPost.findMany.mockResolvedValue([]);
  });

  it("removes a disconnected channel's upload at once, and keeps a connected channel's recent one", async () => {
    m.scheduledPost.findMany.mockResolvedValue([
      {
        id: "p1",
        tenantId: "t1",
        updatedAt: daysAgo(1),
        result: [
          { target: "YT", ok: true, accountId: "A", accountName: "Channel A", url: "https://youtu.be/a", externalId: "a" },
          { target: "YT", ok: true, accountId: "B", accountName: "Channel B", url: "https://youtu.be/b", externalId: "b" },
          { target: "FB", ok: true, url: "https://facebook.com/x" },
        ],
      },
    ]);
    expect(await scrubYouTubeLinks(now)).toBe(1);
    expect(m.scheduledPost.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: {
        result: [
          { target: "YT", ok: true, accountId: "A", accountName: "Channel A", url: "https://youtu.be/a", externalId: "a" },
          { target: "YT", ok: true },
          { target: "FB", ok: true, url: "https://facebook.com/x" },
        ],
      },
    });
  });

  it("removes every YouTube field after 30 days, even for a connected channel", async () => {
    m.newsDraft.findMany.mockResolvedValue([
      { id: "d1", tenantId: "t1", publishedAt: daysAgo(31), updatedAt: daysAgo(31), results: [{ target: "YT", ok: true, accountId: "A", accountName: "Channel A", url: "u", externalId: "e" }] },
    ]);
    m.auditLog.findMany.mockResolvedValue([{ id: "l1", tenantId: "t1", createdAt: daysAgo(31), metadata: { target: "YT", accountId: "A", url: "u" } }]);
    expect(await scrubYouTubeLinks(now)).toBe(2);
    expect(m.newsDraft.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { results: [{ target: "YT", ok: true }] } });
    expect(m.auditLog.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { metadata: { target: "YT" } } });
  });

  it("leaves entries without YouTube data alone", async () => {
    m.auditLog.findMany.mockResolvedValue([{ id: "l1", tenantId: "t1", createdAt: daysAgo(40), metadata: { target: "YT", error: "failed" } }]);
    expect(await scrubYouTubeLinks(now)).toBe(0);
    expect(m.auditLog.update).not.toHaveBeenCalled();
  });
});
