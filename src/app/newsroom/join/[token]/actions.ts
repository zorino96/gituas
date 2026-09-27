"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { rememberWorkspace } from "@/app/app/data";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { hashInviteToken, inviteState } from "@/lib/newsroom/invite";

export type JoinResult = { ok: false; error: string };

const GONE = "ئەم بانگهێشتە چیتر کار ناکات.";

/** Join the desk once: only the invited, verified email, and the invite is consumed atomically. */
export async function acceptInviteAction(_prev: JoinResult | null, formData: FormData): Promise<JoinResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "سەرەتا بچۆ ژوورەوە." };
  const token = String(formData.get("token") ?? "");
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { id: true, tenantId: true, email: true, role: true, acceptedAt: true, expiresAt: true },
  });
  if (!invite || inviteState(invite) !== "ok") return { ok: false, error: GONE };
  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!me?.emailVerified || me.email?.toLowerCase() !== invite.email) {
    return { ok: false, error: "ئەم بانگهێشتە بۆ ئیمەیڵێکی ترە." };
  }

  const now = new Date();
  const outcome = await db.$transaction(
    async (tx) => {
      // One accept at a time per desk, and the seat limit is checked here — the
      // hard stop — so re-sent or simultaneous invites can't overfill a plan.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invite.tenantId}))`;
      const already = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId } },
        select: { id: true },
      });
      if (!already) {
        const members = await tx.membership.count({ where: { tenantId: invite.tenantId } });
        const tenant = await tx.tenant.findUnique({ where: { id: invite.tenantId }, select: { plan: true } });
        if (members >= NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats) return "full" as const;
      }
      const { count } = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (count === 0) return "gone" as const;
      if (!already) await tx.membership.create({ data: { tenantId: invite.tenantId, userId, role: invite.role } });
      await tx.auditLog.create({
        data: { tenantId: invite.tenantId, actor: "USER", action: "member.joined", reasoning: "Accepted a team invite.", metadata: { userId, role: invite.role } },
      });
      return "joined" as const;
    },
    { timeout: 15_000 },
  );
  if (outcome === "full") return { ok: false, error: "هەموو شوێنەکانی ئەم مێزە پڕن. بە خاوەنی مێزەکە بڵێ." };
  if (outcome === "gone") return { ok: false, error: GONE };
  await rememberWorkspace(invite.tenantId);
  redirect("/newsroom/news");
}
