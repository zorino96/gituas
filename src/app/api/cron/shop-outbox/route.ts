import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runJob } from "@/lib/shop/outbox";
import { processMessage } from "@/lib/shop/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retries due outbox jobs and processes shop messages that were stored but
 * never handled (e.g. the function died mid-run). Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`; without the secret it refuses to run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const due = await db.outboxJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date(now) } },
    orderBy: { nextAttemptAt: "asc" },
    take: 40,
    select: { id: true },
  });
  for (const j of due) await runJob(j.id);

  const stuck = await db.conversationMessage.findMany({
    where: { storeId: { not: null }, outcome: null, createdAt: { lt: new Date(now - 5 * 60_000), gt: new Date(now - 7 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
    take: 15,
    select: { id: true },
  });
  for (const m of stuck) await processMessage(m.id);

  return NextResponse.json({ jobs: due.length, messages: stuck.length });
}
