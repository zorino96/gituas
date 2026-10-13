"use client";

// The chat face of the app: ask, attach pictures and videos, connect the accounts, and confirm what the assistant
// proposes. The conversation lives in this tab (sessionStorage, for this workspace); the server keeps none of it.
// Nothing the assistant writes runs by itself: every action is a card with the exact values and a Confirm button.

import { useEffect, useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { MessageCircle, Paperclip, Send, X } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { videoJobStatusAction } from "../video/actions";
import { imageToJpeg } from "../publish/to-jpeg";
import { askAssistantAction, runToolAction, type ChatAttachment } from "./actions";

type Proposal = { tool: string; args: Record<string, unknown>; title: string; lines: { label: string; value: string }[]; nonce: string };
// "interrupted": the page went away while the card was running, so it may or may not have run: it is not offered again.
type Shown = { url: string; kind: "image" | "video"; name: string };
type Turn = { role: "user" | "assistant"; text: string; proposal?: Proposal; state?: "open" | "running" | "interrupted" | "done" | "cancelled"; media?: Shown };
type Piece = string | { url: string };

const MB = 1024 * 1024;
const MAX_FILES = 6;
const MAX_BYTES = 40 * MB;
const IMAGES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const VIDEOS: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const MIN_QUESTION = 2;

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

export function AssistantClient({
  workspaceId,
  support,
  connections,
  justConnected,
}: {
  workspaceId: string;
  support: { url: string; display: string };
  connections: { facebook: boolean; instagram: boolean };
  justConnected: boolean;
}) {
  const all = useT();
  const t = all.assistant;
  const s = all.settings;
  const key = `gm-assistant:${workspaceId}`;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  // File ids are never reused in a chat: a card made for "a1" cannot end up pointing at another picture.
  const [seq, setSeq] = useState(0);
  const [restored, setRestored] = useState(false);
  const [input, setInput] = useState("");
  const [followups, setFollowups] = useState<string[]>([]);
  const [error, setError] = useState<{ text: string; contact: boolean } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ack, setAck] = useState(false);
  const [needAck, setNeedAck] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Back after a reload of the page. Nothing is written before this has been read.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { turns?: Turn[]; files?: ChatAttachment[]; job?: string | null; seq?: number } | null;
      if (saved && Array.isArray(saved.turns)) {
        setTurns(
          saved.turns
            .filter((x) => (x?.role === "user" || x?.role === "assistant") && typeof x.text === "string")
            .slice(-40)
            // A card that was being confirmed when the page went away may have run: it is not offered again.
            .map((x) => (x.state === "running" ? { ...x, state: "interrupted" as const } : x)),
        );
      }
      if (saved && Array.isArray(saved.files)) setFiles(saved.files.slice(0, MAX_FILES));
      if (saved?.job && typeof saved.job === "string") setJob(saved.job);
      if (typeof saved?.seq === "number") setSeq(Math.min(99, Math.max(0, Math.floor(saved.seq))));
    } catch {
      /* nothing kept */
    }
    try {
      setAck(window.localStorage.getItem("gm_authority_ack") === "1");
    } catch {
      /* the box starts empty */
    }
    setRestored(true);
  }, [key]);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ turns: turns.slice(-40), files, job, seq }));
    } catch {
      /* private window */
    }
  }, [turns, files, job, seq, restored, key]);
  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns, pending]);

  // A video being made: ask after it until it is ready or has failed.
  useEffect(() => {
    if (!job) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const r = await videoJobStatusAction(job);
        if (stopped) return;
        if (!r.ok) {
          setJob(null);
          setTurns((x) => [...x, { role: "assistant", text: r.error }]);
        } else if (r.status === "FAILED") {
          setJob(null);
          setTurns((x) => [...x, { role: "assistant", text: r.error || t.done.videoFailed }]);
        } else if (r.url && r.pathname) {
          setJob(null);
          const id = takeId();
          if (id) setFiles((f) => [...f, { id, url: r.url!, pathname: r.pathname!, kind: "video", name: "AI video" }]);
          setTurns((x) => [...x, { role: "assistant", text: t.done.videoReady, media: { url: r.url!, kind: "video", name: "AI video" } }]);
        }
      } catch {
        /* the next tick asks again */
      }
    }, 6_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job, t.done.videoFailed, t.done.videoReady]);

  const seqRef = useRef(0);
  seqRef.current = seq;
  /** The next file id: a counter that only goes up (a1..a99 in one chat). */
  function takeId(): string | null {
    if (seqRef.current >= 99) return null;
    seqRef.current += 1;
    setSeq(seqRef.current);
    return `a${seqRef.current}`;
  }

  async function addFiles(picked: File[]) {
    setUploadError(null);
    setUploading(true);
    let list = filesRef.current;
    try {
      for (const raw of picked) {
        if (list.length >= MAX_FILES) {
          setUploadError(t.upload.full);
          break;
        }
        const isImage = !!IMAGES[raw.type];
        const isVideo = !!VIDEOS[raw.type];
        if (!isImage && !isVideo) {
          setUploadError(t.upload.badType);
          continue;
        }
        if (raw.size > MAX_BYTES) {
          setUploadError(t.upload.tooBig(MAX_BYTES / MB));
          continue;
        }
        // Instagram takes only JPEG: every picture goes up as one.
        const file = isImage && raw.type !== "image/jpeg" ? await imageToJpeg(raw, all.publish) : raw;
        const ext = isImage ? "jpg" : VIDEOS[file.type];
        const blob = await upload(`merchant/${workspaceId}/chat/${Date.now()}-${list.length}.${ext}`, file, {
          access: "public",
          handleUploadUrl: "/api/app/upload",
          contentType: file.type,
          multipart: file.size > 20 * MB,
        });
        const id = takeId();
        if (!id) break;
        list = [...list, { id, url: blob.url, pathname: blob.pathname, kind: isImage ? "image" : "video", name: raw.name.slice(0, 80) }];
        setFiles(list);
      }
    } catch {
      setUploadError(t.upload.failed);
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }

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
        const r = await askAssistantAction({ workspaceId, messages: next.map((x) => ({ role: x.role, text: x.text })), attachments: files });
        if (r.ok) {
          setTurns([...next, { role: "assistant", text: r.reply, ...(r.proposal ? { proposal: r.proposal, state: "open" as const } : {}) }]);
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

  function setCard(index: number, state: NonNullable<Turn["state"]>) {
    setTurns((all) => all.map((x, i) => (i === index ? { ...x, state } : x)));
  }

  function confirm(index: number) {
    const card = turns[index]?.proposal;
    if (!card || turns[index].state !== "open") return;
    setCard(index, "running");
    start(async () => {
      try {
        const r = await runToolAction({ workspaceId, nonce: card.nonce, tool: card.tool, args: card.args, attachments: files });
        if (r.ok) {
          setCard(index, "done");
          if (r.media) {
            const id = takeId();
            if (id) setFiles((f) => [...f, { id, url: r.media!.url, pathname: r.media!.pathname, kind: r.media!.kind, name: r.media!.name }]);
          }
          if (r.jobId) setJob(r.jobId);
          setTurns((x) => [...x, { role: "assistant", text: r.text, ...(r.media ? { media: { url: r.media.url, kind: r.media.kind, name: r.media.name } } : {}) }]);
        } else {
          // A refusal ran nothing: the card is closed, and a new request makes a new card.
          setCard(index, "cancelled");
          setError({ text: r.error, contact: false });
        }
      } catch {
        // The answer did not come back: it may have run.
        setCard(index, "interrupted");
        setError({ text: t.failed, contact: true });
      }
    });
  }

  const missing = [
    ...(connections.facebook ? [] : [{ provider: "meta_facebook", label: t.connect.facebook }]),
    ...(connections.instagram ? [] : [{ provider: "meta_instagram", label: t.connect.instagram }]),
  ];
  const connectHref = (provider: string) => `/api/oauth/${provider}/start?next=/app/assistant&ack=1`;

  const phone = (
    <bdi dir="ltr" style={{ display: "inline-block" }}>
      {support.display}
    </bdi>
  );
  const busy = pending || uploading;

  return (
    <div className="gm-stack">
      {justConnected && <p className="gm-ok">{t.connect.connected}</p>}
      {missing.length > 0 && (
        <div className="gm-card gm-stack">
          <p className="gm-sec" style={{ margin: 0 }}>
            {t.connect.title}
          </p>
          <p className="gm-hint" style={{ margin: 0 }}>
            {t.connect.help}
          </p>
          <label className="gm-row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={ack}
              style={{ marginTop: 3 }}
              onChange={(e) => {
                setAck(e.target.checked);
                if (e.target.checked) setNeedAck(false);
                try {
                  window.localStorage.setItem("gm_authority_ack", e.target.checked ? "1" : "0");
                } catch {
                  /* not remembered */
                }
              }}
            />
            <small>{s.authorityAck}</small>
          </label>
          {needAck && !ack && (
            <p className="gm-err" role="alert">
              {s.authorityNeeded}
            </p>
          )}
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            {missing.map((m) => (
              <a
                key={m.provider}
                className="gm-btn small"
                href={connectHref(m.provider)}
                onClick={(e) => {
                  if (!ack) {
                    e.preventDefault();
                    setNeedAck(true);
                  }
                }}
              >
                {m.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>
          {t.intro}
        </p>
        {restored && turns.length === 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            {t.quick.map((q) => (
              <button key={q.label} type="button" className="gm-btn quiet small" disabled={busy} onClick={() => send(q.text, false)}>
                {q.label}
              </button>
            ))}
            {t.examples.map((q) => (
              <button key={q} type="button" className="gm-btn quiet small" disabled={busy} onClick={() => send(q, false)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div role="log" aria-live="polite" className="gm-stack">
          {turns.map((m, i) => (
            <div key={i} className="gm-stack">
              <div
                dir="auto"
                className={m.role === "user" ? "gm-note" : undefined}
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "10px 12px", ...(m.role === "assistant" ? { border: "1px solid var(--line, rgba(0,0,0,.12))", borderRadius: 10 } : {}) }}
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
              {m.media && (
                <div>
                  {m.media.kind === "image" ? (
                    <a href={m.media.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.media.url} alt={m.media.name} style={{ display: "block", width: "100%", maxWidth: 520, maxHeight: 560, objectFit: "contain", borderRadius: 10 }} />
                    </a>
                  ) : (
                    <video src={m.media.url} controls playsInline preload="metadata" style={{ display: "block", width: "100%", maxWidth: 360, maxHeight: 560, borderRadius: 10 }} />
                  )}
                </div>
              )}
              {m.proposal && (
                <div className="gm-card gm-stack" style={{ borderInlineStart: "3px solid var(--ink, #111)" }}>
                  <p className="gm-sec" style={{ margin: 0 }}>
                    {m.proposal.title}
                  </p>
                  <dl style={{ margin: 0 }}>
                    {m.proposal.lines.map((l) => (
                      <div key={l.label} className="gm-row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <dt className="gm-hint" style={{ margin: 0 }}>
                          {l.label}:
                        </dt>
                        <dd dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {l.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {m.state === "done" ? (
                    <p className="gm-ok" style={{ margin: 0 }}>
                      ✓
                    </p>
                  ) : m.state === "cancelled" ? (
                    <p className="gm-hint" style={{ margin: 0 }}>
                      ✕
                    </p>
                  ) : m.state === "interrupted" ? (
                    <p className="gm-hint" style={{ margin: 0 }}>
                      {t.interrupted}
                    </p>
                  ) : (
                    <div className="gm-row" style={{ flexWrap: "wrap" }}>
                      <button type="button" className="gm-btn small" disabled={busy || m.state === "running"} onClick={() => confirm(i)}>
                        {m.state === "running" ? t.working : t.confirm}
                      </button>
                      <button type="button" className="gm-btn quiet small" disabled={busy || m.state === "running"} onClick={() => setCard(i, "cancelled")}>
                        {t.cancel}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {pending && (
          <p className="gm-hint" role="status">
            {t.thinking}
          </p>
        )}
        {job && !pending && (
          <p className="gm-hint" role="status">
            {t.working}
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
        {files.length > 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            {files.map((f) => (
              <span key={f.id} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
                {f.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="gm-thumb" src={f.url} alt={f.name} />
                ) : (
                  <video className="gm-thumb" src={f.url} muted playsInline preload="metadata" />
                )}
                <button type="button" className="gm-btn quiet small" aria-label={t.removeFile} disabled={busy} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
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
          <button type="submit" className="gm-btn" disabled={busy || input.trim().length < MIN_QUESTION}>
            <Send size={14} aria-hidden="true" /> {t.send}
          </button>
          <button type="button" className="gm-btn quiet" disabled={busy || files.length >= MAX_FILES} onClick={() => picker.current?.click()}>
            <Paperclip size={14} aria-hidden="true" /> {uploading ? t.upload.uploading : t.attach}
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) void addFiles(picked);
            }}
          />
          {(turns.length > 0 || files.length > 0) && (
            <button
              type="button"
              className="gm-btn quiet"
              disabled={busy}
              onClick={() => {
                setTurns([]);
                setFiles([]);
                setSeq(0);
                setFollowups([]);
                setError(null);
                setJob(null);
              }}
            >
              {t.clear}
            </button>
          )}
        </div>
        {uploadError && (
          <p className="gm-err" role="alert">
            {uploadError}
          </p>
        )}
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
