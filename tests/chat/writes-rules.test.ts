import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The write tools of the owner rules. The database and the shop lookup are replaced; what is tested is the part that is ours: a rule
// is always a card (never run by itself), the card shows exactly what Confirm will activate and refuses what is wrong, a link or
// number the owner did not type never reaches a text, nothing outside this workspace is touched, and every sentence exists in the
// person's three languages.

const db = vi.hoisted(() => ({
  shopRule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  ruleRun: { deleteMany: vi.fn() },
  conversationMessage: { findMany: vi.fn() },
  store: { findUnique: vi.fn(), findMany: vi.fn() },
}));
const shop = vi.hoisted(() => ({ count: 1, name: "Shop A" }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({
  cleanAttachments: () => [],
  runShopToolNamed: vi.fn(),
  postProblem: vi.fn(),
  resolveShop: vi.fn(async () => ({ ok: true, store: { id: "s1", name: shop.name, igUsername: null, fbPageId: "fb1", igUserId: null }, productId: null, productName: null, shopName: shop.name, shopCount: shop.count })),
}));
vi.mock("@/app/app/data", () => ({
  loadConnections: vi.fn(async () => ({ META_FACEBOOK: { connected: true, accountId: "fb1" }, META_INSTAGRAM: { connected: false }, TIKTOK: { connected: false }, YOUTUBE: { connected: false } })),
}));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { zodToJsonSchema } from "zod-to-json-schema";
import { decide } from "@/lib/chat/guard";
import { cleanTextFieldsForTest } from "@/lib/chat/loop";
import { riskOf } from "@/lib/chat/registry";
import { RULE_WRITE_TOOLS } from "@/lib/chat/tools/writes-rules";
import { ToolRefusal, type Card, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { ruleSentence } from "@/lib/shop/rules/render";
import { specHash, type RuleSpecT } from "@/lib/shop/rules/spec";
import { addressRule, flagRule, infoRule } from "../shop/rules-fixtures";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});
const tool = (name: string): WriteTool => {
  const t = RULE_WRITE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
/** What the loop does: parse with the tool's own schema, then ask for the card. */
const parse = (name: string, args: unknown) => tool(name).schema.parse(args);
const cardOf = (name: string, args: unknown, c = ctx()): Promise<Card> => tool(name).card(c, parse(name, args));
const run = (name: string, args: unknown, c = ctx()) => tool(name).execute(c, parse(name, args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};
const lineOf = (card: Card, label: string) => card.lines.filter((l) => l.label === label).map((l) => l.value);
const all = (card: Card) => card.lines.map((l) => l.value).join("\n");

const NOW = new Date("2026-10-19T09:00:00Z");
const stored = (id: string, spec: unknown, over: Record<string, unknown> = {}) => ({
  id, tenantId: "t1", storeId: "s1", name: (spec as { name?: string } | null)?.name ?? "Rule", sentence: "", status: "ACTIVE", version: 1, priority: 100, spec, specHash: "x",
  pausedReason: null, activatedAt: NOW, createdAt: NOW, updatedAt: NOW, store: { name: "Shop A", igUsername: null }, ...over,
});
/** The shop's other active rules (what the lint compares with) and the rules that carry a name. */
function rules(others: unknown[] = [], byName: unknown[] = []) {
  db.shopRule.findMany.mockImplementation(async (a: { where: { name?: unknown } }) => (a.where.name ? byName : others));
}
const labelled = (id: string, content: string) => ({ id, content, platform: "META_FACEBOOK", commentType: "QUESTION", intent: "delivery", language: "en", confidence: 0.9 });
const TWO_SHOPS = [
  { id: "s1", name: "Shop A", igUsername: null, fbPageId: "fb1", igUserId: null },
  { id: "s2", name: "Shop B", igUsername: "shopb", fbPageId: null, igUserId: "ig2" },
];

beforeEach(() => {
  vi.resetAllMocks();
  shop.count = 1;
  shop.name = "Shop A";
  process.env.SHOP_RULES_ENABLED = "1";
  delete process.env.RULES_DRY_RUN;
  rules();
  db.shopRule.count.mockResolvedValue(2);
  db.shopRule.create.mockResolvedValue({ id: "new1" });
  db.shopRule.updateMany.mockResolvedValue({ count: 1 });
  db.conversationMessage.findMany.mockResolvedValue([]);
  db.store.findUnique.mockResolvedValue({ automationEnabled: true, pausedReason: null });
  db.store.findMany.mockResolvedValue(TWO_SHOPS);
});
afterEach(() => {
  delete process.env.SHOP_RULES_ENABLED;
  delete process.env.RULES_DRY_RUN;
});

describe("the catalogue", () => {
  it("is four tools for the shop and for owners and admins, with the risk each one deserves", () => {
    expect(RULE_WRITE_TOOLS.map((t) => t.name)).toEqual(["create_rule", "pause_rule", "resume_rule", "delete_rule"]);
    for (const t of RULE_WRITE_TOOLS) {
      expect(t.kinds).toEqual(["shop"]);
      expect(t.permission).toBe("configure");
      for (const lang of ["ckb", "ar", "en"] as const) expect(t.label(lang)).toMatch(/\S/);
    }
    expect(tool("create_rule").risk).toBe("standing");
    expect(tool("resume_rule").risk).toBe("standing");
    expect(tool("delete_rule").risk).toBe("destructive");
    expect(tool("pause_rule").risk).toBe("low");
    expect(riskOf(tool("create_rule"), {})).toBe("standing");
  });

  it("creating, resuming and deleting always wait for Confirm, even when the owner switched on automatic changes", () => {
    for (const name of ["create_rule", "resume_rule", "delete_rule"]) {
      for (const autonomy of ["ASK", "LOW", "ALL"] as const) {
        expect(decide({ risk: riskOf(tool(name), {}), autonomy, tainted: false }), `${name}/${autonomy}`).toBe("confirm");
      }
    }
    // pausing only makes the shop quieter: it may run by itself if the owner allows small changes, but never after reading customers' words
    expect(decide({ risk: "low", autonomy: "LOW", tainted: false })).toBe("run");
    expect(decide({ risk: "low", autonomy: "ALL", tainted: true })).toBe("confirm");
  });

  it("gives the model the rule's schema and tells it not to set the hash", () => {
    const schema = JSON.stringify(zodToJsonSchema(tool("create_rule").schema, { $refStrategy: "none", target: "openApi3" }));
    expect(schema).toContain("Never set this");
    expect(schema).toContain("900 characters");
    expect(tool("create_rule").description).toContain("preview_rule");
    expect(tool("create_rule").description).toContain("cannot wait");
  });

  it("tells the model about Instagram's byte limit, the product card, the stop requests, the shops and invented examples", () => {
    const d = tool("create_rule").description;
    expect(d).toContain("1000 bytes");
    expect(d).toContain("never cut the owner's words");
    expect(d).toContain("productCard keep");
    expect(d).toContain("stop writing");
    expect(d).toContain("several shops");
    expect(d).toContain("never copied from a customer");
    expect(JSON.stringify(zodToJsonSchema(tool("create_rule").schema, { $refStrategy: "none", target: "openApi3" }))).toContain("1000 bytes");
  });

  it("a Sorani text over 1000 bytes on Instagram is refused before any card, with the way to fix it; on Facebook alone it is fine", () => {
    const long = "ب".repeat(600); // 600 letters = 1,200 bytes, inside the 900-character limit
    const onInstagram = tool("create_rule").schema.safeParse({ spec: { ...infoRule(), actions: [{ do: "reply", publicLine: "standard", texts: { default: long } }] } });
    expect(onInstagram.success).toBe(false);
    expect(JSON.stringify(onInstagram.success ? "" : onInstagram.error.issues)).toContain("over 1000 bytes");
    const facebookOnly = infoRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] } }, actions: [{ do: "reply", texts: { default: long } }] });
    expect(tool("create_rule").schema.safeParse({ spec: facebookOnly }).success).toBe(true);
  });
});

describe("create_rule: the owner's texts are cleaned like any public text", () => {
  const spec = { ...infoRule(), actions: [{ do: "reply" as const, publicLine: "standard" as const, texts: { default: "Call 0750 123 4567 or see evil.top now", ar: "اتصل بنا 0750 123 4567" } }, { do: "flag_owner" as const, note: "Reach me on @evil_handle" }] };

  it("takes out a phone number, domain or handle the owner never typed, in every language text and in the note", () => {
    const tl = tool("create_rule");
    expect(tl.textFields).toEqual(["spec.actions.*.texts.*", "spec.actions.*.note"]);
    const out = cleanTextFieldsForTest(tl, { spec }, "") as { spec: typeof spec };
    const reply = out.spec.actions[0] as { texts: Record<string, string> };
    expect(reply.texts.default).toBe("Call or see now");
    expect(reply.texts.ar).not.toMatch(/0750/);
    expect((out.spec.actions[1] as { note: string }).note).not.toContain("@evil_handle");
    // the cleaned rule must still be a rule
    expect(tl.schema.safeParse(out).success).toBe(true);
  });

  it("keeps the owner's own phone number when the owner typed it in this chat", () => {
    const out = cleanTextFieldsForTest(tool("create_rule"), { spec }, "my number is 0750 123 4567".toLowerCase()) as { spec: typeof spec };
    expect((out.spec.actions[0] as { texts: Record<string, string> }).texts.default).toContain("0750 123 4567");
  });
});

describe("create_rule: the card", () => {
  it("shows the rule in words, every text it will send in full, the examples run through the matcher, the limits and what Confirm does", async () => {
    const spec = infoRule();
    const card = await cardOf("create_rule", { spec });
    expect(card.title).toBe("New automatic rule");
    expect(lineOf(card, "Name")).toEqual(["Delivery info"]);
    expect(lineOf(card, "Rule")[0]).toBe(ruleSentence(spec, "en"));
    expect(lineOf(card, "Rule")[0]).toContain("At most 50 a day, and 1 per person a day.");
    expect(lineOf(card, "Limits")).toEqual(["At most 50 a day, and 1 per person a day."]);
    expect(lineOf(card, "Main text")).toEqual(["Hello. We deliver to every city for 5,000 IQD, in 1 to 3 days."]);
    expect(lineOf(card, "Sorani text")[0]).toContain("گەیاندن");
    expect(lineOf(card, "Arabic text")[0]).toContain("التوصيل");
    expect(lineOf(card, "Example")).toEqual([
      "If a customer writes “info”: it sends “Hello. We deliver to every city for 5,000 IQD, in 1 to 3 days.”",
      "If a customer writes “زانیاری؟”: it sends “سڵاو. گەیاندن بۆ هەموو شارەکان هەیە، ٥٠٠٠ دینار و ١ بۆ ٣ ڕۆژ.”",
      "If a customer writes “hello there”: nothing happens",
    ]);
    const notes = lineOf(card, "Note").join("\n");
    expect(notes).toContain("Once you confirm, the rule works straight away");
    expect(notes).toContain("A comment rule only works on the posts that automatic replies cover");
    expect(notes).toContain("Each buyer gets the text for their own language");
    // the price in the text is the owner's to check
    expect(lineOf(card, "Heads up").join("\n")).toContain("5,000 IQD");
  });

  it("carries what Confirm will activate: the checked, normalised rule and its hash, replacing what the model wrote", async () => {
    const loose = { ...infoRule(), name: "  Delivery   info  " };
    const card = await cardOf("create_rule", { spec: loose });
    const pinned = card.pin as { spec: RuleSpecT; specHash: string };
    expect(pinned.spec.name).toBe("Delivery info");
    expect(pinned.specHash).toBe(specHash(pinned.spec));
    // the pinned arguments are what the loop stores: they must still fit the tool's schema, and give the same hash back
    const reparsed = parse("create_rule", { spec: pinned.spec, specHash: pinned.specHash }) as { spec: RuleSpecT; specHash: string };
    expect(specHash(reparsed.spec)).toBe(pinned.specHash);
  });

  it("names the shop only when the workspace has several", async () => {
    expect(lineOf(await cardOf("create_rule", { spec: infoRule() }), "Shop")).toEqual([]);
    shop.count = 2;
    expect(lineOf(await cardOf("create_rule", { spec: infoRule(), shop: "Shop B" }), "Shop")).toEqual(["Shop B"]);
  });

  it("tells the owner, before Confirm, that where Gituas answers with a product card the card goes out and this rule stays silent", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    expect(lineOf(card, "Heads up").join("\n")).toContain("the card is sent and this rule stays silent");
    expect(lineOf(card, "Heads up").join("\n")).toContain("send my text instead of the card");
    const ckb = await cardOf("create_rule", { spec: infoRule() }, ctx({ lang: "ckb" }));
    expect(lineOf(ckb, "ئاگاداری").join("\n")).toContain("کارتی بەرهەم");
    const ar = await cardOf("create_rule", { spec: infoRule() }, ctx({ lang: "ar" }));
    expect(lineOf(ar, "تنبيه").join("\n")).toContain("بطاقة منتج");
    // the Arabic sentence has no Kurdish-only letter (the line of the owner's own price text, in Sorani, is not ours)
    const arNote = lineOf(ar, "تنبيه").find((x) => x.includes("بطاقة منتج")) ?? "";
    expect(/[کیەێۆڕڵڤپچژگ]/.test(arNote)).toBe(false);
  });

  it("does not say it when the owner chose to replace the card, or when the rule only flags", async () => {
    const replace = infoRule({
      trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["info"] }, productCard: "replace" },
      examples: [{ text: "info", match: true }, { text: "hello there", match: false }],
    });
    const a = await cardOf("create_rule", { spec: replace });
    expect(all(a)).not.toContain("this rule stays silent");
    // choosing "replace" earns the opposite note, from the lint
    expect(lineOf(a, "Heads up").join("\n")).toContain("sent instead of the card");
    const b = await cardOf("create_rule", { spec: flagRule() });
    expect(all(b)).not.toContain("this rule stays silent");
  });

  it("says how many earlier messages could not be judged, instead of reading them as 'the rule would not act'", async () => {
    const bare = (id: string, content: string) => ({ id, content, platform: "META_FACEBOOK", commentType: null, intent: null, language: null, confidence: null });
    const praise = (id: string) => ({ ...bare(id, "so beautiful"), commentType: "PRAISE", intent: "none", language: "en", confidence: 0.9 });
    // 12 labelled praises, one price question the free classifier can label, and two texts nothing can label
    db.conversationMessage.findMany.mockResolvedValue([...Array.from({ length: 12 }, (_, i) => praise(`k${i}`)), bare("q1", "price?"), bare("z1", "zzzz qqqq 1"), bare("z2", "zzzz qqqq 2")]);
    const byTopic = infoRule({
      trigger: { channel: "comment", platforms: ["META_FACEBOOK"], intents: ["price"], types: ["QUESTION"] },
      examples: [{ text: "how much", match: true }, { text: "so beautiful", match: false, as: { type: "PRAISE", intent: "none", language: "en" } }],
    });
    const card = await cardOf("create_rule", { spec: byTopic });
    const notes = lineOf(card, "Note").join("\n");
    expect(notes).toContain("earlier messages the rule would have acted");
    expect(notes).toContain("2 earlier messages could not be judged");
  });

  describe("with several shops", () => {
    beforeEach(() => {
      shop.count = 2;
    });

    it("never picks the first one silently: it refuses and lists the shops", async () => {
      const m = await refusal(cardOf("create_rule", { spec: infoRule() }));
      expect(m).toContain("2 shops");
      expect(m).toContain('"Shop A"');
      expect(m).toContain('"Shop B"');
      expect(m).toContain("pass its name");
      expect(db.shopRule.create).not.toHaveBeenCalled();
    });

    it("takes the shop by name or @handle, counts and lints against THAT shop's rules, and pins the shop's id", async () => {
      const card = await cardOf("create_rule", { spec: infoRule(), shop: "@shopb" });
      expect(lineOf(card, "Shop")).toEqual(["Shop B"]);
      expect(card.pin).toMatchObject({ shop: "s2", specHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(db.shopRule.count.mock.calls.at(-1)?.[0].where.storeId).toBe("s2");
      expect(db.shopRule.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({ storeId: "s2", status: "ACTIVE" });
      expect(db.conversationMessage.findMany.mock.calls.at(-1)?.[0].where.storeId).toBe("s2");
    });

    it("Confirm stores the rule on the shop the card showed, and the result names it", async () => {
      const card = await cardOf("create_rule", { spec: infoRule(), shop: "Shop B" });
      const res = await run("create_rule", card.pin);
      expect(res.ok).toBe(true);
      expect(res.text).toContain("Shop: Shop B");
      expect(db.shopRule.create.mock.calls[0][0].data.storeId).toBe("s2");
    });

    it("does not move the rule to another shop when the shop on the card is gone", async () => {
      const card = await cardOf("create_rule", { spec: infoRule(), shop: "Shop B" });
      db.store.findMany.mockResolvedValue([TWO_SHOPS[0], { ...TWO_SHOPS[1], id: "s9" }]);
      const res = await run("create_rule", card.pin);
      expect(res.ok).toBe(false);
      expect(res.text).toContain("things changed");
      expect(db.shopRule.create).not.toHaveBeenCalled();
    });

    it("refuses a shop name that matches no shop or two shops", async () => {
      expect(await refusal(cardOf("create_rule", { spec: infoRule(), shop: "Shop Z" }))).toContain("No shop of this account matches");
      db.store.findMany.mockResolvedValue([TWO_SHOPS[0], { ...TWO_SHOPS[1], id: "s3", name: "shop a" }]);
      expect(await refusal(cardOf("create_rule", { spec: infoRule(), shop: "Shop A" }))).toContain("More than one shop matches");
    });
  });

  it("with one shop the pinned id is the shop, and nothing is asked", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    expect(card.pin).toMatchObject({ shop: "s1" });
    expect(db.store.findMany).not.toHaveBeenCalled();
    expect((await run("create_rule", card.pin)).ok).toBe(true);
    expect(db.shopRule.create.mock.calls[0][0].data.storeId).toBe("s1");
    expect(db.store.findMany).not.toHaveBeenCalled();
  });

  it("says how the rule would have behaved on the shop's own recent messages, once there are enough of them", async () => {
    db.conversationMessage.findMany.mockResolvedValue([labelled("m1", "info please"), ...Array.from({ length: 19 }, (_, i) => labelled(`x${i}`, `is the blue one in stock ${i}`))]);
    const card = await cardOf("create_rule", { spec: infoRule() });
    expect(lineOf(card, "Note").join("\n")).toContain("On 20 of your shop's earlier messages the rule would have acted 1 times (5%).");
    expect(JSON.stringify(card)).not.toContain("please");
  });

  it("warns when the shop's automatic replies are off, and when the whole server is still in test mode", async () => {
    db.store.findUnique.mockResolvedValue({ automationEnabled: false, pausedReason: null });
    process.env.RULES_DRY_RUN = "1";
    const card = await cardOf("create_rule", { spec: infoRule() });
    expect(lineOf(card, "Heads up").join("\n")).toContain("Automatic replies are switched off for this shop");
    expect(lineOf(card, "Note").join("\n")).toContain("test mode");
  });

  it("warns about an overlap with another active rule but does not refuse it", async () => {
    rules([{ id: "r9", name: "Older rule", spec: infoRule({ name: "Older rule", actions: [{ do: "reply", texts: { default: "A different text" } }] }) }]);
    const card = await cardOf("create_rule", { spec: infoRule() });
    expect(lineOf(card, "Heads up").join("\n")).toContain("Older rule");
  });

  it("shows a chat rule with the chat note instead of the comment note", async () => {
    const card = await cardOf("create_rule", { spec: addressRule() });
    expect(lineOf(card, "Note").join("\n")).toContain("A private-message rule answers only the person who wrote");
    expect(lineOf(card, "Note").join("\n")).not.toContain("comment rule");
  });

  it("writes the card in Sorani and in Arabic: the owner's own texts stay as written, every other word is the app's", async () => {
    const ckb = await cardOf("create_rule", { spec: infoRule() }, ctx({ lang: "ckb" }));
    expect(ckb.title).toBe("یاسای خۆکاری نوێ");
    expect(ckb.lines.map((l) => l.label)).toContain("دەقی سۆرانی");
    expect(all(ckb)).toContain("کاتێک کەسێک");
    const ar = await cardOf("create_rule", { spec: infoRule() }, ctx({ lang: "ar" }));
    expect(ar.title).toBe("قاعدة تلقائية جديدة");
    expect(ar.lines.map((l) => l.label)).toContain("النص الأساسي");
    expect(all(ar)).toContain("عندما يكتب شخص ما");
    const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
    expect(ar.lines.map((l) => l.label).filter((t) => KURDISH_ONLY.test(t))).toEqual([]);
    expect(KURDISH_ONLY.test(ar.title)).toBe(false);
  });
});

describe("create_rule: what it refuses, in words the model can act on", () => {
  it("refuses everything while rules are not switched on", async () => {
    delete process.env.SHOP_RULES_ENABLED;
    expect(await refusal(cardOf("create_rule", { spec: infoRule() }))).toContain("not switched on");
    const r = await run("create_rule", { spec: infoRule() });
    expect(r.ok).toBe(false);
    expect(db.shopRule.create).not.toHaveBeenCalled();
    for (const name of ["pause_rule", "resume_rule", "delete_rule"]) expect(await refusal(cardOf(name, { rule: "r1" })), name).toContain("not switched on");
  });

  it("refuses a rule that waits for a timer or pauses a conversation: those are not in this version", async () => {
    expect(await refusal(cardOf("create_rule", { spec: flagRule({ wait: { unansweredMinutes: 10 } }) }))).toContain("cannot wait");
    const pausing = addressRule({ actions: [{ do: "reply", texts: { default: "Hello from the shop" } }, { do: "pause_thread" }] });
    expect(await refusal(cardOf("create_rule", { spec: pausing }))).toContain("cannot pause");
    expect(db.shopRule.create).not.toHaveBeenCalled();
  });

  it("refuses a word that is too short, naming it", async () => {
    const short = infoRule({ trigger: { channel: "comment", platforms: ["META_FACEBOOK"], keywords: { any: ["hi"], mode: "prefix" } }, examples: [{ text: "hi", match: true }, { text: "no way", match: false }] });
    const m = await refusal(cardOf("create_rule", { spec: short }));
    expect(m).toContain("cannot be created");
    expect(m).toContain("hi");
  });

  it("refuses a rule that answers itself, and an identical rule that is already on", async () => {
    const loop = infoRule({ actions: [{ do: "reply", texts: { default: "For info write to us on the page" } }] });
    expect(await refusal(cardOf("create_rule", { spec: loop }))).toContain("answer its own reply");
    rules([{ id: "r9", name: "Delivery info", spec: infoRule() }]);
    expect(await refusal(cardOf("create_rule", { spec: infoRule() }))).toContain("identical to the rule");
  });

  it("shows which example does not behave as declared", async () => {
    const wrong = infoRule({ examples: [{ text: "info", match: false }, { text: "hello there", match: false }, { text: "زانیاری", match: true }] });
    const m = await refusal(cardOf("create_rule", { spec: wrong }));
    expect(m).toContain('Example "info" is declared to NOT match but the rule matches it');
  });

  it("refuses a rule that would answer most of the shop's messages", async () => {
    db.conversationMessage.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => labelled(`m${i}`, `info number ${i}`)));
    expect(await refusal(cardOf("create_rule", { spec: infoRule() }))).toContain("100");
  });

  it("refuses a rule beyond the shop's limits", async () => {
    db.shopRule.count.mockResolvedValue(30);
    expect(await refusal(cardOf("create_rule", { spec: infoRule() }))).toContain("30 rules");
    db.shopRule.count.mockResolvedValue(2);
    rules(Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, name: `Other ${i}`, spec: addressRule({ name: `Other ${i}`, trigger: { channel: "dm", platforms: ["WHATSAPP"], keywords: { any: [`word${i}abc`] } }, examples: [{ text: `word${i}abc`, match: true }, { text: "hello there", match: false }] }) })));
    expect(await refusal(cardOf("create_rule", { spec: infoRule() }))).toMatch(/10|many/i);
  });
});

describe("create_rule: Confirm", () => {
  it("stores the rule ACTIVE for the shop of the session and says so", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    const res = await run("create_rule", card.pin);
    expect(res).toMatchObject({ ok: true, text: "The rule “Delivery info” is on.", data: { ruleId: "new1" } });
    const data = db.shopRule.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", storeId: "s1", status: "ACTIVE", createdBy: "u1", name: "Delivery info", specHash: (card.pin as { specHash: string }).specHash });
    expect(data.sentence).toBe(ruleSentence(infoRule(), "en"));
  });

  it("says it in the person's language, and mentions test mode when the server is still in it", async () => {
    process.env.RULES_DRY_RUN = "1";
    const card = await cardOf("create_rule", { spec: infoRule() });
    const res = await run("create_rule", card.pin, ctx({ lang: "ckb" }));
    expect(res.ok).toBe(true);
    expect(res.text).toContain("چالاک کرا");
    expect(res.text).toContain("دۆخی تاقیکردنەوە");
  });

  it("does not say 'is on' without saying that nothing is sent while the shop's automatic replies are off", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    db.store.findUnique.mockResolvedValue({ automationEnabled: false, pausedReason: null });
    const res = await run("create_rule", card.pin);
    expect(res.ok).toBe(true);
    expect(res.text).toContain("is on.");
    expect(res.text).toContain("Automatic replies are switched off for this shop");
  });

  it("does not activate a rule other than the one the card showed", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    const res = await run("create_rule", { spec: addressRule(), specHash: (card.pin as { specHash: string }).specHash });
    expect(res.ok).toBe(false);
    expect(db.shopRule.create).not.toHaveBeenCalled();
  });

  it("checks again with the shop as it is now: a rule that became a duplicate meanwhile is not stored", async () => {
    const card = await cardOf("create_rule", { spec: infoRule() });
    rules([{ id: "r9", name: "Delivery info", spec: infoRule() }]);
    const res = await run("create_rule", card.pin);
    expect(res.ok).toBe(false);
    expect(res.text).toContain("things changed");
    expect(db.shopRule.create).not.toHaveBeenCalled();
    db.shopRule.count.mockResolvedValue(30);
    rules();
    expect((await run("create_rule", card.pin)).ok).toBe(false);
  });
});

describe("pause_rule", () => {
  it("shows the rule and pins it by id, then pauses it inside the workspace", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule()));
    const card = await cardOf("pause_rule", { rule: "r1" });
    expect(card.title).toBe("Pause a rule");
    expect(lineOf(card, "Name")).toEqual(["Delivery info"]);
    expect(card.pin).toEqual({ rule: "r1" });
    const res = await run("pause_rule", { rule: "r1" });
    expect(res).toMatchObject({ ok: true, text: "The rule “Delivery info” is paused." });
    expect(db.shopRule.updateMany.mock.calls[0][0]).toEqual({ where: { id: "r1", tenantId: "t1", status: { in: ["ACTIVE"] } }, data: { status: "PAUSED", pausedReason: "owner" } });
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: "r1" });
  });

  it("refuses a rule that is not there, not on, or deleted, and does not claim a pause that did not happen", async () => {
    db.shopRule.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("pause_rule", { rule: "someone-elses" }))).toContain("list_rules");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "PAUSED" }));
    expect(await refusal(cardOf("pause_rule", { rule: "r1" }))).toContain("already paused");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "ARCHIVED" }));
    expect(await refusal(cardOf("pause_rule", { rule: "r1" }))).toContain("deleted");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule()));
    db.shopRule.updateMany.mockResolvedValue({ count: 0 });
    const res = await run("pause_rule", { rule: "r1" });
    expect(res.ok).toBe(false);
  });

  it("can pause a rule it can no longer read: pausing never needs the definition", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", { nonsense: true }, { name: "Old rule" }));
    const card = await cardOf("pause_rule", { rule: "r1" });
    expect(lineOf(card, "Rule")).toEqual([]);
    expect((await run("pause_rule", { rule: "r1" })).ok).toBe(true);
  });
});

describe("resume_rule", () => {
  it("checks the rule again like a new one, shows it, and switches it on", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "PAUSED" }));
    const card = await cardOf("resume_rule", { rule: "r1" });
    expect(card.title).toBe("Switch a rule back on");
    expect(lineOf(card, "Rule")[0]).toBe(ruleSentence(infoRule(), "en"));
    expect(card.pin).toEqual({ rule: "r1" });
    // switching a rule back on shows what the product card does to it, as creating it did
    expect(lineOf(card, "Heads up").join("\n")).toContain("the card is sent and this rule stays silent");
    // the lint ran against the OTHER active rules: the rule itself is excluded
    expect(db.shopRule.findMany.mock.calls[0][0].where).toMatchObject({ storeId: "s1", status: "ACTIVE", id: { not: "r1" } });
    const res = await run("resume_rule", { rule: "r1" });
    expect(res).toMatchObject({ ok: true, text: "The rule “Delivery info” is on again." });
    expect(db.shopRule.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "r1", tenantId: "t1", status: { in: ["PAUSED", "PAUSED_AUTO"] } }, data: { status: "ACTIVE", pausedReason: null } });
  });

  it("refuses a rule that is already on, deleted, unreadable, or that would now break a rule of the shop", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule()));
    expect(await refusal(cardOf("resume_rule", { rule: "r1" }))).toContain("already on");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "ARCHIVED" }));
    expect(await refusal(cardOf("resume_rule", { rule: "r1" }))).toContain("Create a new rule");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", { nonsense: true }, { status: "PAUSED" }));
    expect(await refusal(cardOf("resume_rule", { rule: "r1" }))).toContain("can no longer be read");
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "PAUSED_AUTO" }));
    rules([{ id: "r9", name: "Delivery info", spec: infoRule() }]);
    expect(await refusal(cardOf("resume_rule", { rule: "r1" }))).toMatch(/cannot be switched on/);
  });

  it("will not switch on a rule that is no longer paused by the time Confirm is pressed", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "PAUSED" }));
    db.shopRule.updateMany.mockResolvedValue({ count: 0 });
    expect((await run("resume_rule", { rule: "r1" })).ok).toBe(false);
  });
});

describe("delete_rule", () => {
  it("is a card that says it cannot be undone, and only hides the rule: the log stays", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule()));
    const card = await cardOf("delete_rule", { rule: "r1" });
    expect(card.title).toBe("Delete a rule");
    expect(lineOf(card, "Note").join(" ")).toContain("cannot be brought back from the app");
    expect(lineOf(card, "Note").join(" ")).toContain("90 days");
    const res = await run("delete_rule", { rule: "r1" });
    expect(res).toMatchObject({ ok: true, text: "The rule “Delivery info” is deleted. Its log stays for 90 days." });
    expect(db.shopRule.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "r1", tenantId: "t1" }, data: { status: "ARCHIVED", pausedReason: "deleted" } });
    expect(db.ruleRun.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a rule that is already deleted, and one that is not this workspace's", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule(), { status: "ARCHIVED" }));
    expect(await refusal(cardOf("delete_rule", { rule: "r1" }))).toContain("already deleted");
    db.shopRule.findFirst.mockResolvedValue(null);
    expect(await refusal(cardOf("delete_rule", { rule: "other" }))).toContain("list_rules");
  });

  it("is worded in all three languages", async () => {
    db.shopRule.findFirst.mockResolvedValue(stored("r1", infoRule()));
    expect((await cardOf("delete_rule", { rule: "r1" }, ctx({ lang: "ckb" }))).title).toBe("سڕینەوەی یاسایەک");
    expect((await cardOf("delete_rule", { rule: "r1" }, ctx({ lang: "ar" }))).title).toBe("حذف قاعدة");
    expect((await run("delete_rule", { rule: "r1" }, ctx({ lang: "ar" }))).text).toContain("تم حذف القاعدة");
  });
});
