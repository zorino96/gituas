import { beforeEach, describe, expect, it, vi } from "vitest";

// The server side of the chat's Accounts sheet: what it lists, how it saves a choice, and who may. The session, the stored choice and the
// database are replaced; what is tested is the part that is ours: the person, the role and the workspace come from the session, a choice
// is only saved for a shop and for an account that is connected, and every answer is for this workspace only.

const session = vi.hoisted(() => ({ actorFromSession: vi.fn() }));
const data = vi.hoisted(() => ({ loadAccountLists: vi.fn(), loadConnections: vi.fn() }));
const store = vi.hoisted(() => ({ readChatAccounts: vi.fn(), writeChatAccounts: vi.fn() }));
const dbMock = vi.hoisted(() => ({ auditLog: { create: vi.fn() } }));
vi.mock("@/lib/chat/session", () => session);
vi.mock("@/app/app/data", () => data);
vi.mock("@/lib/chat/accounts", () => store);
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { chooseChatAccountAction, listChatAccountsAction } from "@/app/app/assistant/account-actions";
import { scopedAccount } from "@/lib/oauth/account-scope";

const LISTS = () => ({
  META_FACEBOOK: [
    { id: "fb-old", name: "Page One", avatarUrl: "https://img.test/one.png" },
    { id: "fb-new", name: "Page Two", avatarUrl: "http://insecure.test/two.png" },
  ],
  META_INSTAGRAM: [
    { id: "ig-1", name: "@first", avatarUrl: null },
    { id: "ig-new", name: "@second", avatarUrl: null },
  ],
  TIKTOK: [],
  YOUTUBE: [{ id: "yt-1", name: "A channel", avatarUrl: null }],
});

const who = (over: Record<string, unknown> = {}) => ({ ok: true, actor: { tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang: "en", ...over }, workspaceName: "W" });

beforeEach(() => {
  vi.resetAllMocks();
  session.actorFromSession.mockResolvedValue(who());
  data.loadAccountLists.mockImplementation(async () => LISTS());
  // The account each platform acts as: the chosen one when the call runs inside withAccounts(...), else the newest connection.
  data.loadConnections.mockImplementation(async () => ({
    META_FACEBOOK: { connected: true, accountId: scopedAccount("META_FACEBOOK") ?? "fb-new" },
    META_INSTAGRAM: { connected: true, accountId: scopedAccount("META_INSTAGRAM") ?? "ig-new" },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: true, accountId: scopedAccount("YOUTUBE") ?? "yt-1" },
  }));
  store.readChatAccounts.mockResolvedValue({});
  store.writeChatAccounts.mockResolvedValue({ ok: true, choice: { META_FACEBOOK: "fb-old" } });
  dbMock.auditLog.create.mockResolvedValue({});
});

describe("listChatAccountsAction", () => {
  it("lists every connected account of the workspace per platform, with the one the chat works with", async () => {
    store.readChatAccounts.mockResolvedValue({ META_FACEBOOK: "fb-old" });
    const r = await listChatAccountsAction();
    expect(r).toMatchObject({ ok: true, kind: "shop", canConfigure: true });
    if (!r.ok) throw new Error("not ok");
    expect(r.lists.FB.map((a) => a.id)).toEqual(["fb-old", "fb-new"]);
    expect(r.lists.IG.map((a) => a.name)).toEqual(["@first", "@second"]);
    expect(r.lists.TT).toEqual([]);
    // the saved choice wins; with none saved it is the newest connection (what the chat used before)
    expect(r.selected).toEqual({ FB: "fb-old", IG: "ig-new", TT: null, YT: "yt-1" });
  });

  it("reads the lists of the session's workspace, and the choice for that same workspace", async () => {
    await listChatAccountsAction();
    expect(data.loadAccountLists).toHaveBeenCalledWith("t1");
    expect(data.loadConnections).toHaveBeenCalledWith("t1");
    expect(store.readChatAccounts).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("draws a picture only when its address is https", async () => {
    const r = await listChatAccountsAction();
    if (!r.ok) throw new Error("not ok");
    expect(r.lists.FB[0].avatarUrl).toBe("https://img.test/one.png");
    expect(r.lists.FB[1].avatarUrl).toBeNull();
  });

  it("does not mark an account that is not in the list (it would be a row nobody can see)", async () => {
    data.loadConnections.mockResolvedValue({
      META_FACEBOOK: { connected: true, accountId: "fb-gone" },
      META_INSTAGRAM: { connected: false },
      TIKTOK: { connected: false },
      YOUTUBE: { connected: false },
    });
    const r = await listChatAccountsAction();
    if (!r.ok) throw new Error("not ok");
    expect(r.selected.FB).toBeNull();
  });

  it("lists a news desk's accounts but marks none: the desk names its accounts in its tools", async () => {
    session.actorFromSession.mockResolvedValue(who({ kind: "news" }));
    const r = await listChatAccountsAction();
    expect(r).toMatchObject({ ok: true, kind: "news" });
    if (!r.ok) throw new Error("not ok");
    expect(r.lists.FB).toHaveLength(2);
    expect(r.selected).toEqual({ FB: null, IG: null, TT: null, YT: null });
    expect(store.readChatAccounts).not.toHaveBeenCalled();
    expect(data.loadConnections).not.toHaveBeenCalled();
  });

  it("answers signin without a session, and reads nothing", async () => {
    session.actorFromSession.mockResolvedValue({ ok: false, code: "signin", lang: "en" });
    expect(await listChatAccountsAction()).toEqual({ ok: false, code: "signin" });
    expect(data.loadAccountLists).not.toHaveBeenCalled();
  });

  it("refuses a role that may not configure, even if the session let it in", async () => {
    session.actorFromSession.mockResolvedValue(who({ role: "MEMBER" }));
    expect(await listChatAccountsAction()).toEqual({ ok: false, code: "forbidden" });
    expect(data.loadAccountLists).not.toHaveBeenCalled();
  });

  it("tells a tab left on another workspace so, and reads nothing", async () => {
    expect(await listChatAccountsAction({ workspaceId: "t2" })).toEqual({ ok: false, code: "workspace" });
    expect(data.loadAccountLists).not.toHaveBeenCalled();
    expect(await listChatAccountsAction({ workspaceId: "t1" })).toMatchObject({ ok: true });
  });

  it("answers internal when the database fails, never throws at the screen", async () => {
    data.loadAccountLists.mockRejectedValue(new Error("db down"));
    expect(await listChatAccountsAction()).toEqual({ ok: false, code: "internal" });
  });
});

describe("chooseChatAccountAction", () => {
  it("saves the choice for the session's workspace and answers with the new state, built from the choice just saved", async () => {
    const r = await chooseChatAccountAction({ platform: "FB", id: "fb-old" });
    expect(store.writeChatAccounts).toHaveBeenCalledWith("t1", { META_FACEBOOK: "fb-old" });
    expect(r).toMatchObject({ ok: true, kind: "shop" });
    if (!r.ok) throw new Error("not ok");
    expect(r.selected.FB).toBe("fb-old");
    // the cookie written in this very request is not read back
    expect(store.readChatAccounts).not.toHaveBeenCalled();
  });

  it("maps each platform to its provider", async () => {
    for (const [platform, provider, id] of [["FB", "META_FACEBOOK", "fb-new"], ["IG", "META_INSTAGRAM", "ig-1"]] as const) {
      store.writeChatAccounts.mockClear();
      await chooseChatAccountAction({ platform, id });
      expect(store.writeChatAccounts).toHaveBeenCalledWith("t1", { [provider]: id });
    }
  });

  it("refuses TikTok and YouTube: the chat has no tool for them, so there is nothing to switch, and nothing is saved or written down", async () => {
    for (const [platform, id] of [["TT", "tt-1"], ["YT", "yt-1"]] as const) {
      expect(await chooseChatAccountAction({ platform, id }), platform).toEqual({ ok: false, code: "badrequest" });
    }
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes the change down for the workspace, with the account's name", async () => {
    await chooseChatAccountAction({ platform: "FB", id: "fb-old" });
    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(1);
    const { data: row } = dbMock.auditLog.create.mock.calls[0][0];
    expect(row).toMatchObject({ tenantId: "t1", actor: "USER", action: "chat.account", metadata: { platform: "FB", accountId: "fb-old", name: "Page One", userId: "u1" } });
  });

  it("still answers when writing it down fails", async () => {
    dbMock.auditLog.create.mockRejectedValue(new Error("db down"));
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old" })).toMatchObject({ ok: true });
  });

  it("refuses input that is not a platform and an id, and saves nothing", async () => {
    const bad: unknown[] = [
      undefined,
      null,
      "FB",
      {},
      { platform: "FB" },
      { platform: "FB", id: "" },
      { platform: "FB", id: 7 },
      { platform: "FB", id: "x".repeat(121) },
      { platform: "LI", id: "fb-old" },
      { platform: "META_FACEBOOK", id: "fb-old" },
      { platform: "fb", id: "fb-old" },
    ];
    for (const input of bad) expect(await chooseChatAccountAction(input as never), JSON.stringify(input)).toEqual({ ok: false, code: "badrequest" });
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses an id that is not connected to this workspace, and writes nothing down", async () => {
    store.writeChatAccounts.mockResolvedValue({ ok: false });
    expect(await chooseChatAccountAction({ platform: "FB", id: "someone-elses-page" })).toEqual({ ok: false, code: "not_found" });
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a news desk: it names its accounts in its tools, so there is nothing to switch", async () => {
    session.actorFromSession.mockResolvedValue(who({ kind: "news" }));
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old" })).toEqual({ ok: false, code: "forbidden" });
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
  });

  it("refuses a role that may not configure", async () => {
    session.actorFromSession.mockResolvedValue(who({ role: "MEMBER" }));
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old" })).toEqual({ ok: false, code: "forbidden" });
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    session.actorFromSession.mockResolvedValue({ ok: false, code: "signin", lang: "en" });
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old" })).toEqual({ ok: false, code: "signin" });
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
  });

  it("takes the workspace from the session: a workspace named in the request is never used, and a different one is refused", async () => {
    await chooseChatAccountAction({ platform: "FB", id: "fb-old", tenantId: "other" } as never);
    expect(store.writeChatAccounts).toHaveBeenCalledWith("t1", expect.anything());
    expect(store.writeChatAccounts).not.toHaveBeenCalledWith("other", expect.anything());
    store.writeChatAccounts.mockClear();
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old", workspaceId: "t2" })).toEqual({ ok: false, code: "workspace" });
    expect(store.writeChatAccounts).not.toHaveBeenCalled();
  });

  it("answers internal when saving fails, never throws at the screen", async () => {
    store.writeChatAccounts.mockRejectedValue(new Error("cookie store"));
    expect(await chooseChatAccountAction({ platform: "FB", id: "fb-old" })).toEqual({ ok: false, code: "internal" });
  });
});
