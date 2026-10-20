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
