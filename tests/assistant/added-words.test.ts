import { describe, expect, it } from "vitest";

import { addedWords } from "@/lib/assistant/added-words";

// The words a model adds to a story idea that the owner never said: a country, a people, an era, a year. The check compares the idea with the
// owner's own words in any of the three languages; it judges nothing it cannot read and never mistakes one word for another.

describe("addedWords", () => {
  it("finds the real log's addition: the owner said 'historical mystery stories, crime', the idea said 'Egyptian'", () => {
    const owner = "a video for my YouTube mystery-history channel, one of the historical mystery stories, crime genre";
    expect(addedWords("A historical Egyptian crime mystery", owner)).toEqual(["Egypt"]);
    expect(addedWords("A mystery of the pharaohs", owner)).toEqual(["Egypt"]);
    // The same in Sorani: the owner wrote the topic in his language, the idea came back with a country.
    expect(addedWords("A mystery in Egypt", "یەکێک لە چیرۆکە نهێنییە مێژووییەکان، ژانری تاوان")).toEqual(["Egypt"]);
  });

  it("lists each thing added once, by its English name, and each year", () => {
    expect(addedWords("A Roman and Greek tragedy in 1922 and 1923", "a tragedy")).toEqual(["Rome", "Greece", "1922", "1923"]);
    // A word the owner used for the same thing is not an addition: the owner said "knight", so the Middle Ages are theirs.
    expect(addedWords("A medieval knight in Victorian London", "a story about a knight")).toEqual(["the Victorian era", "Britain"]);
  });

  it("finds a year in any digits and a decade as its year", () => {
    expect(addedWords("a crime from 1922", "a crime story")).toEqual(["1922"]);
    expect(addedWords("جريمة سنة ١٩٢٢", "قصة جريمة")).toEqual(["1922"]);
    expect(addedWords("a crime from the 1920s", "a crime story")).toEqual(["1920"]);
    expect(addedWords("a crime in 2019", "a crime story")).toEqual(["2019"]);
    // A number that is not a year is nothing.
    expect(addedWords("six victims in 12 days, page 300", "a crime story")).toEqual([]);
    expect(addedWords("a crime in 3022", "a crime story")).toEqual([]);
  });

  it("allows what the owner said, in whatever language they said it", () => {
    expect(addedWords("An Egyptian mystery", "a story about Egypt")).toEqual([]);
    expect(addedWords("An Egyptian mystery", "قصة غموض في مصر")).toEqual([]);
    expect(addedWords("An Egyptian mystery", "چیرۆکێکی نهێنی لە میسر")).toEqual([]);
    expect(addedWords("جريمة في مصر", "a story about the pharaohs")).toEqual([]);
    expect(addedWords("Hinterkaifeck murders 1922", "the Hinterkaifeck murders, 1922")).toEqual([]);
    expect(addedWords("Hinterkaifeck murders 1922", "جريمة هينتركايفك ١٩٢٢")).toEqual([]);
  });

  it("reads Arabic words with their ending and their article: 'المصرية' is Egypt, 'رومانسية' is not Rome", () => {
    expect(addedWords("القصة المصرية", "قصة")).toEqual(["Egypt"]);
    expect(addedWords("الحضارة الفرعونية", "قصة")).toEqual(["Egypt"]);
    expect(addedWords("قصة رومانسية", "قصة")).toEqual([]);
    expect(addedWords("المدينة الرومانية", "قصة")).toEqual(["Rome"]);
    expect(addedWords("في روما القديمة", "قصة")).toEqual(["Rome"]);
    expect(addedWords("العصور الوسطى", "قصة")).toEqual(["the Middle Ages"]);
  });

  it("reads Sorani words with their endings and spellings: 'میسرەکان', 'ڕۆمای', 'عوسمانی'", () => {
    expect(addedWords("a mystery", "چیرۆکێک دەربارەی میسرەکان")).toEqual([]);
    expect(addedWords("چیرۆکی میسرەکان", "چیرۆکێک")).toEqual(["Egypt"]);
    expect(addedWords("کۆشکی عوسمانی", "کۆشکێک")).toEqual(["the Ottoman era"]);
    expect(addedWords("a story", "چیرۆکێکی نهێنی ڕۆمای کۆن")).toEqual([]);
    expect(addedWords("لە ڕۆمای کۆن", "چیرۆکێک")).toEqual(["Rome"]);
    // A Sorani word that merely starts like a stem is not it.
    expect(addedWords("ڕۆمانێکی خۆشەویستی", "چیرۆکێک")).toEqual([]);
  });

  it("does not mistake other words: a romance is not Rome, a plain idea adds nothing", () => {
    expect(addedWords("A romance and a mystery, told calmly", "a romantic mystery")).toEqual([]);
    expect(addedWords("one of the historical mystery stories, crime", "one of the historical mystery stories, crime")).toEqual([]);
    expect(addedWords("a mystery about a letter and an old house", "a mystery about a letter")).toEqual([]);
  });

  it("judges nothing it cannot read: an empty owner text or an empty idea adds nothing", () => {
    expect(addedWords("An Egyptian crime, 1922", "")).toEqual([]);
    expect(addedWords("An Egyptian crime, 1922", "   ")).toEqual([]);
    expect(addedWords("", "a crime story")).toEqual([]);
  });
});
