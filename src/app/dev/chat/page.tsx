import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import { AssistantClient } from "@/app/app/assistant/assistant-client";

/** Dev only: the chat's look without signing in (its actions need a session, so nothing is sent from here). */
export default function DevChatPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={`gm ${gmFontVars}`} dir="rtl">
      <div className="gm-main">
        <h2 className="gm-title kufi">Assistant</h2>
        <AssistantClient
          workspaceId="dev"
          kind="shop"
          support={{ url: "https://example.com", display: "0770 000 0000" }}
          connections={{ facebook: true, instagram: true }}
          justConnected={false}
        />
      </div>
    </div>
  );
}
