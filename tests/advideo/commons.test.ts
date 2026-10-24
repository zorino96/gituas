import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRAME_H,
  FRAME_W,
  MAX_ARTICLE_IMAGES,
  STORY_PHOTO_BUDGET_MS,
  WIDE_ENLARGE_MAX,
  WIDE_FRAME_H,
  WIDE_FRAME_W,
  WIDE_SHARP_MIN,
  cleanArticleImages,
  cleanArtist,
  cleanQuery,
  commonsUserAgent,
  composeFrame,
  composeLandscape,
  composePortrait,
  crimeLike,
  deletePhotos,
  deliveredSize,
  eraOfTexts,
  findStoryPhotos,
  isOwnPhotoUrl,
  judge,
  licenceOf,
  plain,
  probeArticle,
  probeCommons,
  relevant,
  shotKey,
  tokensOf,
  type CommonsPage,
  type PhotoStore,
} from "@/lib/advideo/commons";

// The Wikimedia Commons photo finder, run against captured answers of the real API (fixtures/) and made-up ones. No test
// reaches the network or the Blob store: the fetch and the store are injected.

const fixture = (name: string): { query: { pages: CommonsPage[] } } => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const HINTERKAIFECK = () => fixture("commons-hinterkaifeck.json");
const MARY_CELESTE = () => fixture("commons-mary-celeste.json");
// Captured 2026-10-21 from the real APIs: the pictures of an English Wikipedia article in the order of the page (action=parse,
// prop=images) and the Commons image information of the JPEG and PNG ones among them (what the finder's article pool receives).
const ARTICLE = (slug: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `article-images-${slug}.json`), "utf8")) as { parse: { title: string; images: string[] } };
const ARTICLE_INFO = (slug: string) => fixture(`article-info-${slug}.json`);

const jpeg = (w: number, h: number, rgb: [number, number, number] = [200, 200, 200]) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg().toBuffer();

let LANDSCAPE: Buffer;
let PORTRAIT: Buffer;
beforeAll(async () => {
  LANDSCAPE = await jpeg(918, 716);
  PORTRAIT = await jpeg(700, 1000);
});

const md = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }]));

/** A made-up page of the API's answer. */
function page(name: string, o: { index?: number; mime?: string; w?: number; h?: number; size?: number; thumb?: string; descriptionurl?: string; meta?: Record<string, string> } = {}): CommonsPage {
  const w = o.w ?? 3000;
  const h = o.h ?? 2000;
  const file = name.replace(/ /g, "_");
  return {
    title: `File:${name}`,
    index: o.index ?? 1,
    imageinfo: [
      {
        size: o.size ?? 900_000,
        width: w,
        height: h,
        mime: o.mime ?? "image/jpeg",
        thumburl: o.thumb ?? `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1280px-${file}`,
        descriptionurl: o.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${file}`,
        extmetadata: md({ License: "cc-by-sa-4.0", LicenseShortName: "CC BY-SA 4.0", AttributionRequired: "true", Artist: "Jane Doe", Categories: "Old farms", ...o.meta }),
      },
    ],
  };
}

describe("cleanArtist", () => {
  it("strips tags, decodes entities and collapses spaces", () => {
    expect(cleanArtist('<a href="https://commons.wikimedia.org/wiki/User:X" title="User:X">Crawdad&nbsp;Blues</a>')).toBe("Crawdad Blues");
    expect(cleanArtist("<span>Bj&#246;rn &amp; Sons</span>")).toBe("Björn & Sons");
  });
  it("keeps the first sentence only, but not the dot of an initial or a title", () => {
    expect(cleanArtist("Andreas Biegleder. According to a letter of the owner, the photograph was taken in 1922")).toBe("Andreas Biegleder");
    expect(cleanArtist("J. R. Smith")).toBe("J. R. Smith");
    expect(cleanArtist("Dr. Anna Berg")).toBe("Dr. Anna Berg");
  });
  it("collapses a name written twice by nested tags", () => {
    expect(cleanArtist("<span>Burkhard Mücke</span><span>Burkhard Mücke</span>")).toBe("Burkhard Mücke");
    expect(cleanArtist("<div><span>Some Person</span></div> <div><span>Some Person</span></div>")).toBe("Some Person");
  });
  it("gives null for an unknown author", () => {
    expect(cleanArtist("<span>Unknown author</span><span>Unknown author</span>")).toBeNull();
    expect(cleanArtist("Unknown photographer")).toBeNull();
    expect(cleanArtist("")).toBeNull();
    expect(cleanArtist(undefined)).toBeNull();
  });
  it("names the uploader of an old Wikipedia upload, and cuts at 60 characters", () => {
    expect(cleanArtist('Original uploader was <a href="x">RedCoat10</a> at en.wikipedia<br>(Original text : No illustrator given.)')).toBe("RedCoat10");
    expect(Array.from(cleanArtist(Array.from({ length: 100 }, (_, i) => String.fromCharCode(97 + ((i * 7) % 26))).join(""))!).length).toBe(60);
  });
});

describe("licenceOf", () => {
  const lic = (License: string, LicenseShortName = "", extra: Record<string, string> = {}) => licenceOf(md({ License, LicenseShortName, ...extra }));
  it("accepts public domain, CC0, CC BY and CC BY-SA by their exact names, with an optional jurisdiction", () => {
    for (const [code, name] of [
      ["pd", "Public domain"],
      ["pd-old-100-expired", "Public domain"],
      ["pd-old-70-expired", "Public domain"],
      ["pd-usgov-nasa", "Public domain"],
      ["pd-self", "Public domain"],
      ["cc0", "CC0"],
      ["cc-zero", "CC0"],
      ["cc-by-2.0", "CC BY 2.0"],
      ["cc-by-sa-4.0", "CC BY-SA 4.0"],
      ["cc-by-sa-3.0-de", "CC BY-SA 3.0 de"],
      ["cc-by-3.0-nl", "CC BY 3.0 nl"],
      ["cc-by-sa-3.0-migrated", "CC BY-SA 3.0"],
    ]) {
      expect(lic(code, name).ok, code).toBe(true);
    }
    expect(lic("", "Public domain").ok).toBe(true);
    expect(lic("", "CC BY-SA 3.0").ok).toBe(true);
    expect(lic("", "CC BY 4.0").ok).toBe(true);
    expect(lic("cc-by-sa-4.0", "").ok).toBe(true);
  });
  it("refuses everything else: free use by a person, GFDL, non-commercial, no-derivatives, a bare attribution", () => {
    for (const [code, name] of [
      ["", "Copyrighted free use"],
      ["gfdl", "GFDL"],
      ["cc-by-nc-4.0", "CC BY-NC 4.0"],
      ["cc-by-nd-2.0", "CC BY-ND 2.0"],
      ["cc-by-nc-sa-3.0", "CC BY-NC-SA 3.0"],
      ["", "Attribution"],
      ["", ""],
      ["fal", "Free Art License"],
    ]) {
      expect(lic(code, name).ok, `${code}/${name}`).toBe(false);
    }
  });
  it("refuses the Public Domain Mark and the public domain templates that are not about a photograph's copyright", () => {
    for (const [code, name] of [
      ["pdm", "Public Domain Mark"],
      ["pdm-owner", "Public Domain Mark"],
      ["pd-textlogo", "Public domain"],
      ["pd-logo", "Public domain"],
      ["pd-shape", "Public domain"],
      ["pd-simple", "Public domain"],
      ["pd-ineligible", "Public domain"],
      ["pd-trademark", "Public domain"],
      ["pd-us", "Public domain"],
      ["pd-us-expired", "Public domain"],
    ]) {
      expect(lic(code, name).ok, `${code}/${name}`).toBe(false);
    }
  });
  it("refuses a name that only starts like an accepted one: qualified, dual-licensed, unversioned", () => {
    for (const name of [
      "Public domain in the US only",
      "Public domain in the United States",
      "Public domain (but see the notes)",
      "CC BY-SA 4.0 International (modified)",
      "CC BY 4.0 or GFDL",
      "CC BY",
      "CC BY-SA",
      "CC0 and more",
      "CC BY-SA 3.0, 2.5, 2.0, 1.0",
      "Attribution",
    ]) {
      expect(lic("", name).ok, name).toBe(false);
    }
    // the template can be fine and the name still refuse it, and the other way round
    expect(lic("cc-by-sa-3.0", "Dual-licensed CC BY-SA 3.0").ok).toBe(false);
    expect(lic("gfdl", "CC BY-SA 3.0").ok).toBe(false);
  });
  it("says when the author must be named, and reads the licence link", () => {
    expect(lic("cc-by-sa-4.0", "CC BY-SA 4.0").attribution).toBe(true);
    expect(lic("pd", "Public domain", { AttributionRequired: "false" }).attribution).toBe(false);
    expect(lic("cc0", "CC0").attribution).toBe(false);
    expect(lic("", "CC BY 3.0").attribution).toBe(true);
    expect(lic("pd", "Public domain", { AttributionRequired: "true" }).attribution).toBe(true);
    expect(lic("cc-by-4.0", "CC BY 4.0", { LicenseUrl: "https://creativecommons.org/licenses/by/4.0" }).url).toBe("https://creativecommons.org/licenses/by/4.0");
    expect(lic("cc-by-4.0", "CC BY 4.0", { LicenseUrl: "javascript:alert(1)" }).url).toBeNull();
  });
});

describe("deliveredSize", () => {
  const T = "https://upload.wikimedia.org/wikipedia/commons";
  it("reads the size the URL really serves, not the size asked for", () => {
    expect(deliveredSize({ width: 3374, height: 5100, thumburl: `${T}/thumb/9/99/X.jpg/1280px-X.jpg` })).toEqual({ w: 1280, h: 1935, unscaled: false });
    expect(deliveredSize({ width: 1000, height: 500, thumburl: `${T}/thumb/9/99/X.jpg/lossy-page1-640px-X.jpg` })).toEqual({ w: 640, h: 320, unscaled: false });
  });
  it("takes the original's size when the thumbnail is unscaled or not smaller", () => {
    expect(deliveredSize({ width: 918, height: 716, thumburl: `${T}/d/df/X.jpg?utm_source=commons.wikimedia.org&utm_content=thumbnail_unscaled` })).toEqual({ w: 918, h: 716, unscaled: true });
    expect(deliveredSize({ width: 1200, height: 800, thumburl: `${T}/thumb/9/99/X.jpg/1280px-X.jpg` })).toEqual({ w: 1200, h: 800, unscaled: true });
    expect(deliveredSize({ width: 1200, height: 800 })).toEqual({ w: 1200, h: 800, unscaled: true });
  });
});

describe("tokensOf", () => {
  it("folds accents, drops stop words, short words and bare numbers, and keeps years", () => {
    expect(tokensOf("The Old Hinterkaifeck Hof 1922")).toEqual(["hinterkaifeck", "hof", "1922"]);
    expect(tokensOf('"Mary Celeste" ship')).toEqual(["mary", "celeste", "ship"]);
    expect(tokensOf("Zürich Bahnhof")).toEqual(["zurich", "bahnhof"]);
    expect(tokensOf("Room 12 at 7 Bavaria 3000")).toEqual(["room", "bavaria"]);
    expect(tokensOf("of an")).toEqual([]);
  });
  it("cleanQuery keeps Latin letters only and no search operators", () => {
    expect(cleanQuery('  incategory:"Foo"  Hinterkaifeck Hof  ')).toBe("incategory Foo Hinterkaifeck Hof");
    expect(cleanQuery("مزرعة farm")).toBe("farm");
    expect(cleanQuery("a".repeat(200)).length).toBe(80);
  });
});

describe("relevant", () => {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

  it("needs every word of a phrase of one or two words", () => {
    expect(relevant(words("Hinterkaifeck Hof 02"), "Hinterkaifeck")).toBe(true);
    expect(relevant(words("Hinterkaifeck Hof 02"), "Hinterkaifeck Hof")).toBe(true);
    expect(relevant(words("Hinterkaifeck Hof 02"), "Hinterkaifeck farm")).toBe(false);
    expect(relevant(words("Mary Celeste at sea"), "Mary Celeste")).toBe(true);
    expect(relevant(words("Celeste at sea"), "Mary Celeste")).toBe(false);
  });

  it("needs every name and every year of a longer phrase, and lets the lowercase words go", () => {
    expect(relevant(words("Hinterkaifeck near Munich"), "farmhouse near Hinterkaifeck")).toBe(true);
    expect(relevant(words("Munich street 2019"), "Munich street 1922 view")).toBe(false);
    expect(relevant(words("Munich street 1922"), "street Munich 1922")).toBe(true);
    // a name of the phrase that the file does not carry refuses it
    expect(relevant(words("Mary Celeste at sea"), "Mary Celeste Gibraltar harbour")).toBe(false);
    expect(relevant(words("Mary Celeste in Gibraltar harbour"), "Mary Celeste Gibraltar harbour")).toBe(true);
  });

  it("needs half of the words (rounded up) of a longer phrase that has no name and no year", () => {
    expect(relevant(words("snowy tent in the mountains"), "snowy tent mountains slope")).toBe(true);
    expect(relevant(words("snowy field"), "snowy tent mountains slope")).toBe(false);
  });

  it("takes whole words only: no prefix, no plural", () => {
    expect(relevant(words("Maryland farm"), "Mary Celeste")).toBe(false);
    expect(relevant(words("Mary Celestes"), "Mary Celeste")).toBe(false);
    expect(relevant(words("Old farmhouses in Bavaria"), "farmhouse Bavaria")).toBe(false);
  });

  it("reads years as words, and a phrase of nothing but stop words matches nothing", () => {
    expect(relevant(words("Munich 2019"), "Munich 1922")).toBe(false);
    expect(relevant(words("Munich 1922"), "Munich 1922")).toBe(true);
    expect(relevant(words("anything at all"), "the old photo")).toBe(false);
  });
});

describe("shotKey", () => {
  it("is the same for a photograph and an edited copy of it, and different for two photographs of a series", () => {
    expect(shotKey("File:Hinterkaifeck-Hof (cropped).jpg")).toBe(shotKey("File:Hinterkaifeck-Hof.jpg"));
    expect(shotKey("File:Hinterkaifeck Hof [edited].png")).toBe(shotKey("File:Hinterkaifeck_Hof.jpg"));
    expect(shotKey("File:Ausstellung 03.jpg")).not.toBe(shotKey("File:Ausstellung 10.jpg"));
    expect(shotKey("File:Hof (south).jpg")).not.toBe(shotKey("File:Hof.jpg"));
    expect(shotKey("File:Zürich.jpg")).toBe("zurich");
  });
});

describe("plain", () => {
  it("drops format and control characters and collapses spaces", () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    const shy = String.fromCodePoint(0xad);
    const bell = String.fromCodePoint(7);
    expect(plain(`Jane${rlo} Doe${zwsp}${shy}`)).toBe("Jane Doe");
    expect(plain(`a${bell}b\n\tc`)).toBe("a b c");
    expect(plain("  Ünï  cødé  ")).toBe("Ünï cødé");
  });
});

describe("judge", () => {
  const why = (p: CommonsPage, q: string | null = null, opts: { lenient?: boolean; allowPeople?: boolean } = {}) => judge(p, q, opts).why;
  const UNSCALED = "https://upload.wikimedia.org/x/Farm.jpg?thumbnail_unscaled";
  const PD = { License: "pd", LicenseShortName: "Public domain", AttributionRequired: "false" };

  it("accepts a free, large photograph and builds its credit", () => {
    const j = judge(page("Old farm near Munich.jpg", { meta: { LicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" } }), "farm Munich");
    expect(j.why).toBeNull();
    expect(j.candidate).toMatchObject({
      title: "File:Old farm near Munich.jpg",
      w: 1280,
      h: 853,
      unscaled: false,
      credit: {
        title: "File:Old farm near Munich.jpg",
        author: "Jane Doe",
        licence: "CC BY-SA 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        page: "https://commons.wikimedia.org/wiki/File:Old_farm_near_Munich.jpg",
        attribution: true,
      },
    });
  });

  it("refuses by mime and by extension (SVG, TIFF, GIF, WebP)", () => {
    expect(why(page("Farm.tiff", { mime: "image/tiff" }))).toBe("mime");
    expect(why(page("Farm.svg", { mime: "image/svg+xml" }))).toBe("mime");
    expect(why(page("Farm.webp", { mime: "image/webp" }))).toBe("mime");
    expect(why(page("Farm.pdf", { mime: "image/jpeg" }))).toBe("extension");
    expect(why(page("Farm.png", { mime: "image/png" }))).toBeNull();
  });

  it("refuses a file that is non-free or restricted", () => {
    expect(why(page("Farm.jpg", { meta: { NonFree: "true" } }))).toBe("nonfree");
    expect(why(page("Farm.jpg", { meta: { Restrictions: "trademarked|personality" } }))).toBe("restrictions");
    expect(why(page("Farm.jpg", { meta: { Restrictions: "" } }))).toBeNull();
  });

  it("refuses by size and shape of what is served: tiny, thin, extreme", () => {
    expect(why(page("Farm.jpg", { w: 500, h: 400, thumb: UNSCALED }))).toBe("small");
    expect(why(page("Farm.jpg", { w: 880, h: 700, thumb: UNSCALED }))).toBe("small");
    // the key 1922 farm photograph is 918x716 and must pass
    expect(why(page("Farm.jpg", { w: 918, h: 716, size: 380_000, thumb: UNSCALED }))).toBeNull();
    expect(why(page("Farm.jpg", { w: 5100, h: 1609 }))).toBe("small"); // served at 1280 wide it is 404 tall
    expect(why(page("Farm.jpg", { w: 1500, h: 700 }))).toBe("small");
    expect(why(page("Farm.jpg", { w: 2400, h: 1000, thumb: "https://upload.wikimedia.org/thumb/a/ab/Farm.jpg/2400px-Farm.jpg" }))).toBe("aspect");
    expect(why(page("Farm.jpg", { w: 1000, h: 3000 }))).toBe("aspect");
    expect(why(page("Farm.jpg", { w: 3000, h: 6000 }))).toBeNull();
  });

  it("is a little more lenient with the pictures of the case's own article: an archival photograph is often 900 pixels wide", () => {
    // 918x564 and 960x430 are the two archival photographs of the Hinterkaifeck farm
    expect(why(page("Farm.jpg", { w: 918, h: 564, thumb: UNSCALED }))).toBe("small");
    expect(why(page("Farm.jpg", { w: 918, h: 564, thumb: UNSCALED }), null, { lenient: true })).toBeNull();
    expect(why(page("Farm.jpg", { w: 960, h: 430, thumb: UNSCALED }))).toBe("small");
    expect(why(page("Farm.jpg", { w: 960, h: 430, thumb: UNSCALED }), null, { lenient: true })).toBeNull();
    // but not a thumbnail-sized one, and not an extreme shape
    expect(why(page("Farm.jpg", { w: 700, h: 500, thumb: UNSCALED }), null, { lenient: true })).toBe("small");
    expect(why(page("Farm.jpg", { w: 800, h: 380, thumb: UNSCALED }), null, { lenient: true })).toBe("small");
    expect(why(page("Farm.jpg", { w: 2600, h: 1000 }), null, { lenient: true })).toBe("aspect");
    expect(why(page("Farm.jpg", { w: 900, h: 2200, thumb: UNSCALED }), null, { lenient: true })).toBe("aspect");
  });

  it("caps the bytes of an unscaled original, but not of a big original that is served as a thumbnail", () => {
    const unscaled = (size: number) => page("Farm.jpg", { w: 1600, h: 1200, size, thumb: UNSCALED });
    expect(why(unscaled(9 * 1024 * 1024))).toBe("too-big");
    expect(why(unscaled(7 * 1024 * 1024))).toBeNull();
    expect(why(page("Farm.jpg", { size: 40 * 1024 * 1024 }))).toBeNull();
  });

  it("refuses drawings, maps, logos and the like by whole words (also in the categories, also plural and German)", () => {
    for (const bad of ["Company logo", "Map of the area", "Old maps", "Flagge von Bayern", "Wappen der Familie", "Hinterkaifeck Flurkarte nach 1870", "Pencil drawing", "Zeichnung eines Hofs", "Stamp of Gibraltar", "Gemälde vom Hof"]) {
      expect(why(page(`${bad}.jpg`)), bad).toMatch(/^deny:/);
    }
    expect(why(page("Farm.jpg", { meta: { Categories: "Sailing ships in paintings" } }))).toBe("deny:paintings");
    expect(why(page("Farm.jpg", { meta: { Categories: "Brigantines in art|Old farms" } }))).toBe("deny:in art");
    expect(why(page("Farm.jpg", { meta: { Categories: "PD-Art (PD-old-100-expired)" } }))).toBe("deny:pd-art");
    expect(why(page("Farm.jpg", { meta: { ObjectName: "Engraving of a farm" } }))).toBe("deny:engraving");
  });

  it("does not refuse a word that only contains a deny word", () => {
    for (const fine of ["Mapuche warriors, 1900", "Flagstaff railway station", "Iconic farm in Bavaria", "Chartres cathedral", "Coincidence rock", "Scandinavian farm", "Courtyard of the farm", "Gravel road to the farm", "Polish village", "Lettering on the barn", "Documentation of the walls"]) {
      expect(why(page(`${fine}.jpg`)), fine).toBeNull();
    }
  });

  it("refuses scenes of death, nudity and portraits", () => {
    expect(why(page("Tatortfotos zu Mord.jpg"))).toMatch(/^sensitive:/);
    expect(why(page("Farm.jpg", { meta: { Categories: "Crime scenes in Germany" } }))).toMatch(/^sensitive:/);
    expect(why(page("Farm.jpg", { meta: { Categories: "Murder victims" } }))).toMatch(/^sensitive:/);
    expect(why(page("Farm.jpg", { meta: { ImageDescription: "The corpse was found here" } }))).toMatch(/^sensitive:/);
    expect(why(page("Farm.jpg", { meta: { Categories: "Portrait photographs of men" } }))).toMatch(/^sensitive:/);
  });

  it("refuses documents, exhibitions, newspapers, police and court pictures, graves and portraits: in the title, in the categories AND in the description", () => {
    const words = [
      "Ausstellung zu Mord", "Museum panel about the farm", "Newsprint", "Scan of a page", "Scanned book", "Manuscript fragment", "Document from the archive",
      "Letter to the mayor", "Mugshot", "Mug shot", "Trial of the farmhand", "Defendant in the dock", "The suspect", "Arrest warrant", "Courthouse",
      "Police report", "Polizei Landsberg", "Funeral procession", "Grave of the family", "Coffin", "Autopsy room", "Portrait of a man", "Selfie at the farm",
      "Victim memorial", "Gore",
    ];
    for (const w of words) {
      expect(why(page(`${w}.jpg`)), `title: ${w}`).toMatch(/^sensitive:/);
      expect(why(page("Farm.jpg", { meta: { Categories: `Old farms|${w}` } })), `category: ${w}`).toMatch(/^sensitive:/);
      expect(why(page("Farm.jpg", { meta: { ImageDescription: `A photograph. ${w}.` } })), `description: ${w}`).toMatch(/^sensitive:/);
    }
    // a newspaper is refused as a thing of its own (the older list), a page of text by name too
    expect(why(page("Newspaper clipping.jpg"))).toMatch(/^(deny|sensitive):/);
    expect(why(page("Farm.jpg", { meta: { Categories: "The New York Times, 1873" } }))).toBe("sensitive:new york times");
  });

  it("refuses a photograph that is filed under a person, unless the story is about a person", () => {
    for (const c of ["1897 births", "1922 deaths", "People of Bavaria", "People from Munich", "Living people", "Men of Bavaria", "Murdered people of Germany"]) {
      expect(why(page("Farm.jpg", { meta: { Categories: `Old farms|${c}` } })), c).toBe("person");
      expect(why(page("Farm.jpg", { meta: { Categories: `Old farms|${c}` } }), null, { allowPeople: true }), `${c} (person)`).toBeNull();
    }
    for (const c of ["Hinterkaifeck murders", "Farmhouses in Bavaria", "1922 in Germany", "Peoples of the Caucasus"]) {
      expect(why(page("Farm.jpg", { meta: { Categories: c } })), c).toBeNull();
    }
  });

  it("refuses a file whose licence Commons itself doubts", () => {
    for (const c of ["PD-RU-exempt (possible wrong license)", "License review needed", "Copyright violations", "Deletion requests 2024", "Files with no permission since 2020"]) {
      expect(why(page("Farm.jpg", { meta: { ...PD, Categories: `Old farms|${c}` } })), c).toBe("licence-doubt");
    }
  });

  it("refuses a CC BY or CC BY-SA photograph without a usable author name, and keeps a public domain one without", () => {
    for (const artist of ["Unknown author", "Anonymous", "<span>Unknown author</span><span>Unknown author</span>", "", "   "]) {
      expect(why(page("Farm.jpg", { meta: { Artist: artist } })), artist).toBe("no-author");
    }
    const noArtist = page("Farm.jpg");
    delete noArtist.imageinfo![0].extmetadata!.Artist;
    expect(why(noArtist)).toBe("no-author");
    expect(why(page("Farm.jpg", { meta: { ...PD, Artist: "Unknown author" } }))).toBeNull();
    expect(why(page("Farm.jpg", { meta: { License: "cc0", LicenseShortName: "CC0", AttributionRequired: "false", Artist: "" } }))).toBeNull();
    expect(judge(page("Farm.jpg", { meta: { ...PD, Artist: "Unknown author" } }), null).candidate!.credit.author).toBeNull();
  });

  it("keeps format and control characters out of the author and the title that are printed in a post", () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    const bell = String.fromCodePoint(7);
    const j = judge(page(`Old${zwsp} farm${rlo}.jpg`, { meta: { Artist: `<b>Jane${rlo} Doe${zwsp}${bell}</b>` } }), null);
    expect(j.candidate!.title).toBe("File:Old farm.jpg");
    expect(j.candidate!.credit.title).toBe("File:Old farm.jpg");
    expect(j.candidate!.credit.author).toBe("Jane Doe");
    expect(cleanArtist(`Jane${rlo}${zwsp}Doe`)).toBe("JaneDoe");
  });

  it("refuses a file whose URLs are not Wikimedia's", () => {
    expect(why(page("Farm.jpg", { thumb: "https://evil.example/thumb/Farm.jpg/1280px-Farm.jpg" }))).toBe("host");
    expect(why(page("Farm.jpg", { thumb: "http://upload.wikimedia.org/thumb/Farm.jpg/1280px-Farm.jpg" }))).toBe("host");
    expect(why(page("Farm.jpg", { thumb: "https://upload.wikimedia.org.evil.example/thumb/Farm.jpg/1280px-Farm.jpg" }))).toBe("host");
    expect(why(page("Farm.jpg", { descriptionurl: "https://evil.example/wiki/File:Farm.jpg" }))).toBe("host");
    expect(why(page("Farm.jpg", { thumb: "https://thumb.wikimedia.org/thumb/Farm.jpg/1280px-Farm.jpg" }))).toBeNull();
  });

  it("guards relevance with whole words: every word of a short phrase, every name and year of a longer one", () => {
    expect(why(page("Amazon Kingfisher.jpg", { meta: { Categories: "Birds|Costa Rica" } }), "Mary Celeste ship")).toBe("off-topic");
    // 'mary' must not match 'Maryland'
    expect(why(page("Amazon parrot.jpg", { meta: { Categories: "Featured pictures of Maryland" } }), "Mary Celeste")).toBe("off-topic");
    expect(why(page("Mary Celeste at sea.jpg"), "Mary Celeste ship")).toBeNull();
    // two words: both are needed, and 'farm' is not in the file's text
    expect(why(page("Hinterkaifeck-Hof.jpg"), "Hinterkaifeck farm")).toBe("off-topic");
    expect(why(page("Hinterkaifeck-Hof.jpg"), "Hinterkaifeck Hof")).toBeNull();
    expect(why(page("Hinterkaifeck-Hof.jpg"), "Hinterkaifeck")).toBeNull();
    // no prefix and no plural
    expect(why(page("Old farmhouses in Bavaria.jpg"), "farmhouse Bavaria")).toBe("off-topic");
    // a year is a word: a street scene of 2019 is not Munich in 1922
    expect(why(page("Munich street scene 2019.jpg"), "Munich 1922")).toBe("off-topic");
    expect(why(page("Munich street scene 1922.jpg"), "Munich 1922")).toBeNull();
    // a phrase of nothing but stop words can match nothing
    expect(why(page("Hinterkaifeck-Hof.jpg"), "the old photo")).toBe("off-topic");
    expect(why(page("Anything.jpg"), null)).toBeNull();
  });

  describe("on the captured answers of the real API (a search)", () => {
    const verdicts = (f: () => { query: { pages: CommonsPage[] } }, q: string) =>
      Object.fromEntries(f().query.pages.map((p) => [p.title!.replace(/^File:/, ""), judge(p, q).why ?? "OK"]));

    it("Hinterkaifeck: keeps the archival farm photograph (public domain, 918x716) and nothing else", () => {
      const v = verdicts(HINTERKAIFECK, "Hinterkaifeck");
      expect(v["Hinterkaifeck-Hof.jpg"]).toBe("OK");
      expect(v["Hinterkaifeck-Marterl.jpg"]).toBe("licence"); // 'Copyrighted free use'
      expect(v["Hinterkaifeck-Hof (cropped).jpg"]).toBe("small"); // a search keeps the strict size gates ...
      expect(v["Photo - Hinterkaifeck.jpg"]).toBe("small"); // ... the article's own pictures do not (below)
      expect(v["Tatortfotos zu Mord in Hinterkaifeck ,.jpg"]).toMatch(/^sensitive:/);
      expect(v["Hinterkaifeck Inschrift.jpg"]).toBe("sensitive:opfer");
      expect(v["Hinterkaifeck Flurkarte nach 1870.jpg"]).toMatch(/^deny:/);
      // the photographs of the exhibition (panels, catalogues) are refused: they show documents
      const shows = Object.entries(v).filter(([k]) => /Ausstellung/.test(k));
      expect(shows).toHaveLength(7);
      for (const [k, w] of shows) expect(w, k).toMatch(/^sensitive:ausstellung/);
      expect(Object.values(v).filter((w) => w === "OK")).toHaveLength(1);
    });

    it("Hinterkaifeck: the phrase 'Hinterkaifeck farm' does not find the farm photograph (its text has no 'farm')", () => {
      expect(verdicts(HINTERKAIFECK, "Hinterkaifeck farm")["Hinterkaifeck-Hof.jpg"]).toBe("off-topic");
    });

    it("Mary Celeste: refuses the painting, the engraving, the stamp, the portrait, the newspaper page, the tiny crops, the satellite TIFF and the parrots", () => {
      const v = verdicts(MARY_CELESTE, "Mary Celeste ship");
      expect(v["Mary Celeste as Amazon in 1861.jpg"]).toBe("deny:paintings");
      expect(v["Mary Celeste as Amazon in 1861 (cropped).jpg"]).toBe("deny:pd-art");
      expect(v["Mary Celeste engraving.jpg"]).toBe("deny:engraving");
      expect(v["Stamp of Gibraltar - 1967 - Colnect 238 - 1 - Mary Celeste.jpeg"]).toBe("deny:stamp");
      expect(v["Mary Celeste NYTimes 1873February26.png"]).toBe("sensitive:nytimes");
      expect(v["Mary-celeste briggs2.jpg"]).toBe("small");
      expect(v["Amazon River ESA17276564.tiff"]).toBe("mime");
      expect(v["Amazon Kingfisher (27012341489).jpg"]).toBe("off-topic");
      expect(v["Portrait of Yellow-headed Amazon Parrot.jpg"]).toMatch(/^sensitive:/);
      expect(v["Lap desk of Captain Benjamin Briggs from the Mary Celeste (PEM M6557) 01.jpg"]).toBe("OK");
      expect(Object.values(v).filter((w) => w === "OK")).toHaveLength(1);
    });

    it("credits the real answers the way the caption needs", () => {
      const hof = HINTERKAIFECK().query.pages.find((p) => p.title === "File:Hinterkaifeck-Hof.jpg")!;
      expect(judge(hof, "Hinterkaifeck Hof").candidate!.credit).toEqual({
        title: "File:Hinterkaifeck-Hof.jpg",
        author: "Andreas Biegleder",
        licence: "Public domain",
        licenceUrl: null,
        page: "https://commons.wikimedia.org/wiki/File:Hinterkaifeck-Hof.jpg",
        attribution: false,
      });
      const desk = MARY_CELESTE().query.pages.find((p) => /Lap desk.* 01\.jpg$/.test(p.title!))!;
      expect(judge(desk, "Mary Celeste").candidate!.credit).toMatchObject({ author: "Crawdad Blues", licence: "CC0", attribution: false });
    });
  });

  describe("on the captured pictures of Wikipedia articles (the case's own pool)", () => {
    const verdicts = (slug: string) =>
      Object.fromEntries(ARTICLE_INFO(slug).query.pages.map((p) => [p.title!.replace(/^File:/, ""), judge(p, null, { lenient: true }).why ?? "OK"]));

    it("Hinterkaifeck murders: the two archival photographs of the farm come out of the article; the maps, the poster, the memorial cards and the 'free use' photograph do not", () => {
      expect(verdicts("hinterkaifeck")).toEqual({
        "Hinterkaifeck-Hof (cropped).jpg": "OK",
        "Photo - Hinterkaifeck.jpg": "OK",
        "Bavaria relief location map.jpg": "deny:map",
        "Hinterkaifeck Flurkarte nach 1870.jpg": "deny:flurkarte",
        "Sterbebildchen der sechs Ermordeten.jpg": "sensitive:sterbebildchen",
        "Plakat mit Belohnung von 100 000 Mark.jpg": "deny:plakat",
        "Hinterkaifeck-Marterl.jpg": "licence",
      });
      const hof = ARTICLE_INFO("hinterkaifeck").query.pages.find((p) => p.title === "File:Hinterkaifeck-Hof (cropped).jpg")!;
      expect(judge(hof, null, { lenient: true }).candidate).toMatchObject({ w: 918, h: 564, unscaled: true, credit: { author: "Andreas Biegleder", licence: "Public domain", attribution: false } });
    });

    it("Mary Celeste: a museum object, a satellite picture and a waterspout pass; paintings, the portrait and the newspaper page do not", () => {
      expect(verdicts("mary-celeste")).toEqual({
        "Mary Celeste as Amazon in 1861 (cropped).jpg": "deny:pd-art",
        "Villageview.jpg": "small",
        "Lap desk of Captain Benjamin Briggs from the Mary Celeste (PEM M6557) 02.jpg": "OK",
        "George McCord - New York Harbor.jpg": "deny:pd-art",
        "Sir James Cochrane 1841-1877.jpg": "OK",
        "Trombe.jpg": "OK",
        "Arthur Conan Doyle by Herbert Rose Barraud 1893.jpg": "sensitive:portrait",
        "Mary Celeste NYTimes 1873February26.png": "sensitive:nytimes",
        "Gonave.jpg": "OK",
      });
    });

    it("Dyatlov Pass incident: nothing passes (maps, a grave, and the tent photograph whose licence Commons doubts)", () => {
      expect(verdicts("dyatlov")).toEqual({
        "Памятник дятловцам на Михайловском кладбище.jpg": "sensitive:grave",
        "Russia rel location map.png": "deny:map",
        "Sverdlovskaya-pozkarta.png": "deny:maps",
        "Dyatlov Pass incident 02.jpg": "licence-doubt",
        "Фото членов тургруппы Игоря Дятлова.jpg": "sensitive:grave",
      });
    });
  });
});

describe("cleanArticleImages", () => {
  it("lists the JPEG and PNG pictures of a page as 'File:' titles, in the order of the page", () => {
    expect(cleanArticleImages(ARTICLE("hinterkaifeck").parse.images)).toEqual([
      "File:Hinterkaifeck-Hof (cropped).jpg",
      "File:Bavaria relief location map.jpg",
      "File:Hinterkaifeck Flurkarte nach 1870.jpg",
      "File:Photo - Hinterkaifeck.jpg",
      "File:Sterbebildchen der sechs Ermordeten.jpg",
      "File:Plakat mit Belohnung von 100 000 Mark.jpg",
      "File:Hinterkaifeck-Marterl.jpg",
    ]);
    expect(cleanArticleImages(ARTICLE("dyatlov").parse.images)).toHaveLength(5);
  });

  it("takes titles with or without the prefix and with underscores, and drops everything that is not a plain picture title", () => {
    const rlo = String.fromCodePoint(0x202e);
    expect(cleanArticleImages(["File:A b.jpg", "a_b.JPG", "Image:C.png", 42, null, {}, "x|y.jpg", "<script>.jpg", "d.gif", "e.svg", "f.tif", "", `g${rlo}.jpg`, "File:A b.jpg"])).toEqual([
      "File:A b.jpg",
      "File:C.png",
      "File:G.jpg",
    ]);
    expect(cleanArticleImages(undefined)).toEqual([]);
    expect(cleanArticleImages("File:A.jpg")).toEqual([]);
  });

  it("keeps at most 40", () => {
    expect(cleanArticleImages(Array.from({ length: 80 }, (_, i) => `Pic ${i}.jpg`))).toHaveLength(MAX_ARTICLE_IMAGES);
    expect(MAX_ARTICLE_IMAGES).toBe(40);
  });
});

describe("composePortrait", () => {
  const meta = async (b: Buffer) => sharp(b).metadata();
  const px = async (b: Buffer, left: number, top: number) => {
    const { data } = await sharp(b).extract({ left, top, width: 2, height: 2 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return data[0];
  };

  it("makes a 1350x2400 JPEG of any photograph", async () => {
    for (const buf of [LANDSCAPE, PORTRAIT, await jpeg(900, 900), await jpeg(1600, 1200), await jpeg(600, 1900)]) {
      const out = await composePortrait(buf);
      const m = await meta(out);
      expect([m.format, m.width, m.height]).toEqual(["jpeg", FRAME_W, FRAME_H]);
      expect(m.exif).toBeUndefined();
    }
  });

  it("draws a landscape photograph contained at full width over a darkened, blurred copy of itself", async () => {
    const out = await composePortrait(LANDSCAPE);
    const centre = await px(out, 600, 1190);
    const edge = await px(out, 600, 20);
    expect(centre).toBeGreaterThan(180); // the photograph itself (a flat 200)
    expect(edge).toBeLessThan(140); // the darkened backdrop (about 0.55 of it)
    expect(edge).toBeGreaterThan(60); // not black
  });

  it("covers the frame with a portrait photograph", async () => {
    const out = await composePortrait(PORTRAIT);
    expect(await px(out, 600, 20)).toBeGreaterThan(180);
    expect(await px(out, 600, 2300)).toBeGreaterThan(180);
  });

  it("applies the EXIF orientation before it decides: a landscape file turned to portrait is a plain cover", async () => {
    const turned = await sharp({ create: { width: 1000, height: 600, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await composePortrait(turned);
    expect(await px(out, 600, 20)).toBeGreaterThan(180);
  });

  it("flattens a transparent PNG and rejects what is not a picture", async () => {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect((await meta(await composePortrait(png))).channels).toBe(3);
    await expect(composePortrait(Buffer.from("not a picture"))).rejects.toThrow();
  });
});

// ---- findStoryPhotos --------------------------------------------------------------------------------------

type Pages = CommonsPage[];
const answer = (pages: Pages | null) => new Response(JSON.stringify(pages ? { batchcomplete: true, query: { pages } } : { batchcomplete: true }), { status: 200 });
const busy = (code = "cirrussearch-too-busy-error") => new Response(JSON.stringify({ error: { code, info: "busy" } }), { status: 200 });
const img = (buf: Buffer) => new Response(buf as unknown as BodyInit, { status: 200, headers: { "content-type": "image/jpeg" } });

/** A reply that is cut short, as the real fetch does, when the request's signal aborts. */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    p.then(resolve, reject);
  });
}

interface Fake {
  /** The reply to a full-text search of a term (without the filetype prefix). */
  search: (term: string, n: number) => Response | Promise<Response>;
  /** The reply to an image request (default: the landscape photograph). */
  image?: (url: string, n: number) => Response | Promise<Response>;
  /** The reply to the other API calls (subject pool). */
  other?: (params: URLSearchParams) => Response | Promise<Response>;
  /** The reply to a request for the image information of some titles (the pictures of the case's own article). */
  info?: (titles: string[], n: number) => Response | Promise<Response>;
}

function fakeFetch(f: Fake) {
  const log: { url: string; ua: string | null; term?: string; titles?: string[]; kind: "search" | "other" | "image" | "info" }[] = [];
  const counts = new Map<string, number>();
  const bump = (k: string) => (counts.set(k, (counts.get(k) ?? 0) + 1), counts.get(k)!);
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => abortable(reply(input, init), init?.signal ?? undefined)) as unknown as typeof fetch;
  const reply = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const ua = new Headers(init?.headers).get("user-agent");
    if (url.hostname === "commons.wikimedia.org") {
      const p = url.searchParams;
      if (p.get("titles")) {
        const titles = p.get("titles")!.split("|");
        log.push({ url: url.toString(), ua, titles, kind: "info" });
        return f.info ? f.info(titles, bump("info")) : answer(null);
      }
      if (p.get("generator") === "search") {
        const term = (p.get("gsrsearch") ?? "").replace(/^filetype:bitmap /, "");
        log.push({ url: url.toString(), ua, term, kind: "search" });
        return f.search(term, bump(`s:${term}`));
      }
      log.push({ url: url.toString(), ua, kind: "other" });
      if (f.other) return f.other(p);
      return answer(null);
    }
    log.push({ url: url.toString(), ua, kind: "image" });
    return f.image ? f.image(url.toString(), bump(`i:${url}`)) : img(LANDSCAPE);
  };
  return {
    impl,
    log,
    searches: () => log.filter((l) => l.kind === "search"),
    images: () => log.filter((l) => l.kind === "image"),
    infos: () => log.filter((l) => l.kind === "info"),
    others: () => log.filter((l) => l.kind === "other"),
  };
}

/** A store that remembers what was put where. */
function fakeStore() {
  const puts: { path: string; bytes: Buffer; type: string; signal?: AbortSignal }[] = [];
  const store: PhotoStore = async (p, bytes, type, signal) => {
    puts.push({ path: p, bytes, type, signal });
    return `https://abc123.public.blob.vercel-storage.com/${p}`;
  };
  return { store, puts };
}

/** A made-up public domain photograph (large, landscape) of the given name. */
const pd = (name: string, o: { index?: number; w?: number; h?: number; meta?: Record<string, string> } = {}): CommonsPage =>
  page(name, { index: o.index ?? 1, w: o.w ?? 1920, h: o.h ?? 1280, meta: { License: "pd", LicenseShortName: "Public domain", AttributionRequired: "false", Artist: "Anon", Categories: "Hinterkaifeck", ...o.meta } });
/** n made-up acceptable photographs of the farm, ranked 1..n by a search. */
const hk = (n: number): CommonsPage[] => Array.from({ length: n }, (_, i) => pd(`Hinterkaifeck farm view ${i + 1}.jpg`, { index: i + 1 }));
/** The reply of the image-information request for a set of known pages. */
const infoOf = (pages: Pages) => (titles: string[]) => answer(pages.filter((p) => titles.includes(p.title!)));

const base = { tenantId: "t1", jobId: "j1", subject: null as string | null, budgetMs: STORY_PHOTO_BUDGET_MS, retryMs: 1 };

describe("findStoryPhotos", () => {
  beforeEach(() => {
    vi.stubEnv("STORY_PHOTOS_ENABLED", "");
    vi.stubEnv("COMMONS_CONTACT", "");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("finds a photograph for each beat, stores it in the job's folder and credits it", async () => {
    const api = fakeFetch({ search: () => answer([...HINTERKAIFECK().query.pages, ...hk(3)]) });
    const { store, puts } = fakeStore();
    const found = await findStoryPhotos({
      ...base,
      wanted: [
        { scene: 2, queries: ["Hinterkaifeck farm"] },
        { scene: 0, queries: ["Hinterkaifeck Hof"] },
      ],
      fetchImpl: api.impl,
      store,
    });
    // in the order of the beats
    expect(found.map((f) => f.scene)).toEqual([0, 2]);
    // two beats never get the same photograph
    const titles = found.map((f) => f.credit.title);
    expect(new Set(titles).size).toBe(2);
    expect(titles[0]).toBe("File:Hinterkaifeck-Hof.jpg");
    expect(titles[1]).toMatch(/^File:Hinterkaifeck farm view \d\.jpg$/);
    for (const f of found) {
      expect(f.via).toBe("search");
      expect(f.url).toMatch(new RegExp(`^https://abc123\\.public\\.blob\\.vercel-storage\\.com/merchant/t1/advideo/j1/img-${f.scene}-[a-z0-9]+-1\\.jpg$`));
      expect(f.credit.scene).toBe(f.scene);
      expect(f.credit.page).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
    expect(puts).toHaveLength(2);
    for (const p of puts) {
      expect(p.type).toBe("image/jpeg");
      const m = await sharp(p.bytes).metadata();
      expect([m.format, m.width, m.height]).toEqual(["jpeg", FRAME_W, FRAME_H]);
    }
  });

  it("stores every picture under a name of its own, so that a late upload of an earlier try can never replace a picture that is in use", async () => {
    const api = fakeFetch({ search: () => answer(hk(2)) });
    const a = fakeStore();
    const b = fakeStore();
    const wanted = [{ scene: 0, queries: ["Hinterkaifeck farm"] }];
    await findStoryPhotos({ ...base, wanted, fetchImpl: api.impl, store: a.store });
    await findStoryPhotos({ ...base, wanted, fetchImpl: api.impl, store: b.store });
    expect(a.puts[0].path).toMatch(/^merchant\/t1\/advideo\/j1\/img-0-[a-z0-9]+-1\.jpg$/);
    expect(b.puts[0].path).toMatch(/^merchant\/t1\/advideo\/j1\/img-0-[a-z0-9]+-1\.jpg$/);
    expect(a.puts[0].path).not.toBe(b.puts[0].path);
    // and the second try of a beat whose first photograph could not be fetched has its own name again
    const gone = fakeFetch({ search: () => answer(hk(2)), image: (url, n) => (url.includes("view_1") && n === 1 ? new Response("gone", { status: 404 }) : img(LANDSCAPE)) });
    const c = fakeStore();
    const found = await findStoryPhotos({ ...base, wanted, fetchImpl: gone.impl, store: c.store });
    expect(found).toHaveLength(1);
    expect(c.puts[0].path).toMatch(/-2\.jpg$/);
  });

  it("asks the API the way Wikimedia wants: a User-Agent, bitmaps in the file namespace, a thumbnail width, maxlag", async () => {
    vi.stubEnv("COMMONS_CONTACT", "bot@example.org");
    const api = fakeFetch({ search: () => answer(null) });
    await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store });
    const s = api.searches()[0];
    const u = new URL(s.url);
    expect(u.origin + u.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(u.searchParams.get("gsrsearch")).toBe("filetype:bitmap Hinterkaifeck Hof");
    expect(u.searchParams.get("gsrnamespace")).toBe("6");
    expect(u.searchParams.get("iiurlwidth")).toBe("1280");
    expect(u.searchParams.get("maxlag")).toBe("5");
    expect(u.searchParams.get("formatversion")).toBe("2");
    expect(u.searchParams.get("iiprop")).toBe("url|size|mime|extmetadata");
    expect(s.ua).toBe("GituasVideoBot/1.0 (+https://gituas.com) bot@example.org");
    expect(commonsUserAgent()).toBe("GituasVideoBot/1.0 (+https://gituas.com) bot@example.org");
    vi.stubEnv("COMMONS_CONTACT", "");
    expect(commonsUserAgent()).toBe("GituasVideoBot/1.0 (+https://gituas.com)");
  });

  it("downloads the API's thumbnail with the same User-Agent, from Wikimedia's image host only", async () => {
    const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages) });
    await findStoryPhotos({ ...base, wanted: [{ scene: 1, queries: ["Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(api.images()).toHaveLength(1);
    const shot = api.images()[0];
    expect(new URL(shot.url).hostname).toBe("upload.wikimedia.org");
    expect(shot.url).toContain("Hinterkaifeck-Hof.jpg");
    expect(shot.ua).toBe("GituasVideoBot/1.0 (+https://gituas.com)");
  });

  it("takes the beat's next acceptable photograph when the first cannot be fetched, and gives up after that one extra try", async () => {
    const pages = hk(3);
    const fetchedOk = (n: number) => (url: string) => (url.includes(`view_${n}.jpg`) ? img(LANDSCAPE) : new Response("gone", { status: 404 }));
    // the first is gone: the second is used
    let api = fakeFetch({ search: () => answer(pages), image: fetchedOk(2) });
    let found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(found.map((f) => f.credit.title)).toEqual([pages[1].title]);
    expect(api.images()).toHaveLength(2);
    // the first two are gone: no third try
    api = fakeFetch({ search: () => answer(pages), image: fetchedOk(3) });
    found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(found).toEqual([]);
    expect(api.images()).toHaveLength(2);
  });

  it("goes on to the beat's next phrase when the first one finds nothing usable", async () => {
    const api = fakeFetch({ search: (term) => (term === "Hinterkaifeck" ? answer(HINTERKAIFECK().query.pages.filter((p) => p.title === "File:Hinterkaifeck-Marterl.jpg")) : answer(HINTERKAIFECK().query.pages)) });
    const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck", "Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(found).toHaveLength(1);
    expect(api.searches().map((s) => s.term)).toEqual(["Hinterkaifeck", "Hinterkaifeck Hof"]);
  });

  it("tries a phrase of three words or more once without its last word when it finds nothing, and judges what that finds against the shorter phrase", async () => {
    const api = fakeFetch({ search: (term) => (term === "Hinterkaifeck Hof Bavaria" ? answer(null) : answer(HINTERKAIFECK().query.pages)) });
    const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof Bavaria"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(api.searches().map((s) => s.term)).toEqual(["Hinterkaifeck Hof Bavaria", "Hinterkaifeck Hof"]);
    expect(found.map((f) => f.credit.title)).toEqual(["File:Hinterkaifeck-Hof.jpg"]);
    // a phrase of two words is not shortened
    const two = fakeFetch({ search: () => answer(null) });
    await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: two.impl, store: fakeStore().store });
    expect(two.searches()).toHaveLength(1);
  });

  it("asks a phrase that two beats share once", async () => {
    const api = fakeFetch({ search: () => answer(hk(3)) });
    const found = await findStoryPhotos({
      ...base,
      wanted: [
        { scene: 0, queries: ["Hinterkaifeck farm"] },
        { scene: 1, queries: ["Hinterkaifeck farm"] },
        { scene: 2, queries: ["Hinterkaifeck farm"] },
      ],
      fetchImpl: api.impl,
      store: fakeStore().store,
    });
    expect(api.searches()).toHaveLength(1);
    expect(new Set(found.map((f) => f.credit.title)).size).toBe(3);
  });

  it("retries an error that comes in an HTTP 200 once, and then gives up on that phrase", async () => {
    const once = fakeFetch({ search: (_t, n) => (n === 1 ? busy() : answer(HINTERKAIFECK().query.pages)) });
    expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: once.impl, store: fakeStore().store })).toHaveLength(1);
    expect(once.searches()).toHaveLength(2);

    for (const code of ["maxlag", "ratelimited"]) {
      const twice = fakeFetch({ search: (term) => (term === "bad" ? busy(code) : answer(HINTERKAIFECK().query.pages)) });
      const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["bad", "Hinterkaifeck Hof"] }], fetchImpl: twice.impl, store: fakeStore().store });
      expect(twice.searches().filter((s) => s.term === "bad")).toHaveLength(2);
      expect(found).toHaveLength(1); // the next phrase still works
    }

    // an error that is not about being busy is not retried
    const real = fakeFetch({ search: () => new Response(JSON.stringify({ error: { code: "badvalue" } }), { status: 200 }) });
    await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: real.impl, store: fakeStore().store });
    expect(real.searches()).toHaveLength(1);
  });

  it("retries a request that fails outright once", async () => {
    const api = fakeFetch({
      search: (_t, n) => {
        if (n === 1) throw new TypeError("fetch failed");
        return answer(HINTERKAIFECK().query.pages);
      },
    });
    expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store })).toHaveLength(1);
  });

  it("stops the whole stage on a 429 and returns what it already has", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = fakeFetch({
      search: async (term) => {
        if (term === "Hinterkaifeck Hof") return answer(HINTERKAIFECK().query.pages);
        await gate; // after the first beat is stored
        return term === "second" ? new Response("slow down", { status: 429 }) : answer(HINTERKAIFECK().query.pages);
      },
    });
    const store = fakeStore();
    const found = await findStoryPhotos({
      ...base,
      wanted: [
        { scene: 0, queries: ["Hinterkaifeck Hof"] },
        { scene: 1, queries: ["second"] },
        { scene: 2, queries: ["third"] },
      ],
      fetchImpl: api.impl,
      store: async (p, b, t) => {
        const url = await store.store(p, b, t);
        release();
        return url;
      },
    });
    expect(found.map((f) => f.scene)).toEqual([0]);
    // the other beats downloaded nothing after the stop
    expect(api.images()).toHaveLength(1);
  });

  it("stops on a 503 and on a 429 for an image as well", async () => {
    const down = fakeFetch({ search: () => new Response("", { status: 503 }) });
    expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }, { scene: 1, queries: ["Hinterkaifeck farm"] }], fetchImpl: down.impl, store: fakeStore().store })).toEqual([]);

    const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages), image: () => new Response("", { status: 429 }) });
    const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store });
    expect(found).toEqual([]);
    expect(api.images()).toHaveLength(1); // no second try after a 429
  });

  it("never rejects, whatever fails", async () => {
    const wanted = [{ scene: 0, queries: ["Hinterkaifeck Hof"] }];
    // the network throws
    expect(await findStoryPhotos({ ...base, wanted, fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, store: fakeStore().store })).toEqual([]);
    // the answer is not JSON
    expect(await findStoryPhotos({ ...base, wanted, fetchImpl: (async () => new Response("<html>down</html>", { status: 200 })) as unknown as typeof fetch, store: fakeStore().store })).toEqual([]);
    // the store fails
    const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages) });
    expect(await findStoryPhotos({ ...base, wanted, fetchImpl: api.impl, store: async () => { throw new Error("blob down"); } })).toEqual([]);
    // the file is not a picture
    const junk = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages), image: () => img(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage")])) });
    expect(await findStoryPhotos({ ...base, wanted, fetchImpl: junk.impl, store: fakeStore().store })).toEqual([]);
    // nonsense in, nothing out
    expect(await findStoryPhotos({ ...base, wanted: null as never, fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
    expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: null as never }, null as never, { scene: -1, queries: ["x y"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
    expect(await findStoryPhotos({ ...base, budgetMs: Number.NaN, wanted: [], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
    // nonsense in the article's picture list is ignored
    expect(await findStoryPhotos({ ...base, wanted, articleImages: [null, 5, {}] as never, fetchImpl: api.impl, store: fakeStore().store })).toHaveLength(1);
  });

  it("is switched off by STORY_PHOTOS_ENABLED=0 before it asks anything", async () => {
    vi.stubEnv("STORY_PHOTOS_ENABLED", "0");
    const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages) });
    expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
    expect(api.impl).not.toHaveBeenCalled();
  });

  it("does not start with less than a second of budget, and looks up at most ten beats", async () => {
    const none = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages) });
    expect(await findStoryPhotos({ ...base, budgetMs: 500, wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: none.impl, store: fakeStore().store })).toEqual([]);
    expect(none.impl).not.toHaveBeenCalled();

    const many = fakeFetch({ search: (term) => answer([page(`${term} one.jpg`, { index: 1 })]) });
    const found = await findStoryPhotos({
      ...base,
      wanted: Array.from({ length: 14 }, (_, i) => ({ scene: i, queries: [`Place${i}`] })),
      fetchImpl: many.impl,
      store: fakeStore().store,
    });
    expect(found.length).toBeLessThanOrEqual(10);
    expect(Math.max(...found.map((f) => f.scene))).toBeLessThanOrEqual(9);
  });

  it("keeps what has finished when the time ends, and does not wait for the rest", async () => {
    vi.useFakeTimers();
    let stored!: () => void;
    const first = new Promise<void>((r) => (stored = r));
    const store = fakeStore();
    const api = fakeFetch({ search: (term) => (term === "Hinterkaifeck Hof" ? answer(HINTERKAIFECK().query.pages) : new Promise<Response>(() => undefined)) });
    let done = false;
    const run = findStoryPhotos({
      ...base,
      budgetMs: 5_000,
      wanted: [
        { scene: 0, queries: ["Hinterkaifeck Hof"] },
        { scene: 1, queries: ["hangs forever"] },
      ],
      fetchImpl: api.impl,
      store: async (p, b, t) => {
        const url = await store.store(p, b, t);
        stored();
        return url;
      },
    }).then((r) => ((done = true), r));
    await first;
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false); // the hanging beat is still being waited for
    await vi.advanceTimersByTimeAsync(5_000);
    const found = await run;
    expect(found.map((f) => f.scene)).toEqual([0]);
  });

  it("gives up on a request that hangs after its own short timeout (the stage then goes on with the next phrase)", async () => {
    vi.useFakeTimers();
    const api = fakeFetch({ search: (term) => (term === "hang" ? new Promise<Response>(() => undefined) : answer(HINTERKAIFECK().query.pages)) });
    const run = findStoryPhotos({ ...base, budgetMs: 30_000, retryMs: 10, wanted: [{ scene: 0, queries: ["hang", "Hinterkaifeck Hof"] }], fetchImpl: api.impl, store: fakeStore().store });
    // 5 s for the first try, the pause, 5 s for the retry
    await vi.advanceTimersByTimeAsync(5_000 + 10 + 5_000);
    const found = await run;
    expect(found).toHaveLength(1);
    expect(api.searches().filter((s) => s.term === "hang")).toHaveLength(2);
  });

  describe("downloads", () => {
    const one = (page0: CommonsPage) => answer([page0]);

    it("follows one redirect, to Wikimedia's own hosts only", async () => {
      const ok = page("Old farm.jpg");
      const hop = fakeFetch({
        search: () => one(ok),
        image: (url) => (url.includes("upload.wikimedia.org") ? new Response(null, { status: 302, headers: { location: "https://thumb.wikimedia.org/final.jpg" } }) : img(LANDSCAPE)),
      });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: hop.impl, store: fakeStore().store })).toHaveLength(1);
      expect(hop.images().map((i) => new URL(i.url).hostname)).toEqual(["upload.wikimedia.org", "thumb.wikimedia.org"]);

      const evil = fakeFetch({ search: () => one(ok), image: () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.jpg" } }) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: evil.impl, store: fakeStore().store })).toEqual([]);
      expect(evil.images()).toHaveLength(1); // evil.example was never asked

      const loop = fakeFetch({ search: () => one(ok), image: () => new Response(null, { status: 302, headers: { location: "https://upload.wikimedia.org/again.jpg" } }) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: loop.impl, store: fakeStore().store })).toEqual([]);
      expect(loop.images()).toHaveLength(2); // one hop, not a chain
    });

    it("refuses a file that is not a JPEG or PNG whatever it says it is", async () => {
      const api = fakeFetch({ search: () => one(page("Old farm.jpg")), image: () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "image/jpeg" } }) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
    });

    it("stops a thumbnail that is bigger than 6 MB while it streams, and an unscaled original above 8 MB", async () => {
      const big = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n)]);
      const scaled = fakeFetch({ search: () => one(page("Old farm.jpg")), image: () => img(big(6 * 1024 * 1024 + 10)) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: scaled.impl, store: fakeStore().store })).toEqual([]);

      // declared up front
      const declared = fakeFetch({ search: () => one(page("Old farm.jpg")), image: () => new Response(LANDSCAPE as unknown as BodyInit, { status: 200, headers: { "content-length": String(7 * 1024 * 1024) } }) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: declared.impl, store: fakeStore().store })).toEqual([]);

      // the same body is too big for a scaled thumbnail ...
      const same = Buffer.concat([await jpeg(1600, 1200), Buffer.alloc(7 * 1024 * 1024)]);
      const scaledSame = fakeFetch({ search: () => one(page("Old farm.jpg")), image: () => img(same) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: scaledSame.impl, store: fakeStore().store })).toEqual([]);
      // ... but an unscaled original may be a little bigger than a thumbnail may, up to 8 MB
      const orig = page("Old farm.jpg", { w: 1600, h: 1200, size: 7 * 1024 * 1024, thumb: "https://upload.wikimedia.org/x/Old_farm.jpg?thumbnail_unscaled" });
      // a real picture followed by 7 MB of padding (a decoder ignores what comes after the end of the picture)
      const real = Buffer.concat([await jpeg(1600, 1200), Buffer.alloc(7 * 1024 * 1024)]);
      const okOrig = fakeFetch({ search: () => one(orig), image: () => img(real) });
      expect(real.length).toBeGreaterThan(6 * 1024 * 1024);
      expect(real.length).toBeLessThan(8 * 1024 * 1024);
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: okOrig.impl, store: fakeStore().store })).toHaveLength(1);
      const tooBig = fakeFetch({ search: () => one(orig), image: () => img(big(8 * 1024 * 1024 + 10)) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: tooBig.impl, store: fakeStore().store })).toEqual([]);
    });

    it("never downloads a file the judge refused", async () => {
      const api = fakeFetch({ search: () => answer([page("Old farm.jpg", { meta: { License: "", LicenseShortName: "GFDL" } }), page("Old farm map.jpg", { index: 2 })]) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
      expect(api.images()).toHaveLength(0);
    });

    it("orders hits by the search rank (index), not by the order of the object", async () => {
      const a = page("Old farm first.jpg", { index: 2 });
      const b = page("Old farm second.jpg", { index: 1 });
      const api = fakeFetch({ search: () => answer([a, b]) });
      const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(found[0].credit.title).toBe("File:Old farm second.jpg");
    });
  });

  describe("a search hit that would need an author's name", () => {
    it("is not used when the file names nobody, so that no photograph is shown without its credit", async () => {
      const nameless = page("Old farm.jpg", { meta: { Artist: "Unknown author" } });
      const api = fakeFetch({ search: () => answer([nameless]) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
      expect(api.images()).toHaveLength(0);
    });

    it("is used, and carries the author, when the file names one; a person's picture needs a story about a person", async () => {
      const filed = page("Old farm.jpg", { meta: { Categories: "Old farms|1897 births" } });
      const api = fakeFetch({ search: () => answer([filed]) });
      expect(await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
      const found = await findStoryPhotos({ ...base, subjectIsPerson: true, wanted: [{ scene: 0, queries: ["old farm"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(found[0].credit).toMatchObject({ author: "Jane Doe", attribution: true, licence: "CC BY-SA 4.0" });
    });
  });

  describe("the pictures of the case's own Wikipedia article", () => {
    const subject = "Hinterkaifeck murders";

    it("are looked up first, in one call, and serve the beats before any search: the archival photographs of the real article", async () => {
      const api = fakeFetch({ search: () => answer(null), info: infoOf(ARTICLE_INFO("hinterkaifeck").query.pages) });
      const { store, puts } = fakeStore();
      const found = await findStoryPhotos({
        ...base,
        subject,
        articleImages: ARTICLE("hinterkaifeck").parse.images, // as the page lists them: underscores, no prefix, icons and maps among them
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck"] },
          { scene: 1, queries: ["Hinterkaifeck winter"] },
        ],
        fetchImpl: api.impl,
        store,
      });
      // one call for the seven JPEG and PNG pictures (no icon, no SVG map, no TIFF), with their prefix
      expect(api.infos()).toHaveLength(1);
      const asked = api.infos()[0].titles!;
      expect(asked).toHaveLength(7);
      expect(asked[0]).toBe("File:Hinterkaifeck-Hof (cropped).jpg");
      expect(asked.some((t) => /\.(svg|tif)$/i.test(t))).toBe(false);
      const u = new URL(api.infos()[0].url);
      expect(u.searchParams.get("prop")).toBe("imageinfo");
      expect(u.searchParams.get("iiextmetadatafilter")).toContain("Artist");
      // the two archival photographs of the farm, in the article's order, before any search hit
      expect(found.map((f) => [f.scene, f.credit.title, f.via])).toEqual([
        [0, "File:Hinterkaifeck-Hof (cropped).jpg", "article"],
        [1, "File:Photo - Hinterkaifeck.jpg", "article"],
      ]);
      expect(found[0].credit).toMatchObject({ author: "Andreas Biegleder", licence: "Public domain", attribution: false });
      expect(found[0].credit).not.toHaveProperty("illustrative");
      expect(puts).toHaveLength(2);
      // the beat's phrase "winter" found no sharper file, so the search was asked first and had nothing; the picture came afterwards
      expect(api.searches().map((s) => s.term)).toEqual(["Hinterkaifeck winter"]);
      // the pictures were fetched from the host of the API's thumbnail
      expect(api.images().map((i) => new URL(i.url).hostname)).toEqual(["upload.wikimedia.org", "upload.wikimedia.org"]);
    });

    it("go to the beat they fit, and the beat about the case itself takes what is left (an earlier beat does not rob a later one)", async () => {
      const pool = [pd("Hinterkaifeck winter.jpg", { index: 1 }), pd("Hinterkaifeck memorial cross.jpg", { index: 2 }), pd("Hinterkaifeck farm yard.jpg", { index: 3 })];
      const api = fakeFetch({ search: () => answer(null), info: infoOf(pool) });
      const found = await findStoryPhotos({
        ...base,
        subject,
        articleImages: pool.map((p) => p.title!),
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck"] },
          { scene: 1, queries: ["Hinterkaifeck memorial"] },
          { scene: 2, queries: ["Hinterkaifeck farm"] },
        ],
        fetchImpl: api.impl,
        store: fakeStore().store,
      });
      expect(found.map((f) => [f.scene, f.credit.title])).toEqual([
        [0, "File:Hinterkaifeck winter.jpg"],
        [1, "File:Hinterkaifeck memorial cross.jpg"],
        [2, "File:Hinterkaifeck farm yard.jpg"],
      ]);
      expect(api.searches()).toHaveLength(0);
      expect(api.others()).toHaveLength(0); // the category of the case is not asked when the article covered every beat
    });

    it("are used only for a beat they fit or for the case itself: a picture of something else in the article is not first in line", async () => {
      const pool = [pd("Waterspout over the Florida Keys.jpg", { index: 1, meta: { Categories: "Waterspouts" } }), pd("Mary Celeste at sea.jpg", { index: 2, meta: { Categories: "Mary Celeste (ship, 1861)" } })];
      const run = async (queries: string[], list = pool) => {
        const api = fakeFetch({ search: () => answer(null), info: infoOf(list) });
        const found = await findStoryPhotos({ ...base, subject: "Mary Celeste", articleImages: list.map((p) => p.title!), wanted: [{ scene: 0, queries }], fetchImpl: api.impl, store: fakeStore().store });
        return { found, api };
      };
      // the beat about the case itself takes the picture that names it, not the first one
      expect((await run(["Mary Celeste"])).found.map((f) => f.credit.title)).toEqual(["File:Mary Celeste at sea.jpg"]);
      // the beat that names the waterspout takes the waterspout
      expect((await run(["Mary Celeste waterspout"])).found.map((f) => f.credit.title)).toEqual(["File:Waterspout over the Florida Keys.jpg"]);
      // a beat with its own words that match nothing gets, after its search found nothing, the case's own picture that names the case
      const crew = await run(["Mary Celeste crew"]);
      expect(crew.found.map((f) => f.credit.title)).toEqual(["File:Mary Celeste at sea.jpg"]);
      expect(crew.api.searches().map((s) => s.term)).toEqual(["Mary Celeste crew", "Mary Celeste"]); // (the phrase of three words, once more without its last word)
      // with only the waterspout in the article there is nothing for that beat
      expect((await run(["Mary Celeste crew"], [pool[0]])).found).toEqual([]);
    });

    it("the opening beat picks first: the hook of a case gets the article's lead picture, and the other beat what is left", async () => {
      const pool = [pd("Hinterkaifeck farm view.jpg", { index: 1 }), pd("Hinterkaifeck winter.jpg", { index: 2 })];
      const api = fakeFetch({ search: () => answer(null), info: infoOf(pool) });
      const found = await findStoryPhotos({
        ...base,
        subject,
        articleImages: pool.map((p) => p.title!),
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck"] },
          { scene: 1, queries: ["Hinterkaifeck farm"] },
        ],
        fetchImpl: api.impl,
        store: fakeStore().store,
      });
      // without that rule the second beat would have the farm view by its word and the hook the winter picture
      expect(found.map((f) => [f.scene, f.credit.title])).toEqual([
        [0, "File:Hinterkaifeck farm view.jpg"],
        [1, "File:Hinterkaifeck winter.jpg"],
      ]);
    });

    it("never shows one photograph twice under two titles: an edited copy of a picture that is in use is the same picture", async () => {
      const pool = [pd("Hinterkaifeck farm yard (cropped).jpg", { index: 1 })];
      const again = pd("Hinterkaifeck farm yard.jpg", { index: 1 });
      const api = fakeFetch({ search: () => answer([again]), info: infoOf(pool) });
      const found = await findStoryPhotos({
        ...base,
        subject,
        articleImages: pool.map((p) => p.title!),
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck"] },
          { scene: 1, queries: ["Hinterkaifeck farm"] },
        ],
        fetchImpl: api.impl,
        store: fakeStore().store,
      });
      expect(found.map((f) => [f.scene, f.credit.title])).toEqual([[0, "File:Hinterkaifeck farm yard (cropped).jpg"]]);
      expect(api.images()).toHaveLength(1);
    });

    it("a search hit with the beat's own names is preferred to a spare picture of the article", async () => {
      const pool = [pd("Hinterkaifeck winter.jpg", { index: 1 })];
      const hit = pd("Munich 1922 street scene.jpg", { index: 1, meta: { Categories: "Munich" } });
      const api = fakeFetch({ search: () => answer([hit]), info: infoOf(pool) });
      const found = await findStoryPhotos({ ...base, subject, articleImages: pool.map((p) => p.title!), wanted: [{ scene: 0, queries: ["Munich 1922"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(found.map((f) => [f.credit.title, f.via])).toEqual([["File:Munich 1922 street scene.jpg", "search"]]);
    });

    it("leave the beats they do not cover to the search, and a photograph from the search is marked as illustrative", async () => {
      const pool = [pd("Hinterkaifeck winter.jpg", { index: 1 })];
      const api = fakeFetch({ search: () => answer(hk(2)), info: infoOf(pool) });
      const found = await findStoryPhotos({
        ...base,
        subject,
        articleImages: pool.map((p) => p.title!),
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck"] },
          { scene: 1, queries: ["Hinterkaifeck farm"] },
        ],
        fetchImpl: api.impl,
        store: fakeStore().store,
      });
      const [a, b] = found;
      expect([a.via, a.credit.title]).toEqual(["article", "File:Hinterkaifeck winter.jpg"]);
      expect(a.credit).not.toHaveProperty("illustrative");
      expect(b.via).toBe("search");
      expect(b.credit.illustrative).toBe(true);
    });

    it("are judged like any other photograph: a refused one is never downloaded, and the search takes over", async () => {
      const pool = [
        pd("Hinterkaifeck farm map.jpg", { index: 1 }),
        pd("Hinterkaifeck letter.jpg", { index: 2 }),
        page("Hinterkaifeck unnamed.jpg", { index: 3, meta: { Artist: "Unknown author", Categories: "Hinterkaifeck" } }),
        pd("Hinterkaifeck portrait.jpg", { index: 4 }),
        pd("Hinterkaifeck people.jpg", { index: 5, meta: { Categories: "Hinterkaifeck|1897 births" } }),
      ];
      const api = fakeFetch({ search: () => answer(hk(1)), info: infoOf(pool) });
      const found = await findStoryPhotos({ ...base, subject, articleImages: pool.map((p) => p.title!), wanted: [{ scene: 0, queries: ["Hinterkaifeck"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(api.images()).toHaveLength(1);
      expect(found.map((f) => f.via)).toEqual(["search"]);
    });

    it("are looked up in batches of twenty titles, at most forty of them", async () => {
      const titles = Array.from({ length: 55 }, (_, i) => `Hinterkaifeck picture ${i + 1}.jpg`);
      const api = fakeFetch({ search: () => answer(null), info: () => answer(null) });
      await findStoryPhotos({ ...base, subject, articleImages: titles, wanted: [{ scene: 0, queries: ["Hinterkaifeck"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(api.infos().map((i) => i.titles!.length)).toEqual([20, 20]);
    });

    it("do not stop the stage when their lookup fails: the search goes on", async () => {
      const failing = fakeFetch({ search: () => answer(hk(1)), info: () => new Response("boom", { status: 500 }) });
      const found = await findStoryPhotos({ ...base, subject, articleImages: ["File:Hinterkaifeck-Hof (cropped).jpg"], wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: failing.impl, store: fakeStore().store });
      expect(found.map((f) => f.via)).toEqual(["search"]);
      // a 429 stops everything
      const limited = fakeFetch({ search: () => answer(hk(1)), info: () => new Response("slow down", { status: 429 }) });
      expect(await findStoryPhotos({ ...base, subject, articleImages: ["File:Hinterkaifeck-Hof (cropped).jpg"], wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: limited.impl, store: fakeStore().store })).toEqual([]);
      expect(limited.searches()).toHaveLength(0);
    });

    it("are not asked for when the story has none (an older job, a fiction, Wikipedia unreachable)", async () => {
      const api = fakeFetch({ search: () => answer(hk(1)) });
      await findStoryPhotos({ ...base, subject, articleImages: [], wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store: fakeStore().store });
      await findStoryPhotos({ ...base, subject: null, wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(api.infos()).toHaveLength(0);
    });
  });

  describe("stopping", () => {
    it("does nothing when it is told to stop before it starts", async () => {
      const api = fakeFetch({ search: () => answer(hk(1)) });
      const stop = new AbortController();
      stop.abort();
      expect(await findStoryPhotos({ ...base, signal: stop.signal, wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store: fakeStore().store })).toEqual([]);
      expect(api.impl).not.toHaveBeenCalled();
    });

    it("stops a search that hangs when the signal fires, and stores nothing afterwards", async () => {
      const api = fakeFetch({ search: () => new Promise<Response>(() => undefined) });
      const { store, puts } = fakeStore();
      const stop = new AbortController();
      const started = Date.now();
      const run = findStoryPhotos({ ...base, signal: stop.signal, wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store });
      setTimeout(() => stop.abort(), 30);
      expect(await run).toEqual([]);
      expect(Date.now() - started).toBeLessThan(2_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(puts).toHaveLength(0);
    });

    it("stops when the signal fires during an upload, waits for the upload to finish or give way, and does not hand out that photograph", async () => {
      const api = fakeFetch({ search: () => answer(hk(2)) });
      const stop = new AbortController();
      const landed: string[] = [];
      let seen: AbortSignal | undefined;
      const slow: PhotoStore = async (p, _b, _t, signal) => {
        seen = signal;
        stop.abort(); // the caller gives up while the upload is under way
        await new Promise((r) => setTimeout(r, 120)); // a store that does not look at the signal
        landed.push(p);
        return `https://abc123.public.blob.vercel-storage.com/${p}`;
      };
      const found = await findStoryPhotos({ ...base, signal: stop.signal, wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store: slow });
      expect(found).toEqual([]);
      // the call returned only after the upload was over: nothing is still running behind it
      expect(landed).toHaveLength(1);
      expect(seen?.aborted).toBe(true);
    });

    it("passes the stage's signal to the store, and ends the upload when the budget ends", async () => {
      const api = fakeFetch({ search: () => answer(hk(1)) });
      const { store, puts } = fakeStore();
      const found = await findStoryPhotos({ ...base, wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }], fetchImpl: api.impl, store });
      expect(found).toHaveLength(1);
      expect(puts[0].signal).toBeInstanceOf(AbortSignal);
      // the finder is over: its signal is spent, so a store that is still working would be cut off
      expect(puts[0].signal!.aborted).toBe(true);
    });
  });

  describe("the pool of the subject's category", () => {
    const members = [
      pd("Hinterkaifeck winter 1922.jpg", { index: 1, meta: { Categories: "Hinterkaifeck murders" } }),
      pd("Hinterkaifeck memorial cross.jpg", { index: 2, meta: { Categories: "Hinterkaifeck murders" } }),
    ];
    const category = (params: URLSearchParams) => {
      if (params.get("list") === "search") return new Response(JSON.stringify({ query: { search: [{ title: "Category:Hinterkaifeck" }, { title: "Category:Hinterkaifeck murders" }] } }), { status: 200 });
      if (params.get("generator") === "categorymembers") return answer(members);
      return answer(null);
    };

    it("prefers a file of the subject's category over a full-text search, when the beat's words fit it", async () => {
      const api = fakeFetch({ search: () => answer(null), other: category });
      const found = await findStoryPhotos({ ...base, subject: "Hinterkaifeck murders", wanted: [{ scene: 0, queries: ["Hinterkaifeck memorial"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(found).toHaveLength(1);
      expect(found[0].credit.title).toBe("File:Hinterkaifeck memorial cross.jpg");
      expect(found[0].via).toBe("category");
      expect(found[0].credit).not.toHaveProperty("illustrative");
      expect(api.searches()).toHaveLength(0);
      const members = api.log.find((l) => new URL(l.url).searchParams.get("generator") === "categorymembers")!;
      expect(new URL(members.url).searchParams.get("gcmtitle")).toBe("Category:Hinterkaifeck murders"); // the first category with ALL the subject's words
      expect(new URL(members.url).searchParams.get("gcmtype")).toBe("file");
    });

    it("gives a beat about the case itself a file that names it, and falls back to the search when nothing fits a beat's own words", async () => {
      const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages), other: category });
      const found = await findStoryPhotos({
        ...base,
        subject: "Hinterkaifeck murders",
        wanted: [
          { scene: 0, queries: ["Hinterkaifeck murders"] },
          { scene: 1, queries: ["Zeppelin airship"] },
        ],
        fetchImpl: api.impl,
        store: fakeStore().store,
      });
      expect(found.find((f) => f.scene === 0)).toBeTruthy();
      // 'Zeppelin airship' fits no file of the category: the full-text search is asked (and its hits are off-topic here)
      expect(api.searches().map((s) => s.term)).toEqual(["Zeppelin airship"]);
      expect(found.find((f) => f.scene === 1)).toBeUndefined();
    });

    it("never serves a beat with a file just because it comes first: a pool file needs a shared word, or the beat is the case itself", async () => {
      const api = fakeFetch({ search: () => answer(null), other: category });
      const found = await findStoryPhotos({ ...base, subject: "Hinterkaifeck murders", wanted: [{ scene: 0, queries: ["Hinterkaifeck zeppelin"] }], fetchImpl: api.impl, store: fakeStore().store });
      expect(found).toEqual([]);
    });

    it("is skipped when the budget is short, and when the subject has no category", async () => {
      const short = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages), other: category });
      await findStoryPhotos({ ...base, budgetMs: 7_000, subject: "Hinterkaifeck murders", wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: short.impl, store: fakeStore().store });
      expect(short.others()).toHaveLength(0);

      const none = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages), other: () => new Response(JSON.stringify({ query: { search: [{ title: "Category:Something else" }] } }), { status: 200 }) });
      const found = await findStoryPhotos({ ...base, subject: "Hinterkaifeck murders", wanted: [{ scene: 0, queries: ["Hinterkaifeck Hof"] }], fetchImpl: none.impl, store: fakeStore().store });
      expect(found).toHaveLength(1);
      expect(none.others()).toHaveLength(1); // only the category search
    });
  });
});

describe("probeCommons", () => {
  it("returns the verdict on every hit without downloading anything", async () => {
    const api = fakeFetch({ search: () => answer(HINTERKAIFECK().query.pages) });
    const r = await probeCommons("Hinterkaifeck Hof", api.impl, 1);
    expect(r.outcome).toBe("ok");
    expect(r.userAgent).toMatch(/^GituasVideoBot\/1\.0/);
    expect(r.results).toHaveLength(14);
    expect(r.results.find((x) => x.title === "File:Hinterkaifeck-Hof.jpg")).toMatchObject({ ok: true, why: null, licence: "Public domain", size: "918x716" });
    expect(r.results.find((x) => x.title === "File:Hinterkaifeck-Marterl.jpg")).toMatchObject({ ok: false, why: "licence" });
    expect(api.images()).toHaveLength(0);
  });

  it("says when Wikimedia does not answer", async () => {
    const forbidden = fakeFetch({ search: () => new Response("no UA", { status: 403 }) });
    expect((await probeCommons("Hinterkaifeck Hof", forbidden.impl, 1)).outcome).toBe("failed");
    const limited = fakeFetch({ search: () => new Response("", { status: 429 }) });
    expect((await probeCommons("Hinterkaifeck Hof", limited.impl, 1)).outcome).toBe("stopped");
    const off = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await probeCommons("Hinterkaifeck Hof", off, 1)).outcome).toBe("failed");
    expect((await probeCommons("of the", forbidden.impl, 1)).results).toEqual([]);
  });
});

describe("probeArticle", () => {
  /** A fetch for the two hosts the article probe talks to: English Wikipedia (action=parse) and Commons (image information). */
  function articleFetch(slug: string, o: { parse?: () => Response } = {}) {
    const calls: { host: string; params: URLSearchParams; ua: string | null }[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ host: url.hostname, params: url.searchParams, ua: new Headers(init?.headers).get("user-agent") });
      if (url.hostname === "en.wikipedia.org") return o.parse ? o.parse() : new Response(JSON.stringify(ARTICLE(slug)), { status: 200 });
      const titles = (url.searchParams.get("titles") ?? "").split("|");
      return answer(ARTICLE_INFO(slug).query.pages.filter((p) => titles.includes(p.title!)));
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("lists the pictures of the article in the order of the page with the judge's verdict on each, and says which accepted ones name the case", async () => {
    const api = articleFetch("hinterkaifeck");
    const r = await probeArticle("Hinterkaifeck murders", api.impl, 1);
    expect(r).toMatchObject({ title: "Hinterkaifeck murders", article: "Hinterkaifeck murders", outcome: "ok", listed: 7 });
    expect(r.results.map((x) => [x.title, x.ok, x.why, x.about])).toEqual([
      ["File:Hinterkaifeck-Hof (cropped).jpg", true, null, true],
      ["File:Bavaria relief location map.jpg", false, "deny:map", false],
      ["File:Hinterkaifeck Flurkarte nach 1870.jpg", false, "deny:flurkarte", false],
      ["File:Photo - Hinterkaifeck.jpg", true, null, true],
      ["File:Sterbebildchen der sechs Ermordeten.jpg", false, "sensitive:sterbebildchen", false],
      ["File:Plakat mit Belohnung von 100 000 Mark.jpg", false, "deny:plakat", false],
      ["File:Hinterkaifeck-Marterl.jpg", false, "licence", false],
    ]);
    expect(r.results[0]).toMatchObject({ licence: "Public domain", author: "Andreas Biegleder", size: "918x564" });
    // English Wikipedia is asked with action=parse (the page's order), then Commons, both with the polite User-Agent; nothing is downloaded
    expect(api.calls.map((c) => c.host)).toEqual(["en.wikipedia.org", "commons.wikimedia.org"]);
    expect(api.calls[0].params.get("action")).toBe("parse");
    expect(api.calls[0].params.get("page")).toBe("Hinterkaifeck murders");
    expect(api.calls[0].params.get("redirects")).toBe("1");
    for (const c of api.calls) expect(c.ua).toMatch(/^GituasVideoBot\/1\.0/);
  });

  it("says that nothing in an article passes (Dyatlov Pass)", async () => {
    const r = await probeArticle("Dyatlov Pass incident", articleFetch("dyatlov").impl, 1);
    expect(r.outcome).toBe("ok");
    expect(r.results.filter((x) => x.ok)).toEqual([]);
    expect(r.results.find((x) => /incident 02/.test(x.title))).toMatchObject({ why: "licence-doubt", ok: false });
  });

  it("says when Wikipedia has no such article, answers nothing, or the title is empty", async () => {
    const missing = articleFetch("hinterkaifeck", { parse: () => new Response(JSON.stringify({ error: { code: "missingtitle", info: "no" } }), { status: 200 }) });
    expect(await probeArticle("No such thing", missing.impl, 1)).toMatchObject({ article: null, outcome: "failed", results: [] });
    const limited = articleFetch("hinterkaifeck", { parse: () => new Response("", { status: 429 }) });
    expect((await probeArticle("X", limited.impl, 1)).outcome).toBe("stopped");
    const off = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await probeArticle("X", off, 1)).outcome).toBe("failed");
    const none = articleFetch("hinterkaifeck");
    expect((await probeArticle("   ", none.impl, 1)).outcome).toBe("failed");
    expect(none.impl).not.toHaveBeenCalled();
    // an article with no JPEG or PNG at all
    const icons = articleFetch("hinterkaifeck", { parse: () => new Response(JSON.stringify({ parse: { title: "Icons", images: ["A.svg", "B.gif"] } }), { status: 200 }) });
    expect(await probeArticle("Icons", icons.impl, 1)).toMatchObject({ article: "Icons", outcome: "ok", listed: 2, results: [] });
  });
});

// ---- the wide (16:9) frame, the people and the year of a photograph, cleaning up --------------------------

describe("judge: a story about a crime or a death (people)", () => {
  const farm = (name: string, meta: Record<string, string> = {}) => page(name, { w: 1920, h: 1280, meta: { License: "pd", LicenseShortName: "Public domain", AttributionRequired: "false", Artist: "Anon", Categories: "Hinterkaifeck", ...meta } });
  const why = (p: CommonsPage, opts: Parameters<typeof judge>[2] = {}) => judge(p, null, opts).why;

  it("refuses a file whose text names a family, a wife, children, a boy, a woman, a man ... (it cannot tell a victim from a bystander)", () => {
    for (const text of [
      "The Gruber family in 1919",
      "Andreas and Cazilia, husband and wife",
      "The children of the farm",
      "A boy at the gate",
      "A girl with a goat",
      "A woman in the yard",
      "Two men at the barn",
      "A mother and her son",
      "Die Familie vor dem Hof",
      "Frau und Kinder",
      "Der Mann am Tor",
    ]) {
      expect(why(farm("Farm.jpg", { ImageDescription: text }), { people: true }), text).toMatch(/^people:/);
    }
    // the title and the categories count too
    expect(why(farm("Gruber family.jpg"), { people: true })).toBe("people:family");
    expect(why(farm("Farm.jpg", { Categories: "Families of Germany" }), { people: true })).toBe("people:families");
  });

  it("does not look for them unless asked, and not when the story is about a person", () => {
    const p = farm("Gruber family 1919.jpg", { ImageDescription: "The Gruber family and the children" });
    expect(why(p)).toBeNull();
    expect(why(p, { people: false })).toBeNull();
    expect(why(p, { people: true, allowPeople: true })).toBeNull();
  });

  it("lets a photograph of a place through, whole words only (a farmhand's barn, the Menschenhof)", () => {
    for (const text of ["The farm in winter", "A view of the barn and the road", "Mannheim street in 1920", "Kindergarten building", "The Hinterkaifeck farm"]) {
      expect(why(farm("Farm.jpg", { ImageDescription: text }), { people: true }), text).toBeNull();
    }
  });
});

describe("judge: a modern photograph of an old case (era)", () => {
  const era = { from: 1922, to: 1923 };
  const farm = (name: string, meta: Record<string, string> = {}) => page(name, { w: 1920, h: 1280, meta: { License: "pd", LicenseShortName: "Public domain", AttributionRequired: "false", Artist: "Anon", Categories: "Hinterkaifeck", ...meta } });
  const why = (p: CommonsPage, e: typeof era | null | undefined = era) => judge(p, null, { era: e }).why;

  it("refuses a file whose title, description or date names a year well after the story", () => {
    expect(why(farm("Hinterkaifeck memorial 2019.jpg"))).toBe("modern:2019");
    expect(why(farm("Farm.jpg", { ImageDescription: "Taken in 2008 at the memorial" }))).toBe("modern:2008");
    expect(why(farm("Farm.jpg", { DateTimeOriginal: "2019-05-12 14:03:11" }))).toBe("modern:2019");
    expect(why(farm("Farm.jpg", { ImageDescription: "Built in 1850, photographed 1985, shown again in 2001" }))).toBe("modern:2001");
  });

  it("lets a photograph of the time through, a few years of margin included", () => {
    expect(why(farm("Hinterkaifeck farm 1920.jpg"))).toBeNull();
    expect(why(farm("Farm.jpg", { DateTimeOriginal: "1922-04-01" }))).toBeNull();
    expect(why(farm("Farm.jpg", { ImageDescription: "The farm in 1925" }))).toBeNull();
    expect(why(farm("Farm.jpg", { ImageDescription: "A photograph of 1928" }))).toBeNull();
    expect(why(farm("Farm.jpg", { ImageDescription: "A photograph of 1929" }))).toBe("modern:1929");
  });

  it("checks nothing when the story's years are not known, and ignores a number that is not a year", () => {
    expect(why(farm("Hinterkaifeck memorial 2019.jpg"), null)).toBeNull();
    expect(judge(farm("Hinterkaifeck memorial 2019.jpg"), null, {}).why).toBeNull();
    expect(why(farm("Farm 100 000 Mark 12345.jpg"))).toBeNull();
    expect(why(farm("IMG_20190512.jpg"))).toBeNull();
  });

  it("does not look at the categories (they are maintenance, not the date of the photograph)", () => {
    expect(why(farm("Farm.jpg", { Categories: "Hinterkaifeck|Uploaded in 2019" }))).toBeNull();
  });
});

describe("judge: the author field of a licence that asks for a name", () => {
  const by = (artist: string | undefined, licence = "CC BY-SA 4.0") =>
    judge(page("Farm.jpg", { w: 1920, h: 1280, meta: { LicenseShortName: licence, ...(artist === undefined ? { Artist: "" } : { Artist: artist }) } }), null).why;

  it("refuses a telephone number, an address, a handle or a sentence as the name", () => {
    expect(by("Free gift call +964 750 123 4567 now")).toBe("author-text");
    expect(by("Joe joe@example.com")).toBe("author-text");
    expect(by("one two three four five six seven")).toBe("author-text");
    expect(by("Call 0750 123 4567")).toBe("author-text");
  });

  it("keeps the other refusals as they were: no author at all is still 'no-author', and a real name passes", () => {
    expect(by(undefined)).toBe("no-author");
    expect(by("Andreas Biegleder")).toBeNull();
    expect(by("Bundesarchiv, Bild 183-S12345-0001")).toBeNull();
  });

  it("does not read the author of a public-domain photograph at all (it is never printed)", () => {
    expect(judge(page("Farm.jpg", { w: 1920, h: 1280, meta: { License: "pd", LicenseShortName: "Public domain", AttributionRequired: "false", Artist: "call +964 750 123 4567" } }), null).why).toBeNull();
  });
});

describe("eraOfTexts and crimeLike", () => {
  it("reads the years a script names, in any digits, from the earliest to the latest", () => {
    expect(eraOfTexts(["Bavaria, March 1922", "The trial of 1923", null, 5, "no year here 12345"])).toEqual({ from: 1922, to: 1923 });
    expect(eraOfTexts(["١٩٢٢ و ۱۹۲۳"])).toEqual({ from: 1922, to: 1923 });
    expect(eraOfTexts(["2007 DNA test", "1959 the incident"])).toEqual({ from: 1959, to: 2007 });
  });

  it("gives nothing for a script with no year (and for a number that is not one)", () => {
    expect(eraOfTexts([])).toBeNull();
    expect(eraOfTexts(["Six people. One farm.", "page 123", "a 99999 crowd", "x3000y"])).toBeNull();
  });

  it("knows a story about a crime, a death or a mystery by its words", () => {
    expect(crimeLike(["Hinterkaifeck murders", "farm"])).toBe(true);
    expect(crimeLike(["The Mary Celeste", "mystery of an abandoned ship"])).toBe(true);
    expect(crimeLike(["Six people were killed"])).toBe(true);
    expect(crimeLike(["The Eruption of Vesuvius", "ash over a town"])).toBe(false);
    expect(crimeLike([undefined, 3, null])).toBe(false);
  });
});

describe("composeLandscape and composeFrame: the 1920x1080 frame of a wide story", () => {
  const solid = (w: number, h: number, rgb: [number, number, number]) => jpeg(w, h, rgb);
  const pixel = async (buf: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };

  it("fills the whole frame with a landscape photograph that is sharp enough (a plain cover)", async () => {
    for (const [w, h] of [[1920, 1080], [4000, 2500], [1600, 400], [1280, 800]] as const) {
      const out = await composeLandscape(await solid(w, h, [200, 20, 20]));
      const m = await sharp(out).metadata();
      expect([m.format, m.width, m.height], `${w}x${h}`).toEqual(["jpeg", WIDE_FRAME_W, WIDE_FRAME_H]);
      // a plain cover has the photograph's colour at every edge
      const [r] = await pixel(out, 5, 5);
      expect(r, `${w}x${h}`).toBeGreaterThan(170);
    }
  });

  it("does not blow a small landscape photograph up to fill the frame: it is drawn contained over the blurred copy, enlarged at most 1.6 times", async () => {
    expect(WIDE_SHARP_MIN).toBe(1280);
    for (const [w, h] of [[918, 716], [900, 600], [800, 400], [1200, 900]] as const) {
      const out = await composeLandscape(await solid(w, h, [200, 20, 20]));
      const m = await sharp(out).metadata();
      expect([m.width, m.height], `${w}x${h}`).toEqual([WIDE_FRAME_W, WIDE_FRAME_H]);
      const [centre] = await pixel(out, 960, 540);
      const [edge] = await pixel(out, 5, 540);
      expect(centre, `${w}x${h}`).toBeGreaterThan(170);
      // the side is the darkened, blurred copy, not the photograph
      expect(edge, `${w}x${h}`).toBeLessThan(centre - 40);
      // the photograph's own width on the middle row (its pixels are the bright ones) is its width enlarged at most WIDE_ENLARGE_MAX times
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let bright = 0;
      for (let x = 0; x < info.width; x++) if (data[(540 * info.width + x) * info.channels] > 170) bright++;
      expect(bright, `${w}x${h}`).toBeLessThanOrEqual(Math.round(w * WIDE_ENLARGE_MAX) + 4);
    }
  });

  it("puts a portrait or squarish photograph whole in the middle, over a darkened, blurred copy of itself", async () => {
    for (const [w, h] of [[700, 1000], [1000, 1000], [1000, 1100]] as const) {
      const out = await composeLandscape(await solid(w, h, [200, 20, 20]));
      const m = await sharp(out).metadata();
      expect([m.width, m.height], `${w}x${h}`).toEqual([WIDE_FRAME_W, WIDE_FRAME_H]);
      const [centre] = await pixel(out, 960, 540);
      const [edge] = await pixel(out, 20, 540);
      expect(centre, `${w}x${h}`).toBeGreaterThan(170);
      // the sides are the same colour darkened (brightness 0.55), not the photograph and not black
      expect(edge, `${w}x${h}`).toBeLessThan(centre - 40);
      expect(edge, `${w}x${h}`).toBeGreaterThan(60);
    }
  });

  it("turns a photograph by its EXIF orientation first (a portrait taken sideways is a portrait)", async () => {
    const sideways = await sharp({ create: { width: 1000, height: 700, channels: 3, background: { r: 200, g: 20, b: 20 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await composeLandscape(sideways);
    const [centre] = await pixel(out, 960, 540);
    const [edge] = await pixel(out, 20, 540);
    expect(edge).toBeLessThan(centre - 40);
  });

  it("refuses what is not a picture", async () => {
    await expect(composeLandscape(Buffer.from("not a picture"))).rejects.toThrow();
  });

  it("composeFrame gives the reel's portrait frame by default and the wide frame when asked", async () => {
    const src = await solid(918, 716, [10, 80, 160]);
    const vertical = await sharp(await composeFrame(src)).metadata();
    expect([vertical.width, vertical.height]).toEqual([FRAME_W, FRAME_H]);
    expect([(await sharp(await composeFrame(src, "vertical")).metadata()).width]).toEqual([FRAME_W]);
    const wide = await sharp(await composeFrame(src, "wide")).metadata();
    expect([wide.width, wide.height]).toEqual([WIDE_FRAME_W, WIDE_FRAME_H]);
  });
});

describe("findStoryPhotos for a wide story", () => {
  beforeEach(() => {
    vi.stubEnv("STORY_PHOTOS_ENABLED", "");
    vi.stubEnv("COMMONS_CONTACT", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const wanted = [{ scene: 0, queries: ["Hinterkaifeck farm"] }];

  it("asks Commons for 1920 pixel thumbnails, composes the 1920x1080 frame and stores it", async () => {
    const api = fakeFetch({ search: () => answer(hk(3)) });
    const { store, puts } = fakeStore();
    const found = await findStoryPhotos({ ...base, wanted, format: "wide", fetchImpl: api.impl, store });
    expect(found).toHaveLength(1);
    expect(api.searches().length).toBeGreaterThan(0);
    for (const s of api.searches()) expect(s.url).toContain("iiurlwidth=1920");
    expect(puts).toHaveLength(1);
    const m = await sharp(puts[0].bytes).metadata();
    expect([m.format, m.width, m.height]).toEqual(["jpeg", WIDE_FRAME_W, WIDE_FRAME_H]);
  });

  it("is the reel as it always was when no format is given, or when it is 'vertical': 1280 pixel thumbnails, the portrait frame", async () => {
    for (const format of [undefined, "vertical" as const]) {
      const api = fakeFetch({ search: () => answer(hk(3)) });
      const { store, puts } = fakeStore();
      await findStoryPhotos({ ...base, wanted, ...(format ? { format } : {}), fetchImpl: api.impl, store });
      for (const s of api.searches()) expect(s.url).toContain("iiurlwidth=1280");
      const m = await sharp(puts[0].bytes).metadata();
      expect([m.width, m.height]).toEqual([FRAME_W, FRAME_H]);
    }
  });

  it("asks the pictures of the case's own article the same way (1920 pixels for a wide story)", async () => {
    const api = fakeFetch({ search: () => answer([]), info: infoOf([pd("Hinterkaifeck farm.jpg", { index: 1 })]) });
    const { store } = fakeStore();
    await findStoryPhotos({ ...base, subject: "Hinterkaifeck murders", articleImages: ["File:Hinterkaifeck farm.jpg"], wanted, format: "wide", fetchImpl: api.impl, store });
    expect(api.infos().length).toBeGreaterThan(0);
    for (const i of api.infos()) expect(i.url).toContain("iiurlwidth=1920");
  });

  it("asks for the photographer's date as well (DateTimeOriginal), in either format", async () => {
    const api = fakeFetch({ search: () => answer(hk(1)) });
    await findStoryPhotos({ ...base, wanted, fetchImpl: api.impl, store: fakeStore().store });
    expect(api.searches()[0].url).toContain("DateTimeOriginal");
  });

  it("uses no photograph of people by default (a story about a crime), and uses one when the story is not about a crime", async () => {
    const family = pd("Farm of the Gruber family.jpg", { index: 1 });
    const farm = pd("Hinterkaifeck farm view 2.jpg", { index: 2 });
    const run = async (crime?: boolean) => {
      const { store } = fakeStore();
      return findStoryPhotos({ ...base, wanted, ...(crime === undefined ? {} : { crime }), fetchImpl: fakeFetch({ search: () => answer([family, farm]) }).impl, store });
    };
    expect((await run())[0].credit.title).toBe("File:Hinterkaifeck farm view 2.jpg");
    expect((await run(true))[0].credit.title).toBe("File:Hinterkaifeck farm view 2.jpg");
    expect((await run(false))[0].credit.title).toBe("File:Farm of the Gruber family.jpg");
  });

  it("uses no photograph dated after the story's years, and uses it when the years are not known", async () => {
    const modern = pd("Hinterkaifeck farm memorial 2019.jpg", { index: 1 });
    const old = pd("Hinterkaifeck farm 1920.jpg", { index: 2 });
    const run = async (era?: { from: number; to: number } | null) => {
      const { store } = fakeStore();
      return findStoryPhotos({ ...base, wanted, ...(era === undefined ? {} : { era }), fetchImpl: fakeFetch({ search: () => answer([modern, old]) }).impl, store });
    };
    expect((await run({ from: 1922, to: 1923 }))[0].credit.title).toBe("File:Hinterkaifeck farm 1920.jpg");
    expect((await run())[0].credit.title).toBe("File:Hinterkaifeck farm memorial 2019.jpg");
    expect((await run(null))[0].credit.title).toBe("File:Hinterkaifeck farm memorial 2019.jpg");
  });

  it("marks a photograph found by a search as illustrative, and one from the case's own article as not", async () => {
    const own = pd("Hinterkaifeck farm.jpg", { index: 1, meta: { Categories: "Hinterkaifeck murders" } });
    const api = fakeFetch({ search: () => answer(hk(3)), info: infoOf([own]) });
    const { store } = fakeStore();
    const found = await findStoryPhotos({
      ...base,
      subject: "Hinterkaifeck murders",
      articleImages: ["File:Hinterkaifeck farm.jpg"],
      wanted: [{ scene: 0, queries: ["Hinterkaifeck farm"] }, { scene: 1, queries: ["Hinterkaifeck farm view"] }],
      fetchImpl: api.impl,
      store,
    });
    const by = new Map(found.map((f) => [f.scene, f]));
    expect(by.get(0)!.via).toBe("article");
    expect(by.get(0)!.credit).not.toHaveProperty("illustrative");
    expect(by.get(1)!.via).toBe("search");
    expect(by.get(1)!.credit.illustrative).toBe(true);
  });
});

describe("probes for a wide story", () => {
  it("probeCommons asks for 1920 pixel thumbnails when the format is wide, and 1280 otherwise", async () => {
    const urls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return answer([]);
    }) as unknown as typeof fetch;
    await probeCommons("Hinterkaifeck farm", impl, 1, "wide");
    await probeCommons("Hinterkaifeck farm", impl, 1);
    expect(urls[0]).toContain("iiurlwidth=1920");
    expect(urls[1]).toContain("iiurlwidth=1280");
  });
});

describe("deletePhotos and isOwnPhotoUrl", () => {
  const own = (n: number) => `https://abc123.public.blob.vercel-storage.com/merchant/t1/advideo/j1/img-${n}-k3x9ab-1.jpg`;

  it("knows our own stored story photographs and nothing else", () => {
    expect(isOwnPhotoUrl(own(0))).toBe(true);
    for (const bad of [
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Farm.jpg",
      "https://abc123.public.blob.vercel-storage.com/merchant/t1/advideo/j1/ad.mp4",
      "https://abc123.public.blob.vercel-storage.com/merchant/t1/advideo/j1/vo-0.mp3",
      "https://abc123.public.blob.vercel-storage.com/merchant/t1/products/img-0.jpg",
      "http://abc123.public.blob.vercel-storage.com/merchant/t1/advideo/j1/img-0-k.jpg",
      "https://evil.example/merchant/t1/advideo/j1/img-0-k.jpg",
      "https://abc123.public.blob.vercel-storage.com/merchant/t1/advideo/j1/img-0-k.jpg?x=1",
      "https://abc123.public.blob.vercel-storage.com/merchant/../advideo/j1/img-0-k.jpg",
      "",
      null,
      5,
    ]) {
      expect(isOwnPhotoUrl(bad), String(bad)).toBe(false);
    }
  });

  it("deletes the given photographs once each, and only our own", async () => {
    const remove = vi.fn(async () => undefined);
    await deletePhotos([own(0), own(0), own(1), "https://upload.wikimedia.org/x.jpg", 3, null], remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([own(0), own(1)]);
  });

  it("asks for nothing when there is nothing of ours to delete", async () => {
    const remove = vi.fn(async () => undefined);
    await deletePhotos([], remove);
    await deletePhotos(["https://upload.wikimedia.org/x.jpg"], remove);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never throws, and never waits for ever", async () => {
    await expect(deletePhotos([own(0)], async () => Promise.reject(new Error("blob is down")))).resolves.toBeUndefined();
    await expect(deletePhotos([own(0)], () => {
      throw new Error("sync failure");
    })).resolves.toBeUndefined();
    const started = Date.now();
    await deletePhotos([own(0)], () => new Promise(() => undefined), 30);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("judge on the captured answer of the real API for a wide story (Hinterkaifeck, 1920 pixel thumbnails, with the photographer's date)", () => {
  // Captured 2026-10-21 from commons.wikimedia.org with iiurlwidth=1920 and DateTimeOriginal in the metadata filter.
  const pages = () => fixture("wide-info-hinterkaifeck.json").query.pages;
  const byTitle = (title: string): CommonsPage => pages().find((p) => p.title === title)!;
  const era = { from: 1922, to: 1923 };

  it("reads the real date field of a photograph of the time and accepts it", () => {
    const farm = byTitle("File:Hinterkaifeck-Hof (cropped).jpg");
    expect(judge(farm, null, { lenient: true, era, people: true }).why).toBeNull();
    // the same photograph is refused by a story that ends long before it (the date is read through the markup of the field)
    expect(judge(farm, null, { lenient: true, era: { from: 1900, to: 1905 } }).why).toBe("modern:1922");
  });

  it("serves the original (unscaled) when it is smaller than the 1920 pixels asked for, and reports its real size", () => {
    const farm = byTitle("File:Hinterkaifeck-Hof (cropped).jpg");
    const j = judge(farm, null, { lenient: true });
    expect([j.w, j.h]).toEqual([918, 564]);
    expect(j.candidate!.unscaled).toBe(true);
  });

  it("a modern photograph of the memorial carries its date (2007) and a licence of its own", () => {
    const memorial = byTitle("File:Hinterkaifeck-Marterl.jpg");
    const md = (memorial.imageinfo![0].extmetadata ?? {}) as Record<string, { value?: unknown }>;
    expect(String(md.DateTimeOriginal?.value)).toContain("2007");
    // refused first for its licence ("Copyrighted free use"); with a free licence it would be refused for its year
    expect(judge(memorial, null, { lenient: true, era }).why).toBe("licence");
    const freed = {
      ...memorial,
      imageinfo: [
        {
          ...memorial.imageinfo![0],
          extmetadata: { ...memorial.imageinfo![0].extmetadata, License: { value: "pd" }, LicenseShortName: { value: "Public domain" }, ImageDescription: { value: "A memorial" }, Categories: { value: "Hinterkaifeck" } },
        },
      ],
    };
    expect(judge(freed as CommonsPage, null, { lenient: true, era }).why).toBe("modern:2007");
    // the story's own years are what counts: for a story about 2007 it is a photograph of the time
    expect(judge(freed as CommonsPage, null, { lenient: true, era: { from: 2006, to: 2008 } }).why).toBeNull();
  });

  it("lets the photographer's date decide alone when the file gives one: an old photograph that quotes a modern year in its text is still old", () => {
    const farm = byTitle("File:Hinterkaifeck-Hof (cropped).jpg");
    const talky = { ...farm, imageinfo: [{ ...farm.imageinfo![0], extmetadata: { ...farm.imageinfo![0].extmetadata, ImageDescription: { value: "View from the south, republished in the book of 2007" } } }] };
    expect(judge(talky as CommonsPage, null, { lenient: true, era }).why).toBeNull();
    // with no date at all the title and the description are what is read
    const undated = { ...talky, imageinfo: [{ ...talky.imageinfo![0], extmetadata: { ...talky.imageinfo![0].extmetadata, DateTimeOriginal: { value: "-" } } }] };
    expect(judge(undated as CommonsPage, null, { lenient: true, era }).why).toBe("modern:2007");
  });
});

// ---- builder P: the credits of the photographs, the people and remains they must not show, recent cases, the wide frame ---------------

describe("judge: every credit's author is cleaned when it is stored, whatever the licence", () => {
  const pdPage = (artist: string) => pd("Farm.jpg", { meta: { Artist: artist } });
  const credited = (artist: string) => judge(pdPage(artist), null);

  it("drops an e-mail address, a telephone number and a bare web address from a public domain photograph's author (it is shown in the job's list and the copied caption)", () => {
    for (const bad of ["john.doe@example.com", "Call +49 170 1234567", "https://evil.example/x", "www.evil.example"]) {
      const j = credited(bad);
      expect(j.why, bad).toBeNull();
      expect(j.author, bad).toBeNull();
      expect(j.candidate!.credit.author, bad).toBeNull();
    }
  });

  it("keeps a real name, and cleans an address out of a name", () => {
    expect(credited("Andreas Biegleder").candidate!.credit.author).toBe("Andreas Biegleder");
    expect(credited("Name – www.example.org").candidate!.credit.author).toBe("Name");
    expect(credited("Bundesarchiv, Bild 183-S12345-0001").candidate!.credit.author).toBe("Bundesarchiv, Bild 183-S12345-0001");
  });

  it("refuses a licence that asks for a name when the name is only a web address", () => {
    const by = (artist: string) => judge(page("Farm.jpg", { w: 1920, h: 1280, meta: { LicenseShortName: "CC BY-SA 4.0", Artist: artist } }), null).why;
    expect(by("https://evil.example/x")).toBe("author-text");
    expect(by("Name – www.example.org")).toBeNull();
  });
});

describe("judge: an author the card cannot draw (round 3, credits on the closing scene)", () => {
  const by = (artist: string, licence = "CC BY-SA 4.0") => judge(page("Farm.jpg", { w: 1920, h: 1280, meta: { LicenseShortName: licence, Artist: artist } }), null);

  it("refuses a licence that asks for a name when the name is in letters the card has no font for (Chinese, Japanese, Korean, Hebrew, Thai, Devanagari, emoji)", () => {
    for (const name of ["山田太郎", "田中 一郎", "김민수", "ישראל כהן", "สมชาย", "राम कुमार", "Photo 📷 Man"]) expect(by(name).why, name).toBe("author-script");
  });

  it("lets Latin, Cyrillic, Greek and Arabic-script names through (Sorani, Persian and Urdu letters too)", () => {
    for (const name of ["Fritz Müller-Lüdenscheid", "Łukasz Żółć", "Nguyễn Văn Ánh", "Иван Петров", "Γιώργος Παπαδόπουλος", "أحمد الراشد", "ئاسۆ کەریم", "علی رضایی", "Ahmad Al-Rashid أحمد"]) expect(by(name).why, name).toBeNull();
  });

  it("does not mind for a licence that names nobody (a public domain author is not drawn on the card)", () => {
    const pdBy = (artist: string) => judge(pd("Farm.jpg", { meta: { Artist: artist } }), null);
    expect(pdBy("山田太郎").why).toBeNull();
    expect(pdBy("山田太郎").candidate!.credit.author).toBe("山田太郎");
  });
});

describe("judge: remains of the dead and groups of people (round 3)", () => {
  const farm = (name: string, meta: Record<string, string> = {}) => pd(name, { meta: { Categories: "Hinterkaifeck", ...meta } });
  const why = (p: CommonsPage, opts: Parameters<typeof judge>[2] = {}) => judge(p, null, opts).why;

  it("refuses a skull, a skeleton, remains, an exhumation, a morgue, a death mask, a bust and a facial reconstruction, in English and German", () => {
    for (const name of [
      "Skull of the Isdal remains.jpg",
      "Skeleton found in the cellar.jpg",
      "Somerton death mask cast.jpg",
      "Exhumation of remains 1992.jpg",
      "Morgue Adelaide 1948.jpg",
      "Mortuary of the hospital.jpg",
      "Bust of the unknown man.jpg",
      "Facial reconstruction of the woman.jpg",
      "Schädel aus dem Brunnen.jpg",
      "Skelett im Keller.jpg",
      "Rekonstruktion des Gesichts.jpg",
      "Totenmaske.jpg",
      "Büste des Besitzers.jpg",
      "Gebeine im Sarg.jpg",
    ]) {
      expect(why(farm(name)), name).toMatch(/^sensitive:/);
    }
    // in the description and the categories too
    expect(why(farm("Farm.jpg", { ImageDescription: "Exhumation of the remains" }))).toMatch(/^sensitive:/);
    expect(why(farm("Farm.jpg", { Categories: "Hinterkaifeck|Human skulls" }))).toMatch(/^sensitive:/);
  });

  it("does not refuse a place only because a word looks alike", () => {
    for (const name of ["The remainder of the road.jpg", "Sargent Street.jpg", "Bustling market.jpg", "Reconstruct.jpg", "Farm ruins.jpg", "Skullcap hill.jpg"]) {
      expect(why(farm(name)), name).toBeNull();
    }
  });

  it("refuses groups of people (hikers, a crew, passengers, students, a group) in a story about a crime or a death", () => {
    for (const text of [
      "Dyatlov group before the hike",
      "The hikers of the group",
      "The crew on deck",
      "Passengers waiting at the quay",
      "Students at the school",
      "A search party in the forest",
      "Die Gruppe vor dem Hof",
      "Wanderer im Wald",
      "Die Besatzung an Bord",
    ]) {
      expect(why(farm("Farm.jpg", { ImageDescription: text }), { people: true }), text).toMatch(/^people:/);
      // not looked for unless asked
      expect(why(farm("Farm.jpg", { ImageDescription: text })), `${text} (not a crime)`).toBeNull();
    }
    expect(why(farm("Dyatlov group before the hike.jpg", { ImageDescription: "The hikers of the group" }), { people: true })).toMatch(/^people:/);
  });
});

describe("judge: a recent case (people in it may be alive)", () => {
  const farm = (name: string, meta: Record<string, string> = {}) => pd(name, { meta: { Categories: "Hinterkaifeck", ...meta } });
  const why = (p: CommonsPage, opts: Parameters<typeof judge>[2] = {}) => judge(p, null, opts).why;

  it("refuses a file that names people even when the story is about a person and the crime flag is off", () => {
    const p = farm("Farm.jpg", { ImageDescription: "The family at the gate" });
    expect(why(p, { allowPeople: true, people: true })).toBeNull();
    expect(why(p, { recent: true })).toBe("people:family");
    expect(why(p, { recent: true, allowPeople: true })).toBe("people:family");
  });

  it("refuses a birth, death or 'People of' category and a person named with a title", () => {
    expect(why(farm("Farm.jpg", { Categories: "Hinterkaifeck|1960 births" }), { allowPeople: true })).toBeNull();
    expect(why(farm("Farm.jpg", { Categories: "Hinterkaifeck|1960 births" }), { allowPeople: true, recent: true })).toBe("person");
    for (const text of ["Dr. Müller at the memorial", "President Obama visiting", "Detective Smith", "Herr Meier vor dem Haus"]) {
      expect(why(farm("Farm.jpg", { ImageDescription: text }), { recent: true }), text).toMatch(/^people:/);
    }
  });

  it("lets a photograph of a place through", () => {
    expect(why(farm("The farm in winter.jpg", { ImageDescription: "A view of the barn and the road" }), { recent: true })).toBeNull();
  });
});

describe("judge: the shape of a photograph in the wide frame", () => {
  it("wants a wide frame's photograph to be less thin than a vertical one may be: a tall photograph is a narrow strip there", () => {
    const tall = page("Farm.jpg", { w: 1200, h: 2200, thumb: "https://upload.wikimedia.org/x/Farm.jpg?thumbnail_unscaled" }); // 0.545
    expect(judge(tall, null, {}).why).toBeNull();
    expect(judge(tall, null, { format: "vertical" }).why).toBeNull();
    expect(judge(tall, null, { format: "wide" }).why).toBe("aspect");
    expect(judge(tall, null, { format: "wide", lenient: true }).why).toBe("aspect");
    // a squarish or landscape photograph is the same in both
    const wide = page("Farm.jpg", { w: 1920, h: 1280 });
    expect(judge(wide, null, { format: "wide" }).why).toBeNull();
    expect(judge(page("Farm.jpg", { w: 1000, h: 1300 }), null, { format: "wide" }).why).toBeNull();
  });
});

describe("findStoryPhotos: a recent case, and the photographs as they are stored", () => {
  beforeEach(() => {
    vi.stubEnv("STORY_PHOTOS_ENABLED", "");
    vi.stubEnv("COMMONS_CONTACT", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const wanted = [
    { scene: 0, queries: ["Hinterkaifeck farm"] },
    { scene: 1, queries: ["Hinterkaifeck farm"] },
  ];

  it("makes no search for a recent case: only the case's own pictures are judged", async () => {
    const api = fakeFetch({ search: () => answer(hk(3)) });
    const { store } = fakeStore();
    const found = await findStoryPhotos({ ...base, wanted, crime: false, recent: true, fetchImpl: api.impl, store });
    expect(found).toEqual([]);
    expect(api.searches()).toHaveLength(0);
    // the same request for a case that is not recent searches
    const normal = fakeFetch({ search: () => answer(hk(3)) });
    const got = await findStoryPhotos({ ...base, wanted, crime: false, fetchImpl: normal.impl, store: fakeStore().store });
    expect(got.length).toBeGreaterThan(0);
    expect(normal.searches().length).toBeGreaterThan(0);
  });

  it("refuses the case's own picture that names people for a recent case, and uses it for one that is not recent", async () => {
    const pages = [pd("Hinterkaifeck farm.jpg", { index: 1 }), pd("Hinterkaifeck family.jpg", { index: 2, meta: { ImageDescription: "The family at the farm" } })];
    const articleImages = pages.map((p) => p.title!);
    const run = async (extra: { recent?: boolean }) => {
      const api = fakeFetch({ search: () => answer(null), info: infoOf(pages) });
      return findStoryPhotos({ ...base, subject: "Hinterkaifeck murders", articleImages, wanted: [{ scene: 0, queries: ["Hinterkaifeck"] }, { scene: 1, queries: ["Hinterkaifeck"] }], crime: false, ...extra, fetchImpl: api.impl, store: fakeStore().store });
    };
    expect((await run({})).map((f) => f.credit.title).sort()).toEqual(["File:Hinterkaifeck family.jpg", "File:Hinterkaifeck farm.jpg"]);
    expect((await run({ recent: true })).map((f) => f.credit.title)).toEqual(["File:Hinterkaifeck farm.jpg"]);
  });

  it("tells the caller about each photograph as it is stored, before the finder is done (so a cut-off function still knows what was stored)", async () => {
    const api = fakeFetch({ search: () => answer(hk(4)) });
    const { store } = fakeStore();
    const seen: { scene: number; url: string; done: boolean }[] = [];
    let finished = false;
    const result = findStoryPhotos({ ...base, wanted, fetchImpl: api.impl, store, onPhoto: (p) => void seen.push({ scene: p.scene, url: p.url, done: finished }) }).finally(() => {
      finished = true;
    });
    const found = await result;
    expect(seen.map((s) => s.scene).sort()).toEqual([0, 1]);
    expect(seen.every((s) => !s.done)).toBe(true);
    expect(seen.map((s) => s.url).sort()).toEqual(found.map((f) => f.url).sort());
  });

  it("never lets an error in that callback harm the stage", async () => {
    const api = fakeFetch({ search: () => answer(hk(4)) });
    const found = await findStoryPhotos({
      ...base,
      wanted,
      fetchImpl: api.impl,
      store: fakeStore().store,
      onPhoto: () => {
        throw new Error("boom");
      },
    });
    expect(found).toHaveLength(2);
  });
});

describe("composeLandscape: a small photograph is not blown up", () => {
  it("keeps the frame's size, whatever the shape", async () => {
    for (const [w, h] of [[640, 480], [900, 1200], [1100, 400]] as const) {
      const out = await composeLandscape(await jpeg(w, h, [10, 200, 10]));
      const m = await sharp(out).metadata();
      expect([m.width, m.height], `${w}x${h}`).toEqual([WIDE_FRAME_W, WIDE_FRAME_H]);
    }
  });
});
