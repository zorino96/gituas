"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";
import { saveStoreSettingsAction } from "../automation/actions";
import { AutopilotSection } from "../automation/settings-sections";
import type { StoreSettings, StoreView } from "../automation/shared";

export function AutopilotClient({
  store,
  stores,
  paid,
  lastDraft,
  studio = false,
}: {
  store: StoreView;
  stores: { id: string; name: string }[];
  paid: boolean;
  lastDraft: { caption: string; thumb: string; at: string } | null;
  /** Whether this workspace has the Studio (it is switched off for now: src/lib/studio/ready.ts). */
  studio?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const ap = t.autopilotPage;
  const [settings, setSettings] = useState<StoreSettings>(() => ({ ...store }));

  async function save(patch: Partial<StoreSettings>) {
    const r = await saveStoreSettingsAction(store.id, patch);
    if (r.ok) setSettings((s) => ({ ...s, ...patch }));
    return r;
  }

  return (
    <div>
      <h2 className="gm-title kufi">{ap.title}</h2>
      <p className="gm-sub">{ap.sub}</p>
      {stores.length > 1 && (
        <select className="gm-input" aria-label={t.automation.pageAria} style={{ marginBottom: 12 }} value={store.id} onChange={(e) => router.push(`/app/autopilot?store=${encodeURIComponent(e.target.value)}`)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div className="gm-section">
        <AutopilotSection settings={settings} save={save} paid={paid} lastDraft={lastDraft} />
      </div>
      <p className="gm-hint">
        {ap.more}{" "}
        <Link href="/app/publish" className="gm-link">{ap.publish}</Link>
        {studio && (
          <>
            {" · "}
            <Link href="/app/studio" className="gm-link">{ap.studio}</Link>
          </>
        )}
      </p>
    </div>
  );
}
