"use client";

// The box at the bottom: quick buttons (they run without AI), the files waiting to be sent, the text, and Send or Stop.
// Enter sends, Shift+Enter breaks the line; pictures can be pasted or dropped (the screen handles drops).

import { useLayoutEffect, useRef, type RefObject } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";

import { QUICK_IDS, type QuickId } from "@/lib/chat/types";
import { useT } from "@/lib/i18n/client";
import { ACCEPT, MAX_FILES, pastedFiles } from "./chat-files";
import type { ChatUploads } from "./use-chat-uploads";

export const MAX_CHARS = 4_000;

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onQuick,
  streaming,
  textBlocked,
  uploads,
  review,
  onReview,
  remaining,
  fieldRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onQuick: (id: QuickId) => void;
  streaming: boolean;
  /** The day's (or month's) chat turns are used: the quick buttons still work, typed messages do not. Holds the words to show. */
  textBlocked: string | null;
  uploads: ChatUploads;
  review: boolean;
  onReview: (v: boolean) => void;
  remaining: { day: number; month: number } | null;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const all = useT();
  const c = all.chat.composer;
  const q = all.chat.quick;
  const picker = useRef<HTMLInputElement>(null);
  const busy = streaming || uploads.uploading;
  const canSend = !busy && !textBlocked && value.trim().length > 0;

  // The box grows with its text up to a few lines; empty, it is the one line the style gives it.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.value) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, fieldRef]);

  return (
    <form
      className="ch-composer-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="ch-quick" role="group" aria-label={c.quickGroup} title={c.quickHint}>
        {QUICK_IDS.map((id) => (
          <button key={id} type="button" className="ch-chip" disabled={busy} onClick={() => onQuick(id)}>
            {q[id].label}
          </button>
        ))}
      </div>

      <div className="ch-composer">
        {uploads.files.length > 0 && (
          <div className="ch-tray">
            {uploads.files.map((f) => (
              <span key={f.id} className="ch-tray-file">
                {f.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} />
                ) : (
                  <video src={f.url} muted playsInline preload="metadata" aria-label={f.name} />
                )}
                <button type="button" aria-label={`${all.assistant.removeFile}: ${f.name}`} disabled={streaming} onClick={() => uploads.remove(f.id)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={fieldRef}
          className="ch-input"
          // Empty, the box follows the page (a right-to-left screen starts at the right); with words in it, their own direction decides.
          dir={value ? "auto" : undefined}
          rows={1}
          aria-label={c.label}
          aria-describedby="ch-hint"
          placeholder={c.placeholder}
          maxLength={MAX_CHARS}
          value={value}
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter breaks the line; the key that confirms a word on a phone's keyboard does neither.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          onPaste={(e) => {
            // Text on the clipboard is pasted as text, even when the same copy brought a picture along (cells from a sheet).
            const pasted = pastedFiles(Array.from(e.clipboardData.files), e.clipboardData.getData("text/plain"));
            if (pasted.length === 0) return;
            e.preventDefault();
            void uploads.add(pasted);
          }}
        />
        <span id="ch-hint" className="ch-sr">
          {c.hint}
        </span>
        <div className="ch-bar">
          <button
            type="button"
            className="ch-iconbtn"
            aria-label={uploads.uploading ? all.assistant.upload.uploading : all.assistant.attach}
            title={all.assistant.attach}
            disabled={busy || uploads.files.length >= MAX_FILES}
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={19} aria-hidden="true" />
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (picked.length) void uploads.add(picked);
            }}
          />
          <label className="ch-review" title={all.publish.ai.reviewHelp}>
            <input type="checkbox" checked={review} disabled={streaming} onChange={(e) => onReview(e.target.checked)} />
            <span>{all.publish.ai.reviewLabel}</span>
          </label>
          {streaming ? (
            <button type="button" className="ch-send stop" aria-label={c.stop} title={c.stop} onClick={onStop}>
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="ch-send" aria-label={c.send} title={c.send} disabled={!canSend}>
              <ArrowUp size={19} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {uploads.uploading && (
        <p className="ch-foot" role="status">
          {all.assistant.upload.uploading}
        </p>
      )}
      {uploads.error && (
        <p className="ch-foot err" role="alert">
          {uploads.error}
        </p>
      )}
      {textBlocked ? (
        <p className="ch-foot warn" role="status">
          {textBlocked}
        </p>
      ) : (
        remaining && <p className="ch-foot left">{c.left(remaining.day, remaining.month)}</p>
      )}
    </form>
  );
}
