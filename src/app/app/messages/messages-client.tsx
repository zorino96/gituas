"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";

import type { MConversation, Platform } from "@/lib/merchant/types";
import { sendMessageAction } from "../actions";
import { ReplyComposer } from "../reply-composer";
import { PLATFORM_NAME, ago, friendlyError, num } from "../format";

export function MessagesClient({
  initial,
  unreadable,
  errors,
  whatsappPath,
  connected,
}: {
  initial: MConversation[];
  unreadable: number;
  errors: { platform: Platform; message: string }[];
  whatsappPath: string | null;
  connected: Record<Platform, boolean>;
}) {
  const router = useRouter();
  const [convs, setConvs] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [waUrl, setWaUrl] = useState<string | null>(null);

  useEffect(() => setConvs(initial), [initial]);
  useEffect(() => setWaUrl(whatsappPath ? `${window.location.origin}${whatsappPath}` : null), [whatsappPath]);

  const open = convs.find((c) => c.id === openId) ?? null;
  const waiting = convs.filter((c) => c.withinWindow && c.messages.length > 0 && !c.messages[c.messages.length - 1].fromUs).length;

  if (open) {
    const last = [...open.messages].reverse().find((m) => !m.fromUs);
    return (
      <div>
        <div className="gm-row" style={{ marginBottom: 12 }}>
          <button type="button" className="gm-btn quiet small" onClick={() => setOpenId(null)} aria-label="گەڕانەوە">
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <div>
            <div className="gm-who" dir="auto">{open.participantName || "کڕیار"}</div>
            <span className={`gm-plat ${open.platform}`}>{PLATFORM_NAME[open.platform]}</span>
          </div>
        </div>

        <div className="gm-card">
          {open.messages.length === 0 && <p className="gm-sub">هیچ نامەیەک نییە.</p>}
          {open.messages.map((m) => (
            <div key={m.id} className={`gm-bubble ${m.fromUs ? "us" : "them"}`} dir="auto">
              {m.text || "(وێنە یان فایل)"}
              <div className="gm-time" style={{ marginTop: 3 }}>{ago(m.createdAt)}</div>
            </div>
          ))}
        </div>

        {open.withinWindow && open.participantId ? (
          <ReplyComposer
            incoming={last?.text ?? ""}
            kind="dm"
            waUrl={waUrl}
            maxLength={1000}
            autoFocus={false}
            onSend={async (text) => {
              const r = await sendMessageAction(open.platform, open.participantId!, text);
              if (r.ok) {
                setConvs((prev) =>
                  prev.map((c) =>
                    c.id !== open.id
                      ? c
                      : { ...c, messages: [...c.messages, { id: `local-${Date.now()}`, text: text.trim(), fromUs: true, createdAt: new Date().toISOString() }] },
                  ),
                );
              }
              return r;
            }}
          />
        ) : (
          <p className="gm-note" style={{ marginTop: 10 }}>
            مێتا تەنیا لە ماوەی ٢٤ کاتژمێر دوای دوایین نامەی کڕیار ڕێگە بە وەڵامدانەوە دەدات. ئەم گفتوگۆیە لەو ماوەیە دەرچووە.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="gm-between">
        <div>
          <h2 className="gm-title kufi">نامەکان</h2>
          <p className="gm-sub">{num(waiting)} گفتوگۆ چاوەڕێی وەڵامی تۆن</p>
        </div>
        <button type="button" className="gm-btn quiet small" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}>
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "…" : "نوێ"}
        </button>
      </div>

      {(!connected.FB || !connected.IG) && (
        <p className="gm-note" style={{ marginBottom: 12 }}>
          {!connected.FB && !connected.IG ? "هیچ پەیجێک پەیوەست نەکراوە." : `${!connected.FB ? "مەسنجەر" : "ئینستاگرام"} پەیوەست نەکراوە.`}{" "}
          <Link href="/app/settings" className="gm-link">پەیوەستی بکە</Link>
        </p>
      )}
      {errors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 12 }}>
          {PLATFORM_NAME[e.platform]}: {friendlyError(e.message)}
        </p>
      ))}

      {unreadable > 0 && (
        <p className="gm-hint" style={{ marginBottom: 10 }}>
          {num(unreadable)} گفتوگۆی کۆن هەیە کە ئینستاگرام ڕێگە نادات لێرەوە بخوێنرێنەوە — لە ئەپی ئینستاگرام دەبینرێن.
        </p>
      )}
      {convs.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">هیچ نامەیەک نییە</b>
          کاتێک کڕیارێک نامە دەنێرێت، لێرە دەردەکەوێت.
        </div>
      ) : (
        <div className="gm-stack">
          {convs.map((c) => {
            const last = c.messages[c.messages.length - 1];
            const needsYou = c.withinWindow && !!last && !last.fromUs;
            return (
              <button key={`${c.platform}-${c.id}`} type="button" className="gm-card gm-conv" onClick={() => setOpenId(c.id)}>
                <div className="gm-between">
                  <span className="gm-who" dir="auto">{c.participantName || "کڕیار"}</span>
                  <span className="gm-time">{ago(c.updatedAt)}</span>
                </div>
                <p className="gm-text" dir="auto" style={{ color: "var(--muted)", margin: "4px 0 8px" }}>
                  {last ? `${last.fromUs ? "تۆ: " : ""}${last.text || "(وێنە یان فایل)"}` : "—"}
                </p>
                <div className="gm-row" style={{ gap: 6 }}>
                  <span className={`gm-plat ${c.platform}`}>{PLATFORM_NAME[c.platform]}</span>
                  {needsYou && <span className="gm-badge warn">چاوەڕێی تۆیە</span>}
                  {!c.withinWindow && <span className="gm-badge ghost">دەرەوەی ٢٤ کاتژمێر</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
