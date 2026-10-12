"use client";

import { useId, useState } from "react";

import { useLang, useT } from "@/lib/i18n/client";
import { CITIES } from "@/lib/orders/cities";

import type { ActionResult } from "./actions";
import { SaveMessage, SwitchRow, useSaver, type StoreSettings, type Usage } from "./shared";

type Save = (patch: Partial<StoreSettings>) => Promise<ActionResult>;

/** Section "نامەی تایبەت و گەیاندن". */
export function DeliverySection({ settings, save }: { settings: StoreSettings; save: Save }) {
  const uid = useId();
  const a = useT().automation;
  const { pending, message, run } = useSaver();
  const [defaultDm, setDefaultDm] = useState(settings.defaultDm);
  const [deliveryFee, setDeliveryFee] = useState(settings.deliveryFee);
  const [deliveryTime, setDeliveryTime] = useState(settings.deliveryTime);
  const [cityFees, setCityFees] = useState(settings.cityFees);
  const lang = useLang();

  return (
    <>
      <p className="gm-sec">{a.deliverySec}</p>
      <div className="gm-card gm-stack">
        <div className="gm-field">
          <label htmlFor={`${uid}-dm`}>{a.defaultDm}</label>
          <textarea id={`${uid}-dm`} className="gm-textarea" value={defaultDm} maxLength={1000} onChange={(e) => setDefaultDm(e.target.value)} />
        </div>
        <div className="gm-field">
          <label htmlFor={`${uid}-fee`}>{a.deliveryFee}</label>
          <input id={`${uid}-fee`} className="gm-input gm-ltr" inputMode="numeric" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
        </div>
        <details open={Object.keys(cityFees).length > 0}>
          <summary>{a.cityFees}</summary>
          <small>{a.cityFeesHint}</small>
          <div className="gm-stack" style={{ marginTop: 8 }}>
            {CITIES.map((c) => (
              <div className="gm-field" key={c.code}>
                <label htmlFor={`${uid}-city-${c.code}`}>{c[lang]}</label>
                <input
                  id={`${uid}-city-${c.code}`}
                  className="gm-input gm-ltr"
                  inputMode="numeric"
                  value={cityFees[c.code] ?? ""}
                  onChange={(e) => setCityFees((f) => ({ ...f, [c.code]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>
        <div className="gm-field">
          <label htmlFor={`${uid}-time`}>{a.deliveryTime}</label>
          <input id={`${uid}-time`} className="gm-input" value={deliveryTime} maxLength={60} onChange={(e) => setDeliveryTime(e.target.value)} />
        </div>
        <div>
          <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => save({ defaultDm, deliveryFee, deliveryTime, cityFees }))}>
            {a.save}
          </button>
          <SaveMessage message={message} />
        </div>
      </div>
    </>
  );
}

/** Section "Autopilot": off / prepare only / post to FB+IG, posts per day, and the last prepared post. */
export function AutopilotSection({ settings, save, paid, lastDraft }: { settings: StoreSettings; save: Save; paid: boolean; lastDraft: { caption: string; thumb: string; at: string } | null }) {
  const uid = useId();
  const a = useT().automation;
  const { pending, message, run } = useSaver();
  const [mode, setMode] = useState(settings.autoMode);
  const [perDay, setPerDay] = useState(settings.autoPerDay);
  return (
    <>
      <p className="gm-sec">{a.autoSec}</p>
      <div className="gm-card">
        <p className="gm-hint">{a.autoHint}</p>
        <div className="gm-chips" role="radiogroup" aria-label={a.autoSec}>
          {(["OFF", "DRAFT", "PUBLISH"] as const).map((m) => (
            <button key={m} type="button" role="radio" className="gm-chip" aria-checked={mode === m} aria-pressed={mode === m} disabled={pending} onClick={() => setMode(m)}>
              {a.autoModes[m]}
            </button>
          ))}
        </div>
        {mode === "PUBLISH" && !paid && <p className="gm-note warn">{a.autoPaidOnly}</p>}
        <div className="gm-field" style={{ marginTop: 10 }}>
          <label htmlFor={`${uid}-n`}>{a.autoPerDay}</label>
          <select id={`${uid}-n`} className="gm-input" value={perDay} disabled={pending} onChange={(e) => setPerDay(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="button" className="gm-btn" style={{ marginTop: 10 }} disabled={pending} onClick={() => run(() => save({ autoMode: mode, autoPerDay: perDay }))}>
          {a.save}
        </button>
        <SaveMessage message={message} />
        {lastDraft && (
          <div className="gm-post" style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lastDraft.thumb} alt="" className="gm-thumb" loading="lazy" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <small className="gm-time">{a.autoLast} · <span className="gm-ltr">{lastDraft.at.slice(0, 10)}</span></small>
              <p style={{ whiteSpace: "pre-line" }}>{Array.from(lastDraft.caption).slice(0, 140).join("")}</p>
              <a href="/app/publish?auto=1" className="gm-link">{a.autoOpen}</a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Section "کۆمێنت". */
export function CommentsSection({ settings, save }: { settings: StoreSettings; save: Save }) {
  const uid = useId();
  const a = useT().automation;
  const { pending, message, run } = useSaver();
  const [likeComments, setLikeComments] = useState(settings.likeComments);
  const [autoHideSpam, setAutoHideSpam] = useState(settings.autoHideSpam);
  const [expiryDays, setExpiryDays] = useState(String(settings.expiryDays));
  const [stopBefore, setStopBefore] = useState(settings.stopBefore);

  return (
    <>
      <p className="gm-sec">{a.commentsSec}</p>
      <div className="gm-card">
        <SwitchRow label={a.likeComments} hint={a.likeHint} checked={likeComments} disabled={pending} onToggle={() => setLikeComments((v) => !v)} />
        <SwitchRow label={a.hideSpam} checked={autoHideSpam} disabled={pending} onToggle={() => setAutoHideSpam((v) => !v)} />
        <div className="gm-stack" style={{ marginTop: 10 }}>
          <div className="gm-field">
            <label htmlFor={`${uid}-days`}>{a.expiryDays}</label>
            <input id={`${uid}-days`} className="gm-input gm-ltr" type="number" inputMode="numeric" min={1} max={365} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
          </div>
          <div className="gm-field">
            <label htmlFor={`${uid}-stop`}>{a.stopBefore}</label>
            <input id={`${uid}-stop`} className="gm-input gm-ltr" type="date" value={stopBefore} onChange={(e) => setStopBefore(e.target.value)} />
          </div>
          <div>
            <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => save({ likeComments, autoHideSpam, expiryDays: Number(expiryDays), stopBefore }))}>
              {a.save}
            </button>
            <SaveMessage message={message} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Smart replies: the assistant writes the first message and the answers in the owner's own words, within guards that live on the server. */
export function SmartRepliesSection({ settings, save, usage }: { settings: StoreSettings; save: Save; usage: Usage }) {
  const uid = useId();
  const a = useT().automation;
  const { pending, message, run } = useSaver();
  const [on, setOn] = useState(settings.aiReplies);
  const [brief, setBrief] = useState(settings.aiBrief);

  return (
    <>
      <p className="gm-sec">{a.smartSec}</p>
      <div className="gm-card gm-stack">
        <SwitchRow label={a.smartSwitch} hint={a.smartHint} checked={on} disabled={pending} onToggle={() => setOn((v) => !v)} />
        <div className="gm-field">
          <label htmlFor={`${uid}-brief`}>{a.smartBrief}</label>
          {/* 1500 is the server's limit (src/lib/shop/smart.ts SMART_BRIEF_MAX); that file is server-only. */}
          <textarea
            id={`${uid}-brief`}
            className="gm-textarea"
            style={{ minHeight: 190 }}
            value={brief}
            maxLength={1500}
            placeholder={a.smartPlaceholder}
            onChange={(e) => setBrief(e.target.value)}
          />
          <p className="gm-hint">{a.smartBriefHint}</p>
        </div>
        <div>
          <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => save({ aiReplies: on, aiBrief: brief }))}>
            {a.save}
          </button>
          <SaveMessage message={message} />
        </div>
        <p className="gm-hint">{a.smartUsage(usage.smartUsed, usage.smartLimit)}</p>
      </div>
    </>
  );
}
