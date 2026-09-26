"use client";

import { signOut } from "next-auth/react";

/** Shown when a shop's account opens the newsroom — one account, one kind. */
export function ShopNotice() {
  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
      <div className="gm-card" style={{ marginTop: 18 }}>
        <p style={{ margin: 0 }}>ئەم هەژمارە هەژماری دووکانێکە. بۆ نیوزڕووم، بە ئیمەیڵێکی تر خۆت تۆمار بکە.</p>
      </div>
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
