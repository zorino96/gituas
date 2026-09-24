import { redirect } from "next/navigation";

import "@/app/app/app.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { LoginCard } from "./login-card";
import { MerchantLogin } from "./merchant-login";

/** Only same-site paths may be a post-login destination — never `//host` or a URL. */
function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("..") ? n : "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; callbackUrl?: string | string[]; error?: string }>;
}) {
  const sp = await searchParams;
  // Auth.js sends failed OAuth attempts back here with ?callbackUrl= and ?error=.
  const next = safeNext(sp.next ?? (typeof sp.callbackUrl === "string" ? new URL(sp.callbackUrl, "https://x").pathname : undefined));
  const session = await auth();
  if (session) redirect(next);

  // Merchants (and anyone heading into the app) get the Kurdish sign-in with
  // email, Google and sign-up. The operator dashboard keeps its GitHub card.
  if (next.startsWith("/app")) {
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <MerchantLogin next={next} googleEnabled={googleEnabled} oauthError={sp.error} />
      </div>
    );
  }
  return <LoginCard callbackUrl={next} />;
}
