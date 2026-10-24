import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// What the render worker (adfilm/worker.mjs fetch) keeps of a job's scenes once the files are downloaded: an ad drops
// a scene whose photo or clip could not be fetched, a story never drops a beat (its sentence is part of the plot).
// The rule lives in adfilm/scenes.mjs, a plain module, so it runs here without a network.

type Scene = Record<string, unknown> & { type: string };
type Settle = (scenes: Scene[], fetched: { photos: (string | null)[]; clipIndex: Map<number, number>; story?: boolean }) => Scene[];

async function settle(): Promise<Settle> {
  // a variable path: the module is JavaScript and has no types
  const url = pathToFileURL(path.join(process.cwd(), "adfilm", "scenes.mjs")).href;
  return ((await import(/* @vite-ignore */ url)) as { settleScenes: Settle }).settleScenes;
}

const noClips = new Map<number, number>();
const scene = (type: string, over: Record<string, unknown> = {}): Scene => ({ type, text: type, voice: `say ${type}`, audio: `${type}.mp3`, ...over });

describe("settleScenes (an ad)", () => {
  it("drops a product scene whose photo could not be fetched, and keeps the one whose photo came", async () => {
    const out = (await settle())([scene("hook"), scene("product", { photo: 0 }), scene("product", { photo: 1 }), scene("cta")], { photos: ["photo-0.jpg", null], clipIndex: noClips });
    expect(out.map((s) => `${s.type}${s.photo ?? ""}`)).toEqual(["hook", "product0", "cta"]);
  });

  it("drops a footage scene whose clip could not be fetched, and maps the clip index of the ones that came", async () => {
    // clip 0 failed, clip 1 came and is now clip 0
    const out = (await settle())([scene("footage", { clip: 0 }), scene("footage", { clip: 1 }), scene("cta")], { photos: [], clipIndex: new Map([[1, 0]]) });
    expect(out.map((s) => `${s.type}${s.clip ?? ""}`)).toEqual(["footage0", "cta"]);
  });

  it("leaves the other scenes as they are", async () => {
    const value = scene("value", { icon: "gem" });
    const out = (await settle())([value], { photos: [], clipIndex: noClips });
    expect(out[0]).toBe(value);
  });
});

describe("settleScenes (a story)", () => {
  it("keeps a footage beat whose clip could not be fetched, on the look's own background, with its words", async () => {
    const out = (await settle())([scene("hook"), scene("footage", { clip: 0, text: "The door", voice: "Nobody knocked." }), scene("cta")], { photos: [], clipIndex: noClips, story: true });
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ type: "story", text: "The door", voice: "Nobody knocked.", audio: "footage.mp3", photo: null, clip: null });
  });

  it("keeps a footage beat whose clip came, as footage, with its new clip index", async () => {
    const out = (await settle())([scene("footage", { clip: 2 })], { photos: [], clipIndex: new Map([[2, 0]]), story: true });
    expect(out[0]).toMatchObject({ type: "footage", clip: 0 });
  });

  it("keeps a story beat whose picture or clip could not be fetched, without them", async () => {
    const out = (await settle())(
      [scene("story", { photo: 1, clip: null }), scene("story", { photo: 0, clip: 1 }), scene("story", { photo: null, clip: 0 })],
      { photos: ["photo-0.jpg", null], clipIndex: new Map([[1, 0]]), story: true },
    );
    expect(out.map((s) => [s.photo, s.clip])).toEqual([[null, null], [0, 0], [null, null]]);
  });
});

describe("settleScenes: the hook of a story", () => {
  it("keeps the photograph of a story's hook when it came, and the hook's words", async () => {
    const out = (await settle())([scene("hook", { photo: 1, text: "Hinterkaifeck" }), scene("story", { photo: 0 }), scene("cta")], { photos: ["photo-0.jpg", "photo-1.jpg"], clipIndex: noClips, story: true });
    expect(out.map((s) => s.type)).toEqual(["hook", "story", "cta"]);
    expect(out[0]).toMatchObject({ type: "hook", text: "Hinterkaifeck", photo: 1, audio: "hook.mp3" });
  });

  it("leaves a story's hook on the look's own background when its photograph could not be fetched, and never drops it", async () => {
    const out = (await settle())([scene("hook", { photo: 1 }), scene("story", { photo: 1 }), scene("cta")], { photos: ["photo-0.jpg", null], clipIndex: noClips, story: true });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: "hook", photo: null });
    expect(out[1]).toMatchObject({ type: "story", photo: null });
  });

  it("gives a hook with no photograph, or one that is not an index, none", async () => {
    const out = (await settle())([scene("hook"), scene("hook", { photo: "x" }), scene("hook", { photo: 7 })], { photos: ["photo-0.jpg"], clipIndex: noClips, story: true });
    expect(out.map((s) => s.photo)).toEqual([null, null, null]);
  });

  it("keeps the place of a photograph beyond the owner's six: the stored photographs come after them, up to sixteen in all, in any language", async () => {
    // photo 7 could not be fetched; photo 16 does not exist (the renderer takes sixteen)
    const photos = Array.from({ length: 16 }, (_, i) => (i === 7 ? null : `photo-${i}.jpg`));
    const out = (await settle())([scene("hook", { photo: 6 }), scene("story", { photo: 7 }), scene("story", { photo: 15 }), scene("story", { photo: 16 })], { photos, clipIndex: noClips, story: true });
    expect(out.map((s) => s.photo)).toEqual([6, null, 15, null]);
  });

  it("never touches the closing invitation", async () => {
    const cta = scene("cta", { photo: 0 });
    const out = (await settle())([cta], { photos: ["photo-0.jpg"], clipIndex: noClips, story: true });
    expect(out[0]).toBe(cta);
  });
});

describe("settleScenes: the hook of an ad", () => {
  it("is returned as it is, whatever the photographs", async () => {
    const hook = scene("hook", { photo: 0 });
    const out = (await settle())([hook], { photos: [null], clipIndex: noClips });
    expect(out[0]).toBe(hook);
    const outStory = (await settle())([hook], { photos: [null], clipIndex: noClips, story: false });
    expect(outStory[0]).toBe(hook);
  });
});

async function helpers() {
  const url = pathToFileURL(path.join(process.cwd(), "adfilm", "scenes.mjs")).href;
  return (await import(/* @vite-ignore */ url)) as {
    frameOf: (props: Record<string, unknown>) => { wide: boolean; size: [number, number] };
    cleanCredits: (list: unknown, story?: boolean) => string[];
  };
}

describe("frameOf: the frame a job is drawn on", () => {
  it("is 1920x1080 for a story that asked for the wide format, and only for a story", async () => {
    const { frameOf } = await helpers();
    expect(frameOf({ kind: "story", format: "wide" })).toEqual({ wide: true, size: [1920, 1080] });
    // an ad is the vertical reel, whatever else the job says
    expect(frameOf({ format: "wide" })).toEqual({ wide: false, size: [1080, 1920] });
    expect(frameOf({ kind: "ad", format: "wide" })).toEqual({ wide: false, size: [1080, 1920] });
  });

  it("is the vertical 1080x1920 reel for every other job, old ones (no kind, no format) included", async () => {
    const { frameOf } = await helpers();
    for (const props of [{}, { kind: "story" }, { kind: "story", format: "vertical" }, { kind: "story", format: "square" }, { kind: "story", format: 1 }]) {
      expect(frameOf(props), JSON.stringify(props)).toEqual({ wide: false, size: [1080, 1920] });
    }
    expect(frameOf(null as unknown as Record<string, unknown>)).toEqual({ wide: false, size: [1080, 1920] });
  });
});

describe("cleanCredits: the photo credit lines a story's closing scene draws", () => {
  it("keeps at most three plain lines of at most 200 characters, with the spaces collapsed", async () => {
    const { cleanCredits } = await helpers();
    const out = cleanCredits(["Photos:   Wikimedia  Commons", "x".repeat(300), "Name, CC BY 2.0", "a fourth line"]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Photos: Wikimedia Commons");
    expect(out[1]).toHaveLength(200);
    expect(out[2]).toBe("Name, CC BY 2.0");
  });

  it("drops what is not text, empty lines, and control characters", async () => {
    const { cleanCredits } = await helpers();
    expect(cleanCredits(["a\u0000b\nc", 5, null, "  ", { x: 1 }, "ok"])).toEqual(["a b c", "ok"]);
  });

  it("gives nothing for an ad, and nothing when the job's credits are not a list", async () => {
    const { cleanCredits } = await helpers();
    expect(cleanCredits(["Photos: Wikimedia Commons"], false)).toEqual([]);
    for (const v of [undefined, null, "Photos", 5, { 0: "x" }]) expect(cleanCredits(v)).toEqual([]);
  });

  it("keeps Sorani and Arabic lines as they are", async () => {
    const { cleanCredits } = await helpers();
    expect(cleanCredits(["وێنەکان: ویکیمیدیا کۆمۆنز", "الصور: ويكيميديا كومنز"])).toEqual(["وێنەکان: ویکیمیدیا کۆمۆنز", "الصور: ويكيميديا كومنز"]);
  });
});
