import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reading the business profile must never break the shop: switched off, unreadable, or empty, every caller gets "no profile" and
// carries on as before.

const db = vi.hoisted(() => ({ businessProfile: { findUnique: vi.fn(), findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { loadProfile, loadProfiles } from "@/lib/shop/profile";

const row = (storeId: string, over: Record<string, unknown> = {}) => ({
  storeId,
  goal: "sell",
  goalText: null,
  category: "fashion",
  offerLine: "Leather bags",
  customer: ["women"],
  sellsTo: ["erbil"],
  language: "ckb",
  tone: "friendly",
  facts: [{ k: "payment", v: "cod", on: true }],
  interview: { step: 5, answered: ["goal"], skipped: [], doneAt: "2026-10-16T10:00:00.000Z" },
  ...over,
});

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BUSINESS_PROFILE_ENABLED;
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errors.mockRestore();
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("loadProfile", () => {
  it("is null, without touching the database, while the switch is off", async () => {
    expect(await loadProfile("s1")).toBeNull();
    process.env.BUSINESS_PROFILE_ENABLED = "0";
    expect(await loadProfile("s1")).toBeNull();
    process.env.BUSINESS_PROFILE_ENABLED = "true";
    expect(await loadProfile("s1")).toBeNull();
    expect(db.businessProfile.findUnique).not.toHaveBeenCalled();
  });

  it("is null when the shop has no row yet", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findUnique.mockResolvedValue(null);
    expect(await loadProfile("s1")).toBeNull();
    expect(db.businessProfile.findUnique).toHaveBeenCalledWith({ where: { storeId: "s1" } });
  });

  it("is null, never a throw, when the table is missing or the database is down", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findUnique.mockRejectedValue(new Error('relation "BusinessProfile" does not exist'));
    await expect(loadProfile("s1")).resolves.toBeNull();
  });

  it("logs only a short piece of the error, never the whole record", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findUnique.mockRejectedValue(new Error(`${"x".repeat(200)} password=hunter2`));
    await loadProfile("s1");
    expect(errors).toHaveBeenCalledTimes(1);
    const [tag, text] = errors.mock.calls[0] as [string, string];
    expect(tag).toBe("[profile] read failed:");
    expect(text.length).toBeLessThanOrEqual(80);
    expect(text).not.toContain("hunter2");
  });

  it("reads a row into the profile the code uses, checking every value", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findUnique.mockResolvedValue(row("s1", { goal: "pirate", tone: "formal", customer: ["women", "aliens"], interview: "garbage" }));
    const p = await loadProfile("s1");
    expect(p).toMatchObject({ storeId: "s1", goal: null, tone: "formal", customer: ["women"], category: "fashion", language: "ckb" });
    expect(p?.interview).toEqual({ step: 0, answered: [], skipped: [], doneAt: undefined });
  });

  it("drops a link or a phone number that got into a typed line", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findUnique.mockResolvedValue(row("s1", { offerLine: "call 0750 123 4567", facts: [{ k: "custom", v: "see https://example.com", on: true }] }));
    const p = await loadProfile("s1");
    expect(p?.offerLine).toBeNull();
    expect(p?.facts).toEqual([]);
  });
});

describe("loadProfiles", () => {
  it("is empty, without touching the database, while the switch is off", async () => {
    expect((await loadProfiles(["s1", "s2"])).size).toBe(0);
    expect(db.businessProfile.findMany).not.toHaveBeenCalled();
  });

  it("is empty for no stores, without a query", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    expect((await loadProfiles([])).size).toBe(0);
    expect(db.businessProfile.findMany).not.toHaveBeenCalled();
  });

  it("is empty, never a throw, when the read fails", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockRejectedValue(new Error("connection lost"));
    const out = await loadProfiles(["s1"]);
    expect(out.size).toBe(0);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("maps the rows by store id, and a store with no row is missing", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockResolvedValue([row("s1"), row("s3", { goal: "grow" })]);
    const out = await loadProfiles(["s1", "s2", "s3"]);
    expect([...out.keys()]).toEqual(["s1", "s3"]);
    expect(out.get("s3")?.goal).toBe("grow");
    expect(out.has("s2")).toBe(false);
  });

  it("asks for at most fifty stores at once", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockResolvedValue([]);
    await loadProfiles(Array.from({ length: 80 }, (_, i) => `s${i}`));
    expect(db.businessProfile.findMany.mock.calls[0][0].where.storeId.in).toHaveLength(50);
  });
});
