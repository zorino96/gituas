"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { refreshNewsAction } from "./actions";

export function RefreshButton() {
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
            else setNote(r.failed.length ? `وەڵامی نەدایەوە: ${r.failed.join("، ")}` : null);
            router.refresh();
          })
        }
      >
        <RefreshCw size={14} aria-hidden="true" />
        {pending ? "نوێ دەکرێتەوە…" : "نوێکردنەوە"}
      </button>
      {note && <small className="gm-hint">{note}</small>}
    </div>
  );
}
