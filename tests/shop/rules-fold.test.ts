import { describe, expect, it } from "vitest";

import { asciiDigits, fold, isEmojiToken, scriptsOf, skeletonLength, tokens } from "@/lib/shop/rules/fold";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

describe("fold: one spelling for the letters keyboards confuse", () => {
  it("writes a Sorani word typed on a Kurdish or an Arabic keyboard the same way", () => {
    expect(fold("چەندە")).toBe(fold("چهنده"));
    expect(fold("نرخی چەندە")).toBe(fold("نرخي چهنده"));
    expect(fold("بكم")).toBe(fold("بکم"));
    expect(fold("زانیاری")).toBe(fold("زانياري"));
  });

  it("treats Arabic yeh, alef maksura, Farsi yeh and the Kurdish e as one letter", () => {
    const forms = [cp(0x64a), cp(0x649), cp(0x6cc), cp(0x6ce)].map((y) => fold(`ب${y}ن`));
    expect(new Set(forms).size).toBe(1);
  });

  it("treats Arabic kaf, Farsi kaf and gaf as one letter", () => {
    expect(fold(`${cp(0x643)}ار`)).toBe(fold(`${cp(0x6a9)}ار`));
    expect(fold(`${cp(0x6af)}ار`)).toBe(fold(`${cp(0x6a9)}ار`));
  });

  it("treats every heh as one letter (teh marbuta, Kurdish e, heh goal)", () => {
    expect(fold(`مدرس${cp(0x629)}`)).toBe(fold(`مدرس${cp(0x647)}`));
    expect(fold(`مدرس${cp(0x6d5)}`)).toBe(fold(`مدرس${cp(0x647)}`));
    expect(fold(`مدرس${cp(0x6c1)}`)).toBe(fold(`مدرس${cp(0x647)}`));
  });

  it("folds the Kurdish-only letters into the Arabic ones a keyboard has", () => {
    expect(fold(cp(0x695, 0x6cc))).toBe(fold(cp(0x631, 0x6cc))); // rolled r
    expect(fold(cp(0x6b5, 0x627))).toBe(fold(cp(0x644, 0x627))); // dark l
    expect(fold(cp(0x6c6, 0x631))).toBe(fold(cp(0x648, 0x631))); // o
    expect(fold(cp(0x6a4, 0x627))).toBe(fold(cp(0x641, 0x627))); // v
    expect(fold(cp(0x67e, 0x627))).toBe(fold(cp(0x628, 0x627))); // peh typed as beh
    expect(fold(cp(0x686, 0x627))).toBe(fold(cp(0x62c, 0x627))); // tcheh typed as jeem
    expect(fold(cp(0x698, 0x627))).toBe(fold(cp(0x632, 0x627))); // jeh typed as zain
  });

  it("folds the hamza seats of alef, and drops the hamza itself", () => {
    expect(fold(`${cp(0x623)}كثر`)).toBe(fold("اكثر"));
    expect(fold(`${cp(0x625)}سم`)).toBe(fold("اسم"));
    expect(fold(`${cp(0x622)}مين`)).toBe(fold("امين"));
    // the Kurdish glottal stop is optional in how people type it: "ئەمە" and "ەمە" are the same word here
    expect(fold("ئەمە")).toBe(fold("ەمە"));
    expect(fold("ئەمە")).toBe(fold("همه"));
  });

  it("drops marks, tatweel, zero-width and bidi characters", () => {
    expect(fold("مَرْحَبًا")).toBe(fold("مرحبا"));
    expect(fold(`مرحـــبا`)).toBe(fold("مرحبا"));
    expect(fold(`چەن${cp(0x200c)}دە`)).toBe(fold("چەندە"));
    expect(fold(`${cp(0x200f)}info${cp(0x200b)}`)).toBe("info");
    expect(fold(`${cp(0x202e)}info${cp(0x202c)}`)).toBe("info");
    expect(fold(`in${cp(0xad)}fo`)).toBe("info");
  });

  it("drops the Arabic article of a long word, and only of a long word", () => {
    expect(fold("العنوان")).toBe(fold("عنوان"));
    expect(fold("التوصيل")).toBe(fold("توصيل"));
    expect(fold("السعر كم")).toBe(fold("سعر كم"));
    // too short to lose two letters: the word stays as it is
    expect(fold("الان")).not.toBe(fold("ان"));
    expect(fold("الله")).toMatch(/^ال/);
  });

  it("turns the compatibility forms of Arabic letters into ordinary ones", () => {
    // isolated/initial/final presentation forms of the letters of "info" in Arabic and a full-width Latin word
    expect(fold(cp(0xff49, 0xff4e, 0xff46, 0xff4f))).toBe("info");
    expect(fold(cp(0xfee3, 0xfeca, 0xfedf, 0xfee6))).toBe(fold("معلن"));
  });
});

describe("fold: digits, Latin and punctuation", () => {
  it("writes digits of every script as 0-9", () => {
    expect(fold("٥٠٠٠")).toBe("5000");
    expect(fold("۵۰۰۰")).toBe("5000");
    expect(fold("５０００")).toBe("5000");
    expect(asciiDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789 0123456789");
    expect(fold("5,000 دینار")).toMatch(/^5000 /);
    expect(fold("٥٬٠٠٠")).toBe("5000");
  });

  it("does not collapse repeated digits (5000 stays 5000)", () => {
    expect(fold("5000")).toBe("5000");
    expect(fold("1000000")).toBe("1000000");
  });

  it("folds Latin Kurdish spellings: accents, ch/sh/kh/gh", () => {
    expect(fold("Çende")).toBe("cende");
    expect(fold("chende")).toBe("cende");
    expect(fold("Çende")).toBe(fold("chende"));
    expect(fold("şop")).toBe(fold("shop"));
    expect(fold("xêr")).toBe(fold("khêr"));
    expect(fold("xêr")).toBe("xer");
    expect(fold("pêzanîn")).toBe(fold("pezanin"));
    expect(fold("rojbaş")).toBe(fold("rojbash"));
    expect(fold("İstanbul")).toBe(fold("istanbul"));
  });

  it("writes a letter that is held down once", () => {
    expect(fold("zaaaanyari")).toBe("zanyari");
    expect(fold("infooooo")).toBe("info");
    expect(fold("شششكد")).toBe(fold("شكد"));
  });

  it("does not bridge dialects: a different vowel is a different word", () => {
    expect(fold("zanyari")).not.toBe(fold("zaniari"));
    expect(fold("chende")).not.toBe(fold("chanda"));
  });

  it("makes punctuation a space, the Arabic question mark and comma included", () => {
    expect(fold("چەندە؟")).toBe(fold("چەندە"));
    expect(fold("نرخ، گەیاندن؛ ناونیشان")).toBe(fold("نرخ گەیاندن ناونیشان"));
    expect(tokens(fold("price?!...info"))).toEqual(["price", "info"]);
    expect(fold("«معلومات»")).toBe(fold("معلومات"));
    expect(fold("@aram_k hello")).toBe("aram k helo"); // the double l is written once, on both sides of every comparison
  });

  it("joins an apostrophe inside a word", () => {
    expect(fold("don't")).toBe("dont");
    expect(fold("don’t")).toBe("dont");
  });

  it("gives every emoji its own token and drops skin tones and variation selectors", () => {
    expect(fold("جوانە😍😍")).toBe(`${fold("جوانە")} 😍 😍`);
    expect(tokens(fold("🔥🙏🏽"))).toEqual(["🔥", "🙏"]);
    expect(fold("❤️")).toBe("❤");
    expect(isEmojiToken("😍")).toBe(true);
    expect(isEmojiToken("info")).toBe(false);
  });

  it("splits Arabic-script words into tokens without \\b", () => {
    expect(tokens(fold("معلومات؟ لطفا"))).toHaveLength(2);
    expect(tokens(fold(""))).toEqual([]);
    expect(fold("  \n\t ")).toBe("");
    expect(fold("???")).toBe("");
  });

  it("reads only the first few thousand characters of a long text", () => {
    const long = "info ".repeat(100_000);
    expect(fold(long).length).toBeLessThan(6_000);
  });
});

describe("fold helpers", () => {
  it("counts the letters and digits of a keyword", () => {
    expect(skeletonLength(fold("نرخ"))).toBe(3);
    expect(skeletonLength(fold("how much"))).toBe(6); // "much" folds to "muc"
    expect(skeletonLength(fold("😍"))).toBe(0);
    expect(skeletonLength(fold("5000"))).toBe(4);
  });

  it("tells which script a text is in and whether it has Kurdish-only letters", () => {
    expect(scriptsOf("info")).toEqual({ arabic: false, latin: true, kurdishLetters: false });
    expect(scriptsOf("معلومات")).toEqual({ arabic: true, latin: false, kurdishLetters: false });
    expect(scriptsOf("چەندە")).toMatchObject({ arabic: true, kurdishLetters: true });
    expect(scriptsOf("5000 😍")).toEqual({ arabic: false, latin: false, kurdishLetters: false });
  });
});
