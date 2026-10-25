import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Video screen as the first paint shows it: the language control before the voice, the Kurdish voices only for Sorani and a male or
// female voice for the other two, the Ad / Story choice (a story has no product and no review), the language and kind on each job card, and
// the language control of the daily video. The server render shows the initial state, which is what the page decides from the store.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children?: unknown }) => createElement("a", { href }, children as never) }));
vi.mock("@/lib/upload-client", () => ({ upload: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({
  createVideoAction: vi.fn(),
  publishVideoAction: vi.fn(),
  refreshPlanAction: vi.fn(),
  removeRefAction: vi.fn(),
  saveMarketNotesAction: vi.fn(),
  saveVideoAutoAction: vi.fn(),
}));

import { autoHold } from "@/app/app/video/hold";
import { VideoClient } from "@/app/app/video/video-client";
import { PAWAN_VOICES } from "@/lib/voice/voices";
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

/** The text of the voice select: its options only. */
const voiceOptions = (html: string): string[] => {
  const select = /<select id="[^"]*-voice"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  return [...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
};
const pressed = (html: string, label: string) => new RegExp(`aria-pressed="true"[^>]*>${label}<`).test(html);

describe("the form of a new video", () => {
  it("opens as it always did for a Sorani ad: the Kurdish voices, the product, the review, the idea box of an ad", () => {
    const html = render();
    expect(voiceOptions(html)).toEqual([...PAWAN_VOICES]);
    expect(html).toContain(en.video.productLabel);
    expect(html).toContain(en.publish.ai.reviewLabel);
    expect(html).toContain('maxLength="300"');
    expect(pressed(html, "کوردی")).toBe(true);
    expect(pressed(html, en.video.kindAd)).toBe(true);
    expect(html).toContain(en.video.topicLabel);
  });

  it("shows the three languages, each in its own name, before the voice", () => {
    const html = render();
    for (const name of ["کوردی", "العربية", "English"]) expect(html).toContain(`>${name}<`);
    expect(html.indexOf(en.video.langLabel)).toBeGreaterThan(-1);
    expect(html.indexOf(en.video.langLabel)).toBeLessThan(html.indexOf(en.video.voiceLabel));
    expect(html).toContain(en.video.langHint);
  });

  it("offers a male and a female voice, not the Kurdish ones, for English and for Arabic", () => {
    for (const defaultLang of ["en", "ar"] as const) {
      const html = render({ defaultLang });
      expect(voiceOptions(html)).toEqual(["male", "female"]);
      expect(html).toContain(`>${en.video.voiceMale}<`);
      expect(html).toContain(`>${en.video.voiceFemale}<`);
      expect(html).not.toContain("Shilan");
    }
    expect(pressed(render({ defaultLang: "en" }), "English")).toBe(true);
    expect(pressed(render({ defaultLang: "ar" }), "العربية")).toBe(true);
  });

  it("starts the voice on the language's default: Shilan for Sorani, the female voice for an English ad, the male one for a story", () => {
    expect(render()).toMatch(/<option value="shilan" selected/);
    expect(render({ defaultLang: "en" })).toMatch(/<option value="female" selected/);
    expect(render({ defaultLang: "en", defaultKind: "story" })).toMatch(/<option value="male" selected/);
  });

  it("makes a story form, in every video language: no product, a bigger idea box, the story's own words about a real documented case", () => {
    for (const defaultLang of ["ckb", "en", "ar"] as const) {
      const html = render({ defaultKind: "story", defaultLang });
      expect(pressed(html, en.video.kindStory), defaultLang).toBe(true);
      expect(html).not.toContain(en.video.productLabel);
      expect(html).toContain('maxLength="1200"');
      expect(html).toContain(en.video.storyTopicLabel);
      expect(html).toContain(en.video.storyTopicPlaceholder);
      expect(html).toContain(en.video.kindStoryHint);
      // The owner is not asked to name a case, and the form says Gituas chooses a real one when none is named.
      expect(en.video.storyTopicPlaceholder).toMatch(/Gituas chooses a real documented case/);
      // A story cannot be started with no idea to tell.
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make the video<\/button>/);
    }
  });

  it("gives a story a Shape choice (vertical 9:16 pressed, wide 16:9 for YouTube beside it) in every video language; an ad's form has none", () => {
    for (const defaultLang of ["ckb", "en", "ar"] as const) {
      const story = render({ defaultKind: "story", defaultLang });
      expect(story, defaultLang).toContain(en.video.formatLabel);
      expect(story).toContain(`aria-pressed="true">${en.video.formatVertical}<`);
      expect(story).toContain(`aria-pressed="false">${en.video.formatWide}<`);
      expect(story).toContain(en.video.formatHint);
      const ad = render({ defaultKind: "ad", defaultLang });
      expect(ad).not.toContain(en.video.formatLabel);
      expect(ad).not.toContain(en.video.formatWide);
    }
    // In the person's language too.
    expect(render({ defaultKind: "story" }, "ckb")).toContain(ckb.video.formatWide);
    expect(render({ defaultKind: "story" }, "ar")).toContain(ar.video.formatWide);
  });

  it("gives a story its own review switch, visible and OFF, with its own explanation; an ad's stays on", () => {
    const on = (html: string) => /<input type="checkbox"[^>]*checked=""/.test(html);
    for (const defaultLang of ["ckb", "en", "ar"] as const) {
      const story = render({ defaultKind: "story", defaultLang });
      expect(story, defaultLang).toContain(en.publish.ai.reviewLabel);
      expect(story).toContain(en.video.storyReviewHelp);
      expect(story).not.toContain(en.publish.ai.reviewHelp);
      expect(on(story)).toBe(false);
    }
    const ad = render({ defaultKind: "ad" });
    expect(ad).toContain(en.publish.ai.reviewHelp);
    expect(ad).not.toContain(en.video.storyReviewHelp);
    expect(on(ad)).toBe(true);
  });

  it("explains the story review in the person's own language: on = reads the page and earlier videos, off = exactly the words", () => {
    expect(en.video.storyReviewHelp).toMatch(/On: Gituas reads your page and your earlier videos and rewrites your idea/);
    expect(en.video.storyReviewHelp).toMatch(/Off: Gituas uses exactly your words/);
    for (const d of [ckb, ar, en]) expect(d.video.storyReviewHelp.trim()).not.toBe("");
    expect(render({ defaultKind: "story" }, "ckb")).toContain(ckb.video.storyReviewHelp);
    expect(render({ defaultKind: "story" }, "ar")).toContain(ar.video.storyReviewHelp);
  });

  it("is in Sorani and in Arabic as well", () => {
    expect(render({ defaultKind: "story" }, "ckb")).toContain(ckb.video.storyTopicLabel);
    expect(render({ defaultKind: "story" }, "ar")).toContain(ar.video.storyTopicLabel);
    expect(render({ defaultLang: "ar" }, "ar")).toContain(`>${ar.video.voiceMale}<`);
  });
});

describe("the job cards", () => {
  it("name the language and the kind of each video; an old one is a Sorani ad", () => {
    const html = render({ jobs: [job({ id: "a", lang: "en", kind: "story", topic: "x".repeat(900) }), job({ id: "b" })] });
    expect(html).toContain(`>${en.video.kindStory}<`);
    expect(html).toContain(">English<");
    // The card with no language or kind is the Sorani ad every earlier video was.
    expect(html.match(new RegExp(`>${en.video.kindAd}<`, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">کوردی<");
    // A long story idea shows its beginning only.
    expect(html).not.toContain("x".repeat(400));
    expect(html).toContain(`${"x".repeat(300)}…`);
  });
});

describe("the daily video's card", () => {
  it("has the language control, on the store's video language, for every mode", () => {
    for (const mode of ["OFF", "DRAFT", "PUBLISH"]) {
      const html = render({ auto: { mode, tier: "LITE", hour: 19, lang: "en" } });
      expect(html).toContain(en.video.autoLangHint);
    }
    expect(render({ auto: { mode: "OFF", tier: "LITE", hour: 19 } })).toContain(en.video.autoLangHint);
  });

  it("is not shown to a person who may not configure", () => {
    expect(render({ configure: false })).not.toContain(en.video.autoLangHint);
  });
});

// Why the daily video has made nothing today. Nothing is stored about a skipped day, so the page reads the same limits the engine checks
// (autoHold, in the engine's order) and the card words the first one that holds.
describe("why the daily video is waiting", () => {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const HOLDS = ["paused", "voice", "allowance", "daily", "ai"] as const;
  const open = {
    mode: "DRAFT",
    tier: "LITE" as const,
    due: true,
    paused: false,
    hasVoice: true,
    allowances: { LITE: { limit: 30, left: 29 }, PRO: { limit: 0, left: 0 } },
    today: { used: 0, max: 1 },
    aiPercent: 10,
  };

  it("words the reason on the card in the person's language, and says nothing when nothing holds it", () => {
    const auto = { mode: "DRAFT", tier: "LITE" as const, hour: 19 };
    expect(render({ auto })).not.toContain("daily video is waiting");
    expect(render({ auto, autoHold: null })).not.toContain("daily video is waiting");
    for (const hold of HOLDS) {
      expect(render({ auto, autoHold: hold })).toContain(esc(en.video.autoHold[hold]));
      expect(render({ auto, autoHold: hold }, "ar")).toContain(esc(ar.video.autoHold[hold]));
      expect(render({ auto, autoHold: hold }, "ckb")).toContain(esc(ckb.video.autoHold[hold]));
    }
    // Like the card itself, it is for a person who may configure.
    expect(render({ auto, autoHold: "daily", configure: false })).not.toContain(esc(en.video.autoHold.daily));
  });

  it("has a sentence for every reason in every language, none empty, none in the wrong script", () => {
    for (const d of [ckb, ar, en]) expect(Object.keys(d.video.autoHold).sort()).toEqual([...HOLDS].sort());
    for (const hold of HOLDS) {
      for (const d of [ckb, ar, en]) expect(d.video.autoHold[hold].trim()).not.toBe("");
      expect(/[کیەێۆڕڵڤپچژگ]/.test(ar.video.autoHold[hold])).toBe(false);
      expect(/[؀-ۿ]/.test(en.video.autoHold[hold])).toBe(false);
    }
  });

  it("says nothing while the daily video is off, or before its hour has come or after the day's video was made", () => {
    expect(autoHold(open)).toBeNull();
    const blocked = { ...open, paused: true, hasVoice: false, allowances: { LITE: { limit: 30, left: 0 }, PRO: { limit: 0, left: 0 } }, today: { used: 1, max: 1 }, aiPercent: 100 };
    expect(autoHold({ ...blocked, mode: "OFF" })).toBeNull();
    expect(autoHold({ ...blocked, due: false })).toBeNull();
    expect(autoHold(blocked)).toBe("paused");
  });

  it("names the first reason the engine would stop on, in the engine's order", () => {
    expect(autoHold({ ...open, paused: true, hasVoice: false })).toBe("paused");
    expect(autoHold({ ...open, hasVoice: false, today: { used: 1, max: 1 } })).toBe("voice");
    expect(autoHold({ ...open, allowances: { LITE: { limit: 30, left: 0 }, PRO: { limit: 0, left: 0 } }, today: { used: 1, max: 1 } })).toBe("allowance");
    expect(autoHold({ ...open, today: { used: 1, max: 1 }, aiPercent: 100 })).toBe("daily");
    expect(autoHold({ ...open, aiPercent: 100 })).toBe("ai");
    expect(autoHold({ ...open, mode: "PUBLISH" })).toBeNull();
  });

  it("looks at the tier the plan has: a plan with only Opus videos is not held by its empty Haiku ones", () => {
    const opusOnly = { LITE: { limit: 0, left: 0 }, PRO: { limit: 30, left: 12 } };
    expect(autoHold({ ...open, allowances: opusOnly })).toBeNull();
    expect(autoHold({ ...open, allowances: { ...opusOnly, PRO: { limit: 30, left: 0 } } })).toBe("allowance");
    expect(autoHold({ ...open, tier: "PRO", allowances: { LITE: { limit: 30, left: 29 }, PRO: { limit: 0, left: 0 } } })).toBeNull();
  });
});
