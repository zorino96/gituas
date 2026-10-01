"use client";

import { useActionState, useState } from "react";
import { signOut } from "next-auth/react";

import { createDeskAction, switchWorkspaceAction, type DeskResult } from "./desk-actions";

/** Opens a separate newsroom for the signed-in person; createDeskAction starts its own 14-day trial. */
function NewRoomForm() {
  const [state, action, pending] = useActionState<DeskResult | null, FormData>(createDeskAction, null);
  return (
    <form action={action} className="gm-stack" style={{ marginTop: 12 }}>
      <div className="gm-field">
        <label htmlFor="room-name">ناوی کەناڵ یان پەیج</label>
        <input id="room-name" name="name" className="gm-input" required maxLength={60} />
      </div>
      <button type="submit" className="gm-btn block" disabled={pending}>
        {pending ? "دروست دەکرێت…" : "ژووری هەواڵەکەم دروست بکە"}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}

/** Shown when the workspace being worked in is a shop. Offers the person's desks if they have any, or a newsroom of their own. */
export function ShopNotice({ desks = [] }: { desks?: { id: string; name: string }[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
      <div className="gm-card" style={{ marginTop: 18 }}>
        <p style={{ margin: 0 }}>
          {desks.length
            ? "ئێستا لە دووکانەکەتیت. مێزێکی هەواڵ هەڵبژێرە:"
            : "ئەم هەژمارە دووکانێکی هەیە. دەتوانیت بە هەمان هەژمار ژووری هەواڵێکی جیاش دروست بکەیت — پلان و پارەدانی جیای دەبێت و ١٤ ڕۆژ بەخۆڕاییە."}
        </p>
        {desks.length === 0 && <NewRoomForm />}
      </div>
      {desks.map((d) => (
        <form key={d.id} action={switchWorkspaceAction}>
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="next" value="/newsroom/news" />
          <button type="submit" className="gm-btn block" style={{ marginTop: 10 }}>
            بچۆ «{d.name}»
          </button>
        </form>
      ))}
      {desks.length > 0 &&
        (creating ? (
          <div className="gm-card" style={{ marginTop: 12 }}>
            <NewRoomForm />
          </div>
        ) : (
          <button type="button" className="gm-btn quiet block" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
            ژووری هەواڵی نوێ
          </button>
        ))}
      <button
        type="button"
        className="gm-btn quiet block"
        style={{ marginTop: 12 }}
        onClick={() => signOut({ callbackUrl: "/login?next=/newsroom/news" })}
      >
        چوونەدەرەوە
      </button>
    </div>
  );
}
