"use client";

import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";

import { switchWorkspaceAction } from "./desk-actions";

export type DeskOption = { id: string; name: string; role: string };

/** The desk name in the top bar opens a list of the person's desks and "new desk". */
export function DeskSwitcher({ currentId, currentName, desks }: { currentId: string; currentName: string; desks: DeskOption[] }) {
  return (
    <details className="nr-switch">
      <summary className="nr-desk" aria-label={`مێز: ${currentName} — گۆڕین`}>
        <h1 className="kufi">{currentName}</h1>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="nr-switch-menu">
        {desks.map((d) => (
          <form key={d.id} action={switchWorkspaceAction}>
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="next" value="/newsroom/news" />
            <button type="submit" className="nr-link" aria-current={d.id === currentId ? "true" : undefined}>
              {d.id === currentId ? <Check aria-hidden="true" /> : <span style={{ width: 18, flex: "none" }} aria-hidden="true" />}
              <span>{d.name}</span>
              <small className="nr-switch-role">{d.role}</small>
            </button>
          </form>
        ))}
        <Link href="/newsroom/desks/new" className="nr-link">
          <Plus aria-hidden="true" />
          مێزی نوێ
        </Link>
      </div>
    </details>
  );
}
