"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { assertWithin, LimitReached, limitMessage, newsroomFrozenError } from "@/lib/billing/limits";
import { captionProblems, isJpegPath, isKnownTarget, isOwnBlobUrl, youtubeProblem, type Target } from "@/lib/merchant/caption";
import type { PublishInput } from "@/lib/merchant/publish-core";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
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
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const m = t.actions.publish;
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const userId = (await auth())?.user?.id;
  if (!userId) return { ok: false, error: t.actions.common.signIn };

  const targets = [...new Set(input.targets)];
  if (!targets.length) return { ok: false, error: t.publish.blockPickTarget };
  if (!targets.every(isKnownTarget)) return { ok: false, error: m.unknownTarget };
  // A frozen newsroom may not schedule anything, not only drafts from the news desk.
  if (ws.kind === "NEWS") {
    const frozen = await newsroomFrozenError(ws.id, t.nr.news.actions);
    if (frozen) return { ok: false, error: frozen };
  }
  const runAt = baghdadLocalToUtc(runAtLocal);
  const problem = scheduleProblem(targets, runAt, new Date(), m);
  if (problem) return { ok: false, error: problem };

  if (input.newsDraftId) {
    try {
      await assertWithin(ws.id, "publish");
    } catch (e) {
      if (e instanceof LimitReached) return { ok: false, error: limitMessage(e, t.nr.news.actions) };
      throw e;
    }
  }

  const caption = input.caption.trim();
  if (!caption && !input.media) return { ok: false, error: t.publish.blockNeedContent };
  if (targets.includes("IG") && !input.media) return { ok: false, error: m.igNeedsMedia };
  if (youtubeProblem(targets, input.media)) return { ok: false, error: t.publish.ytVideoOnly };
  if (input.media) {
    const expected = `merchant/${ws.id}/`;
    if (!input.media.pathname.startsWith(expected) || !/^https:\/\//.test(input.media.url)) {
      return { ok: false, error: m.badFile };
    }
    if (targets.includes("YT") && !isOwnBlobUrl(input.media.url, ws.id)) {
      return { ok: false, error: m.badFile };
    }
    if (input.media.type === "IMAGE" && targets.includes("IG") && !isJpegPath(input.media.pathname)) {
      return { ok: false, error: m.igJpgOnly };
    }
  }
  if (captionProblems(caption, targets).length) return { ok: false, error: t.publish.blockCaptionLong };

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
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const r = await db.scheduledPost.updateMany({ where: { id, tenantId: ws.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) return { ok: false, error: t.actions.publish.cantCancel };
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
