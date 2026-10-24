import { beforeEach, describe, expect, it, vi } from "vitest";

// A story (a content video) and the other languages of a video: the script checks, the director's prompts, the plain
// storyboard per language, the brief of a content page and the voice that reads Arabic and English.
vi.mock("@/lib/db", () => ({
  db: {
    store: { findUnique: vi.fn() },
    brandKit: { findUnique: vi.fn() },
    product: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));
vi.mock("@/lib/ai/kurdgg", () => ({ kurdggConfigured: () => false, kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/proofread", () => ({ polishAdRaw: vi.fn(async (raw: unknown) => raw) }));
vi.mock("@/lib/shop/brand-name", () => ({ brandNameOf: vi.fn(async (s: { name: string }) => s.name) }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), head: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/voice/tts", () => ({ speak: vi.fn() }));
vi.mock("@/lib/news/video", () => ({ isNotSoraniRefusal: (e: unknown) => e instanceof Error && /70%/.test(e.message) }));

import { db } from "@/lib/db";
import { priceLineOf, loadAdBrief, type AdBrief } from "@/lib/advideo/brief";
import type { RefItem } from "@/lib/advideo/refs";
import { claimProblems, limitsFor, normalizeSpec, SCENE_TYPES, type NormalizeOptions } from "@/lib/advideo/spec";
import { makeResay, voiceScenes } from "@/lib/advideo/voice";
import { directorSystem, directorUser, fallbackSpec, writeAdSpec, type DirectorCall } from "@/lib/advideo/write";
import { completeJson } from "@/lib/ai/provider";
import { polishAdRaw } from "@/lib/ai/proofread";
import { speak } from "@/lib/voice/tts";

// ---- fixtures ----------------------------------------------------------------------------------------

const WORDS = ["the", "night", "was", "long", "and", "quiet", "street", "shadow"];
/** n plain English words with no digit and no price word. */
const say = (n: number) => Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(" ");
const spokenWords = (scenes: { voice: string }[]) => scenes.reduce((n, s) => n + s.voice.split(/\s+/).filter(Boolean).length, 0);

const beat = (type: string, over: Record<string, unknown> = {}) => ({ type, text: "The empty house", voice: "Nobody had lived there for years but the lights were on", ...over });
const goodStory = {
  look: { palette: "midnight", motion: "calm" },
  scenes: [beat("hook", { text: "The Locked Room" }), beat("story"), beat("story", { text: "Midnight" }), beat("story", { text: "Footsteps" }), beat("story", { text: "The Truth" }), beat("cta", { text: "Follow for more" })],
  caption: "The Locked Room\n#mystery #truecrime",
};
const story: NormalizeOptions = { photos: 0, clips: 0, hasTopic: true, maxScenes: 10, lang: "en", kind: "story" };

function ok(raw: unknown, o: NormalizeOptions) {
  const r = normalizeSpec(raw, o);
  if (!r.ok) throw new Error(`refused: ${r.errors.join(" | ")}`);
  return r.spec;
}
function refused(raw: unknown, o: NormalizeOptions): string {
  const r = normalizeSpec(raw, o);
  if (r.ok) throw new Error("was accepted");
  return r.errors.join(" | ");
}

// ---- the script of a story ---------------------------------------------------------------------------------

describe("a story's script", () => {
  it("keeps a good story: a hook, its beats and a closing invitation, with no icon and no plan", () => {
    const spec = ok(goodStory, story);
    expect(spec.scenes.map((s) => s.type)).toEqual(["hook", "story", "story", "story", "story", "cta"]);
    expect(spec.scenes.every((s) => s.icon === null)).toBe(true);
    expect(spec.plan).toBeUndefined();
    expect(spec.kind).toBe("story");
    expect(spec.lang).toBe("en");
    expect(spec.look.palette).toBe("midnight");
  });

  it("writes the kind and the language only when they are not the defaults", () => {
    const sorani = ok(goodStory, { ...story, lang: "ckb" });
    expect(sorani.kind).toBe("story");
    expect(sorani).not.toHaveProperty("lang");
  });

  it("accepts a year on the screen but refuses digits in the spoken line", () => {
    const withYear = { ...goodStory, scenes: [beat("hook", { text: "Room 12", sub: "June 1987" }), beat("story", { text: "1987" }), beat("story"), beat("story"), beat("cta")] };
    const spec = ok(withYear, story);
    expect(spec.scenes[0].sub).toBe("June 1987");
    expect(spec.scenes[1].text).toBe("1987");
    const spoken = { ...goodStory, scenes: [beat("hook"), beat("story", { voice: "It happened in 1987 on a cold night" }), beat("story"), beat("story"), beat("cta")] };
    expect(refused(spoken, story)).toMatch(/digits/);
  });

  it("refuses a link anywhere, on the screen, in the voice and in the caption", () => {
    const withLink = (over: Record<string, unknown>) => ({ ...goodStory, scenes: [beat("hook"), beat("story", over), beat("story"), beat("story"), beat("cta")] });
    expect(refused(withLink({ text: "Watch at tale.com" }), story)).toMatch(/link/);
    expect(refused(withLink({ sub: "www.tale.net/part2" }), story)).toMatch(/link/);
    expect(refused(withLink({ voice: "Read the rest at https://example.org/story now" }), story)).toMatch(/link/);
    expect(refused({ ...goodStory, caption: "Full story: www.tale.com" }, story)).toMatch(/link/);
  });

  it("does not allow offer, product or value scenes: they are dropped", () => {
    const mixed = { ...goodStory, scenes: [beat("hook"), beat("value", { icon: "gem" }), beat("product"), beat("offer"), beat("story"), beat("story"), beat("story"), beat("cta")] };
    expect(ok(mixed, { ...story, photos: 2 }).scenes.map((s) => s.type)).toEqual(["hook", "story", "story", "story", "cta"]);
    // Four scenes are the least a story has: with the shop scenes gone, three usable ones are refused.
    const four = { ...goodStory, scenes: [beat("hook"), beat("value"), beat("product"), beat("story"), beat("story"), beat("cta")] };
    expect(ok(four, { ...story, photos: 1 }).scenes).toHaveLength(4);
    const thin = { ...goodStory, scenes: [beat("hook"), beat("value"), beat("product"), beat("story"), beat("cta")] };
    expect(refused(thin, { ...story, photos: 1 })).toMatch(/only 3 usable scenes; at least 4/);
  });

  it("drops the story scenes from an ad and the ad scenes from a story", () => {
    const ad = { scenes: [beat("hook"), beat("story"), beat("value"), beat("cta")], caption: "x" };
    expect(ok(ad, { photos: 0, hasTopic: false, maxScenes: 6, lang: "en" }).scenes.map((s) => s.type)).toEqual(["hook", "value", "cta"]);
  });

  it("keeps a footage scene only when the owner has a clip", () => {
    const withClip = { ...goodStory, scenes: [beat("hook"), beat("story"), beat("footage", { clip: 1 }), beat("story"), beat("cta")] };
    expect(ok(withClip, { ...story, clips: 2 }).scenes.map((s) => [s.type, s.clip])).toEqual([["hook", null], ["story", null], ["footage", 1], ["story", null], ["cta", null]]);
    // Without a clip the footage scene goes, and what is left is too short for a story.
    expect(refused({ ...goodStory, scenes: [beat("hook"), beat("story"), beat("footage", { clip: 0 }), beat("cta")] }, story)).toMatch(/at least 4/);
    expect(ok(withClip, story).scenes).toHaveLength(4);
  });

  it("allows 160 spoken words in English and keeps every beat", () => {
    const long = { ...goodStory, scenes: [beat("hook", { voice: say(20) }), ...Array.from({ length: 6 }, (_, i) => beat("story", { text: `Part ${i + 1}`, voice: say(20) })), beat("cta", { voice: say(20) })] };
    const spec = ok(long, story);
    expect(spec.scenes).toHaveLength(8);
    expect(spokenWords(spec.scenes)).toBe(160);
  });

  it("never cuts a story that is over its words: it is refused with the counts, so the writer shortens it and keeps the ending", () => {
    // Eight beats of 30 words, a hook of 25 and a closing invitation of 15: 280 words against 165.
    const beats = Array.from({ length: 8 }, (_, i) => beat("story", { text: `Part ${i + 1}`, voice: say(30) }));
    const long = { ...goodStory, scenes: [beat("hook", { voice: say(25) }), ...beats, beat("cta", { voice: say(15) })] };
    const why = refused(long, story);
    expect(why).toContain("total 280 words");
    expect(why).toContain("at most 165");
    expect(why).toMatch(/keep the ending/);
    // The one-over case the old code trimmed silently (the turn and the ending were the beats that went).
    const oneOver = { ...goodStory, scenes: [beat("hook", { voice: say(21) }), ...Array.from({ length: 6 }, (_, i) => beat("story", { text: i === 5 ? "The Truth" : `Part ${i + 1}`, voice: say(21) })), beat("cta", { voice: say(21) })] };
    expect(spokenWords(oneOver.scenes as { voice: string }[])).toBe(168);
    expect(refused(oneOver, story)).toContain("total 168 words");
    // At the limit it stays whole, the ending included.
    const atLimit = { ...oneOver, scenes: [beat("hook", { voice: say(21) }), ...Array.from({ length: 6 }, (_, i) => beat("story", { text: i === 5 ? "The Truth" : `Part ${i + 1}`, voice: say(i === 5 ? 18 : 21) })), beat("cta", { voice: say(21) })] };
    const kept = ok(atLimit, story);
    expect(spokenWords(kept.scenes)).toBe(165);
    expect(kept.scenes.map((s) => s.text)).toContain("The Truth");
  });

  it("still drops the plain value scenes of an ad that is over its words", () => {
    const ad = { scenes: [beat("hook", { voice: say(16) }), ...Array.from({ length: 5 }, (_, i) => beat("value", { text: `Value ${"abcde"[i]}`, voice: say(16) })), beat("cta", { voice: say(16) })], caption: "x" };
    const spec = ok(ad, { photos: 0, hasTopic: false, maxScenes: 7, lang: "en" });
    expect(spokenWords(spec.scenes)).toBeLessThanOrEqual(80);
    expect(spec.scenes[0].type).toBe("hook");
    expect(spec.scenes.at(-1)?.type).toBe("cta");
  });

  it("allows fewer words in Sorani and Arabic, where the voice is slower", () => {
    expect(limitsFor("story", "en").voiceTotalWords).toBe(165);
    expect(limitsFor("story", "ar").voiceTotalWords).toBe(150);
    expect(limitsFor("story", "ckb").voiceTotalWords).toBe(135);
    const hundredFifty = { ...goodStory, scenes: [beat("hook", { voice: say(25) }), ...Array.from({ length: 4 }, (_, i) => beat("story", { text: `Part ${i + 1}`, voice: say(25) })), beat("cta", { voice: say(25) })] };
    expect(spokenWords(ok(hundredFifty, { ...story, lang: "en" }).scenes)).toBe(150);
    expect(spokenWords(ok(hundredFifty, { ...story, lang: "ar" }).scenes)).toBe(150);
    const sorani = refused(hundredFifty, { ...story, lang: "ckb" });
    expect(sorani).toContain("total 150 words");
    expect(sorani).toContain("at most 135");
  });

  it("allows a beat of 32 words and cuts it there; an ad's line stays at 16", () => {
    const spec = ok({ ...goodStory, scenes: [beat("hook", { voice: say(60) }), beat("story"), beat("story"), beat("story"), beat("cta")] }, story);
    expect(spec.scenes[0].voice.split(" ")).toHaveLength(32);
    const ad = ok({ scenes: [beat("hook", { voice: say(60) }), beat("value"), beat("cta")], caption: "x" }, { photos: 0, hasTopic: false, maxScenes: 6, lang: "en" });
    expect(ad.scenes[0].voice.split(" ")).toHaveLength(16);
  });

  it("needs the kicker text of a beat and cuts it to five words", () => {
    expect(refused({ ...goodStory, scenes: [beat("hook"), beat("story", { text: "" }), beat("story"), beat("story"), beat("cta")] }, story)).toMatch(/no on-screen text/);
    const spec = ok({ ...goodStory, scenes: [beat("hook"), beat("story", { text: "one two three four five six seven" }), beat("story"), beat("story"), beat("cta")] }, story);
    expect(spec.scenes[1].text).toBe("one two three four five");
  });

  it("uses a picture or a clip as a backdrop only when the index is real", () => {
    const pics = { ...goodStory, scenes: [beat("hook"), beat("story", { photo: 1 }), beat("story", { photo: 7, clip: 9 }), beat("story", { photo: null, clip: 0 }), beat("story"), beat("cta")] };
    const spec = ok(pics, { ...story, photos: 2, clips: 1 });
    expect(spec.scenes.map((s) => [s.photo, s.clip])).toEqual([[null, null], [1, null], [null, null], [null, 0], [null, null], [null, null]]);
  });

  it("allows at most the tier's scenes (eight for LITE, ten for PRO) and sends a longer story back instead of cutting its ending", () => {
    const many = { ...goodStory, scenes: [beat("hook", { voice: "a b c" }), ...Array.from({ length: 12 }, (_, i) => beat("story", { text: `Part ${i + 1}`, voice: "one two three" })), beat("cta", { voice: "a b c" })] };
    for (const max of [8, 10, 99]) {
      const r = normalizeSpec(many, { ...story, maxScenes: max });
      expect(r.ok).toBe(false);
      expect(JSON.stringify((r as { errors: string[] }).errors)).toMatch(/14 scenes but at most (8|10) are allowed.*keep the ending/);
    }
    const exact = { ...goodStory, scenes: [beat("hook", { voice: "a b c" }), ...Array.from({ length: 6 }, (_, i) => beat("story", { text: `Part ${i + 1}`, voice: "one two three" })), beat("cta", { voice: "a b c" })] };
    expect(ok(exact, { ...story, maxScenes: 8 }).scenes).toHaveLength(8);
  });

  it("lets the caption be 700 characters and a year be in it", () => {
    const spec = ok({ ...goodStory, caption: `The case of 1987. ${"a".repeat(800)}` }, story);
    expect(Array.from(spec.caption)).toHaveLength(700);
  });

  it("lets a story say free, sale, a thousand, a hundred and the Arabic for an opponent: they are words of a tale, not of a price", () => {
    const spoken = (voice: string, o: NormalizeOptions = story) => ok({ ...goodStory, scenes: [beat("hook"), beat("story", { voice }), beat("story"), beat("story"), beat("cta")] }, o).scenes[1].voice;
    expect(spoken("The killer finally walked free")).toBe("The killer finally walked free");
    expect(spoken("He offered a thousand reasons to stay")).toBe("He offered a thousand reasons to stay");
    expect(spoken("A hundred yards from the house, a million thoughts, a discount on the sale of the century")).toMatch(/hundred yards/);
    expect(spoken("كان خصمه ينتظره في الظلام", { ...story, lang: "ar" })).toBe("كان خصمه ينتظره في الظلام");
    expect(spoken("هەزار ساڵ لەمەوبەر", { ...story, lang: "ckb" })).toBe("هەزار ساڵ لەمەوبەر");
    const kicker = { ...goodStory, scenes: [beat("hook", { text: "Free at last" }), beat("story", { sub: "Sale of the century" }), beat("story"), beat("story"), beat("cta")] };
    expect(ok(kicker, story).scenes[0].text).toBe("Free at last");
    // The caption of a story is a teaser: the same words are fine there.
    expect(ok({ ...goodStory, caption: "Free at last: a thousand lies\n#truecrime" }, story).caption).toContain("a thousand lies");
  });

  it("still refuses digits and links in a story's spoken line, and says which kind of claim it was", () => {
    const withVoice = (voice: string) => ({ ...goodStory, scenes: [beat("hook"), beat("story", { voice }), beat("story"), beat("story"), beat("cta")] });
    expect(refused(withVoice("It was 1987 and the lights were on"), story)).toMatch(/digits/);
    expect(refused(withVoice("Read it at www.tale.com"), story)).toMatch(/mentions a link: leave it out/);
  });

  it("names the refused word when an ad is refused, so the writer knows which one to change", () => {
    const o = { photos: 0, hasTopic: false, maxScenes: 6, lang: "en" as const };
    const ad = (voice: string, caption = "Bags\n#bags") => ({ scenes: [{ type: "hook", text: "Bags", voice: "Welcome to the shop" }, { type: "value", text: "Quality", voice }, { type: "cta", text: "Order", voice: "Message us today" }], caption });
    expect(refused(ad("Feel free to message us anytime"), o)).toContain('a price or discount word ("free")');
    expect(refused(ad("Quality you can see", "A thousand bags\n#bags"), o)).toContain('the post caption mentions a price or discount word ("thousand")');
    // A Sorani or Arabic word is named as it stands in the text, not as the stem the check found it by.
    const sorani = { photos: 0, hasTopic: false, maxScenes: 6 };
    expect(refused(ad("داشکاندنی تایبەت بۆ تۆ"), sorani)).toContain('a price or discount word ("داشکاندنی")');
    expect(refused(ad("هەموو شتێک بێبەرامبەرە"), sorani)).toContain('("بێبەرامبەرە")');
  });

  it("makes the look dark whatever the model or the seed picked", () => {
    expect(ok({ ...goodStory, look: { palette: "cream" } }, story).look.palette).toBe("midnight");
    expect(ok({ ...goodStory, look: { palette: "brand-dark" } }, story).look.palette).toBe("brand-dark");
    expect(ok({ ...goodStory, look: undefined }, { ...story, seed: "any" }).look.palette).toMatch(/^(brand-dark|duotone|midnight)$/);
  });

  it("has a 'story' scene type next to the six it always had", () => {
    expect(SCENE_TYPES).toEqual(["hook", "value", "product", "offer", "footage", "cta", "story"]);
  });
});

// ---- English and Arabic ------------------------------------------------------------------------------------

describe("claims in English", () => {
  const en = { lang: "en" as const };

  it("refuses the words that announce a price, a discount or something free, as whole words only", () => {
    for (const t of ["Free delivery today", "Big SALE now", "Get a discount", "Half price this week", "Half-price bags", "A thousand happy customers", "Over a million sold", "A hundred styles", "Fifty percent less", "50 per cent less"]) {
      expect(claimProblems([t.replace(/\d+/g, "x")], "", en), t).toContain("a price or discount word");
    }
    expect(claimProblems(["Freedom for all"], "", en)).toEqual([]);
    expect(claimProblems(["Salesman of the year at the thousandth try"], "", en)).toEqual([]);
    expect(claimProblems(["Carefree summer, a saleable idea"], "", en)).toEqual([]);
    expect(claimProblems(["Sales are up, with discounts and millions of hundreds"], "", en)).toContain("a price or discount word");
  });

  it("lets through what the shop's data or the owner's own words say", () => {
    expect(claimProblems(["Free Spirit bags"], "Free Spirit Erbil", en)).toEqual([]);
    expect(claimProblems(["Free delivery"], "free delivery on every order", en)).toEqual([]);
    expect(claimProblems(["Free delivery"], "Freedom Street", en)).toContain("a price or discount word");
  });

  it("checks the English words only in an English video", () => {
    expect(claimProblems(["Get it free"], "")).toEqual([]);
    expect(claimProblems(["Get it free"], "", { lang: "ar" })).toEqual([]);
    expect(claimProblems(["Get it free"], "", en)).toContain("a price or discount word");
  });

  it("still finds the Sorani and Arabic ones", () => {
    expect(claimProblems(["خصم كبير"], "", en)).toContain("a price or discount word");
    expect(claimProblems(["داشکاندنی تایبەت"], "", { lang: "ar" })).toContain("a price or discount word");
  });

  it("refuses an English ad that says free, and an English caption that does", () => {
    const base = { scenes: [{ type: "hook", text: "Bags", voice: "Welcome to the shop" }, { type: "value", text: "Quality", voice: "Delivery is free for you" }, { type: "cta", text: "Order", voice: "Message us today" }], caption: "Bags\n#bags" };
    const o = { photos: 0, hasTopic: false, maxScenes: 6, lang: "en" as const };
    expect(refused(base, o)).toMatch(/price or discount word/);
    expect(refused({ ...base, scenes: [base.scenes[0], { ...base.scenes[1], voice: "Delivery is quick" }, base.scenes[2]], caption: "Free bags\n#bags" }, o)).toMatch(/caption mentions a price or discount word/);
  });
});

describe("an English video has no Arabic letters", () => {
  const en = { photos: 0, hasTopic: false, maxScenes: 6, lang: "en" as const };
  const base = { scenes: [beat("hook"), beat("value"), beat("cta")], caption: "Bags\n#bags" };

  it("refuses an Arabic-script letter in the text, the sub, the voice and the caption and says what to do", () => {
    for (const over of [{ text: "بوتۆلیۆ" }, { sub: "جانتا" }, { voice: "Welcome to بوتۆلیۆ today" }]) {
      const e = refused({ ...base, scenes: [beat("hook"), beat("value", over), beat("cta")] }, en);
      expect(e).toMatch(/Arabic-script letters/);
      expect(e).toMatch(/Latin letters/);
    }
    expect(refused({ ...base, caption: "جانتا #bags" }, en)).toMatch(/caption has Arabic-script letters/);
  });

  it("accepts the same words in Latin letters, and does not look for Latin letters in Arabic", () => {
    expect(normalizeSpec(base, en).ok).toBe(true);
    const ar = { scenes: [{ type: "hook", text: "جانتا", voice: "أهلاً بك في متجرنا" }, { type: "value", text: "الجودة", voice: "الجودة واضحة" }, { type: "cta", text: "تواصل", voice: "تواصل معنا" }], caption: "جانتا #متجر" };
    expect(normalizeSpec(ar, { ...en, lang: "ar" }).ok).toBe(true);
    // Sorani letters in a Sorani ad are what they always were.
    expect(normalizeSpec(ar, { photos: 0, hasTopic: false, maxScenes: 6 }).ok).toBe(true);
  });
});

// ---- the director ------------------------------------------------------------------------------------------

const shop: AdBrief = {
  name: "بوتۆلیۆ",
  tagline: "جانتای ژنانە",
  deliveryNote: "گەیاندن بۆ هەموو شارەکان",
  deliveryLine: "گەیاندن: ٥٬٠٠٠ دینار",
  primary: "#0B2545",
  accent: "#E0A526",
  logoUrl: null,
  handle: "@botolio",
  phone: "0750 123 4567",
  product: { id: "p1", name: "جانتای ڕەش", description: null, priceLine: "٢٥٬٠٠٠ دینار", photos: ["https://x/p1.jpg"], inStock: true },
  catalog: [{ name: "جزدان", priceLine: "١٠٬٠٠٠ دینار" }],
  photos: ["https://x/p1.jpg"],
  refPhotos: 0,
  refIndices: [],
  clips: [],
};
const channel: AdBrief = { ...shop, name: "The Secret File", tagline: null, deliveryNote: null, deliveryLine: null, phone: null, product: null, catalog: [], photos: [], handle: "@thesecretfile26" };

describe("the director's prompt", () => {
  it("is the same for a Sorani ad whether the language and kind are given or not", () => {
    expect(directorSystem("LITE")).toBe(directorSystem("LITE", "ckb", "ad"));
    expect(directorSystem("PRO")).toBe(directorSystem("PRO", "ckb", "ad"));
    expect(directorSystem("LITE")).toContain("every on-screen text and every spoken line is Central Kurdish (Sorani");
    expect(directorUser(shop, "x")).toBe(directorUser(shop, "x", undefined, { lang: "ckb", kind: "ad" }));
    expect(directorUser(shop, "x")).not.toContain("output_language");
  });

  it("asks for Arabic and for English in their own words, with the brand name in their own letters", () => {
    const ar = directorSystem("LITE", "ar", "ad");
    expect(ar).toContain("Modern Standard Arabic");
    expect(ar).toContain("write it in Arabic letters");
    expect(ar).not.toContain("Central Kurdish");
    expect(directorUser(shop, null, undefined, { lang: "ar" })).toContain("one spoken Arabic sentence");
    expect(directorUser(shop, null, undefined, { lang: "ar" })).toContain("hashtags in Arabic letters");
    const en = directorSystem("PRO", "en", "ad");
    expect(en).toContain("natural, warm, spoken English");
    expect(en).toContain("write it in Latin letters");
    expect(en).not.toContain("Central Kurdish");
    expect(directorUser(shop, null, undefined, { lang: "en" })).toContain("one spoken English sentence");
    expect(directorUser(shop, null, undefined, { lang: "en" })).toContain("hashtags in English");
    expect(directorUser(shop, null, undefined, { lang: "en" })).toContain('"output_language": "English"');
    expect(directorUser(shop, null, undefined, { lang: "en" })).toMatch(/Write the brand and product names in Latin letters/);
  });

  it("has its own prompt for a story, with the word total of its language and a guard for real people", () => {
    for (const [lang, total] of [["en", 165], ["ar", 150], ["ckb", 135]] as const) {
      const s = directorSystem("LITE", lang, "story");
      expect(s).toContain(`at most ${total} words`);
      expect(s).toContain("up to 32 words");
    }
    const s = directorSystem("PRO", "en", "story");
    expect(s).toMatch(/Never present a real, named, living person as guilty of anything/);
    expect(s).toMatch(/Never invent phone numbers, addresses, e-mail, prices, offers or links/);
    expect(s).toContain("natural spoken English");
    expect(s).toContain("palette: brand-dark | brand-light | brand-flood | duotone | cream | midnight");
    expect(s).toContain("dark and moody");
    expect(s).not.toContain("small shops");
    expect(directorSystem("LITE", "en", "story")).not.toBe(directorSystem("PRO", "en", "story"));
    expect(directorSystem("LITE", "en", "story")).not.toBe(directorSystem("LITE", "en", "ad"));
    expect(directorSystem("LITE", "ckb", "story")).toContain("Central Kurdish (Sorani");
  });

  it("tells a story's writer about the channel and the request, and nothing about a shop", () => {
    const u = directorUser(shop, "A detective finds a locked room", ["scene 2 has digits"], {
      kind: "story",
      lang: "en",
      channel: { about: "English mystery and crime stories" },
      recentHooks: ["The Locked Room"],
    });
    const facts = JSON.parse(u.slice(u.indexOf("{"), u.indexOf("\n}\n") + 2)) as Record<string, unknown>;
    expect(Object.keys(facts).sort()).toEqual(["channel", "clips_available", "language", "photos_available", "recent_hooks", "recently_used_looks", "reference_picture_indices", "story_request"]);
    expect(facts.channel).toEqual({ name: "بوتۆلیۆ", about: "English mystery and crime stories" });
    expect(facts.story_request).toBe("A detective finds a locked room");
    expect(facts.language).toBe("English");
    expect(facts.recent_hooks).toEqual(["The Locked Room"]);
    expect(u).toContain("scene 2 has digits");
    for (const shopWord of ["delivery", "price", "phone", "catalog", "todays_plan", "other_products", "0750", "٥٬٠٠٠", "جزدان", "جانتای ڕەش", "گەیاندن"]) {
      expect(u, shopWord).not.toContain(shopWord);
    }
    expect(u).toContain('"type": "hook" | "story" | "footage" | "cta"');
    expect(u).not.toContain("value scenes only");
  });

  it("asks a story to choose its own story when the request is empty", () => {
    const u = directorUser(channel, null, undefined, { kind: "story", lang: "en", channel: { about: "mysteries" } });
    expect(u).toContain('"story_request": null');
    expect(u).toContain("choose the next story yourself");
  });
});

describe("writing a story", () => {
  beforeEach(() => vi.mocked(polishAdRaw).mockClear());
  // These cases are about the writer's mechanics (time, tokens, links, the proofreader), not about what is true: the classic
  // way of telling a story. The documented and the fiction ways are in documentary.test.ts.
  const input = { tier: "LITE" as const, brief: channel, topic: "A locked room mystery", lang: "en" as const, kind: "story" as const, mode: "classic" as const, channel: { about: "English mystery stories" } };

  it("returns the model's story, with its kind and language, and nothing of an ad's plan", async () => {
    const call: DirectorCall = async () => ({ data: goodStory, model: "m" });
    const w = await writeAdSpec({ ...input, call });
    expect(w.fallback).toBe(false);
    expect(w.spec.kind).toBe("story");
    expect(w.spec.lang).toBe("en");
    expect(w.spec.plan).toBeUndefined();
    expect(w.spec.scenes.map((s) => s.type)).toEqual(["hook", "story", "story", "story", "story", "cta"]);
  });

  it("never makes a story from a template: after two failed tries it throws", async () => {
    const call = vi.fn<DirectorCall>(async () => ({ data: { scenes: [] }, model: "m" }));
    await expect(writeAdSpec({ ...input, call })).rejects.toThrow(/story could not be written/);
    expect(call).toHaveBeenCalledTimes(2);
    expect(String(call.mock.calls[1][0].user)).toContain("was refused because");
    const down = vi.fn<DirectorCall>(async () => { throw new Error("down"); });
    await expect(writeAdSpec({ ...input, call: down })).rejects.toThrow(/story could not be written/);
  });

  it("gives a story more time and room than an ad: 30 s and 3600 tokens on LITE, 50 s and 4800 on PRO", async () => {
    const seen: { timeout: number; maxTokens: number | undefined; system: string }[] = [];
    const call: DirectorCall = async (c, timeout) => {
      seen.push({ timeout, maxTokens: c.maxTokens, system: c.system });
      return { data: goodStory, model: "m" };
    };
    await writeAdSpec({ ...input, tier: "LITE", call });
    await writeAdSpec({ ...input, tier: "PRO", call });
    await writeAdSpec({ tier: "PRO", brief: shop, topic: null, call: async (c, t) => { seen.push({ timeout: t, maxTokens: c.maxTokens, system: c.system }); return { data: { scenes: [] }, model: "m" }; } });
    expect(seen[0]).toMatchObject({ timeout: 30_000, maxTokens: 3600 });
    expect(seen[1]).toMatchObject({ timeout: 50_000, maxTokens: 4800 });
    expect(seen[2]).toMatchObject({ timeout: 40_000, maxTokens: 3200 });
    expect(seen[0].system).toBe(directorSystem("LITE", "en", "story"));
  });

  it("asks again with the problem when an English story has Arabic letters", async () => {
    const arabic = { ...goodStory, scenes: [beat("hook", { text: "الغرفة" }), ...goodStory.scenes.slice(1)] };
    const call = vi.fn<DirectorCall>().mockResolvedValueOnce({ data: arabic, model: "m" }).mockResolvedValueOnce({ data: goodStory, model: "m" });
    const w = await writeAdSpec({ ...input, call });
    expect(w.fallback).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    expect(String(call.mock.calls[1][0].user)).toMatch(/Arabic-script letters/);
  });

  it("refuses a link in a story's caption that nothing the owner wrote carries", async () => {
    const call: DirectorCall = async () => ({ data: { ...goodStory, caption: "Read it at www.tale.com" }, model: "m" });
    await expect(writeAdSpec({ ...input, call })).rejects.toThrow(/link/);
  });

  it("lets through an address the owner's request, the channel's description or its name carries, and nothing else", async () => {
    const withCaption = (caption: string): DirectorCall => async () => ({ data: { ...goodStory, caption }, model: "m" });
    // What the channel is about says the address.
    const about = await writeAdSpec({ ...input, channel: { about: "True stories, found at tale.com" }, call: withCaption("The Locked Room: tale.com\n#mystery") });
    expect(about.spec.caption).toContain("tale.com");
    // The owner's request says it, and so it may be on the screen too.
    const scenes = [beat("hook"), beat("story", { sub: "legend.org" }), beat("story"), beat("story"), beat("cta")];
    const topic = await writeAdSpec({ ...input, topic: "A mystery, credit legend.org", call: async () => ({ data: { ...goodStory, scenes }, model: "m" }) });
    expect(topic.spec.scenes[1].sub).toBe("legend.org");
    // The channel's name too (it is the owner's own).
    const named = await writeAdSpec({ ...input, brief: { ...channel, name: "Tale.com Stories" }, call: withCaption("Tale.com Stories presents\n#mystery") });
    expect(named.spec.caption).toContain("Tale.com Stories");
    // With no address in any of them, the same caption is refused.
    await expect(writeAdSpec({ ...input, channel: { about: "True stories" }, call: withCaption("Also at other.net\n#mystery") })).rejects.toThrow(/link/);
  });

  it("sends the Sorani proofreader only Sorani: not an Arabic or English video", async () => {
    const call: DirectorCall = async () => ({ data: goodStory, model: "m" });
    await writeAdSpec({ ...input, lang: "en", call });
    await writeAdSpec({ ...input, lang: "ar", call: async () => ({ data: { ...goodStory, scenes: goodStory.scenes.map((s) => ({ ...s, text: "مساء", voice: "كان الليل طويلا وهادئا" })), caption: "قصة\n#قصة" }, model: "m" }) });
    expect(polishAdRaw).not.toHaveBeenCalled();
    const ad = await writeAdSpec({ tier: "LITE", brief: shop, topic: null, lang: "ar", call: async () => ({ data: { scenes: [] }, model: "m" }) });
    expect(ad.fallback).toBe(true);
    expect(polishAdRaw).not.toHaveBeenCalled();
    // Sorani still goes through it, ads and stories alike.
    await writeAdSpec({ tier: "LITE", brief: shop, topic: null, call: async () => ({ data: { scenes: [] }, model: "m" }) });
    expect(polishAdRaw).toHaveBeenCalledTimes(2);
    await writeAdSpec({ ...input, lang: "ckb", call });
    expect(polishAdRaw).toHaveBeenCalledTimes(3);
  });

  it("writes an English ad from the model and falls back to a plain English one when it can not", async () => {
    const good = { scenes: [beat("hook", { text: "Botolio" }), beat("value", { icon: "gem" }), beat("cta", { text: "Message us" })], caption: "Botolio\n#bags #erbil" };
    const w = await writeAdSpec({ tier: "LITE", brief: { ...shop, name: "Botolio" }, topic: null, lang: "en", call: async () => ({ data: good, model: "m" }) });
    expect(w.fallback).toBe(false);
    expect(w.spec.lang).toBe("en");
    const plain = await writeAdSpec({ tier: "LITE", brief: shop, topic: null, lang: "en", call: async () => ({ data: { scenes: [] }, model: "m" }) });
    expect(plain.fallback).toBe(true);
    expect(plain.spec.lang).toBe("en");
    expect(plain.spec.kind).toBeUndefined();
    expect(plain.spec.scenes.at(-1)?.voice).toBe("To order or to ask anything, just get in touch");
  });
});

describe("the plain storyboard in each language", () => {
  it("is the Sorani one it always was", () => {
    const f = fallbackSpec(shop);
    expect(f.scenes[0]).toMatchObject({ type: "hook", text: "بوتۆلیۆ", sub: "جانتای ژنانە", voice: "بەخێربێیت بۆ ئەم دووکانە جوانە، ئێمە هەموو کات لێرەین بۆ تۆ" });
    expect(f).not.toHaveProperty("lang");
    expect(f).not.toHaveProperty("kind");
    expect(fallbackSpec(shop, "s", [], null, "ckb")).toEqual(fallbackSpec(shop, "s"));
  });

  it("speaks Arabic and English, and the owner's words pass the video's own checks", () => {
    for (const lang of ["ar", "en"] as const) {
      const f = fallbackSpec(shop, "s", [], null, lang);
      expect(f.lang).toBe(lang);
      expect(f.scenes.map((s) => s.type)).toEqual(["hook", "value", "value", "product", "cta"]);
      const again = normalizeSpec(f, { photos: 1, hasTopic: false, maxScenes: 7, lang });
      expect(again.ok, lang).toBe(true);
    }
    const ar = fallbackSpec(shop, "s", [], null, "ar");
    expect(ar.scenes[2].text).toBe("التوصيل");
    expect(ar.caption).toContain("#كردستان");
    const en = fallbackSpec(shop, "s", [], null, "en");
    expect(en.scenes[2].text).toBe("Delivery");
    expect(en.caption).toContain("#shop #kurdistan");
  });

  it("shows no Arabic letters in an English video: a brand written in them is replaced by a plain word", () => {
    const f = fallbackSpec(shop, "s", [], null, "en");
    expect(JSON.stringify(f)).not.toMatch(/\p{Script=Arabic}/u);
    expect(f.scenes[0].text).toBe("Welcome");
    expect(f.scenes[3].text).toBe("Our product");
    const latin = fallbackSpec({ ...shop, name: "Botolio", tagline: "Women's bags", product: { ...shop.product!, name: "Black bag" }, deliveryNote: "Fast" }, "s", [], null, "en");
    expect(latin.scenes[0]).toMatchObject({ text: "Botolio", sub: "Women's bags" });
    expect(latin.scenes[3].text).toBe("Black bag");
    expect(latin.caption.startsWith("Botolio\n")).toBe(true);
  });
});

// ---- the brief ---------------------------------------------------------------------------------------------

describe("the price line in each language", () => {
  const one = [{ amountMinor: 25000, currency: "IQD", inStock: true }];
  const many = [...one, { amountMinor: 27000, currency: "IQD", inStock: true }];

  it("says 'from' in the video's language when the variants differ", () => {
    expect(priceLineOf(many)?.startsWith("لە ")).toBe(true);
    expect(priceLineOf(many, "ckb")).toBe(priceLineOf(many));
    expect(priceLineOf(many, "ar")?.startsWith("من ")).toBe(true);
    expect(priceLineOf(many, "en")).toMatch(/^from 25,000 IQD$/);
  });

  it("writes a single price with the digits of the language and no 'from'", () => {
    expect(priceLineOf(one, "en")).toBe("25,000 IQD");
    expect(priceLineOf(one, "ar")).toBe(priceLineOf(one, "ar")?.replace(/^من /, ""));
    expect(priceLineOf(one, "ar")).toMatch(/د\.ع$/);
    expect(priceLineOf(one)).toBe(priceLineOf(one, "ckb"));
    expect(priceLineOf([{ amountMinor: 25000, currency: "IQD", inStock: false }], "en")).toBeNull();
  });
});

describe("the brief of a content page", () => {
  const own = (n: string) => `https://abc.public.blob.vercel-storage.com/merchant/t1/${n}`;
  const ref = (kind: "image" | "video", url: string, name: string): RefItem => ({ kind, url, name, pathname: `merchant/t1/${name}`, size: 1000, uploadedAt: "2026-10-12T00:00:00Z" });
  const refs = [ref("image", own("ref1.jpg"), "ref1.jpg"), ref("video", own("clip1.mp4"), "clip1.mp4"), ref("image", "https://evil.example/merchant/t1/x.jpg", "x.jpg")];
  const m = db as unknown as { store: { findUnique: ReturnType<typeof vi.fn> }; brandKit: { findUnique: ReturnType<typeof vi.fn> }; product: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    m.store.findUnique.mockReset().mockResolvedValue({
      id: "s1", tenantId: "t1", name: "The Secret File", igUsername: "thesecretfile26", fbPageId: null, igUserId: null,
      deliveryFeeMinor: 5000, deliveryCurrency: "IQD", deliveryTime: "1 day", deliveryCityFees: null,
      tenant: { id: "t1", name: "Zorin", whatsappNumber: "9647501234567" },
    });
    m.brandKit.findUnique.mockReset().mockResolvedValue({ logoPath: null, primary: "#101820", accent: "#C8A24A", tagline: "Stories after dark", deliveryNote: "Delivery in two days" });
    m.product.findMany.mockReset().mockResolvedValue([{ id: "p1", name: "Bag", description: null, photos: [own("p1.jpg")], variants: [{ amountMinor: 25000, currency: "IQD", inStock: true }] }]);
    m.product.findFirst.mockReset();
  });

  it("has no product, no catalog, no delivery line or note and no phone, and only the owner's own pictures", async () => {
    const b = await loadAdBrief("s1", "p1", refs, { kind: "story", lang: "en" });
    expect(b).toMatchObject({ name: "The Secret File", tagline: "Stories after dark", product: null, catalog: [], deliveryLine: null, deliveryNote: null, phone: null, handle: "@thesecretfile26" });
    expect(b?.photos).toEqual([own("ref1.jpg")]);
    expect(b?.refIndices).toEqual([0]);
    expect(b?.clips).toEqual([own("clip1.mp4")]);
    // The product list is never even read for a story.
    expect(m.product.findMany).not.toHaveBeenCalled();
    expect(m.product.findFirst).not.toHaveBeenCalled();
  });

  it("writes an ad's delivery line and prices in the video's language", async () => {
    const en = await loadAdBrief("s1", "p1", [], { lang: "en" });
    expect(en?.deliveryLine).toBe("Delivery: 5,000 IQD — 1 day");
    expect(en?.product?.priceLine).toBe("25,000 IQD");
    expect(en?.phone).toBe("0750 123 4567");
    const ar = await loadAdBrief("s1", "p1", [], { lang: "ar" });
    expect(ar?.deliveryLine?.startsWith("التوصيل")).toBe(true);
    // Without options it is the Sorani ad it always was.
    const old = await loadAdBrief("s1", "p1");
    expect(old?.deliveryLine?.startsWith("گەیاندن")).toBe(true);
    expect(old?.product?.priceLine).toBe(priceLineOf([{ amountMinor: 25000, currency: "IQD", inStock: true }], "ckb"));
    expect(old?.deliveryNote).toBe("Delivery in two days");
  });
});

// ---- the voice -----------------------------------------------------------------------------------------------

describe("the voice of an Arabic or English video", () => {
  const scenes = ["hook", "story", "story", "cta"].map((type, i) => ({ type: type as "hook", text: `t${i}`, sub: null, voice: `line ${i}`, icon: null, photo: null, clip: null }));
  const audio = (s: string) => ({ audio: Buffer.from(s), mime: "audio/wav" as const });
  const base = { tenantId: "t1", jobId: "j1", store: async (p: string) => `https://blob/${p}`, existing: async () => null };

  beforeEach(() => vi.mocked(speak).mockReset());

  it("reads with the video's language, the voice and the kind in the third argument, and stores a WAV", async () => {
    const said: unknown[][] = [];
    const stored: string[] = [];
    const out = await voiceScenes({
      ...base, voice: "male", scenes, lang: "en", kind: "story",
      say: async (...a) => { said.push(a); return audio(String(a[0])); },
      store: async (p) => { stored.push(p); return `https://blob/${p}`; },
    });
    expect(out).toHaveLength(4);
    expect(said[0]).toEqual(["line 0", "male", { lang: "en", kind: "story" }]);
    expect(stored[0]).toBe("merchant/t1/advideo/j1/vo-0.wav");
  });

  it("never rewrites a refused line into Sorani: the error stands", async () => {
    const resay = vi.fn(async () => "x");
    const say = async () => { throw new Error("At least 70% of the text must be Central Kurdish (Sorani)."); };
    await expect(voiceScenes({ ...base, voice: "male", scenes: [scenes[0]], lang: "en", say, resay })).rejects.toThrow(/70%/);
    expect(resay).not.toHaveBeenCalled();
    await expect(voiceScenes({ ...base, voice: "male", scenes: [scenes[0]], lang: "ar", say, resay })).rejects.toThrow();
    expect(resay).not.toHaveBeenCalled();
  });

  it("finds a clip an earlier attempt already made, MP3 or WAV, and does not pay for it again", async () => {
    const asked: string[] = [];
    const say = vi.fn(async (t: string) => audio(t));
    const out = await voiceScenes({
      ...base, voice: "female", scenes: scenes.slice(0, 2), lang: "en", say,
      existing: async (p) => { asked.push(p); return p.endsWith("vo-0.wav") ? "https://blob/old/vo-0.wav" : p.endsWith("vo-1.mp3") ? "https://blob/old/vo-1.mp3" : null; },
    });
    expect(out.map((o) => o.url)).toEqual(["https://blob/old/vo-0.wav", "https://blob/old/vo-1.mp3"]);
    expect(say).not.toHaveBeenCalled();
    expect(asked).toContain("merchant/t1/advideo/j1/vo-0.wav");
  });

  it("looks only for the MP3 of a Sorani clip and calls the voice with two arguments, as before", async () => {
    const asked: string[] = [];
    const args: unknown[][] = [];
    await voiceScenes({
      ...base, voice: "shilan", scenes: scenes.slice(0, 1), say: async (...a) => { args.push(a); return { audio: Buffer.from("x"), mime: "audio/mpeg" as const }; },
      existing: async (p) => { asked.push(p); return null; },
    });
    expect(asked).toEqual(["merchant/t1/advideo/j1/vo-0.mp3"]);
    expect(args[0]).toEqual(["line 0", "shilan"]);
  });

  it("fails a story whose beat can not be read, where an ad would drop the middle scene", async () => {
    const say = async (text: string) => {
      if (text === "line 1") throw new Error("no voice");
      return audio(text);
    };
    await expect(voiceScenes({ ...base, voice: "male", scenes, lang: "en", kind: "story", say })).rejects.toThrow("no voice");
    const ad = scenes.map((s, i) => (i === 1 ? { ...s, type: "value" as const } : i === 2 ? { ...s, type: "value" as const } : s));
    const out = await voiceScenes({ ...base, voice: "female", scenes: ad, lang: "en", kind: "ad", say });
    expect(out.map((o) => o.scene.type)).toEqual(["hook", "value", "cta"]);
  });

  it("fails a story whose narrated footage beat can not be read, as it fails any other beat", async () => {
    const withFootage = scenes.map((s, i) => (i === 1 ? { ...s, type: "footage" as const, clip: 0 } : s));
    const say = async (text: string) => {
      if (text === "line 1") throw new Error("gemini 200: no audio (STOP)");
      return audio(text);
    };
    await expect(voiceScenes({ ...base, voice: "male", scenes: withFootage, lang: "en", kind: "story", say })).rejects.toThrow("no audio");
    // An ad's footage beat is still left out when it can not be read (the hook and the ending are what an ad needs).
    const out = await voiceScenes({ ...base, voice: "female", scenes: withFootage, lang: "en", kind: "ad", say });
    expect(out.map((o) => o.scene.type)).toEqual(["hook", "story", "cta"]);
  });

  it("asks Gemini for the gender of the stored voice, in a storyteller's style for a story and a warm one for an ad", async () => {
    vi.mocked(speak).mockImplementation(async () => ({ audio: Buffer.from("w"), mime: "audio/wav", provider: "gemini" }));
    await voiceScenes({ ...base, voice: "female", scenes: scenes.slice(0, 1), lang: "en", kind: "ad" });
    await voiceScenes({ ...base, voice: "male", scenes: scenes.slice(0, 1), lang: "ar", kind: "story" });
    await voiceScenes({ ...base, voice: "shilan", scenes: scenes.slice(0, 1), lang: "en", kind: "story" });
    const calls = vi.mocked(speak).mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ lang: "en", gender: "female", text: "line 0" });
    expect(calls[0].style).toMatch(/warm, friendly/);
    expect(calls[1]).toMatchObject({ lang: "ar", gender: "male" });
    expect(calls[1].style).toMatch(/storyteller.*Modern Standard Arabic/);
    // A voice name that is not male or female is read as male; no gender is guessed from a Pawan name.
    expect(calls[2]).toMatchObject({ lang: "en", gender: "male" });
  });

  it("reads a story as a calm storyteller of any genre, not as a dark mystery told slowly", async () => {
    vi.mocked(speak).mockImplementation(async () => ({ audio: Buffer.from("w"), mime: "audio/wav", provider: "gemini" }));
    await voiceScenes({ ...base, voice: "male", scenes: scenes.slice(0, 1), lang: "en", kind: "story" });
    await voiceScenes({ ...base, voice: "male", scenes: scenes.slice(0, 1), lang: "ar", kind: "story" });
    for (const c of vi.mocked(speak).mock.calls) {
      expect(c[0].style).toMatch(/calm.*storyteller/);
      expect(c[0].style).not.toMatch(/dark|mystery|slowly|suspense/i);
    }
  });

  it("reads Sorani exactly as before: the language, the voice and nothing else", async () => {
    vi.mocked(speak).mockImplementation(async () => ({ audio: Buffer.from("m"), mime: "audio/mpeg", provider: "pawan" }));
    await voiceScenes({ ...base, voice: "shilan", scenes: scenes.slice(0, 1) });
    expect(vi.mocked(speak).mock.calls[0][0]).toEqual({ text: "line 0", lang: "ckb", voice: "shilan" });
  });
});

describe("a Sorani story beat the voice refuses", () => {
  const refusal = new Error("pawan 400: At least 70% of the text must be Central Kurdish (Sorani).");
  const beatOf = (type: "hook" | "story" | "cta", voice: string) => ({ type, text: "t", sub: null, voice, icon: null, photo: null, clip: null });
  const base = { tenantId: "t1", jobId: "j1", store: async (p: string) => `https://blob/${p}`, existing: async () => null, voice: "shilan" };
  const mp3 = { audio: Buffer.from("m"), mime: "audio/mpeg" as const };

  it("asks the rewrite to keep the beat when it is a story's, and with the ad's one argument when it is an ad's", async () => {
    const original = "ئەو شەوە ژوورەکە چۆڵ بوو و تەنیا ڕووناکییەک ماوە";
    const said: string[] = [];
    const say = async (t: string) => { said.push(t); if (t === original) throw refusal; return mp3; };
    const resay = vi.fn(async () => "ئەو شەوە ژوورەکە بەتاڵ بوو و تەنیا ڕووناکییەک لە دوور مابووەوە");
    const out = await voiceScenes({ ...base, scenes: [beatOf("story", original)], kind: "story", say, resay });
    expect(resay).toHaveBeenCalledWith(original, { kind: "story" });
    expect(out[0].scene.voice).toBe("ئەو شەوە ژوورەکە بەتاڵ بوو و تەنیا ڕووناکییەک لە دوور مابووەوە");
    resay.mockClear();
    said.length = 0;
    await voiceScenes({ ...base, scenes: [beatOf("hook", original)], kind: "ad", say, resay });
    expect(resay).toHaveBeenCalledWith(original);
  });

  it("fails the beat when the rewrite does not come, instead of dropping or shortening it", async () => {
    const say = async () => { throw refusal; };
    await expect(voiceScenes({ ...base, scenes: [beatOf("story", "ئەو شەوە ژوورەکە چۆڵ بوو")], kind: "story", say, resay: async () => null })).rejects.toThrow(/70%/);
  });

  it("makes the rewrite keep the meaning, the names and the length of a story's beat, and a short sentence of an ad's line", async () => {
    const original = Array.from({ length: 30 }, (_, i) => `وشە${i}`).join(" ");
    const answer = (n: number) => Array.from({ length: n }, (_, i) => `نوێ${i}`).join(" ");
    /** What makeResay sends the model, and what it makes of an answer of n words. */
    async function ask(n: number, kind?: "story") {
      vi.mocked(completeJson).mockReset();
      vi.mocked(completeJson).mockImplementationOnce((async (_call: unknown, validate: (d: unknown) => unknown) => {
        const d = validate({ voice: answer(n) });
        if (!d) throw new Error("not valid");
        return { data: d, model: "m" };
      }) as never);
      const line = await makeResay()(original, kind ? { kind } : undefined);
      return { line, sent: vi.mocked(completeJson).mock.calls[0][0] as unknown as { system: string; maxTokens: number } };
    }
    // A story's beat: about as long as it was, never more than 32 words, never under half of it.
    expect((await ask(26, "story")).line).toBe(answer(26));
    expect((await ask(32, "story")).line).toBe(answer(32));
    expect((await ask(33, "story")).line).toBeNull();
    expect((await ask(14, "story")).line).toBeNull();
    // An ad's line: a short sentence, as always (up to 20 words).
    expect((await ask(12)).line).toBe(answer(12));
    expect((await ask(21)).line).toBeNull();
    // What the model is told.
    const forStory = (await ask(26, "story")).sent;
    expect(forStory.system).toMatch(/keep every name/);
    expect(forStory.system).toMatch(/never more than 32 words/);
    expect(forStory.system).not.toMatch(/8 to 12 words/);
    const forAd = (await ask(12)).sent;
    expect(forAd.system).toMatch(/8 to 12 words/);
    expect(forAd.system).toMatch(/no brand names/);
    expect(forAd.maxTokens).toBe(120);
  });
});
