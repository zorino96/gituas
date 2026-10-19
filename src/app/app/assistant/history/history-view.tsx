// The list of earlier chats as a page of its own (the menu's "Chat history"): every chat of the person in this workspace, pinned first,
// then by day, each a link that opens it. The chat frame's sidebar shows the same list; this page is for the people who look for it in
// the menu, and for a phone, where the sidebar is a drawer. A plain server component: links only, nothing to hydrate.

import Link from "next/link";
import { Pin } from "lucide-react";

import type { Dict } from "@/lib/i18n";
import type { ThreadSummary } from "@/lib/chat/types";
import { kuDateTime } from "../../format";
import { groupThreads } from "../chat-model";

export function ChatHistoryView({ threads, base, d, now }: { threads: ThreadSummary[]; base: "/app" | "/newsroom"; d: Dict; now: number }) {
  const c = d.chat;
  const groups = groupThreads(threads, now);
  return (
    <div className="ch-hist">
      <div className="ch-hist-in">
        <h2 className="gm-title kufi">{c.history.title}</h2>
        <p className="gm-sub">{c.history.sub}</p>
        <Link href={`${base}/assistant`} className="gm-btn small ch-hist-new">
          {c.newChat}
        </Link>
        {groups.length === 0 ? (
          <p className="gm-note">{c.history.empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={c.sidebar.groups[g.key]}>
              <p className="ch-hist-group">{c.sidebar.groups[g.key]}</p>
              <ul className="ch-hist-rows">
                {g.threads.map((t) => (
                  <li key={t.id}>
                    <Link href={`${base}/assistant/${t.id}`} className="ch-hist-row">
                      <span className="ch-hist-title" dir="auto">
                        {t.pinned && <Pin size={13} aria-hidden="true" />}
                        {t.title || c.newChat}
                      </span>
                      <small>{kuDateTime(t.lastMessageAt, d)}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
