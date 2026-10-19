"use client";

// How a message is drawn: the person's words and files, the assistant's text, the compact cards for what a tool looked up
// (stats, table, list, note), and the run card for a change that waits for Confirm (or ran by itself).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

import type { ChatAttachment, MessageDto, RunDto, VerifyReport, ViewBlock } from "@/lib/chat/types";
import { useT } from "@/lib/i18n/client";
import { videoJobStatusAction } from "../video/actions";
import { minutesLeft, shownStatus, splitLinks, valueDir } from "./chat-model";
import { safeHrefFor } from "./chat-frame-model";
import { useChatShell } from "./chat-shell";

export function Avatar() {
  return (
    <span className="ch-avatar" aria-hidden="true">
      <Sparkles size={15} />
    </span>
  );
}

/** Plain text with the https addresses made into links. Nothing else is interpreted. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <a key={i} className="gm-link ch-url" dir="ltr" href={part.url} target="_blank" rel="noopener noreferrer">
            {part.url}
          </a>
        ),
      )}
    </>
  );
}

function BlockLink({ href }: { href?: string }) {
  const t = useT().chat.views;
  const { kind } = useChatShell();
  const safe = safeHrefFor(kind, href);
  if (!safe) return null;
  return safe.external ? (
    <a className="ch-block-link" href={safe.href} target="_blank" rel="noopener noreferrer">
      {t.open}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  ) : (
    <Link className="ch-block-link" href={safe.href} prefetch={false}>
      {t.open}
    </Link>
  );
}

function BlockView({ block }: { block: ViewBlock }) {
  const t = useT().chat.views;
  const { kind } = useChatShell();
  if (block.kind === "note") {
    return (
      <p className={`ch-note ${block.tone === "warn" ? "warn" : ""}`} dir="auto" role={block.tone === "warn" ? "note" : undefined}>
        {block.tone === "warn" && <TriangleAlert size={15} aria-hidden="true" />}
        <span>{block.text}</span>
      </p>
    );
  }
  const heading = block.title ? <h3 className="ch-block-title">{block.title}</h3> : null;

  if (block.kind === "stats") {
    return (
      <section className="ch-block">
        {heading}
        <dl className="ch-stats">
          {block.items.map((item, i) => (
            <div key={i}>
              <dt>{item.label}</dt>
              <dd dir={valueDir(item.value)}>{item.value}</dd>
            </div>
          ))}
        </dl>
        <BlockLink href={block.href} />
      </section>
    );
  }

  if (block.kind === "table") {
    return (
      <section className="ch-block">
        {heading}
        {/* A wide table scrolls inside its card, so the page never scrolls sideways; the card takes the keyboard's focus to be scrolled. */}
        <div className="ch-tablewrap" tabIndex={0} role="group" aria-label={block.title ?? undefined}>
          <table>
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i} scope="col" dir="auto">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} dir={valueDir(cell)}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(block.more ?? 0) > 0 && <p className="ch-more">{t.more(block.more!)}</p>}
        <BlockLink href={block.href} />
      </section>
    );
  }

  return (
    <section className="ch-block">
      {heading}
      <ul className="ch-items">
        {block.items.map((item, i) => {
          const safe = safeHrefFor(kind, item.href);
          const body = (
            <>
              <span className="ch-item-main" dir="auto">
                <b>{item.title}</b>
                {item.sub && <small>{item.sub}</small>}
              </span>
              {item.badge && <span className="ch-pill">{item.badge}</span>}
            </>
          );
          return (
            <li key={i}>
              {safe ? (
                safe.external ? (
                  <a className="ch-item" href={safe.href} target="_blank" rel="noopener noreferrer">
                    {body}
                  </a>
                ) : (
                  <Link className="ch-item" href={safe.href} prefetch={false}>
                    {body}
                  </Link>
                )
              ) : (
                <div className="ch-item">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {(block.more ?? 0) > 0 && <p className="ch-more">{t.more(block.more!)}</p>}
      <BlockLink href={block.href} />
    </section>
  );
}

/** Pictures and videos: small tiles that open the full file. Sizes are fixed, so a late-loading picture moves nothing. */
export function Files({ files, large = false }: { files: Pick<ChatAttachment, "url" | "kind" | "name">[]; large?: boolean }) {
  const label = useT().chat.screen.imageOf;
  if (!files.length) return null;
  return (
    <div className={`ch-files${large ? " large" : ""}`}>
      {files.map((f, i) =>
        f.kind === "image" ? (
          <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="ch-file">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.name || label} loading="lazy" />
          </a>
        ) : (
          <video key={i} className="ch-file" src={f.url} controls playsInline preload="metadata" aria-label={f.name || label} />
        ),
      )}
    </div>
  );
}

/** A video being made: asks after it until it is ready or has failed, then shows it. */
function VideoWatch({ jobId }: { jobId: string }) {
  const t = useT().chat.runs;
  const [state, setState] = useState<{ phase: "waiting" | "none" } | { phase: "ready"; url: string } | { phase: "failed"; error: string }>({ phase: "waiting" });
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const until = Date.now() + 20 * 60_000;
    const finish = (next: typeof state) => {
      stopped = true;
      clearInterval(timer);
      setState(next);
    };
    const ask = async () => {
      if (stopped) return;
      if (Date.now() > until) return finish({ phase: "none" });
      try {
        const r = await videoJobStatusAction(jobId);
        if (stopped) return;
        if (!r.ok) return finish({ phase: "none" });
        if (r.status === "FAILED") return finish({ phase: "failed", error: r.error || t.videoFailed });
        if (r.url) return finish({ phase: "ready", url: r.url });
      } catch {
        /* the next tick asks again */
      }
    };
    void ask();
    timer = setInterval(() => void ask(), 6_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, t.videoFailed]);

  if (state.phase === "none") return null;
  if (state.phase === "ready")
    return (
      <div>
        <p className="ch-ok" role="status">
          {t.videoReady}
        </p>
        <Files files={[{ url: state.url, kind: "video", name: "" }]} large />
      </div>
    );
  if (state.phase === "failed")
    return (
      <p className="ch-err" role="alert">
        {state.error}
      </p>
    );
  return (
    <p className="ch-working" role="status">
      <LoaderCircle size={15} className="ch-spin" aria-hidden="true" />
      {t.videoWaiting}
    </p>
  );
}

/** What reading the change back found: what matches, or what does not (with a button that asks the chat to put it right). */
function Verified({ verify, onFix }: { verify: VerifyReport; onFix?: () => void }) {
  const t = useT().chat.runs;
  const bad = verify.status === "problem";
  const lines = bad ? verify.problems : verify.checked;
  return (
    <div className={`ch-verify ${bad ? "bad" : "good"}`} role={bad ? "alert" : "note"}>
      <p className="ch-verify-head">
        {bad ? <TriangleAlert size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
        <b>{bad ? t.problem : t.verified}</b>
      </p>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {bad && onFix && (
        <div className="ch-run-actions">
          <button type="button" className="gm-btn small" onClick={onFix}>
            {t.fixIt}
          </button>
        </div>
      )}
    </div>
  );
}

export function RunCard({
  run,
  now,
  deciding,
  error,
  onDecide,
  onFix,
}: {
  run: RunDto;
  /** The time, known only in the browser (null while the page is being server-rendered). */
  now: number | null;
  /** The person pressed a button of this card and the answer has not come back. */
  deciding?: "confirm" | "cancel";
  error?: string;
  onDecide: (run: RunDto, action: "confirm" | "cancel") => void;
  /** Asks the chat to fix what the read-back found (given only for the newest answer). */
  onFix?: (run: RunDto) => void;
}) {
  const t = useT().chat.runs;
  const status = deciding === "confirm" && run.status === "PROPOSED" ? "RUNNING" : now === null ? run.status : shownStatus(run, now);
  const left = status === "PROPOSED" && now !== null ? minutesLeft(run.expiresAt, now) : null;
  const result = useRef<HTMLParagraphElement>(null);
  const acted = useRef(false);
  if (deciding) acted.current = true;
  // After the person's own Confirm or Cancel the result is read out and the keyboard focus lands on it (the buttons are gone).
  useEffect(() => {
    if (acted.current && (status === "DONE" || status === "FAILED" || status === "CANCELLED")) {
      result.current?.focus();
      acted.current = false;
    }
  }, [status]);

  const failed = status === "FAILED" ? run.error || run.resultText || t.failedDefault : null;
  return (
    <section className={`ch-run ${status.toLowerCase()}`} aria-label={run.title}>
      <header>
        <b dir="auto">{run.title}</b>
        <span className="ch-pill status">{t.status[status]}</span>
      </header>
      {run.risk !== "low" && run.risk !== "read" && status === "PROPOSED" && <p className="ch-risk">{t.risk[run.risk]}</p>}
      {run.tainted && status === "PROPOSED" && (
        <p className="ch-taint" role="note">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{t.tainted}</span>
        </p>
      )}
      {run.lines.length > 0 && (
        <dl className="ch-lines">
          {run.lines.map((l, i) => (
            <div key={i}>
              <dt>{l.label}</dt>
              <dd dir={valueDir(l.value)}>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {status === "PROPOSED" && (
        <div className="ch-run-actions">
          <button type="button" className="gm-btn small" disabled={!!deciding} onClick={() => onDecide(run, "confirm")}>
            {t.confirm}
          </button>
          <button type="button" className="gm-btn quiet small" disabled={!!deciding} onClick={() => onDecide(run, "cancel")}>
            {deciding === "cancel" ? t.working : t.cancel}
          </button>
          {left !== null && <small className="ch-expiry">{left <= 1 ? t.expiresSoon : t.expiresIn(left)}</small>}
        </div>
      )}
      {status === "RUNNING" && (
        <div role="status">
          <p className="ch-working">
            <LoaderCircle size={15} className="ch-spin" aria-hidden="true" />
            {t.working}
          </p>
          {run.long && <small className="ch-expiry">{t.workingLong}</small>}
        </div>
      )}
      {status === "DONE" && (
        <>
          <p ref={result} tabIndex={-1} className="ch-ok" role="status" dir="auto">
            {run.decidedBy === "AUTO" && (
              <span className="ch-pill auto" title={t.autoHelp}>
                {t.auto}
              </span>
            )}
            {run.resultText || t.status.DONE}
          </p>
          {run.verify && <Verified verify={run.verify} onFix={onFix ? () => onFix(run) : undefined} />}
          {run.media && <Files files={[run.media]} large />}
          {run.jobId && <VideoWatch jobId={run.jobId} />}
        </>
      )}
      {failed && (
        <p ref={result} tabIndex={-1} className="ch-err" role="alert" dir="auto">
          {failed}
        </p>
      )}
      {status === "CANCELLED" && (
        <p ref={result} tabIndex={-1} className="ch-quiet-line" role="status">
          {t.status.CANCELLED}
        </p>
      )}
      {/* What went wrong with the press of a button: only while the card still waits. Once it is decided (here or in another tab) its own state is the answer. */}
      {error && (status === "PROPOSED" || status === "EXPIRED") && (
        <p className="ch-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function MessageView({
  message,
  now,
  deciding,
  decideErrors,
  onDecide,
  onFix,
}: {
  message: MessageDto;
  now: number | null;
  deciding: Record<string, "confirm" | "cancel">;
  decideErrors: Record<string, string>;
  onDecide: (run: RunDto, action: "confirm" | "cancel") => void;
  onFix?: (run: RunDto) => void;
}) {
  const s = useT().chat.screen;
  if (message.role === "user") {
    return (
      // Read out already by the person typing it: not announced again as new.
      <div className="ch-msg user" aria-live="off">
        <span className="ch-sr">{s.you}: </span>
        <Files files={message.attachments} />
        {message.text && (
          <div className="ch-bubble" dir="auto">
            {message.text}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="ch-msg bot">
      <Avatar />
      <div className="ch-bot-body">
        <span className="ch-sr">{s.assistant}: </span>
        {message.text && (
          <p className="ch-text" dir="auto">
            <RichText text={message.text} />
          </p>
        )}
        {message.blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        <Files files={message.attachments} large />
        {message.runs.map((r) => (
          <RunCard key={r.id} run={r} now={now} deciding={deciding[r.id]} error={decideErrors[r.id]} onDecide={onDecide} onFix={onFix} />
        ))}
      </div>
    </div>
  );
}
