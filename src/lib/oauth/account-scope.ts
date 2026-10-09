// Which connected account a piece of server work acts as, when a workspace has
// several per platform (Facebook Pages, Instagram accounts, TikTok, YouTube).
//
// Every credential picker (loadFbCred, loadCred, tiktokToken, youTubeCredential,
// loadConnections) adds `accountWhere(provider)` to its query. Inside
// `withAccounts({...}, fn)` that narrows it to the chosen account; outside it
// nothing changes and the newest connection is used, as before.
import { AsyncLocalStorage } from "node:async_hooks";

export type ScopedProvider = "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK" | "YOUTUBE";
export type AccountChoice = Partial<Record<ScopedProvider, string>>;

const scope = new AsyncLocalStorage<AccountChoice>();

/** Run `fn` acting as these accounts (merged over any outer choice). Empty ids are ignored. */
export function withAccounts<T>(accounts: AccountChoice, fn: () => Promise<T>): Promise<T> {
  const chosen: AccountChoice = { ...(scope.getStore() ?? {}) };
  for (const [provider, id] of Object.entries(accounts) as [ScopedProvider, string | undefined][]) {
    if (typeof id === "string" && id.trim()) chosen[provider] = id.trim();
  }
  return scope.run(chosen, fn);
}

/** The account chosen for this provider in the current work, if any. */
export function scopedAccount(provider: ScopedProvider): string | undefined {
  return scope.getStore()?.[provider];
}

/** Prisma where-fragment narrowing a credential lookup to the chosen account. */
export function accountWhere(provider: ScopedProvider): { providerAccountId?: string } {
  const id = scopedAccount(provider);
  return id ? { providerAccountId: id } : {};
}
