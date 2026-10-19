import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ tenant: { findMany: vi.fn() } }));
const weekly = vi.hoisted(() => ({ generateNote: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/coach/weekly", () => weekly);

import { GET } from "@/app/api/cron/coach/route";

/** A Baghdad wall-clock time as an instant (Baghdad is UTC+3). */
const baghdad = (iso: string): number => Date.parse(`${iso}+03:00`);
const SUNDAY_10 = baghdad("2026-10-25T10:07:00"); // inside the window, minute 7, 2026-W43

const request = (secret: string | null = "s3cret", query = "") => new Request(`https://gituas.com/api/cron/coach${query}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_10);
  process.env.CRON_SECRET = "s3cret";
  process.env.BUSINESS_PROFILE_ENABLED = "1";
  db.tenant.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
  weekly.generateNote.mockResolvedValue({ status: "created", week: "2026-W43", source: "rules", model: null, costMicro: null });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("the coach cron route", () => {
  it("refuses a call without the secret, with a wrong one, or when no secret is set", async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request("s3cret"))).status).toBe(401);
    expect(db.tenant.findMany).not.toHaveBeenCalled();
  });

  it("answers at once, touching nothing, outside Sunday 09:00 to 12:00 in Baghdad", async () => {
    for (const when of ["2026-10-25T08:59:00", "2026-10-25T12:00:00", "2026-10-24T10:00:00", "2026-10-26T10:00:00", "2026-10-21T10:00:00"]) {
      vi.setSystemTime(baghdad(when));
      const res = await GET(request());
      expect(res.status, when).toBe(200);
      expect(await res.json(), when).toEqual({ skipped: "window" });
    }
    expect(db.tenant.findMany).not.toHaveBeenCalled();
    expect(weekly.generateNote).not.toHaveBeenCalled();
  });

  it("does nothing while the setup interview and the coach are switched off", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    const res = await GET(request());
    expect(await res.json()).toEqual({ skipped: "off" });
    expect(db.tenant.findMany).not.toHaveBeenCalled();
  });

  it("asks for shop workspaces with a connected page or account and no note for this week", async () => {
    await GET(request());
    expect(db.tenant.findMany).toHaveBeenCalledWith({
      where: {
        kind: "MERCHANT",
        coachNotes: { none: { week: "2026-W43" } },
        stores: { some: { OR: [{ fbPageId: { not: null } }, { igUserId: { not: null } }] } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true },
    });
  });

  it("makes the note of exactly ONE workspace per call", async () => {
    const res = await GET(request());
    expect(weekly.generateNote).toHaveBeenCalledTimes(1);
    expect(weekly.generateNote).toHaveBeenCalledWith("t2", SUNDAY_10); // minute 7 of 3 candidates: index 1
    expect(await res.json()).toEqual({ week: "2026-W43", due: 3, status: "created", source: "rules" });
  });

  it("picks another candidate in another minute, so one failing workspace cannot hold up the others", async () => {
    const picked: string[] = [];
    for (const minute of ["10:00:00", "10:01:00", "10:02:00"]) {
      vi.setSystemTime(baghdad(`2026-10-25T${minute}`));
      await GET(request());
      picked.push(weekly.generateNote.mock.calls.at(-1)![0]);
    }
    expect(picked.sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("reports that nothing is due when every workspace has its note", async () => {
    db.tenant.findMany.mockResolvedValue([]);
    const res = await GET(request());
    expect(await res.json()).toEqual({ week: "2026-W43", due: 0 });
    expect(weekly.generateNote).not.toHaveBeenCalled();
  });

  it("is safe to call again: a note that exists is reported, not made twice", async () => {
    weekly.generateNote.mockResolvedValue({ status: "exists", week: "2026-W43" });
    const first = await (await GET(request())).json();
    const second = await (await GET(request())).json();
    expect(first).toEqual({ week: "2026-W43", due: 3, status: "exists" });
    expect(second).toEqual(first);
  });

  it("answers 200 with 'failed' when the note cannot be made, and never leaks the error's text", async () => {
    weekly.generateNote.mockRejectedValue(new Error("password=hunter2 in a record"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ week: "2026-W43", due: 3, status: "failed" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  describe("trying it outside the Sunday window (?force=1)", () => {
    const MONDAY = baghdad("2026-10-26T15:00:00");

    it("still needs the secret", async () => {
      vi.setSystemTime(MONDAY);
      expect((await GET(request(null, "?force=1"))).status).toBe(401);
      expect((await GET(request("wrong", "?force=1&tenant=t9"))).status).toBe(401);
      expect(weekly.generateNote).not.toHaveBeenCalled();
    });

    it("skips only the window: the next due workspace gets its note", async () => {
      vi.setSystemTime(MONDAY);
      const res = await GET(request("s3cret", "?force=1"));
      expect(await res.json()).toMatchObject({ week: "2026-W44", status: "created" });
      expect(weekly.generateNote).toHaveBeenCalledTimes(1);
      expect(db.tenant.findMany.mock.calls[0][0].where.coachNotes).toEqual({ none: { week: "2026-W44" } });
    });

    it("makes the note of the one shop workspace asked for", async () => {
      vi.setSystemTime(MONDAY);
      db.tenant.findMany.mockResolvedValue([{ id: "t9" }]);
      await GET(request("s3cret", "?force=1&tenant=t9"));
      expect(db.tenant.findMany).toHaveBeenCalledWith({ where: { id: "t9", kind: "MERCHANT" }, take: 1, select: { id: true } });
      expect(weekly.generateNote).toHaveBeenCalledWith("t9", MONDAY);
    });

    it("says nothing is due for a workspace that is not a shop", async () => {
      vi.setSystemTime(MONDAY);
      db.tenant.findMany.mockResolvedValue([]);
      const res = await GET(request("s3cret", "?force=1&tenant=news-desk"));
      expect(await res.json()).toEqual({ week: "2026-W44", due: 0 });
      expect(weekly.generateNote).not.toHaveBeenCalled();
    });

    it("does not skip the switch", async () => {
      vi.setSystemTime(MONDAY);
      delete process.env.BUSINESS_PROFILE_ENABLED;
      expect(await (await GET(request("s3cret", "?force=1"))).json()).toEqual({ skipped: "off" });
    });

    it("is ignored without force=1: the window and the queue rule", async () => {
      vi.setSystemTime(MONDAY);
      expect(await (await GET(request("s3cret", "?tenant=t9"))).json()).toEqual({ skipped: "window" });
      vi.setSystemTime(SUNDAY_10);
      await GET(request("s3cret", "?tenant=t9"));
      expect(db.tenant.findMany.mock.calls[0][0].where).toHaveProperty("coachNotes");
    });
  });

  it("stops waiting after 40 seconds", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY_10);
    weekly.generateNote.mockReturnValue(new Promise(() => undefined));
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(40_001);
    const res = await pending;
    expect(await res.json()).toEqual({ week: "2026-W43", due: 3, status: "late" });
  });
});
