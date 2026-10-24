// Which platforms an AI video can really go to: the store's Facebook Page and Instagram account, and the workspace's YouTube channel.
// Read-only: it asks the database what is connected and never touches a token, a platform or the network.

import { db } from "@/lib/db";
import { usableOrRefreshable } from "@/lib/oauth/pick";
import type { Target } from "./prepare";

/**
 * The connected YouTube channels of a workspace, as the publisher sees them (src/lib/merchant/publish-core.ts publishes to the newest
 * connection, or asks for a pick when there are several; src/app/app/data.ts loadAccountLists lists the same rows): a YouTube connection
 * that is still usable or can be refreshed, other than the one whose channel could not be read when it was connected ("unknown"). One id
 * per channel, oldest first. Never throws: a database that does not answer gives no channel.
 */
export async function youtubeChannels(tenantId: string): Promise<string[]> {
  try {
    const rows = await db.oAuthCredential.findMany({
      where: { tenantId, provider: "YOUTUBE", NOT: { providerAccountId: "unknown" }, ...usableOrRefreshable() },
      orderBy: { createdAt: "asc" },
      select: { providerAccountId: true },
    });
    const ids: string[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = (r as { providerAccountId?: unknown } | null)?.providerAccountId;
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Of the platforms `wanted`, the ones this store can be posted to now: Facebook when the store has a Page, Instagram when it has an
 * Instagram account, YouTube when the workspace has a YouTube connection. The order of `wanted` is kept, without repeats, and anything
 * that is not one of the three is dropped. (With several YouTube channels YouTube stays in: the publisher then says why it did not pick one.)
 */
export async function connectedVideoTargets(
  tenantId: string,
  store: { fbPageId: string | null; igUserId: string | null },
  wanted: Target[],
): Promise<Target[]> {
  const asked = [...new Set((Array.isArray(wanted) ? wanted : []).filter((t): t is Target => t === "FB" || t === "IG" || t === "YT"))];
  const out: Target[] = [];
  for (const t of asked) {
    if (t === "FB" && store?.fbPageId) out.push(t);
    else if (t === "IG" && store?.igUserId) out.push(t);
    else if (t === "YT" && (await youtubeChannels(tenantId)).length > 0) out.push(t);
  }
  return out;
}
