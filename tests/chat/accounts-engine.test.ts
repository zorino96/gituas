import { beforeEach, describe, expect, it, vi } from "vitest";

// The account the chat acts as, followed all the way to the post and to Confirm:
//  1. Choosing a Page / Instagram account in the chat unlocks post_now and schedule_post: the card names the account, and the publish
//     call carries it (publish-core takes an explicit account list; without one it refuses a platform that has several accounts).
//  2. A card runs as the accounts it was proposed under: the loop stores them on the card, and Confirm refuses a card whose accounts
//     the person changed since, without running it and without counting it.
// The database and the app's server actions are replaced; the real account scope (AsyncLocalStorage) is used.

const shop = vi.hoisted(() => ({
  fbList: [{ id: "fb1", name: "Page one" }] as { id: string; name: string }[],
  igList: [] as { id: string; name: string }[],
}));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn() },
  order: { findFirst: vi.fn() },
  scheduledPost: { findFirst: vi.fn() },
  usage: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
const slots = vi.hoisted(() => ({ takeDaily: vi.fn(), baghdadDay: vi.fn(() => "2026-10-20") }));
const store = vi.hoisted(() => ({
  getOwnRun: vi.fn(),
  claimRun: vi.fn(),
  finishRun: vi.fn(),
  loadMessages: vi.fn(),
  runsOfThread: vi.fn(),
  appendMessage: vi.fn(),
  updateMessage: vi.fn(),
  createRun: vi.fn(),
  setTaintedSeq: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/slots", () => slots);
vi.mock("@/app/app/data", async () => {
  const { scopedAccount } = await import("@/lib/oauth/account-scope");
  // The newest connection is the last one; a chosen account narrows the lookup to itself, as the real loadConnections does.
  const one = (list: { id: string; name: string }[], chosen?: string) => {
    const c = chosen ? list.find((a) => a.id === chosen) : list[list.length - 1];
    return c ? { connected: true, accountId: c.id, name: c.name } : { connected: false };
  };
  const refs = (list: { id: string; name: string }[]) => list.map((a) => ({ id: a.id, name: a.name, avatarUrl: null }));
  return {
    loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: refs(shop.fbList), META_INSTAGRAM: refs(shop.igList), TIKTOK: [], YOUTUBE: [] })),
    loadConnections: vi.fn(async () => ({
      META_FACEBOOK: one(shop.fbList, scopedAccount("META_FACEBOOK")),
      META_INSTAGRAM: one(shop.igList, scopedAccount("META_INSTAGRAM")),
      TIKTOK: { connected: false },
      YOUTUBE: { connected: false },
    })),
    loadPosts: vi.fn(),
    loadConversations: vi.fn(),
  };
});
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (lang: string) => (lang === "ar" ? ar : lang === "en" ? en : ckb), getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/app/app/actions", () => ({
  publishAction: vi.fn(),
  saveWhatsAppAction: vi.fn(),
  replyToCommentAction: vi.fn(),
  setCommentHiddenAction: vi.fn(),
  sendMessageAction: vi.fn(),
}));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn(), cancelScheduledAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/app/orders/actions", () => ({ setOrderStatusAction: vi.fn() }));
vi.mock("@/lib/chat/verify", () => ({ verifyChange: vi.fn(async () => undefined), verifyForModel: vi.fn() }));
vi.mock("@/lib/chat/system", () => ({ systemPrompt: () => "system", hasProfileState: () => false }));
vi.mock("@/lib/chat/system-news", () => ({ systemPromptNews: () => "system" }));
vi.mock("@/lib/chat/store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/chat/store")>()), ...store }));

import { z } from "zod";
import { publishAction } from "@/app/app/actions";
import { schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { accountsChanged, currentAccounts, decideRun, executeClaimedRun, type Actor } from "@/lib/chat/confirm";
import { runTurn } from "@/lib/chat/loop";
import { indexTools } from "@/lib/chat/registry";
import { argsHashOf, type ChatRun, type ChatThread } from "@/lib/chat/store";
import { say } from "@/lib/chat/text";
import { instagramPhrase, pagePhrase } from "@/lib/chat/tools/reads-accounts";
import { WRITE_TOOLS } from "@/lib/chat/tools/writes";
import { NEW } from "@/lib/chat/tools/writes-words";
import { defineWrite, ToolRefusal, type ChatEvent, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { withAccounts } from "@/lib/oauth/account-scope";
import type { Lang } from "@/lib/i18n/lang";

const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/1.jpg";
const img = { id: "a1", url: OWN, pathname: "merchant/t1/chat/1.jpg", kind: "image" as const, name: "bag.jpg" };

const ctxOf = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [img],
  review: true,
  deadline: Date.now() + 60_000,
  ...over,
});
const tool = (name: string): WriteTool => {
  const t = WRITE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const parse = (name: string, args: unknown) => tool(name).schema.parse(args);
const cardOf = (name: string, args: unknown, ctx = ctxOf()) => tool(name).card(ctx, parse(name, args));
const run = (name: string, args: unknown, ctx = ctxOf()) => tool(name).execute(ctx, parse(name, args));
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolRefusal);
  return (e as ToolRefusal).message;
};

const TWO_PAGES = [
  { id: "fb1", name: "Page one" },
  { id: "fb2", name: "Page two" },
];
const TWO_INSTAGRAM = [
  { id: "ig1", name: "insta_one" },
  { id: "ig2", name: "insta_two" },
];
const POST = { caption: "Hello", targets: ["FB"] as const, media: "a1" };

beforeEach(() => {
  vi.clearAllMocks();
  shop.fbList = [{ id: "fb1", name: "Page one" }];
  shop.igList = [];
  db.store.findMany.mockResolvedValue([
    { id: "s1", name: "Group one", igUsername: null, fbPageId: "fb1", igUserId: null },
    { id: "s2", name: "Group two", igUsername: null, fbPageId: "fb2", igUserId: "ig2" },
  ]);
  db.product.findMany.mockResolvedValue([]);
  slots.takeDaily.mockResolvedValue(1);
  db.usage.updateMany.mockResolvedValue({ count: 1 });
  db.auditLog.create.mockResolvedValue({});
});

// ---------------------------------------------------------------------------------------------------------------------
describe("posting as the account chosen in the chat", () => {
  it("is refused without a choice when a platform has several accounts, and the refusal sends the person to the Accounts control, not to Publish", async () => {
    shop.fbList = TWO_PAGES;
    const why = await refusal(cardOf("post_now", POST));
    expect(why).toMatch(/several Facebook Pages/);
    expect(why).toMatch(/show_accounts/);
    expect(why).not.toMatch(/Publish screen/);
    expect(await refusal(cardOf("schedule_post", { ...POST, when: "2030-01-01T10:00" }))).toMatch(/Baghdad/);
  });

  it("works once an account is chosen: the card names the Page and the run hands the explicit account to the publish action", async () => {
    shop.fbList = TWO_PAGES;
    await withAccounts({ META_FACEBOOK: "fb1" }, async () => {
      const card = await cardOf("post_now", POST);
      expect(card.lines[0]).toMatchObject({ label: "Where", value: "Facebook" });
      expect(card.lines[1]).toEqual({ label: NEW.field.to.en, value: pagePhrase("en", "Page one") });
      vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true, accountId: "fb1" }] });
      const r = await run("post_now", POST);
      expect(r.ok).toBe(true);
      expect(vi.mocked(publishAction).mock.calls[0][0]).toMatchObject({ caption: "Hello", targets: ["FB"], accounts: { FB: ["fb1"] } });
    });
  });

  it("schedules as the chosen account too, so the job that publishes later knows which one", async () => {
    shop.fbList = TWO_PAGES;
    const later = new Date(Date.now() + 3 * 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 16);
    vi.mocked(schedulePublishAction).mockResolvedValue({ ok: true, id: "x", runAt: "2030-01-01T00:00:00.000Z" });
    await withAccounts({ META_FACEBOOK: "fb2" }, async () => {
      const card = await cardOf("schedule_post", { ...POST, when: later });
      expect(card.lines).toEqual(expect.arrayContaining([{ label: NEW.field.to.en, value: pagePhrase("en", "Page two") }]));
      expect((await run("schedule_post", { ...POST, when: later })).ok).toBe(true);
      expect(vi.mocked(schedulePublishAction).mock.calls[0][0]).toMatchObject({ targets: ["FB"], accounts: { FB: ["fb2"] } });
    });
  });

  it("names a Page and an Instagram account on one line, each in the person's language, and sends both explicitly", async () => {
    shop.fbList = TWO_PAGES;
    shop.igList = TWO_INSTAGRAM;
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true }, { target: "IG", ok: true }] });
    for (const lang of ["ckb", "ar", "en"] as Lang[]) {
      await withAccounts({ META_FACEBOOK: "fb2", META_INSTAGRAM: "ig1" }, async () => {
        const card = await cardOf("post_now", { ...POST, targets: ["FB", "IG"] }, ctxOf({ lang }));
        expect(card.lines[1]).toEqual({ label: NEW.field.to[lang], value: `${pagePhrase(lang, "Page two")} + ${instagramPhrase(lang, "insta_one")}` });
      });
    }
    await withAccounts({ META_FACEBOOK: "fb2", META_INSTAGRAM: "ig1" }, async () => {
      await run("post_now", { ...POST, targets: ["FB", "IG"] });
    });
    expect(vi.mocked(publishAction).mock.calls[0][0]).toMatchObject({ accounts: { FB: ["fb2"], IG: ["ig1"] } });
  });

  it("stays refused when the other platform of the post still has several accounts and no choice", async () => {
    shop.fbList = TWO_PAGES;
    shop.igList = TWO_INSTAGRAM;
    await withAccounts({ META_FACEBOOK: "fb1" }, async () => {
      expect(await refusal(cardOf("post_now", { ...POST, targets: ["FB", "IG"] }))).toMatch(/several Facebook Pages or Instagram accounts/);
      // ... and at run time too (the card could be old)
      const r = await run("post_now", { ...POST, targets: ["FB", "IG"] });
      expect(r.ok).toBe(false);
      expect(publishAction).not.toHaveBeenCalled();
    });
  });

  it("only sends the accounts of the platforms the post goes to, and nothing when none was chosen (as before)", async () => {
    shop.igList = [{ id: "ig1", name: "insta_one" }];
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true }] });
    // an Instagram choice does not travel with a Facebook-only post
    await withAccounts({ META_INSTAGRAM: "ig1" }, async () => {
      const card = await cardOf("post_now", POST);
      expect(card.lines.map((l) => l.label)).not.toContain(NEW.field.to.en);
      await run("post_now", POST);
    });
    expect(vi.mocked(publishAction).mock.calls[0][0]).not.toHaveProperty("accounts");
    // no choice at all, one account: the card and the call are exactly what they were
    const plain = await cardOf("post_now", POST);
    expect(plain.lines.map((l) => l.label)).not.toContain(NEW.field.to.en);
    await run("post_now", POST);
    expect(vi.mocked(publishAction).mock.calls[1][0]).not.toHaveProperty("accounts");
  });

  it("does not let a chosen account that is not connected through (the post is refused as not connected)", async () => {
    shop.fbList = TWO_PAGES;
    await withAccounts({ META_FACEBOOK: "gone" }, async () => {
      expect(await refusal(cardOf("post_now", POST))).toMatch(/Facebook is not connected/);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the accounts a card was made under", () => {
  it("reads the current choice of the four platforms, empty when nothing was chosen", async () => {
    expect(currentAccounts()).toEqual({});
    await withAccounts({ META_FACEBOOK: "fb1", META_INSTAGRAM: "ig2", TIKTOK: "tt1", YOUTUBE: "yt1" }, async () => {
      expect(currentAccounts()).toEqual({ META_FACEBOOK: "fb1", META_INSTAGRAM: "ig2", TIKTOK: "tt1", YOUTUBE: "yt1" });
    });
  });

  it("compares the stored accounts with the current ones; an older card (no field) is never checked", async () => {
    expect(accountsChanged({ title: "x", lines: [] })).toBe(false);
    expect(accountsChanged(null)).toBe(false);
    expect(accountsChanged({ accounts: "nonsense" })).toBe(false);
    expect(accountsChanged({ accounts: {} })).toBe(false);
    expect(accountsChanged({ accounts: {} }, { META_INSTAGRAM: "ig1" })).toBe(true);
    expect(accountsChanged({ accounts: { META_INSTAGRAM: "ig1" } })).toBe(true);
    expect(accountsChanged({ accounts: { META_INSTAGRAM: "ig1" } }, { META_INSTAGRAM: "ig1" })).toBe(false);
    expect(accountsChanged({ accounts: { META_INSTAGRAM: "ig1" } }, { META_INSTAGRAM: "ig2" })).toBe(true);
    expect(accountsChanged({ accounts: { META_INSTAGRAM: "ig1", META_FACEBOOK: "fb1" } }, { META_INSTAGRAM: "ig1" })).toBe(true);
  });

  const actor = (lang: Lang = "en"): Actor => ({ tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang });
  const ARGS = { note: "x" };
  const execute = vi.fn();
  const fake: WriteTool = defineWrite({
    name: "fake_write",
    description: "a change",
    schema: z.object({ note: z.string() }).strict(),
    kinds: ["shop", "news"],
    permission: "configure",
    risk: "standing",
    label: () => "working",
    card: async () => ({ title: "Fake", lines: [] }),
    execute,
  });
  const runRow = (card: unknown, status = "PROPOSED") =>
    ({
      id: "r1",
      threadId: "th1",
      tenantId: "t1",
      userId: "u1",
      toolCallId: "c1",
      tool: "fake_write",
      args: ARGS,
      argsHash: argsHashOf(ARGS),
      risk: "standing",
      autonomy: "ASK",
      tainted: false,
      card,
      status,
      decidedBy: null,
      decidedAt: null,
      result: null,
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      finishedAt: null,
    }) as unknown as ChatRun;

  /** Confirm pressed on a card that was proposed with these accounts (undefined = an older card), while the request has the current ones. */
  const confirm = async (made: unknown, now: Record<string, string>, lang: Lang = "en") => {
    const row = runRow(made === undefined ? { title: "Fake", lines: [], long: false } : { title: "Fake", lines: [], long: false, accounts: made });
    store.getOwnRun.mockResolvedValue(row);
    store.claimRun.mockResolvedValue(true);
    store.loadMessages.mockResolvedValue([]);
    store.runsOfThread.mockResolvedValue([]);
    store.finishRun.mockImplementation(async (_id: string, patch: { status: string; error?: string; result?: unknown }) => ({ ...row, status: patch.status, error: patch.error ?? null, result: patch.result ?? null }));
    return withAccounts(now, () => decideRun({ runId: "r1", action: "confirm", actor: actor(lang), tools: indexTools([fake]), review: true, deadline: Date.now() + 50_000 }));
  };

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ ok: true, text: "Done." });
  });

  it("refuses a card whose account the person changed, in their language, without running it or counting it", async () => {
    for (const lang of ["ckb", "ar", "en"] as Lang[]) {
      slots.takeDaily.mockClear();
      execute.mockClear();
      const r = await confirm({ META_INSTAGRAM: "ig1" }, { META_INSTAGRAM: "ig2" }, lang);
      expect(r).toMatchObject({ ok: true, run: { status: "FAILED", error: say("accountChanged", lang) } });
      expect(execute).not.toHaveBeenCalled();
      expect(slots.takeDaily).not.toHaveBeenCalled();
      expect(db.usage.updateMany).not.toHaveBeenCalled();
    }
    expect(say("accountChanged", "en")).toBe("You changed the account after this card was made. Ask again.");
    expect(new Set(["ckb", "ar", "en"].map((l) => say("accountChanged", l as Lang))).size).toBe(3);
    // the failure is written down like every other
    expect(store.finishRun).toHaveBeenCalledWith("r1", expect.objectContaining({ status: "FAILED" }));
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("refuses a card made with no choice when the person has chosen an account since (it was made for the newest connection)", async () => {
    const r = await confirm({}, { META_FACEBOOK: "fb2" });
    expect(r).toMatchObject({ ok: true, run: { status: "FAILED", error: say("accountChanged", "en") } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a card made with a choice when the person has gone back to the newest connection", async () => {
    const r = await confirm({ META_FACEBOOK: "fb2" }, {});
    expect(r).toMatchObject({ ok: true, run: { status: "FAILED" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs a card whose accounts are the same, with the day's counters taken as always", async () => {
    const r = await confirm({ META_INSTAGRAM: "ig1", META_FACEBOOK: "fb1" }, { META_INSTAGRAM: "ig1", META_FACEBOOK: "fb1" });
    expect(r).toMatchObject({ ok: true, run: { status: "DONE" } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(slots.takeDaily).toHaveBeenCalled();
    const none = await confirm({}, {});
    expect(none).toMatchObject({ ok: true, run: { status: "DONE" } });
  });

  it("does not check a card made before the accounts were stored", async () => {
    const r = await confirm(undefined, { META_INSTAGRAM: "ig2" });
    expect(r).toMatchObject({ ok: true, run: { status: "DONE" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never checks a run the autonomy setting starts inside the same turn", async () => {
    const row = runRow({ title: "Fake", lines: [], long: false, accounts: { META_INSTAGRAM: "ig1" } }, "RUNNING");
    store.finishRun.mockImplementation(async (_id: string, patch: { status: string }) => ({ ...row, status: patch.status }));
    store.loadMessages.mockResolvedValue([]);
    store.runsOfThread.mockResolvedValue([]);
    const done = await withAccounts({ META_INSTAGRAM: "ig2" }, () => executeClaimedRun({ run: row, tool: fake, actor: actor(), attachments: [], review: true, deadline: Date.now() + 50_000, how: "AUTO" }));
    expect(done.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the loop stores the accounts on the card it proposes", () => {
  const fake: WriteTool = defineWrite({
    name: "fake_write",
    description: "a change",
    schema: z.object({ note: z.string() }).strict(),
    kinds: ["shop", "news"],
    permission: "configure",
    risk: "standing",
    label: () => "working",
    card: async () => ({ title: "Fake", lines: [{ label: "Note", value: "x" }] }),
    execute: async () => ({ ok: true, text: "Done." }),
  });

  /** A turn in which the model asks for the fake change once and then answers; returns the card that was stored. */
  async function proposeAs(kind: "shop" | "news"): Promise<Record<string, unknown>> {
    let n = 0;
    store.loadMessages.mockResolvedValue([]);
    store.runsOfThread.mockResolvedValue([]);
    store.appendMessage.mockImplementation(async (_t: string, m: { role: string; content: string; meta?: unknown }) => ({ id: `m${++n}`, seq: n, role: m.role, content: m.content ?? "", meta: m.meta ?? null, toolCalls: null, toolCallId: null, tainted: false, createdAt: new Date() }));
    store.updateMessage.mockImplementation(async (id: string, patch: { meta?: unknown }) => ({ id, seq: 9, role: "assistant", content: "", meta: patch.meta ?? null, toolCalls: null, toolCallId: null, tainted: false, createdAt: new Date() }));
    store.createRun.mockImplementation(async (i: { card: unknown; args: unknown; tool: string; risk: string; autonomy: string; tainted: boolean }) => ({ ...runRowLike(), ...i, status: "PROPOSED" }));
    store.setTaintedSeq.mockResolvedValue(undefined);
    const steps = [
      { text: "", toolCalls: [{ id: "x", name: "fake_write", args: JSON.stringify({ note: "hi" }) }], model: "m", usage: { in: 1, out: 1 }, finish: null },
      { text: "Ready.", toolCalls: [], model: "m", usage: { in: 1, out: 1 }, finish: null },
    ];
    const events: ChatEvent[] = [];
    await runTurn(
      { actor: { tenantId: "t1", userId: "u1", role: "OWNER", kind, lang: "en" }, thread: { id: "th1", taintedSeq: 0 } as ChatThread, text: "do it", attachments: [], review: true, autonomy: "ASK", ownerFacts: [], emit: (e) => events.push(e) },
      { step: (async () => steps.shift()!) as never, tools: [fake], snapshot: async () => ({ state: {}, uiNames: {}, features: {} as never }), now: Date.now },
    );
    expect(store.createRun).toHaveBeenCalledTimes(1);
    return store.createRun.mock.calls[0][0].card;
  }
  const runRowLike = () => ({ id: "r1", threadId: "th1", tenantId: "t1", userId: "u1", toolCallId: "t1s0c0", argsHash: "h", decidedBy: null, decidedAt: null, result: null, error: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), finishedAt: null });

  it("stores the account the chat acts as ({} when none is chosen) on a shop's card", async () => {
    const chosen = await withAccounts({ META_FACEBOOK: "fb2", META_INSTAGRAM: "ig1" }, () => proposeAs("shop"));
    expect(chosen).toMatchObject({ title: "Fake", long: false, accounts: { META_FACEBOOK: "fb2", META_INSTAGRAM: "ig1" } });
    store.createRun.mockClear();
    const none = await proposeAs("shop");
    expect(none).toMatchObject({ accounts: {} });
  });

  it("stores nothing on a desk's card (a desk names its accounts in its own tools), so it is never checked", async () => {
    const card = await withAccounts({ META_FACEBOOK: "fb2" }, () => proposeAs("news"));
    expect(card).not.toHaveProperty("accounts");
  });
});
