import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { currentWorkspace } from "@/app/app/data";
import { NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";
import { inviteState } from "@/lib/newsroom/invite";
import { can } from "@/lib/newsroom/roles";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const ws = (await currentWorkspace())!;
  if (ws.kind !== "NEWS") redirect("/newsroom");
  const now = new Date();
  const [members, invites, tenant] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ws.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    db.invite.findMany({
      where: { tenantId: ws.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
  ]);
  const live = invites.filter((i) => inviteState({ acceptedAt: null, expiresAt: i.expiresAt }, now) === "ok").length;
  const seats = NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats;

  return (
    <TeamClient
      canManage={can(ws.role, "team")}
      seats={seats}
      left={seatsLeft(seats, members.length, live)}
      members={members.map((m) => ({ id: m.id, name: m.user.name ?? "", email: m.user.email ?? "", role: m.role }))}
      invites={invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expired: inviteState({ acceptedAt: null, expiresAt: i.expiresAt }, now) === "expired",
      }))}
    />
  );
}
