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
