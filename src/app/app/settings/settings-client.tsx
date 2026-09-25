"use client";

import { useEffect, useState, useTransition } from "react";
import { signOut } from "next-auth/react";

import { normalizePhone } from "@/lib/merchant/phone";
import { saveWhatsAppAction } from "../actions";
import { PasswordCard } from "./password-card";

interface Conn {
  provider: "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK";
  label: string;
  note: string;
  connected: boolean;
  name?: string;
}

/** Iraqi numbers are shown back the way people read them: 0750 123 4567. */
function localForm(digits: string): string {
  if (/^9647\d{9}$/.test(digits)) {
    const d = "0" + digits.slice(3);
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  return "+" + digits;
}

const CONNECT_ERRORS: Record<string, string> = {
  access_denied: "پەیوەستکردن هەڵوەشێنرایەوە.",
  state_expired: "کاتەکەی بەسەرچوو — دووبارە هەوڵ بدەرەوە.",
  token_exchange_failed: "پلاتفۆرمەکە ڕێگەی نەدا — دووبارە هەوڵ بدەرەوە.",
  provider_mismatch: "ئەکاونتێکی هەڵە هەڵبژێردرا.",
};

export function SettingsClient({
  slug,
  whatsappNumber,
  connections,
  connected,
  connectError,
  account,
}: {
  account: { email: string | null; hasPassword: boolean };
  slug: string;
  whatsappNumber: string | null;
  connections: Conn[];
  connected?: string;
  connectError?: string;
}) {
  const [raw, setRaw] = useState(whatsappNumber ? localForm(whatsappNumber) : "");
  const [saved, setSaved] = useState<string | null>(whatsappNumber);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const preview = raw.trim() ? normalizePhone(raw) : null;
  const handoff = origin ? `${origin}/w/${slug}` : `/w/${slug}`;

  function save() {
    setMessage(null);
    start(async () => {
      const r = await saveWhatsAppAction(raw);
      if (r.ok) {
        setSaved(r.digits);
        setMessage({ ok: true, text: r.digits ? "پاشەکەوت کرا." : "ژمارەکە لابرا." });
      } else setMessage({ ok: false, text: r.error });
    });
  }

  return (
    <div>
      <h2 className="gm-title kufi">ڕێکخستن</h2>

      {connected && <p className="gm-ok">پەیوەست کرا.</p>}
      {connectError && <p className="gm-err">{CONNECT_ERRORS[connectError] ?? "پەیوەستکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە."}</p>}

      <p className="gm-sec">ئەکاونتەکان</p>
      <div className="gm-card">
        {connections.map((c) => (
          <div key={c.provider} className="gm-target">
            <div>
              <p>
                {c.label} {c.connected ? <span className="gm-badge">پەیوەستە</span> : <span className="gm-badge ghost">پەیوەست نییە</span>}
              </p>
              <small>{c.connected && c.name ? c.name : c.note}</small>
            </div>
            <a href={`/api/oauth/${c.provider.toLowerCase()}/start?next=/app/settings`} className={`gm-btn small ${c.connected ? "quiet" : ""}`}>
              {c.connected ? "دووبارە پەیوەست بکەوە" : "پەیوەست بکە"}
            </a>
          </div>
        ))}
      </div>
      <p className="gm-hint">
        بۆ ئینستاگرام، لە ئەپی ئینستاگرام «Allow access to messages» هەڵبکە (Settings ← Messages and story replies ← Message controls ←
        Connected tools)، ئەگەرنا نامەکان نایەن.
      </p>

      <p className="gm-sec">وەتسئەپ</p>
      <div className="gm-card">
        <div className="gm-field">
          <label htmlFor="wa-number">ژمارەی وەتسئەپی دووکان</label>
          <input
            id="wa-number"
            className="gm-input gm-ltr"
            inputMode="tel"
            dir="ltr"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setMessage(null);
            }}
            placeholder="0750 123 4567"
          />
          {preview && (
            <p className={`gm-hint gm-ltr ${preview.ok ? "" : "gm-err"}`}>
              {preview.ok ? `wa.me/${preview.digits}` : "ژمارەکە دروست نییە"}
            </p>
          )}
        </div>
        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="gm-btn" onClick={save} disabled={pending || (!!preview && !preview.ok)}>
            {pending ? "پاشەکەوت دەکرێت…" : "پاشەکەوت"}
          </button>
          {saved && (
            <a href={`https://wa.me/${saved}?text=${encodeURIComponent("تاقیکردنەوەی گیتواس")}`} target="_blank" rel="noreferrer" className="gm-btn quiet">
              نامەیەک بۆ خۆت بنێرە
            </a>
          )}
        </div>
        {message && <p className={message.ok ? "gm-ok" : "gm-err"}>{message.text}</p>}
        {saved && (
          <p className="gm-hint">
            ئەو لینکەی بۆ کڕیاران دەنێردرێت و دەژمێردرێت: <span className="gm-ltr" style={{ display: "inline-block" }}>{handoff}</span>
          </p>
        )}
      </div>

      {account.email && (
        <>
          <p className="gm-sec">وشەی نهێنی</p>
          <PasswordCard email={account.email} hasPassword={account.hasPassword} />
        </>
      )}

      <p className="gm-sec">هەژمار</p>
      {account.email && (
        <p className="gm-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          چوویتە ژوورەوە وەک <bdi className="gm-ltr" dir="ltr">{account.email}</bdi>
        </p>
      )}
      <button type="button" className="gm-btn quiet" onClick={() => signOut({ callbackUrl: "/login?next=/app" })}>
        چوونەدەرەوە
      </button>
    </div>
  );
}
