"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";

import type { MConversation, Platform } from "@/lib/merchant/types";
import { useT } from "@/lib/i18n/client";
import { useBase } from "../use-base";
import { sendMessageAction } from "../actions";
import { ReplyComposer } from "../reply-composer";
import { ago, friendlyError, num } from "../format";

export function MessagesClient({
  initial,
  unreadable,
  errors,
  whatsappPath,
  connected,
  accounts,
  orderBuyers,
}: {
  initial: MConversation[];
  /** Shop only: participant ids with an open order, shown under the Orders tab. */
  orderBuyers?: string[];
  unreadable: number;
  errors: { platform: Platform; message: string }[];
  whatsappPath: string | null;
  connected: Record<Platform, boolean>;
  /** The Page / Instagram account shown, so messages go out as that account. */
  accounts?: Partial<Record<Platform, string | undefined>>;
}) {
  const router = useRouter();
  const base = useBase();
  const t = useT();
  const isNews = base === "/newsroom";
  const who = isNews ? t.messages.viewer : t.messages.customer;
  const [convs, setConvs] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [waUrl, setWaUrl] = useState<string | null>(null);

  useEffect(() => setConvs(initial), [initial]);
  useEffect(() => setWaUrl(whatsappPath ? `${window.location.origin}${whatsappPath}` : null), [whatsappPath]);

  const open = convs.find((c) => c.id === openId) ?? null;
  const [tab, setTab] = useState<"all" | "orders" | "needs">("all");
  const isOrder = (c: MConversation) => !!c.participantId && !!orderBuyers?.includes(c.participantId);
  const isWaiting = (c: MConversation) => c.withinWindow && c.messages.length > 0 && !c.messages[c.messages.length - 1].fromUs;
  const waiting = convs.filter(isWaiting).length;
  const shown = tab === "orders" ? convs.filter(isOrder) : tab === "needs" ? convs.filter(isWaiting) : convs;

  if (open) {
    const last = [...open.messages].reverse().find((m) => !m.fromUs);
    return (
      <div>
        <div className="gm-row" style={{ marginBottom: 12 }}>
          <button type="button" className="gm-btn quiet small" onClick={() => setOpenId(null)} aria-label={t.messages.back}>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <div>
            <div className="gm-who" dir="auto">{open.participantName || who}</div>
            <span className={`gm-plat ${open.platform}`}>{t.platform[open.platform]}</span>
          </div>
        </div>

        <div className="gm-card">
          {open.messages.length === 0 && <p className="gm-sub">{t.messages.noMessages}</p>}
          {open.messages.map((m) => (
            <div key={m.id} className={`gm-bubble ${m.fromUs ? "us" : "them"}`} dir="auto">
              {m.text || t.common.mediaOrFile}
              <div className="gm-time" style={{ marginTop: 3 }}>{ago(m.createdAt, t)}</div>
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
              const r = await sendMessageAction(open.platform, open.participantId!, text, accounts?.[open.platform]);
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
            {t.messages.windowClosed(who)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="gm-between">
        <div>
          <h2 className="gm-title kufi">{t.messages.title}</h2>
          <p className="gm-sub">{t.messages.sub(waiting)}</p>
        </div>
        <button type="button" className="gm-btn quiet small" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}>
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "…" : t.common.refresh}
        </button>
      </div>

      {(!connected.FB || !connected.IG) && (
        <p className="gm-note" style={{ marginBottom: 12 }}>
          {!connected.FB && !connected.IG ? t.common.noneConnected : t.common.notConnected(!connected.FB ? t.messages.messenger : t.platform.IG)}{" "}
          <Link href={`${base}/settings`} className="gm-link">{t.common.connectIt}</Link>
        </p>
      )}
      {errors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 12 }}>
          {t.platform[e.platform]}: {friendlyError(e.message, t)}
        </p>
      ))}

      {unreadable > 0 && (
        <p className="gm-hint" style={{ marginBottom: 10 }}>
          {t.messages.unreadable(unreadable)}
        </p>
      )}
      {orderBuyers && convs.length > 0 && (
        <div className="gm-chips" role="group" aria-label={t.messages.title} style={{ marginBottom: 14 }}>
          {(["all", "orders", "needs"] as const).map((k) => (
            <button key={k} type="button" className="gm-chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {t.messages.tabs[k]} ({num(k === "orders" ? convs.filter(isOrder).length : k === "needs" ? waiting : convs.length)})
            </button>
          ))}
        </div>
      )}
      {convs.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">{t.messages.emptyTitle}</b>
          {isNews ? t.messages.emptyNews : t.messages.emptyShop}
        </div>
      ) : (
        <div className="gm-stack">
          {shown.map((c) => {
            const last = c.messages[c.messages.length - 1];
            const needsYou = c.withinWindow && !!last && !last.fromUs;
            return (
              <button key={`${c.platform}-${c.id}`} type="button" className="gm-card gm-conv" onClick={() => setOpenId(c.id)}>
                <div className="gm-between">
                  <span className="gm-who" dir="auto">{c.participantName || who}</span>
                  <span className="gm-time">{ago(c.updatedAt, t)}</span>
                </div>
                <p className="gm-text" dir="auto" style={{ color: "var(--muted)", margin: "4px 0 8px" }}>
                  {last ? `${last.fromUs ? t.messages.youPrefix : ""}${last.text || t.common.mediaOrFile}` : "—"}
                </p>
                <div className="gm-row" style={{ gap: 6 }}>
                  <span className={`gm-plat ${c.platform}`}>{t.platform[c.platform]}</span>
                  {isOrder(c) && <span className="gm-badge">{t.messages.orderBadge}</span>}
                  {needsYou && <span className="gm-badge warn">{t.messages.needsYou}</span>}
                  {!c.withinWindow && <span className="gm-badge ghost">{t.messages.outsideWindow}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
