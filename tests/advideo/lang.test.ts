import { describe, expect, it } from "vitest";

import {
  channelAboutOf, defaultVoice, isRtl, isVideoKind, isVideoLang, kindForGoal, langAndKindOf, langFields, storyConceptOf, storyFictionAsked, storyModeOf, storyPhotosOn, videoKindOf, videoLangOf, VIDEO_KINDS, VIDEO_LANGS, voiceFor,
} from "@/lib/advideo/lang";
import { PAWAN_VOICES } from "@/lib/voice/voices";

describe("the video language and kind", () => {
  it("knows the three languages and the two kinds", () => {
    expect(VIDEO_LANGS).toEqual(["ckb", "ar", "en"]);
    expect(VIDEO_KINDS).toEqual(["ad", "story"]);
    expect(isVideoLang("en")).toBe(true);
    expect(isVideoLang("ku")).toBe(false);
    expect(isVideoLang(null)).toBe(false);
    expect(isVideoKind("story")).toBe(true);
    expect(isVideoKind("reel")).toBe(false);
  });

  it("reads anything invalid as Sorani and as an ad", () => {
    for (const bad of [undefined, null, "", "EN", "kmr", 3, {}]) {
      expect(videoLangOf(bad)).toBe("ckb");
      expect(videoKindOf(bad)).toBe("ad");
    }
    expect(videoLangOf("ar")).toBe("ar");
    expect(videoKindOf("story")).toBe("story");
  });

  it("writes Sorani and Arabic from right to left and English from left to right", () => {
    expect(isRtl("ckb")).toBe(true);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });

  it("makes stories for the pages that earn from their content and ads for the rest", () => {
    expect(kindForGoal("monetize")).toBe("story");
    expect(kindForGoal("grow")).toBe("story");
    for (const g of ["sell", "leads", "other", "", null, undefined, "nonsense"]) expect(kindForGoal(g)).toBe("ad");
  });
});

describe("the voice of a video", () => {
  it("defaults to Shilan in Sorani and to Gemini's two voices otherwise", () => {
    expect(defaultVoice("ckb")).toBe("shilan");
    expect(defaultVoice("ckb", "story")).toBe("shilan");
    expect(defaultVoice("ar")).toBe("female");
    expect(defaultVoice("en")).toBe("female");
    expect(defaultVoice("en", "story")).toBe("male");
    expect(defaultVoice("ar", "story")).toBe("male");
  });

  it("keeps a Pawan voice for Sorani and replaces anything else", () => {
    for (const v of PAWAN_VOICES) expect(voiceFor("ckb", v)).toBe(v);
    expect(voiceFor("ckb", "Charon")).toBe("shilan");
    expect(voiceFor("ckb", undefined)).toBe("shilan");
    expect(voiceFor("ckb", 7, "story")).toBe("shilan");
  });

  it("keeps only male or female for Arabic and English", () => {
    expect(voiceFor("en", "male")).toBe("male");
    expect(voiceFor("ar", "female", "story")).toBe("female");
    // A Pawan name means nothing to Gemini and no gender is guessed from it.
    expect(voiceFor("en", "shilan")).toBe("female");
    expect(voiceFor("en", "shilan", "story")).toBe("male");
    expect(voiceFor("ar", null)).toBe("female");
  });
});

describe("what a stored video says about itself", () => {
  it("reads the language and kind of a spec or of render props, and defaults for anything missing", () => {
    expect(langAndKindOf({ lang: "en", kind: "story", scenes: [] })).toEqual({ lang: "en", kind: "story" });
    expect(langAndKindOf({ lang: "ar" })).toEqual({ lang: "ar", kind: "ad" });
    expect(langAndKindOf({})).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf(null)).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf("x")).toEqual({ lang: "ckb", kind: "ad" });
    expect(langAndKindOf({ lang: "xx", kind: 4 })).toEqual({ lang: "ckb", kind: "ad" });
  });

  it("writes only the values that are not the default, so a Sorani ad stores nothing", () => {
    expect(langFields("ckb", "ad")).toEqual({});
    expect(Object.keys(langFields("ckb", "ad"))).toHaveLength(0);
    expect(langFields("en", "ad")).toEqual({ lang: "en" });
    expect(langFields("ckb", "story")).toEqual({ kind: "story" });
    expect(langFields("ar", "story")).toEqual({ lang: "ar", kind: "story" });
    // What is written is read back as the same choice.
    expect(langAndKindOf(langFields("en", "story"))).toEqual({ lang: "en", kind: "story" });
  });
});

describe("what a channel is about", () => {
  it("joins the offer line, the goal in words and the category", () => {
    expect(channelAboutOf({ offerLine: "Mystery stories", goalText: "grow a story channel", category: "content" })).toBe("Mystery stories — grow a story channel — category: content");
    expect(channelAboutOf({ offerLine: null, goalText: "  stories  ", category: null })).toBe("stories");
  });

  it("says nothing when the profile holds no concept (a category of other is none)", () => {
    expect(channelAboutOf(null)).toBeNull();
    expect(channelAboutOf(undefined)).toBeNull();
    expect(channelAboutOf({ offerLine: null, goalText: "", category: null })).toBeNull();
    expect(channelAboutOf({ offerLine: null, goalText: null, category: "other" })).toBeNull();
  });

  it("is cut to a sensible length", () => {
    expect(Array.from(channelAboutOf({ goalText: "x".repeat(900) })!)).toHaveLength(500);
  });
});

describe("the concept a daily story follows", () => {
  it("is what the owner wrote: the offer line and the goal in words, never the category", () => {
    expect(storyConceptOf({ offerLine: "Mystery stories", goalText: "grow a story channel" })).toBe("Mystery stories — grow a story channel");
    expect(storyConceptOf({ offerLine: null, goalText: "  stories  " })).toBe("stories");
    expect(storyConceptOf({ offerLine: "True crime", goalText: null, category: "content" } as never)).toBe("True crime");
  });

  it("is none for a bare category, an empty profile or no profile", () => {
    expect(storyConceptOf(null)).toBeNull();
    expect(storyConceptOf(undefined)).toBeNull();
    expect(storyConceptOf({ offerLine: "  ", goalText: "" })).toBeNull();
    expect(storyConceptOf({ offerLine: null, goalText: null, category: "content" } as never)).toBeNull();
  });

  it("is cut to a sensible length", () => {
    expect(Array.from(storyConceptOf({ goalText: "x".repeat(900) })!)).toHaveLength(500);
  });
});

describe("whether the owner asked for fiction", () => {
  it("finds the English words fiction, fictional and fictitious, in any case", () => {
    for (const t of ["a fictional lighthouse mystery", "Fiction: a haunted house", "A FICTITIOUS trial", "fiction", "historical fiction about a lighthouse"]) {
      expect(storyFictionAsked(t), t).toBe(true);
    }
  });

  it("finds imaginary, make-believe, invented and imagined stories", () => {
    for (const t of [
      "an imaginary island and its king",
      "make-believe tales of the sea",
      "an invented crime story",
      "invent a story about a locked room",
      "a tale I invent as we go",
      "tell me a story you invent",
      "a story from your imagination",
      "an imagined mystery of the desert",
    ]) {
      expect(storyFictionAsked(t), t).toBe(true);
    }
  });

  it("does not take 'fabricated' or a bare 'made up' for a wish for fiction: a real hoax uses them for something true", () => {
    for (const t of [
      "the Piltdown Man fabricated fossil hoax",
      "the Cottingley Fairies fabricated photographs",
      "fabricated letters",
      "a made up legend that people believed for centuries",
      "the made-up story of the Beale ciphers",
      "make a video about a made up story",
      "the cast was made up of ten men",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take the common ways of saying 'not fiction' for a wish for it: rather than, instead of, avoid, away from, free of, steer clear of", () => {
    for (const t of [
      "Tell a real case rather than fiction",
      "Keep it factual, instead of fiction, one real unsolved case",
      "avoid fiction please, only what happened",
      "avoid made-up details and imaginary suspects",
      "stay away from imaginary events",
      "a story free of fictional claims",
      "steer clear of fiction",
      "a real case, fiction-free",
      "fiction is not wanted, only a real one",
      "stories that are anything but fictional",
      "skip the fictional parts",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
    // A negator in an earlier clause does not reach the next one.
    expect(storyFictionAsked("no history lessons, a fictional ghost story please")).toBe(true);
    expect(storyFictionAsked("Not this one. Make it fictional.")).toBe(true);
  });

  it("does not take non-fiction, or a word that only contains the letters, for fiction", () => {
    for (const t of ["a non-fiction story about Titanic", "nonfiction: the Hinterkaifeck murders", "non fiction", "true, not fictional", "the Hinterkaifeck murders, 1922", "fictionalized"]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take a denial for a wish: not, never, no, without, isn't, non, within four words", () => {
    for (const t of [
      "this is not a work of fiction",
      "it is no fiction at all",
      "never fiction, only what happened",
      "a story without any fiction",
      "it isn't fiction",
      "the Titanic story, not made up",
      "nothing imaginary here",
      "not an invented story",
      "a non-fictional account",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
    // A denial far from the word does not undo it.
    expect(storyFictionAsked("no more boring facts please, make it a fictional story")).toBe(true);
  });

  it("does not take science fiction, or fact against fiction, for a wish for an invented story", () => {
    for (const t of [
      "science fiction that came true",
      "the science-fiction writer who predicted the moon landing",
      "separate fact from fiction in the Atlantis story",
      "fact and fiction about the Voynich manuscript",
      "fiction or fact: the Cottingley fairies",
      "facts vs fiction",
      "fiction versus facts",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take an everyday use of the words for it", () => {
    for (const t of ["the cast was made up of ten men", "the man who invented the telephone", "who invented the printing press", "the story of how the lamp was invented in 1879"]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("finds the Arabic and the Sorani words for it, as whole words, whatever the spelling of the letters", () => {
    for (const t of [
      "قصة خيالية",
      "حكاية خيالية عن منارة",
      "قصة متخيلة",
      "قصة مختلقة",
      "اريد القصة الخيالية",
      "چیرۆکی خەیاڵی",
      "چیرۆکێکی خەیاڵی دەربارەی ڕۆبۆت",
      "خیالی",
      "قصة خيالية، لا حقيقية",
    ]) {
      expect(storyFictionAsked(t), t).toBe(true);
    }
    // Arabic yeh and kaf typed as Persian ones are the same word.
    expect(storyFictionAsked("قصة خیالیة")).toBe(true);
  });

  it("does not take a word that only contains the stem for it: the cavalry, the horseman, the noun imagination, science fiction", () => {
    for (const t of ["قصة عن فرسان الخيالة في معركة", "قصة عن خيّال عربي", "قصة خيال علمي عن المريخ", "قصة بدون خيال", "حكاية بلا خيال عن بابل", "چیرۆکێکی بێ خەیاڵ"]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take 'not fictional' in Arabic and Sorani for a wish for fiction (the owner's own language, his own words)", () => {
    for (const t of [
      "قصة حقيقية لا خيالية",
      "چیرۆکێکی ڕاستەقینە، نە خەیاڵی",
      "چیرۆکی ڕاستەقینە و خەیاڵی نییە",
      "چیرۆکی ڕاستەقینە و خەیاڵی نیە",
      "بعيداً عن الخيال، قضية حقيقية موثقة",
      "قضية حقيقية بعيدة عن الأحداث الخيالية",
      "دووربکەوە لە خەیاڵ و تەنها کەیسێکی ڕاستەقینە بگێڕەوە",
      "دوور لە چیرۆکی خەیاڵی، تەنها ڕووداوی ڕاستەقینە",
      "قصة حقيقية ماهي خيالية",
      "قصة غير مختلقة",
      "چیرۆکێک کە خەیاڵی نەبێت",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take the Arabic or Sorani words for non-fiction for fiction", () => {
    for (const t of [
      "قصة غير خيالية عن التايتانيك",
      "چیرۆکی ناخەیاڵی",
      "چیرۆکی نا خەیاڵی",
      "قصة حقيقية عن مأساة هنتركايفك",
      "قصة ليست خيالية",
      "قصة بدون خيال",
      "حكاية بلا خيال عن بابل",
      "چیرۆکی ڕاستەقینە نەک خەیاڵی",
      "چیرۆکێکی بێ خەیاڵ",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
  });

  it("does not take the natural Arabic ways of saying 'a real story, not an invented one' for a wish for fiction (round-3 review)", () => {
    for (const t of [
      "قصة حقيقية وليست خيالية",
      "ليس فيها خيال ولا خيالية",
      "قصة مو خيالية",
      "قصة مش خيالية",
      "لم تكن خيالية، بل حدثت فعلا",
      "قصة حقيقية ولست أريدها خيالية",
      "حكاية حقيقية، لا مختلقة ولا متخيلة",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
    // The affirmative forms next to them still count.
    for (const t of ["أريد قصة خيالية", "قصة مو حقيقية، خيالية", "قصة مختلقة تماما"]) expect(storyFictionAsked(t), t).toBe(true);
  });

  it("does not take the natural Sorani ways of saying 'not fiction, do not make it fictional' for a wish for fiction (round-3 review)", () => {
    for (const t of [
      "ناتەوێت خەیاڵی بێت",
      "نامەوێت خەیاڵی بێت، ڕووداوێکی ڕاستەقینە",
      "خەیاڵی مەکە",
      "چیرۆکەکە خەیاڵی مەبە",
      "ئەم چیرۆکانە خەیاڵی نین",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
    // A plain wish still counts.
    expect(storyFictionAsked("چیرۆکێکی خەیاڵی دروست بکە")).toBe(true);
  });

  it("counts the English marker only when it describes the story itself, not a character or a work the real case inspired", () => {
    for (const t of [
      "the real case that inspired the fictional detective Sherlock Holmes",
      "the real murder behind a fiction novel",
      "the true story that inspired the fictional character Dracula",
      "a real case, the basis of a fictional film",
      "the historical crime behind a famous fictional detective",
    ]) {
      expect(storyFictionAsked(t), t).toBe(false);
    }
    // The story itself being fictional still counts, with a real case cue elsewhere in the sentence.
    for (const t of ["a fictional story about a real kind of lighthouse", "a fiction story, not history", "make a fictional character who solves a crime"]) {
      expect(storyFictionAsked(t), t).toBe(true);
    }
  });

  it("is false for nothing", () => {
    for (const t of [null, undefined, "", "   "]) expect(storyFictionAsked(t)).toBe(false);
  });
});

describe("how a story is told", () => {
  it("is classic for every ad, whatever the idea says", () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      expect(storyModeOf("ad", lang, "a fictional shop")).toBe("classic");
      expect(storyModeOf("ad", lang, null)).toBe("classic");
    }
  });

  it("is real for EVERY story that does not ask for fiction, in Sorani, Arabic and English (an empty request included)", () => {
    expect(storyModeOf("story", "en", "the Hinterkaifeck murders, 1922")).toBe("real");
    expect(storyModeOf("story", "en", null)).toBe("real");
    expect(storyModeOf("story", "en", "")).toBe("real");
    expect(storyModeOf("story", "ar", "قصة حقيقية عن التايتانيك")).toBe("real");
    expect(storyModeOf("story", "en", "a non-fiction story about Titanic")).toBe("real");
    // The owner's own language and his failing case: a Sorani story is documented too.
    expect(storyModeOf("story", "ckb", null)).toBe("real");
    expect(storyModeOf("story", "ckb", "the Hinterkaifeck murders")).toBe("real");
    expect(storyModeOf("story", "ckb", "کوشتارەکانی هینتەرکایفێک")).toBe("real");
    expect(storyModeOf("story", "ckb", "چیرۆکێکی مێژوویی نهێنی، لە جۆری تاوان")).toBe("real");
    expect(storyModeOf("story", "ckb", "چیرۆکی ناخەیاڵی")).toBe("real");
  });

  it("is fiction for a story that asks for it, in any language", () => {
    expect(storyModeOf("story", "en", "a Fictional lighthouse mystery")).toBe("fiction");
    expect(storyModeOf("story", "ar", "قصة خيالية")).toBe("fiction");
    expect(storyModeOf("story", "ckb", "چیرۆکی خەیاڵی")).toBe("fiction");
  });

  it("is decided once from the owner's own words: the stub's flag decides first, and the topic only when the stub has none", () => {
    // The owner asked for fiction when he made the video: fiction, whatever the topic that reached the writer says.
    expect(storyModeOf("story", "en", "the Hinterkaifeck murders", { fiction: true })).toBe("fiction");
    expect(storyModeOf("story", "ckb", "هینتەرکایفێک", { fiction: true })).toBe("fiction");
    // A rewritten (reviewed) topic that happens to say fictional does not turn a real story into an invented one, when the stub says so.
    expect(storyModeOf("story", "en", "a fictional style ghost story, but only real cases", { fiction: false })).toBe("real");
    // A stub with no flag (a video queued before the flag existed), no stub at all: the topic is read, as it always was.
    expect(storyModeOf("story", "en", "a fictional lighthouse mystery", {})).toBe("fiction");
    expect(storyModeOf("story", "en", "a fictional lighthouse mystery", null)).toBe("fiction");
    expect(storyModeOf("story", "en", "a fictional lighthouse mystery", undefined)).toBe("fiction");
    expect(storyModeOf("story", "en", "the Hinterkaifeck murders", {})).toBe("real");
    // A flag that is not literally true is no flag.
    expect(storyModeOf("story", "en", "the Hinterkaifeck murders", { fiction: "yes" })).toBe("real");
    // An ad is classic whatever the stub says.
    expect(storyModeOf("ad", "en", "a fictional shop", { fiction: true })).toBe("classic");
  });

  it("looks for photographs in a real story unless the owner switched them off", () => {
    expect(storyPhotosOn("real", undefined)).toBe(true);
    expect(storyPhotosOn("real", null)).toBe(true);
    expect(storyPhotosOn("real", {})).toBe(true);
    expect(storyPhotosOn("real", { noPhotos: true })).toBe(false);
    expect(storyPhotosOn("fiction", {})).toBe(false);
    expect(storyPhotosOn("classic", {})).toBe(false);
  });

  it("does not change what is written into a stored spec", () => {
    expect(langFields("en", "story")).toEqual({ lang: "en", kind: "story" });
    expect(langFields("ckb", "ad")).toEqual({});
  });
});
