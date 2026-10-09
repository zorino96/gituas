// Deleting what we stored from one connected account, when it is disconnected or the platform asks
// us to delete a user's data (Meta Platform Terms 3(d)(i); our privacy policy promises it).

import { db } from "@/lib/db";

export type MessagePlatform = "META_FACEBOOK" | "META_INSTAGRAM" | "WHATSAPP";

const storeSlot = (platform: MessagePlatform, accountId: string) =>
  platform === "META_FACEBOOK" ? { fbPageId: accountId } : platform === "META_INSTAGRAM" ? { igUserId: accountId } : { waPhoneNumberId: accountId };

/**
 * Delete the comments and messages stored from one account, with their send jobs. Call it before
 * the store's slot for the account is cleared. Older dashboard projects do not record which account
 * a message came in on, so theirs go only once no account of that platform is left.
 */
export async function forgetStoredMessages(tenantId: string, platform: MessagePlatform, accountId: string): Promise<number> {
  const stores = await db.store.findMany({ where: { tenantId, ...storeSlot(platform, accountId) }, select: { id: true } });
  let count = 0;
  if (stores.length) {
    count += (await db.conversationMessage.deleteMany({ where: { storeId: { in: stores.map((s) => s.id) }, platform } })).count;
  }
  const left = await db.oAuthCredential.count({ where: { tenantId, provider: platform === "WHATSAPP" ? "META_WHATSAPP" : platform } });
  if (!left) count += (await db.conversationMessage.deleteMany({ where: { platform, project: { tenantId } } })).count;
  return count;
}
