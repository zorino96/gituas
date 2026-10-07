import { after, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runAutopilot } from "@/lib/news/autopilot";
import { VIDEO_MAX_TRIES } from "@/lib/news/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The render worker reports one video: `{ url }` once it is uploaded to the path it was given, or
 * `{ error }`. A rendered video is posted right away by the desk's autopilot (when it posts by itself).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { url?: unknown; error?: unknown } | null;
  const job = await db.newsVideo.findUnique({ where: { id } });
  if (!job || job.status !== "RENDERING") return NextResponse.json({ error: "not rendering" }, { status: 409 });

  const pathname = `merchant/${job.tenantId}/video/${job.id}/reel.mp4`;
  const url = typeof body?.url === "string" ? body.url : "";
  // Only the file this job's token could write: our Blob store, this exact path.
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com") && u.pathname === `/${pathname}`;
  } catch {
    ok = false;
  }
  if (!ok) {
    const error = (typeof body?.error === "string" ? body.error : "bad upload").slice(0, 300);
    await db.newsVideo.update({
      where: { id },
      data: { error, status: job.tries >= VIDEO_MAX_TRIES ? "FAILED" : "VOICED", claimedAt: null },
    });
    return NextResponse.json({ ok: false });
  }
  await db.newsVideo.update({ where: { id }, data: { status: "RENDERED", videoUrl: url, videoPath: pathname, error: null } });
  if (job.autoPost) after(() => runAutopilot(job.tenantId).then(() => undefined));
  return NextResponse.json({ ok: true });
}
