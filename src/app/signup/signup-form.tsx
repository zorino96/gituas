"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { resendSignupCodeAction, signupAction, verifySignupAction } from "./actions";

const RESEND_WAIT_S = 60;

export function SignupForm({
  next,
  googleEnabled,
  product = "shop",
}: {
  next: string;
  googleEnabled: boolean;
  product?: "shop" | "newsroom";
}) {
  const t = useT();
  const brand = product === "newsroom" ? t.nr.shell.name : t.brand;
  const subtitle = product === "newsroom" ? t.auth.signup.subtitleNewsroom : t.auth.signup.subtitleShop;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  // Set once a code has been emailed: the form turns into the code step.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function signInAndGo(address: string) {
    const s = await signIn("credentials", { email: address, password, redirect: false });
    if (s?.error) {
      setError({ text: t.auth.signup.autoSignInFailed });
      return;
    }
    window.location.href = next;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await signupAction({ name, email, password });
      if (!r.ok) {
        setError({ field: r.field, text: r.error });
        return;
      }
      if (r.verify) {
        setSentTo(r.email);
        setCode("");
        setWait(RESEND_WAIT_S);
        return;
      }
      await signInAndGo(r.email);
    });
  }

  function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setError(null);
    start(async () => {
      const r = await verifySignupAction({ email: sentTo, code });
      if (!r.ok) {
        setError({ field: r.field, text: r.error });
        return;
      }
      await signInAndGo(r.email);
    });
  }

  function resend() {
    if (!sentTo) return;
    setError(null);
    start(async () => {
      const r = await resendSignupCodeAction({ email: sentTo });
      if (!r.ok) {
        setError({ field: r.field, text: r.error });
        return;
      }
      setCode("");
      setWait(RESEND_WAIT_S);
    });
  }

  if (sentTo) {
    return (
      <div className="gm-auth">
        <p className="gm-brand kufi">{brand}</p>
        <p className="gm-sub" style={{ marginTop: 4 }}>
          {t.auth.signup.codeSentBefore} <bdi className="gm-ltr" dir="ltr">{sentTo}</bdi>{t.auth.signup.codeSentAfter}
        </p>

        <div className="gm-card" style={{ marginTop: 18 }}>
          <form onSubmit={verify} noValidate>
            <div className="gm-field">
              <label htmlFor="su-code">{t.auth.common.emailCode}</label>
              <input
                id="su-code"
                className="gm-input gm-ltr gm-code"
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                autoFocus
                required
              />
            </div>
            {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error.text}</p>}
            <button type="submit" className="gm-btn block" disabled={pending || !code.trim()}>
              {pending ? t.auth.signup.verifying : t.auth.signup.verify}
            </button>
          </form>
          <p className="gm-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            {t.auth.common.noEmail}{" "}
            <button type="button" className="gm-link gm-linkbtn" onClick={resend} disabled={pending || wait > 0}>
              {wait > 0 ? t.auth.resendIn(wait) : t.auth.common.resend}
            </button>
          </p>
        </div>

        <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
          <button
            type="button"
            className="gm-link gm-linkbtn"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            {t.auth.common.changeEmail}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">{brand}</p>
      <p className="gm-sub" style={{ marginTop: 4 }}>{subtitle}</p>

      <div className="gm-card" style={{ marginTop: 18 }}>
        {googleEnabled && (
          <>
            <button type="button" className="gm-btn block gm-google" onClick={() => signIn("google", { callbackUrl: next })}>
              <span className="gm-g" aria-hidden="true">G</span> {t.auth.signup.google}
            </button>
            <div className="gm-or">{t.auth.common.orEmail}</div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          <div className="gm-field">
            <label htmlFor="su-name">{product === "newsroom" ? t.auth.signup.nameNewsroom : t.auth.signup.nameShop}</label>
            <input id="su-name" className="gm-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" maxLength={60} required />
          </div>
          <div className="gm-field">
            <label htmlFor="su-email">{t.auth.common.email}</label>
            <input id="su-email" type="email" className="gm-input gm-ltr" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="gm-field">
            <label htmlFor="su-password">{t.auth.signup.passwordLabel}</label>
            <div className="gm-row" style={{ gap: 6 }}>
              <input
                id="su-password"
                type={show ? "text" : "password"}
                className="gm-input gm-ltr"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? t.auth.common.hidePassword : t.auth.common.showPassword}>
                {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error.text}</p>}
          <button type="submit" className="gm-btn block" disabled={pending}>
            {pending ? t.auth.signup.submitting : t.auth.signup.submit}
          </button>
        </form>
      </div>

      <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
        {t.auth.signup.haveAccount}{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="gm-link">{t.auth.common.signIn}</Link>
      </p>
    </div>
  );
}
