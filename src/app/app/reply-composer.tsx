"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { draftReplyAction } from "./actions";
import { friendlyError } from "./format";
import { useBase } from "./use-base";

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
  // The WhatsApp order link is a shop tool; a newsroom has no orders.
  const isShop = useBase() === "/app";
  const t = useT();
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
      else setError(friendlyError(r.error, t));
    });
  }

  function addWhatsApp() {
    if (!waUrl) return;
    setText((prev) => (prev.includes(waUrl) ? prev : `${prev.trimEnd()}${prev.trim() ? "\n" : ""}${t.composer.whatsappLine(waUrl)}`));
  }

  function send() {
    setError(null);
    startSend(async () => {
      const r = await onSend(text);
      if (r.ok) setText("");
      else setError(friendlyError(r.error, t));
    });
  }

  return (
    <div className="gm-compose">
      <textarea
        className="gm-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "dm" ? t.composer.placeholderDm : t.composer.placeholderComment}
        autoFocus={autoFocus}
        dir="auto"
        aria-label={t.composer.label}
        rows={3}
      />
      <div className="gm-between" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <div className="gm-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button type="button" className="gm-btn quiet small" onClick={draft} disabled={drafting || sending}>
            <Sparkles size={14} aria-hidden="true" />
            {drafting ? t.common.writing : t.composer.aiSuggest}
          </button>
          {isShop && (
            <button
              type="button"
              className="gm-btn quiet small"
              onClick={addWhatsApp}
              disabled={!waUrl || sending}
              title={waUrl ? undefined : t.composer.whatsappLinkTitle}
            >
              {t.composer.whatsappLink}
            </button>
          )}
        </div>
        <div className="gm-row" style={{ gap: 6 }}>
          <span className={`gm-time ${tooLong ? "gm-err" : ""}`} style={{ margin: 0 }}>
            {length}/{maxLength}
          </span>
          {onCancel && (
            <button type="button" className="gm-btn quiet small" onClick={onCancel} disabled={sending}>
              {t.composer.close}
            </button>
          )}
          <button type="button" className="gm-btn small" onClick={send} disabled={!text.trim() || tooLong || sending}>
            <Send size={14} aria-hidden="true" />
            {sending ? t.composer.sending : t.composer.send}
          </button>
        </div>
      </div>
      {isShop && !waUrl && <p className="gm-hint">{t.composer.whatsappHint}</p>}
      {error && <p className="gm-err">{error}</p>}
    </div>
  );
}
