"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

import { changePasswordAction } from "../actions";

/**
 * Change the password — or, for an account made with Google or GitHub, add
 * one, so the same person can also sign in with their email.
 */
export function PasswordCard({ email, hasPassword: initial }: { email: string; hasPassword: boolean }) {
  const [hasPassword, setHasPassword] = useState(initial);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await changePasswordAction(current, next);
      if (!r.ok) {
        setMessage({ ok: false, text: r.error });
        return;
      }
      // The change signed out every session, this one included; sign this
      // browser back in with the new password so only the others are logged out.
      const s = await signIn("credentials", { email, password: next, redirect: false });
      if (s?.error) {
        window.location.href = "/login?next=/app/settings";
        return;
      }
      setMessage({
        ok: true,
        text: hasPassword
          ? "وشەی نهێنی گۆڕدرا. ئامێرەکانی تر لە هەژمارەکەت دەرکران."
          : "وشەی نهێنی زیاد کرا. ئێستا بە ئیمەیڵیش دەتوانیت بچیتە ژوورەوە.",
      });
      setHasPassword(true);
      setCurrent("");
      setNext("");
    });
  }

  return (
    <div className="gm-card">
      <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {hasPassword ? (
          <div className="gm-field">
            <label htmlFor="pw-current">وشەی نهێنیی ئێستا</label>
            <input
              id="pw-current"
              type={show ? "text" : "password"}
              className="gm-input gm-ltr"
              dir="ltr"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        ) : (
          <p className="gm-hint" style={{ margin: 0 }}>
            هەژمارەکەت بە گووگڵ یان GitHub دروست کراوە. وشەی نهێنییەک زیاد بکە تا بە ئیمەیڵیش بتوانیت بچیتە ژوورەوە.
          </p>
        )}
        <div className="gm-field">
          <label htmlFor="pw-next">وشەی نهێنیی نوێ (لانیکەم ٨ پیت)</label>
          <div className="gm-row" style={{ gap: 6 }}>
            <input
              id="pw-next"
              type={show ? "text" : "password"}
              className="gm-input gm-ltr"
              dir="ltr"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <button type="button" className="gm-btn quiet small" onClick={() => setShow((s) => !s)} aria-label={show ? "شاردنەوەی وشەی نهێنی" : "پیشاندانی وشەی نهێنی"}>
              {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div>
          <button type="submit" className="gm-btn" disabled={pending || !next || (hasPassword && !current)}>
            {pending ? "پاشەکەوت دەکرێت…" : hasPassword ? "گۆڕینی وشەی نهێنی" : "زیادکردنی وشەی نهێنی"}
          </button>
        </div>
        {message && (
          <p className={message.ok ? "gm-ok" : "gm-err"} role={message.ok ? "status" : "alert"} style={{ margin: 0 }}>
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
}
