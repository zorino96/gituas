import { beforeEach, describe, expect, it, vi } from "vitest";

// The render queue the Actions worker claims from: two videos per call, but a story (it renders for much longer than
// an ad) is handed out alone, oldest first, so it never holds an ad's upload back or pushes the run past its limit.
vi.mock("@/lib/db", () => ({ db: { adVideo: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() } } }));
vi.mock("@vercel/blob/client", () => ({ generateClientTokenFromReadWriteToken: vi.fn(async () => "upload-token") }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: () => true }));
vi.mock("@/lib/advideo/prepare", () => ({ AD_MAX_TRIES: 3, prepareQueued: vi.fn(), waitingFilter: () => ({}) }));

import { GET } from "@/app/api/cron/ad-jobs/route";
import { db } from "@/lib/db";

const m = db as unknown as { adVideo: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } };
const row = (id: string, props: Record<string, unknown> = {}) => ({ id, tenantId: "t1", status: "READY", updatedAt: new Date(0), props: { version: 1, scenes: [], ...props } });
const call = async () => {
  const res = await GET(new Request("https://gituas.com/api/cron/ad-jobs", { headers: { authorization: "Bearer secret" } }));
  return (await res.json()) as { jobs: { id: string }[] };
};
const claimed = () => m.adVideo.updateMany.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);

describe("claiming videos to render", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    m.adVideo.findMany.mockReset();
    m.adVideo.updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("hands out two ads together, as it always did", async () => {
    m.adVideo.findMany.mockResolvedValue([row("a1"), row("a2", { lang: "ar" })]);
    expect((await call()).jobs.map((j) => j.id)).toEqual(["a1", "a2"]);
  });

  it("hands out a story alone when it is the oldest", async () => {
    m.adVideo.findMany.mockResolvedValue([row("s1", { kind: "story" }), row("a1")]);
    expect((await call()).jobs.map((j) => j.id)).toEqual(["s1"]);
    expect(claimed()).toEqual(["s1"]);
  });

  it("leaves a story for the next call when an ad is older", async () => {
    m.adVideo.findMany.mockResolvedValue([row("a1"), row("s1", { kind: "story" })]);
    expect((await call()).jobs.map((j) => j.id)).toEqual(["a1"]);
    expect(claimed()).toEqual(["a1"]);
  });

  it("takes the next video when another worker got the first one, and still keeps a story alone", async () => {
    m.adVideo.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    m.adVideo.findMany.mockResolvedValue([row("s1", { kind: "story" }), row("s2", { kind: "story" })]);
    expect((await call()).jobs.map((j) => j.id)).toEqual(["s2"]);
  });

  it("reads a job with no kind as an ad", async () => {
    m.adVideo.findMany.mockResolvedValue([row("a1", { kind: "nonsense" }), row("a2", { kind: "ad" })]);
    expect((await call()).jobs.map((j) => j.id)).toEqual(["a1", "a2"]);
  });
});
