"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { resendSignupCodeAction, signupAction, verifySignupAction } from "./actions";

const RESEND_WAIT_S = 60;

export function SignupForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
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
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function signInAndGo(address: string) {
    const s = await signIn("credentials", { email: address, password, redirect: false });
    if (s?.error) {
      setError({ text: "هەژمارەکە دروست کرا، بەڵام چوونەژوورەوە سەرکەوتوو نەبوو. لە پەڕەی چوونەژوورەوە هەوڵ بدەرەوە." });
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
        <p className="gm-brand kufi">گیتواس</p>
        <p className="gm-sub" style={{ marginTop: 4 }}>
          کۆدێکی ٦ ژمارەییمان نارد بۆ <bdi className="gm-ltr" dir="ltr">{sentTo}</bdi>. بینووسە بۆ تەواوکردنی تۆمارکردن.
        </p>

        <div className="gm-card" style={{ marginTop: 18 }}>
          <form onSubmit={verify} noValidate>
            <div className="gm-field">
              <label htmlFor="su-code">کۆدی ئیمەیڵ</label>
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
              {pending ? "دەپشکنرێت…" : "دڵنیاکردنەوە"}
            </button>
          </form>
          <p className="gm-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            ئیمەیڵەکە نەگەیشت؟ فۆڵدەری Spam بپشکنە، یان{" "}
            <button type="button" className="gm-link gm-linkbtn" onClick={resend} disabled={pending || wait > 0}>
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
            }}
          >
            ئیمەیڵەکە بگۆڕە
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس</p>
      <p className="gm-sub" style={{ marginTop: 4 }}>هەژمارێکی نوێ دروست بکە — کۆمێنت، نامە و بڵاوکردنەوە لە یەک شوێن.</p>

      <div className="gm-card" style={{ marginTop: 18 }}>
        {googleEnabled && (
          <>
            <button type="button" className="gm-btn block gm-google" onClick={() => signIn("google", { callbackUrl: next })}>
              <span className="gm-g" aria-hidden="true">G</span> بە گووگڵ خۆت تۆمار بکە
            </button>
            <div className="gm-or">یان بە ئیمەیڵ</div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          <div className="gm-field">
            <label htmlFor="su-name">ناوی دووکان یان ناوی خۆت</label>
            <input id="su-name" className="gm-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" maxLength={60} required />
          </div>
          <div className="gm-field">
            <label htmlFor="su-email">ئیمەیڵ</label>
            <input id="su-email" type="email" className="gm-input gm-ltr" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="gm-field">
            <label htmlFor="su-password">وشەی نهێنی (لانیکەم ٨ پیت)</label>
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
              <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? "شاردنەوەی وشەی نهێنی" : "پیشاندانی وشەی نهێنی"}>
                {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <p className="gm-err" role="alert" style={{ margin: 0 }}>{error.text}</p>}
          <button type="submit" className="gm-btn block" disabled={pending}>
            {pending ? "دروست دەکرێت…" : "هەژمار دروست بکە"}
          </button>
        </form>
      </div>

      <p className="gm-sub" style={{ textAlign: "center", marginTop: 16 }}>
        هەژمارت هەیە؟{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="gm-link">بچۆ ژوورەوە</Link>
      </p>
    </div>
  );
}
