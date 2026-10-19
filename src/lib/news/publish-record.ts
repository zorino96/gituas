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

/**
 * The draft's earlier results with the new ones added; a result for the same platform and account replaces the old one.
 * The exception: a new failure never replaces a stored success of the same place (the post is out; the duplicate-post guard reads it).
 */
export function mergeResults(existing: unknown, incoming: PublishResult[]): PublishResult[] {
  const old = Array.isArray(existing) ? (existing as PublishResult[]).filter((r) => r && typeof r.target === "string") : [];
  const wentOut = new Set(old.filter((r) => r.ok === true).map(resultKey));
  const fresh = incoming.filter((r) => r.ok === true || !wentOut.has(resultKey(r)));
  const replaced = new Set(fresh.map(resultKey));
  return [...old.filter((r) => !replaced.has(resultKey(r))), ...fresh];
}

/**
 * Store each platform's result on the draft; the first success marks the story published.
 * The results are added to the ones already stored (a story can go to Facebook now and to Instagram later, or be
 * spread over several Pages by the autopilot): dropping the earlier ones would let a repeated post pass the duplicate guard.
 * A `continuation` is the later part of a story the autopilot spread over several Pages: the story is not counted against the quota again.
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
  const stored = mergeResults(draft.results, results);
  await db.newsDraft.update({
    where: { id: draft.id },
    data: { results: stored as unknown as Prisma.InputJsonValue, ...(anyOk && !draft.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  if (anyOk) {
    await db.newsItem.update({ where: { id: draft.itemId }, data: { status: "PUBLISHED" } });
    if (!opts.continuation) await countUsage(tenantId, "publish");
  }
}
