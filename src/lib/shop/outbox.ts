import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { JobPayload, OutboxKind } from "./jobs";
import { accountFor, hideComment, likeComment, privateReply, replyToComment, sendDm, type SendResult, type ShopPlatform, type StoreAccount } from "./meta-client";
import { backoffMs, MAX_ATTEMPTS, retryable } from "./meta-errors";

const HOUR = 3_600_000;
const CLAIM_MS = 5 * 60_000;

async function send(acc: StoreAccount, kind: OutboxKind, p: JobPayload, onPhotoSent?: (rest: string[]) => Promise<unknown>): Promise<SendResult> {
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
      const urls = p.urls ?? [];
      for (const [i, u] of urls.entries()) {
        last = await sendDm(acc, p.recipientId!, { attachment: { type: "image", payload: { url: u, is_reusable: true } } });
        if (!last.ok) return last;
        // A retry after a later failure starts from the photos the buyer has not had yet.
        await onPhotoSent?.(urls.slice(i + 1));
      }
      return last;
    }
  }
}

/** Send one job and record what happened. The conditional claim makes a second concurrent call a no-op. */
export async function runJob(jobId: string, opts: { immediate?: boolean } = {}): Promise<void> {
  const now = new Date();
  // Claim first: the immediate run and the cron sweep can meet on the same job.
  // The immediate run ignores nextAttemptAt (a new job is held for it) and only ever comes from the
  // processMessage call that created the job; the sweep only takes due jobs.
  const claim = await db.outboxJob.updateMany({
    where: { id: jobId, status: "PENDING", ...(opts.immediate ? {} : { nextAttemptAt: { lte: now } }) },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
  });
  if (claim.count !== 1) return;
  const job = await db.outboxJob.findUnique({
    where: { id: jobId },
    include: {
      store: { select: { id: true, tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true, automationEnabled: true } },
      message: { select: { platform: true } },
    },
  });
  if (!job) return;
  const payload = job.payload as JobPayload;
  const platform = job.message.platform as ShopPlatform;
  const skip = (why: string) => db.outboxJob.update({ where: { id: job.id }, data: { status: "SKIPPED", lastError: why } });

  // Retries happen later: the merchant may have switched automation off or taken the thread over.
  if (!job.store.automationEnabled) return void (await skip("store_off"));
  const keys = [payload.commentId, payload.recipientId].filter((k): k is string => !!k);
  if (keys.length && (await db.threadPause.count({ where: { tenantId: job.store.tenantId, platform, threadKey: { in: keys } } }))) {
    return void (await skip("thread_paused"));
  }
  if (payload.requiresPrivate) {
    const priv = await db.outboxJob.findUnique({ where: { messageId_kind: { messageId: job.messageId, kind: "PRIVATE_REPLY" } }, select: { status: true } });
    if (priv?.status === "PENDING") {
      await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(now.getTime() + 2 * 60_000) } });
      return;
    }
    if (priv?.status !== "SENT") return void (await skip("private_reply_not_sent"));
  }

  const acc = await accountFor(job.store, platform);
  // A broken WhatsApp link must not pause the store's Facebook and Instagram replies.
  if (!acc && platform === "WHATSAPP") return void (await skip("whatsapp_disconnected"));
  // The account was disconnected on purpose (its slot is empty): its waiting replies are dropped,
  // and the store's other platforms keep working.
  if (!acc && ((platform === "META_FACEBOOK" && !job.store.fbPageId) || (platform === "META_INSTAGRAM" && !job.store.igUserId))) {
    return void (await skip("account_disconnected"));
  }
  if (!acc) {
    await db.store.update({ where: { id: job.storeId }, data: { pausedReason: "token" } });
    await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + HOUR), lastError: "no usable credential" } });
    return;
  }

  const r = await send(acc, job.kind, payload, (rest) =>
    db.outboxJob.update({ where: { id: job.id }, data: { payload: { ...payload, urls: rest } as Prisma.InputJsonValue } }),
  );
  if (r.ok) {
    await db.outboxJob.update({ where: { id: job.id }, data: { status: "SENT", sentId: r.id, recipientId: r.recipientId ?? job.recipientId, lastError: null, attempts: { increment: 1 } } });
    return;
  }
  if (r.failure === "token" && platform === "WHATSAPP") return void (await skip(`token: ${r.error}`.slice(0, 300)));
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
