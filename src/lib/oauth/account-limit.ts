// How many accounts of one platform a workspace may connect, by its plan.
//
// Connecting several Pages / Instagram accounts / channels is allowed by the platforms; what the
// cap guards against is a free workspace holding dozens of businesses on free automation, and a
// long list of near-identical accounts that spam systems read as a network. Only NEW accounts are
// counted: reconnecting one that is already there always works, and nothing is removed when a
// plan lapses.

import type { OAuthProvider } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/** The providers whose accounts are counted (not ad accounts, WhatsApp numbers or the legacy ones). */
const COUNTED: readonly string[] = ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"];

/** Per platform, by the best plan among the workspace's stores. */
export const SHOP_ACCOUNT_CAP: Record<string, number> = { FREE: 2, MERCHANT: 5, PRO: 15 };
/** Per platform, by the newsroom's plan. */
export const NEWS_ACCOUNT_CAP: Record<string, number> = { LITE: 2, MANUAL: 3, AUTO: 5, ENTERPRISE: 20 };

/** The cap for a workspace kind and its plan(s); null when the kind has none. */
export function accountCap(kind: string, plans: readonly string[]): number | null {
  if (kind === "MERCHANT") return Math.max(SHOP_ACCOUNT_CAP.FREE, ...plans.map((p) => SHOP_ACCOUNT_CAP[p] ?? 0));
  if (kind === "NEWS") return NEWS_ACCOUNT_CAP[plans[0] ?? ""] ?? NEWS_ACCOUNT_CAP.MANUAL;
  return null;
}

export class AccountLimitError extends Error {
  constructor(public readonly cap: number) {
    super("account_limit");
  }
}

/** Whether these account ids fit under the cap, counting only the ones not connected yet. */
export async function accountRoom(tenantId: string, provider: OAuthProvider, accountIds: string[]): Promise<{ ok: true } | { ok: false; cap: number; have: number }> {
  if (!COUNTED.includes(provider)) return { ok: true };
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true } });
  if (!tenant) return { ok: true };
  const plans = tenant.kind === "MERCHANT" ? (await db.store.findMany({ where: { tenantId }, select: { plan: true } })).map((s) => s.plan as string) : [tenant.plan as string];
  const cap = accountCap(tenant.kind, plans);
  if (cap == null) return { ok: true };
  const rows = await db.oAuthCredential.findMany({ where: { tenantId, provider }, select: { providerAccountId: true } });
  const have = new Set(rows.map((r) => r.providerAccountId).filter((id) => id !== "unknown" && !id.startsWith("act_")));
  const fresh = [...new Set(accountIds)].filter((id) => !have.has(id));
  if (!fresh.length) return { ok: true };
  return have.size + fresh.length <= cap ? { ok: true } : { ok: false, cap, have: have.size };
}
