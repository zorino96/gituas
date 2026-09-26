"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Newspaper, Store } from "lucide-react";

import { setTenantKindAction } from "./actions";

/** Asked once after sign-in; changeable later in Settings. */
export function KindChooser() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(kind: "MERCHANT" | "NEWS") {
    setError(null);
    start(async () => {
      const r = await setTenantKindAction(kind);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace(kind === "NEWS" ? "/app/news" : "/app");
      router.refresh();
    });
  }

  return (
    <div className="gm-stack">
      <h2 className="gm-title kufi">بەخێربێیت</h2>
      <p className="gm-sub">گیتواس بۆ چی بەکار دەهێنیت؟ دواتر لە ڕێکخستن دەتوانیت بیگۆڕیت.</p>
      <button type="button" className="gm-card gm-row" style={{ textAlign: "start", cursor: "pointer" }} disabled={pending} onClick={() => choose("MERCHANT")}>
        <Store aria-hidden="true" />
        <span>
          <b>دووکان</b>
          <br />
          <small className="gm-sub">وەڵامی کۆمێنت و نامەی کڕیاران، بڵاوکردنەوە و ئامار.</small>
        </span>
      </button>
      <button type="button" className="gm-card gm-row" style={{ textAlign: "start", cursor: "pointer" }} disabled={pending} onClick={() => choose("NEWS")}>
        <Newspaper aria-hidden="true" />
        <span>
          <b>پەیجی هەواڵ</b>
          <br />
          <small className="gm-sub">هەواڵ لە سەرچاوەکانەوە، کورتەی کوردی، کارتی براندی خۆت، بڵاوکردنەوە.</small>
        </span>
      </button>
      {error && <p className="gm-err">{error}</p>}
    </div>
  );
}
