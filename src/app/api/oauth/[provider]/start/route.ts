import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { buildAuthorizeUrl } from "@/lib/oauth/flow";
import type { OAuthProvider } from "@/generated/prisma/client";
import { currentWorkspace } from "@/app/app/data";
import { can } from "@/lib/newsroom/roles";
import { safeNext } from "@/lib/safe-next";
import { isAppOrigin } from "@/lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.url));

  const { provider } = await ctx.params;
  const upper = provider.toUpperCase() as OAuthProvider;

  // Where to land after the provider sends the user back. Only our own
  // surfaces are allowed, so this can never become an open redirect.
  const next = new URL(req.url).searchParams.get("next");
  // The parsed, normalised path is what's checked and stored, so encoded
  // dot-segments can't smuggle in another host.
  const cleaned = safeNext(next, "");
  const returnTo = /^\/(app|newsroom|dashboard)(\/|\?|$)/.test(cleaned) ? cleaned : "/dashboard/integrations";

  // The shop and the newsroom connect pages to the workspace being worked in,
  // and only owners and editors may. The operator dashboard keeps its own tenant.
  let tenantId: string;
  if (/^\/(app|newsroom)(\/|$)/.test(returnTo)) {
    const ws = await currentWorkspace();
    if (!ws) return NextResponse.redirect(new URL("/login", req.url));
    if (!can(ws.role, "configure")) {
      const back = new URL(returnTo, req.url);
      back.searchParams.set("error", "not_allowed");
      return NextResponse.redirect(back);
    }
    tenantId = ws.id;
  } else {
    const tenant = await db.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true } });
    if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });
    tenantId = tenant.id;
  }

  // The provider always calls back on the app's registered address; remember
  // which of our domains this started on (gituas.com or hawalnoos.com), so the
  // person lands back where their session is.
  const origin = new URL(req.url).origin;
  const backTo = isAppOrigin(origin) ? `${origin}${returnTo}` : returnTo;

  try {
    const url = await buildAuthorizeUrl(upper, tenantId, backTo);
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    const back = new URL(returnTo, req.url);
    back.searchParams.set("error", msg);
    return NextResponse.redirect(back);
  }
}
