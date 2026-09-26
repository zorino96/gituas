import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { countUsage } from "@/lib/billing/limits";

/** Store each platform's result on the draft; the first success marks the story published. */
export async function recordNewsPublish(
  tenantId: string,
  draftId: string,
  results: Array<{ target: string; ok: boolean; url?: string; publishId?: string; error?: string }>,
): Promise<void> {
  const draft = await db.newsDraft.findFirst({ where: { id: draftId, tenantId }, select: { id: true, itemId: true, publishedAt: true } });
  if (!draft) return;
  const anyOk = results.some((r) => r.ok);
  await db.newsDraft.update({
    where: { id: draft.id },
    data: { results: results as unknown as Prisma.InputJsonValue, ...(anyOk && !draft.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  if (anyOk) {
    await db.newsItem.update({ where: { id: draft.itemId }, data: { status: "PUBLISHED" } });
    await countUsage(tenantId, "publish");
  }
}
