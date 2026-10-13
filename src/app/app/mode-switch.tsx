"use client";

// The two faces of the app: the classic screens, and the chat. The choice is remembered in a cookie so the app opens
// on the face the person last used.

import { usePathname, useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";

export function ModeSwitch() {
  const t = useT().assistant.mode;
  const path = usePathname();
  const router = useRouter();
  const chat = path.startsWith("/app/assistant");
  const go = (to: "classic" | "chat") => {
    try {
      document.cookie = `gm_ui=${to}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked: the switch still works for this visit */
    }
    router.push(to === "chat" ? "/app/assistant" : "/app");
  };
  return (
    <div className="gm-seg" role="group" aria-label={t.label}>
      <button type="button" aria-pressed={!chat} onClick={() => go("classic")}>
        {t.classic}
      </button>
      <button type="button" aria-pressed={chat} onClick={() => go("chat")}>
        {t.chat}
      </button>
    </div>
  );
}
