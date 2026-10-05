import { describe, expect, it } from "vitest";

import { clearDraft, draftKey, DRAFT_MAX_AGE_MS, readDraft, writeDraft, type PublishDraft } from "@/app/app/publish/draft";

/** A Storage stand-in: a plain map. */
function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const WS = "ws1";
const NOW = 1_800_000_000_000;
const MEDIA = { url: `https://abc.public.blob.vercel-storage.com/merchant/${WS}/1.mp4`, pathname: `merchant/${WS}/1.mp4`, type: "VIDEO" as const, durationSec: 17 };
const draft = (over: Partial<PublishDraft> = {}): PublishDraft => ({
  caption: "سڵاو",
  media: MEDIA,
  targets: ["FB", "YT"],
  productId: "",
  mode: "now",
  runAtLocal: "",
  savedAt: NOW,
  ...over,
});

describe("publish drafts", () => {
  it("keeps a draft per workspace and gives it back", () => {
    const s = memory();
    writeDraft(s, WS, draft());
    expect(readDraft(s, WS, NOW)).toEqual(draft());
    expect(readDraft(s, "other", NOW)).toBeNull();
  });

  it("forgets the draft when nothing is left worth keeping", () => {
    const s = memory();
    writeDraft(s, WS, draft());
    writeDraft(s, WS, draft({ caption: "  ", media: null }));
    expect(s.data.has(draftKey(WS))).toBe(false);
  });

  it("keeps text alone and media alone", () => {
    const s = memory();
    writeDraft(s, WS, draft({ media: null }));
    expect(readDraft(s, WS, NOW)?.caption).toBe("سڵاو");
    writeDraft(s, WS, draft({ caption: "" }));
    expect(readDraft(s, WS, NOW)?.media).toEqual(MEDIA);
  });

  it("drops a draft that is too old", () => {
    const s = memory();
    writeDraft(s, WS, draft());
    expect(readDraft(s, WS, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("refuses media that is not this workspace's upload in our Blob store", () => {
    const s = memory();
    for (const media of [
      { ...MEDIA, url: "https://evil.example.com/merchant/ws1/1.mp4" },
      { ...MEDIA, url: "https://abc.public.blob.vercel-storage.com/merchant/other/1.mp4" },
      { ...MEDIA, pathname: "merchant/other/1.mp4" },
    ]) {
      s.setItem(draftKey(WS), JSON.stringify(draft({ media })));
      expect(readDraft(s, WS, NOW)).toBeNull();
    }
  });

  it("refuses broken or foreign entries", () => {
    const s = memory();
    for (const raw of ["not json", "{}", JSON.stringify({ ...draft(), targets: ["XX"] }), JSON.stringify({ ...draft(), mode: "soon" })]) {
      s.setItem(draftKey(WS), raw);
      expect(readDraft(s, WS, NOW)).toBeNull();
    }
  });

  it("survives storage that is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readDraft(null, WS, NOW)).toBeNull();
    expect(readDraft(broken, WS, NOW)).toBeNull();
    expect(() => writeDraft(broken, WS, draft())).not.toThrow();
    expect(() => clearDraft(broken, WS)).not.toThrow();
  });

  it("clears on request", () => {
    const s = memory();
    writeDraft(s, WS, draft());
    clearDraft(s, WS);
    expect(readDraft(s, WS, NOW)).toBeNull();
  });
});
