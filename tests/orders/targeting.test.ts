import { describe, expect, it } from "vitest";

import { cityHashtags, cleanTag, mergeSuggestions, workedHashtags } from "@/lib/orders/hashtags";
import { coreAges, coreGender, targetCities, targetingFor } from "@/lib/orders/targeting";
import { audienceFrom, breakdownRows } from "@/lib/publishers/instagram-audience";

const profile = { cities: ["erbil", "sulaymaniyah"], hours: [13, 21], languages: ["ckb"], products: ["Abaya"], messages: 40, orders: 9 };

describe("boost targeting", () => {
  it("takes the narrowest age span that holds 70 % of followers", () => {
    expect(coreAges([{ range: "13-17", share: 0.02 }, { range: "18-24", share: 0.35 }, { range: "25-34", share: 0.4 }, { range: "35-44", share: 0.15 }, { range: "45-54", share: 0.08 }])).toEqual([18, 34]);
    expect(coreAges([{ range: "55-64", share: 0.5 }, { range: "65+", share: 0.5 }])).toEqual([55, 65]);
    expect(coreAges([])).toBeNull();
    expect(coreAges(undefined)).toBeNull();
  });

  it("narrows gender only when followers are clearly one of them", () => {
    expect(coreGender({ ages: [], women: 0.8, men: 0.2, cities: [] })).toBe("women");
    expect(coreGender({ ages: [], women: 0.6, men: 0.4, cities: [] })).toBe("all");
    expect(coreGender(null)).toBe("all");
  });

  it("targets the cities orders come from, kept to where the shop delivers", () => {
    expect(targetCities(["erbil", "basra"], ["erbil", "duhok"])).toEqual(["erbil"]);
    expect(targetCities(["erbil", "basra"], [])).toEqual(["erbil", "basra"]);
    expect(targetCities([], ["duhok"])).toEqual(["duhok"]);
    expect(targetCities([], [])).toEqual(["erbil", "sulaymaniyah", "duhok", "halabja"]);
  });

  it("gives every platform its own objective, placements and budget, sharing the audience", () => {
    const t = targetingFor(profile, null, []);
    expect(t.FB.objective).toBe("messages");
    expect(t.IG.placements).toContain("ig_reels");
    expect(t.TT.objective).toBe("whatsapp_traffic");
    expect(t.YT.objective).toBe("video_views");
    expect(t.TT.ageMax).toBe(34);
    expect(t.FB.locations).toEqual(["erbil", "sulaymaniyah"]);
    expect(t.FB.hours).toEqual([13, 21]);
    expect(t.FB.fromFollowers).toBe(false);
    const withIg = targetingFor(profile, { ages: [{ range: "25-34", share: 0.8 }], women: 0.9, men: 0.1, cities: [] }, []);
    expect([withIg.TT.ageMin, withIg.TT.ageMax, withIg.FB.gender, withIg.FB.fromFollowers]).toEqual([25, 34, "women", true]);
  });
});

describe("hashtags", () => {
  it("cleans one-word tags in any script", () => {
    expect(cleanTag("#جلی_ژنانە")).toBe("#جلی_ژنانە");
    expect(cleanTag("abaya style")).toBe("#abaya_style");
    expect(cleanTag("#a")).toBeNull();
    expect(cleanTag("#<script>")).toBeNull();
    expect(cleanTag(5)).toBeNull();
  });

  it("puts the buyers' cities in both scripts, then the all-Kurdistan tags", () => {
    expect(cityHashtags(["erbil", "duhok"])).toEqual(["#هەولێر", "#hawler", "#دهۆک", "#duhok", "#کوردستان_هەولێر_سلێمانی", "#hawler_slemani_dhok_karkuk_hallabja"]);
  });

  it("ranks hashtags by the posts that brought comments and orders, leaving city tags out", () => {
    const posts = [
      { id: "p1", caption: "new #abaya #hawler", likes: 10, comments: 2 },
      { id: "p2", caption: "sale #sale #abaya", likes: 0, comments: 0 },
      { id: "p3", caption: "#dress", likes: 5, comments: 1 },
    ];
    expect(workedHashtags(posts, { p3: 3 })).toEqual(["#dress", "#abaya"]);
  });

  it("merges product, proven and city tags without repeats", () => {
    expect(mergeSuggestions(["#Abaya", "#new"], ["#abaya", "#dress"], ["#hawler"])).toEqual(["#Abaya", "#new", "#dress", "#hawler"]);
  });
});

describe("instagram audience", () => {
  const answer = (rows: [string, number][]) => ({ data: [{ total_value: { breakdowns: [{ results: rows.map(([k, v]) => ({ dimension_values: [k], value: v })) }] } }] });

  it("turns Meta's breakdowns into shares", () => {
    const a = audienceFrom(breakdownRows(answer([["25-34", 60], ["18-24", 40]])), breakdownRows(answer([["F", 75], ["M", 25]])), breakdownRows(answer([["Erbil, Erbil Governorate", 70], ["Duhok", 30]])));
    expect(a?.ages).toEqual([{ range: "18-24", share: 0.4 }, { range: "25-34", share: 0.6 }]);
    expect([a?.women, a?.men]).toEqual([0.75, 0.25]);
    expect(a?.cities[0]).toEqual({ name: "Erbil, Erbil Governorate", share: 0.7 });
  });

  it("returns nothing when Meta gave nothing", () => {
    expect(audienceFrom([], [], [])).toBeNull();
    expect(breakdownRows({ error: { message: "not enough followers" } })).toEqual([]);
    expect(breakdownRows(null)).toEqual([]);
  });
});

describe("AI audience from buyer messages", () => {
  it("removes anything that identifies a buyer before the AI sees it", async () => {
    const { scrub } = await import("@/lib/orders/ai-audience");
    expect(scrub("نرخی چەندە؟ ژمارەم 0750 123 4567 @zana_99 https://x.co/a mail me a@b.com")).toBe("نرخی چەندە؟ ژمارەم mail me");
    expect(scrub("٠٧٥٠١٢٣٤٥٦٧ بنێرە")).toBe("بنێرە");
  });

  it("keeps only short plain lists and a known gender value", async () => {
    const { parseAiAudience } = await import("@/lib/orders/ai-audience");
    expect(parseAiAudience({ interests: ["Fashion", 5, "Cosmetics"], angles: ["گەیاندنی خێرا"], questions: [], note: "  x ", genderLean: "other" })).toEqual({
      interests: ["Fashion", "Cosmetics"], angles: ["گەیاندنی خێرا"], questions: [], note: "x", genderLean: "unknown",
    });
    expect(parseAiAudience({})).toBeNull();
  });

  it("uses the messages' gender lean only when Instagram has no gender, and passes interests to every platform", () => {
    const ai = { interests: ["Fashion"], angles: [], questions: [], note: "", genderLean: "women" as const };
    const t = targetingFor(profile, null, [], ai);
    expect([t.FB.gender, t.FB.genderFromMessages, t.TT.interests]).toEqual(["women", true, ["Fashion"]]);
    const withIg = targetingFor(profile, { ages: [], women: 0.5, men: 0.5, cities: [] }, [], ai);
    expect([withIg.FB.gender, withIg.FB.genderFromMessages]).toEqual(["all", false]);
  });
});
