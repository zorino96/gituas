import { NextResponse } from "next/server";
import { presignPut, publicUrl } from "@/lib/storage";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { AD_MAX_TRIES, waitingFilter } from "@/lib/advideo/prepare";
import { prepareVideo, VIDEO_CLAIM_MS, VIDEO_MAX_TRIES } from "@/lib/news/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Renders handed out per call: the GitHub Actions worker (reel/worker.mjs) renders them one by one. */
const PER_CALL = 3;
/** The upload token for one video lives this long. */
const UPLOAD_TOKEN_MS = 30 * 60 * 1000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * The render worker's queue: claims up to three voiced videos (or renders that were claimed long
 * ago and never reported) and answers with their props and a token that can upload exactly one
 * file, that video, to Blob. `?peek=1` only says how many are waiting, claiming nothing.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stale = new Date(Date.now() - VIDEO_CLAIM_MS);
  const waiting = {
    OR: [{ status: "VOICED" }, { status: "RENDERING", claimedAt: { lt: stale } }],
    tries: { lt: VIDEO_MAX_TRIES },
  };
  if (new URL(req.url).searchParams.get("peek")) {
    const queued = await db.newsVideo.count({ where: { status: "QUEUED", tries: { lt: VIDEO_MAX_TRIES } } });
    const reels = queued + (await db.newsVideo.count({ where: waiting }));
    // The AI video ads (src/app/api/cron/ad-jobs) are rendered by the same workflow run, so they count here too:
    // the clock starts the workflow when either kind is waiting. Before their table exists the count is 0.
    const ads = !adVideoEnabled()
      ? 0
      : (await db.adVideo.count({ where: { status: "QUEUED", tries: { lt: AD_MAX_TRIES } } }).catch(() => 0)) +
      (await db.adVideo.count({ where: waitingFilter() }).catch(() => 0));
    return NextResponse.json({ waiting: reels + ads, reels, ads });
  }
  if (!process.env.R2_SECRET_ACCESS_KEY) return NextResponse.json({ error: "storage not configured" }, { status: 500 });

  // Videos still waiting for their script and voice (the autopilot usually does this) are voiced
  // here too, oldest first, while the call has time: the worker then never waits on a quiet desk.
  const started = Date.now();
  const queued = await db.newsVideo.findMany({ where: { status: "QUEUED", tries: { lt: VIDEO_MAX_TRIES } }, orderBy: { createdAt: "asc" }, take: 2, select: { id: true } });
  for (const q of queued) {
    if (Date.now() - started > 25_000) break;
    await prepareVideo(q.id, { proofread: true });
  }

  const candidates = await db.newsVideo.findMany({ where: waiting, orderBy: { createdAt: "asc" }, take: PER_CALL });
  const jobs = [];
  for (const c of candidates) {
    // Only the call that flips the row gets the job, so two workers never render one video.
    const claim = await db.newsVideo.updateMany({
      where: { id: c.id, status: c.status, updatedAt: c.updatedAt },
      data: { status: "RENDERING", claimedAt: new Date(), tries: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    const pathname = `merchant/${c.tenantId}/video/${c.id}/reel.mp4`;
    const uploadUrl = await presignPut(pathname, "video/mp4", { expiresSec: UPLOAD_TOKEN_MS / 1000 });
    jobs.push({ id: c.id, props: c.props, pathname, uploadUrl, url: publicUrl(pathname) });
  }
  return NextResponse.json({ jobs });
}
