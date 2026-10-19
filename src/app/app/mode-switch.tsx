"use client";

// The two faces of the app: the classic screens, and the chat. The choice is remembered in a cookie so the app opens
// on the face the person last used (face.ts). "Classic" goes to Today with ?ui=classic, which always leaves the chat.

import { usePathname, useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";
import { CLASSIC_HOME, rememberFace } from "./face";

export function ModeSwitch() {
  const t = useT().assistant.mode;
  const path = usePathname();
  const router = useRouter();
  const chat = path.startsWith("/app/assistant");
  const go = (to: "classic" | "chat") => {
    rememberFace(to);
    router.push(to === "chat" ? "/app/assistant" : CLASSIC_HOME);
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
