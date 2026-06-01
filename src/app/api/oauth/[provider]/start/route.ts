import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { buildAuthorizeUrl } from "@/lib/oauth/flow";
import type { OAuthProvider } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const { provider } = await ctx.params;
  const upper = provider.toUpperCase() as OAuthProvider;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  try {
    const url = await buildAuthorizeUrl(upper, tenant.id, "/dashboard/integrations");
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    const back = new URL("/dashboard/integrations", req.url);
    back.searchParams.set("error", msg);
    return NextResponse.redirect(back);
  }
}
