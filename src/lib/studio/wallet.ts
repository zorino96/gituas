// A shop's prepaid Studio balance, in IQD. It only grows through a paid Wayl top-up (Invoice
// product STUDIO, applied in src/lib/billing/invoices.ts) or an owner adjustment, and only shrinks
// when a picture starts; a failed or blocked picture gives its price back. Every change is a row in
// StudioLedger, so the balance can always be explained.

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient;

export async function walletBalance(tenantId: string): Promise<number> {
  const w = await db.studioWallet.findUnique({ where: { tenantId }, select: { balanceIqd: true } });
  return w?.balanceIqd ?? 0;
}

/** Take `amount` IQD for a picture if the balance covers it. Atomic: two pictures at once cannot spend the same dinars. */
export async function chargeWallet(tenantId: string, amount: number, assetId: string): Promise<boolean> {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  return db.$transaction(async (tx) => {
    const r = await tx.studioWallet.updateMany({ where: { tenantId, balanceIqd: { gte: amount } }, data: { balanceIqd: { decrement: amount } } });
    if (r.count !== 1) return false;
    await tx.studioLedger.create({ data: { tenantId, deltaIqd: -amount, reason: "IMAGE", assetId } });
    return true;
  });
}

/** Give a picture's price back (it failed or was blocked). */
export async function refundWallet(tenantId: string, amount: number, assetId: string): Promise<void> {
  if (!Number.isInteger(amount) || amount <= 0) return;
  await db.$transaction(async (tx) => {
    await tx.studioWallet.upsert({ where: { tenantId }, create: { tenantId, balanceIqd: amount }, update: { balanceIqd: { increment: amount } } });
    await tx.studioLedger.create({ data: { tenantId, deltaIqd: amount, reason: "REFUND", assetId } });
  });
}

/** Add a paid top-up, inside the transaction that marks its invoice PAID (so it is added exactly once). */
export async function topUpWallet(tx: Tx, tenantId: string, amount: number, invoiceId: string): Promise<void> {
  await tx.studioWallet.upsert({ where: { tenantId }, create: { tenantId, balanceIqd: amount }, update: { balanceIqd: { increment: amount } } });
  await tx.studioLedger.create({ data: { tenantId, deltaIqd: amount, reason: "TOPUP", invoiceId } });
}
