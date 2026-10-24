import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), list: vi.fn(), head: vi.fn() }));
vi.mock("@/lib/voice/tts", () => ({ speak: vi.fn(), providersFor: () => [] }));
vi.mock("@/lib/news/video", () => ({ isNotSoraniRefusal: () => false }));
vi.mock("@/lib/shop/pipeline", () => ({ startOfShopDay: (d: Date) => d }));
vi.mock("@/lib/advideo/commons", async (orig) => ({ ...(await orig<typeof import("@/lib/advideo/commons")>()), findStoryPhotos: vi.fn(), deletePhotos: vi.fn(), STORY_PHOTO_BUDGET_MS: 16_000 }));

import type { FoundPhoto } from "@/lib/advideo/commons";
import type { PhotoCredit } from "@/lib/advideo/credits";
import { buildRenderProps, placeStoryPhotos, type RenderProps } from "@/lib/advideo/prepare";
import { lookFromSeed, type AdScene } from "@/lib/advideo/spec";

// Where a documented story's Commons photographs go in the render props: after the owner's own pictures, in the order of
// the beats, each beat pointing at its own, the writer's picture queries removed.

const scene = (type: AdScene["type"], over: Partial<AdScene> = {}): AdScene => ({ type, text: `t-${type}`, sub: null, voice: "v", icon: null, photo: null, clip: null, ...over });
const brief = (photos: string[]) => ({
  name: "B", tagline: null, deliveryNote: null, deliveryLine: null, primary: "#000000", accent: "#E0A526", logoUrl: null, handle: null, phone: null,
  product: null, catalog: [], photos, refPhotos: photos.length, refIndices: photos.map((_, i) => i), clips: [],
});
const credit = (scene: number): PhotoCredit => ({ scene, title: `File:P${scene}.jpg`, author: "A", licence: "CC BY-SA 4.0", licenceUrl: null, page: `https://commons.wikimedia.org/wiki/File:P${scene}.jpg`, attribution: true });
const shot = (s: number): FoundPhoto => ({ scene: s, url: `https://x.public.blob.vercel-storage.com/img-${s}.jpg`, credit: credit(s), via: "article" });

function props(scenes: AdScene[], owner: string[] = []): RenderProps {
  return buildRenderProps(
    brief(owner),
    { style: "elegant", look: lookFromSeed("s1"), plan: undefined, lang: "en", kind: "story" },
    scenes.map((s, i) => ({ scene: s, url: `https://x.public.blob.vercel-storage.com/vo-${i}.wav` })),
  );
}

const SCRIPT = (): AdScene[] => [
  scene("hook", { queries: ["Hinterkaifeck farm"], visual: "the farm" }),
  scene("story", { queries: ["Bavaria 1922"], visual: "a road" }),
  scene("story", { queries: ["barn"], visual: "a barn" }),
  scene("story"),
  scene("cta"),
];

describe("placeStoryPhotos", () => {
  it("appends the photographs after the owner's pictures and points each beat at its own", () => {
    const base = props(SCRIPT(), ["https://x.public.blob.vercel-storage.com/own0.jpg", "https://x.public.blob.vercel-storage.com/own1.jpg"]);
    const r = placeStoryPhotos(base, [shot(0), shot(1), shot(3)]);
    expect(r.props.photos).toEqual([
      "https://x.public.blob.vercel-storage.com/own0.jpg",
      "https://x.public.blob.vercel-storage.com/own1.jpg",
      "https://x.public.blob.vercel-storage.com/img-0.jpg",
      "https://x.public.blob.vercel-storage.com/img-1.jpg",
      "https://x.public.blob.vercel-storage.com/img-3.jpg",
    ]);
    expect(r.props.scenes.map((s) => s.photo)).toEqual([2, 3, null, 4, null]);
    expect(r.placed.map((p) => p.scene)).toEqual([0, 1, 3]);
  });

  it("numbers the photographs from zero when the owner gave none, whatever the order they were found in", () => {
    const r = placeStoryPhotos(props(SCRIPT()), [shot(3), shot(0)]);
    expect(r.props.photos).toEqual(["https://x.public.blob.vercel-storage.com/img-0.jpg", "https://x.public.blob.vercel-storage.com/img-3.jpg"]);
    expect(r.props.scenes.map((s) => s.photo)).toEqual([0, null, null, 1, null]);
  });

  it("never lets the writer's picture queries or notes reach the renderer, with photographs or without", () => {
    for (const found of [[shot(0)], []]) {
      const r = placeStoryPhotos(props(SCRIPT()), found);
      for (const s of r.props.scenes) {
        expect(s).not.toHaveProperty("queries");
        expect(s).not.toHaveProperty("visual");
      }
    }
  });

  it("changes nothing else: with no photographs the props are the same but for the dropped keys", () => {
    const base = props(SCRIPT(), ["https://x.public.blob.vercel-storage.com/own0.jpg"]);
    const r = placeStoryPhotos(base, []);
    expect(r.placed).toEqual([]);
    expect(r.props.photos).toEqual(base.photos);
    expect(r.props.scenes.map(({ text, voice, type, photo, clip, audio }) => ({ text, voice, type, photo, clip, audio }))).toEqual(
      base.scenes.map(({ text, voice, type, photo, clip, audio }) => ({ text, voice, type, photo, clip, audio })),
    );
    expect({ ...r.props, scenes: undefined }).toEqual({ ...base, scenes: undefined });
  });

  it("leaves a beat that has an owner's picture or clip alone, and does not use up a photograph on it", () => {
    const script = [scene("hook"), scene("story", { photo: 0 }), scene("footage", { clip: 0 }), scene("story"), scene("cta")];
    const r = placeStoryPhotos(props(script, ["https://x.public.blob.vercel-storage.com/own0.jpg"]), [shot(1), shot(2), shot(3)]);
    expect(r.props.scenes.map((s) => s.photo)).toEqual([null, 0, null, 1, null]);
    expect(r.props.photos).toEqual(["https://x.public.blob.vercel-storage.com/own0.jpg", "https://x.public.blob.vercel-storage.com/img-3.jpg"]);
    expect(r.placed.map((p) => p.scene)).toEqual([3]);
  });

  it("gives the closing invitation no photograph, and ignores a scene that is not there or comes twice", () => {
    const r = placeStoryPhotos(props(SCRIPT()), [shot(4), shot(9), shot(-1), shot(1), { ...shot(1), url: "https://x.public.blob.vercel-storage.com/other.jpg" }]);
    expect(r.props.photos).toEqual(["https://x.public.blob.vercel-storage.com/img-1.jpg"]);
    expect(r.props.scenes[4].photo).toBeNull();
    expect(r.props.scenes[1].photo).toBe(0);
  });

  it("places the photographs of a Sorani story the same way: the language changes nothing here and is still not written into the props", () => {
    const sorani = buildRenderProps(
      brief([]),
      { style: "elegant", look: lookFromSeed("s1"), plan: undefined, kind: "story" },
      SCRIPT().map((s, i) => ({ scene: s, url: `https://x.public.blob.vercel-storage.com/vo-${i}.wav` })),
    );
    expect(sorani).not.toHaveProperty("lang");
    const r = placeStoryPhotos(sorani, [shot(0), shot(2)]);
    expect(r.props.kind).toBe("story");
    expect(r.props).not.toHaveProperty("lang");
    expect(r.props.photos).toEqual(["https://x.public.blob.vercel-storage.com/img-0.jpg", "https://x.public.blob.vercel-storage.com/img-2.jpg"]);
    expect(r.props.scenes.map((s) => s.photo)).toEqual([0, null, 1, null, null]);
  });

  it("puts nothing in the props but the stored photographs' own addresses: a photograph's source, credit and origin stay out of what the renderer gets", () => {
    const r = placeStoryPhotos(props(SCRIPT()), [{ ...shot(0), via: "search" }, shot(1)]);
    const json = JSON.stringify(r.props);
    expect(json).not.toContain("commons.wikimedia.org");
    expect(json).not.toContain("upload.wikimedia.org");
    expect(json).not.toContain("\"via\"");
    expect(json).not.toContain("licence");
    for (const u of r.props.photos) expect(u).toMatch(/^https:\/\/x\.public\.blob\.vercel-storage\.com\//);
  });

  it("credits exactly the photographs it placed", () => {
    const r = placeStoryPhotos(props(SCRIPT()), [shot(0), shot(4)]);
    expect(r.placed.map((p) => p.credit.scene)).toEqual([0]);
  });
});

describe("the wide (16:9) format in the render props", () => {
  const voiced = () => SCRIPT().map((s, i) => ({ scene: s, url: `https://x.public.blob.vercel-storage.com/vo-${i}.wav` }));
  const build = (spec: Record<string, unknown>) =>
    buildRenderProps(brief([]), { style: "elegant", look: lookFromSeed("s1"), plan: undefined, ...spec } as Parameters<typeof buildRenderProps>[1], voiced());

  it("sets the size 1920x1080 and writes the format for a story that asked for it", () => {
    const wide = build({ lang: "en", kind: "story", format: "wide" });
    expect(wide.size).toEqual([1920, 1080]);
    expect(wide.format).toBe("wide");
    expect(wide.kind).toBe("story");
  });

  it("writes no format and the reel's size for a story that did not ask, whatever else the spec says", () => {
    for (const format of [undefined, "vertical"]) {
      const p = build({ lang: "en", kind: "story", format });
      expect(p.size).toEqual([1080, 1920]);
      expect(p).not.toHaveProperty("format");
    }
  });

  it("never makes an ad wide: an ad is always the vertical reel", () => {
    const p = build({ lang: "ar", format: "wide" });
    expect(p.size).toEqual([1080, 1920]);
    expect(p).not.toHaveProperty("format");
    expect(p).not.toHaveProperty("kind");
  });

  it("keeps the placed photographs and the writer's keys apart from the frame: placing photographs does not change the format or the size", () => {
    const r = placeStoryPhotos(build({ lang: "ckb", kind: "story", format: "wide" }), [shot(0), shot(1)]);
    expect(r.props.size).toEqual([1920, 1080]);
    expect(r.props.format).toBe("wide");
    expect(r.props.photos).toHaveLength(2);
    // (Sorani is the default language and is still not written)
    expect(r.props).not.toHaveProperty("lang");
  });

  it("writes no credit lines by itself: the closing scene's credits come from the photographs that were kept", () => {
    expect(build({ lang: "en", kind: "story", format: "wide" })).not.toHaveProperty("credits");
  });
});
