"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

/** Sign-in for the merchant app: email and password, Google when configured, GitHub for the owner. */
export function MerchantLogin({ next, googleEnabled, oauthError }: { next: string; googleEnabled: boolean; oauthError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthError === "OAuthAccountNotLinked"
      ? "ئەم ئیمەیڵە پێشتر بە وشەی نهێنی تۆمار کراوە — بە ئیمەیڵ و وشەی نهێنی بچۆ ژوورەوە."
      : oauthError
        ? "چوونەژوورەوە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە."
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
        setError("ئیمەیڵ یان وشەی نهێنی هەڵەیە. ئەگەر زۆر جار هەڵەت کردووە، ١٥ خولەک چاوەڕێ بکە.");
        return;
      }
      window.location.href = next;
    });
  }

  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس</p>
      <p className="gm-sub" style={{ marginTop: 4 }}>بچۆ ژوورەوە بۆ کۆمێنت، نامە و بڵاوکردنەوەی دووکانەکەت.</p>

      <div className="gm-card" style={{ marginTop: 18 }}>
        {googleEnabled && (
          <>
            <button type="button" className="gm-btn block gm-google" onClick={() => signIn("google", { callbackUrl: next })}>
              <span className="gm-g" aria-hidden="true">G</span> بە گووگڵ بچۆ ژوورەوە
            </button>
            <div className="gm-or">یان بە ئیمەیڵ</div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          <div className="gm-field">
            <label htmlFor="li-email">ئیمەیڵ</label>
            <input id="li-email" type="email" className="gm-input gm-ltr" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="gm-field">
            <label htmlFor="li-password">وشەی نهێنی</label>
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
              <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? "شاردنەوەی وشەی نهێنی" : "پیشاندانی وشەی نهێنی"}>
                {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button type="submit" className="gm-btn block" disabled={pending || !email || !password}>
            {pending ? "چوونەژوورەوە…" : "بچۆ ژوورەوە"}
          </button>
        </form>
      </div>

      <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
        هەژمارت نییە؟{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="gm-link">خۆت تۆمار بکە</Link>
      </p>
      <p style={{ textAlign: "center", marginTop: 4 }}>
        <button type="button" className="gm-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 500 }} onClick={() => signIn("github", { callbackUrl: next })}>
          بە GitHub بچۆ ژوورەوە
        </button>
      </p>
    </div>
  );
}
