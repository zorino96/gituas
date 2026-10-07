import { NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

import { db } from "@/lib/db";
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
    return NextResponse.json({ waiting: queued + (await db.newsVideo.count({ where: waiting })) });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "blob not configured" }, { status: 500 });

  // Videos still waiting for their script and voice (the autopilot usually does this) are voiced
  // here too, oldest first, while the call has time: the worker then never waits on a quiet desk.
  const started = Date.now();
  const queued = await db.newsVideo.findMany({ where: { status: "QUEUED", tries: { lt: VIDEO_MAX_TRIES } }, orderBy: { createdAt: "asc" }, take: 2, select: { id: true } });
  for (const q of queued) {
    if (Date.now() - started > 25_000) break;
    await prepareVideo(q.id);
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
    const uploadToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      allowedContentTypes: ["video/mp4"],
      maximumSizeInBytes: 100 * 1024 * 1024,
      validUntil: Date.now() + UPLOAD_TOKEN_MS,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    jobs.push({ id: c.id, props: c.props, pathname, uploadToken });
  }
  return NextResponse.json({ jobs });
}
