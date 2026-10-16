"use client";

import { useState, useTransition } from "react";

import { useT } from "@/lib/i18n/client";
import { redeemCodeAction } from "./redeem-actions";

/** Enter a test code: afterwards the account has no limits. Shown to the workspace owner only. */
export function RedeemCard({ unlimited: initial }: { unlimited: boolean }) {
  const t = useT().settings.redeem;
  const [unlimited, setUnlimited] = useState(initial);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await redeemCodeAction(code);
      if (!r.ok) {
        setMessage({ ok: false, text: r.error });
        return;
      }
      setMessage({ ok: true, text: r.text });
      setUnlimited(true);
      setCode("");
    });
  }

  return (
    <div className="gm-card">
      {unlimited ? (
        <p className="gm-ok">{message?.ok ? message.text : t.active}</p>
      ) : (
        <form onSubmit={apply} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="gm-hint" style={{ margin: 0 }}>{t.hint}</p>
          <div className="gm-field">
            <label htmlFor="redeem-code">{t.label}</label>
            <input
              id="redeem-code"
              className="gm-input gm-ltr"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="GT-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
            />
          </div>
          <div>
            <button type="submit" className="gm-btn" disabled={pending || code.trim().length < 8}>
              {pending ? t.applying : t.apply}
            </button>
          </div>
          {message && !message.ok && <p className="gm-err">{message.text}</p>}
        </form>
      )}
    </div>
  );
}
