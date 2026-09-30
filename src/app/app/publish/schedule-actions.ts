"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { assertWithin, LimitReached, limitMessage } from "@/lib/billing/limits";
import { captionProblems, isJpegPath, youtubeProblem, type Target } from "@/lib/merchant/caption";
import type { PublishInput } from "@/lib/merchant/publish-core";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { currentWorkspace } from "../data";

export interface ScheduledRow {
  id: string;
  /** ISO instant. */
  runAt: string;
  /** The caption's first 60 characters. */
  caption: string;
  targets: Target[];
  status: "PENDING" | "RUNNING" | "FAILED";
  lastError: string | null;
}

/**
 * Keep a post for later. It is validated as strictly as a live one, because
 * nobody is watching when the cron route publishes it. TikTok is never
 * scheduled: its audited Direct Post flow needs the person present.
 */
export async function schedulePublishAction(
  input: PublishInput,
  runAtLocal: string,
): Promise<{ ok: true; id: string; runAt: string } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (!can(ws.role, "publish")) return { ok: false, error: NOT_ALLOWED };
  const userId = (await auth())?.user?.id;
  if (!userId) return { ok: false, error: "چوونەژوورەوە پێویستە." };

  const targets = [...new Set(input.targets)];
  if (!targets.length) return { ok: false, error: "لانیکەم یەک شوێن هەڵبژێرە." };
  const runAt = baghdadLocalToUtc(runAtLocal);
  const problem = scheduleProblem(targets, runAt, new Date());
  if (problem) return { ok: false, error: problem };

  if (input.newsDraftId) {
    try {
      await assertWithin(ws.id, "publish");
    } catch (e) {
      if (e instanceof LimitReached) return { ok: false, error: limitMessage(e) };
      throw e;
    }
  }

  const caption = input.caption.trim();
  if (!caption && !input.media) return { ok: false, error: "دەق یان وێنە/ڤیدیۆیەک زیاد بکە." };
  if (targets.includes("IG") && !input.media) return { ok: false, error: "ئینستاگرام وێنە یان ڤیدیۆی دەوێت." };
  const ytProblem = youtubeProblem(targets, input.media);
  if (ytProblem) return { ok: false, error: ytProblem };
  if (input.media) {
    const expected = `merchant/${ws.id}/`;
    if (!input.media.pathname.startsWith(expected) || !/^https:\/\//.test(input.media.url)) {
      return { ok: false, error: "فایلەکە ناناسرێتەوە. دووبارە بارکردنی بکە." };
    }
    if (input.media.type === "IMAGE" && targets.includes("IG") && !isJpegPath(input.media.pathname)) {
      return { ok: false, error: "ئینستاگرام تەنها وێنەی JPG وەردەگرێت." };
    }
  }
  if (captionProblems(caption, targets).length) return { ok: false, error: "دەقەکە بۆ یەکێک لە شوێنەکان درێژە." };

  // Store only what publishing reads; TikTok's options never belong to a scheduled post.
  const stored: PublishInput = {
    caption,
    targets,
    ...(input.media ? { media: input.media } : {}),
    ...(input.newsDraftId ? { newsDraftId: input.newsDraftId } : {}),
    ...(input.productId ? { productId: input.productId } : {}),
  };
  const row = await db.scheduledPost.create({
    data: { tenantId: ws.id, createdById: userId, input: stored as unknown as Prisma.InputJsonValue, runAt },
    select: { id: true },
  });
  return { ok: true, id: row.id, runAt: runAt.toISOString() };
}

/** Cancel a post that has not started. Only this workspace's own posts. */
export async function cancelScheduledAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (!can(ws.role, "publish")) return { ok: false, error: NOT_ALLOWED };
  const r = await db.scheduledPost.updateMany({ where: { id, tenantId: ws.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) return { ok: false, error: "ئەم پۆستە ئێستا ناتوانرێت هەڵبوەشێنرێتەوە." };
  return { ok: true };
}

/** This workspace's pending, running and failed scheduled posts, latest time first. */
export async function listScheduled(): Promise<ScheduledRow[]> {
  const ws = await currentWorkspace();
  if (!ws || !can(ws.role, "publish")) return [];
  const rows = await db.scheduledPost.findMany({
    where: { tenantId: ws.id, status: { in: ["PENDING", "RUNNING", "FAILED"] } },
    orderBy: { runAt: "desc" },
    take: 20,
    select: { id: true, runAt: true, input: true, status: true, lastError: true },
  });
  return rows.map((r) => {
    const input = r.input as unknown as Partial<PublishInput> | null;
    return {
      id: r.id,
      runAt: r.runAt.toISOString(),
      caption: [...(input?.caption ?? "")].slice(0, 60).join(""),
      targets: input?.targets ?? [],
      status: r.status as ScheduledRow["status"],
      lastError: r.lastError,
    };
  });
}
