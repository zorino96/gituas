"use client";

// The chat itself: the conversation, the empty state, the composer, and everything that happens between the two and the
// server (the stream of a turn, the Confirm and Cancel of a card, catching up when the page was away). The pure parts
// are in chat-model.ts and chat-stream.ts; the frame around this screen (sidebar, header) is chat-shell.tsx.

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { ArrowDown, MessageCircle, Sparkles } from "lucide-react";

import { quickIdsOf, type ChatAttachment, type ChatErrorCode, type ChatEvent, type ChatRequest, type MessageDto, type QuickId, type RunDto, type ThreadSummary } from "@/lib/chat/types";
import { useT } from "@/lib/i18n/client";
import {
  chatReducer,
  codeFromResponse,
  catchUpDelay,
  hasRunning,
  initialChatState,
  keptUserMessages,
  nextCatchUp,
  offersContact,
  retryPlan,
  TMP_PREFIX,
  type ScreenErrorCode,
  type SentTurn,
} from "./chat-model";
import { readEvents } from "./chat-stream";
import { httpTransport, type ChatTransport } from "./chat-transport";
import { Composer, MAX_CHARS } from "./chat-composer";
import { visibleQuickIds, workspaceMismatch } from "./chat-frame-model";
import { ConnectCard } from "./chat-connect";
import { MessageView } from "./chat-messages";
import { ReloadNote, useChatShell } from "./chat-shell";
import { isUploadable, useChatUploads, type PutFile } from "./use-chat-uploads";

type GetThread = (input: { id: string; /** The workspace this screen was opened for. */ workspaceId?: string }) => Promise<
  { ok: true; thread: ThreadSummary; messages: MessageDto[]; remaining: { day: number; month: number }; /** A turn of this chat is still running on the server. */ busy: boolean } | { ok: false; code: ChatErrorCode }
>;

export interface ChatScreenProps {
  workspaceId: string;
  /** The stored chat this screen shows; null for a new chat. */
  thread: ThreadSummary | null;
  initialMessages: MessageDto[];
  remaining: { day: number; month: number } | null;
  support: { url: string; display: string };
  /** A new chat in a shop with nothing connected offers the connect buttons. */
  connections?: { facebook: boolean; instagram: boolean };
  justConnected?: boolean;
  /** Reads the chat again from the server: after a Stop, a lost connection, or a page that was closed while a card ran. */
  getThread?: GetThread;
  /** The chat was opened while a turn of it was still running on the server (a reload mid-answer): the screen waits for the answer. */
  busy?: boolean;
  transport?: ChatTransport;
  /** The dev preview brings its own upload. */
  put?: PutFile;
  /** The address a new chat takes once the server gave it an id; null leaves the address alone (the dev preview). Left out, the frame's. */
  urlFor?: ((id: string) => string) | null;
  /** The shortcut buttons, in order. Left out: the frame's kind of workspace decides (the shop's six, or the news desk's six). */
  quickIds?: readonly string[];
  /**
   * The weekly note is switched on (BUSINESS_PROFILE_ENABLED, read by the server page: this screen runs in the browser and cannot read it).
   * Left out or false, the "Weekly note" button is not drawn, so a shop that has not got the feature never sees a button that leads nowhere.
   */
  coachOn?: boolean;
  /** The "review my idea first" switch. Left out: shown in a shop, hidden in a news desk (it only matters for pictures and videos). */
  showReview?: boolean;
  /** A news desk whose trial or plan has ended: typed messages are paused (the shortcuts, which only look, still work). */
  frozen?: boolean;
}

const REVIEW_KEY = "gm-ai-review";

/** The time, in the browser only. It ticks while a card waits for its Confirm, so "5 min left" stays true. */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** A keyboard pops up on a phone when a field gets focus: only a window with a mouse is focused for the person. */
const focusIfDesktop = (el: HTMLElement | null) => {
  if (el && window.matchMedia("(pointer: fine)").matches) el.focus();
};

export function ChatScreen({
  workspaceId,
  thread,
  initialMessages,
  remaining,
  support,
  connections,
  justConnected = false,
  getThread,
  busy: openedBusy = false,
  transport = httpTransport,
  put,
  urlFor,
  quickIds: ownQuickIds,
  coachOn = false,
  showReview: ownShowReview,
  frozen = false,
}: ChatScreenProps) {
  const all = useT();
  const t = all.chat;
  const shell = useChatShell();
  const { setTitle, upsertThread, touch, refreshLater } = shell;
  const threadUrl = urlFor === undefined ? shell.hrefs.thread : urlFor;
  const quickIds = visibleQuickIds(ownQuickIds ?? quickIdsOf(shell.kind), { coachOn });
  const showReview = ownShowReview ?? shell.kind === "shop";
  const [state, dispatch] = useReducer(chatReducer, undefined, () => initialChatState({ threadId: thread?.id ?? null, title: thread?.title ?? "", messages: initialMessages, remaining }));
  const [input, setInput] = useState("");
  const [review, setReview] = useState(true);
  const [deciding, setDeciding] = useState<Record<string, "confirm" | "cancel">>({});
  const [decideErrors, setDecideErrors] = useState<Record<string, string>>({});
  const [dropping, setDropping] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  // Catching up with the server: after a Stop, a lost connection, or a reload while the answer was still being written.
  const [needSync, setNeedSync] = useState(false);
  const [stopped, setStopped] = useState(false);
  // This tab belongs to another workspace than the one the session is in now (the person switched in another tab): nothing is sent from it.
  const [wsGone, setWsGone] = useState(false);
  // The server's first paint cannot know where the end of the conversation is: it is shown once the screen has scrolled there.
  const [placed, setPlaced] = useState(false);
  const uploads = useChatUploads(workspaceId, put);
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  // Follows the end of the conversation; an empty chat starts at its top (the greeting, and the connect card above it).
  const stick = useRef(initialMessages.length > 0);
  const programmaticAt = useRef(0);
  const dragDepth = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Two quick presses of Enter (before the screen has drawn the first) must not send two turns.
  const sendingRef = useRef(false);
  // The last thing the person sent, so Retry can send it again when the turn failed after the server had already kept the message.
  const lastSent = useRef<SentTurn | null>(null);
  // How many messages of the person's own the server must hold once the one just sent has arrived (0 = nothing is expected).
  const expectUsers = useRef(0);
  // Each turn and each "new chat" gets a number; what a turn that was left behind still delivers is ignored.
  const epoch = useRef(0);
  const liveThread = useRef<string | null>(thread?.id ?? null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const decidingRef = useRef(deciding);
  decidingRef.current = deciding;
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  // The frame (brand, switcher, history) comes from the layout and stays while the page changes: if the page was drawn for another
  // workspace than the frame, or the server answered "workspace", this screen only offers the reload.
  const ownStale = workspaceMismatch(shell.workspaceId, workspaceId) || wsGone || state.error?.code === "workspace";
  const blocked = ownStale || shell.stale;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const waitingCard = state.messages.some((m) => m.runs.some((r) => r.status === "PROPOSED"));
  const now = useNow(waitingCard);
  const empty = state.messages.length === 0;

  // ---- remembered switch, header title, focus ----
  useEffect(() => {
    try {
      if (window.localStorage.getItem(REVIEW_KEY) === "0") setReview(false);
    } catch {
      /* the switch starts on */
    }
  }, []);
  // A chat opened while its answer was still being written (the page was reloaded mid-turn): wait for the answer.
  useEffect(() => {
    if (getThread && openedBusy) setNeedSync(true);
    // only when the screen opens
  }, []);
  useEffect(() => {
    setTitle(state.title);
    return () => setTitle(null);
  }, [state.title, setTitle]);
  useEffect(() => {
    if (empty) focusIfDesktop(field.current);
    // only when the screen opens
  }, []);
  useEffect(
    () => () => {
      epoch.current++;
      abortRef.current?.abort();
    },
    [],
  );

  // A turn that failed before the server kept the message gives the words (and files) back to the box.
  useEffect(() => {
    if (!state.restore) return;
    setInput(state.restore.text);
    uploadsRef.current.restore(state.restore.attachments);
    dispatch({ type: "restored" });
    focusIfDesktop(field.current);
  }, [state.restore]);

  // ---- scrolling: follow the end while the person is at the end; leave them alone when they scrolled up ----
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) {
      programmaticAt.current = performance.now();
      el.scrollTop = el.scrollHeight;
    }
    setPlaced(true);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    const inner = column.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stick.current) return;
      // An answer taller than the window is read from its first line, not its last: it is shown from its top (the button over the
      // box, "jump to latest", goes to the end).
      const messages = el.querySelectorAll<HTMLElement>(".ch-msg");
      const last = messages[messages.length - 1];
      let to = el.scrollHeight;
      if (last?.classList.contains("bot") && last.offsetHeight > el.clientHeight * 0.85) {
        to = last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
      }
      programmaticAt.current = performance.now();
      el.scrollTop = to;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    setAtEnd(near);
    // Only the person's own scrolling decides whether the screen keeps following; its own moves do not.
    if (performance.now() - programmaticAt.current > 150) stick.current = near;
  };
  const jumpToEnd = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    programmaticAt.current = performance.now();
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    field.current?.focus();
  };

  // ---- new chat from the sidebar while this screen stays mounted ----
  const firstSignal = useRef(shell.newChatSignal);
  useEffect(() => {
    if (shell.newChatSignal === firstSignal.current) return;
    firstSignal.current = shell.newChatSignal;
    epoch.current++;
    abortRef.current?.abort();
    liveThread.current = null;
    lastSent.current = null;
    expectUsers.current = 0;
    dispatch({ type: "reset" });
    setInput("");
    uploadsRef.current.clear();
    setDeciding({});
    setDecideErrors({});
    setNeedSync(false);
    setStopped(false);
    stick.current = true;
    focusIfDesktop(field.current);
  }, [shell.newChatSignal]);

  // ---- catching up with the server ----
  const running = hasRunning(state.messages);
  const busyDeciding = Object.keys(deciding).length > 0;
  // A turn saves a message for every tool step and the closing answer last, so "the last message is the assistant's" is not the end:
  // the server says when the turn is over (busy), and the screen asks until it does, then shows everything (chat-model.ts: nextCatchUp).
  // A card that is running is asked after too, until it has finished.
  useEffect(() => {
    const id = state.threadId;
    if (!getThread || !id || state.streaming || busyDeciding || (!needSync && !running)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let looks = 0;
    const look = async () => {
      let r: Awaited<ReturnType<GetThread>> | null = null;
      try {
        r = await getThread({ id, workspaceId });
      } catch {
        /* the next look asks again */
      }
      if (!alive) return;
      // The chat is gone (deleted in another tab) or no longer this person's: nothing to wait for.
      if (r && !r.ok) {
        if (r.code === "workspace") setWsGone(true);
        setNeedSync(false);
        return;
      }
      // The message just sent may not have reached the server yet (then "not busy" only means "not started").
      const landing = !!r && keptUserMessages(r.messages) < expectUsers.current;
      if (r && !landing) expectUsers.current = 0;
      const step = nextCatchUp(r && { busy: r.busy, landing }, Date.now() - started);
      if (r) dispatch({ type: "sync", messages: r.messages, remaining: r.remaining, done: step === "done" });
      if (step === "done") setNeedSync(false);
      // Stop when the turn is over and no card is still working, or when it has taken too long.
      if (step === "giveUp") return setNeedSync(false);
      if (step === "done" && r && !hasRunning(r.messages)) return;
      timer = setTimeout(() => void look(), catchUpDelay(++looks));
    };
    timer = setTimeout(() => void look(), catchUpDelay(0));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [getThread, workspaceId, state.threadId, state.streaming, busyDeciding, needSync, running]);

  // ---- sending ----
  const send = useCallback(
    // `files`: send exactly these (Retry sending the last message again); else the files waiting in the tray.
    async (opts: { text: string; quick?: string; files?: ChatAttachment[] }) => {
      if (stateRef.current.streaming || sendingRef.current || blockedRef.current) return;
      const text = opts.text.trim().slice(0, MAX_CHARS);
      if (!text) return;
      sendingRef.current = true;
      const attachments = opts.quick ? [] : opts.files ?? uploadsRef.current.files;
      // types.ts still types a shortcut as the shop's list; the server checks the id against the workspace's own kind (isQuickIdFor).
      const quick = opts.quick as QuickId | undefined;
      lastSent.current = { text, ...(quick ? { quick } : {}), files: attachments };
      expectUsers.current = keptUserMessages(stateRef.current.messages) + 1;
      const mine = ++epoch.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      dispatch({ type: "begin", tmp: { id: `${TMP_PREFIX}${Date.now()}`, text, attachments, quick: !!opts.quick, createdAt: new Date().toISOString() } });
      if (!opts.quick && !opts.files) {
        setInput("");
        uploadsRef.current.clear();
      }
      stick.current = true;
      setNeedSync(false);
      setStopped(false);
      const req: ChatRequest = {
        ...(liveThread.current ? { threadId: liveThread.current } : {}),
        text,
        ...(attachments.length ? { attachments } : {}),
        review,
        ...(quick ? { quick } : {}),
        workspaceId,
      };

      // A new chat is titled by the AI a few seconds after its first answer: the history is read once more then.
      let newChat = false;
      const handle = (ev: ChatEvent) => {
        if (epoch.current !== mine) return;
        dispatch({ type: "event", event: ev });
        if (ev.t === "thread") {
          liveThread.current = ev.id;
          if (ev.isNew) {
            newChat = true;
            upsertThread({ id: ev.id, title: ev.title, pinned: false, lastMessageAt: new Date().toISOString() });
            // The new chat gets its own address without leaving this screen (a page change would cut the stream).
            if (threadUrl) window.history.replaceState(null, "", threadUrl(ev.id));
          } else touch(ev.id);
        } else if (ev.t === "error" && ev.code === "not_found") {
          // The chat was deleted (in another tab): the next message starts a new one.
          liveThread.current = null;
        } else if (ev.t === "done") {
          if (liveThread.current) {
            touch(liveThread.current);
            if (newChat) refreshLater(liveThread.current);
          }
          newChat = false;
          focusIfDesktop(field.current);
        }
      };

      try {
        const res = await transport.send(req, ctrl.signal);
        if (!res.ok || !res.body) {
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            /* not JSON */
          }
          if (epoch.current === mine) dispatch({ type: "fail", code: res.ok ? "internal" : codeFromResponse(res.status, body) });
          return;
        }
        const end = await readEvents(res.body, handle, ctrl.signal);
        if (end === "ended" && epoch.current === mine) {
          dispatch({ type: "fail", code: "network" });
          // The server may have kept the message and be finishing the turn.
          setNeedSync(true);
        }
      } catch {
        if (epoch.current !== mine) return;
        if (ctrl.signal.aborted) {
          dispatch({ type: "abort" });
          setStopped(true);
          setNeedSync(true);
        } else {
          dispatch({ type: "fail", code: "network" });
          setNeedSync(true);
        }
      } finally {
        sendingRef.current = false;
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [review, workspaceId, transport, threadUrl, upsertThread, touch, refreshLater],
  );

  const decide = useCallback(
    async (run: RunDto, action: "confirm" | "cancel") => {
      if (decidingRef.current[run.id]) return;
      if (blockedRef.current) {
        setDecideErrors((e) => ({ ...e, [run.id]: t.errors.workspace }));
        return;
      }
      setDeciding((d) => ({ ...d, [run.id]: action }));
      setDecideErrors(({ [run.id]: _gone, ...rest }) => rest);
      try {
        // The switch as it is now: it decides whether a picture or a video gets its idea reviewed (and rewritten) first.
        const r = await transport.decide(run.id, { action, workspaceId, review });
        if (r.ok) {
          dispatch({ type: "event", event: { t: "run", run: r.run } });
          if (r.message) dispatch({ type: "event", event: { t: "message", message: r.message } });
          if (liveThread.current) touch(liveThread.current);
        } else {
          if (r.run) dispatch({ type: "event", event: { t: "run", run: r.run } });
          // A card that was decided already (in another tab, or by a double press) shows its own state; there is nothing to say about it.
          // The wording for a message that was not sent ("badrequest") is never put under a card.
          if (r.code === "workspace") setWsGone(true);
          if (!r.run || r.run.status === "PROPOSED") {
            const text = r.code === "badrequest" ? t.runs.decideFailed : (t.errors[r.code] ?? t.runs.decideFailed);
            setDecideErrors((e) => ({ ...e, [run.id]: text }));
          }
        }
      } catch {
        // The answer did not come back: the card may have run. The server's view settles it.
        setDecideErrors((e) => ({ ...e, [run.id]: t.runs.unknown }));
        setNeedSync(true);
      } finally {
        setDeciding(({ [run.id]: _done, ...rest }) => rest);
      }
    },
    [transport, workspaceId, touch, t, review],
  );

  const sendTyped = () => void send({ text: input });
  // Retry: the words in the box, else the last message again (the box is empty when the turn failed after the server kept the message).
  const retry = () => {
    const plan = retryPlan(input, lastSent.current);
    if (!plan) return;
    if (plan.again) void send({ text: plan.text, ...(plan.quick ? { quick: plan.quick } : {}), files: plan.files });
    else sendTyped();
  };
  const stop = () => abortRef.current?.abort();

  // ---- drag and drop of pictures ----
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dragProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDropping(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropping(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      const dropped = Array.from(e.dataTransfer.files);
      const usable = dropped.filter(isUploadable);
      if (usable.length) void uploads.add(usable);
      else if (dropped.length) uploads.setError(all.assistant.upload.badType);
    },
  };

  const { error } = state;
  const limit = state.remaining;
  // A frozen desk has no turns at all: it is told why (not that "today's chats are used up").
  const textBlocked = frozen ? t.errors.frozen : limit ? (limit.day <= 0 ? t.composer.lastOnes : limit.month <= 0 ? t.errors.limit_month : null) : null;
  const quickLabels: Record<string, { label: string } | undefined> = t.quick;
  const waiting = state.streaming || (needSync && !stopped);
  // While the screen is still waiting for a turn the server may be finishing, only the words in the box can be sent again.
  const retryable = !!error && ["network", "unavailable", "internal", "busy"].includes(error.code) && !!retryPlan(input, needSync ? null : lastSent.current);
  const wantsContact = !!error && (error.contact || offersContact(error.code));

  return (
    <div className="ch-screen" {...dragProps}>
      <div className={`ch-scroll${placed ? " placed" : ""}`} ref={scroller} onScroll={onScroll}>
        <div className="ch-col" ref={column}>
          {empty ? (
            <div className="ch-empty">
              {connections && <ConnectCard connections={connections} justConnected={justConnected} />}
              <span className="ch-avatar big" aria-hidden="true">
                <Sparkles size={24} />
              </span>
              <h2 className="ch-hello kufi">{t.empty.hello}</h2>
              <p className="ch-sub">{t.empty.sub}</p>
              <div className="ch-examples">
                {t.empty.examples.map((q) => (
                  <button key={q} type="button" className="ch-example" disabled={state.streaming || blocked || !!textBlocked} onClick={() => void send({ text: q })}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ch-list" role="log" aria-label={t.title}>
              {state.messages.map((m) => (
                <MessageView key={m.id} message={m} now={now} deciding={deciding} decideErrors={decideErrors} onDecide={decide} />
              ))}
            </div>
          )}

          <div className="ch-tail">
            {/* The live region is always in the page, so a screen reader hears the words put into it. */}
            <p className="ch-status" role="status" aria-live="polite">
              {waiting && (
                <>
                  <span className="ch-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{state.status ?? all.assistant.thinking}</span>
                </>
              )}
            </p>
            {error && error.code !== "workspace" && (
              <div className="ch-error" role="alert">
                <p>{errorText(error.code, t.errors)}</p>
                <div className="ch-error-actions">
                  {retryable && (
                    <button type="button" className="gm-btn quiet small" onClick={retry}>
                      {t.screen.retry}
                    </button>
                  )}
                  {wantsContact && (
                    <a className="gm-btn quiet small" href={support.url} target="_blank" rel="noopener noreferrer">
                      <MessageCircle size={14} aria-hidden="true" />
                      {all.assistant.contactLabel}:{" "}
                      <bdi dir="ltr">{support.display}</bdi>
                    </a>
                  )}
                </div>
              </div>
            )}
            {stopped && needSync && !state.streaming && !error && (
              <p className="ch-quiet-line" role="status">
                {t.screen.stopped}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="ch-dock">
        <div className="ch-col">
          {!atEnd && !empty && (
            <button type="button" className="ch-jump" onClick={jumpToEnd}>
              <ArrowDown size={15} aria-hidden="true" />
              {t.screen.jumpLatest}
            </button>
          )}
          {blocked ? (
            // The frame draws the note itself when it is the one that found out; the screen draws it when only its own page is out of date.
            shell.stale ? null : <ReloadNote />
          ) : (
            <Composer
              value={input}
              onChange={setInput}
              onSend={sendTyped}
              onStop={stop}
              onQuick={(id) => void send({ text: quickLabels[id]?.label ?? id, quick: id })}
              quickIds={quickIds}
              showReview={showReview}
              streaming={state.streaming}
              textBlocked={textBlocked}
              uploads={uploads}
              review={review}
              onReview={(v) => {
                setReview(v);
                try {
                  window.localStorage.setItem(REVIEW_KEY, v ? "1" : "0");
                } catch {
                  /* not remembered */
                }
              }}
              remaining={state.remaining}
              fieldRef={field}
            />
          )}
        </div>
      </div>

      {dropping && (
        <div className="ch-drop" aria-hidden="true">
          <span>{t.screen.dropHere}</span>
        </div>
      )}
    </div>
  );
}

function errorText(code: ScreenErrorCode, errors: ReturnType<typeof useT>["chat"]["errors"]): string {
  return errors[code] ?? errors.internal;
}
