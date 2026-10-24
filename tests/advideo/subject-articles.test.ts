// The first sentences of real articles (in words of our own) against the refusal of the articles that are not a case.
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn(), writesSorani: () => false }));
import { notACase, livingBiography, localReading } from "@/lib/advideo/subject";

const real: [string, string][] = [
  ["Dyatlov Pass incident", "The Dyatlov Pass incident was an event in which nine Russian hikers died in the northern Ural Mountains between 1 and 2 February 1959 in unclear circumstances."],
  ["Roanoke Colony", "The Roanoke Colony, also known as the Lost Colony, was the first attempt at founding a permanent English settlement in North America."],
  ["Amelia Earhart", "Amelia Mary Earhart (born July 24, 1897; disappeared July 2, 1937; declared dead January 5, 1939) was an American aviation pioneer and writer."],
  ["Jack the Ripper", "Jack the Ripper was an unidentified serial killer active in and around the impoverished Whitechapel district of London in 1888."],
  ["Princes in the Tower", "The Princes in the Tower refers to the apparent murder of the two sons of Edward IV of England."],
  ["Voynich manuscript", "The Voynich manuscript is an illustrated codex hand-written in an otherwise unknown, undeciphered writing system."],
  ["Piltdown Man", "Piltdown Man is a paleoanthropological hoax in which bone fragments were presented as the fossilised remains of a previously unknown early human."],
  ["Beale ciphers", "The Beale ciphers are a set of three ciphertexts, one of which allegedly states the location of a buried treasure worth over US$43 million."],
  ["Franklin's lost expedition", "Franklin's lost expedition was a failed British voyage of Arctic exploration led by Captain Sir John Franklin."],
  ["Kaspar Hauser", "Kaspar Hauser (30 April 1812 - 17 December 1833) was a German youth who claimed to have grown up in the total isolation of a darkened cell."],
  ["Cottingley Fairies", "The Cottingley Fairies appear in a series of five photographs taken by Elsie Wright and Frances Griffiths."],
  ["Somerton Man", "The Taman Shud case, also known as the Mystery of the Somerton Man, is an unsolved case of an unidentified man discovered dead on Somerton beach."],
  ["Hanging Gardens of Babylon", "The Hanging Gardens of Babylon were one of the Seven Wonders of the Ancient World."],
  ["Library of Alexandria", "The Library of Alexandria in Alexandria, Egypt, was one of the largest and most significant libraries of the ancient world."],
  ["Antikythera mechanism", "The Antikythera mechanism is an ancient Greek hand-powered orrery, described as the oldest known example of an analogue computer."],
  ["Siege of Baghdad", "The Siege of Baghdad (29 January - 10 February 1258) was a military conflict between the Mongol army and the Abbasid Caliphate."],
  ["Hindenburg disaster", "The Hindenburg disaster was an airship accident that occurred on May 6, 1937, in Manchester Township, New Jersey."],
  ["Great Molasses Flood", "The Great Molasses Flood, also known as the Boston Molasses Disaster, was a disaster that occurred on January 15, 1919."],
  ["Watergate scandal", "The Watergate scandal was a political scandal in the United States involving the administration of President Richard Nixon."],
  ["Salem witch trials", "The Salem witch trials were a series of hearings and prosecutions of people accused of witchcraft in colonial Massachusetts."],
  ["Lizzie Borden", "Lizzie Andrew Borden (July 19, 1860 - June 1, 1927) was an American woman who was tried and acquitted in the 1892 murders of her father and stepmother."],
  ["Apollo 13", "Apollo 13 was the seventh crewed mission in the Apollo space program and the third meant to land on the Moon."],
  ["Gunpowder Plot", "The Gunpowder Plot of 1605, in earlier centuries often called the Gunpowder Treason Plot, was a failed assassination attempt against King James I."],
  ["Mutiny on the Bounty", "The mutiny on the Bounty occurred in the south Pacific Ocean on 28 April 1789 aboard HMS Bounty."],
  ["Lost Colony of Greenland", "The Norse settlements in Greenland were a group of colonies in the south-west of the island, established in the 10th century."],
  ["Black Death", "The Black Death was a bubonic plague pandemic that occurred in Europe from 1346 to 1353."],
  ["Great Fire of London", "The Great Fire of London was a major conflagration that swept through the central parts of the English city of London from Sunday, 2 September to Thursday, 6 September 1666."],
  ["Tay Bridge disaster", "The Tay Bridge disaster occurred during a violent storm on Sunday 28 December 1879, when the first Tay Rail Bridge collapsed."],
  ["Beslan school siege", "The Beslan school siege (1-3 September 2004), also referred to as the Beslan school hostage crisis, was a terrorist attack."],
  ["Marie Celeste", "Mary Celeste was an American-built merchant brigantine that was discovered adrift and deserted in the Atlantic Ocean."],
];
const notCases: [string, string][] = [
  ["Titanic", "Titanic is a 1997 American epic romance and disaster film directed, written, produced, and co-edited by James Cameron."],
  ["The Beatles", "The Beatles were an English rock band formed in Liverpool in 1960."],
  ["Netflix", "Netflix, Inc. is an American subscription video on-demand over-the-top streaming service."],
  ["Dracula", "Dracula is a gothic horror novel by Irish author Bram Stoker, published in 1897."],
  ["Amazon", "Amazon.com, Inc. is an American multinational technology company."],
  ["YouTube", "YouTube is an American online video sharing platform owned by Google."],
  ["Kurdish language", "Kurdish is a Northwestern Iranian language or group of languages spoken by the Kurds."],
  ["Nowruz", "Nowruz is the Iranian New Year, also called the Persian New Year, which is celebrated by various peoples."],
  ["Squid Game", "Squid Game is a South Korean dystopian survival drama television series created by Hwang Dong-hyuk."],
  ["Cluedo", "Cluedo is a murder mystery board game for three to six players."],
];

describe("which articles are a case: the first sentences of real articles (round-3 review)", () => {
  it("takes every real case, event, disaster and biography", () => {
    for (const [t, i] of real) expect(notACase(t, i), t).toBe(false);
  });

  it("refuses a film, a band, a company, a platform, a novel, a language, a holiday, a series and a board game", () => {
    for (const [t, i] of notCases) expect(notACase(t, i), t).toBe(true);
  });

  it("reads a living person's biography only from a bracket of the person's own first sentence", () => {
    expect(livingBiography("Taylor Swift (born December 13, 1989) is an American singer-songwriter.")).toBe(true);
    expect(livingBiography("Amelia Mary Earhart (born July 24, 1897; disappeared July 2, 1937) was an American aviation pioneer.")).toBe(false);
    expect(livingBiography("John Doe (born 1970), a farmer, is widely known as the owner of the farm.")).toBe(true);
  });

  it("finds a name with a signal in a request that has the owner's way of speaking", () => {
    expect(localReading("Tell the story of the Titanic sinking in 1912")).toMatchObject({ strong: true, signal: true, query: "Titanic sinking" });
    expect(localReading("the Zodiac killer")).toMatchObject({ strong: true, signal: true, query: "Zodiac killer" });
    expect(localReading("A story about Mary Celeste please")).toMatchObject({ strong: true, signal: false, query: "Mary Celeste" });
    expect(localReading("Make a Kurdish video about Saddam Hussein")).toMatchObject({ strong: true, signal: false, query: "Saddam Hussein" });
    expect(localReading("Ramadan mystery with Halloween vibes")).toMatchObject({ strong: false, signal: false });
  });
});
