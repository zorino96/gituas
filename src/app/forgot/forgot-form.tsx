"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { requestResetAction, resetPasswordAction } from "./actions";

const RESEND_WAIT_S = 60;

export function ForgotForm({ next, enabled }: { next: string; enabled: boolean }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function request(address: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await requestResetAction({ email: address });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (sentTo) setNotice("کۆدێکی نوێ نێردرا.");
      setSentTo(r.email);
      setCode("");
      setWait(RESEND_WAIT_S);
    });
  }

  function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await resetPasswordAction({ email: sentTo, code, password });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const s = await signIn("credentials", { email: r.email, password, redirect: false });
      if (s?.error) {
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }
      window.location.href = next;
    });
  }

  const back = (
    <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="gm-link">گەڕانەوە بۆ چوونەژوورەوە</Link>
    </p>
  );

  if (!enabled) {
    return (
      <div className="gm-auth">
        <p className="gm-brand kufi">گیتواس</p>
        <div className="gm-card" style={{ marginTop: 18 }}>
          <p style={{ margin: 0 }}>ئەم خزمەتگوزارییە ئێستا بەردەست نییە.</p>
        </div>
        {back}
      </div>
    );
  }

  if (!sentTo) {
    return (
      <div className="gm-auth">
        <p className="gm-brand kufi">گیتواس</p>
        <p className="gm-sub" style={{ marginTop: 4 }}>ئیمەیڵی هەژمارەکەت بنووسە، کۆدێکت بۆ دەنێرین بۆ دانانی وشەی نهێنیی نوێ.</p>
        <div className="gm-card" style={{ marginTop: 18 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              request(email);
            }}
            noValidate
          >
            <div className="gm-field">
              <label htmlFor="fp-email">ئیمەیڵ</label>
              <input id="fp-email" type="email" className="gm-input gm-ltr" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
            </div>
            {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error}</p>}
            <button type="submit" className="gm-btn block" disabled={pending || !email.trim()}>
              {pending ? "دەنێردرێت…" : "کۆدم بۆ بنێرە"}
            </button>
          </form>
        </div>
        {back}
      </div>
    );
  }

  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس</p>
      <p className="gm-sub" style={{ marginTop: 4 }}>
        ئەگەر هەژمارێک بە <bdi className="gm-ltr" dir="ltr">{sentTo}</bdi> هەبێت، کۆدێکی ٦ ژمارەییمان بۆ ناردووە.
      </p>

      <div className="gm-card" style={{ marginTop: 18 }}>
        <form onSubmit={reset} noValidate>
          <div className="gm-field">
            <label htmlFor="fp-code">کۆدی ئیمەیڵ</label>
            <input
              id="fp-code"
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
          <div className="gm-field">
            <label htmlFor="fp-password">وشەی نهێنیی نوێ (لانیکەم ٨ پیت)</label>
            <div className="gm-row" style={{ gap: 6 }}>
              <input
                id="fp-password"
                type={show ? "text" : "password"}
                className="gm-input gm-ltr"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? "شاردنەوەی وشەی نهێنی" : "پیشاندانی وشەی نهێنی"}>
                {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error}</p>}
          {notice && <p className="gm-ok" style={{ margin: 0 }}>{notice}</p>}
          <button type="submit" className="gm-btn block" disabled={pending || !code.trim() || !password}>
            {pending ? "پاشەکەوت دەکرێت…" : "وشەی نهێنیی نوێ دابنێ"}
          </button>
        </form>
        <p className="gm-sub" style={{ marginTop: 12, marginBottom: 0 }}>
          ئیمەیڵەکە نەگەیشت؟ فۆڵدەری Spam بپشکنە، یان{" "}
          <button type="button" className="gm-link gm-linkbtn" onClick={() => request(sentTo)} disabled={pending || wait > 0}>
            {wait > 0 ? `دوای ${new Intl.NumberFormat("ar-IQ").format(wait)} چرکە کۆدێکی تر بنێرە` : "کۆدێکی تر بنێرە"}
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
            setNotice(null);
          }}
        >
          ئیمەیڵەکە بگۆڕە
        </button>
      </p>
    </div>
  );
}
