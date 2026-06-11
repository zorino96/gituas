import { NextResponse } from "next/server";

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

  if (oauthError) {
    const back = new URL("/dashboard/integrations", req.url);
    back.searchParams.set("error", oauthError);
    return NextResponse.redirect(back);
  }
  if (!code || !state) {
    const back = new URL("/dashboard/integrations", req.url);
    back.searchParams.set("error", "missing code or state");
    return NextResponse.redirect(back);
  }

  try {
    const { redirectTo } = await completeOAuth(upper, code, state);
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
        : /mismatch/i.test(msg)
          ? "provider_mismatch"
          : "oauth_failed";
    const back = new URL("/dashboard/integrations", req.url);
    back.searchParams.set("error", code);
    return NextResponse.redirect(back);
  }
}
