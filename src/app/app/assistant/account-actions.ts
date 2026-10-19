"use server";

// The chat's Accounts sheet: which Facebook Pages, Instagram accounts, TikTok accounts and YouTube channels are connected, which one the
// chat works with, and the choice of another. The choice itself is kept by src/lib/chat/accounts.ts (a cookie of the person's browser,
// checked against what is connected); these actions only put the session in front of it. The person, the role and the workspace come
// from the session, never from the request.

import { z } from "zod";

import { loadAccountLists, loadConnections, type Provider } from "@/app/app/data";
import { readChatAccounts, writeChatAccounts } from "@/lib/chat/accounts";
import type { Actor } from "@/lib/chat/confirm";
import { actorFromSession } from "@/lib/chat/session";
import type { ChatErrorCode, ChatKind } from "@/lib/chat/types";
import { db } from "@/lib/db";
import { can } from "@/lib/newsroom/roles";
import { withAccounts, type AccountChoice } from "@/lib/oauth/account-scope";

export type AccountPlatform = "FB" | "IG" | "TT" | "YT";

export interface AccountItem {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface ChatAccountsState {
  ok: true;
  kind: ChatKind;
  /** Every connected account, per platform, oldest first. */
  lists: Record<AccountPlatform, AccountItem[]>;
  /** The account the chat works with, per platform (null: none connected, or a desk, which names its accounts in its tools). */
  selected: Record<AccountPlatform, string | null>;
  canConfigure: boolean;
}

export type ChatAccountsResult = ChatAccountsState | { ok: false; code: ChatErrorCode };

const PLATFORMS = ["FB", "IG", "TT", "YT"] as const;
const PROVIDER: Record<AccountPlatform, Provider> = { FB: "META_FACEBOOK", IG: "META_INSTAGRAM", TT: "TIKTOK", YT: "YOUTUBE" };

// Only a Facebook Page and an Instagram account can be chosen: the chat has no TikTok or YouTube tool to act as them with, so a choice there
// would promise something it cannot do (the screen offers none; the same list is CHOOSABLE in chat-accounts.tsx).
const CHOOSABLE = ["FB", "IG"] as const;

const ChooseInput = z.object({
  platform: z.enum(CHOOSABLE),
  id: z.string().min(1).max(120),
  workspaceId: z.string().max(80).optional(),
});

/** A picture address from the platform is only drawn when it is https; a name is cut to a length a row can hold. */
const avatarOf = (url: string | null): string | null => (typeof url === "string" && url.length <= 2000 && /^https:\/\//i.test(url) ? url : null);
const nameOf = (name: string): string => (Array.from(name).length > 80 ? `${Array.from(name).slice(0, 79).join("")}…` : name);

type Gate = { ok: true; actor: Actor } | { ok: false; code: ChatErrorCode };

/** The session's person and workspace, when they may configure (connect and switch accounts). A tab left on another workspace is told so. */
async function gate(workspaceId: unknown): Promise<Gate> {
  const who = await actorFromSession();
  if (!who.ok) return { ok: false, code: who.code };
  if (typeof workspaceId === "string" && workspaceId !== who.actor.tenantId) return { ok: false, code: "workspace" };
  if (!can(who.actor.role, "configure")) return { ok: false, code: "forbidden" };
  return { ok: true, actor: who.actor };
}

/**
 * The lists and the chosen accounts of this workspace. `choice` is the choice just saved (the cookie written in this very request is not
 * read back); without it the saved choice is read. A desk has no choice: its tools name their accounts.
 */
async function stateOf(actor: Actor, choice?: AccountChoice): Promise<ChatAccountsState> {
  const lists = await loadAccountLists(actor.tenantId);
  const view = {} as Record<AccountPlatform, AccountItem[]>;
  const selected = { FB: null, IG: null, TT: null, YT: null } as Record<AccountPlatform, string | null>;
  for (const p of PLATFORMS) view[p] = lists[PROVIDER[p]].map((a) => ({ id: a.id, name: nameOf(a.name), avatarUrl: avatarOf(a.avatarUrl) }));
  if (actor.kind === "shop") {
    // What every tool of the chat acts as right now: the saved choice, else the newest connection (what loadConnections picks).
    const saved = choice ?? (await readChatAccounts(actor.tenantId, lists).catch(() => ({}) as AccountChoice));
    const conns = await withAccounts(saved, () => loadConnections(actor.tenantId));
    for (const p of PLATFORMS) {
      const id = conns[PROVIDER[p]].accountId;
      selected[p] = id && lists[PROVIDER[p]].some((a) => a.id === id) ? id : null;
    }
  }
  return { ok: true, kind: actor.kind, lists: view, selected, canConfigure: can(actor.role, "configure") };
}

export async function listChatAccountsAction(input?: { /** The workspace the screen was opened for. */ workspaceId?: string }): Promise<ChatAccountsResult> {
  const g = await gate(input?.workspaceId);
  if (!g.ok) return g;
  try {
    return await stateOf(g.actor);
  } catch {
    return { ok: false, code: "internal" };
  }
}

/** The chat works with this Facebook Page or Instagram account from now on (a shop only). An id that is not connected to the workspace is refused. */
export async function chooseChatAccountAction(input: { platform: AccountPlatform; id: string; workspaceId?: string }): Promise<ChatAccountsResult> {
  const g = await gate((input as { workspaceId?: unknown } | null)?.workspaceId);
  if (!g.ok) return g;
  const parsed = ChooseInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "badrequest" };
  // A desk names its accounts in its tools; there is nothing for the chat to switch.
  if (g.actor.kind !== "shop") return { ok: false, code: "forbidden" };
  const { platform, id } = parsed.data;
  try {
    const patch: Partial<Record<Provider, string | null>> = {};
    patch[PROVIDER[platform]] = id;
    const saved = await writeChatAccounts(g.actor.tenantId, patch);
    if (!saved.ok) return { ok: false, code: "not_found" };
    const state = await stateOf(g.actor, saved.choice);
    // Written down: which account the chat acts as decides where its posts and replies go.
    await db.auditLog
      .create({
        data: {
          tenantId: g.actor.tenantId,
          actor: "USER",
          action: "chat.account",
          metadata: { platform, accountId: id, name: state.lists[platform].find((a) => a.id === id)?.name ?? "", userId: g.actor.userId },
        },
      })
      .catch(() => undefined);
    return state;
  } catch {
    return { ok: false, code: "internal" };
  }
}
