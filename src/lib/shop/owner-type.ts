// Who is using Gituas: someone who SELLS (products, orders, buyers) or a CREATOR who earns from content (views, audience, monetizing a
// page of stories, videos). The owner says it themselves in the setup question ("how does your page earn for you?"): selling, monetize,
// other. A creator is not a seller with fewer products: the chat, the menu and the shortcuts must not talk about orders, prices and
// delivery to someone who makes stories. Nothing here decides anything about the person that they did not say.

import { db } from "@/lib/db";
import { profileEnabled } from "./profile-shared";

export type OwnerType = "creator" | "seller" | "unknown";

/** From the goals the owner gave (one per group). Any seller goal makes a seller; audience goals only make a creator; nothing known stays unknown. */
export function ownerTypeOf(goals: readonly (string | null | undefined)[]): OwnerType {
  const g = goals.filter((x): x is string => !!x);
  if (g.some((x) => x === "sell" || x === "leads")) return "seller";
  if (g.some((x) => x === "monetize" || x === "grow")) return "creator";
  return "unknown";
}

/** The workspace's owner type, from the goals saved in its groups' profiles (read errors and a switched-off interview give "unknown"). */
export async function loadOwnerType(tenantId: string): Promise<OwnerType> {
  if (!profileEnabled()) return "unknown";
  try {
    const rows = await db.businessProfile.findMany({ where: { store: { tenantId } }, select: { goal: true }, take: 30 });
    return ownerTypeOf(rows.map((r) => r.goal));
  } catch {
    return "unknown";
  }
}
