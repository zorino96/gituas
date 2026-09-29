"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { rememberWorkspace } from "./data";

/**
 * Give an account that so far only has newsroom desks a shop of its own (one
 * per person) and open it — so signing in to the shop with the same Gmail
 * works instead of bouncing to the newsroom. An unclaimed sign-up placeholder
 * becomes the shop; an existing shop is simply reopened.
 */
export async function createShopAction(): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/app");

  const shopId = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const owned = await tx.tenant.findMany({
        where: { ownerId: userId, OR: [{ kind: "MERCHANT", kindChosen: true }, { kindChosen: false }] },
        orderBy: { createdAt: "asc" },
        select: { id: true, kindChosen: true },
      });
      const shop = owned.find((t) => t.kindChosen);
      if (shop) return shop.id;
      const spare = owned.find((t) => !t.kindChosen);
      const id = spare
        ? (await tx.tenant.update({ where: { id: spare.id }, data: { kind: "MERCHANT", kindChosen: true }, select: { id: true } })).id
        : (
            await tx.tenant.create({
              data: {
                name: "دووکانەکەم",
                slug: `s-${randomBytes(6).toString("hex")}`,
                ownerId: userId,
                kind: "MERCHANT",
                kindChosen: true,
                memberships: { create: { userId, role: "OWNER" } },
              },
              select: { id: true },
            })
          ).id;
      await tx.auditLog.create({
        data: { tenantId: id, actor: "USER", action: "shop.created", reasoning: "Created a shop for an account that had only newsroom desks.", metadata: { userId, reusedPlaceholder: !!spare } },
      });
      return id;
    },
    { timeout: 15_000 },
  );
  await rememberWorkspace(shopId);
  redirect("/app");
}
