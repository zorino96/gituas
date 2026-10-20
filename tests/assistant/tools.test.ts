import { describe, expect, it } from "vitest";

import { parseProposal, proposalLines, TOOL_NAMES, type FieldLabels } from "@/lib/assistant/tools";

const ids = new Set(["a1", "a2"]);

const labels: FieldLabels = {
  idea: "Idea", shape: "Shape", square: "Square", portrait: "Tall", targets: "Where", caption: "Caption", media: "Media", references: "Refs",
  product: "Product", shop: "Shop", name: "Name", description: "Description", price: "Price", inStock: "In stock", number: "Number", photos: "Photos", opts: { likeComments: "Like comments", expiryDays: "Days" }, when: "When", mode: "Mode", perDay: "Per day", hour: "Hour", on: "On", yes: "Yes", no: "No",
  modeOff: "Off", modeDraft: "Prepare", modePublish: "Post", attached: (n) => `${n} file(s)`, noMedia: "Text only",
};

describe("parseProposal", () => {
  it("accepts each listed tool with fitting arguments and fills the defaults", () => {
    expect(parseProposal({ tool: "make_picture", args: { idea: "a bag on marble" } }, ids)).toEqual({
      tool: "make_picture",
      args: { idea: "a bag on marble", shape: "square", references: [] },
    });
    expect(parseProposal({ tool: "post_now", args: { caption: "hello", targets: ["FB"], media: "a1" } }, ids)?.tool).toBe("post_now");
    expect(parseProposal({ tool: "schedule_post", args: { caption: "x", targets: ["FB", "IG"], when: "2026-10-20T19:30" } }, ids)?.tool).toBe("schedule_post");
    expect(parseProposal({ tool: "set_auto_replies", args: { on: true } }, ids)).toEqual({ tool: "set_auto_replies", args: { on: true } });
    expect(parseProposal({ tool: "set_autopilot", args: { mode: "DRAFT", perDay: 2 } }, ids)?.args).toEqual({ mode: "DRAFT", perDay: 2 });
    expect(parseProposal({ tool: "set_daily_video", args: { mode: "PUBLISH", hour: 19 } }, ids)?.args).toEqual({ mode: "PUBLISH", hour: 19 });
  });

  it("has no tool for money, plans, accounts, keys or files, and refuses a name that is not on the list", () => {
    for (const bad of ["set_plan", "pay_invoice", "buy_max", "connect_account", "disconnect_account", "read_env", "delete_post", "read_file", "run_sql"]) {
      expect(parseProposal({ tool: bad, args: {} }, ids)).toBeNull();
    }
    expect(TOOL_NAMES.some((n) => /plan|pay|billing|key|token|secret|env|account|delete/i.test(n))).toBe(false);
  });

  it("refuses arguments that do not fit, and file ids that were not attached", () => {
    expect(parseProposal({ tool: "post_now", args: { caption: "x", targets: [] } }, ids)).toBeNull();
    expect(parseProposal({ tool: "post_now", args: { caption: "x", targets: ["TT"] } }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_autopilot", args: { mode: "ALWAYS" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_autopilot", args: { mode: "DRAFT", perDay: 50 } }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_daily_video", args: { mode: "DRAFT", hour: 31 } }, ids)).toBeNull();
    expect(parseProposal({ tool: "schedule_post", args: { caption: "x", targets: ["FB"], when: "tomorrow" } }, ids)).toBeNull();
    // A file nobody attached, and an address instead of an id.
    expect(parseProposal({ tool: "post_now", args: { caption: "x", targets: ["FB"], media: "a9" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "post_now", args: { caption: "x", targets: ["FB"], media: "https://evil.example/x.jpg" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "make_picture", args: { idea: "ok idea", references: ["a1", "a7"] } }, ids)).toBeNull();
    expect(parseProposal(null, ids)).toBeNull();
    expect(parseProposal({ tool: 5, args: {} }, ids)).toBeNull();
  });

  it("accepts the shop options, a product and the WhatsApp number, and refuses empty or wrong ones", () => {
    expect(parseProposal({ tool: "set_shop_options", args: { likeComments: true, expiryDays: 14 } }, ids)?.args).toEqual({ likeComments: true, expiryDays: 14 });
    expect(parseProposal({ tool: "set_shop_options", args: {} }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_shop_options", args: { expiryDays: 9999 } }, ids)).toBeNull();
    expect(parseProposal({ tool: "add_product", args: { name: "Ring", price: "25000", photos: ["a1"] } }, ids)?.args).toMatchObject({ name: "Ring", price: "25000", inStock: true, photos: ["a1"] });
    expect(parseProposal({ tool: "add_product", args: { name: "Ring", price: "free!" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "add_product", args: { name: "Ring", price: "5", photos: ["a5"] } }, ids)).toBeNull();
    expect(parseProposal({ tool: "archive_product", args: { product: "Ring" } }, ids)?.tool).toBe("archive_product");
    expect(parseProposal({ tool: "set_whatsapp_number", args: { number: "07701234567" } }, ids)?.tool).toBe("set_whatsapp_number");
    expect(parseProposal({ tool: "set_whatsapp_number", args: { number: "drop table" } }, ids)).toBeNull();
  });

  it("takes the video's language and kind from the three languages and the two kinds, and nothing else", () => {
    expect(parseProposal({ tool: "make_video", args: { idea: "a short ad" } }, ids)?.args).toEqual({ idea: "a short ad" });
    for (const language of ["ckb", "ar", "en"]) {
      expect(parseProposal({ tool: "make_video", args: { idea: "a mystery story", language, kind: "story" } }, ids)?.args).toEqual({ idea: "a mystery story", language, kind: "story" });
      expect(parseProposal({ tool: "set_daily_video", args: { mode: "OFF", language } }, ids)?.args).toEqual({ mode: "OFF", language });
    }
    expect(parseProposal({ tool: "make_video", args: { idea: "a short ad", language: "fr" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "make_video", args: { idea: "a short ad", language: "kurdish" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "make_video", args: { idea: "a short ad", kind: "documentary" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_daily_video", args: { mode: "DRAFT", language: "fr" } }, ids)).toBeNull();
    // The language is a video's own: the other tools drop it like any other key they do not have.
    expect(parseProposal({ tool: "set_autopilot", args: { mode: "DRAFT", language: "en" } }, ids)?.args).toEqual({ mode: "DRAFT" });
  });

  it("lets the daily video change its language or its hour alone (no mode: it stays on or off as it was), but not nothing at all", () => {
    expect(parseProposal({ tool: "set_daily_video", args: { language: "en" } }, ids)?.args).toEqual({ language: "en" });
    expect(parseProposal({ tool: "set_daily_video", args: { hour: 8 } }, ids)?.args).toEqual({ hour: 8 });
    expect(parseProposal({ tool: "set_daily_video", args: {} }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_daily_video", args: { url: "https://evil.example" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "set_daily_video", args: { mode: "ALWAYS" } }, ids)).toBeNull();
  });

  it("lets a story's idea run to 1200 characters and cuts nothing here (an ad's idea is cut to 300 further down)", () => {
    expect(parseProposal({ tool: "make_video", args: { idea: "x".repeat(1200), kind: "story" } }, ids)).not.toBeNull();
    expect(parseProposal({ tool: "make_video", args: { idea: "x".repeat(1201), kind: "story" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "make_video", args: { idea: "xy" } }, ids)).toBeNull();
  });

  it("drops keys the tool does not have", () => {
    const p = parseProposal({ tool: "set_auto_replies", args: { on: false, url: "https://evil.example", planId: "MAX" } }, ids);
    expect(p?.args).toEqual({ on: false });
  });
});

describe("proposalLines", () => {
  it("shows the exact values the action will run with", () => {
    const post = parseProposal({ tool: "schedule_post", args: { caption: "Big sale", targets: ["FB", "IG"], media: "a1", when: "2026-10-20T19:30" } }, ids)!;
    const lines = proposalLines(post, labels, { files: { a1: "bag.jpg" }, shop: "My shop" });
    expect(lines).toContainEqual({ label: "Where", value: "Facebook + Instagram" });
    expect(lines).toContainEqual({ label: "Shop", value: "My shop" });
    expect(lines).toContainEqual({ label: "Caption", value: "Big sale" });
    expect(lines).toContainEqual({ label: "Media", value: "bag.jpg" });
    expect(lines).toContainEqual({ label: "When", value: "2026-10-20 19:30" });
    const off = proposalLines(parseProposal({ tool: "set_autopilot", args: { mode: "OFF" } }, ids)!, labels);
    expect(off).toEqual([{ label: "Mode", value: "Off" }]);
    expect(proposalLines(parseProposal({ tool: "post_now", args: { caption: "x", targets: ["FB"] } }, ids)!, labels)).toContainEqual({ label: "Media", value: "Text only" });
  });
});

describe("the video's language and kind on the card", () => {
  const named: FieldLabels = { ...labels, language: "Video language", kind: "Kind", kindAd: "Ad", kindStory: "Story", languages: { ckb: "Sorani Kurdish", ar: "Arabic", en: "English" } };

  it("shows the rows only when the argument is given, so a card without them is what it always was", () => {
    const plain = parseProposal({ tool: "make_video", args: { idea: "a short ad" } }, ids)!;
    expect(proposalLines(plain, named, { shop: "My shop" })).toEqual([
      { label: "Idea", value: "a short ad" },
      { label: "Shop", value: "My shop" },
    ]);
    const story = parseProposal({ tool: "make_video", args: { idea: "a mystery story", language: "en", kind: "story" } }, ids)!;
    expect(proposalLines(story, named, { shop: "My shop" })).toEqual([
      { label: "Idea", value: "a mystery story" },
      { label: "Video language", value: "English" },
      { label: "Kind", value: "Story" },
      { label: "Shop", value: "My shop" },
    ]);
    const daily = parseProposal({ tool: "set_daily_video", args: { mode: "OFF", language: "ar" } }, ids)!;
    expect(proposalLines(daily, named)).toEqual([
      { label: "Mode", value: "Off" },
      { label: "Video language", value: "Arabic" },
    ]);
    // A change of the language alone shows no mode line: nothing is switched, so the card must not say "Publish" or "Off".
    const languageOnly = parseProposal({ tool: "set_daily_video", args: { language: "en" } }, ids)!;
    expect(proposalLines(languageOnly, named)).toEqual([{ label: "Video language", value: "English" }]);
  });

  it("shows the language the video will really use when the caller resolved it, even though the model left it out; a story shows no product", () => {
    const plain = parseProposal({ tool: "make_video", args: { idea: "a short ad", product: "Silver ring" } }, ids)!;
    expect(proposalLines(plain, named, { shop: "My shop", video: { lang: "en", kind: "ad" } })).toEqual([
      { label: "Idea", value: "a short ad" },
      { label: "Product", value: "Silver ring" },
      { label: "Video language", value: "English" },
      { label: "Shop", value: "My shop" },
    ]);
    const story = parseProposal({ tool: "make_video", args: { idea: "a mystery story", product: "Silver ring" } }, ids)!;
    expect(proposalLines(story, named, { video: { lang: "ckb", kind: "story" } })).toEqual([
      { label: "Idea", value: "a mystery story" },
      { label: "Video language", value: "Sorani Kurdish" },
      { label: "Kind", value: "Story" },
    ]);
    // The resolved language wins over the one the model wrote (the caller already applied the rule: the model's word, else the saved one).
    const asked = parseProposal({ tool: "make_video", args: { idea: "a short ad", language: "ar" } }, ids)!;
    expect(proposalLines(asked, named, { video: { lang: "ar", kind: "ad" } })).toContainEqual({ label: "Video language", value: "Arabic" });
  });

  it("falls back to the code when a screen has no names for the languages", () => {
    const story = parseProposal({ tool: "make_video", args: { idea: "a mystery story", language: "ar", kind: "ad" } }, ids)!;
    expect(proposalLines(story, labels)).toEqual([{ label: "Idea", value: "a mystery story" }]);
    expect(proposalLines(story, { ...labels, language: "Video language" })).toContainEqual({ label: "Video language", value: "ar" });
  });
});

describe("a news desk's tools", () => {
  it("are offered to a desk only, and the shop's only to a shop", () => {
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports" } }, ids, "news")).toEqual({
      tool: "design_section_frame",
      args: { section: "sports", note: "" },
    });
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports" } }, ids, "shop")).toBeNull();
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports" } }, ids)).toBeNull();
    expect(parseProposal({ tool: "make_picture", args: { idea: "a ring on marble" } }, ids, "news")).toBeNull();
    expect(parseProposal({ tool: "post_now", args: { caption: "x", targets: ["FB"] } }, ids, "news")).toBeNull();
  });

  it("know the sections of the news and the places of a headline, nothing else", () => {
    for (const section of ["breaking", "politics", "economy", "sports", "culture", "other"]) {
      expect(parseProposal({ tool: "remove_section_frame", args: { section } }, ids, "news")).not.toBeNull();
    }
    expect(parseProposal({ tool: "remove_section_frame", args: { section: "weather" } }, ids, "news")).toBeNull();
    expect(parseProposal({ tool: "remove_section_frame", args: { section: "../x" } }, ids, "news")).toBeNull();
    expect(parseProposal({ tool: "set_frame_text", args: { section: "sports", position: "left" } }, ids, "news")).toBeNull();
    expect(parseProposal({ tool: "set_frame_text", args: { section: "sports", position: "top" } }, ids, "news")).not.toBeNull();
  });

  it("take a reference only from the attached files", () => {
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports", reference: "a2" } }, ids, "news")?.args.reference).toBe("a2");
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports", reference: "a9" } }, ids, "news")).toBeNull();
    expect(parseProposal({ tool: "design_section_frame", args: { section: "sports", reference: "https://evil.example/x.png" } }, ids, "news")).toBeNull();
  });

  it("keep the desk's own words short, and show them on the card", () => {
    expect(parseProposal({ tool: "set_design_prompt", args: { text: "x".repeat(1300) } }, ids, "news")).toBeNull();
    const p = parseProposal({ tool: "set_design_prompt", args: { text: "deep blue" } }, ids, "news")!;
    expect(proposalLines(p, { ...labels, designPrompt: "Your words" })).toEqual([{ label: "Your words", value: "deep blue" }]);
    const f = parseProposal({ tool: "design_section_frame", args: { section: "breaking", note: "red", reference: "a1", position: "top" } }, ids, "news")!;
    expect(proposalLines(f, { ...labels, section: "Section", breaking: "Breaking", reference: "Reference", note: "Note", position: "Place", top: "Top" }, { files: { a1: "ref.png" } })).toEqual([
      { label: "Section", value: "Breaking" },
      { label: "Reference", value: "ref.png" },
      { label: "Note", value: "red" },
      { label: "Place", value: "Top" },
    ]);
  });
});
