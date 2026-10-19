import { beforeEach, describe, expect, it, vi } from "vitest";

// The chat's choice of account, kept in a cookie of the person's browser (src/lib/chat/accounts.ts). The cookie jar of the request and the
// database are replaced; what is tested is the part that is ours: what is read back (a forged id, an id that is no longer connected and a
// broken cookie are all ignored), what is written (only an account that is connected, and the cookie never grows), and how the choice
// reaches the chat's work (a shop is scoped to it, a news desk passes through untouched).

const NAME = "gm_chat_accounts";
const jar = vi.hoisted(() => ({
  value: undefined as string | undefined,
  sets: [] as { name: string; value: string; options: Record<string, unknown> }[],
  reads: 0,
  broken: false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.broken) throw new Error("cookies() was called outside a request");
    return {
      get: (name: string) => {
        jar.reads += 1;
        return name === "gm_chat_accounts" && jar.value !== undefined ? { name, value: jar.value } : undefined;
      },
      set: (name: string, value: string, options: Record<string, unknown>) => {
        jar.sets.push({ name, value, options });
        jar.value = value;
      },
    };
  },
}));
const data = vi.hoisted(() => ({ loadAccountLists: vi.fn() }));
vi.mock("@/app/app/data", () => data);

import { ACCOUNT_COOKIE, readChatAccounts, validChoice, withChatAccounts, writeChatAccounts } from "@/lib/chat/accounts";
import { scopedAccount } from "@/lib/oauth/account-scope";

type Lists = Record<"META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK" | "YOUTUBE", { id: string; name: string; avatarUrl: null }[]>;
const ref = (id: string) => ({ id, name: id, avatarUrl: null });
/** Every workspace has two Pages and two Instagram accounts, named after it, and one YouTube channel. */
const listsOf = (tenantId: string): Lists => ({
  META_FACEBOOK: [ref(`${tenantId}-fb1`), ref(`${tenantId}-fb2`)],
  META_INSTAGRAM: [ref(`${tenantId}-ig1`), ref(`${tenantId}-ig2`)],
  TIKTOK: [],
  YOUTUBE: [ref(`${tenantId}-yt1`)],
});
const stored = () => JSON.parse(jar.value ?? "{}") as Record<string, Record<string, string>>;
const cookieIs = (value: unknown) => {
  jar.value = typeof value === "string" ? value : JSON.stringify(value);
};

beforeEach(() => {
  jar.value = undefined;
  jar.sets = [];
  jar.reads = 0;
  jar.broken = false;
  data.loadAccountLists.mockReset();
  data.loadAccountLists.mockImplementation(async (tenantId: string) => listsOf(tenantId));
});

describe("the cookie's name", () => {
  it("is the one the tests here fake", () => {
    expect(ACCOUNT_COOKIE).toBe(NAME);
  });
});

describe("readChatAccounts", () => {
  it("is empty when nothing was saved, and reads no list", async () => {
    expect(await readChatAccounts("t1")).toEqual({});
    expect(data.loadAccountLists).not.toHaveBeenCalled();
  });

  it("gives back the accounts that are connected to the workspace", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig1", YOUTUBE: "t1-yt1" } });
    expect(await readChatAccounts("t1")).toEqual({ META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig1", YOUTUBE: "t1-yt1" });
    expect(data.loadAccountLists).toHaveBeenCalledWith("t1");
  });

  it("ignores an id that is not connected here (a forged one), and keeps the rest", async () => {
    cookieIs({ t1: { META_FACEBOOK: "someone-elses-page", META_INSTAGRAM: "t1-ig2" } });
    expect(await readChatAccounts("t1")).toEqual({ META_INSTAGRAM: "t1-ig2" });
  });

  it("ignores an id of another platform put under this one", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-ig1" } });
    expect(await readChatAccounts("t1")).toEqual({});
  });

  it("ignores an account that was connected when it was chosen and has been removed since", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig2" } });
    data.loadAccountLists.mockResolvedValue({ ...listsOf("t1"), META_FACEBOOK: [ref("t1-fb1")] });
    expect(await readChatAccounts("t1")).toEqual({ META_INSTAGRAM: "t1-ig2" });
  });

  it("never uses the choice another workspace made", async () => {
    cookieIs({ t2: { META_FACEBOOK: "t2-fb1" } });
    expect(await readChatAccounts("t1")).toEqual({});
    expect(data.loadAccountLists).not.toHaveBeenCalled();
    // not even when the other workspace's id is written under this workspace's name
    cookieIs({ t1: { META_FACEBOOK: "t2-fb1" } });
    expect(await readChatAccounts("t1")).toEqual({});
  });

  it("uses the lists it is given instead of asking for them again", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    expect(await readChatAccounts("t1", listsOf("t1") as never)).toEqual({ META_FACEBOOK: "t1-fb2" });
    expect(data.loadAccountLists).not.toHaveBeenCalled();
  });

  it("ignores a cookie that is broken, not an object, or full of the wrong kinds of value", async () => {
    for (const raw of ["not json", "[]", "null", "7", '"text"', '{"t1": 5}', '{"t1": []}', '{"t1": {"META_FACEBOOK": 7}}', '{"t1": {"META_FACEBOOK": ""}}', '{"t1": {"UNKNOWN": "t1-fb1"}}']) {
      cookieIs(raw);
      expect(await readChatAccounts("t1"), raw).toEqual({});
    }
  });

  it("ignores an id that is longer than any real one", async () => {
    const long = "x".repeat(121);
    cookieIs({ t1: { META_FACEBOOK: long } });
    data.loadAccountLists.mockResolvedValue({ ...listsOf("t1"), META_FACEBOOK: [ref(long)] });
    expect(await readChatAccounts("t1")).toEqual({});
  });

  it("is empty, and does not throw, outside a request", async () => {
    jar.broken = true;
    expect(await readChatAccounts("t1")).toEqual({});
  });
});

describe("validChoice", () => {
  it("keeps only what is in the lists, platform by platform", () => {
    const lists = listsOf("t1") as never;
    expect(validChoice({ META_FACEBOOK: "t1-fb1", META_INSTAGRAM: "nope", TIKTOK: "tt", YOUTUBE: "t1-yt1" }, lists)).toEqual({ META_FACEBOOK: "t1-fb1", YOUTUBE: "t1-yt1" });
  });
});

describe("writeChatAccounts", () => {
  it("saves a connected account, and answers with the choice as saved", async () => {
    const r = await writeChatAccounts("t1", { META_FACEBOOK: "t1-fb2" });
    expect(r).toEqual({ ok: true, choice: { META_FACEBOOK: "t1-fb2" } });
    expect(stored()).toEqual({ t1: { META_FACEBOOK: "t1-fb2" } });
    expect(await readChatAccounts("t1")).toEqual({ META_FACEBOOK: "t1-fb2" });
  });

  it("writes a cookie the page's scripts cannot read, that stays on this site, for six months", async () => {
    await writeChatAccounts("t1", { META_FACEBOOK: "t1-fb1" });
    expect(jar.sets).toHaveLength(1);
    expect(jar.sets[0].name).toBe(NAME);
    expect(jar.sets[0].options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 180 * 24 * 3600 });
  });

  it("refuses an id that is not connected to this workspace, and writes nothing", async () => {
    expect(await writeChatAccounts("t1", { META_FACEBOOK: "someone-elses-page" })).toEqual({ ok: false });
    expect(await writeChatAccounts("t1", { META_FACEBOOK: "t2-fb1" })).toEqual({ ok: false });
    expect(await writeChatAccounts("t1", { META_INSTAGRAM: "t1-fb1" })).toEqual({ ok: false });
    expect(await writeChatAccounts("t1", { META_FACEBOOK: "" })).toEqual({ ok: false });
    expect(jar.sets).toHaveLength(0);
    expect(jar.value).toBeUndefined();
  });

  it("refuses the whole change when one of its parts is foreign, and keeps what was saved", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    expect(await writeChatAccounts("t1", { META_INSTAGRAM: "t1-ig1", META_FACEBOOK: "forged" })).toEqual({ ok: false });
    expect(jar.sets).toHaveLength(0);
    expect(stored()).toEqual({ t1: { META_FACEBOOK: "t1-fb2" } });
  });

  it("changes one platform and leaves the others, and the other workspaces", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig2" }, t2: { META_FACEBOOK: "t2-fb1" } });
    const r = await writeChatAccounts("t1", { META_INSTAGRAM: "t1-ig1" });
    expect(r).toEqual({ ok: true, choice: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig1" } });
    expect(stored()).toEqual({ t2: { META_FACEBOOK: "t2-fb1" }, t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig1" } });
  });

  it("drops a saved choice that is no longer connected while it writes", async () => {
    cookieIs({ t1: { META_FACEBOOK: "gone", META_INSTAGRAM: "t1-ig2" } });
    const r = await writeChatAccounts("t1", { YOUTUBE: "t1-yt1" });
    expect(r).toEqual({ ok: true, choice: { META_INSTAGRAM: "t1-ig2", YOUTUBE: "t1-yt1" } });
  });

  it("goes back to the newest connection when told null, and forgets a workspace that has no choice left", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig2" }, t2: { META_FACEBOOK: "t2-fb1" } });
    expect(await writeChatAccounts("t1", { META_FACEBOOK: null })).toEqual({ ok: true, choice: { META_INSTAGRAM: "t1-ig2" } });
    expect(await writeChatAccounts("t1", { META_INSTAGRAM: null })).toEqual({ ok: true, choice: {} });
    expect(stored()).toEqual({ t2: { META_FACEBOOK: "t2-fb1" } });
  });

  it("reads the lists of the workspace it is writing for", async () => {
    await writeChatAccounts("t9", { META_FACEBOOK: "t9-fb1" });
    expect(data.loadAccountLists).toHaveBeenCalledWith("t9");
  });

  it("never grows past six workspaces: the one that was not used for longest goes", async () => {
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t6", "t7"]) await writeChatAccounts(t, { META_FACEBOOK: `${t}-fb1` });
    expect(Object.keys(stored())).toEqual(["t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(await readChatAccounts("t1")).toEqual({});
    expect(await readChatAccounts("t7")).toEqual({ META_FACEBOOK: "t7-fb1" });
  });

  it("counts a workspace that is written again as the newest, so a seventh pushes out the one used longest ago", async () => {
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t6"]) await writeChatAccounts(t, { META_FACEBOOK: `${t}-fb1` });
    await writeChatAccounts("t1", { META_FACEBOOK: "t1-fb2" });
    await writeChatAccounts("t7", { META_FACEBOOK: "t7-fb1" });
    expect(Object.keys(stored()).sort()).toEqual(["t1", "t3", "t4", "t5", "t6", "t7"]);
    expect(await readChatAccounts("t1")).toEqual({ META_FACEBOOK: "t1-fb2" });
  });

  it("keeps the cookie to six workspaces even when it arrives with more", async () => {
    cookieIs(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`w${i}`, { META_FACEBOOK: `w${i}-fb1` }])));
    await writeChatAccounts("t1", { META_FACEBOOK: "t1-fb1" });
    expect(Object.keys(stored()).length).toBeLessThanOrEqual(6);
    expect(stored().t1).toEqual({ META_FACEBOOK: "t1-fb1" });
  });
});

describe("withChatAccounts", () => {
  const seen = () => ({ fb: scopedAccount("META_FACEBOOK"), ig: scopedAccount("META_INSTAGRAM"), yt: scopedAccount("YOUTUBE") });

  it("runs a shop's work as the accounts the person chose", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2", META_INSTAGRAM: "t1-ig1" } });
    expect(await withChatAccounts("t1", "shop", async () => seen())).toEqual({ fb: "t1-fb2", ig: "t1-ig1", yt: undefined });
  });

  it("keeps the choice for the whole of an asynchronous job", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    const later = await withChatAccounts("t1", "shop", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return scopedAccount("META_FACEBOOK");
    });
    expect(later).toBe("t1-fb2");
    // and not a moment longer
    expect(scopedAccount("META_FACEBOOK")).toBeUndefined();
  });

  it("runs unscoped (the newest connection) when nothing was chosen", async () => {
    expect(await withChatAccounts("t1", "shop", async () => seen())).toEqual({ fb: undefined, ig: undefined, yt: undefined });
  });

  it("does not scope to a forged id, or to an account that is no longer connected", async () => {
    cookieIs({ t1: { META_FACEBOOK: "forged", META_INSTAGRAM: "t1-ig2" } });
    data.loadAccountLists.mockResolvedValue({ ...listsOf("t1"), META_INSTAGRAM: [ref("t1-ig1")] });
    expect(await withChatAccounts("t1", "shop", async () => seen())).toEqual({ fb: undefined, ig: undefined, yt: undefined });
  });

  it("uses only the choice made in this workspace", async () => {
    cookieIs({ t2: { META_FACEBOOK: "t2-fb1" } });
    expect((await withChatAccounts("t1", "shop", async () => seen())).fb).toBeUndefined();
  });

  it("lets a news desk through as it is: it never reads the cookie, even when one is there", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    const out = await withChatAccounts("t1", "news", async () => ({ ...seen(), answer: 42 }));
    expect(out).toEqual({ fb: undefined, ig: undefined, yt: undefined, answer: 42 });
    expect(jar.reads).toBe(0);
    expect(data.loadAccountLists).not.toHaveBeenCalled();
  });

  it("still runs the work when the choice cannot be read", async () => {
    jar.broken = true;
    expect(await withChatAccounts("t1", "shop", async () => "done")).toBe("done");
    jar.broken = false;
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    data.loadAccountLists.mockRejectedValue(new Error("db down"));
    expect(await withChatAccounts("t1", "shop", async () => seen())).toEqual({ fb: undefined, ig: undefined, yt: undefined });
  });

  it("hands back what the work answered, and what it failed with", async () => {
    cookieIs({ t1: { META_FACEBOOK: "t1-fb2" } });
    expect(await withChatAccounts("t1", "shop", async () => 7)).toBe(7);
    await expect(
      withChatAccounts("t1", "shop", async () => {
        throw new Error("the work failed");
      }),
    ).rejects.toThrow("the work failed");
  });
});
