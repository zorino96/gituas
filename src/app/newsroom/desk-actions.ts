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
    select: { tenant: { select: { kind: true } } },
  });
  if (!member) redirect("/newsroom/news");
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

  const owned = await db.tenant.findMany({ where: { ownerId: userId, kind: "NEWS", kindChosen: true }, select: { plan: true } });
  if (owned.length >= deskLimit(owned.map((t) => t.plan))) {
    return { ok: false, error: "گەیشتیتە سنووری مێزەکانی پلانەکەت." };
  }

  const desk = await db.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name,
        slug: `d-${randomBytes(6).toString("hex")}`,
        ownerId: userId,
        kind: "NEWS",
        kindChosen: true,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: { id: true },
    });
    await setupNewsDesk(tx, t.id);
    await tx.auditLog.create({
      data: { tenantId: t.id, actor: "USER", action: "desk.created", reasoning: "Created a newsroom desk.", metadata: { userId } },
    });
    return t;
  });
  await rememberWorkspace(desk.id);
  redirect("/newsroom/news");
}
