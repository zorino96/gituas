// What a store is called in the pickers of the shop screens (Products, Automation, Autopilot, Video, Billing). A store is named after its
// account when it is made; the Page can be renamed later and accounts can be moved between stores, so the stored name is often old
// ("NSFW" for a store that now holds the Page "The Secret File"). The pickers say which accounts a store holds, by the names they have now.
// A store that holds no account is left out as long as another one does (it is an empty shell), unless it is the one being looked at.

import { db } from "@/lib/db";

export interface StoreRow {
  id: string;
  name: string;
  igUsername: string | null;
  fbPageId: string | null;
  igUserId: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** The label of every store, by id (nothing left out). */
export async function storeLabelMap(tenantId: string, stores: StoreRow[]): Promise<Map<string, string>> {
  const ids = stores.flatMap((s) => [s.fbPageId, s.igUserId]).filter((x): x is string => !!x);
  const rows = ids.length
    ? await Promise.resolve()
        .then(() => db.oAuthCredential.findMany({ where: { tenantId, providerAccountId: { in: ids } }, select: { provider: true, providerAccountId: true, providerAccountName: true } }))
        .catch(() => [] as { provider: string; providerAccountId: string; providerAccountName: string | null }[])
    : [];
  const nameOf = (provider: string, id: string | null) => (id ? clean(rows.find((r) => r.provider === provider && r.providerAccountId === id)?.providerAccountName) : "");
  const label = (s: StoreRow): string => {
    const fb = s.fbPageId ? nameOf("META_FACEBOOK", s.fbPageId) || "Facebook" : "";
    const igName = s.igUserId ? (s.igUsername ? `@${s.igUsername}` : nameOf("META_INSTAGRAM", s.igUserId)) || "Instagram" : "";
    const parts = [fb, igName].filter(Boolean);
    return parts.length ? parts.join(" + ") : clean(s.name) || (s.igUsername ? `@${s.igUsername}` : "—");
  };
  return new Map(stores.map((s) => [s.id, label(s)]));
}

/** One entry per store for a picker, with the names of its accounts; a store with no account is left out (unless it is `keepId`) while another has one. */
export async function storeChoices(tenantId: string, stores: StoreRow[], keepId?: string): Promise<{ id: string; name: string }[]> {
  const labels = await storeLabelMap(tenantId, stores);
  const holds = (s: StoreRow) => !!s.fbPageId || !!s.igUserId;
  const anyHolds = stores.some(holds);
  return stores.filter((s) => !anyHolds || holds(s) || s.id === keepId).map((s) => ({ id: s.id, name: labels.get(s.id) ?? s.name }));
}
