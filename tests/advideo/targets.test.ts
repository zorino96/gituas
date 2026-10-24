import { beforeEach, describe, expect, it, vi } from "vitest";

// connectedVideoTargets: which of the platforms asked for an AI video can really be posted to. Read-only: only the database is asked.

vi.mock("@/lib/db", () => ({ db: { oAuthCredential: { findMany: vi.fn() } } }));

import { db } from "@/lib/db";
import { connectedVideoTargets, youtubeChannels } from "@/lib/advideo/targets";

const find = (db as unknown as { oAuthCredential: { findMany: ReturnType<typeof vi.fn> } }).oAuthCredential.findMany;
const BOTH = { fbPageId: "page1", igUserId: "ig1" };

beforeEach(() => {
  vi.clearAllMocks();
  find.mockResolvedValue([{ providerAccountId: "UC1" }]);
});

describe("youtubeChannels", () => {
  it("asks for this workspace's YouTube connections that can still be used, never the one whose channel could not be read", async () => {
    await youtubeChannels("t1");
    const args = find.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: "t1", provider: "YOUTUBE", NOT: { providerAccountId: "unknown" } });
    // usable now, or refreshable (YouTube's access tokens last an hour)
    expect(args.where.OR).toEqual(expect.arrayContaining([{ expiresAt: null }, { refreshTokenEncrypted: { not: null } }]));
    expect(args.select).toEqual({ providerAccountId: true });
  });

  it("answers one id per channel, oldest first, without repeats", async () => {
    find.mockResolvedValue([{ providerAccountId: "UC1" }, { providerAccountId: "UC2" }, { providerAccountId: "UC1" }, { providerAccountId: "" }, { providerAccountId: 5 }, null]);
    expect(await youtubeChannels("t1")).toEqual(["UC1", "UC2"]);
    expect(find.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("gives no channel when the database does not answer, or answers with something else", async () => {
    find.mockRejectedValue(new Error("down"));
    expect(await youtubeChannels("t1")).toEqual([]);
    find.mockResolvedValue("nope");
    expect(await youtubeChannels("t1")).toEqual([]);
  });
});

describe("connectedVideoTargets", () => {
  it("gives Facebook for a store with a Page, Instagram for one with an Instagram account, YouTube for a workspace with a channel", async () => {
    expect(await connectedVideoTargets("t1", BOTH, ["FB", "IG", "YT"])).toEqual(["FB", "IG", "YT"]);
    expect(await connectedVideoTargets("t1", { fbPageId: "page1", igUserId: null }, ["FB", "IG", "YT"])).toEqual(["FB", "YT"]);
    expect(await connectedVideoTargets("t1", { fbPageId: null, igUserId: "ig1" }, ["FB", "IG", "YT"])).toEqual(["IG", "YT"]);
    expect(await connectedVideoTargets("t1", { fbPageId: null, igUserId: null }, ["FB", "IG", "YT"])).toEqual(["YT"]);
  });

  it("gives no YouTube for a workspace without a YouTube connection", async () => {
    find.mockResolvedValue([]);
    expect(await connectedVideoTargets("t1", BOTH, ["FB", "IG", "YT"])).toEqual(["FB", "IG"]);
    expect(await connectedVideoTargets("t1", BOTH, ["YT"])).toEqual([]);
  });

  it("gives only what was asked for, in the order it was asked, without repeats", async () => {
    expect(await connectedVideoTargets("t1", BOTH, ["YT", "FB"])).toEqual(["YT", "FB"]);
    expect(await connectedVideoTargets("t1", BOTH, ["IG", "IG", "FB", "IG"])).toEqual(["IG", "FB"]);
    expect(await connectedVideoTargets("t1", BOTH, [])).toEqual([]);
  });

  it("drops anything that is not one of the three, and survives a bad list", async () => {
    expect(await connectedVideoTargets("t1", BOTH, ["TT", "FB", "toString", 5, null] as never)).toEqual(["FB"]);
    expect(await connectedVideoTargets("t1", BOTH, undefined as never)).toEqual([]);
    expect(await connectedVideoTargets("t1", BOTH, "FB" as never)).toEqual([]);
  });

  it("does not look at YouTube unless it was asked for (and only once)", async () => {
    await connectedVideoTargets("t1", BOTH, ["FB", "IG"]);
    expect(find).not.toHaveBeenCalled();
    await connectedVideoTargets("t1", BOTH, ["YT", "YT"]);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("keeps YouTube in when several channels are connected (the publisher then says it needs a pick)", async () => {
    find.mockResolvedValue([{ providerAccountId: "UC1" }, { providerAccountId: "UC2" }]);
    expect(await connectedVideoTargets("t1", BOTH, ["YT"])).toEqual(["YT"]);
  });
});
