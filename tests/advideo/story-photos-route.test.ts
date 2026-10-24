import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The probe that tells, from the deployment's own network, whether Wikimedia Commons answers and which photographs the
// story video would accept. Guarded like the other cron probes; it never downloads or stores anything.
vi.mock("@/lib/advideo/commons", () => ({
  probeCommons: vi.fn(async (q: string) => ({ query: q, outcome: "ok", ms: 12, userAgent: "GituasVideoBot/1.0 (+https://gituas.com)", results: [{ title: "File:Hinterkaifeck-Hof.jpg", ok: true, why: null, licence: "Public domain", author: "Andreas Biegleder", size: "918x716" }] })),
  probeArticle: vi.fn(async (t: string) => ({
    title: t, article: t, outcome: "ok", ms: 30, userAgent: "GituasVideoBot/1.0 (+https://gituas.com)", listed: 2,
    results: [{ title: "File:Hinterkaifeck-Hof (cropped).jpg", ok: true, why: null, licence: "Public domain", author: "Andreas Biegleder", size: "918x564", about: true }],
  })),
}));

import { GET } from "@/app/api/cron/story-photos/route";
import { probeArticle, probeCommons } from "@/lib/advideo/commons";

const call = (qs: string, auth: string | null = "Bearer secret") =>
  GET(new Request(`https://gituas.com/api/cron/story-photos${qs}`, { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/story-photos", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("STORY_PHOTOS_ENABLED", "");
    vi.mocked(probeCommons).mockClear();
    vi.mocked(probeArticle).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a call without the cron secret, or with a wrong one, before it asks Wikimedia anything", async () => {
    expect((await call("?q=Hinterkaifeck", null)).status).toBe(401);
    expect((await call("?q=Hinterkaifeck", "Bearer nope")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("?q=Hinterkaifeck", "Bearer ")).status).toBe(401);
    expect((await call("?title=Mary+Celeste", null)).status).toBe(401);
    expect((await call("?title=Mary+Celeste", "Bearer nope")).status).toBe(401);
    expect(probeCommons).not.toHaveBeenCalled();
    expect(probeArticle).not.toHaveBeenCalled();
  });

  it("needs a search phrase or an article title", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?q=%20%20")).status).toBe(400);
    expect((await call("?title=%20%20")).status).toBe(400);
    expect((await call("?title=%3C%3E%7C%7B%7D")).status).toBe(400);
    expect(probeCommons).not.toHaveBeenCalled();
    expect(probeArticle).not.toHaveBeenCalled();
  });

  it("returns the verdict on the hits of one search, and whether the feature is switched on", async () => {
    const res = await call("?q=Hinterkaifeck+Hof");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(probeCommons).toHaveBeenCalledWith("Hinterkaifeck Hof");
    expect(body).toMatchObject({ enabled: true, outcome: "ok", results: [{ title: "File:Hinterkaifeck-Hof.jpg", ok: true, licence: "Public domain" }] });
    vi.stubEnv("STORY_PHOTOS_ENABLED", "0");
    expect((await (await call("?q=x+y")).json()).enabled).toBe(false);
  });

  it("returns the verdict on the pictures of a Wikipedia article for ?title=, and asks no search", async () => {
    const res = await call("?title=Hinterkaifeck+murders");
    expect(res.status).toBe(200);
    expect(probeArticle).toHaveBeenCalledWith("Hinterkaifeck murders");
    expect(probeCommons).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      enabled: true, article: "Hinterkaifeck murders", outcome: "ok", listed: 2,
      results: [{ title: "File:Hinterkaifeck-Hof (cropped).jpg", ok: true, about: true, size: "918x564" }],
    });
  });

  it("takes the title before the phrase when both are given, and cleans the title of anything that is not part of one", async () => {
    await call("?q=x+y&title=Mary+Celeste");
    expect(probeArticle).toHaveBeenCalledWith("Mary Celeste");
    expect(probeCommons).not.toHaveBeenCalled();
    await call(`?title=${encodeURIComponent("Dyatlov Pass incident|<script>{evil}")}`);
    expect(vi.mocked(probeArticle).mock.calls.at(-1)![0]).toBe("Dyatlov Pass incident script evil");
    await call(`?title=${encodeURIComponent("Ünïcode (1959)")}`);
    expect(vi.mocked(probeArticle).mock.calls.at(-1)![0]).toBe("Ünïcode (1959)");
  });

  it("shows the pictures as a wide (16:9) story would be offered them for &format=wide, and as a reel for anything else", async () => {
    const wideSearch = await (await call("?q=Hinterkaifeck+Hof&format=wide")).json();
    expect(probeCommons).toHaveBeenLastCalledWith("Hinterkaifeck Hof", undefined, undefined, "wide");
    expect(wideSearch).toMatchObject({ enabled: true, format: "wide", outcome: "ok" });
    const wideTitle = await (await call("?title=Hinterkaifeck+murders&format=wide")).json();
    expect(probeArticle).toHaveBeenLastCalledWith("Hinterkaifeck murders", undefined, undefined, "wide");
    expect(wideTitle).toMatchObject({ format: "wide", article: "Hinterkaifeck murders" });
    for (const qs of ["?q=Hinterkaifeck+Hof", "?q=Hinterkaifeck+Hof&format=vertical", "?q=Hinterkaifeck+Hof&format=square", "?q=Hinterkaifeck+Hof&format=WIDE"]) {
      vi.mocked(probeCommons).mockClear();
      expect(await (await call(qs)).json(), qs).toMatchObject({ format: "vertical" });
      expect(probeCommons, qs).toHaveBeenLastCalledWith("Hinterkaifeck Hof");
    }
  });

  it("cuts a very long title", async () => {
    await call(`?title=${"a".repeat(500)}`);
    expect(vi.mocked(probeArticle).mock.calls[0][0].length).toBe(120);
  });

  it("cuts a very long phrase", async () => {
    await call(`?q=${"a".repeat(500)}`);
    expect(vi.mocked(probeCommons).mock.calls[0][0].length).toBe(120);
  });
});
