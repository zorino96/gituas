"use client";

import { useActionState } from "react";

import { createDeskAction, type DeskResult } from "../../../desk-actions";

export function NewDeskForm() {
  const [state, action, pending] = useActionState<DeskResult | null, FormData>(createDeskAction, null);
  return (
    <form action={action} className="gm-card gm-stack">
      <div className="gm-field">
        <label htmlFor="desk-name">ناوی مێز</label>
        <input id="desk-name" name="name" className="gm-input" required maxLength={60} placeholder="بۆ نموونە: بەشی عەرەبی" />
      </div>
      <button type="submit" className="gm-btn" disabled={pending}>
        {pending ? "دروست دەکرێت…" : "مێزەکە دروست بکە"}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}
