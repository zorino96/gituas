import { describe, expect, it } from "vitest";
import { gate, gateDm, type GateInput } from "@/lib/shop/gate";

const now = new Date("2026-10-01T12:00:00Z");
const base: GateInput = {
  now,
  store: { automationEnabled: true, pausedReason: null, stopBefore: null },
  self: { ids: ["PAGE"], username: "myshop" },
  author: { id: "U1", name: "Aram" },
  post: { enabled: true, activeUntil: new Date("2026-10-20T00:00:00Z"), postCreatedAt: new Date("2026-09-25T00:00:00Z") },
  newerAutomatedPosts: 0,
  postSlots: 3,
  repliedToAuthorOnPostToday: false,
  threadPaused: false,
  sentToday: 0,
  dailyCap: 100,
};

describe("gate", () => {
  it("lets an ordinary comment through", () => {
    expect(gate(base)).toEqual({ ok: true });
  });
  it("never answers the store itself, by id or by username", () => {
    expect(gate({ ...base, author: { id: "PAGE", name: null } })).toEqual({ ok: false, reason: "self" });
    expect(gate({ ...base, author: { id: "X", name: "MyShop" } })).toEqual({ ok: false, reason: "self" });
  });
  it("respects the store switches", () => {
    expect(gate({ ...base, store: { ...base.store, automationEnabled: false } })).toEqual({ ok: false, reason: "store_off" });
    expect(gate({ ...base, store: { ...base.store, pausedReason: "token" } })).toEqual({ ok: false, reason: "store_paused" });
  });
  it("respects the post: missing, off, expired, before the stop date", () => {
    expect(gate({ ...base, post: null })).toEqual({ ok: false, reason: "no_post" });
    expect(gate({ ...base, post: { ...base.post!, enabled: false } })).toEqual({ ok: false, reason: "post_off" });
    expect(gate({ ...base, post: { ...base.post!, activeUntil: now } })).toEqual({ ok: false, reason: "post_expired" });
    expect(gate({ ...base, store: { ...base.store, stopBefore: new Date("2026-09-26T00:00:00Z") } })).toEqual({ ok: false, reason: "post_before_stop" });
  });
  it("only automates the newest N posts of the plan", () => {
    expect(gate({ ...base, newerAutomatedPosts: 2 })).toEqual({ ok: true });
    expect(gate({ ...base, newerAutomatedPosts: 3 })).toEqual({ ok: false, reason: "post_slots" });
    expect(gate({ ...base, postSlots: null, newerAutomatedPosts: 999 })).toEqual({ ok: true });
  });
  it("stops for a paused thread, a repeat author and the daily cap", () => {
    expect(gate({ ...base, threadPaused: true })).toEqual({ ok: false, reason: "thread_paused" });
    expect(gate({ ...base, repliedToAuthorOnPostToday: true })).toEqual({ ok: false, reason: "author_limit" });
    expect(gate({ ...base, sentToday: 100 })).toEqual({ ok: false, reason: "daily_cap" });
  });
});

describe("gateDm", () => {
  const dm = { store: base.store, threadPaused: false, sentToday: 0, dailyCap: 100 };
  it("lets a DM through and applies the same stops", () => {
    expect(gateDm(dm)).toEqual({ ok: true });
    expect(gateDm({ ...dm, store: { ...dm.store, automationEnabled: false } })).toEqual({ ok: false, reason: "store_off" });
    expect(gateDm({ ...dm, threadPaused: true })).toEqual({ ok: false, reason: "thread_paused" });
    expect(gateDm({ ...dm, sentToday: 100 })).toEqual({ ok: false, reason: "daily_cap" });
  });
});
