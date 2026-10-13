"use client";

// The assistant: a short chat that explains Gituas and looks at the shop's own settings. The conversation lives in
// this tab (sessionStorage, for this workspace) only; the server gets the last few turns with each question and keeps
// none of them.

import { useEffect, useRef, useState, useTransition } from "react";
import { MessageCircle, Send } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { askAssistantAction } from "./actions";

type Turn = { role: "user" | "assistant"; text: string };
type Piece = string | { url: string };

/** Splits a text into plain parts and links; the punctuation that ends a sentence stays outside the link. */
function withLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(/https:\/\/[^\s>]+/g)) {
    const tail = /[.,;:!?؟،؛…"'”»)\]]+$/.exec(m[0])?.[0] ?? "";
    const url = tail ? m[0].slice(0, -tail.length) : m[0];
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ url });
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const MIN_QUESTION = 2;

export function AssistantClient({ workspaceId, support }: { workspaceId: string; support: { url: string; display: string } }) {
  const t = useT().assistant;
  const key = `gm-assistant:${workspaceId}`;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [restored, setRestored] = useState(false);
  const [input, setInput] = useState("");
  const [followups, setFollowups] = useState<string[]>([]);
  const [error, setError] = useState<{ text: string; contact: boolean } | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Back after a reload of the page. Nothing is written before this has been read.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as Turn[] | null;
      if (Array.isArray(saved)) setTurns(saved.filter((x) => (x?.role === "user" || x?.role === "assistant") && typeof x.text === "string").slice(-40));
    } catch {
      /* nothing kept */
    }
    setRestored(true);
  }, [key]);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(turns.slice(-40)));
    } catch {
      /* private window */
    }
  }, [turns, restored, key]);
  // A new answer comes into view; the answer's own top is what matters on a phone, so the end sentinel keeps
  // room under it for the bottom bar.
  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns, pending]);

  function send(text: string, fromField: boolean) {
    const q = text.trim().slice(0, 1_200);
    if (q.length < MIN_QUESTION || pending) return;
    const before = turns;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    if (fromField) setInput("");
    setError(null);
    setFollowups([]);
    start(async () => {
      try {
        const r = await askAssistantAction({ messages: next });
        if (r.ok) {
          setTurns([...next, { role: "assistant", text: r.reply }]);
          setFollowups(r.followups);
        } else {
          // Not answered: the question goes back into the box and out of the conversation, so it can be sent again.
          setTurns(before);
          if (fromField) setInput(q);
          setError({ text: r.error, contact: r.contact });
        }
      } catch {
        setTurns(before);
        if (fromField) setInput(q);
        setError({ text: t.failed, contact: true });
      } finally {
        field.current?.focus();
      }
    });
  }

  const phone = (
    <bdi dir="ltr" style={{ display: "inline-block" }}>
      {support.display}
    </bdi>
  );

  return (
    <div className="gm-stack">
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>
          {t.intro}
        </p>
        {restored && turns.length === 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            {t.examples.map((q) => (
              <button key={q} type="button" className="gm-btn quiet small" disabled={pending} onClick={() => send(q, false)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div role="log" aria-live="polite" className="gm-stack">
          {turns.map((m, i) => (
            <div
              key={i}
              dir="auto"
              className={m.role === "user" ? "gm-note" : undefined}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "10px 12px", ...(m.role === "assistant" ? { border: "1px solid var(--gm-line, rgba(0,0,0,.12))", borderRadius: 10 } : {}) }}
            >
              {withLinks(m.text).map((part, j) =>
                typeof part === "string" ? (
                  <span key={j}>{part}</span>
                ) : (
                  <a key={j} className="gm-link" dir="ltr" style={{ display: "inline-block" }} href={part.url} target="_blank" rel="noreferrer">
                    {part.url}
                  </a>
                ),
              )}
            </div>
          ))}
        </div>
        {pending && (
          <p className="gm-hint" role="status">
            {t.thinking}
          </p>
        )}
        {!pending && followups.length > 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            {followups.map((q) => (
              <button key={q} type="button" className="gm-btn quiet small" onClick={() => send(q, false)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className="gm-stack">
            <p className="gm-err" style={{ margin: 0 }}>
              {error.text}
            </p>
            {error.contact && (
              <div>
                <a className="gm-btn quiet small" href={support.url} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} aria-hidden="true" /> {t.contactLabel}: {phone}
                </a>
              </div>
            )}
          </div>
        )}
        <div ref={end} style={{ scrollMarginBottom: 96 }} />
      </div>

      <form
        className="gm-field"
        onSubmit={(e) => {
          e.preventDefault();
          send(input, true);
        }}
      >
        <label htmlFor="gm-assistant-input">{t.placeholder}</label>
        <textarea
          ref={field}
          id="gm-assistant-input"
          className="gm-textarea"
          dir="auto"
          style={{ minHeight: 76 }}
          maxLength={1_200}
          value={input}
          readOnly={pending}
          aria-busy={pending}
          enterKeyHint="send"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter breaks the line; a key that confirms a word of a phone keyboard does neither.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              send(input, true);
            }
          }}
        />
        <div className="gm-row" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <button type="submit" className="gm-btn" disabled={pending || input.trim().length < MIN_QUESTION}>
            <Send size={14} aria-hidden="true" /> {t.send}
          </button>
          {turns.length > 0 && (
            <button
              type="button"
              className="gm-btn quiet"
              disabled={pending}
              onClick={() => {
                setTurns([]);
                setFollowups([]);
                setError(null);
              }}
            >
              {t.clear}
            </button>
          )}
        </div>
      </form>

      <p className="gm-hint">{t.note}</p>
      <p className="gm-hint">
        {t.contactHelp}{" "}
        <a className="gm-link" href={support.url} target="_blank" rel="noreferrer">
          <MessageCircle size={14} aria-hidden="true" /> {t.contactLabel}: {phone}
        </a>
      </p>
    </div>
  );
}
