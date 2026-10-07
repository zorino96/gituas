import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

import { cleanDailyMax, isLate, ownClips, parseReelScript, reelPrompt, soraniDate, wantsVideo, VIDEO_LATE_MS, type VideoSettings } from "@/lib/news/video";

const on: VideoSettings = {
  videoMode: "AUTO",
  videoStyle: "TEMPLATE",
  videoTopics: [],
  videoDailyMax: 5,
  videoVoice: "male",
  videoSpeed: 1,
  videoPrompt: null,
};
const story = { category: "politics", subcategory: null };

describe("wantsVideo", () => {
  it("only on plans with a video quota", () => {
    expect(wantsVideo({ plan: "MANUAL", settings: on, story, today: 0, month: 0 })).toBe(false);
    expect(wantsVideo({ plan: "AUTO", settings: on, story, today: 0, month: 0 })).toBe(true);
    expect(wantsVideo({ plan: "ENTERPRISE", settings: on, story, today: 0, month: 0 })).toBe(true);
  });
  it("respects the mode, the daily maximum and the monthly quota", () => {
    expect(wantsVideo({ plan: "AUTO", settings: { ...on, videoMode: "OFF" }, story, today: 0, month: 0 })).toBe(false);
    expect(wantsVideo({ plan: "AUTO", settings: on, story, today: 5, month: 0 })).toBe(false);
    expect(wantsVideo({ plan: "AUTO", settings: on, story, today: 0, month: 300 })).toBe(false);
  });
  it("follows the chosen topics; an unreadable choice means none", () => {
    expect(wantsVideo({ plan: "AUTO", settings: { ...on, videoTopics: ["economy"] }, story, today: 0, month: 0 })).toBe(false);
    expect(wantsVideo({ plan: "AUTO", settings: { ...on, videoTopics: ["politics"] }, story, today: 0, month: 0 })).toBe(true);
    expect(wantsVideo({ plan: "AUTO", settings: { ...on, videoTopics: ["nonsense"] }, story, today: 0, month: 0 })).toBe(false);
  });
  it("never makes the highlight style yet", () => {
    expect(wantsVideo({ plan: "AUTO", settings: { ...on, videoStyle: "HIGHLIGHT" }, story, today: 0, month: 0 })).toBe(false);
  });
});

describe("parseReelScript", () => {
  const good = {
    place: "کەرکووک",
    segments: [
      { kind: "headline", show: "چوار ساڵ زیندان", say: "دادگا حوکمی دا." },
      { kind: "stat", stat: "٤ ساڵ", show: "زیندانی توند", say: "بۆ هەر سێکیان." },
      { kind: "fact", label: "تۆمەت", show: "یاریکردن بە زەوی", say: "تۆمەتەکەیان یاریکردن بووە." },
      { kind: "outro", show: "فۆڵۆمان بکەن", say: "فۆڵۆمان بکەن." },
    ],
  };
  it("accepts a well-formed script", () => {
    expect(parseReelScript(good)?.segments).toHaveLength(4);
  });
  it("rejects a wrong order, a missing stat or long text", () => {
    expect(parseReelScript({ ...good, segments: good.segments.slice().reverse() })).toBeNull();
    expect(parseReelScript({ ...good, segments: [good.segments[0], { kind: "stat", show: "x", say: "y" }, good.segments[3]] })).toBeNull();
    expect(parseReelScript({ ...good, segments: [{ ...good.segments[0], say: "وشە ".repeat(40) }, good.segments[3]] })).toBeNull();
  });
  it("keeps the post as data between markers", () => {
    expect(reelPrompt({ headline: "H", body: "B" }).user).toBe("<<<POST\nH\n\nB\nPOST>>>");
  });
});

describe("ownClips", () => {
  const base = "https://abc.public.blob.vercel-storage.com/merchant/t1/footage";
  it("takes up to three of the desk's own mp4/mov files", () => {
    expect(ownClips("t1", [`${base}/a.mp4`, `${base}/b.MOV`])).toHaveLength(2);
    expect(ownClips("t1", [])).toEqual([]);
  });
  it("refuses another desk's file, other hosts, other types and too many clips", () => {
    expect(ownClips("t1", ["https://abc.public.blob.vercel-storage.com/merchant/t2/a.mp4"])).toBeNull();
    expect(ownClips("t1", ["https://evil.example.com/merchant/t1/a.mp4"])).toBeNull();
    expect(ownClips("t1", [`${base}/a.exe`])).toBeNull();
    expect(ownClips("t1", [1, 2, 3, 4].map((i) => `${base}/${i}.mp4`))).toBeNull();
    expect(ownClips("t1", "x")).toBeNull();
  });
});

describe("timing and labels", () => {
  it("replaces a late or failed video with the card", () => {
    const now = Date.now();
    expect(isLate({ status: "FAILED", createdAt: new Date(now) }, now)).toBe(true);
    expect(isLate({ status: "VOICED", createdAt: new Date(now - VIDEO_LATE_MS - 1) }, now)).toBe(true);
    expect(isLate({ status: "VOICED", createdAt: new Date(now) }, now)).toBe(false);
    expect(isLate({ status: "RENDERED", createdAt: new Date(now - VIDEO_LATE_MS - 1) }, now)).toBe(false);
  });
  it("clamps the daily maximum and writes Sorani dates in Baghdad time", () => {
    expect(cleanDailyMax("999")).toBe(50);
    expect(cleanDailyMax("x")).toBe(5);
    expect(soraniDate(new Date("2026-10-07T22:30:00Z"))).toBe("٨ی تشرینی یەکەمی ٢٠٢٦");
  });
});
