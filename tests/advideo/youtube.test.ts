import { describe, expect, it } from "vitest";

import { youtubeChoiceOf, youtubeOptionsOf, ytDescriptionOf, ytTitleOf } from "@/lib/advideo/youtube";
import { ytDescriptionBytes } from "@/lib/merchant/caption";

describe("youtubeChoiceOf: the owner's two answers", () => {
  it("reads both when they are valid", () => {
    expect(youtubeChoiceOf({ privacy: "public", madeForKids: false })).toEqual({ privacy: "public", madeForKids: false });
    expect(youtubeChoiceOf({ privacy: "unlisted", madeForKids: true })).toEqual({ privacy: "unlisted", madeForKids: true });
    expect(youtubeChoiceOf({ privacy: "private", madeForKids: false, extra: 1 })).toEqual({ privacy: "private", madeForKids: false });
  });

  it("reads nothing otherwise: there is no default for either answer", () => {
    for (const bad of [null, undefined, 5, "public", [], {}, { privacy: "public" }, { madeForKids: true }, { privacy: "everyone", madeForKids: true }, { privacy: "", madeForKids: true }, { privacy: "public", madeForKids: "yes" }, { privacy: "public", madeForKids: 1 }, { privacy: 1, madeForKids: true }]) {
      expect(youtubeChoiceOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("ytTitleOf", () => {
  it("is the case's name, else the hook's text, else the first line of the caption", () => {
    const scenes = [{ type: "story", text: "Night" }, { type: "hook", text: "The Letter in the Drawer" }];
    expect(ytTitleOf({ subject: { name: "Mary Celeste" }, scenes }, "Caption")).toBe("Mary Celeste");
    expect(ytTitleOf({ scenes }, "Caption")).toBe("The Letter in the Drawer");
    expect(ytTitleOf({ subject: { name: "  " }, scenes: [] }, "A first line\nsecond")).toBe("A first line");
    expect(ytTitleOf({}, "")).toBe("");
    expect(ytTitleOf(null, null)).toBe("");
  });

  it("is at most 100 characters, without angle brackets, hidden characters or line breaks", () => {
    const ZW = String.fromCharCode(0x200b);
    const t = ytTitleOf({ subject: { name: `A <b>very</b> long${ZW} name\nacross lines `.repeat(10) } }, "");
    expect(Array.from(t).length).toBeLessThanOrEqual(100);
    expect(t).not.toMatch(/[<>\n]/);
    expect(t).not.toContain(ZW);
    expect(t.startsWith("A b very /b long name across lines")).toBe(true);
    // counted in characters, not in bytes: Kurdish letters are one each
    expect(Array.from(ytTitleOf({ subject: { name: "ک".repeat(150) } }, "")).length).toBe(100);
  });
});

describe("ytDescriptionOf", () => {
  it("is the caption, with its lines and its credits, without angle brackets", () => {
    const caption = "A true case.\n\nPhotos: Wikimedia Commons (Jane <Doe>, CC BY-SA 4.0)\n\n#unsolved";
    expect(ytDescriptionOf(caption)).toBe("A true case.\n\nPhotos: Wikimedia Commons (Jane  Doe , CC BY-SA 4.0)\n\n#unsolved".replace("Jane  Doe ,", "Jane Doe ,"));
    expect(ytDescriptionOf(caption)).not.toMatch(/[<>]/);
  });

  it("is at most 5000 UTF-8 bytes, cut between characters", () => {
    for (const unit of ["a", "ک", "😀"]) {
      const d = ytDescriptionOf(unit.repeat(4000));
      expect(ytDescriptionBytes(d), unit).toBeLessThanOrEqual(5000);
      expect(d.length, unit).toBeGreaterThan(1000);
      expect(d).not.toContain(String.fromCharCode(0xfffd));
    }
  });

  it("is empty for nothing", () => {
    expect(ytDescriptionOf("")).toBe("");
    expect(ytDescriptionOf(null)).toBe("");
    expect(ytDescriptionOf(undefined)).toBe("");
  });
});

describe("youtubeOptionsOf", () => {
  const spec = { subject: { name: "Hinterkaifeck murders" }, scenes: [], youtube: { privacy: "unlisted", madeForKids: false } };

  it("builds the options of an upload from the spec and the caption", () => {
    expect(youtubeOptionsOf(spec, "Caption #x")).toEqual({ ok: true, options: { title: "Hinterkaifeck murders", description: "Caption #x", privacy: "unlisted", madeForKids: false } });
  });

  it("gives a reason, and no options, without both answers or without a title", () => {
    for (const s of [{ ...spec, youtube: undefined }, { ...spec, youtube: { privacy: "unlisted" } }, null, "text"]) {
      const r = youtubeOptionsOf(s, "Caption");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("YouTube was skipped");
    }
    const noTitle = youtubeOptionsOf({ youtube: spec.youtube }, "");
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) expect(noTitle.reason).toContain("title");
  });
});
