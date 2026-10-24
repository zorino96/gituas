// Posting a rendered video to the store's Facebook Page and Instagram account, and to the workspace's YouTube channel.

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { publishForWorkspace, type PublishInput, type PublishOutcome } from "@/lib/merchant/publish-core";
import { isOwnBlobUrl, isOwnPathname } from "@/lib/merchant/caption";
import { adVideoEnabled } from "./enabled";
import type { Target } from "./prepare";
import { youtubeChannels } from "./targets";
import { youtubeOptionsOf } from "./youtube";

/** The Instagram part of a Reel may take this long inside a background tick before the finisher takes over. */
const IG_DEADLINE_MS = 35_000;
/**
 * The YouTube upload is waited for this long (the function that posts has 60 seconds, and the Facebook and Instagram parts run beside it).
 * If YouTube has not answered by then, the job says so plainly; the upload may still finish on YouTube's side, so it is never started twice.
 */
const YT_WAIT_MS = 50_000;

export type Published = { ok: true; results: unknown } | { ok: false; error: "state" | "targets" | "media" | "failed"; results?: unknown };

/** What posting needs from the outside, replaceable in tests: the shared publisher, the list of the workspace's YouTube channels, and the wait. */
export interface PublishDeps {
  publish?: typeof publishForWorkspace;
  channels?: (tenantId: string) => Promise<string[]>;
  youtubeWaitMs?: number;
}

type Row = Omit<Partial<PublishOutcome>, "target"> & { target?: string; skipped?: true };

const failure = (target: string, error: string): Row => ({ target, ok: false, error: error.slice(0, 300) });

/** A promise's value, or `fallback` when it takes longer than `ms` (the promise itself is left to finish on its own). */
function within<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((resolve) => (t = setTimeout(() => resolve(fallback()), ms)))]).finally(() => {
    if (t) clearTimeout(t);
  });
}

/**
 * Posts a RENDERED video (once). `requested` are the platforms asked for; only the ones that are connected are used (Facebook and
 * Instagram by the store's accounts, YouTube by the workspace's channel). The row becomes POSTED when at least one platform took it (or
 * is still processing it); otherwise it stays RENDERED with the reasons, so the owner can try again.
 *
 * YouTube is posted beside the others and never holds them back (and they never hold it back): it needs the owner's own declarations
 * of who can see the video and whether it is made for kids (`spec.youtube`, written when the video was queued). A YouTube target without
 * them, with several channels connected (the owner has to pick one in Publish) or with nothing to title it by is skipped with a reason,
 * never uploaded with a guess.
 */
export async function publishAdVideo(jobId: string, requested?: Target[], deps: PublishDeps = {}): Promise<Published> {
  if (!adVideoEnabled()) return { ok: false, error: "state" };
  const publish = deps.publish ?? publishForWorkspace;
  const channels = deps.channels ?? youtubeChannels;
  const job = await db.adVideo.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RENDERED") return { ok: false, error: "state" };
  if (!job.videoUrl || !job.videoPath || !isOwnBlobUrl(job.videoUrl, job.tenantId) || !isOwnPathname(job.videoPath, job.tenantId)) return { ok: false, error: "media" };
  const store = job.storeId ? await db.store.findUnique({ where: { id: job.storeId }, select: { fbPageId: true, igUserId: true } }) : null;
  const asked = [...new Set((requested?.length ? requested : (job.targets as Target[])).filter((t): t is Target => t === "FB" || t === "IG" || t === "YT"))];
  const targets = asked.filter((t) => (t === "FB" ? !!store?.fbPageId : t === "IG" ? !!store?.igUserId : false));

  // YouTube: valid declarations, a title, and exactly one channel to upload to (read-only checks; nothing is sent yet).
  let yt: { options: NonNullable<PublishInput["youtube"]>; accountId: string } | null = null;
  let ytSkipped: string | null = null;
  if (asked.includes("YT")) {
    const built = youtubeOptionsOf(job.spec, job.caption);
    if (!built.ok) ytSkipped = built.reason;
    else {
      const ids = await channels(job.tenantId).catch(() => [] as string[]);
      if (!ids.length) ytSkipped = "YouTube was skipped: no YouTube channel is connected";
      else if (ids.length > 1) ytSkipped = "YouTube was skipped: several YouTube channels are connected, so the owner has to pick one in Publish";
      else yt = { options: built.options, accountId: ids[0] };
    }
  }
  if (!targets.length && !yt && !ytSkipped) return { ok: false, error: "targets" };

  // Claim it: two ticks (or a tick and a button) never post the same video twice.
  const claim = await db.adVideo.updateMany({ where: { id: job.id, status: "RENDERED" }, data: { status: "POSTING" } });
  if (claim.count !== 1) return { ok: false, error: "state" };

  const media: NonNullable<PublishInput["media"]> = { url: job.videoUrl, pathname: job.videoPath, type: "VIDEO" };
  const ws = { id: job.tenantId, kind: "MERCHANT" as const, role: "OWNER" as const };
  const social = targets.length
    ? publish(ws, {
        caption: job.caption ?? "",
        targets,
        media,
        ...(job.productId ? { productId: job.productId } : {}),
        igDeadlineMs: IG_DEADLINE_MS,
        accounts: { ...(store?.fbPageId ? { FB: [store.fbPageId] } : {}), ...(store?.igUserId ? { IG: [store.igUserId] } : {}) },
      })
    : null;
  const youtube = yt
    ? within(
        publish(ws, { caption: yt.options.description, targets: ["YT"], media, youtube: yt.options, accounts: { YT: [yt.accountId] } }),
        deps.youtubeWaitMs ?? YT_WAIT_MS,
        () => ({ error: "YouTube did not answer in time; the video may still appear on the channel, so check YouTube Studio before posting it again" }),
      )
    : null;
  const [s, y] = await Promise.allSettled([social ?? Promise.resolve([]), youtube ?? Promise.resolve([])]);
  const reason = (r: PromiseSettledResult<unknown>): string => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : "failed") : String((r.value as { error?: unknown } | null)?.error ?? "failed"));

  let results: unknown;
  if (!yt && !ytSkipped) {
    // Facebook and Instagram alone: exactly what the shared publisher answered.
    results = s.status === "fulfilled" ? s.value : { error: reason(s).slice(0, 300) };
  } else {
    const rows: Row[] = [];
    if (social) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) rows.push(...(s.value as Row[]));
      else for (const t of targets) rows.push(failure(t, reason(s)));
    }
    if (youtube) {
      if (y.status === "fulfilled" && Array.isArray(y.value)) rows.push(...(y.value as Row[]));
      else rows.push(failure("YT", reason(y)));
    }
    if (ytSkipped) rows.push({ ...failure("YT", ytSkipped), skipped: true });
    results = rows;
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
      // One automatic attempt: a post that failed (or timed out, so may be out) is left to the owner's button.
      ...(ok ? {} : { autoPost: false }),
      error: ok ? (reasons || null) : reasons || (typeof (results as { error?: unknown })?.error === "string" ? String((results as { error: string }).error) : "could not post"),
    },
  });
  await db.auditLog.create({
    data: {
      tenantId: job.tenantId,
      actor: job.source === "AUTO" ? "SYSTEM" : "USER",
      action: ok ? "advideo.posted" : "advideo.post_failed",
      reasoning: ok ? "An AI video ad was posted." : "An AI video ad could not be posted.",
      metadata: { jobId: job.id, tier: job.tier, targets: [...targets, ...(yt ? ["YT"] : [])], results: results as Prisma.InputJsonValue },
    },
  });
  return ok ? { ok: true, results } : { ok: false, error: "failed", results };
}
