// A store is named after its account when it is made ("NSFW", the name the Page had then). The Page is renamed afterwards ("The Secret File")
// and the store keeps the old name: every screen, card and answer that names the store then shows a name the owner no longer knows. The
// app has no screen that renames a store, so its name only ever follows its accounts: this brings it back in line, when it is seen to differ.

import { db } from "@/lib/db";

export interface NamedStore {
  id: string;
  name: string;
  igUsername: string | null;
  fbPageId: string | null;
  igUserId: string | null;
}
export interface AccountName {
  provider: string;
  providerAccountId: string;
  providerAccountName: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/** The name a store should carry: its Facebook Page's name, else its Instagram handle; null when it has no account that tells. */
export function wantedName(s: NamedStore, accounts: readonly AccountName[]): string | null {
  const fb = s.fbPageId ? clean(accounts.find((a) => a.provider === "META_FACEBOOK" && a.providerAccountId === s.fbPageId)?.providerAccountName) : "";
  if (fb) return fb;
  if (!s.igUserId) return null;
  if (s.igUsername) return `@${s.igUsername}`;
  const ig = clean(accounts.find((a) => a.provider === "META_INSTAGRAM" && a.providerAccountId === s.igUserId)?.providerAccountName);
  return ig ? (ig.startsWith("@") ? ig : `@${ig}`) : null;
}

/**
 * Renames the stores whose name is not their accounts' name, in this workspace only, and returns the new names by store id (the
 * stores that were already right are not in it). A rename that fails is skipped: the old name stands.
 */
export async function healStoreNames(tenantId: string, stores: readonly NamedStore[], accounts: readonly AccountName[]): Promise<Map<string, string>> {
  const renamed = new Map<string, string>();
  for (const s of stores) {
    const want = wantedName(s, accounts);
    if (!want || want === s.name) continue;
    // The old name is part of the condition: a store renamed by someone else meanwhile is left alone.
    const done = await Promise.resolve()
      .then(() => db.store.updateMany({ where: { id: s.id, tenantId, name: s.name }, data: { name: want } }))
      .catch(() => ({ count: 0 }));
    if (done.count) renamed.set(s.id, want);
  }
  return renamed;
}

/** healStoreNames for a whole workspace (it reads the stores and the accounts' names itself). */
export async function healTenantStoreNames(tenantId: string): Promise<Map<string, string>> {
  const stores = await db.store.findMany({ where: { tenantId }, take: 15, select: { id: true, name: true, igUsername: true, fbPageId: true, igUserId: true } });
  const ids = stores.flatMap((s) => [s.fbPageId, s.igUserId]).filter((x): x is string => !!x);
  if (!ids.length) return new Map();
  const accounts = await db.oAuthCredential.findMany({ where: { tenantId, providerAccountId: { in: ids } }, select: { provider: true, providerAccountId: true, providerAccountName: true } });
  return healStoreNames(tenantId, stores, accounts);
}
