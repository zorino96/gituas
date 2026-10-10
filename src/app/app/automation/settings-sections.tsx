"use client";

import { useId, useState } from "react";

import { useLang, useT } from "@/lib/i18n/client";
import { CITIES } from "@/lib/orders/cities";

import type { ActionResult } from "./actions";
import { SaveMessage, SwitchRow, useSaver, type StoreSettings } from "./shared";

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
