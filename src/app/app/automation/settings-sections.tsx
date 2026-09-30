"use client";

import { useId, useState } from "react";

import type { ActionResult } from "./actions";
import { SaveMessage, SwitchRow, useSaver, type StoreSettings } from "./shared";

type Save = (patch: Partial<StoreSettings>) => Promise<ActionResult>;

/** Section "نامەی تایبەت و گەیاندن". */
export function DeliverySection({ settings, save }: { settings: StoreSettings; save: Save }) {
  const uid = useId();
  const { pending, message, run } = useSaver();
  const [defaultDm, setDefaultDm] = useState(settings.defaultDm);
  const [deliveryFee, setDeliveryFee] = useState(settings.deliveryFee);
  const [deliveryTime, setDeliveryTime] = useState(settings.deliveryTime);

  return (
    <>
      <p className="gm-sec">نامەی تایبەت و گەیاندن</p>
      <div className="gm-card gm-stack">
        <div className="gm-field">
          <label htmlFor={`${uid}-dm`}>نامەی تایبەت بۆ پۆستێک کە کارتی بەرهەمی نییە</label>
          <textarea id={`${uid}-dm`} className="gm-textarea" value={defaultDm} maxLength={1000} onChange={(e) => setDefaultDm(e.target.value)} />
        </div>
        <div className="gm-field">
          <label htmlFor={`${uid}-fee`}>کرێی گەیاندن (دینار، 0 = بەخۆڕایی)</label>
          <input id={`${uid}-fee`} className="gm-input gm-ltr" inputMode="numeric" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
        </div>
        <div className="gm-field">
          <label htmlFor={`${uid}-time`}>ماوەی گەیاندن (بۆ نموونە: ١-٢ ڕۆژ)</label>
          <input id={`${uid}-time`} className="gm-input" value={deliveryTime} maxLength={60} onChange={(e) => setDeliveryTime(e.target.value)} />
        </div>
        <div>
          <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => save({ defaultDm, deliveryFee, deliveryTime }))}>
            پاشەکەوت
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
  const { pending, message, run } = useSaver();
  const [likeComments, setLikeComments] = useState(settings.likeComments);
  const [autoHideSpam, setAutoHideSpam] = useState(settings.autoHideSpam);
  const [expiryDays, setExpiryDays] = useState(String(settings.expiryDays));
  const [stopBefore, setStopBefore] = useState(settings.stopBefore);

  return (
    <>
      <p className="gm-sec">کۆمێنت</p>
      <div className="gm-card">
        <SwitchRow label="لایکی کۆمێنت بکە" hint="تەنها فەیسبووک" checked={likeComments} disabled={pending} onToggle={() => setLikeComments((v) => !v)} />
        <SwitchRow label="سپام و جنێو بشارەوە" checked={autoHideSpam} disabled={pending} onToggle={() => setAutoHideSpam((v) => !v)} />
        <div className="gm-stack" style={{ marginTop: 10 }}>
          <div className="gm-field">
            <label htmlFor={`${uid}-days`}>پۆستەکان دوای چەند ڕۆژ بوەستن</label>
            <input id={`${uid}-days`} className="gm-input gm-ltr" type="number" inputMode="numeric" min={1} max={365} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
          </div>
          <div className="gm-field">
            <label htmlFor={`${uid}-stop`}>پۆستەکانی پێش ئەم ڕێکەوتە ئۆتۆمەیشنیان نەبێت</label>
            <input id={`${uid}-stop`} className="gm-input gm-ltr" type="date" value={stopBefore} onChange={(e) => setStopBefore(e.target.value)} />
          </div>
          <div>
            <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => save({ likeComments, autoHideSpam, expiryDays: Number(expiryDays), stopBefore }))}>
              پاشەکەوت
            </button>
            <SaveMessage message={message} />
          </div>
        </div>
      </div>
    </>
  );
}
