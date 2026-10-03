"use client";

import { useActionState } from "react";

import { useT } from "@/lib/i18n/client";
import { createDeskAction, type DeskResult } from "../../../desk-actions";

export function NewDeskForm() {
  const [state, action, pending] = useActionState<DeskResult | null, FormData>(createDeskAction, null);
  const t = useT().nr.shell.newDesk;
  return (
    <form action={action} className="gm-card gm-stack">
      <div className="gm-field">
        <label htmlFor="desk-name">{t.nameLabel}</label>
        <input id="desk-name" name="name" className="gm-input" required maxLength={60} placeholder={t.namePlaceholder} />
      </div>
      <button type="submit" className="gm-btn" disabled={pending}>
        {pending ? t.creating : t.create}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}
