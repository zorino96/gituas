import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// publishAdVideo: a rendered video goes to the store's Facebook Page and Instagram account and, when the owner has declared who may see it
// and whether it is made for kids, to the workspace's YouTube channel. The shared publisher and the list of YouTube channels are injected:
// nothing here reaches a platform or the database.

vi.mock("@/lib/db", () => ({
  db: {
    adVideo: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    store: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/merchant/publish-core", () => ({ publishForWorkspace: vi.fn() }));

import { db } from "@/lib/db";
import { publishAdVideo } from "@/lib/advideo/publish";
import type { PublishInput, PublishOutcome } from "@/lib/merchant/publish-core";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const URL_OK = "https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/ad.mp4";
const PATH_OK = "merchant/t1/advideo/j1/ad.mp4";
const YT = { privacy: "unlisted", madeForKids: false };
const SPEC = { style: "elegant", scenes: [{ type: "hook", text: "The Letter in the Drawer" }, { type: "cta", text: "Follow" }], subject: { name: "Hinterkaifeck murders", kind: "real" }, youtube: YT };
const CAPTION = "A true case that was never solved.\n\nPhotos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0)\n\n#unsolved";

const job = (over: Record<string, unknown> = {}) => ({
  id: "j1", tenantId: "t1", storeId: "s1", status: "RENDERED", tier: "LITE", source: "AUTO", productId: null,
  videoUrl: URL_OK, videoPath: PATH_OK, caption: CAPTION, targets: ["FB", "IG", "YT"], spec: SPEC, autoPost: true,
  ...over,
});

type Call = { input: PublishInput };
/** A publisher that answers per target and remembers what it was asked. */
function publisher(answers: Partial<Record<"FB" | "IG" | "YT", PublishOutcome | { error: string } | "throw" | "never">> = {}) {
  const calls: Call[] = [];
  const publish = vi.fn(async (_ws: unknown, input: PublishInput) => {
    calls.push({ input });
    const outcomes: PublishOutcome[] = [];
    for (const t of input.targets as ("FB" | "IG" | "YT")[]) {
      const a = answers[t] ?? { target: t, ok: true, url: `https://x/${t}`, externalId: `${t}-1` };
      if (a === "throw") throw new Error(`${t} exploded`);
      if (a === "never") return new Promise<never>(() => undefined);
      if ("error" in a && !("target" in a)) return a as { error: string };
      outcomes.push(a as PublishOutcome);
    }
    return outcomes;
  });
  return { publish: publish as unknown as NonNullable<Parameters<typeof publishAdVideo>[2]>["publish"], calls, fn: publish };
}
const ids = (...c: string[]) => async () => c;

const updated = () => m.adVideo.update.mock.calls.at(-1)![0] as { data: { status: string; autoPost?: boolean; error: string | null; results: unknown; postedAt: Date | null } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AD_VIDEO_ENABLED", "1");
  m.adVideo.findUnique.mockResolvedValue(job());
  m.adVideo.updateMany.mockResolvedValue({ count: 1 });
  m.adVideo.update.mockResolvedValue({});
  m.store.findUnique.mockResolvedValue({ fbPageId: "page1", igUserId: "ig1" });
  m.auditLog.create.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("publishAdVideo: Facebook and Instagram (as they always were)", () => {
  it("posts to the store's Page and Instagram account in one call, with the caption and the video, and marks the job POSTED", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["FB", "IG"], productId: "p1" }));
    const p = publisher();
    const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids() });
    expect(r).toMatchObject({ ok: true });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].input).toMatchObject({
      caption: CAPTION,
      targets: ["FB", "IG"],
      media: { url: URL_OK, pathname: PATH_OK, type: "VIDEO" },
      productId: "p1",
      accounts: { FB: ["page1"], IG: ["ig1"] },
    });
    expect(p.calls[0].input.igDeadlineMs).toBeGreaterThan(0);
    expect(p.calls[0].input).not.toHaveProperty("youtube");
    expect(updated().data).toMatchObject({ status: "POSTED", error: null });
    expect(updated().data.postedAt).toBeInstanceOf(Date);
    expect(updated().data).not.toHaveProperty("autoPost");
    expect((updated().data.results as PublishOutcome[]).map((o) => o.target)).toEqual(["FB", "IG"]);
    expect(m.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "advideo.posted", actor: "SYSTEM", metadata: { targets: ["FB", "IG"] } });
  });

  it("uses only the platforms the store has connected, and posts nothing when it has none", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["FB", "IG"] }));
    m.store.findUnique.mockResolvedValue({ fbPageId: "page1", igUserId: null });
    const p = publisher();
    await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids() });
    expect(p.calls[0].input.targets).toEqual(["FB"]);
    expect(p.calls[0].input.accounts).toEqual({ FB: ["page1"] });
    m.store.findUnique.mockResolvedValue({ fbPageId: null, igUserId: null });
    p.fn.mockClear();
    m.adVideo.updateMany.mockClear();
    expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids() })).toEqual({ ok: false, error: "targets" });
    expect(p.fn).not.toHaveBeenCalled();
    expect(m.adVideo.updateMany).not.toHaveBeenCalled();
  });

  it("answers what the publisher said when it refused the whole post (an error, not a list)", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["FB", "IG"] }));
    const p = publisher({ FB: { error: "caption too long" } });
    const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids() });
    expect(r).toMatchObject({ ok: false, error: "failed", results: { error: "caption too long" } });
    expect(updated().data).toMatchObject({ status: "RENDERED", autoPost: false, error: "caption too long", results: { error: "caption too long" } });
  });

  it("counts an Instagram post that is still being processed as taken", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["IG"] }));
    const p = publisher({ IG: { target: "IG", ok: false, pending: true, error: "processing" } });
    expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids() })).toMatchObject({ ok: true });
    expect(updated().data.status).toBe("POSTED");
  });

  it("never posts a video that is not RENDERED, or whose file is not this workspace's own, or with the switch off", async () => {
    const p = publisher();
    const deps = { publish: p.publish, channels: ids() };
    m.adVideo.findUnique.mockResolvedValue(job({ status: "POSTED" }));
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "state" });
    m.adVideo.findUnique.mockResolvedValue(job({ videoUrl: "https://evil.example/ad.mp4" }));
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "media" });
    m.adVideo.findUnique.mockResolvedValue(job({ videoPath: "merchant/other/advideo/j1/ad.mp4" }));
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "media" });
    m.adVideo.findUnique.mockResolvedValue(null);
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "state" });
    vi.stubEnv("AD_VIDEO_ENABLED", "");
    m.adVideo.findUnique.mockResolvedValue(job());
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "state" });
    expect(p.fn).not.toHaveBeenCalled();
  });

  it("does not post twice: when another caller already took the video, nothing is sent", async () => {
    const p = publisher();
    m.adVideo.updateMany.mockResolvedValue({ count: 0 });
    expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") })).toEqual({ ok: false, error: "state" });
    expect(p.fn).not.toHaveBeenCalled();
    expect(m.adVideo.update).not.toHaveBeenCalled();
  });

  it("claims the video (RENDERED to POSTING) before anything is sent", async () => {
    const order: string[] = [];
    m.adVideo.updateMany.mockImplementation(async () => (order.push("claim"), { count: 1 }));
    const publish = vi.fn(async () => (order.push("send"), [{ target: "FB", ok: true }])) as unknown as NonNullable<Parameters<typeof publishAdVideo>[2]>["publish"];
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["FB"] }));
    await publishAdVideo("j1", undefined, { publish, channels: ids() });
    expect(order).toEqual(["claim", "send"]);
    expect(m.adVideo.updateMany.mock.calls[0][0]).toEqual({ where: { id: "j1", status: "RENDERED" }, data: { status: "POSTING" } });
  });
});

describe("publishAdVideo: YouTube", () => {
  it("uploads a video whose owner declared who may see it: its own call, with the title, the description, the privacy and the audience", async () => {
    const p = publisher();
    const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
    expect(r).toMatchObject({ ok: true });
    // Facebook and Instagram in one call, YouTube in a call of its own
    expect(p.calls).toHaveLength(2);
    const social = p.calls.find((c) => c.input.targets.includes("FB"))!.input;
    const yt = p.calls.find((c) => c.input.targets.includes("YT"))!.input;
    expect(social.targets).toEqual(["FB", "IG"]);
    expect(social).not.toHaveProperty("youtube");
    expect(yt.targets).toEqual(["YT"]);
    expect(yt.media).toEqual({ url: URL_OK, pathname: PATH_OK, type: "VIDEO" });
    expect(yt.accounts).toEqual({ YT: ["UC1"] });
    expect(yt.youtube).toEqual({
      title: "Hinterkaifeck murders",
      // the caption as it is, the credits in it included
      description: CAPTION,
      privacy: "unlisted",
      madeForKids: false,
    });
    expect(updated().data).toMatchObject({ status: "POSTED", error: null });
    expect((updated().data.results as PublishOutcome[]).map((o) => o.target).sort()).toEqual(["FB", "IG", "YT"]);
    expect(m.auditLog.create.mock.calls[0][0].data.metadata.targets).toEqual(["FB", "IG", "YT"]);
  });

  it("posts a video that is only for YouTube (no Page, no Instagram account)", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"] }));
    m.store.findUnique.mockResolvedValue({ fbPageId: null, igUserId: null });
    const p = publisher();
    expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") })).toMatchObject({ ok: true });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].input.targets).toEqual(["YT"]);
  });

  it("takes the platforms asked for by the caller over the ones the job was made with", async () => {
    const p = publisher();
    await publishAdVideo("j1", ["YT"], { publish: p.publish, channels: ids("UC1") });
    expect(p.calls.map((c) => c.input.targets)).toEqual([["YT"]]);
    p.calls.length = 0;
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"] }));
    await publishAdVideo("j1", ["FB"], { publish: p.publish, channels: ids("UC1") });
    expect(p.calls.map((c) => c.input.targets)).toEqual([["FB"]]);
  });

  it("names the upload by the hook's text when the video has no case, and keeps the title to 100 characters without angle brackets", async () => {
    const noCase = { ...SPEC, subject: undefined, scenes: [{ type: "hook", text: "The <b>Letter</b> in the Drawer ".repeat(8) }, { type: "cta", text: "Follow" }] };
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], spec: noCase }));
    const p = publisher();
    await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
    const title = p.calls[0].input.youtube!.title;
    expect(Array.from(title).length).toBeLessThanOrEqual(100);
    expect(title).not.toMatch(/[<>]/);
    expect(title.startsWith("The b Letter /b in the Drawer")).toBe(true);
    // with neither a case nor a hook, the first line of the caption is the title
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], spec: { youtube: YT } }));
    await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
    expect(p.calls.at(-1)!.input.youtube!.title).toBe("A true case that was never solved.");
  });

  it("keeps the description to 5000 bytes (Arabic letters take two each) and without angle brackets", async () => {
    const long = "ئەمە چیرۆکێکی <b>ڕاستەقینەیە</b> ".repeat(300);
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], caption: long }));
    const p = publisher();
    await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
    const d = p.calls[0].input.youtube!.description;
    expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(5000);
    expect(d.length).toBeGreaterThan(1000);
    expect(d).not.toMatch(/[<>]/);
  });

  it("passes the owner's privacy and audience as they are (public, kids)", async () => {
    m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], spec: { ...SPEC, youtube: { privacy: "public", madeForKids: true } } }));
    const p = publisher();
    await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
    expect(p.calls[0].input.youtube).toMatchObject({ privacy: "public", madeForKids: true });
  });

  describe("a YouTube target that cannot be uploaded is skipped with a reason, never guessed", () => {
    const NO_ANSWERS = [
      ["no declarations at all", { ...SPEC, youtube: undefined }],
      ["no privacy", { ...SPEC, youtube: { madeForKids: false } }],
      ["a privacy YouTube does not have", { ...SPEC, youtube: { privacy: "everyone", madeForKids: false } }],
      ["no audience", { ...SPEC, youtube: { privacy: "public" } }],
      ["an audience that is not true or false", { ...SPEC, youtube: { privacy: "public", madeForKids: "no" } }],
    ] as const;

    it("posts the others and says why YouTube was left out", async () => {
      for (const [why, spec] of NO_ANSWERS) {
        m.adVideo.update.mockClear();
        const p = publisher();
        m.adVideo.findUnique.mockResolvedValue(job({ spec }));
        const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
        expect(r, why).toMatchObject({ ok: true });
        // YouTube was never asked
        expect(p.calls.every((c) => !c.input.targets.includes("YT")), why).toBe(true);
        const results = updated().data.results as { target: string; ok: boolean; error?: string; skipped?: boolean }[];
        const skipped = results.find((o) => o.target === "YT")!;
        expect(skipped, why).toMatchObject({ ok: false, skipped: true });
        expect(skipped.error, why).toContain("YouTube was skipped");
        expect(updated().data.status, why).toBe("POSTED");
        expect(updated().data.error, why).toContain("YT: YouTube was skipped");
      }
    });

    it("keeps a video that is only for YouTube as it is (RENDERED, not posted by itself again) with the reason", async () => {
      for (const [why, spec] of NO_ANSWERS) {
        m.adVideo.update.mockClear();
        m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], spec }));
        m.store.findUnique.mockResolvedValue({ fbPageId: null, igUserId: null });
        const p = publisher();
        const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
        expect(r, why).toMatchObject({ ok: false, error: "failed" });
        expect(p.fn, why).not.toHaveBeenCalled();
        expect(updated().data, why).toMatchObject({ status: "RENDERED", autoPost: false, postedAt: null });
        expect(updated().data.error, why).toContain("YT: YouTube was skipped");
      }
    });

    it("skips it when there is nothing to name the upload by", async () => {
      m.adVideo.findUnique.mockResolvedValue(job({ targets: ["YT"], caption: "", spec: { youtube: YT } }));
      m.store.findUnique.mockResolvedValue({ fbPageId: null, igUserId: null });
      const p = publisher();
      await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
      expect(p.fn).not.toHaveBeenCalled();
      expect(updated().data.error).toContain("title");
    });

    it("skips it when no YouTube channel is connected, or when several are (the owner picks one in Publish)", async () => {
      for (const [list, text] of [[[], "no YouTube channel"], [["UC1", "UC2"], "several YouTube channels"]] as const) {
        m.adVideo.update.mockClear();
        const p = publisher();
        await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids(...list) });
        expect(p.calls.every((c) => !c.input.targets.includes("YT")), text).toBe(true);
        expect(updated().data.error, text).toContain(text);
        expect(updated().data.status).toBe("POSTED");
      }
    });

    it("treats a channel lookup that fails as no channel", async () => {
      const p = publisher();
      await publishAdVideo("j1", undefined, { publish: p.publish, channels: async () => Promise.reject(new Error("db down")) });
      expect(p.calls.every((c) => !c.input.targets.includes("YT"))).toBe(true);
      expect(updated().data.error).toContain("no YouTube channel");
    });
  });

  describe("a failed YouTube upload does not block Facebook and Instagram, and the other way round", () => {
    it("posts them and reports YouTube's reason when YouTube refuses", async () => {
      const p = publisher({ YT: { target: "YT", ok: false, error: "YouTube upload 403: quota" } });
      const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
      expect(r).toMatchObject({ ok: true });
      expect(updated().data).toMatchObject({ status: "POSTED", error: "YT: YouTube upload 403: quota" });
      const results = updated().data.results as { target: string; ok: boolean }[];
      expect(results.filter((o) => o.ok).map((o) => o.target).sort()).toEqual(["FB", "IG"]);
    });

    it("posts them when the YouTube call throws", async () => {
      const p = publisher({ YT: "throw" });
      expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") })).toMatchObject({ ok: true });
      expect(updated().data.error).toBe("YT: YT exploded");
    });

    it("posts them when the YouTube call is answered with an error and no list (the publisher refused the upload)", async () => {
      const p = publisher({ YT: { error: "Choose who can see the video and who it is for" } });
      expect(await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") })).toMatchObject({ ok: true });
      expect(updated().data.error).toContain("YT: Choose who can see");
    });

    it("stops waiting for YouTube after a while, says the upload may still arrive, and is not started again", async () => {
      const p = publisher({ YT: "never" });
      const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1"), youtubeWaitMs: 20 });
      expect(r).toMatchObject({ ok: true });
      expect(updated().data.error).toContain("YT: YouTube did not answer in time");
      expect(updated().data.error).toContain("YouTube Studio");
      expect(p.calls.filter((c) => c.input.targets.includes("YT"))).toHaveLength(1);
    });

    it("keeps the video when YouTube took it and Facebook and Instagram did not", async () => {
      const p = publisher({ FB: { target: "FB", ok: false, error: "token expired" }, IG: { target: "IG", ok: false, error: "token expired" } });
      const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
      expect(r).toMatchObject({ ok: true });
      expect(updated().data.status).toBe("POSTED");
      expect(updated().data.error).toContain("FB: token expired");
    });

    it("leaves the video RENDERED with every reason, and no automatic second try, when nothing took it", async () => {
      const p = publisher({ FB: { target: "FB", ok: false, error: "fb down" }, IG: { target: "IG", ok: false, error: "ig down" }, YT: { target: "YT", ok: false, error: "yt down" } });
      const r = await publishAdVideo("j1", undefined, { publish: p.publish, channels: ids("UC1") });
      expect(r).toMatchObject({ ok: false, error: "failed" });
      expect(updated().data).toMatchObject({ status: "RENDERED", autoPost: false, postedAt: null });
      for (const t of ["FB: fb down", "IG: ig down", "YT: yt down"]) expect(updated().data.error).toContain(t);
    });
  });

  it("never sends YouTube more than once for one video: a second call finds it already taken", async () => {
    const p = publisher();
    const deps = { publish: p.publish, channels: ids("UC1") };
    expect(await publishAdVideo("j1", undefined, deps)).toMatchObject({ ok: true });
    m.adVideo.findUnique.mockResolvedValue(job({ status: "POSTED" }));
    expect(await publishAdVideo("j1", undefined, deps)).toEqual({ ok: false, error: "state" });
    expect(p.calls.filter((c) => c.input.targets.includes("YT"))).toHaveLength(1);
  });
});
