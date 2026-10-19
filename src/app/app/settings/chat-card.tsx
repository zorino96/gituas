"use client";

// Settings > Chat: how far the chat may act without a card (owner and admins), and "delete all my chats".
// The same card serves a shop and a news desk: a desk reads the desk's wording, shows no AI allowance (its chat is bounded by plan turns,
// not by an allowance), and says so when its trial or plan has ended and the chat can only read.

import { useId, useState, useTransition } from "react";

import { AUTONOMY_LEVELS, type Autonomy } from "@/lib/chat/types";
import { newsChatText } from "@/lib/i18n/chat-news";
import { ChatCopyProvider, useLang, useT } from "@/lib/i18n/client";
import { deleteAllThreadsAction, setAutonomyAction } from "../assistant/chat-actions";
import "../chat.css";

export interface ChatCardState {
  /** The workspace this screen was opened for: both actions below refuse a tab that was left on another workspace. */
  workspaceId: string;
  /** Which kind of workspace this is (the wording and the numbers differ). A shop when left out. */
  kind?: "shop" | "news";
  autonomy: Autonomy;
  /** Only the owner and admins may change it. */
  canSetAutonomy: boolean;
  remaining: { day: number; month: number };
  /** How much of this month's AI allowance is used, 0 to 100. Null for a news desk, which has no allowance to show. */
  allowancePercent: number | null;
  /** A news desk whose trial or plan has ended: the chat can only read. */
  frozen?: boolean;
}

export function ChatCard({ initial }: { initial: ChatCardState }) {
  const body = <ChatCardBody initial={initial} />;
  // The desk's wording is laid over the shop's for everything inside the card.
  return initial.kind === "news" ? <ChatCopyProvider kind="news">{body}</ChatCopyProvider> : body;
}

function ChatCardBody({ initial }: { initial: ChatCardState }) {
  const t = useT().chat;
  const lang = useLang();
  const s = t.settings;
  const [autonomy, setAutonomy] = useState<Autonomy>(initial.autonomy);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const group = useId();

  const choose = (next: Autonomy) => {
    if (!initial.canSetAutonomy || pending || next === autonomy) return;
    const before = autonomy;
    setAutonomy(next);
    setNote(null);
    start(async () => {
      try {
        const r = await setAutonomyAction({ autonomy: next, workspaceId: initial.workspaceId });
        // The server answers with what it now holds: that is what is shown, whatever was asked.
        setAutonomy(r.autonomy);
        setNote(r.ok ? { ok: true, text: s.saved } : { ok: false, text: s.saveFailed });
      } catch {
        setAutonomy(before);
        setNote({ ok: false, text: s.saveFailed });
      }
    });
  };

  const deleteAll = () => {
    setNote(null);
    start(async () => {
      try {
        const r = await deleteAllThreadsAction({ workspaceId: initial.workspaceId });
        setNote(!r.ok ? { ok: false, text: s.deleteFailed } : r.deleted > 0 ? { ok: true, text: s.deleted(r.deleted) } : { ok: true, text: s.deleteNone });
      } catch {
        setNote({ ok: false, text: s.deleteFailed });
      } finally {
        setAsking(false);
      }
    });
  };

  return (
    <div className="gm-card ch-set">
      <div>
        <h3 className="kufi">{s.title}</h3>
        <p className="gm-hint">{s.sub}</p>
      </div>

      <fieldset className="ch-levels" disabled={!initial.canSetAutonomy}>
        <legend>{s.levelsLabel}</legend>
        {AUTONOMY_LEVELS.map((level) => (
          <label key={level} className="ch-level">
            <input type="radio" name={group} value={level} checked={autonomy === level} onChange={() => choose(level)} />
            <span>
              <b>{s.levels[level].label}</b>
              <small>{s.levels[level].help}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {!initial.canSetAutonomy && <p className="gm-hint">{s.ownerOnly}</p>}

      {initial.frozen ? (
        <p className="gm-note warn" role="status">
          {newsChatText(lang).settings.frozenNote}
        </p>
      ) : (
        <p className="gm-hint" role="status">
          {t.composer.left(initial.remaining.day, initial.remaining.month)}
          {initial.allowancePercent !== null && <> · {s.allowanceUsed(initial.allowancePercent)}</>}
        </p>
      )}
      <p className="gm-hint">{s.retention}</p>
      {note && (
        <p className={note.ok ? "gm-ok" : "gm-err"} role={note.ok ? "status" : "alert"} style={{ margin: 0 }}>
          {note.text}
        </p>
      )}

      <div className="ch-set-danger">
        <b>{s.deleteTitle}</b>
        <p className="gm-hint">{s.deleteHelp}</p>
        {asking ? (
          <>
            <p className="gm-err" role="alert" style={{ margin: 0 }}>
              {s.deleteAsk}
            </p>
            <div className="ch-set-danger-actions">
              <button type="button" className="gm-btn danger small" disabled={pending} onClick={deleteAll}>
                {s.deleteYes}
              </button>
              <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => setAsking(false)}>
                {s.deleteNo}
              </button>
            </div>
          </>
        ) : (
          <div className="ch-set-danger-actions">
            <button type="button" className="gm-btn danger small" disabled={pending} onClick={() => setAsking(true)}>
              {s.deleteButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
