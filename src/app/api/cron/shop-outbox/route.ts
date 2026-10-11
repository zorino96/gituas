import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runJob } from "@/lib/shop/outbox";
import { runShopAutopilot } from "@/lib/shop/autopilot";
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
  // One bad job or message must not stop the rest of the batch.
  for (const j of due) await runJob(j.id).catch((e) => console.error("[shop-outbox] job failed:", e instanceof Error ? e.message : "unknown error"));

  const stuck = await db.conversationMessage.findMany({
    where: { storeId: { not: null }, direction: "INBOUND", outcome: null, createdAt: { lt: new Date(now - 5 * 60_000), gt: new Date(now - 7 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
    take: 15,
    select: { id: true },
  });
  for (const m of stuck) await processMessage(m.id).catch((e) => console.error("[shop-outbox] message failed:", e instanceof Error ? e.message : "unknown error"));

  // A post can take ~40 s and the route has 60: after a busy start it waits for the next minute
  // (still inside the slot hour) instead of being cut off half-way through posting.
  const autopilot =
    Date.now() - now < 15_000
      ? await runShopAutopilot(now).catch((e) => {
          console.error("[shop-outbox] autopilot failed:", e instanceof Error ? e.message : "unknown error");
          return { failed: 1 };
        })
      : { deferred: 1 };

  return NextResponse.json({ jobs: due.length, messages: stuck.length, autopilot });
}
