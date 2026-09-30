import { db } from "@/lib/db";
import type { JobPayload, OutboxKind } from "./jobs";
import { accountFor, hideComment, likeComment, privateReply, replyToComment, sendDm, type MetaPlatform, type SendResult, type StoreAccount } from "./meta-client";
import { backoffMs, MAX_ATTEMPTS, retryable } from "./meta-errors";

const HOUR = 3_600_000;

async function send(acc: StoreAccount, kind: OutboxKind, p: JobPayload): Promise<SendResult> {
  switch (kind) {
    case "PUBLIC_REPLY":
      return replyToComment(acc, p.commentId!, p.text!);
    case "LIKE":
      return likeComment(acc, p.commentId!);
    case "HIDE":
      return hideComment(acc, p.commentId!);
    case "PRIVATE_REPLY": {
      const r = await privateReply(acc, p.commentId!, p.message!);
      // A rejected Facebook template is resent as plain text; "duplicate"/"window" are final.
      if (!r.ok && r.failure === "other" && p.fallbackText && !("text" in p.message!)) return privateReply(acc, p.commentId!, { text: p.fallbackText });
      return r;
    }
    case "DM_ANSWER":
      return sendDm(acc, p.recipientId!, p.message!);
    case "DM_PHOTOS": {
      let last: SendResult = { ok: true, id: null, recipientId: p.recipientId ?? null };
      for (const u of p.urls ?? []) {
        last = await sendDm(acc, p.recipientId!, { attachment: { type: "image", payload: { url: u, is_reusable: true } } });
        if (!last.ok) return last;
      }
      return last;
    }
  }
}

/** Send one job and record what happened. Safe to call twice: only PENDING jobs are sent. */
export async function runJob(jobId: string): Promise<void> {
  const job = await db.outboxJob.findUnique({
    where: { id: jobId },
    include: { store: { select: { id: true, tenantId: true, fbPageId: true, igUserId: true } }, message: { select: { platform: true } } },
  });
  if (!job || job.status !== "PENDING") return;

  const acc = await accountFor(job.store, job.message.platform as MetaPlatform);
  if (!acc) {
    await db.store.update({ where: { id: job.storeId }, data: { pausedReason: "token" } });
    await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + HOUR), lastError: "no usable credential" } });
    return;
  }

  const r = await send(acc, job.kind, job.payload as JobPayload);
  if (r.ok) {
    await db.outboxJob.update({ where: { id: job.id }, data: { status: "SENT", sentId: r.id, recipientId: r.recipientId ?? job.recipientId, lastError: null, attempts: { increment: 1 } } });
    return;
  }
  if (r.failure === "token") {
    await db.store.update({ where: { id: job.storeId }, data: { pausedReason: "token" } });
    await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + HOUR), lastError: r.error } });
    return;
  }
  if (!retryable(r.failure)) {
    await db.outboxJob.update({ where: { id: job.id }, data: { status: "SKIPPED", attempts: { increment: 1 }, lastError: `${r.failure}: ${r.error}`.slice(0, 300) } });
    return;
  }
  const attempts = job.attempts + 1;
  await db.outboxJob.update({
    where: { id: job.id },
    data: attempts >= MAX_ATTEMPTS
      ? { status: "FAILED", attempts, lastError: r.error }
      : { attempts, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)), lastError: r.error },
  });
}
