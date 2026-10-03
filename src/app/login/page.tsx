import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { LangSwitch } from "@/app/app/lang-switch";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { emailEnabled } from "@/lib/mailer";
import { safeNext } from "@/lib/safe-next";
import { LoginCard } from "./login-card";
import { MerchantLogin } from "./merchant-login";
import { loginTitle, productFor } from "./product";

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

type LoginParams = { next?: string | string[]; callbackUrl?: string | string[]; error?: string };

/** Where to go after signing in, and so which product's sign-in to show. */
async function resolveNext(sp: LoginParams): Promise<string> {
  let callbackUrlPath: string | undefined;
  if (typeof sp.callbackUrl === "string") {
    try {
      callbackUrlPath = new URL(sp.callbackUrl, "https://x").pathname;
    } catch {
      callbackUrlPath = undefined;
    }
  }
  // Auth.js sends failed sign-in attempts back here with ?error= and, not
  // always, ?callbackUrl=. When neither ?next= nor ?callbackUrl= says where the
  // attempt started, fall back to the callback-url cookie Auth.js set when it
  // began, so a channel's failed Google sign-in returns to the newsroom
  // sign-in — not the shop's — and a second attempt doesn't create the
  // account under the wrong product.
  const cookieNext = sp.error && !sp.next && !callbackUrlPath ? await callbackCookiePath() : undefined;
  return safeNext(sp.next ?? callbackUrlPath ?? cookieNext, sp.error ? "/app" : "/dashboard");
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<LoginParams>;
}): Promise<Metadata> {
  const title = loginTitle(productFor(await resolveNext(await searchParams)), dict(await getLang()));
  return title ? { title } : {};
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginParams>;
}) {
  const sp = await searchParams;
  const next = await resolveNext(sp);
  const session = await auth();
  if (session) redirect(next);

  // Merchants and channels (anyone heading into the app or the newsroom) get
  // the Kurdish sign-in with email, Google and sign-up. The operator
  // dashboard keeps its GitHub card.
  const product = productFor(next);
  if (product !== "operator") {
    const lang = await getLang();
    return (
      <div className={`gm ${product === "newsroom" ? "nr " : ""}${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
        <LangProvider lang={lang}>
          <LangSwitch />
          <MerchantLogin
            next={next}
            googleEnabled={googleEnabled}
            resetEnabled={emailEnabled}
            oauthError={sp.error}
            product={product}
          />
        </LangProvider>
      </div>
    );
  }
  return <LoginCard callbackUrl={next} />;
}
