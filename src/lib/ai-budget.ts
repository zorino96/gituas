import { db } from "./db";

// Tracks per-tenant daily AI call counts/tokens. AiUsage has one row per
// (tenantId, date) — we upsert and increment.

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function assertAiBudget(tenantId: string): Promise<void> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { aiDailyCap: true },
  });
  if (!tenant?.aiDailyCap) return;

  const usage = await db.aiUsage.findUnique({
    where: { tenantId_date: { tenantId, date: today() } },
    select: { totalInputTokens: true, totalOutputTokens: true },
  });
  const sum = (usage?.totalInputTokens ?? 0) + (usage?.totalOutputTokens ?? 0);
  if (sum >= tenant.aiDailyCap) {
    throw new Error(`Daily AI budget exceeded (${sum}/${tenant.aiDailyCap} tokens)`);
  }
}

export async function recordAiCall(
  tenantId: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  try {
    await db.aiUsage.upsert({
      where: { tenantId_date: { tenantId, date: today() } },
      create: {
        tenantId,
        date: today(),
        callCount: 1,
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
      },
      update: {
        callCount: { increment: 1 },
        totalInputTokens: { increment: usage.inputTokens },
        totalOutputTokens: { increment: usage.outputTokens },
      },
    });
  } catch {
    // best-effort logging only
  }
}
