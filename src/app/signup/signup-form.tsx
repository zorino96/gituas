"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { signupAction } from "./actions";

export function SignupForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await signupAction({ name, email, password });
      if (!r.ok) {
        setError({ field: r.field, text: r.error });
        return;
      }
      const s = await signIn("credentials", { email: r.email, password, redirect: false });
      if (s?.error) {
        setError({ text: "هەژمارەکە دروست کرا، بەڵام چوونەژوورەوە سەرکەوتوو نەبوو. لە پەڕەی چوونەژوورەوە هەوڵ بدەرەوە." });
        return;
      }
      window.location.href = next;
    });
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
