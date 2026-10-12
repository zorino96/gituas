import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { countUsage } from "@/lib/billing/limits";

export interface PublishResult {
  target: string;
  ok: boolean;
  accountId?: string;
  accountName?: string;
  url?: string;
  publishId?: string;
  error?: string;
}

const resultKey = (r: PublishResult) => `${r.target}:${r.accountId ?? ""}`;

/** The draft's earlier results with the new ones added; a result for the same platform and account replaces the old one. */
export function mergeResults(existing: unknown, incoming: PublishResult[]): PublishResult[] {
  const old = Array.isArray(existing) ? (existing as PublishResult[]).filter((r) => r && typeof r.target === "string") : [];
  const replaced = new Set(incoming.map(resultKey));
  return [...old.filter((r) => !replaced.has(resultKey(r))), ...incoming];
}

/**
 * Store each platform's result on the draft; the first success marks the story published.
 * A `continuation` is the later part of a story the autopilot spread over several Pages: its results
 * are added to the ones already stored, and the story is not counted against the quota again.
 */
export async function recordNewsPublish(
  tenantId: string,
  draftId: string,
  results: PublishResult[],
  opts: { continuation?: boolean } = {},
): Promise<void> {
  const draft = await db.newsDraft.findFirst({ where: { id: draftId, tenantId }, select: { id: true, itemId: true, publishedAt: true, results: true } });
  if (!draft) return;
  const anyOk = results.some((r) => r.ok);
  const stored = opts.continuation ? mergeResults(draft.results, results) : results;
  await db.newsDraft.update({
    where: { id: draft.id },
    data: { results: stored as unknown as Prisma.InputJsonValue, ...(anyOk && !draft.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  if (anyOk) {
    await db.newsItem.update({ where: { id: draft.itemId }, data: { status: "PUBLISHED" } });
    if (!opts.continuation) await countUsage(tenantId, "publish");
  }
}
