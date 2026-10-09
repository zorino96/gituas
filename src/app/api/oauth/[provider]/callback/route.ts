import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { isAppOrigin } from "@/lib/hosts";
import { completeOAuth } from "@/lib/oauth/flow";
import type { OAuthProvider } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const upper = provider.toUpperCase() as OAuthProvider;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Failures return the user to the surface they started from, when the state
  // row still says where that was.
  const errorHome = async () => {
    const row = state ? await db.oAuthState.findUnique({ where: { state }, select: { redirectTo: true } }).catch(() => null) : null;
    return row?.redirectTo ?? "/dashboard/integrations";
  };

  if (oauthError) {
    const back = new URL(await errorHome(), req.url);
    back.searchParams.set("error", oauthError);
    return NextResponse.redirect(back);
  }
  if (!code || !state) {
    const back = new URL(await errorHome(), req.url);
    back.searchParams.set("error", "missing code or state");
    return NextResponse.redirect(back);
  }

  const home = await errorHome();
  // The provider calls back on the app's registered address; the person's session lives on the
  // domain the connect started from. Send the callback there, so it is finished with that session.
  const startOrigin = /^https?:\/\//.test(home) ? new URL(home).origin : null;
  if (startOrigin && startOrigin !== url.origin && isAppOrigin(startOrigin)) {
    return NextResponse.redirect(`${startOrigin}${url.pathname}${url.search}`);
  }
  try {
    const session = await auth();
    const { redirectTo } = await completeOAuth(upper, code, state, session?.user?.id ?? null);
    const back = new URL(redirectTo, req.url);
    back.searchParams.set("connected", upper.toLowerCase());
    return NextResponse.redirect(back);
  } catch (err) {
    // Raw messages can echo provider API bodies (token-exchange responses),
    // which must not end up in the URL / browser history. Log server-side,
    // forward an opaque code.
    const msg = err instanceof Error ? err.message : "OAuth failed";
    console.error(`[oauth:${provider}] callback failed:`, msg);
    const code = /state/i.test(msg)
      ? "state_expired"
      : /exchange|token/i.test(msg)
        ? "token_exchange_failed"
        : /session mismatch/i.test(msg)
          ? "session_mismatch"
        : /mismatch/i.test(msg)
          ? "provider_mismatch"
          : "oauth_failed";
    const back = new URL(home, req.url);
    back.searchParams.set("error", code);
    return NextResponse.redirect(back);
  }
}
