import { describe, it, expect } from "vitest";
import { youtubeBlock } from "@/lib/merchant/youtube-insights";

const video = (id: string, views: number) => ({ id, permalinkUrl: `https://youtu.be/${id}`, views, likes: 0, comments: 0 });

describe("youtubeBlock", () => {
  it("labels the tiles in a fixed order and keeps the three most-viewed videos", () => {
    const b = youtubeBlock(
      { ok: true, data: [{ name: "views", value: 900 }, { name: "videos", value: 7 }, { name: "subscribers", value: 120 }] },
      { ok: true, data: [video("a", 5), video("b", 50), video("c", 20), video("d", 30)] },
    );
    expect(b.tiles).toEqual([
      { key: "subscribers", label: "بەشداربوو", value: 120 },
      { key: "views", label: "بینین", value: 900 },
      { key: "videos", label: "ڤیدیۆ", value: 7 },
    ]);
    expect(b.top.map((v) => v.id)).toEqual(["b", "d", "c"]);
    expect(b.error).toBeNull();
  });
  it("omits the subscriber tile when the channel hides it", () => {
    const b = youtubeBlock({ ok: true, data: [{ name: "views", value: 1 }, { name: "videos", value: 2 }] }, { ok: true, data: [] });
    expect(b.tiles.map((t) => t.key)).toEqual(["views", "videos"]);
  });
  it("shows what arrived when only one call fails", () => {
    const b = youtubeBlock({ ok: false, error: "quota" }, { ok: true, data: [video("a", 3)] });
    expect(b.tiles).toEqual([]);
    expect(b.top.map((v) => v.id)).toEqual(["a"]);
    expect(b.error).toBeNull();
  });
  it("reports an error only when both calls fail", () => {
    const b = youtubeBlock({ ok: false, error: "YouTube not connected" }, { ok: false, error: "x" });
    expect(b).toEqual({ tiles: [], top: [], error: "YouTube not connected" });
  });
  it("does not reorder the caller's list", () => {
    const list = [video("a", 1), video("b", 2)];
    youtubeBlock({ ok: true, data: [] }, { ok: true, data: list });
    expect(list.map((v) => v.id)).toEqual(["a", "b"]);
  });
});
