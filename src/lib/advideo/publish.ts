// Posting a rendered video to the store's Facebook Page and Instagram account.

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { publishForWorkspace, type PublishInput } from "@/lib/merchant/publish-core";
import { isOwnBlobUrl, isOwnPathname } from "@/lib/merchant/caption";
import type { Target } from "./prepare";

/** The Instagram part of a Reel may take this long inside a background tick before the finisher takes over. */
const IG_DEADLINE_MS = 35_000;

export type Published = { ok: true; results: unknown } | { ok: false; error: "state" | "targets" | "media" | "failed"; results?: unknown };

/**
 * Posts a RENDERED video (once). `targets` are the platforms asked for; only the ones the store has
 * connected are used. The row becomes POSTED when at least one platform took it (or is still
 * processing it); otherwise it stays RENDERED with the reasons, so the owner can try again.
 */
export async function publishAdVideo(jobId: string, requested?: Target[]): Promise<Published> {
  const job = await db.adVideo.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RENDERED") return { ok: false, error: "state" };
  if (!job.videoUrl || !job.videoPath || !isOwnBlobUrl(job.videoUrl, job.tenantId) || !isOwnPathname(job.videoPath, job.tenantId)) return { ok: false, error: "media" };
  const store = job.storeId ? await db.store.findUnique({ where: { id: job.storeId }, select: { fbPageId: true, igUserId: true } }) : null;
  const asked = (requested?.length ? requested : (job.targets as Target[])).filter((t): t is Target => t === "FB" || t === "IG");
  const targets = asked.filter((t) => (t === "FB" ? !!store?.fbPageId : !!store?.igUserId));
  if (!targets.length) return { ok: false, error: "targets" };

  // Claim it: two ticks (or a tick and a button) never post the same video twice.
  const claim = await db.adVideo.updateMany({ where: { id: job.id, status: "RENDERED" }, data: { status: "POSTING" } });
  if (claim.count !== 1) return { ok: false, error: "state" };

  const input: PublishInput = {
    caption: job.caption ?? "",
    targets,
    media: { url: job.videoUrl, pathname: job.videoPath, type: "VIDEO" },
    ...(job.productId ? { productId: job.productId } : {}),
    igDeadlineMs: IG_DEADLINE_MS,
    accounts: { ...(store?.fbPageId ? { FB: [store.fbPageId] } : {}), ...(store?.igUserId ? { IG: [store.igUserId] } : {}) },
  };
  let results: unknown;
  try {
    results = await publishForWorkspace({ id: job.tenantId, kind: "MERCHANT", role: "OWNER" }, input);
  } catch (e) {
    results = { error: (e instanceof Error ? e.message : "failed").slice(0, 300) };
  }
  const list = Array.isArray(results) ? (results as { ok?: boolean; pending?: boolean; error?: string; target?: string }[]) : [];
  const ok = list.some((o) => o.ok || o.pending);
  const reasons = list.filter((o) => !o.ok && !o.pending).map((o) => `${o.target ?? "?"}: ${o.error ?? "failed"}`).join(" | ").slice(0, 400);
  await db.adVideo.update({
    where: { id: job.id },
    data: {
      status: ok ? "POSTED" : "RENDERED",
      postedAt: ok ? new Date() : null,
      results: results as Prisma.InputJsonValue,
      error: ok ? (reasons || null) : reasons || "could not post",
    },
  });
  await db.auditLog.create({
    data: {
      tenantId: job.tenantId,
      actor: job.source === "AUTO" ? "SYSTEM" : "USER",
      action: ok ? "advideo.posted" : "advideo.post_failed",
      reasoning: ok ? "An AI video ad was posted." : "An AI video ad could not be posted.",
      metadata: { jobId: job.id, tier: job.tier, targets, results: results as Prisma.InputJsonValue },
    },
  });
  return ok ? { ok: true, results } : { ok: false, error: "failed", results };
}
