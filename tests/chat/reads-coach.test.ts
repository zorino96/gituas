import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// get_coach_note reads the latest weekly note. The database is replaced; what is tested is the part that is ours: the note is shown in
// the reader's language (the AI's wording only in the language it was written in), the label line always goes with it, a preview is
// made when no note exists yet (nothing stored, no model), and the tool is quiet while the coach is switched off.

const db = vi.hoisted(() => ({
  coachNote: { findFirst: vi.fn(), create: vi.fn() },
  store: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn(), count: vi.fn() },
  auditLog: { count: vi.fn() },
  businessProfile: { findMany: vi.fn() },
}));
const ai = vi.hoisted(() => ({ completeJson: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/provider", () => ai);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { COACH_TOOLS, noteForModel, noteView } from "@/lib/chat/tools/reads-coach";
import type { ToolCtx } from "@/lib/chat/types";
import { asFacts, asStoredBody, latestNote } from "@/lib/coach/read";
import { LABEL, LABEL_RULES, renderRules } from "@/lib/coach/text";
import { busyFacts, SECRETS, seedShopDb } from "../coach/fixtures";

const NOW = Date.parse("2026-10-25T07:00:00Z");
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [],
  review: true,
  deadline: Date.now() + 50_000,
  ...over,
});
const tool = COACH_TOOLS[0];
const run = (c: ToolCtx = ctx()) => tool.run(c, tool.schema.parse({}));

const facts = busyFacts();
const aiBody = { lang: "ckb", headline: "ئەم هەفتەیە باشە", points: [{ key: "orders_up", text: "١٤ داواکاری تۆمارکراوە." }], tryThis: ["وەڵامی نامەکان بدەرەوە."] };
const rulesBody = (lang: "ckb" | "ar" | "en") => ({ lang, ...renderRules(facts, lang) });
const row = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  tenantId: "t1",
  week: "2026-W43",
  body: aiBody,
  facts,
  source: "ai",
  model: "cc/claude-haiku-5-5",
  costMicro: 3_200,
  createdAt: new Date("2026-10-25T06:30:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.BUSINESS_PROFILE_ENABLED = "1";
  seedShopDb(db, NOW);
  db.coachNote.findFirst.mockResolvedValue(row());
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("the catalogue", () => {
  it("is one read tool for the shop, not untrusted, that takes no arguments", () => {
    expect(COACH_TOOLS.map((t) => t.name)).toEqual(["get_coach_note"]);
    expect(tool.risk).toBe("read");
    expect(tool.untrusted).toBeFalsy();
    expect(tool.kinds).toEqual(["shop"]);
    expect(tool.permission).toBe("configure");
    expect(tool.schema.safeParse({}).success).toBe(true);
    expect(tool.schema.safeParse({ week: "2026-W42" }).success).toBe(false);
    for (const lang of ["ckb", "ar", "en"] as const) expect(tool.label(lang).trim().length).toBeGreaterThan(5);
  });
});

describe("while the coach is switched off", () => {
  it("says so and reads nothing", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    const r = await run();
    expect((r.data as { available: boolean }).available).toBe(false);
    expect(r.view?.[0]).toMatchObject({ kind: "note", text: "The weekly note is not switched on yet." });
    expect(db.coachNote.findFirst).not.toHaveBeenCalled();
  });
});

describe("a stored note", () => {
  it("is shown as the AI worded it when the reader reads the language it was written in, with the AI label", async () => {
    const r = await run(ctx({ lang: "ckb" }));
    const d = r.data as Record<string, any>;
    expect(d.week).toBe("2026-W43");
    expect(d.madeBy).toMatch(/AI wording/);
    expect(d.headline).toBe(aiBody.headline);
    expect(d.points).toEqual(["١٤ داواکاری تۆمارکراوە."]);
    expect(d.label).toBe(LABEL.ckb);
    expect(d.preview).toBeUndefined();
    expect(d.madeAt).toBe("2026-10-25T09:30:00+03:00");
    expect(d.rules).toMatch(/Do not predict/);
    const blocks = r.view ?? [];
    expect(JSON.stringify(blocks)).toContain(LABEL.ckb);
    expect(blocks.at(-1)).toMatchObject({ kind: "note" });
  });

  it("is shown as the rules' text in the reader's language when the AI wrote it in another one, and the label says no AI", async () => {
    const r = await run(ctx({ lang: "en" }));
    const d = r.data as Record<string, any>;
    expect(d.madeBy).toMatch(/fixed rules/);
    expect(d.headline).toBe("Orders are up on last week");
    expect(d.points[0]).toBe("14 orders were recorded this week, 10 the week before (40% more).");
    expect(d.label).toBe(LABEL_RULES.en);
    expect(d.label).not.toBe(LABEL.en);
  });

  it("is shown as stored when the rules wrote it, in the language it was stored in or any other", async () => {
    db.coachNote.findFirst.mockResolvedValue(row({ source: "rules", body: rulesBody("ckb"), model: null, costMicro: null }));
    for (const lang of ["ckb", "ar", "en"] as const) {
      const d = (await run(ctx({ lang }))).data as Record<string, any>;
      expect(d.headline, lang).toBe(renderRules(facts, lang).headline);
      expect(d.label, lang).toBe(LABEL_RULES[lang]);
    }
  });

  it("keeps the label line at the end of what the person sees, in every language", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      db.coachNote.findFirst.mockResolvedValue(row({ source: "rules", body: rulesBody(lang) }));
      const blocks = (await run(ctx({ lang }))).view ?? [];
      const last = blocks.at(-1);
      expect(last?.kind, lang).toBe("note");
      expect(JSON.stringify(last), lang).toContain(LABEL_RULES[lang]);
    }
  });

  it("shows the key figures as tiles, leaving the orders out for a goal of growing an audience", async () => {
    const stats = (await run()).view?.[0] as { kind: "stats"; items: { label: string; value: string }[] };
    expect(stats.kind).toBe("stats");
    expect(stats.items.map((i) => i.value)).toContain("14 (10)");
    const grow = busyFacts({ goal: { kind: "grow", text: null } });
    db.coachNote.findFirst.mockResolvedValue(row({ source: "rules", body: rulesBody("en"), facts: grow }));
    const growStats = (await run()).view?.[0] as { items: { value: string }[] };
    expect(growStats.items.map((i) => i.value)).not.toContain("14 (10)");
  });

  it("carries no buyer's words, even when the database rows hold them", async () => {
    db.coachNote.findFirst.mockResolvedValue(row({ source: "rules", body: rulesBody("en"), customerName: SECRETS[0], note: SECRETS[1] }));
    const r = await run();
    const all = JSON.stringify(r.data) + JSON.stringify(r.view);
    for (const s of SECRETS) expect(all).not.toContain(s);
  });
});

describe("with no note yet", () => {
  it("makes a rules-only reading now, marks it a preview, stores nothing and calls no model", async () => {
    db.coachNote.findFirst.mockResolvedValue(null);
    const r = await run();
    const d = r.data as Record<string, any>;
    expect(d.preview).toBe(true);
    expect(d.madeAt).toBeNull();
    expect(d.madeBy).toMatch(/fixed rules/);
    expect(d.label).toBe(LABEL_RULES.en);
    expect(d.headline).toBe("Orders are up on last week");
    expect(JSON.stringify(r.view)).toContain("This is a quick reading made now");
    expect(db.coachNote.create).not.toHaveBeenCalled();
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("does the same for a stored note whose facts cannot be read", async () => {
    db.coachNote.findFirst.mockResolvedValue(row({ facts: { v: 2 } }));
    const d = (await run()).data as Record<string, any>;
    expect(d.preview).toBe(true);
  });
});

describe("when the database fails", () => {
  it("tells the model and the person, and does not throw", async () => {
    db.coachNote.findFirst.mockRejectedValue(new Error("connection lost"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await run();
    expect((r.data as { available: boolean }).available).toBe(false);
    expect(r.view?.[0]).toMatchObject({ kind: "note", tone: "warn" });
    spy.mockRestore();
  });
});

describe("reading a stored row", () => {
  it("accepts only the shapes the code wrote", () => {
    expect(asFacts(facts)).toEqual(facts);
    expect(asFacts(null)).toBeNull();
    expect(asFacts({ ...facts, v: 2 })).toBeNull();
    expect(asFacts({ ...facts, orders: "x" })).toBeNull();
    expect(asStoredBody(aiBody)).toEqual(aiBody);
    expect(asStoredBody({ ...aiBody, lang: "fr" })).toBeNull();
    expect(asStoredBody({ ...aiBody, points: "x" })).toBeNull();
    expect(asStoredBody({ ...aiBody, points: [{ key: 1 }, { key: "a", text: "b" }] })?.points).toEqual([{ key: "a", text: "b" }]);
  });

  it("returns null with no note when no preview is asked for", async () => {
    db.coachNote.findFirst.mockResolvedValue(null);
    expect(await latestNote("t1", "en")).toBeNull();
  });

  it("reads the newest note of the workspace", async () => {
    await latestNote("t1", "ckb");
    expect(db.coachNote.findFirst).toHaveBeenCalledWith({ where: { tenantId: "t1" }, orderBy: { createdAt: "desc" } });
  });
});

describe("the pieces", () => {
  it("noteView puts the headline on the tiles and the points in a list titled with the week", async () => {
    const note = await latestNote("t1", "en");
    const blocks = noteView(note!, "en");
    expect(blocks[0]).toMatchObject({ kind: "stats", title: "Orders are up on last week" });
    expect(blocks[1]).toMatchObject({ kind: "list" });
    expect(JSON.stringify(blocks[1])).toContain("Your week in numbers");
    expect(JSON.stringify(blocks[1])).toContain("2026-W43");
    expect(noteForModel(note!).figures).toBeTruthy();
  });

  it("noteView labels the post count as counted once for each platform", async () => {
    const note = await latestNote("t1", "en");
    const labels = (noteView(note!, "en")[0] as { items: { label: string }[] }).items.map((i) => i.label);
    expect(labels).toContain("Posts published (counted once per platform)");
    expect(labels).not.toContain("Posts this week");
  });
});
