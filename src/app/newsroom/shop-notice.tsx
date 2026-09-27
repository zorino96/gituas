"use client";

import { signOut } from "next-auth/react";

import { switchWorkspaceAction } from "./desk-actions";

/** Shown when the workspace being worked in is a shop. Offers the person's desks if they have any. */
export function ShopNotice({ desks = [] }: { desks?: { id: string; name: string }[] }) {
  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
      <div className="gm-card" style={{ marginTop: 18 }}>
        <p style={{ margin: 0 }}>
          {desks.length
            ? "ئێستا لە دووکانەکەتیت. مێزێکی هەواڵ هەڵبژێرە:"
            : "ئەم هەژمارە هەژماری دووکانێکە. بۆ نیوزڕووم، بە ئیمەیڵێکی تر خۆت تۆمار بکە."}
        </p>
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
