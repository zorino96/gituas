// Instagram posts whose video was still processing when the publish call ran out of time.
//
// Instagram keeps a media container for about a day, so instead of reporting the post as
// failed, publish-core parks the container here and the every-minute cron finishes it the
// moment Instagram says FINISHED. Each row is claimed before media_publish is sent, and a
// publish call that got no answer is never sent again (the post may be live), so nothing
// goes out twice.
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { countUsage } from "@/lib/billing/limits";
import { withAccounts } from "@/lib/oauth/account-scope";
import { getIgCred, V } from "./instagram";

/** Containers older than this are given up (Instagram expires them after about 24 h). */
const GIVE_UP_MS = 6 * 60 * 60 * 1000;
const BATCH = 8;

/** Park a container that was still processing. Never throws. */
export async function parkInstagramContainer(row: { tenantId: string; igUserId: string; containerId: string; draftId?: string | null }): Promise<boolean> {
  try {
    await db.igPending.create({ data: { tenantId: row.tenantId, igUserId: row.igUserId, containerId: row.containerId, draftId: row.draftId ?? null } });
    return true;
  } catch (e) {
    // Already parked by an earlier attempt: that one will finish it.
    if ((e as { code?: string }).code === "P2002") return true;
    console.error("[instagram] parking failed:", e instanceof Error ? e.message : "unknown error");
    return false;
  }
}

async function graph(path: string, token: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${V}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { ...init, signal: AbortSignal.timeout(12_000) });
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** A news draft's Instagram result turned into a success once the parked post went out. */
async function recordOnDraft(tenantId: string, draftId: string, url: string | undefined): Promise<void> {
  const draft = await db.newsDraft.findFirst({ where: { id: draftId, tenantId }, select: { id: true, itemId: true, results: true, publishedAt: true } });
  if (!draft) return;
  const results = Array.isArray(draft.results) ? (draft.results as Record<string, unknown>[]) : [];
  const next = results.map((r) => (r?.target === "IG" && !r.ok ? { target: "IG", ok: true, ...(url ? { url } : {}) } : r));
  if (!next.some((r) => r?.target === "IG")) next.push({ target: "IG", ok: true, ...(url ? { url } : {}) });
  await db.newsDraft.update({
    where: { id: draft.id },
    data: { results: next as Prisma.InputJsonValue, ...(draft.publishedAt ? {} : { publishedAt: new Date() }) },
  });
  if (!draft.publishedAt) {
    // Nothing else of this post went out before: this is when the story counts as published.
    await db.newsItem.update({ where: { id: draft.itemId }, data: { status: "PUBLISHED" } });
    await countUsage(tenantId, "publish");
  }
}

/** Finish what is ready; give up on what failed or waited too long. Never throws. */
export async function finishPendingInstagram(now = Date.now()): Promise<{ published: number; failed: number; waiting: number }> {
  const out = { published: 0, failed: 0, waiting: 0 };
  try {
    const rows = await db.igPending.findMany({ where: { status: "WAITING" }, orderBy: { createdAt: "asc" }, take: BATCH });
    for (const row of rows) {
      if (now - row.createdAt.getTime() > GIVE_UP_MS) {
        await db.igPending.update({ where: { id: row.id }, data: { status: "FAILED", lastError: "still processing after 6 hours" } });
        out.failed++;
        continue;
      }
      await withAccounts({ META_INSTAGRAM: row.igUserId }, async () => {
        const cred = await getIgCred(row.tenantId);
        if (!cred || cred.igUserId !== row.igUserId) {
          await db.igPending.update({ where: { id: row.id }, data: { status: "FAILED", lastError: "Instagram account no longer connected" } });
          out.failed++;
          return;
        }
        const s = await graph(`${row.containerId}?fields=status_code`, cred.token);
        const status = typeof s?.status_code === "string" ? s.status_code : "IN_PROGRESS";
        if (status === "IN_PROGRESS") {
          await db.igPending.update({ where: { id: row.id }, data: { tries: { increment: 1 } } });
          out.waiting++;
          return;
        }
        if (status !== "FINISHED") {
          await db.igPending.update({ where: { id: row.id }, data: { status: "FAILED", lastError: `container status ${status}` } });
          out.failed++;
          return;
        }
        // Claim before publishing: a second tick that reaches this row gets count 0.
        const claim = await db.igPending.updateMany({ where: { id: row.id, status: "WAITING" }, data: { status: "PUBLISHING" } });
        if (claim.count !== 1) return;
        const pub = await graph(`${row.igUserId}/media_publish`, cred.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ creation_id: row.containerId }).toString(),
        });
        if (!pub) {
          // No answer: the post may be live. Never sent again.
          await db.igPending.update({ where: { id: row.id }, data: { status: "UNKNOWN", lastError: "no answer from media_publish" } });
          out.failed++;
          return;
        }
        if (typeof pub.id !== "string" && typeof pub.id !== "number") {
          await db.igPending.update({ where: { id: row.id }, data: { status: "FAILED", lastError: JSON.stringify(pub.error ?? pub).slice(0, 300) } });
          out.failed++;
          return;
        }
        const mediaId = String(pub.id);
        const link = await graph(`${mediaId}?fields=permalink`, cred.token);
        const url = typeof link?.permalink === "string" ? link.permalink : undefined;
        await db.igPending.update({ where: { id: row.id }, data: { status: "DONE", mediaId } });
        await db.auditLog.create({
          data: { tenantId: row.tenantId, actor: "SYSTEM", action: "app.publish", reasoning: "Published to IG once Instagram finished processing the video.", metadata: { target: "IG", accountId: row.igUserId, ...(url ? { url } : {}), late: true } },
        });
        if (row.draftId) await recordOnDraft(row.tenantId, row.draftId, url);
        out.published++;
      });
    }
  } catch (e) {
    console.error("[instagram] finishing failed:", e instanceof Error ? e.message : "unknown error");
  }
  return out;
}
