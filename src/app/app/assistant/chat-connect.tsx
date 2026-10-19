"use client";

// A new chat in a shop with no Facebook Page or Instagram account connected: the two buttons to connect them (after the
// person says they own those accounts), and the "connected" note when they come back from the platform. Connecting is also
// in Settings; this is the shortcut the older assistant screen had.

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n/client";

export function ConnectCard({ connections, justConnected }: { connections: { facebook: boolean; instagram: boolean }; justConnected: boolean }) {
  const all = useT();
  const t = all.assistant.connect;
  const [ack, setAck] = useState(false);
  const [needAck, setNeedAck] = useState(false);
  useEffect(() => {
    try {
      setAck(window.localStorage.getItem("gm_authority_ack") === "1");
    } catch {
      /* the box starts empty */
    }
  }, []);

  const missing = [
    ...(connections.facebook ? [] : [{ provider: "meta_facebook", label: t.facebook }]),
    ...(connections.instagram ? [] : [{ provider: "meta_instagram", label: t.instagram }]),
  ];

  return (
    <>
      {justConnected && (
        <p className="ch-ok" role="status">
          {t.connected}
        </p>
      )}
      {missing.length > 0 && (
        <div className="ch-connect">
          <b>{t.title}</b>
          <p>{t.help}</p>
          <label className="ch-ack">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => {
                setAck(e.target.checked);
                if (e.target.checked) setNeedAck(false);
                try {
                  window.localStorage.setItem("gm_authority_ack", e.target.checked ? "1" : "0");
                } catch {
                  /* not remembered */
                }
              }}
            />
            <small>{all.settings.authorityAck}</small>
          </label>
          {needAck && !ack && (
            <p className="ch-err" role="alert">
              {all.settings.authorityNeeded}
            </p>
          )}
          <div className="ch-connect-buttons">
            {missing.map((m) => (
              <a
                key={m.provider}
                className="gm-btn small"
                href={`/api/oauth/${m.provider}/start?next=/app/assistant&ack=1`}
                onClick={(e) => {
                  if (!ack) {
                    e.preventDefault();
                    setNeedAck(true);
                  }
                }}
              >
                {m.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
