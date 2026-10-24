import { describe, expect, it } from "vitest";

import { CREDIT_LINE_MAX, SCREEN_LINE_CHARS, authorDrawable, authorFits, creditAuthor, creditLine, creditRoom, creditScreen, creditsOf, fictionLine, fitCredits, storyCaption, type PhotoCredit } from "@/lib/advideo/credits";

const credit = (over: Partial<PhotoCredit> = {}): PhotoCredit => ({
  scene: 0,
  title: "File:Farm.jpg",
  author: "Jane Doe",
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  page: "https://commons.wikimedia.org/wiki/File:Farm.jpg",
  attribution: true,
  ...over,
});
const publicDomain = (over: Partial<PhotoCredit> = {}) => credit({ author: "Unknown", licence: "Public domain", licenceUrl: null, attribution: false, ...over });
const chars = (s: string) => Array.from(s).length;

describe("reading credits back from a stored spec", () => {
  it("accepts an array, or an object that holds one", () => {
    const c = credit();
    expect(creditsOf([c])).toEqual([c]);
    expect(creditsOf({ credits: [c], other: 1 })).toEqual([c]);
  });

  it("keeps only complete entries and coerces the rest", () => {
    const list = [
      credit({ scene: 1 }),
      { scene: "2", title: "File:A.jpg", page: "https://x", licence: "CC0" },
      { scene: 3, title: "", page: "https://x", licence: "CC0" },
      { scene: 4, title: "File:B.jpg", page: "", licence: "CC0" },
      { scene: 5, title: "File:C.jpg", page: "https://x" },
      { scene: -1, title: "File:D.jpg", page: "https://x", licence: "CC0" },
      { scene: 6, title: "File:E.jpg", page: "https://x/e", licence: "CC0", author: "  ", licenceUrl: "javascript:alert(1)", attribution: "yes" },
      null,
      "text",
      7,
    ];
    const out = creditsOf(list);
    expect(out.map((c) => c.scene)).toEqual([1, 6]);
    expect(out[1]).toEqual({ scene: 6, title: "File:E.jpg", author: null, licence: "CC0", licenceUrl: null, page: "https://x/e", attribution: false });
  });

  it("keeps the illustrative mark, and cleans hidden characters out of the text", () => {
    const rlo = String.fromCodePoint(0x202e);
    const out = creditsOf([credit({ illustrative: true, scene: 1 }), { ...credit({ scene: 2 }), author: `Jane${rlo} Doe`, title: `File:A${rlo}.jpg` }, credit({ scene: 3, illustrative: false })]);
    expect(out[0].illustrative).toBe(true);
    expect(out[1]).not.toHaveProperty("illustrative");
    expect(out[2]).not.toHaveProperty("illustrative");
    expect([out[1].author, out[1].title]).toEqual(["Jane Doe", "File:A.jpg"]);
  });

  it("never throws, whatever it is given", () => {
    for (const bad of [undefined, null, 0, "x", {}, { credits: "no" }, [[]], [undefined]]) expect(creditsOf(bad)).toEqual([]);
  });
});

describe("the photo-credit line of the caption", () => {
  it("is empty when there are no credits", () => {
    expect(creditLine("en", [])).toBe("");
  });

  it("names where the photographs come from in each language", () => {
    expect(creditLine("en", [publicDomain()])).toBe("Photos: Wikimedia Commons");
    expect(creditLine("ar", [publicDomain()])).toBe("الصور: ويكيميديا كومنز");
    expect(creditLine("ckb", [publicDomain()])).toBe("وێنەکان: ویکیمیدیا کۆمۆنز");
  });

  it("names only the authors a licence asks for, with the licence, and none for public domain", () => {
    const line = creditLine("en", [credit({ author: "Jane Doe" }), publicDomain({ author: "Old Archive" }), credit({ author: "Hans Meier", licence: "CC BY 2.0" })]);
    expect(line).toBe("Photos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0; Hans Meier, CC BY 2.0)");
    expect(line).not.toContain("Old Archive");
  });

  it("lists an author once, whatever the case, and keeps every licence they used", () => {
    const line = creditLine("en", [credit({ author: "Jane Doe" }), credit({ author: "jane doe", scene: 2 }), credit({ author: "JANE DOE", licence: "CC BY 2.0", scene: 3 })]);
    expect(line).toBe("Photos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0 / CC BY 2.0)");
  });

  it("writes an author's name whole up to 60 characters and writes no link, no hashtag sign and no line break", () => {
    const long = creditLine("en", [credit({ author: "A".repeat(100) })]);
    expect(long).toContain(`(${"A".repeat(60)}, CC BY-SA 4.0)`);
    const fits = creditLine("en", [credit({ author: "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de" })]);
    expect(fits).toContain("(Bayerische Vermessungsverwaltung, CC BY-SA 4.0)"); // the web address is dropped, the name stays, no dash is left behind
    const messy = creditLine("en", [credit({ author: "Jane\nDoe https://flickr.com/jane #photo www.jane.example" })]);
    expect(messy).toBe("Photos: Wikimedia Commons (Jane Doe photo, CC BY-SA 4.0)");
    expect(messy).not.toMatch(/https?:|www\.|#|\n/);
  });

  it("counts characters, not bytes, when it cuts an author", () => {
    const line = creditLine("en", [credit({ author: "é".repeat(80) })]);
    expect(line).toContain(`(${"é".repeat(60)},`);
  });

  it("keeps format and control characters out of an author's name", () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    const bell = String.fromCodePoint(7);
    expect(creditLine("en", [credit({ author: `Jane${rlo} Doe${zwsp}${bell}` })])).toBe("Photos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0)");
  });

  it("never says 'and others' and never cuts a name: it names every author, however many there are", () => {
    const many = Array.from({ length: 12 }, (_, i) => credit({ author: `Photographer Number ${String.fromCharCode(65 + i)}`, scene: i }));
    const line = creditLine("en", many);
    expect(line).not.toMatch(/more|others|…/);
    for (let i = 0; i < 12; i++) expect(line).toContain(`Photographer Number ${String.fromCharCode(65 + i)}, CC BY-SA 4.0`);
    expect(chars(line)).toBeGreaterThan(CREDIT_LINE_MAX);
  });

  it("does not list a credit that asks for a name but has none (such a photograph is dropped by fitCredits)", () => {
    expect(creditLine("en", [credit({ author: null })])).toBe("Photos: Wikimedia Commons");
    expect(fitCredits("en", [credit({ author: null }), credit({ author: "  " })])).toEqual([]);
  });

  it("says in each language when some photographs only illustrate (they came from a search, not from the case's own pictures)", () => {
    expect(creditLine("en", [publicDomain({ illustrative: true })])).toBe("Photos: Wikimedia Commons, illustrative images");
    expect(creditLine("ar", [publicDomain({ illustrative: true })])).toBe("الصور: ويكيميديا كومنز، صور توضيحية");
    expect(creditLine("ckb", [publicDomain({ illustrative: true })])).toBe("وێنەکان: ویکیمیدیا کۆمۆنز، وێنەی ڕوونکەرەوە");
    expect(creditLine("en", [credit({ illustrative: true }), publicDomain()])).toBe("Photos: Wikimedia Commons, illustrative images (Jane Doe, CC BY-SA 4.0)");
    // none of them illustrative: no qualifier
    expect(creditLine("en", [credit(), publicDomain({ illustrative: false })])).not.toContain("illustrative");
  });
});

describe("choosing the photographs the caption can name", () => {
  const named = (n: number, over: Partial<PhotoCredit> = {}) => credit({ author: `Photographer Number ${String.fromCharCode(65 + n)}`, scene: n, ...over });

  it("keeps every photograph when the line fits the room", () => {
    const list = [named(0), named(1), publicDomain({ scene: 2 })];
    expect(fitCredits("en", list, 240)).toEqual(list);
  });

  it("keeps all public domain and CC0 photographs first (they need no name) and then the ones that need a name, in order, while the line fits", () => {
    const many = Array.from({ length: 12 }, (_, i) => named(i));
    const free = [publicDomain({ scene: 20 }), publicDomain({ scene: 21, licence: "CC0" })];
    const kept = fitCredits("en", [...many, ...free], 120);
    expect(chars(creditLine("en", kept))).toBeLessThanOrEqual(120);
    // both free ones stay, and so do the first named ones that fit; none is skipped to fit a later, shorter one
    for (const f of free) expect(kept).toContain(f);
    const keptNamed = kept.filter((c) => c.attribution);
    expect(keptNamed.length).toBeGreaterThan(0);
    expect(keptNamed.length).toBeLessThan(12);
    expect(keptNamed).toEqual(many.slice(0, keptNamed.length));
    // the answer keeps the order of the input
    expect(kept).toEqual([...many.slice(0, keptNamed.length), ...free]);
  });

  it("names every author it keeps: whatever the room, a kept photograph is always named in the line", () => {
    const many = Array.from({ length: 12 }, (_, i) => named(i, { licence: i % 2 ? "CC BY 2.0" : "CC BY-SA 4.0" }));
    for (const room of [60, 90, 120, 160, 240, 400, 700]) {
      const kept = fitCredits("en", many, room);
      const line = creditLine("en", kept);
      for (const c of kept) expect(line, `room ${room}`).toContain(c.author!);
      expect(chars(line), `room ${room}`).toBeLessThanOrEqual(Math.max(room, 0));
    }
    // with a room for nothing, no named photograph stays (a public domain one does)
    expect(fitCredits("en", [named(0)], 20)).toEqual([]);
    const pd = publicDomain();
    expect(fitCredits("en", [named(0), pd], 20)).toEqual([pd]);
  });

  it("a photograph by an author who is already named costs nothing, even if it comes late", () => {
    const first = named(0, { author: "Jane Doe" });
    const far = named(1, { author: "A Photographer With A Rather Long Name Indeed Yes", scene: 1 });
    const again = named(2, { author: "jane doe", scene: 2 });
    const room = chars(creditLine("en", [first])) + 2;
    const kept = fitCredits("en", [first, far, again], room);
    expect(kept).toEqual([first, again]);
  });

  it("a second licence of the same author costs its words", () => {
    const a = named(0, { author: "Jane Doe" });
    const b = named(1, { author: "Jane Doe", licence: "CC BY 2.0" });
    const tight = chars(creditLine("en", [a]));
    expect(fitCredits("en", [a, b], tight)).toEqual([a]);
    expect(fitCredits("en", [a, b], tight + 20)).toEqual([a, b]);
  });

  it("counts the words of the 'illustrative images' note in the room", () => {
    const plain = named(0, { author: "Jane Doe" });
    const room = chars(creditLine("en", [plain]));
    expect(fitCredits("en", [{ ...plain, illustrative: true }], room)).toEqual([]);
    expect(fitCredits("en", [{ ...plain, illustrative: true }], room + 30)).toHaveLength(1);
  });

  it("never throws on an empty list", () => {
    expect(fitCredits("ckb", [], 120)).toEqual([]);
  });
});

describe("the room a caption has for its credit line", () => {
  it("is what is left of 700 after the text, the hashtags and the blank lines between them", () => {
    const caption = `${"a".repeat(300)}\n#one #two`;
    // 700 - 300 (text) - 9 ("#one #two") - 2 - 2 (blank lines)
    expect(creditRoom(caption)).toBe(700 - 300 - 9 - 4);
    expect(creditRoom("Just a teaser.")).toBe(700 - 14 - 2);
    expect(creditRoom("")).toBe(700);
  });

  it("is at least 120, however long the text is (the text is cut to make the room)", () => {
    expect(creditRoom("x".repeat(690))).toBe(120);
    expect(creditRoom("x".repeat(2000))).toBe(120);
  });

  it("counts characters, not bytes, and takes another line off the room (the fiction line)", () => {
    expect(creditRoom("قصة ".repeat(100).trim())).toBe(700 - (400 - 1) - 2);
    expect(creditRoom("Teaser", 700, 40)).toBe(700 - 6 - 2 - 40);
  });

  it("makes a caption that is exactly 700 or less, with the credit line whole, for the longest line fitCredits lets through", () => {
    const body = "Word ".repeat(100).trim();
    const caption = `${body}\n#alpha #beta`;
    const many = Array.from({ length: 12 }, (_, i) => credit({ author: `Photographer Number ${String.fromCharCode(65 + i)}`, scene: i }));
    const kept = fitCredits("en", many, creditRoom(caption));
    const out = storyCaption({ caption, lang: "en", credits: kept });
    expect(chars(out)).toBeLessThanOrEqual(700);
    expect(out).toContain(creditLine("en", kept));
    expect(out).toContain(body); // the text was not cut: there was room for it and for every name
    expect(out.endsWith("#alpha #beta")).toBe(true);
  });
});

describe("the line that says a story is invented", () => {
  it("is fixed text in each language", () => {
    expect(fictionLine("en")).toBe("Fiction: this is an invented story.");
    expect(fictionLine("ar")).toBe("قصة خيالية: هذه حكاية مؤلَّفة من الخيال.");
    expect(fictionLine("ckb")).toBe("چیرۆکی خەیاڵی: ئەمە چیرۆکێکی دروستکراوە.");
  });
});

describe("the caption of a story with its added lines", () => {
  const caption = "The farm where six people vanished in one night.\n#hinterkaifeck #truecrime #unsolved";

  it("is unchanged when there is nothing to add", () => {
    expect(storyCaption({ caption, lang: "en" })).toBe(caption);
    expect(storyCaption({ caption, lang: "en", credits: [] })).toBe(caption);
    expect(storyCaption({ caption: "x".repeat(900), lang: "en" })).toBe("x".repeat(900));
  });

  it("puts the credits between the teaser and the hashtags", () => {
    const out = storyCaption({ caption, lang: "en", credits: [credit()] });
    expect(out).toBe("The farm where six people vanished in one night.\n\nPhotos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0)\n\n#hinterkaifeck #truecrime #unsolved");
  });

  it("adds the fiction line first, then the credits", () => {
    const out = storyCaption({ caption, lang: "en", fiction: true });
    expect(out).toBe("The farm where six people vanished in one night.\n\nFiction: this is an invented story.\n\n#hinterkaifeck #truecrime #unsolved");
    const both = storyCaption({ caption, lang: "en", fiction: true, credits: [publicDomain()] });
    expect(both).toContain("Fiction: this is an invented story.\nPhotos: Wikimedia Commons\n\n#hinterkaifeck");
  });

  it("works for a caption with no hashtags and for an empty one", () => {
    expect(storyCaption({ caption: "Just a teaser.", lang: "en", fiction: true })).toBe("Just a teaser.\n\nFiction: this is an invented story.");
    expect(storyCaption({ caption: "", lang: "en", fiction: true })).toBe("Fiction: this is an invented story.");
  });

  it("is at most 700 characters: the text is cut at a word and ends in an ellipsis, the hashtags stay whole", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = storyCaption({ caption: `${words}\n#alpha #beta #gamma`, lang: "en", credits: [credit(), credit({ author: "Hans Meier", licence: "CC BY 2.0" })] });
    expect(chars(out)).toBeLessThanOrEqual(700);
    expect(out).toMatch(/word\d+…\n\nPhotos: Wikimedia Commons \(Jane Doe, CC BY-SA 4\.0; Hans Meier, CC BY 2\.0\)\n\n#alpha #beta #gamma$/);
    // Cut at a word: the last word before the ellipsis is a whole one.
    const last = out.match(/(word\d+)…/)![1];
    expect(words.split(" ")).toContain(last);
  });

  it("counts characters, not bytes, for the limit", () => {
    const out = storyCaption({ caption: `${"قصة ".repeat(300)}\n#قصة`, lang: "ar", fiction: true });
    expect(chars(out)).toBeLessThanOrEqual(700);
    expect(out.endsWith("\n\n#قصة")).toBe(true);
    expect(out).toContain("قصة خيالية: هذه حكاية مؤلَّفة من الخيال.");
  });

  it("drops whole hashtags from the end only when the added lines and the hashtags alone are too long", () => {
    const tags = Array.from({ length: 10 }, (_, i) => `#tag${i}`).join(" ");
    const out = storyCaption({ caption: `Teaser\n${tags}`, lang: "en", credits: [credit()], max: 90 });
    expect(chars(out)).toBeLessThanOrEqual(90);
    const kept = out.split("\n\n").at(-1)!;
    // Whole hashtags, in order, from the start of the run: nothing cut in half.
    expect(kept.split(" ").every((t, i) => t === `#tag${i}`)).toBe(true);
    expect(kept.split(" ").length).toBeLessThan(10);
    // With room for everything, no hashtag goes.
    expect(storyCaption({ caption: `Teaser\n${tags}`, lang: "en", credits: [credit()] })).toContain(tags);
  });

  it("never cuts the credit line, not even when the limit is smaller than it", () => {
    const line = creditLine("en", [credit()]);
    const out = storyCaption({ caption: "Teaser words here.\n#a #b", lang: "en", credits: [credit()], max: 30 });
    expect(out).toBe(line);
  });

  it("only treats the trailing run of #tokens as hashtags", () => {
    const out = storyCaption({ caption: "Issue #5 of the case #closed now\n#real #story", lang: "en", fiction: true });
    expect(out).toBe("Issue #5 of the case #closed now\n\nFiction: this is an invented story.\n\n#real #story");
  });
});

describe("an author that may not be printed (authorFits)", () => {
  it("accepts a name, a group, an archive's own number and a user name", () => {
    for (const a of ["Jane Doe", "Andreas Biegleder", "Bundesarchiv, Bild 183-S12345-0001", "Bundesarchiv, Bild 102-12345", "J. R. Smith", "User:Foo (talk)", "Müller & Söhne", "Mohammed al-Rashid"]) {
      expect(authorFits(a), a).toBe(true);
    }
  });

  it("refuses an e-mail address or a handle, a telephone number in any form, and more than six words", () => {
    for (const a of [
      "Free gift call +964 750 123 4567 now",
      "Joe +964 750 123 4567 joe@example.com call me",
      "joe@example.com",
      "@joe_photos",
      "Call 07501234567",
      "Call 0750 123 4567",
      "Call (0750) 123-4567 today",
      "Call 750-123-4567",
      "+1 555",
      "One two three four five six seven",
      "",
      "   ",
    ]) {
      expect(authorFits(a), a).toBe(false);
    }
    expect(authorFits(null)).toBe(false);
    expect(authorFits(undefined)).toBe(false);
  });

  it("keeps a photograph with such an author out of the caption, the video and every credit line", () => {
    const bad = credit({ author: "Free gift call +964 750 123 4567 now" });
    expect(creditLine("en", [bad])).toBe("Photos: Wikimedia Commons");
    expect(fitCredits("en", [bad])).toEqual([]);
    expect(fitCredits("en", [bad], 240, "wide")).toEqual([]);
    // a photograph that needs no name does not care who the author is
    expect(fitCredits("en", [publicDomain({ author: "call +964 750 123 4567" })])).toHaveLength(1);
    // and the post never carries the number
    expect(storyCaption({ caption: "Text. #a", lang: "en", credits: fitCredits("en", [bad, credit({ scene: 1, author: "Jane Doe" })]) })).not.toContain("964");
  });
});

describe("the Sorani label is written in Sorani letters", () => {
  it("has no Latin letter in it, in the caption line or on the screen", () => {
    expect(creditLine("ckb", [publicDomain()])).toBe("وێنەکان: ویکیمیدیا کۆمۆنز");
    expect(creditScreen("ckb", [publicDomain()]).lines[0]).toBe("وێنەکان: ویکیمیدیا کۆمۆنز");
    expect(creditLine("ckb", [publicDomain({ illustrative: true })])).not.toMatch(/[A-Za-z]/);
    expect(creditLine("ar", [publicDomain()])).not.toMatch(/[A-Za-z]/);
  });
});

describe("the credit lines the video itself shows on its closing scene (creditScreen)", () => {
  const by = (author: string, over: Partial<PhotoCredit> = {}) => credit({ author, ...over });

  it("is empty and complete when there are no credits", () => {
    expect(creditScreen("en", [])).toEqual({ lines: [], complete: true });
  });

  it("is the label alone for public-domain photographs, in each language", () => {
    expect(creditScreen("en", [publicDomain()])).toEqual({ lines: ["Photos: Wikimedia Commons"], complete: true });
    expect(creditScreen("ar", [publicDomain()]).lines).toEqual(["الصور: ويكيميديا كومنز"]);
    expect(creditScreen("ckb", [publicDomain()]).lines).toEqual(["وێنەکان: ویکیمیدیا کۆمۆنز"]);
  });

  it("names every author the licences ask for, with the licence, one author once", () => {
    const s = creditScreen("en", [by("Jane Doe"), by("Jane Doe", { licence: "CC BY 2.0", scene: 1 }), by("Andreas Biegleder", { scene: 2 }), publicDomain({ scene: 3 })], "wide");
    expect(s.complete).toBe(true);
    expect(s.lines[0]).toBe("Photos: Wikimedia Commons");
    const body = s.lines.slice(1).join(" ");
    expect(body).toContain("Jane Doe, CC BY-SA 4.0 / CC BY 2.0");
    expect(body).toContain("Andreas Biegleder, CC BY-SA 4.0");
    expect(body.match(/Jane Doe/g)).toHaveLength(1);
  });

  it("says 'illustrative images' on the first line when some photograph only shows the kind of thing", () => {
    expect(creditScreen("en", [by("Jane Doe", { illustrative: true })]).lines[0]).toBe("Photos: Wikimedia Commons, illustrative images");
    expect(creditScreen("ar", [by("Jane Doe", { illustrative: true })]).lines[0]).toBe("الصور: ويكيميديا كومنز، صور توضيحية");
  });

  it("never has more than three lines, and no line longer than its format holds (a vertical frame holds fewer characters than a wide one)", () => {
    const many = Array.from({ length: 6 }, (_, i) => by(`Photographer Number${i}`, { scene: i }));
    for (const format of ["vertical", "wide"] as const) {
      for (const n of [1, 2, 4, 6]) {
        const s = creditScreen("en", many.slice(0, n), format);
        expect(s.lines.length).toBeLessThanOrEqual(3);
        for (const line of s.lines) expect(chars(line)).toBeLessThanOrEqual(SCREEN_LINE_CHARS[format] * 1.3);
      }
    }
    // four authors do not fit a vertical frame's two author lines; they do fit a wide one's; six fit neither
    expect(creditScreen("en", many.slice(0, 2), "vertical").complete).toBe(true);
    expect(creditScreen("en", many.slice(0, 4), "vertical").complete).toBe(false);
    expect(creditScreen("en", many.slice(0, 4), "wide").complete).toBe(true);
    expect(creditScreen("en", many.slice(0, 4), "wide").lines).toHaveLength(3);
    expect(creditScreen("en", many, "wide").complete).toBe(false);
  });

  it("wraps an author whose name is longer than a line, and says it is not complete when a single word is far too long", () => {
    const long = by("Alexandra Montgomery-Fitzgerald Royal Photographic Society");
    const s = creditScreen("en", [long], "vertical");
    expect(s.lines.length).toBeGreaterThanOrEqual(3);
    expect(s.complete).toBe(true);
    expect(s.lines.slice(1).join(" ")).toContain("Royal Photographic Society, CC BY-SA 4.0");
    expect(creditScreen("en", [by("A".repeat(80))], "vertical").complete).toBe(false);
  });

  it("is a vertical frame's lines unless the wide format is asked for", () => {
    const two = [by("Photographer Number One"), by("Photographer Number Two", { scene: 1 })];
    expect(creditScreen("en", two)).toEqual(creditScreen("en", two, "vertical"));
    // a wide frame holds both on one line, a vertical one needs two
    expect(creditScreen("en", two, "wide").lines).toHaveLength(2);
    expect(creditScreen("en", two, "vertical").lines).toHaveLength(3);
  });
});

describe("fitCredits with the video's own credit lines", () => {
  const by = (author: string, scene: number) => credit({ author, scene });

  it("keeps a photograph only when its author fits the closing scene too", () => {
    const six = Array.from({ length: 4 }, (_, i) => by(`Photographer Number${i}`, i));
    const vertical = fitCredits("en", six, 700, "vertical");
    const wide = fitCredits("en", six, 700, "wide");
    expect(vertical.length).toBeGreaterThan(0);
    expect(vertical.length).toBeLessThan(six.length);
    expect(wide).toHaveLength(4);
    // every photograph that is kept is named on the screen
    const shown = creditScreen("en", vertical, "vertical");
    expect(shown.complete).toBe(true);
    for (const c of vertical) expect(shown.lines.join(" ")).toContain(c.author!);
    // without a format the room of the caption alone decides (as it always did)
    expect(fitCredits("en", six, 700)).toHaveLength(4);
  });

  it("keeps every public-domain photograph whatever the format", () => {
    const free = [publicDomain({ scene: 0 }), publicDomain({ scene: 1 }), by("Photographer Number One", 2)];
    expect(fitCredits("en", free, 240, "vertical")).toHaveLength(3);
  });
});

// ---- builder P: the authors on the closing scene (round 3) -----------------------------------------------------------------------------------

describe("creditAuthor: the author of a credit as it may be stored and printed", () => {
  it("cleans a name and drops what may not be printed (an address, a telephone number, a bare web address, a sentence)", () => {
    expect(creditAuthor("Jane Doe")).toBe("Jane Doe");
    expect(creditAuthor("Name – www.example.org")).toBe("Name");
    expect(creditAuthor("Jane #Doe")).toBe("Jane Doe");
    for (const bad of ["john.doe@example.com", "Call +49 170 1234567", "https://evil.example/x", "www.evil.example", "one two three four five six seven", "", "   ", null, undefined]) {
      expect(creditAuthor(bad), String(bad)).toBeNull();
    }
  });

  it("is what a stored credit is read back through: creditsOf cleans every credit's author, a public domain one too", () => {
    const base = { title: "File:A.jpg", page: "https://commons.wikimedia.org/wiki/File:A.jpg", licence: "Public domain", attribution: false };
    const out = creditsOf([
      { ...base, scene: 0, author: "john.doe@example.com" },
      { ...base, scene: 1, author: "Call +49 170 1234567" },
      { ...base, scene: 2, author: "https://evil.example/x" },
      { ...base, scene: 3, author: "Name – www.example.org" },
      { ...base, scene: 4, author: "Andreas Biegleder" },
    ]);
    expect(out.map((c) => c.author)).toEqual([null, null, null, "Name", "Andreas Biegleder"]);
  });
});

describe("authorDrawable: the letters the closing card has fonts for", () => {
  it("accepts Latin, Cyrillic, Greek and Arabic script, with digits, spaces and punctuation", () => {
    for (const name of ["Jane Doe", "Fritz Müller-Lüdenscheid", "Łukasz Żółć", "Nguyễn Văn Ánh", "Иван Петров", "Γιώργος Παπαδόπουλος", "أحمد الراشد", "ئاسۆ کەریم", "علی رضایی", "Ahmad Al-Rashid أحمد", "Bundesarchiv, Bild 183-S12345-0001", "J. R. Smith (1922)"]) {
      expect(authorDrawable(name), name).toBe(true);
    }
  });

  it("refuses the scripts the card has no font for, and emoji", () => {
    for (const name of ["山田太郎", "田中 一郎", "김민수", "ישראל כהן", "สมชาย", "राम कुमार", "Photo 📷 Man", "Jane 山田"]) expect(authorDrawable(name), name).toBe(false);
    expect(authorDrawable(null)).toBe(false);
    expect(authorDrawable(undefined)).toBe(false);
  });
});

describe("a photograph whose author the card cannot draw is not shown (fitCredits, creditLine, creditScreen)", () => {
  const cjk = credit({ author: "山田太郎", scene: 0 });
  const latin = credit({ author: "Jane Doe", scene: 1 });
  const arabic = credit({ author: "أحمد الراشد", scene: 2 });

  it("drops it from the photographs that are kept, and keeps the others", () => {
    expect(fitCredits("en", [cjk, latin, arabic])).toEqual([latin, arabic]);
    expect(fitCredits("en", [cjk, latin, arabic], 700, "wide")).toEqual([latin, arabic]);
  });

  it("keeps a public domain photograph whatever its author's letters (nobody is named for it)", () => {
    const pdCjk = publicDomain({ author: "山田太郎", scene: 3 });
    expect(fitCredits("en", [pdCjk])).toEqual([pdCjk]);
    expect(creditScreen("en", [pdCjk]).lines).toEqual(["Photos: Wikimedia Commons"]);
  });

  it("never prints it: the caption and the screen name only the authors that can be drawn", () => {
    expect(creditLine("en", [cjk, latin])).toBe("Photos: Wikimedia Commons (Jane Doe, CC BY-SA 4.0)");
    expect(creditLine("en", [cjk, latin])).not.toContain("山");
    expect(creditScreen("en", [cjk, latin]).lines.join(" ")).not.toContain("山");
  });
});

describe("an entry that is longer than a line (creditScreen)", () => {
  const by = (author: string, over: Partial<PhotoCredit> = {}) => credit({ author, ...over });

  it("gets lines of its own and is never run on from the entry before it", () => {
    const s = creditScreen("en", [by("Jane Doe"), by("Alexandra Montgomery-Fitzgerald Royal Photographic Society", { scene: 1 })], "vertical");
    expect(s.lines[1]).toBe("Jane Doe, CC BY-SA 4.0");
    expect(s.lines[2]).toMatch(/^Alexandra Montgomery-Fitzgerald Royal/);
    expect(s.lines.slice(1).filter((l) => l.includes("Jane Doe") && l.includes("Alexandra"))).toEqual([]);
    // two long entries: each one keeps to its own lines
    const two = creditScreen("en", [by("Alexandra Montgomery-Fitzgerald Royal Society One"), by("Bartholomew Featherstonehaugh Photographic Two", { scene: 1 })], "vertical");
    for (const line of two.lines) expect(line.includes("Alexandra") && line.includes("Bartholomew"), line).toBe(false);
  });

  it("never splits a licence across two lines", () => {
    const s = creditScreen("en", [by("Alexandra Montgomery-Fitzgerald Roy")], "vertical");
    expect(s.lines.slice(1)).toEqual(["Alexandra Montgomery-Fitzgerald Roy,", "CC BY-SA 4.0"]);
    // and with several licences of one author, each licence stays whole
    const many = creditScreen("en", [by("Alexandra Montgomery-Fitzgerald Roy"), by("Alexandra Montgomery-Fitzgerald Roy", { licence: "CC BY 2.0", scene: 1 })], "vertical");
    for (const line of many.lines.slice(1)) {
      for (const part of ["CC", "BY-SA", "4.0", "BY", "2.0"]) expect(line.trim() === part, `${line}`).toBe(false);
    }
    expect(many.lines.join("\n")).toContain("CC BY-SA 4.0");
    expect(many.lines.join("\n")).toContain("/ CC BY 2.0");
  });

  it("keeps the short entries together on a line with their separator, as before", () => {
    const s = creditScreen("en", [by("Jane Doe"), by("Joe Roe", { scene: 1 })], "vertical");
    expect(s.lines).toEqual(["Photos: Wikimedia Commons", "Jane Doe, CC BY-SA 4.0", "Joe Roe, CC BY-SA 4.0"]);
    expect(creditScreen("en", [by("Jane Doe"), by("Joe Roe", { scene: 1 })], "wide").lines[1]).toBe("Jane Doe, CC BY-SA 4.0 · Joe Roe, CC BY-SA 4.0");
  });
});
