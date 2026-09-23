"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send } from "lucide-react";

import { draftReplyAction } from "./actions";
import { friendlyError } from "./format";

/**
 * The reply box shared by comments and messages. The AI suggestion only fills
 * the box — nothing is sent until the merchant presses send.
 */
export function ReplyComposer({
  incoming,
  kind,
  waUrl,
  maxLength,
  onSend,
  onCancel,
  autoFocus = true,
}: {
  incoming: string;
  kind: "comment" | "dm";
  waUrl: string | null;
  maxLength: number;
  onSend: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();
  const length = [...text].length;
  const tooLong = length > maxLength;

  function draft() {
    setError(null);
    startDraft(async () => {
      const r = await draftReplyAction(incoming, kind);
      if (r.ok) setText(r.reply);
      else setError(friendlyError(r.error));
    });
  }

  function addWhatsApp() {
    if (!waUrl) return;
    setText((t) => (t.includes(waUrl) ? t : `${t.trimEnd()}${t.trim() ? "\n" : ""}بۆ داواکردن لە وەتسئەپ: ${waUrl}`));
  }

  function send() {
    setError(null);
    startSend(async () => {
      const r = await onSend(text);
      if (r.ok) setText("");
      else setError(friendlyError(r.error));
    });
  }

  return (
    <div className="gm-compose">
      <textarea
        className="gm-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "dm" ? "نامەکەت بنووسە…" : "وەڵامەکەت بنووسە…"}
        autoFocus={autoFocus}
        dir="auto"
        aria-label="وەڵام"
        rows={3}
      />
      <div className="gm-between" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <div className="gm-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button type="button" className="gm-btn quiet small" onClick={draft} disabled={drafting || sending}>
            <Sparkles size={14} aria-hidden="true" />
            {drafting ? "دەنووسێت…" : "پێشنیاری AI"}
          </button>
          <button
            type="button"
            className="gm-btn quiet small"
            onClick={addWhatsApp}
            disabled={!waUrl || sending}
            title={waUrl ? undefined : "سەرەتا ژمارەی وەتسئەپ لە ڕێکخستن دابنێ"}
          >
            لینکی وەتسئەپ
          </button>
        </div>
        <div className="gm-row" style={{ gap: 6 }}>
          <span className={`gm-time ${tooLong ? "gm-err" : ""}`} style={{ margin: 0 }}>
            {length}/{maxLength}
          </span>
          {onCancel && (
            <button type="button" className="gm-btn quiet small" onClick={onCancel} disabled={sending}>
              داخستن
            </button>
          )}
          <button type="button" className="gm-btn small" onClick={send} disabled={!text.trim() || tooLong || sending}>
            <Send size={14} aria-hidden="true" />
            {sending ? "دەنێردرێت…" : "بنێرە"}
          </button>
        </div>
      </div>
      {!waUrl && <p className="gm-hint">بۆ لینکی وەتسئەپ، ژمارەکەت لە ڕێکخستن دابنێ.</p>}
      {error && <p className="gm-err">{error}</p>}
    </div>
  );
}
