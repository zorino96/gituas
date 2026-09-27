"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deskLimit } from "@/lib/billing/plans";
import { safeNext } from "@/lib/safe-next";
import { rememberWorkspace, setupNewsDesk } from "@/app/app/data";

/** Open another workspace the person belongs to. The id is checked against their memberships, never trusted. */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/newsroom/news");
  const id = String(formData.get("id") ?? "");
  const member = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: id, userId } },
    select: { tenant: { select: { kind: true, kindChosen: true } } },
  });
  // Only claimed workspaces are switchable; a placeholder is turned into a desk by createDeskAction.
  if (!member || !member.tenant.kindChosen) redirect("/newsroom/news");
  await rememberWorkspace(id);
  const home = member.tenant.kind === "NEWS" ? "/newsroom/news" : "/app";
  const next = safeNext(String(formData.get("next") ?? ""), home);
  redirect(/^\/(app|newsroom)(\/|\?|$)/.test(next) ? next : home);
}

export type DeskResult = { ok: false; error: string };

/** Create another newsroom desk (e.g. a second language) owned by the signed-in person, within their plan's desk limit. */
export async function createDeskAction(_prev: DeskResult | null, formData: FormData): Promise<DeskResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "دووبارە بچۆ ژوورەوە." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name || [...name].length > 60) return { ok: false, error: "ناوێک بۆ مێزەکە بنووسە، تا ٦٠ پیت." };

  // Counting and creating happen under a per-person lock, so two quick submits
  // can't both pass the limit. An unclaimed workspace the person owns (the
  // placeholder every sign-up gets) becomes the desk rather than lingering
  // beside it, where it could later be claimed as a desk past the limit.
  const deskId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const owned = await tx.tenant.findMany({
      where: { ownerId: userId, OR: [{ kind: "NEWS", kindChosen: true }, { kindChosen: false }] },
      orderBy: { createdAt: "asc" },
      select: { id: true, plan: true, kindChosen: true },
    });
    const desks = owned.filter((t) => t.kindChosen);
    if (desks.length >= deskLimit(desks.map((t) => t.plan))) return null;

    const spare = owned.find((t) => !t.kindChosen);
    const id = spare
      ? (await tx.tenant.update({ where: { id: spare.id }, data: { name, kind: "NEWS", kindChosen: true }, select: { id: true } })).id
      : (
          await tx.tenant.create({
            data: {
              name,
              slug: `d-${randomBytes(6).toString("hex")}`,
              ownerId: userId,
              kind: "NEWS",
              kindChosen: true,
              memberships: { create: { userId, role: "OWNER" } },
            },
            select: { id: true },
          })
        ).id;
    await setupNewsDesk(tx, id);
    await tx.auditLog.create({
      data: { tenantId: id, actor: "USER", action: "desk.created", reasoning: "Created a newsroom desk.", metadata: { userId, reusedPlaceholder: !!spare } },
    });
    return id;
  });
  if (!deskId) return { ok: false, error: "گەیشتیتە سنووری مێزەکانی پلانەکەت." };
  await rememberWorkspace(deskId);
  redirect("/newsroom/news");
}
