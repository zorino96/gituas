import { db } from "@/lib/db";
import { accountFor, subscribeWebhooks, type MetaPlatform } from "./meta-client";

type StoreSlots = { id: string; fbPageId: string | null; igUserId: string | null };

/**
 * Which existing store a newly connected account joins. Only a tenant with
 * exactly one store, whose slot for this platform is empty, is unambiguous;
 * anything else gets a new store (the operator can merge later).
 */
export function pickStoreForAccount(stores: StoreSlots[], platform: MetaPlatform): string | null {
  if (stores.length !== 1) return null;
  const only = stores[0];
  const free = platform === "META_FACEBOOK" ? !only.fbPageId : !only.igUserId;
  return free ? only.id : null;
}

/**
 * Called after a Page or Instagram credential is saved. It creates or links the
 * merchant's store, clears a token pause, and subscribes the account to
 * webhooks. Newsroom workspaces are skipped. It never throws into the connect
 * flow; the caller catches.
 */
export async function connectStore(tenantId: string, platform: MetaPlatform, accountId: string, accountName: string): Promise<string | null> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
  if (tenant?.kind !== "MERCHANT") return null;

  const slot = platform === "META_FACEBOOK" ? { fbPageId: accountId } : { igUserId: accountId };
  const extra = platform === "META_INSTAGRAM" ? { igUsername: accountName.replace(/^@/, "") } : {};

  let store = await db.store.findFirst({ where: slot, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } });
  if (store && store.tenantId !== tenantId) return null; // this account already runs another workspace's store
  if (!store) {
    const stores = await db.store.findMany({ where: { tenantId }, select: { id: true, fbPageId: true, igUserId: true } });
    const target = pickStoreForAccount(stores, platform);
    store = target
      ? await db.store.update({ where: { id: target }, data: { ...slot, ...extra }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } })
      : await db.store.create({ data: { tenantId, name: accountName, ...slot, ...extra }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } });
  }
  await db.store.update({ where: { id: store.id }, data: { pausedReason: null, ...extra } });

  const acc = await accountFor(store, platform);
  if (acc && (await subscribeWebhooks(acc)).ok) {
    await db.store.update({ where: { id: store.id }, data: { webhooksAt: new Date() } });
  }
  return store.id;
}
