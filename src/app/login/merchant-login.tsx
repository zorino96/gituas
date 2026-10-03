"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { useT } from "@/lib/i18n/client";

/** Sign-in for the merchant app or the newsroom: email and password, Google when configured; GitHub (the owner's own sign-in) only on the shop's page. */
export function MerchantLogin({
  next,
  googleEnabled,
  resetEnabled,
  oauthError,
  product = "shop",
}: {
  next: string;
  googleEnabled: boolean;
  resetEnabled: boolean;
  oauthError?: string;
  product?: "shop" | "newsroom";
}) {
  const t = useT();
  const brand = product === "newsroom" ? t.nr.shell.name : t.brand;
  const subtitle = product === "newsroom" ? t.auth.login.subtitleNewsroom : t.auth.login.subtitleShop;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthError === "OAuthAccountNotLinked"
      ? t.auth.login.emailHasPassword
      : oauthError
        ? t.auth.login.oauthFailed
        : null,
  );
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await signIn("credentials", { email, password, redirect: false });
      if (r?.error) {
        // One message for a wrong address, a wrong password, or too many tries:
        // telling them apart would tell a stranger which addresses exist.
        setError(t.auth.login.wrongCredentials);
        return;
      }
      window.location.href = next;
    });
  }

  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">{brand}</p>
      <p className="gm-sub" style={{ marginTop: 4 }}>{subtitle}</p>

      <div className="gm-card" style={{ marginTop: 18 }}>
        {googleEnabled && (
          <>
            <button type="button" className="gm-btn block gm-google" onClick={() => signIn("google", { callbackUrl: next })}>
              <span className="gm-g" aria-hidden="true">G</span> {t.auth.login.google}
            </button>
            <div className="gm-or">{t.auth.common.orEmail}</div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          <div className="gm-field">
            <label htmlFor="li-email">{t.auth.common.email}</label>
            <input id="li-email" type="email" className="gm-input gm-ltr" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="gm-field">
            <label htmlFor="li-password">{t.auth.common.password}</label>
            <div className="gm-row" style={{ gap: 6 }}>
              <input
                id="li-password"
                type={show ? "text" : "password"}
                className="gm-input gm-ltr"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? t.auth.common.hidePassword : t.auth.common.showPassword}>
                {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
            {resetEnabled && (
              <Link href={`/forgot?next=${encodeURIComponent(next)}`} className="gm-link" style={{ display: "inline-block", fontSize: 12, marginTop: 6 }}>
                {t.auth.login.forgot}
              </Link>
            )}
          </div>
          {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button type="submit" className="gm-btn block" disabled={pending || !email || !password}>
            {pending ? t.auth.login.submitting : t.auth.common.signIn}
          </button>
        </form>
      </div>

      <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
        {t.auth.login.noAccount}{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="gm-link">{t.auth.login.signUp}</Link>
      </p>
      {product !== "newsroom" && (
        <p style={{ textAlign: "center", marginTop: 4 }}>
          <button type="button" className="gm-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 500 }} onClick={() => signIn("github", { callbackUrl: next })}>
            {t.auth.login.github}
          </button>
        </p>
      )}
    </div>
  );
}
