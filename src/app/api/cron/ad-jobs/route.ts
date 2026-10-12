import { NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { AD_MAX_TRIES, prepareQueued, waitingFilter } from "@/lib/advideo/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Renders handed out per call: the worker (adfilm/worker.mjs) renders them one by one. */
const PER_CALL = 2;
/** The upload token for one video lives this long. */
const UPLOAD_TOKEN_MS = 40 * 60 * 1000;

/**
 * The host of our own Blob store, read from a file the app itself stored for this job (a voice clip): the
 * worker downloads from this host only, not from any Vercel Blob store.
 */
function ownBlobHost(props: unknown): string | null {
  const scenes = (props as { scenes?: { audio?: unknown }[] } | null)?.scenes;
  const first = scenes?.find((s) => typeof s?.audio === "string")?.audio;
  try {
    const host = new URL(first as string).hostname;
    return host.endsWith(".public.blob.vercel-storage.com") ? host : null;
  } catch {
    return null;
  }
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * The AI video render queue: claims up to two videos whose script and voice are ready and answers
 * with their props and a token that can upload exactly one file, that video, to Blob. `?peek=1`
 * only says how many are waiting, claiming nothing.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Closed (AD_VIDEO_ENABLED unset): nothing waits, nothing is handed out, no voice credits are spent.
  if (!adVideoEnabled()) return NextResponse.json(new URL(req.url).searchParams.get("peek") ? { waiting: 0 } : { jobs: [] });
  if (new URL(req.url).searchParams.get("peek")) {
    const [queued, ready] = await Promise.all([
      db.adVideo.count({ where: { status: "QUEUED", tries: { lt: AD_MAX_TRIES } } }),
      db.adVideo.count({ where: waitingFilter() }),
    ]);
    return NextResponse.json({ waiting: queued + ready });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "blob not configured" }, { status: 500 });

  // Videos still waiting for their script and voice are prepared here while the call has time, so
  // the worker never leaves empty-handed when the clock has not got to them yet.
  await prepareQueued(Date.now() + 55_000, 1);

  const candidates = await db.adVideo.findMany({ where: waitingFilter(), orderBy: { createdAt: "asc" }, take: PER_CALL });
  const jobs = [];
  for (const c of candidates) {
    // Only the call that flips the row gets the job, so two workers never render one video.
    const claim = await db.adVideo.updateMany({
      where: { id: c.id, status: c.status, updatedAt: c.updatedAt },
      data: { status: "RENDERING", claimedAt: new Date(), tries: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    const pathname = `merchant/${c.tenantId}/advideo/${c.id}/ad.mp4`;
    const uploadToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      allowedContentTypes: ["video/mp4"],
      maximumSizeInBytes: 150 * 1024 * 1024,
      validUntil: Date.now() + UPLOAD_TOKEN_MS,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    jobs.push({ id: c.id, props: c.props, pathname, uploadToken, blobHost: ownBlobHost(c.props) });
  }
  return NextResponse.json({ jobs });
}
