// Which connected account the chat acts as, when the shop connected several Facebook Pages, Instagram accounts, TikTok or YouTube
// channels. The choice is the person's, made inside the chat (the Accounts sheet, or the chat's own account card); it lives in a
// cookie of their browser, one entry per workspace, and every chat request runs inside `withAccounts(choice, ...)` so each tool picks
// that account (the same mechanism the Comments, Messages and Insights pages use with ?fb=&ig=). Only accounts that are really connected
// to the workspace are accepted: a made-up id in the cookie is ignored, never used.

import { cookies } from "next/headers";

import { loadAccountLists, type AccountLists } from "@/app/app/data";
import { withAccounts, type AccountChoice, type ScopedProvider } from "@/lib/oauth/account-scope";

export const ACCOUNT_COOKIE = "gm_chat_accounts";
const MAX_WORKSPACES = 6;
const MAX_AGE_S = 180 * 24 * 3600;
const PROVIDERS: readonly ScopedProvider[] = ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"];

type Stored = Record<string, Partial<Record<ScopedProvider, string>>>;

function parse(raw: string | undefined): Stored {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Stored = {};
    for (const [tenantId, entry] of Object.entries(v as Record<string, unknown>).slice(0, MAX_WORKSPACES)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const clean: Partial<Record<ScopedProvider, string>> = {};
      for (const p of PROVIDERS) {
        const id = (entry as Record<string, unknown>)[p];
        if (typeof id === "string" && id.length > 0 && id.length <= 120) clean[p] = id;
      }
      out[tenantId.slice(0, 60)] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps only the ids that are connected to this workspace right now. */
export function validChoice(choice: AccountChoice, lists: AccountLists): AccountChoice {
  const out: AccountChoice = {};
  for (const p of PROVIDERS) {
    const id = choice[p];
    if (id && lists[p].some((a) => a.id === id)) out[p] = id;
  }
  return out;
}

/** The person's saved choice for this workspace, checked against the accounts that are connected (nothing saved = {}). */
export async function readChatAccounts(tenantId: string, lists?: AccountLists): Promise<AccountChoice> {
  let stored: Stored = {};
  try {
    stored = parse((await cookies()).get(ACCOUNT_COOKIE)?.value);
  } catch {
    return {};
  }
  const mine = stored[tenantId];
  if (!mine || !Object.keys(mine).length) return {};
  return validChoice(mine, lists ?? (await loadAccountLists(tenantId)));
}

/**
 * Saves the choice of one or more platforms (an id, or null to go back to the newest connection). An id that is not connected to this
 * workspace is refused. Returns the choice as saved.
 */
export async function writeChatAccounts(tenantId: string, patch: Partial<Record<ScopedProvider, string | null>>): Promise<{ ok: true; choice: AccountChoice } | { ok: false }> {
  const lists = await loadAccountLists(tenantId);
  const jar = await cookies();
  const stored = parse(jar.get(ACCOUNT_COOKIE)?.value);
  const next: AccountChoice = validChoice(stored[tenantId] ?? {}, lists);
  for (const p of PROVIDERS) {
    if (!(p in patch)) continue;
    const id = patch[p];
    if (id === null) delete next[p];
    else if (typeof id === "string" && lists[p].some((a) => a.id === id)) next[p] = id;
    else return { ok: false };
  }
  // The newest workspaces stay; the cookie never grows. This workspace goes to the end even if it was there already (a key that is spread
  // over keeps its old place), so a workspace used just now is never the one a seventh pushes out.
  const others = { ...stored };
  delete others[tenantId];
  const entries = Object.entries({ ...others, [tenantId]: next }).filter(([, v]) => Object.keys(v).length > 0);
  const kept = Object.fromEntries(entries.slice(-MAX_WORKSPACES));
  jar.set(ACCOUNT_COOKIE, JSON.stringify(kept), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE_S });
  return { ok: true, choice: next };
}

/** Runs `fn` as the accounts the person chose for the chat in this workspace (a shop only; a desk names its accounts in its tools). */
export async function withChatAccounts<T>(tenantId: string, kind: "shop" | "news", fn: () => Promise<T>): Promise<T> {
  if (kind !== "shop") return fn();
  const choice = await readChatAccounts(tenantId).catch(() => ({}) as AccountChoice);
  return Object.keys(choice).length ? withAccounts(choice, fn) : fn();
}
