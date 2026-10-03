"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { refreshNewsAction } from "./actions";

export function RefreshButton() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="gm-btn quiet small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshNewsAction();
            if (!r.ok) setNote(r.error);
            else setNote(r.failed.length ? t.nr.news.list.noAnswer(r.failed.join("، ")) : null);
            router.refresh();
          })
        }
      >
        <RefreshCw size={14} aria-hidden="true" />
        {pending ? t.nr.news.list.refreshing : t.common.refreshLabel}
      </button>
      {note && <small className="gm-hint">{note}</small>}
    </div>
  );
}
