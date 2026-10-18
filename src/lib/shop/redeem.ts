import { takeDaily } from "@/lib/ai/slots";
import { db } from "@/lib/db";
import { codeProblem, DESK_COMP_UNTIL, hashCode, looksLikeCode } from "./redeem-code";

export type RedeemResult = { ok: true; stores: number; already: boolean } | { ok: false; error: "invalid" | "rate" | "failed" };

/** Tries a person (and a workspace) may make a day: a code is long and random, but nobody should be able to guess at it. */
const TRIES_PER_DAY = 10;

/**
 * Redeems a code for a workspace: every store of a shop workspace goes to UNLIMITED (and stores connected later are born
 * UNLIMITED), a news desk goes to Enterprise paid up to 2099. A code that is revoked, expired, used up or unknown gives the
 * same answer, so a guess learns nothing. Redeeming the same code twice in one workspace changes nothing.
 */
export async function redeemCode(opts: { tenantId: string; userId: string; kind: string; raw: string }): Promise<RedeemResult> {
  const { tenantId, userId, kind, raw } = opts;
  let tries: number[];
  try {
    tries = await Promise.all([takeDaily(tenantId, "redeem_try", 1, TRIES_PER_DAY), takeDaily(userId, "redeem_try", 1, TRIES_PER_DAY)]);
  } catch (e) {
    // A database fault is "try again", not "wait until tomorrow".
    console.error("redeem counter failed", e instanceof Error ? e.name : e);
    return { ok: false, error: "failed" };
  }
  if (tries.some((n) => n < 1)) return { ok: false, error: "rate" };
  if (!looksLikeCode(raw)) return { ok: false, error: "invalid" };

  const codeHash = hashCode(raw);
  try {
    return await db.$transaction(async (tx) => {
      const now = new Date();
      // One redemption at a time for a workspace: a second request at the same moment then sees the first one's row and answers "already".
      await tx.$queryRaw`SELECT 1 FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
      const code = await tx.redeemCode.findUnique({ where: { codeHash } });
      const again = code ? await tx.redemption.findUnique({ where: { codeId_tenantId: { codeId: code.id, tenantId } }, select: { id: true } }) : null;
      if (code && again && !code.revokedAt) {
        // Already redeemed here: say so, and make sure the plan is still in place.
        const stores = await grant(tx, tenantId, kind);
        return { ok: true as const, stores, already: true };
      }
      if (!code || codeProblem(code, now)) return { ok: false as const, error: "invalid" as const };
      // Take the place first, so two people redeeming the last use at the same moment cannot both get it.
      const taken = await tx.redeemCode.updateMany({ where: { id: code.id, revokedAt: null, uses: { lt: code.maxUses } }, data: { uses: { increment: 1 } } });
      if (taken.count !== 1) return { ok: false as const, error: "invalid" as const };
      await tx.redemption.create({ data: { codeId: code.id, tenantId, userId } });
      const stores = await grant(tx, tenantId, kind);
      // A payment link made before the code is no longer payable: it could not change the plan any more.
      if (kind !== "NEWS") await tx.invoice.updateMany({ where: { tenantId, product: "SHOP", status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.auditLog.create({
        data: { tenantId, actor: "USER", action: "billing.test_code", reasoning: "Redeemed a test code: no limits on this workspace.", metadata: { codeId: code.id, stores } },
      });
      return { ok: true as const, stores, already: false };
    });
  } catch (e) {
    console.error("redeem failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "failed" };
  }
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function grant(tx: Tx, tenantId: string, kind: string): Promise<number> {
  if (kind === "NEWS") {
    await tx.tenant.update({ where: { id: tenantId }, data: { unlimited: true, plan: "ENTERPRISE", planPaidUntil: DESK_COMP_UNTIL } });
    return 0;
  }
  await tx.tenant.update({ where: { id: tenantId }, data: { unlimited: true } });
  const r = await tx.store.updateMany({ where: { tenantId }, data: { plan: "UNLIMITED", planPaidUntil: null } });
  return r.count;
}

/** Whether a workspace has redeemed a code (false when the column is not there yet, so Settings still opens). */
export async function isUnlimited(tenantId: string): Promise<boolean> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { unlimited: true } }).catch(() => null);
  return !!t?.unlimited;
}
