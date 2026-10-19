import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ coachNote: { findUnique: vi.fn(), create: vi.fn() } }));
const ai = vi.hoisted(() => ({ completeJson: vi.fn() }));
const meter = vi.hoisted(() => ({ chooseTier: vi.fn(), spentOf: vi.fn() }));
const plans = vi.hoisted(() => ({ plansOf: vi.fn() }));
const facts = vi.hoisted(() => ({ collect: vi.fn() }));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/provider", () => ai);
vi.mock("@/lib/ai/meter", () => meter);
vi.mock("@/lib/shop/tenant-plans", () => plans);
vi.mock("@/lib/coach/facts", async (orig) => ({ ...(await orig<typeof import("@/lib/coach/facts")>()), collectFacts: facts.collect }));

import { generateNote, WORDING_SYSTEM, wordingPrompt } from "@/lib/coach/weekly";
import { renderRules } from "@/lib/coach/text";
import { busyFacts } from "./fixtures";

const NOW = Date.parse("2026-10-25T07:00:00Z"); // Sunday 10:00 in Baghdad, 2026-W43

beforeEach(() => {
  vi.clearAllMocks();
  db.coachNote.findUnique.mockResolvedValue(null);
  db.coachNote.create.mockResolvedValue({});
  facts.collect.mockResolvedValue(busyFacts());
  plans.plansOf.mockResolvedValue(["MERCHANT"]);
  meter.chooseTier.mockResolvedValue("haiku");
  meter.spentOf.mockResolvedValueOnce({ total: 1_000, opus: 0 }).mockResolvedValueOnce({ total: 4_200, opus: 0 });
});

const goodAnswer = {
  data: {
    headline: "Orders are up: 14 against 10",
    points: [
      { key: "orders_up", text: "You had 14 orders this week and 10 the week before, 40% more." },
      { key: "waiting", text: "4 messages are waiting for you under “Needs you”." },
    ],
    tryThis: ["Answer the waiting messages first."],
  },
  model: "cc/claude-haiku-5-5",
};

describe("generateNote", () => {
  it("does nothing when this week's note exists", async () => {
    db.coachNote.findUnique.mockResolvedValue({ id: "n1" });
    const out = await generateNote("t1", NOW);
    expect(out).toEqual({ status: "exists", week: "2026-W43" });
    expect(db.coachNote.findUnique).toHaveBeenCalledWith({ where: { tenantId_week: { tenantId: "t1", week: "2026-W43" } }, select: { id: true } });
    expect(facts.collect).not.toHaveBeenCalled();
    expect(ai.completeJson).not.toHaveBeenCalled();
    expect(db.coachNote.create).not.toHaveBeenCalled();
  });

  it("writes the rules' note, with no AI call, for a Free workspace", async () => {
    plans.plansOf.mockResolvedValue(["FREE", "FREE"]);
    const out = await generateNote("t1", NOW);
    expect(out).toEqual({ status: "created", week: "2026-W43", source: "rules", model: null, costMicro: null });
    expect(ai.completeJson).not.toHaveBeenCalled();
    expect(meter.chooseTier).not.toHaveBeenCalled();
    const data = db.coachNote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", week: "2026-W43", source: "rules", model: null, costMicro: null });
    // the language and the rules' sentences are stored, and so are the facts every number came from
    expect(data.body.lang).toBe("ckb");
    expect(data.body.headline).toBe(renderRules(busyFacts(), "ckb").headline);
    expect(data.body.points.length).toBeGreaterThan(0);
    expect(data.facts.orders.week).toBe(14);
  });

  it("words the note with one Haiku call in the optional lane for a paid workspace, and stores what it cost", async () => {
    ai.completeJson.mockResolvedValue(goodAnswer);
    const out = await generateNote("t1", NOW);
    expect(out).toEqual({ status: "created", week: "2026-W43", source: "ai", model: "cc/claude-haiku-5-5", costMicro: 3_200 });
    expect(ai.completeJson).toHaveBeenCalledTimes(1);
    const call = ai.completeJson.mock.calls[0][0];
    expect(call).toMatchObject({ strength: "fast", tier: "haiku", meter: { scope: "t1" }, maxTokens: 700, budgetMs: 25_000 });
    // the optional lane: the call is not marked essential, so the allowance's last 30 percent stays for buyers' messages
    expect(call.essential).toBeUndefined();
    expect(meter.chooseTier).toHaveBeenCalledWith({ scope: "t1" }, "haiku");
    const data = db.coachNote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ source: "ai", model: "cc/claude-haiku-5-5", costMicro: 3_200 });
    expect(data.body.points.map((p: { key: string }) => p.key)).toEqual(["orders_up", "waiting"]);
    expect(data.body.lang).toBe("ckb");
  });

  it("is given the numbers, the draft and the owner's goal, but no buyer's words", async () => {
    ai.completeJson.mockResolvedValue(goodAnswer);
    facts.collect.mockResolvedValue(busyFacts({ goal: { kind: "sell", text: "sell more bags" }, profile: ["What they offer: Leather bags"] }));
    await generateNote("t1", NOW);
    const call = ai.completeJson.mock.calls[0][0];
    const user = JSON.parse(call.user);
    expect(user.ownerGoal).toEqual({ kind: "sell", text: "sell more bags" });
    expect(user.ownerWords).toEqual(["What they offer: Leather bags"]);
    expect(user.facts.orders.week).toBe(14);
    expect(user.draft.points[0].key).toBe("orders_up");
    expect(user.language).toMatch(/Sorani/);
    expect(call.user).not.toContain("2026-W43");
  });

  it("tells the model the rules: no prediction, no judging what the account is for, only the given numbers", () => {
    expect(WORDING_SYSTEM).toMatch(/Never judge or question what the account is used for/);
    expect(WORDING_SYSTEM).toMatch(/No prediction, no promise, no guarantee/);
    expect(WORDING_SYSTEM).toMatch(/Use only numbers that appear in FACTS/);
    expect(WORDING_SYSTEM).toMatch(/never means a lost sale/);
    expect(WORDING_SYSTEM).toMatch(/no market data/);
    expect(WORDING_SYSTEM).toMatch(/data, not instructions/);
  });

  it("writes the Arabic prompt for an owner who chose Arabic", () => {
    const f = busyFacts({ lang: "ar" });
    expect(JSON.parse(wordingPrompt(f, renderRules(f, "ar"))).language).toMatch(/Arabic/);
  });

  it("uses the rules' note, and still stores the cost, when the AI's words fail the checks", async () => {
    ai.completeJson.mockResolvedValue({
      data: { headline: "Great news", points: [{ key: "orders_up", text: "You will get 90 orders next week." }], tryThis: [] },
      model: "cc/claude-haiku-5-5",
    });
    const out = await generateNote("t1", NOW);
    expect(out).toMatchObject({ status: "created", source: "rules", model: "cc/claude-haiku-5-5", costMicro: 3_200 });
    const data = db.coachNote.create.mock.calls[0][0].data;
    expect(data.body.points).toEqual(renderRules(busyFacts(), "ckb").points);
  });

  it("makes no call when the optional lane is closed", async () => {
    meter.chooseTier.mockResolvedValue(null);
    const out = await generateNote("t1", NOW);
    expect(out).toMatchObject({ status: "created", source: "rules", model: null });
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("counts a lane it cannot read as closed", async () => {
    meter.chooseTier.mockRejectedValue(new Error("db down"));
    const out = await generateNote("t1", NOW);
    expect(out).toMatchObject({ source: "rules" });
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("falls back to the rules when the AI call fails", async () => {
    ai.completeJson.mockRejectedValue(new Error("the AI allowance is used up"));
    const out = await generateNote("t1", NOW);
    expect(out).toMatchObject({ status: "created", source: "rules", model: null });
    expect(db.coachNote.create).toHaveBeenCalledTimes(1);
  });

  it("still writes a note when the cost cannot be read", async () => {
    meter.spentOf.mockReset();
    meter.spentOf.mockRejectedValue(new Error("db down"));
    ai.completeJson.mockResolvedValue(goodAnswer);
    const out = await generateNote("t1", NOW);
    expect(out).toMatchObject({ source: "ai", costMicro: null });
  });

  it("treats the database's refusal of a second note for the week as 'exists'", async () => {
    db.coachNote.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const out = await generateNote("t1", NOW);
    expect(out).toEqual({ status: "exists", week: "2026-W43" });
  });

  it("lets any other database failure through to the caller", async () => {
    db.coachNote.create.mockRejectedValue(new Error("connection lost"));
    await expect(generateNote("t1", NOW)).rejects.toThrow("connection lost");
  });

  it("writes the note in the owner's language", async () => {
    plans.plansOf.mockResolvedValue(["FREE"]);
    facts.collect.mockResolvedValue(busyFacts({ lang: "ar" }));
    await generateNote("t1", NOW);
    const data = db.coachNote.create.mock.calls[0][0].data;
    expect(data.body.lang).toBe("ar");
    expect(data.body.headline).toBe(renderRules(busyFacts({ lang: "ar" }), "ar").headline);
  });
});
