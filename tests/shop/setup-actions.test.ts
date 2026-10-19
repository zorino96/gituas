import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The setup interview's server actions: the checks that decide who may save what. The database and the session are replaced.

const db = vi.hoisted(() => ({
  store: { findFirst: vi.fn() },
  businessProfile: { findUnique: vi.fn(), upsert: vi.fn() },
}));
const session = vi.hoisted(() => ({ currentWorkspace: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => session);
vi.mock("next/cache", () => cache);
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { finishInterviewAction, saveProfileStepAction } from "@/app/app/setup/actions";
import { en } from "@/lib/i18n/en";

const ws = (over: Record<string, unknown> = {}) => ({ id: "t1", kind: "MERCHANT", role: "OWNER", ...over });
const meta = { step: "goal", index: 0, skipped: false };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BUSINESS_PROFILE_ENABLED = "1";
  session.currentWorkspace.mockResolvedValue(ws());
  db.store.findFirst.mockResolvedValue({ id: "s1" });
  db.businessProfile.findUnique.mockResolvedValue(null);
  db.businessProfile.upsert.mockResolvedValue({});
});
afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

const refused = (r: { ok: boolean; error?: string }, error: string) => {
  expect(r).toEqual({ ok: false, error });
  expect(db.businessProfile.upsert).not.toHaveBeenCalled();
};

describe("who may save the interview", () => {
  it("nobody who is signed out", async () => {
    session.currentWorkspace.mockResolvedValue(null);
    refused(await saveProfileStepAction("s1", { goal: "sell" }, meta), en.actions.common.signIn);
    refused(await finishInterviewAction("s1", []), en.actions.common.signIn);
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });

  it("nobody, while the interview is switched off", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    refused(await saveProfileStepAction("s1", { goal: "sell" }, meta), en.nr.team.roles.notAllowed);
    refused(await finishInterviewAction("s1", []), en.nr.team.roles.notAllowed);
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });

  it("nobody in a news desk", async () => {
    session.currentWorkspace.mockResolvedValue(ws({ kind: "NEWS" }));
    refused(await saveProfileStepAction("s1", { goal: "sell" }, meta), en.nr.team.roles.notAllowed);
  });

  it("not a member without the configure permission", async () => {
    session.currentWorkspace.mockResolvedValue(ws({ role: "MEMBER" }));
    refused(await saveProfileStepAction("s1", { goal: "sell" }, meta), en.nr.team.roles.notAllowed);
    refused(await finishInterviewAction("s1", []), en.nr.team.roles.notAllowed);
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });

  it("an owner and an admin may", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      session.currentWorkspace.mockResolvedValue(ws({ role }));
      expect((await saveProfileStepAction("s1", { goal: "sell" }, meta)).ok, role).toBe(true);
    }
  });

  it("nobody for a store of another workspace: the lookup is scoped to the signed-in workspace", async () => {
    db.store.findFirst.mockResolvedValue(null);
    refused(await saveProfileStepAction("someone-elses", { goal: "sell" }, meta), en.actions.automation.storeNotFound);
    refused(await finishInterviewAction("someone-elses", []), en.actions.automation.storeNotFound);
    expect(db.store.findFirst).toHaveBeenCalledWith({ where: { id: "someone-elses", tenantId: "t1" }, select: { id: true } });
  });

  it("not for a store id that is not a string, or is empty, and the database is not asked", async () => {
    refused(await saveProfileStepAction(undefined as never, { goal: "sell" }, meta), en.actions.automation.storeNotFound);
    refused(await saveProfileStepAction("" as never, { goal: "sell" }, meta), en.actions.automation.storeNotFound);
    refused(await saveProfileStepAction({ $ne: "x" } as never, { goal: "sell" }, meta), en.actions.automation.storeNotFound);
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });
});

describe("saving a screen", () => {
  it("saves only what the screen sent, cleaned, and where the owner got to", async () => {
    const r = await saveProfileStepAction("s1", { goal: "pirate", category: "fashion", tone: "formal" }, { step: "what", index: 1, skipped: false });
    expect(r).toEqual({ ok: true });
    const call = db.businessProfile.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ storeId: "s1" });
    expect(call.update).toMatchObject({ goal: null, category: "fashion", tone: "formal" });
    expect(call.update.interview).toMatchObject({ step: 2, answered: ["what"], skipped: [] });
    expect(call.create).toMatchObject({ storeId: "s1", category: "fashion" });
  });

  it("does not take the owner's word for what may be told to buyers: a new fact starts switched off", async () => {
    await saveProfileStepAction("s1", { facts: [{ k: "payment", v: "cod", on: true }] }, { step: "facts", index: 4, skipped: false });
    expect(db.businessProfile.upsert.mock.calls[0][0].update.facts).toEqual([{ k: "payment", v: "cod", on: false }]);
  });

  it("a skipped screen saves nothing but the fact that it was skipped", async () => {
    await saveProfileStepAction("s1", { goal: "sell", category: "fashion" }, { step: "what", index: 1, skipped: true });
    const update = db.businessProfile.upsert.mock.calls[0][0].update;
    expect(update.goal).toBeUndefined();
    expect(update.category).toBeUndefined();
    expect(update.interview).toMatchObject({ skipped: ["what"], answered: [] });
  });

  it("refuses a link or a phone number in a typed line and tells the owner", async () => {
    const r = await saveProfileStepAction("s1", { goalText: "call 0750 123 4567", offerLine: "see https://example.com", goal: "sell" }, meta);
    expect(r.ok).toBe(true);
    expect(r.ok && r.dropped).toEqual(["see https://example.com", "call 0750 123 4567"]);
    const update = db.businessProfile.upsert.mock.calls[0][0].update;
    expect(update.goalText).toBeNull();
    expect(update.offerLine).toBeNull();
  });

  it("says the save failed, in the owner's language, when the table is missing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.businessProfile.upsert.mockRejectedValue(new Error('relation "BusinessProfile" does not exist'));
    expect(await saveProfileStepAction("s1", { goal: "sell" }, meta)).toEqual({ ok: false, error: en.common.error });
    spy.mockRestore();
  });
});

describe("finishing the interview", () => {
  it("writes the time it was confirmed and the facts the owner left switched on", async () => {
    const r = await finishInterviewAction("s1", [{ k: "payment", v: "cod", on: true }, { k: "returns", v: "none", on: false }, { k: "payment", v: "bitcoin", on: true }]);
    expect(r).toEqual({ ok: true });
    const update = db.businessProfile.upsert.mock.calls[0][0].update;
    expect(update.facts).toEqual([{ k: "payment", v: "cod", on: true }, { k: "returns", v: "none", on: false }]);
    expect(typeof update.interview.doneAt).toBe("string");
    expect(Number.isNaN(Date.parse(update.interview.doneAt))).toBe(false);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("keeps the answers already given", async () => {
    db.businessProfile.findUnique.mockResolvedValue({ interview: { step: 5, answered: ["goal"], skipped: ["who"] } });
    await finishInterviewAction("s1", []);
    expect(db.businessProfile.upsert.mock.calls[0][0].update.interview).toMatchObject({ step: 5, answered: ["goal"], skipped: ["who"] });
  });
});
