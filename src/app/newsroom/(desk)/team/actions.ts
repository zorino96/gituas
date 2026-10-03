"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";

import { auth } from "@/auth";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { db } from "@/lib/db";
import { currentWorkspace, type Workspace } from "@/app/app/data";
import { NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";
import { dict, getLang } from "@/lib/i18n";
import { ckb } from "@/lib/i18n/ckb";
import { emailEnabled, inviteEmail, sendEmail } from "@/lib/mailer";
import { INVITE_TTL_MS, INVITES_PER_DAY, inviteLink, newInviteToken, normalizeEmail } from "@/lib/newsroom/invite";
import { can, isInvitableRole, ROLE_LABEL, type InvitableRole } from "@/lib/newsroom/roles";

export type TeamResult = { ok: true; link?: string; emailed?: boolean } | { ok: false; error: string };

/** Invites always open on the newsroom's own domain (the address the page was opened on, in development). */
async function inviteOrigin(): Promise<string> {
  if (process.env.NODE_ENV === "production") return NEWSROOM_ORIGIN;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : NEWSROOM_ORIGIN;
}
const DAY_MS = 24 * 60 * 60 * 1000;

/** The current newsroom desk, only when the signed-in person owns it. */
async function ownedDesk(): Promise<Workspace | null> {
  const ws = await currentWorkspace();
  return ws && ws.kind === "NEWS" && can(ws.role, "team") ? ws : null;
}

async function teamText() {
  return dict(await getLang()).nr.team;
}

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

/** Invites sent (or re-sent) in the last day — counted from the log, so replacing an invite can't dodge the cap. */
async function invitesToday(tenantId: string): Promise<number> {
  return db.auditLog.count({
    where: { tenantId, action: { in: ["member.invited", "member.reinvited"] }, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
  });
}

async function deliver(ws: Workspace, email: string, role: InvitableRole, token: string): Promise<{ link: string; emailed: boolean }> {
  const session = await auth();
  const inviter = session?.user?.name || session?.user?.email || ckb.brand;
  const link = inviteLink(await inviteOrigin(), token);
  // The invite email is written in Sorani, so its role name is too.
  const emailed = emailEnabled && (await sendEmail({ to: email, ...inviteEmail({ desk: ws.name, inviter, role: ROLE_LABEL[role], link }) })).ok;
  return { link, emailed };
}

export async function inviteMemberAction(input: { email: string; role: string }): Promise<TeamResult> {
  const t = await teamText();
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: t.roles.ownerOnly };
  const session = await auth();
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: t.errors.badEmail };
  if (!isInvitableRole(input.role)) return { ok: false, error: t.errors.badRole };
  const role = input.role;
  const now = new Date();

  const [members, pending, sentToday, already, tenant] = await Promise.all([
    db.membership.count({ where: { tenantId: ws.id } }),
    db.invite.count({ where: { tenantId: ws.id, acceptedAt: null, expiresAt: { gt: now }, NOT: { email } } }),
    invitesToday(ws.id),
    db.membership.findFirst({ where: { tenantId: ws.id, user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
  ]);
  if (already) return { ok: false, error: t.errors.alreadyMember };
  if (sentToday >= INVITES_PER_DAY) return { ok: false, error: t.errors.tooMany };
  if (seatsLeft(NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats, members, pending) === 0) {
    return { ok: false, error: t.errors.seatsFull };
  }

  const { token, tokenHash } = newInviteToken();
  // One live invite per email and desk: a new one replaces the old.
  await db.$transaction([
    db.invite.deleteMany({ where: { tenantId: ws.id, email, acceptedAt: null } }),
    db.invite.create({
      data: { tenantId: ws.id, email, role, tokenHash, invitedById: session!.user!.id!, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) },
    }),
  ]);
  await audit(ws.id, "member.invited", `Invited ${email} as ${role}.`, { email, role });
  const sent = await deliver(ws, email, role, token);
  revalidatePath("/newsroom/team");
  return { ok: true, ...sent };
}

export async function resendInviteAction(inviteId: string): Promise<TeamResult> {
  const t = await teamText();
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: t.roles.ownerOnly };
  const invite = await db.invite.findFirst({
    where: { id: inviteId, tenantId: ws.id, acceptedAt: null },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  if (!invite || !isInvitableRole(invite.role)) return { ok: false, error: t.errors.inviteNotFound };
  if ((await invitesToday(ws.id)) >= INVITES_PER_DAY) return { ok: false, error: t.errors.tooMany };
  // An expired invite no longer holds a seat, so bringing it back needs one free.
  const now = new Date();
  if (invite.expiresAt <= now) {
    const [members, live, tenant] = await Promise.all([
      db.membership.count({ where: { tenantId: ws.id } }),
      db.invite.count({ where: { tenantId: ws.id, acceptedAt: null, expiresAt: { gt: now } } }),
      db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    ]);
    if (seatsLeft(NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats, members, live) === 0) {
      return { ok: false, error: t.errors.seatsFull };
    }
  }
  const { token, tokenHash } = newInviteToken();
  await db.invite.update({ where: { id: invite.id }, data: { tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  await audit(ws.id, "member.reinvited", `Re-sent the invite to ${invite.email}.`, { email: invite.email });
  const sent = await deliver(ws, invite.email, invite.role, token);
  revalidatePath("/newsroom/team");
  return { ok: true, ...sent };
}

export async function revokeInviteAction(inviteId: string): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: (await teamText()).roles.ownerOnly };
  const { count } = await db.invite.deleteMany({ where: { id: inviteId, tenantId: ws.id, acceptedAt: null } });
  if (count) await audit(ws.id, "member.invite_revoked", "Revoked an invite.", { inviteId });
  revalidatePath("/newsroom/team");
  return { ok: true };
}

export async function changeRoleAction(membershipId: string, role: string): Promise<TeamResult> {
  const t = await teamText();
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: t.roles.ownerOnly };
  if (!isInvitableRole(role)) return { ok: false, error: t.errors.badRole };
  const m = await db.membership.findFirst({ where: { id: membershipId, tenantId: ws.id }, select: { id: true, role: true, userId: true } });
  if (!m) return { ok: false, error: t.errors.memberNotFound };
  if (m.role === "OWNER") return { ok: false, error: t.errors.ownerRoleFixed };
  await db.membership.update({ where: { id: m.id }, data: { role } });
  await audit(ws.id, "member.role_changed", `Changed a member's role to ${role}.`, { userId: m.userId, from: m.role, to: role });
  revalidatePath("/newsroom/team");
  return { ok: true };
}

export async function removeMemberAction(membershipId: string): Promise<TeamResult> {
  const t = await teamText();
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: t.roles.ownerOnly };
  const m = await db.membership.findFirst({ where: { id: membershipId, tenantId: ws.id }, select: { id: true, role: true, userId: true } });
  if (!m) return { ok: false, error: t.errors.memberNotFound };
  if (m.role === "OWNER") return { ok: false, error: t.errors.ownerStays };
  await db.membership.delete({ where: { id: m.id } });
  await audit(ws.id, "member.removed", "Removed a member.", { userId: m.userId, role: m.role });
  revalidatePath("/newsroom/team");
  return { ok: true };
}
