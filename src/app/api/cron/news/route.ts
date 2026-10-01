import { NextResponse } from "next/server";

import { tickNewsrooms } from "@/lib/news/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps every newsroom that has the autopilot on fresh: ingest, classify, then the autopilot, for
 * the desks that are due by their plan's refresh speed. The GitHub Actions clock calls it every
 * five minutes with `Authorization: Bearer $CRON_SECRET`; without the secret it refuses to run.
 * There is no session here.
 *
 * On Vercel Pro add `{ "path": "/api/cron/news", "schedule": "* * * * *" }` to vercel.json for
 * 60 s / 30 s service. Do not add it on Hobby: a sub-daily cron makes Hobby reject the deployment.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await tickNewsrooms());
  } catch (e) {
    console.error("[news tick] failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
