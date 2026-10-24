import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What an owner sees and sends for a story, in ANY video language (Sorani, Arabic, English): a short documentary told from ONE real,
// well-documented case (the one the idea names, or one Gituas chooses itself), with photographs from Wikimedia Commons: the Video screen (the
// words, the photo switch, the review switch, the read-first hint, the case and its source, the credits and badges on a job card), the rule
// behind the form (story-form.ts), the make_video proposal on the classic assistant's card and the schema's fields. An ad keeps the words and
// the form it always had. Nothing here reaches the network.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children?: unknown }) => createElement("a", { href }, children as never) }));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({
  createVideoAction: vi.fn(),
  publishVideoAction: vi.fn(),
  refreshPlanAction: vi.fn(),
  removeRefAction: vi.fn(),
  saveMarketNotesAction: vi.fn(),
  saveVideoAutoAction: vi.fn(),
}));

import { STORY_MIN, captionWithCredits, downloadHref, formatField, isVideoFormat, photosField, storyFormOf, storyTooShort } from "@/app/app/video/story-form";
import { StoryOptions } from "@/app/app/video/story-options";
import { VideoClient } from "@/app/app/video/video-client";
import { UNKNOWN_SUBJECT_NOTE, ownerJobError } from "@/lib/advideo/job-error";
import { SCHEMAS, parseProposal, proposalLines } from "@/lib/assistant/tools";
import { LangProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { Lang } from "@/lib/i18n/lang";

type Props = ComponentProps<typeof VideoClient>;

const job = (over: Partial<Props["jobs"][number]> = {}): Props["jobs"][number] => ({
  id: "j1", tier: "LITE", status: "RENDERED", source: "MANUAL", topic: null, productName: null, caption: null, videoUrl: null, error: null,
  createdAt: "2026-10-20T10:00:00.000Z", postedAt: null, objective: null, why: null, look: null, comments: null, orders: null, ...over,
});

const base: Props = {
  storeId: "s1",
  stores: [{ id: "s1", name: "Shop" }],
  canFb: true,
  canIg: false,
  products: [{ id: "p1", name: "Silver ring", hasPhoto: true }],
  allowances: { LITE: { limit: 30, used: 1, left: 29 }, PRO: { limit: 0, used: 0, left: 0 } },
  auto: { mode: "OFF", tier: "LITE", hour: 19 },
  jobs: [],
  configure: true,
  workspaceId: "t1",
  today: { used: 0, max: 1 },
  aiPercent: 10,
  refs: [],
  refLimits: { images: 6, videos: 3, imageMb: 12, videoMb: 40 },
  plan: null,
  notes: "",
};

const render = (props: Partial<Props> = {}, lang: Lang = "en") =>
  renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(VideoClient, { ...base, ...props }) }));

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const dicts = { ckb, ar, en } as const;
const LANGS = ["ckb", "ar", "en"] as const;

describe("the Video form's words for a story, in every video language", () => {
  it("asks a story, in any video language, what it is about in plain words, never for a case, and says Gituas chooses a real one", () => {
    for (const defaultLang of LANGS) {
      for (const lang of LANGS) {
        const v = dicts[lang].video;
        const html = render({ defaultKind: "story", defaultLang }, lang);
        expect(html, `${defaultLang}/${lang}`).toContain(esc(v.storyTopicLabel));
        expect(html).toContain(esc(v.storyTopicPlaceholder));
        expect(html).toContain(esc(v.kindStoryHint));
      }
    }
    // The placeholder offers a generic wish AND a named case, and says that naming none is fine.
    expect(en.video.storyTopicPlaceholder).toMatch(/one of the historical mystery stories/);
    expect(en.video.storyTopicPlaceholder).toMatch(/Hinterkaifeck murders, 1922/);
    expect(en.video.storyTopicPlaceholder).toMatch(/If you name none, Gituas chooses a real documented case itself/);
    expect(en.video.storyTopicPlaceholder).toMatch(/fiction/);
    // The round-1 words that demanded one named subject are gone.
    for (const d of [ckb, ar, en]) {
      for (const key of ["storySubjectLabel", "storySubjectPlaceholder", "kindStoryRealHint"]) expect(key in d.video, key).toBe(false);
    }
  });

  it("shows the photo switch, on, and the read-first hint for a real story in every language, after the voice and before publishing", () => {
    for (const defaultLang of LANGS) {
      const html = render({ defaultKind: "story", defaultLang });
      expect(html, defaultLang).toContain(`role="switch" aria-checked="true" aria-label="${esc(en.video.storyPhotosLabel)}"`);
      expect(html).toContain(esc(en.video.storyPhotosHint));
      expect(html).toContain(esc(en.video.storyReadFirst));
      expect(html.indexOf(esc(en.video.storyPhotosLabel))).toBeLessThan(html.indexOf(esc(en.video.publishWhenReady)));
      expect(html.indexOf(esc(en.video.voiceLabel))).toBeLessThan(html.indexOf(esc(en.video.storyPhotosLabel)));
    }
  });

  it("says the read-first hint only where there is a publish switch", () => {
    const html = render({ defaultKind: "story", defaultLang: "ckb", canFb: false, canIg: false });
    expect(html).toContain(esc(en.video.storyPhotosLabel));
    expect(html).not.toContain(esc(en.video.storyReadFirst));
    expect(html).not.toContain(esc(en.video.publishWhenReady));
  });

  it("shows no photo switch, no case words and no fiction note on an ad, whatever its language", () => {
    for (const defaultLang of LANGS) {
      const html = render({ defaultKind: "ad", defaultLang });
      expect(html).toContain(esc(en.video.topicLabel));
      for (const key of ["storyTopicLabel", "storyPhotosLabel", "storyFictionNote", "storyReadFirst", "storyReviewHelp"] as const) {
        expect(html, `${defaultLang}/${key}`).not.toContain(esc(en.video[key]));
      }
    }
  });

  it("gives a story the review switch (OFF = the owner's exact words) with its own explanation in three languages", () => {
    const on = (html: string) => /<input type="checkbox"[^>]*checked=""/.test(html);
    for (const lang of LANGS) {
      const html = render({ defaultKind: "story", defaultLang: "ckb" }, lang);
      expect(html).toContain(esc(dicts[lang].publish.ai.reviewLabel));
      expect(html).toContain(esc(dicts[lang].video.storyReviewHelp));
      expect(on(html)).toBe(false);
    }
  });
});

describe("the rule behind the form", () => {
  it("is a real story unless the idea says fiction, in every language, and nothing at all for an ad", () => {
    expect(storyFormOf("story", "the Hinterkaifeck murders, 1922")).toEqual({ story: true, fiction: false, realStory: true });
    expect(storyFormOf("story", "")).toEqual({ story: true, fiction: false, realStory: true });
    expect(storyFormOf("story", "یەکێک لە چیرۆکە نهێنییە مێژووییەکان")).toMatchObject({ fiction: false, realStory: true });
    expect(storyFormOf("story", "a fictional lighthouse mystery")).toEqual({ story: true, fiction: true, realStory: false });
    expect(storyFormOf("story", "قصة خيالية عن منارة")).toMatchObject({ fiction: true, realStory: false });
    expect(storyFormOf("story", "چیرۆکێکی خەیاڵی")).toMatchObject({ fiction: true, realStory: false });
    expect(storyFormOf("ad", "a fictional offer")).toEqual({ story: false, fiction: false, realStory: false });
    // "Non-fiction" is the opposite of fiction.
    expect(storyFormOf("story", "a non-fiction account of the Hinterkaifeck murders")).toMatchObject({ fiction: false, realStory: true });
  });

  it("needs only a few characters of idea, for every story: the owner's words may be short", () => {
    expect(STORY_MIN).toBe(4);
    expect(storyTooShort("   ")).toBe(true);
    expect(storyTooShort("abc")).toBe(true);
    expect(storyTooShort("  Titanic ")).toBe(false);
    expect(storyTooShort("ڕووداو")).toBe(false);
    expect(storyTooShort("جريمة")).toBe(false);
    // A letter outside the BMP counts as one character, not two.
    expect(storyTooShort("😀😀😀")).toBe(true);
  });

  it("sends the photo choice only for a real story", () => {
    expect(photosField(storyFormOf("story", "Hinterkaifeck murders 1922"), true)).toEqual({ photos: true });
    expect(photosField(storyFormOf("story", "Hinterkaifeck murders 1922"), false)).toEqual({ photos: false });
    expect(photosField(storyFormOf("story", "چیرۆکێکی نهێنی دەربارەی نامەیەک"), false)).toEqual({ photos: false });
    expect(photosField(storyFormOf("story", "a fictional lighthouse mystery"), true)).toEqual({});
    expect(photosField(storyFormOf("ad", ""), false)).toEqual({});
  });
});

describe("the options after the voice", () => {
  const wrap = (lang: Lang, form: ReturnType<typeof storyFormOf>, photos: boolean) =>
    renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(StoryOptions, { form, photos, onToggle: () => undefined }) }));

  it("shows the switch for a real story, off when the owner switched the photographs off", () => {
    const real = storyFormOf("story", "Hinterkaifeck murders 1922");
    expect(wrap("en", real, true)).toContain('aria-checked="true"');
    expect(wrap("en", real, false)).toContain('aria-checked="false"');
    for (const lang of LANGS) {
      expect(wrap(lang, real, true)).toContain(esc(dicts[lang].video.storyPhotosLabel));
      expect(wrap(lang, real, true)).toContain(esc(dicts[lang].video.storyPhotosHint));
    }
  });

  it("shows a note instead of the switch for a fiction, and nothing for an ad", () => {
    const fiction = storyFormOf("story", "a fictional lighthouse mystery");
    for (const lang of LANGS) {
      const html = wrap(lang, fiction, true);
      expect(html).toContain(esc(dicts[lang].video.storyFictionNote));
      expect(html).not.toContain('role="switch"');
    }
    expect(wrap("en", storyFormOf("ad", ""), true)).toBe("");
  });
});

describe("the job card of a story", () => {
  const credits = [
    { title: "File:Hinterkaifeck Hof.jpg", author: "Alice Example", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:Hinterkaifeck_Hof.jpg" },
    { title: "File:Munich 1922.jpg", author: null, licence: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Munich_1922.jpg" },
    { title: "File:Odd.jpg", author: "Bob", licence: "CC BY 2.0", page: "https://evil.example/File:Odd.jpg" },
  ];
  const story = job({
    kind: "story",
    lang: "en",
    topic: "one of the historical mystery stories, crime",
    subject: "Hinterkaifeck murders",
    subjectUrl: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders",
    subjectChosen: true,
    caption: "A farm, six people.",
    credits,
  });

  it("says where the photographs are from and lists every credit with a link to its Commons page", () => {
    const html = render({ jobs: [story] });
    expect(html).toContain(esc(en.video.photosLine));
    expect(html).toContain(`<summary`);
    expect(html).toContain(esc(en.video.photoCredits));
    expect(html).toContain('href="https://commons.wikimedia.org/wiki/File:Hinterkaifeck_Hof.jpg" target="_blank" rel="noreferrer"');
    expect(html).toContain("File:Hinterkaifeck Hof.jpg</a> - Alice Example - CC BY-SA 4.0");
    // A credit with no author is title and licence only.
    expect(html).toContain("File:Munich 1922.jpg</a> - Public domain");
    // An address that is not on Commons is shown as text, never as a link.
    expect(html).not.toContain("evil.example");
    expect(html).toContain("File:Odd.jpg - Bob - CC BY 2.0");
  });

  it("shows the case the story tells with a link to its Wikipedia article and the note that Gituas chose it, next to the credits", () => {
    const html = render({ jobs: [story] });
    expect(html).toContain(`${en.video.subjectLine}: <b><bdi>Hinterkaifeck murders</bdi></b>`);
    expect(html).toContain(`<a class="gm-link" href="https://en.wikipedia.org/wiki/Hinterkaifeck_murders" target="_blank" rel="noreferrer">${en.video.sourceWikipedia}</a>`);
    expect(html).toContain(esc(en.video.subjectChosenNote));
    // The case sits just before the credits, and the owner's own words stay on the card.
    expect(html.indexOf(esc(en.video.subjectLine))).toBeLessThan(html.indexOf(esc(en.video.photosLine)));
    expect(html).toContain("one of the historical mystery stories, crime");
  });

  it("says nothing about a choice when the owner named the case, and links only to English Wikipedia", () => {
    const named = render({ jobs: [{ ...story, subjectChosen: false }] });
    expect(named).toContain(`${en.video.subjectLine}: <b><bdi>Hinterkaifeck murders</bdi></b>`);
    expect(named).not.toContain(esc(en.video.subjectChosenNote));
    const odd = render({ jobs: [{ ...story, subjectUrl: "https://evil.example/wiki/Hinterkaifeck_murders" }] });
    expect(odd).toContain("Hinterkaifeck murders");
    expect(odd).not.toContain("evil.example");
    expect(odd).not.toContain(esc(en.video.sourceWikipedia));
    const none = render({ jobs: [{ ...story, subjectUrl: null }] });
    expect(none).not.toContain(esc(en.video.sourceWikipedia));
  });

  it("says it in the person's language", () => {
    for (const lang of LANGS) {
      const html = render({ jobs: [story] }, lang);
      expect(html, lang).toContain(esc(dicts[lang].video.subjectLine));
      expect(html).toContain(esc(dicts[lang].video.sourceWikipedia));
      expect(html).toContain(esc(dicts[lang].video.subjectChosenNote));
    }
  });

  it("shows no case, no credits, no badges for a video made before cases and photographs existed", () => {
    const html = render({ jobs: [job({ kind: "story", lang: "en", topic: "a mystery about a missing letter" }), job({ id: "j2" })] });
    expect(html).not.toContain(esc(en.video.subjectLine));
    expect(html).not.toContain(esc(en.video.photoCredits));
    expect(html).not.toContain(esc(en.video.photosLine));
    expect(html).not.toContain(`>${en.video.noPhotosBadge}<`);
    expect(html).not.toContain(`>${en.video.fictionBadge}<`);
  });

  it("badges a story the owner asked for without photographs, and a fiction (a fiction's title has no source link)", () => {
    const off = render({ jobs: [job({ kind: "story", lang: "ckb", topic: "Hinterkaifeck murders 1922", noPhotos: true })] });
    expect(off).toContain(`>${en.video.noPhotosBadge}<`);
    expect(off).not.toContain(`>${en.video.fictionBadge}<`);
    const fiction = render({ jobs: [job({ kind: "story", lang: "en", topic: "a fictional lighthouse mystery", fiction: true, subject: "The Lamp at Harrow Point" })] });
    expect(fiction).toContain(`>${en.video.fictionBadge}<`);
    expect(fiction).toContain("The Lamp at Harrow Point");
    expect(fiction).not.toContain(esc(en.video.photoCredits));
    expect(fiction).not.toContain(esc(en.video.sourceWikipedia));
    // In the person's language.
    expect(render({ jobs: [job({ kind: "story", lang: "ar", fiction: true })] }, "ar")).toContain(`>${ar.video.fictionBadge}<`);
    expect(render({ jobs: [job({ kind: "story", lang: "en", noPhotos: true })] }, "ckb")).toContain(`>${ckb.video.noPhotosBadge}<`);
  });

  it("never shows a case on an ad", () => {
    const html = render({ jobs: [job({ kind: "ad", subject: "Hinterkaifeck murders" })] });
    expect(html).not.toContain(esc(en.video.subjectLine));
  });
});

describe("the make_video proposal", () => {
  const ids = new Set<string>();
  const fields = { en: en.assistant.fields, ar: ar.assistant.fields, ckb: ckb.assistant.fields } as const;
  const lines = (args: Record<string, unknown>, lang: Lang = "en") => proposalLines(parseProposal({ tool: "make_video", args }, ids)!, fields[lang], { shop: "My shop" });

  it("shows a story's idea as the owner wrote it and says its photographs come from Wikimedia Commons, in every video language", () => {
    for (const language of LANGS) {
      expect(lines({ idea: "Hinterkaifeck murders 1922", language, kind: "story" }), language).toEqual([
        { label: "Idea", value: "Hinterkaifeck murders 1922" },
        { label: "Video language", value: { ckb: "Sorani Kurdish", ar: "Arabic", en: "English" }[language] },
        { label: "Kind", value: "Story" },
        { label: "Shape", value: "Vertical 9:16 (Reels)" },
        { label: "Photos", value: "Wikimedia Commons" },
        { label: "Accounts", value: "My shop" },
      ]);
    }
    expect(lines({ idea: "یەکێک لە چیرۆکە نهێنییە مێژووییەکان", language: "ckb", kind: "story" }, "ckb").map((l) => l.label)).toEqual([
      ckb.assistant.fields.idea, ckb.assistant.fields.language, ckb.assistant.fields.kind, ckb.assistant.fields.format, ckb.assistant.fields.storyPhotos, ckb.assistant.fields.shop,
    ]);
    expect(lines({ idea: "جريمة تاريخية", language: "ar", kind: "story" }, "ar").map((l) => l.label)).toContain(ar.assistant.fields.storyPhotos);
  });

  it("says plainly that there are no photographs when the owner switched them off", () => {
    const l = lines({ idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", photos: false });
    expect(l).toContainEqual({ label: "Photos", value: "No photographs" });
    expect(l.some((x) => x.value === "Wikimedia Commons")).toBe(false);
    expect(lines({ idea: "Hinterkaifeck murders 1922", language: "ckb", kind: "story", photos: false }, "ckb")).toContainEqual({ label: ckb.assistant.fields.storyPhotos, value: ckb.assistant.fields.storyNoPhotos });
  });

  it("shows a fiction with no photographs line, and the review line only when the owner asked for it", () => {
    const l = lines({ idea: "a fictional lighthouse mystery", language: "en", kind: "story" });
    expect(l[0]).toEqual({ label: "Idea", value: "a fictional lighthouse mystery" });
    expect(l.some((x) => x.label === "Photos")).toBe(false);
    expect(lines({ idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", review: true })).toContainEqual({ label: "Improve the idea first", value: "Yes" });
    expect(lines({ idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", review: false }).some((x) => x.label === "Improve the idea first")).toBe(false);
    expect(lines({ idea: "Hinterkaifeck murders 1922", language: "en", kind: "story" }).some((x) => x.label === "Improve the idea first")).toBe(false);
    // An ad has no review line.
    expect(lines({ idea: "a short ad", language: "en", kind: "ad", review: true }).some((x) => x.label === "Improve the idea first")).toBe(false);
  });

  it("keeps an ad exactly as it was: an idea, no photographs", () => {
    expect(lines({ idea: "a short ad", language: "en", kind: "ad" })).toEqual([
      { label: "Idea", value: "a short ad" },
      { label: "Video language", value: "English" },
      { label: "Kind", value: "Ad" },
      { label: "Accounts", value: "My shop" },
    ]);
  });

  it("uses the language the video will really use when the caller resolved it, not the one the model wrote", () => {
    const p = parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922", kind: "story" } }, ids)!;
    expect(proposalLines(p, en.assistant.fields, { video: { lang: "en", kind: "story" } }).map((l) => l.label)).toEqual(["Idea", "Video language", "Kind", "Shape", "Photos"]);
    // A Sorani story is a real story now: the same lines.
    expect(proposalLines(p, en.assistant.fields, { video: { lang: "ckb", kind: "story" } }).map((l) => l.label)).toEqual(["Idea", "Video language", "Kind", "Shape", "Photos"]);
  });

  it("states a story's shape: wide 16:9 for YouTube when the caller resolved it (or the model asked), vertical 9:16 otherwise, and nothing for an ad", () => {
    const p = parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922", kind: "story" } }, ids)!;
    expect(proposalLines(p, en.assistant.fields, { video: { lang: "en", kind: "story", format: "wide" } })).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    expect(proposalLines(p, en.assistant.fields, { video: { lang: "en", kind: "story", format: "vertical" } })).toContainEqual({ label: "Shape", value: "Vertical 9:16 (Reels)" });
    // The caller's resolved shape wins over what the model wrote (an ad was refused before it got here, a story is wide only when asked).
    const askedWide = parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922", kind: "story", format: "wide" } }, ids)!;
    expect(proposalLines(askedWide, en.assistant.fields, {})).toContainEqual({ label: "Shape", value: "Wide 16:9 (YouTube)" });
    expect(proposalLines(askedWide, en.assistant.fields, { video: { lang: "en", kind: "story", format: "vertical" } })).toContainEqual({ label: "Shape", value: "Vertical 9:16 (Reels)" });
    for (const lang of LANGS) {
      const f = dicts[lang].assistant.fields;
      expect(proposalLines(askedWide, f, {})).toContainEqual({ label: f.format, value: f.formatWide });
    }
    const ad = parseProposal({ tool: "make_video", args: { idea: "a short ad", kind: "ad", format: "wide" } }, ids)!;
    expect(proposalLines(ad, en.assistant.fields, { video: { lang: "en", kind: "ad", format: "wide" } }).some((l) => l.label === "Shape")).toBe(false);
  });

  it("writes where the photographs come from in the person's own letters: Sorani letters in Sorani, Arabic in Arabic", () => {
    const p = parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922", kind: "story" } }, ids)!;
    expect(proposalLines(p, ckb.assistant.fields, {})).toContainEqual({ label: ckb.assistant.fields.storyPhotos, value: "ویکیمیدیا کۆمۆنز" });
    expect(proposalLines(p, ar.assistant.fields, {})).toContainEqual({ label: ar.assistant.fields.storyPhotos, value: "ويكيميديا كومنز" });
    expect(proposalLines(p, en.assistant.fields, {})).toContainEqual({ label: en.assistant.fields.storyPhotos, value: "Wikimedia Commons" });
  });
});

describe("the tool's schema and words", () => {
  it("accepts photos and review as a true or false, and nothing else", () => {
    expect(SCHEMAS.make_video.safeParse({ idea: "Hinterkaifeck murders 1922", kind: "story", photos: false, review: true }).success).toBe(true);
    expect(SCHEMAS.make_video.safeParse({ idea: "Hinterkaifeck murders 1922", photos: true }).success).toBe(true);
    expect(SCHEMAS.make_video.safeParse({ idea: "Hinterkaifeck murders 1922" }).success).toBe(true);
    for (const bad of ["no", "true", "yes", 1, 0, null, ["a1"]]) {
      expect(SCHEMAS.make_video.safeParse({ idea: "Hinterkaifeck murders 1922", photos: bad }).success, `photos ${String(bad)}`).toBe(false);
      expect(SCHEMAS.make_video.safeParse({ idea: "Hinterkaifeck murders 1922", review: bad }).success, `review ${String(bad)}`).toBe(false);
    }
    expect(parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922", language: "en", kind: "story", photos: false, review: true } }, new Set())?.args).toEqual({
      idea: "Hinterkaifeck murders 1922",
      language: "en",
      kind: "story",
      photos: false,
      review: true,
    });
    // Left out it stays left out: the pipeline's defaults (photographs on, the words used exactly) apply.
    expect(parseProposal({ tool: "make_video", args: { idea: "Hinterkaifeck murders 1922" } }, new Set())?.args).toEqual({ idea: "Hinterkaifeck murders 1922" });
  });

  it("has every new word in every language, none empty, with the script of its language", () => {
    const VIDEO = [
      "storyTopicLabel", "storyTopicPlaceholder", "kindStoryHint", "storyPhotosLabel", "storyPhotosHint", "storyFictionNote", "storyReadFirst", "storyReviewHelp",
      "subjectLine", "sourceWikipedia", "subjectChosenNote", "photoCredits", "photosLine", "noPhotosBadge", "fictionBadge",
    ] as const;
    for (const [name, d] of Object.entries(dicts)) {
      for (const k of VIDEO) expect(d.video[k].trim(), `${name}.video.${k}`).not.toBe("");
      // A refusal says the video was not counted, so the owner knows nothing was spent.
      expect(d.video.errors.unknownSubject.trim(), `${name}.video.errors.unknownSubject`).not.toBe("");
      expect(d.video.errors.unknownSubject.length).toBeGreaterThan(60);
      // The round-1 refusal that asked the owner to name a case is gone.
      expect("noSubject" in d.video.errors, name).toBe(false);
      for (const k of ["storyPhotos", "storyNoPhotos", "review"] as const) expect(d.assistant.fields[k].trim(), `${name}.assistant.fields.${k}`).not.toBe("");
      expect("subject" in d.assistant.fields, name).toBe(false);
    }
    const words = (d: typeof en) =>
      [...VIDEO.map((k) => d.video[k]), d.video.errors.unknownSubject, d.video.errors.topic, d.assistant.fields.storyPhotos, d.assistant.fields.storyNoPhotos, d.assistant.fields.review].join(" ");
    expect(/[کیەێۆڕڵڤپچژگ]/.test(words(ar))).toBe(false);
    expect(/[؀-ۿ]/.test(words(en))).toBe(false);
    // The Sorani words are in Sorani letters, not Latin ones (apart from the names Wikimedia Commons and Gituas, which are written as they are).
    expect(/[ەێۆڕڵ]/.test(words(ckb))).toBe(true);
  });

  it("reaches the owner on the failed card in the owner's language, through the dictionaries' own error texts", () => {
    for (const [name, d] of Object.entries(dicts)) {
      expect(ownerJobError("FAILED", UNKNOWN_SUBJECT_NOTE, d.video.errors), name).toBe(d.video.errors.unknownSubject);
      // Any other failure keeps its old text, and a refusal says nothing while the video is still being tried.
      expect(ownerJobError("FAILED", "render failed", d.video.errors), name).toBe(d.video.errors.jobFailed);
      expect(ownerJobError("QUEUED", UNKNOWN_SUBJECT_NOTE, d.video.errors), name).toBeNull();
    }
  });

  it("tells the owner in the refusal that the case was not found in a reliable source (Wikipedia), how to name it, and that nothing was counted", () => {
    expect(en.video.errors.unknownSubject).toMatch(/reliable source \(Wikipedia\)/);
    expect(en.video.errors.unknownSubject).toMatch(/Write its name differently/);
    expect(en.video.errors.unknownSubject).toMatch(/fiction/);
    expect(en.video.errors.unknownSubject).toMatch(/not counted/);
    expect(ar.video.errors.unknownSubject).toMatch(/ويكيبيديا/);
    expect(ar.video.errors.unknownSubject).toMatch(/خيالية/);
    expect(ckb.video.errors.unknownSubject).toMatch(/ویکیپیدیا/);
    expect(ckb.video.errors.unknownSubject).toMatch(/خەیاڵی/);
    // The Sorani refusal ends with the sentence the Sorani "could not be made" already uses to say the video was not counted.
    const counted = "لە ژمارەی ڤیدیۆکانت نەژمێردرا";
    expect(ckb.video.errors.jobFailed).toContain(counted);
    expect(ckb.video.errors.unknownSubject).toContain(counted);
  });

  it("asks a story for its idea in plain words, not for a named case", () => {
    expect(en.video.errors.topic).toMatch(/plain words/);
    expect(en.video.errors.topic).not.toMatch(/at least a short sentence/);
  });
});

describe("the shape of a story: vertical for Reels, wide 16:9 for YouTube", () => {
  const wrap = (lang: Lang, form: ReturnType<typeof storyFormOf>, format?: "vertical" | "wide") =>
    renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(StoryOptions, { form, photos: true, onToggle: () => undefined, ...(format ? { format, onFormat: () => undefined } : {}) }) }));
  const pressedLabels = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)</g)].map((m) => m[1]);

  it("offers the choice for a story, in every language, with vertical pressed by default and the YouTube hint under it", () => {
    for (const lang of LANGS) {
      const v = dicts[lang].video;
      const html = render({ defaultKind: "story", defaultLang: "ckb" }, lang);
      expect(html, lang).toContain(esc(v.formatLabel));
      expect(html).toContain(`>${esc(v.formatVertical)}<`);
      expect(html).toContain(`>${esc(v.formatWide)}<`);
      expect(html).toContain(esc(v.formatHint));
      expect(html).toContain(`aria-pressed="true">${esc(v.formatVertical)}<`);
      expect(html).toContain(`aria-pressed="false">${esc(v.formatWide)}<`);
      // After the voice and before the photograph switch.
      expect(html.indexOf(esc(v.voiceLabel))).toBeLessThan(html.indexOf(esc(v.formatLabel)));
      expect(html.indexOf(esc(v.formatLabel))).toBeLessThan(html.indexOf(esc(v.storyPhotosLabel)));
    }
  });

  it("is in the story form only: an ad is always vertical and has no shape to choose", () => {
    for (const defaultLang of LANGS) {
      const html = render({ defaultKind: "ad", defaultLang });
      expect(html).not.toContain(esc(en.video.formatLabel));
      expect(html).not.toContain(esc(en.video.formatWide));
      expect(html).not.toContain(esc(en.video.formatHint));
    }
    expect(wrap("en", storyFormOf("ad", ""), "wide")).toBe("");
  });

  it("shows the pressed shape, for a real story and for a fiction", () => {
    for (const form of [storyFormOf("story", "Hinterkaifeck murders 1922"), storyFormOf("story", "a fictional lighthouse mystery")]) {
      expect(pressedLabels(wrap("en", form, "vertical"))).toContain(en.video.formatVertical);
      expect(pressedLabels(wrap("en", form, "wide"))).toContain(en.video.formatWide);
      expect(pressedLabels(wrap("en", form, "wide"))).not.toContain(en.video.formatVertical);
    }
    // The older callers that give no handler get the options as they were (no shape choice).
    expect(wrap("en", storyFormOf("story", "Hinterkaifeck murders 1922"))).not.toContain(esc(en.video.formatLabel));
  });

  it("sends the shape only for a story, as a vertical or a wide, and nothing for an ad", () => {
    expect(formatField(storyFormOf("story", "Hinterkaifeck murders 1922"), "wide")).toEqual({ format: "wide" });
    expect(formatField(storyFormOf("story", "Hinterkaifeck murders 1922"), "vertical")).toEqual({ format: "vertical" });
    expect(formatField(storyFormOf("story", "a fictional lighthouse mystery"), "wide")).toEqual({ format: "wide" });
    expect(formatField(storyFormOf("ad", ""), "wide")).toEqual({});
    expect(isVideoFormat("wide") && isVideoFormat("vertical")).toBe(true);
    expect(isVideoFormat("square") || isVideoFormat(undefined) || isVideoFormat(169)).toBe(false);
  });

  it("says in plain words, in every language, the ONE YouTube truth (a single video is downloaded and added in Publish or YouTube Studio; the daily plan can post to YouTube; uploads stay Private until Google's review ends) and that a wide video can still go to Facebook and Instagram", () => {
    expect(en.video.formatHint).toMatch(/A single video is not uploaded to YouTube from here: download it and add it in Publish or in YouTube Studio \(YouTube keeps every upload Private until Google finishes reviewing Gituas\)/);
    expect(en.video.formatHint).toMatch(/Your daily plan can post to YouTube by itself once you have said who can watch and whether it is made for kids/);
    expect(en.video.formatHint).not.toMatch(/Gituas does not upload to YouTube/);
    expect(en.video.formatHint).toMatch(/can still be posted to Facebook and Instagram/);
    expect(en.video.formatHint).toMatch(/about a minute/);
    expect(ar.video.formatHint).toMatch(/يوتيوب/);
    expect(ckb.video.formatHint).toMatch(/یوتیوب/);
  });
});

describe("the job card of a finished story: download, the caption with its credits, and what must travel with the video", () => {
  const credits = [
    { title: "File:Hinterkaifeck Hof.jpg", author: "Alice Example", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:Hinterkaifeck_Hof.jpg" },
    { title: "File:Munich 1922.jpg", author: null, licence: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Munich_1922.jpg" },
  ];
  const done = job({
    kind: "story", lang: "en", status: "RENDERED", videoUrl: "https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/video.mp4",
    topic: "Hinterkaifeck murders 1922", subject: "Hinterkaifeck murders", subjectUrl: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders", caption: "A farm, six people. Photos: Wikimedia Commons (Alice Example, CC BY-SA 4.0)", credits,
  });

  it("offers Download as a button and a Copy-the-caption button, and says the video must be taken to YouTube by the owner", () => {
    for (const lang of LANGS) {
      const v = dicts[lang].video;
      const html = render({ jobs: [done] }, lang);
      // The address that makes the browser SAVE the file (a video on another origin ignores the download attribute alone).
      expect(html, lang).toContain(`class="gm-btn small" href="${esc(downloadHref(done.videoUrl!))}" download="">${esc(v.download)}<`);
      expect(html).toContain(`>${esc(v.copyCaption)}<`);
      expect(html).toContain(esc(v.youtubeNote));
      expect(html).toContain(esc(v.creditsTravel));
    }
    expect(en.video.youtubeNote).toMatch(/download the video and add it in Publish or in YouTube Studio\. YouTube keeps every upload Private until Google finishes reviewing Gituas/);
    expect(en.video.youtubeNote).not.toMatch(/Gituas does not post to YouTube/);
    expect(en.video.creditsTravel).toMatch(/photo credits must travel with the video/);
  });

  it("copies the caption together with the photo credits and the Commons page of each file", () => {
    expect(captionWithCredits(done, en.video.photoCredits)).toBe(
      [
        "A farm, six people. Photos: Wikimedia Commons (Alice Example, CC BY-SA 4.0)",
        "",
        "Photo credits:",
        "- File:Hinterkaifeck Hof.jpg - Alice Example - CC BY-SA 4.0 - https://commons.wikimedia.org/wiki/File:Hinterkaifeck_Hof.jpg",
        "- File:Munich 1922.jpg - Public domain - https://commons.wikimedia.org/wiki/File:Munich_1922.jpg",
      ].join("\n"),
    );
    expect(captionWithCredits({ caption: "Only a caption", credits: [] }, "Photo credits")).toBe("Only a caption");
    expect(captionWithCredits({ caption: null, credits }, "Photo credits").startsWith("Photo credits:\n- File:Hinterkaifeck Hof.jpg")).toBe(true);
    expect(captionWithCredits({ caption: null }, "Photo credits")).toBe("");
  });

  it("does not say the credits must travel when there are none (a fiction, or photographs switched off), and still offers the download", () => {
    const fiction = job({ kind: "story", lang: "en", status: "RENDERED", videoUrl: "https://abc.public.blob.vercel-storage.com/v.mp4", caption: "An invented tale. Fiction.", fiction: true });
    const html = render({ jobs: [fiction] });
    expect(html).toContain(`>${esc(en.video.download)}<`);
    expect(html).toContain(`>${esc(en.video.copyCaption)}<`);
    expect(html).not.toContain(esc(en.video.creditsTravel));
  });

  it("keeps an ad's card as it was: a plain download link, no copy button, no YouTube note", () => {
    const ad = job({ kind: "ad", lang: "en", status: "RENDERED", videoUrl: "https://abc.public.blob.vercel-storage.com/ad.mp4", caption: "An ad caption" });
    const html = render({ jobs: [ad] });
    expect(html).toContain(`class="gm-link" href="${esc(downloadHref(ad.videoUrl!))}" download="">${esc(en.video.download)}<`);
    expect(html).not.toContain(esc(en.video.copyCaption));
    expect(html).not.toContain(esc(en.video.youtubeNote));
    expect(html).not.toContain(esc(en.video.creditsTravel));
  });

  it("shows a wide story in its own shape with its badge, and a vertical story and an ad as they were", () => {
    const wide = render({ jobs: [{ ...done, format: "wide" }] });
    expect(wide).toContain("aspect-ratio:16 / 9");
    expect(wide).toContain(`>${esc(en.video.wideBadge)}<`);
    const vertical = render({ jobs: [done] });
    expect(vertical).toContain("aspect-ratio:9 / 16");
    expect(vertical).not.toContain(esc(en.video.wideBadge));
    // An ad never carries the shape, even by mistake.
    expect(render({ jobs: [job({ kind: "ad", videoUrl: "https://abc.public.blob.vercel-storage.com/ad.mp4" })] })).toContain("aspect-ratio:9 / 16");
  });

  it("says plainly on the card when a story was told from memory, in every language, and shows no source link then", () => {
    const memory = { ...done, subjectUrl: null, fromMemory: true };
    for (const lang of LANGS) {
      const html = render({ jobs: [memory] }, lang);
      expect(html, lang).toContain(esc(dicts[lang].video.fromMemoryNote));
      expect(html).not.toContain(esc(dicts[lang].video.sourceWikipedia));
    }
    expect(en.video.fromMemoryNote).toMatch(/Told from memory: the Wikipedia article could not be read, so check every fact before you post/);
    // A story whose article was read says nothing of the kind.
    expect(render({ jobs: [done] })).not.toContain(esc(en.video.fromMemoryNote));
    // Only a story has the note.
    expect(render({ jobs: [job({ kind: "ad", fromMemory: true, subject: "X" })] })).not.toContain(esc(en.video.fromMemoryNote));
  });
});

describe("the words of this round, in every language", () => {
  const NEW_VIDEO = [
    "formatLabel", "formatVertical", "formatWide", "formatHint", "wideBadge", "copyCaption", "copied", "creditsTravel", "youtubeNote", "fromMemoryNote",
    "recentNote", "waitMemory", "waitRecent", "waitFiction", "chatStoryReady", "openSection",
    "routineSec", "routineIdea", "routineUsual", "routineWhere", "routineNowhere", "routineExact", "routineReviewed", "routineNoPhotos", "routineIsOff", "routineSwitchOff", "routineRemove", "routineSwitchedOff", "routineRemoved",
  ] as const;
  const NEW_FIELDS = [
    "format", "formatVertical", "formatWide", "storyPhotosFrom", "length", "youtube", "words", "wordsExact", "wordsReviewed", "postTo", "postToNone", "ytWho", "ytKids", "ideaUsual",
  ] as const;
  const NEW_DONE = [
    "videoFormatVertical", "videoFormatWide", "videoLengthStory", "videoLengthFiction", "videoLengthAd", "videoPhotosOn", "videoCredits", "videoPhotosOff", "videoFiction", "videoCase", "videoNotYouTube", "videoNotUsedVideo", "videoNotUsedPicture",
    "videoUsedAsWritten", "dailyPlan", "dailyCase", "dailyWaits",
  ] as const;

  it("has every new sentence in every language, none empty, with the script of its language", () => {
    for (const [name, d] of Object.entries(dicts)) {
      for (const k of NEW_VIDEO) expect(d.video[k].trim(), `${name}.video.${k}`).not.toBe("");
      for (const k of NEW_FIELDS) expect(d.assistant.fields[k].trim(), `${name}.assistant.fields.${k}`).not.toBe("");
      for (const k of NEW_DONE) expect(d.assistant.done[k].trim(), `${name}.assistant.done.${k}`).not.toBe("");
      expect(d.assistant.done.videoLanguage("X").trim()).not.toBe("");
    }
    const words = (d: typeof en) =>
      [...NEW_VIDEO.map((k) => d.video[k]), ...NEW_FIELDS.map((k) => d.assistant.fields[k]), ...NEW_DONE.map((k) => d.assistant.done[k]), d.assistant.done.videoLanguage("x")].join(" ");
    expect(/[کیەێۆڕڵڤپچژگ]/.test(words(ar))).toBe(false);
    expect(/[؀-ۿ]/.test(words(en))).toBe(false);
    expect(/[ەێۆڕڵ]/.test(words(ckb))).toBe(true);
  });

  it("writes Wikimedia Commons in Sorani letters everywhere the Sorani words say it, and keeps the Latin name only in the data", () => {
    const sorani = "ویکیمیدیا کۆمۆنز";
    expect(ckb.video.storyPhotosLabel).toContain(sorani);
    expect(ckb.video.photosLine).toBe(`وێنەکان: ${sorani}`);
    expect(ckb.video.kindStoryHint).toContain(sorani);
    expect(ckb.video.storyPhotosHint).toBeTruthy();
    expect(ckb.assistant.fields.storyPhotosFrom).toBe(sorani);
    expect(ckb.assistant.done.videoPhotosOn).toContain(sorani);
    for (const [key, value] of [
      ["video.storyPhotosLabel", ckb.video.storyPhotosLabel],
      ["video.photosLine", ckb.video.photosLine],
      ["video.kindStoryHint", ckb.video.kindStoryHint],
      ["assistant.done.videoPhotosOn", ckb.assistant.done.videoPhotosOn],
    ] as const) {
      expect(value, key).not.toMatch(/Wikimedia|Commons/);
    }
  });

  it("states the attached-video line as the owner's own words and the honest one for pictures", () => {
    expect(en.assistant.done.videoNotUsedVideo).toBe("The attached video was NOT used: Gituas cannot learn from a video yet.");
    expect(en.assistant.done.videoNotYouTube).toBe("This video was not sent to YouTube from here: download it and add it in Publish or in YouTube Studio. YouTube keeps every upload Private until Google finishes reviewing Gituas.");
    expect(en.assistant.done.videoLengthStory).toBe("Length: about 60 to 70 seconds. If your idea asks for a short video, Gituas aims for about 30 seconds but cannot promise it.");
    expect(en.assistant.done.videoUsedAsWritten).toBe("Your idea was used exactly as you wrote it.");
    expect(en.assistant.done.videoFormatVertical).toBe("Format: vertical 9:16.");
    expect(en.assistant.done.videoFormatWide).toBe("Format: wide 16:9.");
    expect(en.assistant.done.videoLanguage("Sorani Kurdish")).toBe("Language: Sorani Kurdish.");
    expect(en.assistant.done.videoCredits).toBe("Credits go in the caption and on the last scene.");
  });

  it("makes the soft promises: the photographs where free ones are found, the article when it can be read", () => {
    expect(en.video.kindStoryHint).toMatch(/Wikipedia article of a real, well-documented case when it can be read/);
    expect(en.video.kindStoryHint).toMatch(/free photographs from Wikimedia Commons where they are found/);
    expect(en.video.storyPhotosHint).toMatch(/where one is found/);
    expect(en.video.storyPhotosHint).toMatch(/on the last scene of the video/);
    // The placeholder still says a case is chosen only when none is named.
    expect(en.video.storyTopicPlaceholder).toMatch(/If you name none, Gituas chooses a real documented case itself/);
  });
});

// ---- the owner's daily plan on the Video screen, the notes of a finished story, and the chat's finished story ------------------------------

import { StoryReady } from "@/app/app/assistant/story-ready";
import type { StoryStatusView } from "@/app/app/video/story-form";
import type { VideoAutoPlan } from "@/lib/advideo/plan";

describe("the daily plan on the Video screen: one plain line, with a way to switch it off", () => {
  const plan: VideoAutoPlan = {
    brief: "یەکێک لە چیرۆکە نهێنییە مێژووییەکان، ژانری تاوان",
    kind: "story",
    review: false,
    photos: true,
    targets: ["FB", "YT"],
    youtube: { privacy: "public", madeForKids: false },
  };
  const auto = { mode: "PUBLISH", tier: "LITE" as const, hour: 18 };

  it("says when it runs, what kind of video, the idea in the owner's own words, that the words go through exactly, and where it is posted, in every language", () => {
    for (const lang of LANGS) {
      const v = dicts[lang].video;
      const html = render({ auto, dailyPlan: plan }, lang);
      expect(html, lang).toContain(esc(v.routineSec));
      expect(html).toContain(esc(v.routineEvery("18:00")));
      expect(html).toContain(esc(v.kindStory));
      expect(html).toContain(`«${plan.brief}»`);
      expect(html).toContain(esc(v.routineExact));
      expect(html).toContain(esc(`${v.routineWhere}: Facebook + YouTube`));
      expect(html).toContain(esc(dicts[lang].publish.ytPrivacyOptions.public));
      // YouTube keeps every upload Private until Google's review ends: said right there.
      expect(html).toContain(esc(dicts[lang].publish.ytPrivate));
      // A way to switch the daily video off, and to remove the plan.
      expect(html).toContain(`>${esc(v.routineSwitchOff)}<`);
      expect(html).toContain(`>${esc(v.routineRemove)}<`);
    }
  });

  it("says a plan that reads the page first, the wide shape and the photographs switched off, and shows no YouTube line when YouTube is not in the plan", () => {
    const html = render({ auto, dailyPlan: { ...plan, review: true, photos: false, format: "wide", targets: ["IG"], youtube: undefined } });
    expect(html).toContain(esc(en.video.routineReviewed));
    expect(html).toContain(esc(en.video.wideBadge));
    expect(html).toContain(esc(en.video.routineNoPhotos));
    expect(html).toContain(esc(`${en.video.routineWhere}: Instagram`));
    expect(html).not.toContain(esc(en.publish.ytPrivate));
  });

  it("says the video is only kept for the owner when the daily video makes drafts (nothing is posted by itself), and that a plan with no idea is the page's usual choice", () => {
    const html = render({ auto: { ...auto, mode: "DRAFT" }, dailyPlan: { ...plan, brief: "" } });
    expect(html).toContain(esc(`${en.video.routineWhere}: ${en.video.routineNowhere}`));
    expect(html).toContain(esc(en.video.routineUsual));
    expect(html).not.toContain(esc(en.publish.ytPrivate));
  });

  it("says the plan is saved but switched off when the daily video is off, and then has no switch-off button, only the removal", () => {
    const html = render({ auto: { ...auto, mode: "OFF" }, dailyPlan: plan });
    expect(html).toContain(esc(en.video.routineIsOff));
    expect(html).not.toContain(`>${esc(en.video.routineSwitchOff)}<`);
    expect(html).toContain(`>${esc(en.video.routineRemove)}<`);
  });

  it("shows nothing about a plan when there is none, and nothing at all to a person who may not change the daily video", () => {
    expect(render({ auto, dailyPlan: null })).not.toContain(esc(en.video.routineSec));
    expect(render({ auto })).not.toContain(esc(en.video.routineSec));
    expect(render({ auto, dailyPlan: plan, configure: false })).not.toContain(esc(en.video.routineSec));
  });
});

describe("the notes of a finished story on its job card", () => {
  const url = "https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/video.mp4";
  const story = (over: Partial<Props["jobs"][number]> = {}) => job({ kind: "story", lang: "en", status: "RENDERED", videoUrl: url, subject: "Hinterkaifeck murders", caption: "c", ...over });

  it("says to check every fact for a story about a very recent case, and for one told from memory, in every language", () => {
    for (const lang of LANGS) {
      const v = dicts[lang].video;
      const recent = render({ jobs: [story({ recent: true, subjectUrl: "https://en.wikipedia.org/wiki/X" })] }, lang);
      expect(recent, lang).toContain(esc(v.recentNote));
      expect(recent).not.toContain(esc(v.fromMemoryNote));
      const memory = render({ jobs: [story({ fromMemory: true })] }, lang);
      expect(memory).toContain(esc(v.fromMemoryNote));
      expect(memory).not.toContain(esc(v.recentNote));
    }
  });

  it("says why a story that was to be posted by itself waited as a draft, in the owner's words, and only while it waits", () => {
    const why = en.video.waitMemory;
    const waiting = render({ jobs: [story({ fromMemory: true, waited: why })] });
    expect(waiting).toContain(esc(why));
    // The same story after it was posted by hand says nothing about waiting.
    expect(render({ jobs: [story({ fromMemory: true, waited: why, status: "POSTED" })] })).not.toContain(esc(why));
    // An ad never has it, and a story that was not held back has none.
    expect(render({ jobs: [job({ kind: "ad", status: "RENDERED", videoUrl: url, waited: why })] })).not.toContain(esc(why));
    expect(render({ jobs: [story()] })).not.toContain(esc(en.video.waitMemory));
    // The three reasons are three plain sentences, none empty.
    for (const d of [ckb, ar, en]) for (const k of ["waitMemory", "waitRecent", "waitFiction"] as const) expect(d.video[k].trim().length, k).toBeGreaterThan(20);
    expect(/[کیەێۆڕڵڤپچژگ]/.test(ar.video.waitMemory + ar.video.waitRecent + ar.video.waitFiction + ar.video.recentNote)).toBe(false);
  });

  it("makes Download a link to the address that really downloads, with the plain attribute as the fallback", () => {
    const html = render({ jobs: [story()] });
    expect(html).toContain(`href="${url}?download=1" download=""`);
    // No cross-origin link that the browser would only open.
    expect(html).not.toContain(`href="${url}" download`);
  });
});

describe("a finished story in the chat: the case, the notes, Download, Copy caption, and the way to the Video section; never 'ask me to post it'", () => {
  const url = "https://abc.public.blob.vercel-storage.com/merchant/t1/advideo/j1/video.mp4";
  const story = (over: Partial<StoryStatusView> = {}): StoryStatusView => ({
    subject: "Hinterkaifeck murders",
    subjectUrl: "https://en.wikipedia.org/wiki/Hinterkaifeck_murders",
    chosen: true,
    fromMemory: false,
    recent: false,
    fiction: false,
    wide: true,
    waited: null,
    credits: [{ title: "File:Hof.jpg", author: "Alice Example", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:Hof.jpg" }],
    ...over,
  });
  const ready = (s: StoryStatusView, lang: Lang = "en", caption: string | null = "A farm, six people.") =>
    renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(StoryReady, { url, caption, story: s, video: createElement("video", { src: url }) }) }));

  it("shows the case with a link to its article (read), that Gituas chose it, and the credits that must travel, in every language", () => {
    for (const lang of LANGS) {
      const v = dicts[lang].video;
      const html = ready(story(), lang);
      expect(html, lang).toContain(esc(v.chatStoryReady));
      expect(html).toContain(esc(v.subjectLine));
      expect(html).toContain("Hinterkaifeck murders");
      expect(html).toContain('href="https://en.wikipedia.org/wiki/Hinterkaifeck_murders"');
      expect(html).toContain(esc(v.subjectChosenNote));
      expect(html).toContain(esc(v.creditsTravel));
      expect(html).toContain(esc(v.youtubeNote));
      // The video comes right after the ready line; Download, Copy caption and the section link are there.
      expect(html.indexOf(esc(v.chatStoryReady))).toBeLessThan(html.indexOf("<video"));
      expect(html).toContain(`href="${url}?download=1" download=""`);
      expect(html).toContain(`>${esc(v.copyCaption)}<`);
      expect(html).toContain(`<a href="/app/video">${esc(v.openSection)}</a>`);
    }
  });

  it("never offers to post it from the chat: a real story is read first and posted from the Video section", () => {
    for (const lang of LANGS) {
      const html = ready(story(), lang);
      expect(html).not.toContain(esc(dicts[lang].chat.runs.videoReady));
      expect(html).not.toMatch(/ask me to post it/i);
    }
    expect(en.video.chatStoryReady).toMatch(/download it or post it from the AI video section/);
  });

  it("links to no article for a story told from memory, and says so with the check-every-fact warning; a very recent case says to check too", () => {
    const memory = ready(story({ fromMemory: true, subjectUrl: null, chosen: false }));
    expect(memory).toContain(esc(en.video.fromMemoryNote));
    expect(memory).not.toContain("wikipedia.org");
    expect(memory).not.toContain(esc(en.video.subjectChosenNote));
    expect(ready(story({ recent: true }))).toContain(esc(en.video.recentNote));
    expect(ready(story())).not.toContain(esc(en.video.recentNote));
    expect(ready(story())).not.toContain(esc(en.video.fromMemoryNote));
  });

  it("says why it was held back when it was to be posted by itself, and shows no credits line for a story with none", () => {
    expect(ready(story({ waited: en.video.waitRecent }))).toContain(esc(en.video.waitRecent));
    const none = ready(story({ credits: [], chosen: false }), "en", null);
    expect(none).not.toContain(esc(en.video.creditsTravel));
    // With no caption and no credits there is nothing to copy: the button is there but off.
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Copy the caption/);
    // A case that is not named shows no case line.
    expect(ready(story({ subject: null, subjectUrl: null, chosen: false }))).not.toContain(esc(en.video.subjectLine));
  });
});
