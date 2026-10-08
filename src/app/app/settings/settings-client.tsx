"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

import { normalizePhone } from "@/lib/merchant/phone";
import { useBase } from "../use-base";
import { disconnectYouTubeAction, saveWhatsAppAction } from "../actions";
import { useT } from "@/lib/i18n/client";
import { LanguageCard } from "./language-card";
import { PasswordCard } from "./password-card";
import { NewsSettings, type NewsSettingsProps } from "./news-settings";

interface Conn {
  provider: "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK" | "YOUTUBE";
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

export function SettingsClient({
  slug,
  whatsappNumber,
  connections,
  connected,
  connectError,
  account,
  news,
}: {
  account: { email: string | null; hasPassword: boolean };
  slug: string;
  whatsappNumber: string | null;
  connections: Conn[];
  connected?: string;
  connectError?: string;
  news: NewsSettingsProps | null;
}) {
  const base = useBase();
  const t = useT();
  const s = t.settings;
  // not_allowed is worded with the team roles, not with the connect errors.
  const connectErrors: Record<string, string> = { ...s.connectErrors, not_allowed: t.nr.team.roles.notAllowed };
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
        setMessage({ ok: true, text: r.digits ? s.saved : s.numberRemoved });
      } else setMessage({ ok: false, text: r.error });
    });
  }

  return (
    <div className="gm-narrow">
      <h2 className="gm-title kufi">{s.title}</h2>

      {connected && <p className="gm-ok">{s.connected}</p>}
      {connectError && <p className="gm-err">{connectErrors[connectError] ?? s.connectFailed}</p>}

      <LanguageCard />

      {news && <NewsSettings {...news} />}

      <div className="gm-card">
        <div className="gm-target">
          <p>
            <Link href={`${base}/billing`} className="gm-link">
              {s.billingLink}
            </Link>
          </p>
        </div>
      </div>

      <p className="gm-sec">{s.accountsSec}</p>
      <div className="gm-card">
        {connections.map((c) => (
          <div key={c.provider} className="gm-target">
            <div>
              <p>
                {c.label} {c.connected ? <span className="gm-badge">{s.connectedBadge}</span> : <span className="gm-badge ghost">{s.notConnectedBadge}</span>}
              </p>
              <small>{c.connected && c.name ? c.name : c.note}</small>
            </div>
            <div className="gm-row" style={{ gap: 6 }}>
              <a href={`/api/oauth/${c.provider.toLowerCase()}/start?next=${base}/settings`} className={`gm-btn small ${c.connected ? "quiet" : ""}`}>
                {c.connected ? s.reconnect : s.connect}
              </a>
              {c.connected && c.provider === "YOUTUBE" && (
                <button
                  type="button"
                  className="gm-btn small quiet"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(s.disconnectYtConfirm)) start(async () => void (await disconnectYouTubeAction()));
                  }}
                >
                  {s.disconnect}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="gm-hint">{s.igHint}</p>

      {base === "/app" && (
        <>
      <p className="gm-sec">{s.whatsappSec}</p>
      <div className="gm-card">
        <div className="gm-field">
          <label htmlFor="wa-number">{s.whatsappNumber}</label>
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
              {preview.ok ? `wa.me/${preview.digits}` : s.numberInvalid}
            </p>
          )}
        </div>
        <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="gm-btn" onClick={save} disabled={pending || (!!preview && !preview.ok)}>
            {pending ? s.saving : s.save}
          </button>
          {saved && (
            <a href={`https://wa.me/${saved}?text=${encodeURIComponent(s.testMsgText)}`} target="_blank" rel="noreferrer" className="gm-btn quiet">
              {s.testMsgBtn}
            </a>
          )}
        </div>
        {message && <p className={message.ok ? "gm-ok" : "gm-err"}>{message.text}</p>}
        {saved && (
          <p className="gm-hint">
            {s.handoffHint} <span className="gm-ltr" style={{ display: "inline-block" }}>{handoff}</span>
          </p>
        )}
      </div>
        </>
      )}

      {account.email && (
        <>
          <p className="gm-sec">{s.passwordSec}</p>
          <PasswordCard email={account.email} hasPassword={account.hasPassword} />
        </>
      )}

      <p className="gm-sec">{s.accountSec}</p>
      {account.email && (
        <p className="gm-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          {s.signedInAs} <bdi className="gm-ltr" dir="ltr">{account.email}</bdi>
        </p>
      )}
      <button type="button" className="gm-btn quiet" onClick={() => signOut({ callbackUrl: `/login?next=${base}` })}>
        {s.signOut}
      </button>
    </div>
  );
}
