import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The read-back of the owner-rule changes. The database is replaced; what is tested is the part that is ours: a rule is read again
// inside the workspace only, a problem is a clear mismatch (row missing, wrong status, spec differs), anything unclear says nothing,
// the dry-run fact is told, and every sentence exists in the person's three languages.

const db = vi.hoisted(() => ({
  shopRule: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: () => [], runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn() }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { parseVerify } from "@/lib/chat/verify/report";
import { RULE_VERIFIERS } from "@/lib/chat/verify/rules";
import type { ToolCtx, VerifyReport } from "@/lib/chat/types";
import { specHash } from "@/lib/shop/rules/spec";
import { addressRule, flagRule, infoRule } from "../shop/rules-fixtures";

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", threadId: "th1", attachments: [], review: true, deadline: Date.now() + 50_000, ...over,
});
const ID = `c${"a".repeat(24)}`;
const OTHER_ID = `c${"b".repeat(24)}`;
const row = (spec: unknown, over: Record<string, unknown> = {}) => ({ id: ID, name: "Shop address", status: "ACTIVE", spec, specHash: "x", ...over });
const run = (tool: string, args: unknown, done: { text?: string; data?: unknown } = {}, c = ctx()): Promise<VerifyReport | null> =>
  RULE_VERIFIERS[tool](c, args, { text: "done", runId: "run1", ...done });
const created = (spec = addressRule(), over: Record<string, unknown> = {}) => ({ spec, specHash: specHash(spec), shop: "s1", ...over });
const all = (r: VerifyReport | null) => [...(r?.checked ?? []), ...(r?.problems ?? [])].join("\n");

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.RULES_DRY_RUN;
  db.shopRule.findFirst.mockResolvedValue(null);
  db.shopRule.findMany.mockResolvedValue([]);
});
afterEach(() => {
  delete process.env.RULES_DRY_RUN;
});

describe("the catalogue", () => {
  it("has a check for each of the four rule tools and nothing else", () => {
    expect(Object.keys(RULE_VERIFIERS).sort()).toEqual(["create_rule", "delete_rule", "pause_rule", "resume_rule"]);
  });
});

describe("create_rule", () => {
  it("says the rule is saved, on and exactly the one the card showed, reading it by the id the tool returned, in this workspace", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.status).toBe("ok");
    expect(r?.problems).toEqual([]);
    expect(r?.checked).toEqual([`The rule “Shop address” is saved and on.`, "The saved rule is exactly the one the card showed."]);
    expect(db.shopRule.findFirst).toHaveBeenCalledTimes(1);
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: ID });
    expect(db.shopRule.findMany).not.toHaveBeenCalled();
  });

  it("matches the card even when the model's spec was written loosely: both sides are the normalised form", async () => {
    const stored = addressRule({ trigger: { channel: "dm", platforms: ["WHATSAPP", "META_FACEBOOK"], keywords: { any: ["عنوان", "address"] } } });
    db.shopRule.findFirst.mockResolvedValue(row(stored));
    const loose = { ...stored, trigger: { channel: "dm", platforms: ["META_FACEBOOK", "WHATSAPP"], keywords: { any: ["address", "عنوان"] } } };
    const r = await run("create_rule", { spec: loose, shop: "s1" }, { data: { ruleId: ID } });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toContain("The saved rule is exactly the one the card showed.");
  });

  it("tells that rules are in test mode when RULES_DRY_RUN is on, as a plain fact and not a problem", async () => {
    process.env.RULES_DRY_RUN = "1";
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.status).toBe("ok");
    expect(r?.problems).toEqual([]);
    expect(r?.checked.join("\n")).toContain("test mode");
    expect(r?.checked.join("\n")).toContain("send nothing");
  });

  it("does not mention test mode when it is off", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(all(r)).not.toContain("test mode");
  });

  it("is a problem when the rule the tool named is not there", async () => {
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["After saving, I could not find the rule in your list of rules."]);
    expect(r?.fix).toContain("list_rules");
    expect(r?.fix?.length ?? 999).toBeLessThanOrEqual(300);
  });

  it("is a problem when the rule is saved but paused, deleted or stopped by itself", async () => {
    for (const [status, word] of [["PAUSED", "paused"], ["PAUSED_AUTO", "stopped by itself"], ["ARCHIVED", "deleted"]] as const) {
      db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status }));
      const r = await run("create_rule", created(), { data: { ruleId: ID } });
      expect(r?.status, status).toBe("problem");
      expect(r?.problems[0], status).toBe(`The rule “Shop address” is saved, but it is not on (${word}).`);
      expect(r?.fix, status).toContain("resume_rule");
      // the spec is still compared: a rule that is off but right is not also reported as wrong
      expect(r?.problems.length, status).toBe(1);
      expect(r?.checked, status).toContain("The saved rule is exactly the one the card showed.");
    }
  });

  it("is a problem when the stored trigger differs from the card", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule({ trigger: { channel: "dm", platforms: ["META_FACEBOOK"], keywords: { any: ["address"] } } })));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["What the saved rule looks for is different from what the card showed."]);
    expect(r?.checked).toEqual(["The rule “Shop address” is saved and on."]);
    expect(r?.fix).toContain("get_rule");
  });

  it("is a problem when the stored action differs from the card", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule({ actions: [{ do: "reply", texts: { default: "A different text." } }] })));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.problems).toEqual(["What the saved rule does is different from what the card showed."]);
  });

  it("is a problem when only the name, limits or examples differ", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule({ limits: { perPersonPerDay: 3, perDay: 10 } })));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.problems).toEqual(["The saved rule's name, limits or examples are different from the card."]);
  });

  it("names both the trigger and the action when both differ, and nothing about the rest", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(flagRule()));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.problems).toEqual([
      "What the saved rule looks for is different from what the card showed.",
      "What the saved rule does is different from what the card showed.",
    ]);
  });

  it("is a problem when the stored definition cannot be read (the pipeline would skip it)", async () => {
    db.shopRule.findFirst.mockResolvedValue(row({ v: 1, name: "broken" }));
    const r = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["The saved rule cannot be read back, so it will not run."]);
    expect(r?.checked).toEqual(["The rule “Shop address” is saved and on."]);
  });

  it("compares nothing it cannot: arguments that disagree with their own hash only prove the rule can be read", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(flagRule()));
    const r = await run("create_rule", created(addressRule(), { specHash: "f".repeat(64) }), { data: { ruleId: ID } });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toContain("The saved rule can be read back.");
    expect(all(r)).not.toContain("exactly the one the card showed");
  });

  it("compares nothing it cannot: no readable spec in the arguments only proves the rule can be read", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("create_rule", { spec: { v: 1 }, shop: "s1" }, { data: { ruleId: ID } });
    expect(r?.status).toBe("ok");
    expect(r?.checked).toEqual(["The rule “Shop address” is saved and on.", "The saved rule can be read back."]);
  });

  it("finds the newest rule with the card's hash in this workspace when the tool gave no id", async () => {
    const spec = addressRule();
    db.shopRule.findFirst.mockResolvedValue(row(spec));
    const r = await run("create_rule", created(spec), { data: undefined });
    expect(r?.status).toBe("ok");
    const call = db.shopRule.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: "t1", specHash: specHash(spec) });
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });

  it("says nothing when the tool gave no id and no rule has the hash (it cannot tell)", async () => {
    expect(await run("create_rule", created(), {})).toBeNull();
  });

  it("says nothing when there is nothing to look up", async () => {
    expect(await run("create_rule", { shop: "s1" }, {})).toBeNull();
    expect(await run("create_rule", null, { data: { ruleId: ID } })).toBeNull();
    expect(db.shopRule.findFirst).not.toHaveBeenCalled();
  });

  it("says nothing about a status it does not know", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "SOMETHING_NEW" }));
    expect(await run("create_rule", created(), { data: { ruleId: ID } })).toBeNull();
  });

  it("never finds a rule of another workspace: the lookup carries this workspace's id whatever the tool returned", async () => {
    await run("create_rule", created(), { data: { ruleId: OTHER_ID } }, ctx({ tenantId: "t9" }));
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t9", id: OTHER_ID });
  });
});

describe("pause_rule", () => {
  it("is ok when the rule is paused, read by the id in this workspace with one query", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "PAUSED" }));
    const r = await run("pause_rule", { rule: ID });
    expect(r).toEqual({ status: "ok", checked: ["The rule “Shop address” is paused and will not act until you switch it back on."], problems: [] });
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: ID });
    expect(db.shopRule.findMany).not.toHaveBeenCalled();
  });

  it("counts a rule the system stopped as paused", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "PAUSED_AUTO" }));
    expect((await run("pause_rule", { rule: ID }))?.status).toBe("ok");
  });

  it("is a problem when the rule is still on", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("pause_rule", { rule: ID });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["The rule “Shop address” is still on."]);
    expect(r?.checked).toEqual([]);
    expect(r?.fix).toContain("pause_rule");
  });

  it("says nothing when the rule was deleted meanwhile", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "ARCHIVED" }));
    expect(await run("pause_rule", { rule: ID })).toBeNull();
  });

  it("is a problem when an id that was pinned is gone from this workspace", async () => {
    const r = await run("pause_rule", { rule: ID });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["I could not find that rule any more."]);
    expect(r?.fix).toContain("list_rules");
  });

  it("finds a rule given by its name among the live rules of this workspace, in parallel with the id", async () => {
    db.shopRule.findMany.mockResolvedValue([row(addressRule(), { status: "PAUSED" })]);
    const r = await run("pause_rule", { rule: "Shop address" });
    expect(r?.status).toBe("ok");
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: "Shop address" });
    const where = db.shopRule.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.status).toEqual({ in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] });
    expect(where.name).toEqual({ equals: "Shop address", mode: "insensitive" });
  });

  it("says nothing when a name finds nothing or more than one rule (it cannot tell which)", async () => {
    expect(await run("pause_rule", { rule: "Shop address" })).toBeNull();
    db.shopRule.findMany.mockResolvedValue([row(addressRule(), { status: "PAUSED" }), row(addressRule(), { id: OTHER_ID })]);
    expect(await run("pause_rule", { rule: "Shop address" })).toBeNull();
  });

  it("says nothing without a rule argument", async () => {
    expect(await run("pause_rule", {})).toBeNull();
    expect(await run("pause_rule", { rule: "  " })).toBeNull();
    expect(db.shopRule.findFirst).not.toHaveBeenCalled();
  });
});

describe("resume_rule", () => {
  it("is ok when the rule is on again and can be read", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("resume_rule", { rule: ID });
    expect(r).toEqual({ status: "ok", checked: ["The rule “Shop address” is on again.", "The saved rule can be read back."], problems: [] });
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: ID });
  });

  it("tells that rules are in test mode when RULES_DRY_RUN is on", async () => {
    process.env.RULES_DRY_RUN = "1";
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const r = await run("resume_rule", { rule: ID });
    expect(r?.status).toBe("ok");
    expect(r?.checked.join("\n")).toContain("test mode");
  });

  it("is a problem when the rule is still paused, stopped by itself or deleted", async () => {
    for (const [status, word] of [["PAUSED", "paused"], ["PAUSED_AUTO", "stopped by itself"], ["ARCHIVED", "deleted"]] as const) {
      db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status }));
      const r = await run("resume_rule", { rule: ID });
      expect(r?.status, status).toBe("problem");
      expect(r?.problems, status).toEqual([`The rule “Shop address” is still not on (${word}).`]);
      expect(r?.fix, status).toContain("resume_rule");
    }
  });

  it("is a problem when the rule is on but its stored definition cannot be read", async () => {
    db.shopRule.findFirst.mockResolvedValue(row({ v: 1 }));
    const r = await run("resume_rule", { rule: ID });
    expect(r?.status).toBe("problem");
    expect(r?.problems).toEqual(["The saved rule cannot be read back, so it will not run."]);
    expect(r?.checked).toEqual(["The rule “Shop address” is on again."]);
  });

  it("is a problem when a pinned id is gone, says nothing for a name that finds nothing, and ignores a status it does not know", async () => {
    expect((await run("resume_rule", { rule: ID }))?.problems).toEqual(["I could not find that rule any more."]);
    expect(await run("resume_rule", { rule: "Shop address" })).toBeNull();
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "SOMETHING_NEW" }));
    expect(await run("resume_rule", { rule: ID })).toBeNull();
  });
});

describe("delete_rule", () => {
  it("is ok when the rule is deleted", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "ARCHIVED" }));
    const r = await run("delete_rule", { rule: ID });
    expect(r).toEqual({ status: "ok", checked: ["The rule “Shop address” is deleted and no longer runs."], problems: [] });
    expect(db.shopRule.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", id: ID });
  });

  it("is ok when no rule of this workspace has that id any more", async () => {
    const r = await run("delete_rule", { rule: ID });
    expect(r).toEqual({ status: "ok", checked: ["The rule is no longer in your list of rules."], problems: [] });
  });

  it("is a problem when the rule is still there", async () => {
    for (const [status, word] of [["ACTIVE", "on"], ["PAUSED", "paused"], ["PAUSED_AUTO", "stopped by itself"]] as const) {
      db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status }));
      const r = await run("delete_rule", { rule: ID });
      expect(r?.status, status).toBe("problem");
      expect(r?.problems, status).toEqual([`The rule “Shop address” is still there (${word}).`]);
      expect(r?.fix, status).toContain("delete_rule");
    }
  });

  it("is ok for a name when no live rule has it any more, and says nothing when one still does (it might be a newer rule)", async () => {
    expect((await run("delete_rule", { rule: "Shop address" }))?.status).toBe("ok");
    db.shopRule.findMany.mockResolvedValue([row(infoRule())]);
    expect(await run("delete_rule", { rule: "Shop address" })).toBeNull();
  });

  it("says nothing without a rule argument or for a status it does not know", async () => {
    expect(await run("delete_rule", {})).toBeNull();
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "SOMETHING_NEW" }));
    expect(await run("delete_rule", { rule: ID })).toBeNull();
  });
});

describe("scoping", () => {
  it("puts the workspace into every query of every check", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    const c = ctx({ tenantId: "t7" });
    await run("create_rule", created(), { data: { ruleId: ID } }, c);
    await run("create_rule", created(), {}, c);
    await run("pause_rule", { rule: "Shop address" }, {}, c);
    await run("resume_rule", { rule: ID }, {}, c);
    await run("delete_rule", { rule: "Shop address" }, {}, c);
    const wheres = [...db.shopRule.findFirst.mock.calls, ...db.shopRule.findMany.mock.calls].map((x) => x[0].where);
    expect(wheres.length).toBeGreaterThanOrEqual(7);
    for (const w of wheres) expect(w.tenantId).toBe("t7");
  });

  it("never makes more than two queries for one check", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    for (const [tool, args, done] of [
      ["create_rule", created(), { data: { ruleId: ID } }],
      ["pause_rule", { rule: "x" }, {}],
      ["resume_rule", { rule: "x" }, {}],
      ["delete_rule", { rule: "x" }, {}],
    ] as const) {
      db.shopRule.findFirst.mockClear();
      db.shopRule.findMany.mockClear();
      await run(tool, args, done);
      expect(db.shopRule.findFirst.mock.calls.length + db.shopRule.findMany.mock.calls.length, tool).toBeLessThanOrEqual(2);
    }
  });
});

describe("the person's words", () => {
  const KURDISH_ONLY = /[ێۆڕڵەیکگپچژڤ]/u;
  const ARABIC_ONLY = /[يكىةؤ]/u;

  async function everySentence(lang: ToolCtx["lang"]): Promise<{ checked: string[]; problems: string[]; fixes: string[] }> {
    const c = ctx({ lang });
    const out = { checked: [] as string[], problems: [] as string[], fixes: [] as string[] };
    const add = (r: VerifyReport | null) => {
      if (!r) return;
      out.checked.push(...r.checked);
      out.problems.push(...r.problems);
      if (r.fix) out.fixes.push(r.fix);
    };
    process.env.RULES_DRY_RUN = "1";
    const set = (status: string, spec: unknown = addressRule()) => db.shopRule.findFirst.mockResolvedValue(row(spec, { status }));
    // create
    set("ACTIVE");
    add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
    add(await run("create_rule", created(addressRule(), { specHash: "f".repeat(64) }), { data: { ruleId: ID } }, c));
    set("ACTIVE", flagRule());
    add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
    set("ACTIVE", addressRule({ limits: { perPersonPerDay: 3, perDay: 10 } }));
    add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
    set("ACTIVE", { v: 1 });
    add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
    for (const s of ["PAUSED", "PAUSED_AUTO", "ARCHIVED"]) {
      set(s);
      add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
      add(await run("resume_rule", { rule: ID }, {}, c));
      add(await run("delete_rule", { rule: ID }, {}, c));
    }
    db.shopRule.findFirst.mockResolvedValue(null);
    add(await run("create_rule", created(), { data: { ruleId: ID } }, c));
    add(await run("pause_rule", { rule: ID }, {}, c));
    add(await run("resume_rule", { rule: ID }, {}, c));
    add(await run("delete_rule", { rule: ID }, {}, c));
    // pause / resume / delete in the other states
    set("ACTIVE");
    add(await run("pause_rule", { rule: ID }, {}, c));
    add(await run("resume_rule", { rule: ID }, {}, c));
    add(await run("delete_rule", { rule: ID }, {}, c));
    set("PAUSED");
    add(await run("pause_rule", { rule: ID }, {}, c));
    set("ACTIVE", { v: 1 });
    add(await run("resume_rule", { rule: ID }, {}, c));
    set("ARCHIVED");
    add(await run("delete_rule", { rule: ID }, {}, c));
    return out;
  }

  it("has every sentence in Sorani, Arabic and English, without ids or code, and each sentence fits the report's limits", async () => {
    const seen: Record<string, { checked: string[]; problems: string[] }> = {};
    for (const lang of ["ckb", "ar", "en"] as const) {
      const s = await everySentence(lang);
      seen[lang] = s;
      for (const t of [...s.checked, ...s.problems]) {
        expect(t, `${lang}: ${t}`).toMatch(/\S/);
        expect(t, `${lang}: ${t}`).not.toMatch(/[a-z0-9]{20,}/);
        expect(t, `${lang}: ${t}`).not.toMatch(/ShopRule|specHash|tenant|ACTIVE|PAUSED|ARCHIVED|_rule\b/);
      }
      for (const f of s.fixes) {
        expect(f.length).toBeLessThanOrEqual(300);
        expect(f).toMatch(/[a-z]/);
        expect(f).not.toContain(ID);
      }
      const rep = parseVerify({ status: "problem", checked: s.checked.slice(0, 6), problems: s.problems.slice(0, 4) });
      // nothing is cut by the report's own limits (160 per checked line, 220 per problem)
      for (const t of s.checked) expect(Array.from(t).length, `${lang}: ${t}`).toBeLessThanOrEqual(160);
      for (const t of s.problems) expect(Array.from(t).length, `${lang}: ${t}`).toBeLessThanOrEqual(220);
      expect(rep?.problems.length).toBeGreaterThan(0);
    }
    // the same set of reports in each language
    expect(seen.ckb.checked.length).toBe(seen.en.checked.length);
    expect(seen.ar.checked.length).toBe(seen.en.checked.length);
    expect(seen.ckb.problems.length).toBe(seen.en.problems.length);
    expect(seen.ar.problems.length).toBe(seen.en.problems.length);
    // each language is its own: Sorani has no Arabic-only letter, Arabic has no Kurdish-only letter
    for (const t of [...seen.ar.checked, ...seen.ar.problems]) expect(t, t).not.toMatch(KURDISH_ONLY);
    for (const t of [...seen.ckb.checked, ...seen.ckb.problems]) {
      // the English "Gituas" is not in these lines, and the rule's name is Latin: only letters of the sentence are checked
      expect(t, t).not.toMatch(ARABIC_ONLY);
      expect(t, t).toMatch(KURDISH_ONLY);
    }
    for (const t of [...seen.en.checked, ...seen.en.problems]) expect(t, t).not.toMatch(/[؀-ۿ]/u);
  });

  it("writes the rule's own name inside the sentence, in the quotation marks of the language", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "PAUSED" }));
    expect((await run("pause_rule", { rule: ID }, {}, ctx({ lang: "ckb" })))?.checked[0]).toContain("«Shop address»");
    expect((await run("pause_rule", { rule: ID }, {}, ctx({ lang: "ar" })))?.checked[0]).toContain("«Shop address»");
    expect((await run("pause_rule", { rule: ID }, {}, ctx({ lang: "en" })))?.checked[0]).toContain("“Shop address”");
  });

  it("cuts a very long rule name instead of filling the line with it", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule(), { status: "PAUSED", name: "x".repeat(200) }));
    const r = await run("pause_rule", { rule: ID });
    expect(r?.checked[0].length ?? 999).toBeLessThan(160);
    expect(parseVerify(r)).toEqual(r);
  });

  it("produces reports the report parser keeps whole", async () => {
    db.shopRule.findFirst.mockResolvedValue(row(addressRule()));
    process.env.RULES_DRY_RUN = "1";
    const ok = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(parseVerify(ok)).toEqual(ok);
    db.shopRule.findFirst.mockResolvedValue(row(flagRule(), { status: "PAUSED" }));
    const bad = await run("create_rule", created(), { data: { ruleId: ID } });
    expect(bad?.status).toBe("problem");
    expect(parseVerify(bad)).toEqual(bad);
  });
});
