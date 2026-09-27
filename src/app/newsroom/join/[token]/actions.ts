"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { rememberWorkspace } from "@/app/app/data";
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
  const joined = await db.$transaction(async (tx) => {
    const { count } = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (count === 0) return false;
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId } },
      create: { tenantId: invite.tenantId, userId, role: invite.role },
      update: {},
    });
    await tx.auditLog.create({
      data: { tenantId: invite.tenantId, actor: "USER", action: "member.joined", reasoning: "Accepted a team invite.", metadata: { userId, role: invite.role } },
    });
    return true;
  });
  if (!joined) return { ok: false, error: GONE };
  await rememberWorkspace(invite.tenantId);
  redirect("/newsroom/news");
}
