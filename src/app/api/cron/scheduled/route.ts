import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { publishForWorkspace, type PublishInput } from "@/lib/merchant/publish-core";
import { finishPendingInstagram } from "@/lib/publishers/instagram-finish";
import { pollStudio } from "@/lib/studio/jobs";
import { SCHEDULE_NO_TIKTOK } from "@/lib/merchant/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 5;

/** A post that has been RUNNING this long was abandoned (the function was killed mid-publish). */
const STUCK_AFTER_MS = 15 * 60 * 1000;
const STUCK_ERROR = "کاتی تەواو بوو — پێش دووبارە بڵاوکردنەوە سەیری پلاتفۆرمەکە بکە.";

type Outcome = { status: "DONE" | "FAILED"; result?: Prisma.InputJsonValue; lastError: string | null };

async function run(tenantId: string, raw: unknown): Promise<Outcome> {
  const input = raw as PublishInput;
  if (Array.isArray(input?.targets) && input.targets.includes("TT")) return { status: "FAILED", lastError: SCHEDULE_NO_TIKTOK };
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, kind: true } });
  if (!tenant) return { status: "FAILED", lastError: "tenant not found" };
  // The post was authorised when it was scheduled, so it runs as the owner.
  const r = await publishForWorkspace({ id: tenant.id, kind: tenant.kind, role: "OWNER" }, input);
  if (!Array.isArray(r)) return { status: "FAILED", lastError: r.error };
  const failed = r.filter((o) => !o.ok).map((o) => `${o.target}: ${o.error ?? "failed"}`);
  return {
    status: r.some((o) => o.ok) ? "DONE" : "FAILED",
    result: r as unknown as Prisma.InputJsonValue,
    lastError: failed.length ? failed.join(" | ").slice(0, 1000) : null,
  };
}

/**
 * Publishes scheduled posts that have come due. The GitHub Actions clock calls
 * it every five minutes with `Authorization: Bearer $CRON_SECRET`; without the
 * secret it refuses to run. There is no session here: each post is published
 * for its workspace directly.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Instagram videos that were still processing when they were published: finish the ready ones.
  const instagram = await finishPendingInstagram();
  // Studio pictures whose Higgsfield webhook did not arrive, and renders that were cut.
  const studio = await pollStudio().catch(() => ({ checked: 0 }));

  // A run that never finished may already have posted, so it is failed, never returned to
  // PENDING: the owner checks the platform and reschedules by hand, and nothing posts twice.
  await db.scheduledPost.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: "FAILED", lastError: STUCK_ERROR },
  });

  const due = await db.scheduledPost.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: BATCH,
    select: { id: true, tenantId: true, input: true },
  });

  // Claim each one; a concurrent tick that got there first leaves count 0 and we skip it.
  const claimed: typeof due = [];
  for (const p of due) {
    const c = await db.scheduledPost.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "RUNNING" } });
    if (c.count === 1) claimed.push(p);
  }

  // In parallel: one slow Instagram video must not starve the rest of the minute.
  await Promise.allSettled(
    claimed.map(async (p) => {
      let o: Outcome;
      try {
        o = await run(p.tenantId, p.input);
      } catch (e) {
        o = { status: "FAILED", lastError: (e instanceof Error ? e.message : "unknown error").slice(0, 1000) };
      }
      await db.scheduledPost.update({
        where: { id: p.id },
        data: { status: o.status, lastError: o.lastError, ...(o.result !== undefined ? { result: o.result } : {}) },
      });
    }),
  );

  return NextResponse.json({ due: due.length, ran: claimed.length, instagram, studio });
}
