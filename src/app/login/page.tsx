import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { emailEnabled } from "@/lib/mailer";
import { LoginCard } from "./login-card";
import { MerchantLogin } from "./merchant-login";
import { loginTitle, productFor } from "./product";

/** Only same-site paths may be a post-login destination — never `//host` or a URL. */
function safeNext(next: string | string[] | undefined, fallback: string): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("..") ? n : fallback;
}

/**
 * Auth.js sets this cookie when a sign-in attempt starts and does not always
 * echo it back as `?callbackUrl=` on failure. Reading it is the only way to
 * recover which product (`/app` or `/newsroom`) a failed attempt started from.
 */
async function callbackCookiePath(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get("__Secure-authjs.callback-url")?.value ?? jar.get("authjs.callback-url")?.value;
  if (!value) return undefined;
  try {
    return new URL(value, "https://x").pathname;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; callbackUrl?: string | string[]; error?: string }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const callbackUrlPath = typeof sp.callbackUrl === "string" ? new URL(sp.callbackUrl, "https://x").pathname : undefined;
  const title = loginTitle(productFor(safeNext(sp.next ?? callbackUrlPath, sp.error ? "/app" : "/dashboard")));
  return title ? { title } : {};
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; callbackUrl?: string | string[]; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrlPath = typeof sp.callbackUrl === "string" ? new URL(sp.callbackUrl, "https://x").pathname : undefined;
  // Auth.js sends failed sign-in attempts back here with ?error= and, not
  // always, ?callbackUrl=. When neither ?next= nor ?callbackUrl= says where the
  // attempt started, fall back to the callback-url cookie Auth.js set when it
  // began, so a channel's failed Google sign-in returns to the newsroom
  // sign-in — not the shop's — and a second attempt doesn't create the
  // account under the wrong product.
  const cookieNext = sp.error && !sp.next && !callbackUrlPath ? await callbackCookiePath() : undefined;
  const next = safeNext(sp.next ?? callbackUrlPath ?? cookieNext, sp.error ? "/app" : "/dashboard");
  const session = await auth();
  if (session) redirect(next);

  // Merchants and channels (anyone heading into the app or the newsroom) get
  // the Kurdish sign-in with email, Google and sign-up. The operator
  // dashboard keeps its GitHub card.
  const product = productFor(next);
  if (product !== "operator") {
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <MerchantLogin
          next={next}
          googleEnabled={googleEnabled}
          resetEnabled={emailEnabled}
          oauthError={sp.error}
          product={product}
        />
      </div>
    );
  }
  return <LoginCard callbackUrl={next} />;
}
