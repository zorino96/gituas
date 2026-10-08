import { NextResponse } from "next/server";

import { expireOverdue } from "@/lib/billing/invoices";
import { youtubeUpkeep } from "@/lib/publishers/youtube-upkeep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The daily housekeeping run: overdue invoices, then the YouTube data rules (III.E.4). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const billing = await expireOverdue();
  const youtube = await youtubeUpkeep().catch((e) => ({ error: e instanceof Error ? e.message : "failed" }));
  return NextResponse.json({ billing, youtube });
}
