// The chat screen's logic without React or the browser: how a list of messages changes when the server's events arrive,
// how the history is grouped by day, how text is split into links. Pure, so it is tested in node (tests/chat/ui*.test.ts).

import type { ChatAttachment, ChatErrorCode, ChatEvent, MessageDto, QuickId, RunDto, ThreadSummary } from "@/lib/chat/types";
import { isChatErrorCode } from "./chat-stream";

/** A failure the screen knows how to word: the server's codes, and a connection that broke on the way. */
export type ScreenErrorCode = ChatErrorCode | "network";

/** The id of a message the person just sent, before the server has kept it. */
export const TMP_PREFIX = "tmp:";
export const isTmp = (m: Pick<MessageDto, "id">): boolean => m.id.startsWith(TMP_PREFIX);

export interface ChatState {
  threadId: string | null;
  title: string;
  messages: MessageDto[];
  /** What is happening now ("Looking at the orders…"), from the server. */
  status: string | null;
  streaming: boolean;
  remaining: { day: number; month: number } | null;
  error: { code: ScreenErrorCode; message: string; contact: boolean } | null;
  /** The message sent but not yet confirmed as kept; if the turn fails before that, it goes back to the composer. */
  pending: { id: string; text: string; attachments: ChatAttachment[]; quick: boolean } | null;
  /** Text and files to put back in the composer after a turn that failed before the server kept the message. */
  restore: { text: string; attachments: ChatAttachment[] } | null;
  /** A card changed state before its message arrived: applied when the message does. */
  strayRuns: Record<string, RunDto>;
}

export function initialChatState(init: { threadId?: string | null; title?: string; messages?: MessageDto[]; remaining?: { day: number; month: number } | null } = {}): ChatState {
  return {
    threadId: init.threadId ?? null,
    title: init.title ?? "",
    messages: init.messages ?? [],
    status: null,
    streaming: false,
    remaining: init.remaining ?? null,
    error: null,
    pending: null,
    restore: null,
    strayRuns: {},
  };
}

export const lastSeq = (messages: MessageDto[]): number => messages.reduce((n, m) => Math.max(n, m.seq), 0);

const bySeq = (a: MessageDto, b: MessageDto) => a.seq - b.seq;

/** Puts a message in the list: replaces the one with the same id, else adds it in seq order (stable for equal seq). */
export function upsertMessage(list: MessageDto[], message: MessageDto): MessageDto[] {
  const at = list.findIndex((m) => m.id === message.id);
  if (at >= 0) return list.map((m, i) => (i === at ? message : m));
  return [...list, message].sort(bySeq);
}

/** A card changed: update it wherever it sits. */
export function patchRun(list: MessageDto[], run: RunDto): { messages: MessageDto[]; found: boolean } {
  let found = false;
  const messages = list.map((m) => {
    if (!m.runs.some((r) => r.id === run.id)) return m;
    found = true;
    return { ...m, runs: m.runs.map((r) => (r.id === run.id ? run : r)) };
  });
  return { messages: found ? messages : list, found };
}

/** The message a person is sending, drawn at once so the screen answers their tap. */
export function beginTurn(state: ChatState, tmp: { id: string; text: string; attachments: ChatAttachment[]; quick: boolean; createdAt: string }): ChatState {
  const message: MessageDto = {
    id: tmp.id,
    seq: lastSeq(state.messages) + 1,
    role: "user",
    text: tmp.text,
    blocks: [],
    runs: [],
    followups: [],
    attachments: tmp.attachments,
    createdAt: tmp.createdAt,
  };
  return {
    ...state,
    messages: [...state.messages, message],
    status: null,
    streaming: true,
    error: null,
    restore: null,
    pending: { id: tmp.id, text: tmp.text, attachments: tmp.attachments, quick: tmp.quick },
  };
}

/**
 * A turn that did not go through. If the server never kept the person's message, it leaves the conversation and (unless it came
 * from a quick button) goes back to the composer, so it can be sent again; if it was kept, it stays.
 */
export function failTurn(state: ChatState, code: ScreenErrorCode, message = "", contact = false): ChatState {
  const p = state.pending;
  return {
    ...state,
    messages: p ? state.messages.filter((m) => m.id !== p.id) : state.messages,
    restore: p && !p.quick ? { text: p.text, attachments: p.attachments } : state.restore,
    pending: null,
    streaming: false,
    status: null,
    error: { code, message, contact },
  };
}

/** The person pressed Stop: the turn goes on in the server, the screen just stops waiting. */
export function abortTurn(state: ChatState): ChatState {
  return { ...state, streaming: false, status: null, pending: null };
}

export function applyEvent(state: ChatState, ev: ChatEvent): ChatState {
  switch (ev.t) {
    case "thread":
      return { ...state, threadId: ev.id, title: ev.title || state.title };
    case "status":
      return { ...state, status: ev.text || null };
    case "message": {
      const { message } = ev;
      const stray = { ...state.strayRuns };
      const withStray = message.runs.length
        ? { ...message, runs: message.runs.map((r) => stray[r.id] ?? r) }
        : message;
      for (const r of message.runs) delete stray[r.id];
      if (message.role === "user") {
        // The server kept it: it replaces the one drawn at once (or is added, if the screen did not draw it).
        const tmpId = state.pending?.id;
        const list = tmpId ? state.messages.filter((m) => m.id !== tmpId) : state.messages;
        return { ...state, messages: upsertMessage(list, withStray), pending: null, strayRuns: stray };
      }
      return { ...state, messages: upsertMessage(state.messages, withStray), status: null, strayRuns: stray };
    }
    case "run": {
      const { messages, found } = patchRun(state.messages, ev.run);
      return found ? { ...state, messages } : { ...state, strayRuns: { ...state.strayRuns, [ev.run.id]: ev.run } };
    }
    case "done":
      return { ...state, streaming: false, status: null, pending: null, remaining: ev.remaining };
    case "error":
      return failTurn(state, ev.code, ev.message, ev.contact === true);
  }
}

export type ChatAction =
  | { type: "begin"; tmp: Parameters<typeof beginTurn>[1] }
  | { type: "event"; event: ChatEvent }
  | { type: "fail"; code: ScreenErrorCode }
  | { type: "abort" }
  /** `done`: the server says the turn is over (see nextCatchUp), so what it holds is the whole answer. */
  | { type: "sync"; messages: MessageDto[]; remaining?: { day: number; month: number }; done?: boolean }
  | { type: "restored" }
  | { type: "reset"; state?: ChatState };

/** The one reducer of the screen; every change to the conversation goes through the functions above. */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "begin":
      return beginTurn(state, action.tmp);
    case "event":
      return applyEvent(state, action.event);
    case "fail":
      return failTurn(state, action.code);
    case "abort":
      return abortTurn(state);
    case "sync": {
      const messages = reconcile(state.messages, action.messages);
      // A connection that broke while the server went on with the turn: once the answer is in, the "connection broke" line is stale.
      const answered = action.done === true && messages.length > 0 && messages[messages.length - 1].role === "assistant";
      return { ...state, messages, remaining: action.remaining ?? state.remaining, error: answered && state.error?.code === "network" ? null : state.error };
    }
    case "restored":
      return { ...state, restore: null };
    case "reset":
      return action.state ?? initialChatState();
  }
}

/**
 * The thread as the server now has it, against what the screen drew: the server's messages are the truth. A message the person
 * sent that the screen drew but never saw confirmed is dropped when the server's list holds the same words.
 */
export function reconcile(local: MessageDto[], remote: MessageDto[]): MessageDto[] {
  const sentWords = new Set(remote.filter((m) => m.role === "user").map((m) => m.text));
  const unconfirmed = local.filter((m) => isTmp(m) && !sentWords.has(m.text));
  return [...remote, ...unconfirmed].sort(bySeq);
}

// ---------------------------------------------------------------------------------------------------------------------
// Catching up with the server: after a Stop, a lost connection, or a reload while the answer was still being written.
//
// A turn saves an assistant message for every tool step and the closing answer only after one more model call, so "the last message
// is the assistant's" does not mean the turn is over. The server says it: a chat's thread row is locked while a turn runs, and
// getThreadAction reports that as `busy`. The screen asks until `busy` is false, then shows everything.

/** The first look comes soon (a turn that failed for good is known quickly), the next ones at a calmer pace. */
export const CATCH_UP_FIRST_MS = 1_500;
export const CATCH_UP_EVERY_MS = 4_000;
/** A server that never says "not busy" must not be asked for ever. */
export const CATCH_UP_GIVE_UP_MS = 180_000;
/** A message that was just sent may not have reached the server yet (a slow start): "not busy" is believed only after this long. */
export const CATCH_UP_LANDING_MS = 15_000;

export type CatchUpStep = "again" | "done" | "giveUp";

/**
 * What to do after a look at the server (null = the look failed): stop when it is not busy, give up when it took too long, else ask
 * again. `landing`: the server does not hold the message the person just sent, so "not busy" may only mean it has not started.
 */
export function nextCatchUp(look: { busy: boolean; landing?: boolean } | null, elapsedMs: number): CatchUpStep {
  if (look && !look.busy && !(look.landing && elapsedMs < CATCH_UP_LANDING_MS)) return "done";
  return elapsedMs >= CATCH_UP_GIVE_UP_MS ? "giveUp" : "again";
}

/** How many messages of the person's own a list holds (the ones the server kept, not the one drawn at once). */
export const keptUserMessages = (messages: MessageDto[]): number => messages.filter((m) => m.role === "user" && !isTmp(m)).length;

/** How long to wait before the next look (0 = the first). */
export const catchUpDelay = (looks: number): number => (looks === 0 ? CATCH_UP_FIRST_MS : CATCH_UP_EVERY_MS);

/** What the person sent last, kept so Retry can send it again when the turn failed after the server had already kept the message. */
export interface SentTurn {
  text: string;
  quick?: QuickId;
  files: ChatAttachment[];
}

/**
 * What the Retry button does. The words in the box win (the message went back to the box, or the person changed it); with the box
 * empty it sends the last thing again; with neither there is nothing to retry.
 */
export function retryPlan(input: string, last: SentTurn | null): { again: false } | ({ again: true } & SentTurn) | null {
  if (input.trim()) return { again: false };
  return last && last.text.trim() ? { again: true, ...last } : null;
}

/** Where the keyboard goes inside an open menu: the next or previous item (wrapping), the first, the last; null for any other key. */
export function menuTarget<T>(key: string, items: T[], current: unknown): T | null {
  if (items.length === 0) return null;
  const at = items.indexOf(current as T);
  if (key === "ArrowDown") return items[(at + 1) % items.length];
  if (key === "ArrowUp") return items[(at <= 0 ? items.length : at) - 1];
  if (key === "Home") return items[0];
  if (key === "End") return items[items.length - 1];
  return null;
}

/**
 * The direction of a value drawn in a card, a table or a list of figures. Digits are neutral, so dir="auto" would read a bare
 * "٣" or "95,000" as left-to-right and put it at the wrong edge of a right-to-left card: those take the page's direction (no
 * attribute). A value with letters in it works out its own direction.
 */
export const valueDir = (value: string): "auto" | undefined => (/\p{L}/u.test(value) ? "auto" : undefined);

export const hasRunning = (messages: MessageDto[]): boolean => messages.some((m) => m.runs.some((r) => r.status === "RUNNING"));

/** How long a card waits for its Confirm, in whole minutes rounded up; null when the time is unknown, 0 when it has passed. */
export function minutesLeft(expiresAt: string, now: number): number | null {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** The status to draw: a card nobody confirmed in time is shown as expired even before the server says so. */
/** The cards of one answer that "Confirm all" would confirm: waiting, not expired, not one made after customers' words (those are checked one by one), not being decided. */
export function waitingToConfirm(runs: RunDto[], now: number | null, deciding: Record<string, unknown> = {}): RunDto[] {
  if (now === null) return [];
  return runs.filter((r) => shownStatus(r, now) === "PROPOSED" && !r.tainted && !deciding[r.id]);
}

export function shownStatus(run: Pick<RunDto, "status" | "expiresAt">, now: number): RunDto["status"] {
  return run.status === "PROPOSED" && minutesLeft(run.expiresAt, now) === 0 ? "EXPIRED" : run.status;
}

/** What an HTTP answer that is not a stream means. The route words most failures itself as an "error" event; this is for the rest. */
export function codeFromResponse(status: number, body: unknown): ChatErrorCode {
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  if (isChatErrorCode(code)) return code;
  if (status === 401) return "signin";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409 || status === 429) return "busy";
  if (status === 400 || status === 413 || status === 422) return "badrequest";
  if (status === 408 || status === 502 || status === 503 || status === 504) return "unavailable";
  return "internal";
}

/** Failures worth offering the support number for: the ones the person cannot fix by waiting or shortening. */
export const offersContact = (code: ScreenErrorCode): boolean => code === "internal" || code === "unavailable" || code === "network" || code === "limit_month";

// ---------------------------------------------------------------------------------------------------------------------
// The history in the sidebar.

export type GroupKey = "pinned" | "today" | "yesterday" | "week" | "month" | "older";
export interface ThreadGroup {
  key: GroupKey;
  threads: ThreadSummary[];
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day of an instant as a number of days (Baghdad's day, so server and browser agree), or NaN for a bad date. */
export function dayNumber(ms: number): number {
  if (Number.isNaN(ms)) return NaN;
  const parts = dayFmt.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}

/** Which group a thread's last message puts it in: today, yesterday, days 2-7, days 8-30, older. */
export function groupOf(iso: string, now: number): Exclude<GroupKey, "pinned"> {
  const age = dayNumber(now) - dayNumber(Date.parse(iso));
  if (Number.isNaN(age)) return "older";
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age <= 7) return "week";
  if (age <= 30) return "month";
  return "older";
}

const newestFirst = (a: ThreadSummary, b: ThreadSummary) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt) || 0;

/** The sidebar's list: pinned first, then by day, newest first inside each; groups with nothing in them are left out. */
export function groupThreads(threads: ThreadSummary[], now: number): ThreadGroup[] {
  const sorted = [...threads].sort(newestFirst);
  const groups: ThreadGroup[] = [];
  const add = (key: GroupKey, list: ThreadSummary[]) => list.length && groups.push({ key, threads: list });
  add("pinned", sorted.filter((t) => t.pinned));
  const rest = sorted.filter((t) => !t.pinned);
  for (const key of ["today", "yesterday", "week", "month", "older"] as const) add(key, rest.filter((t) => groupOf(t.lastMessageAt, now) === key));
  return groups;
}

/** A thread added or replaced in the list (a new chat appears, a title changes). */
export function upsertThread(list: ThreadSummary[], thread: ThreadSummary): ThreadSummary[] {
  return list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? { ...t, ...thread } : t)) : [thread, ...list];
}

// ---------------------------------------------------------------------------------------------------------------------
// Text.

export type Piece = string | { url: string };

/** Splits a text into plain parts and https links; the punctuation that ends a sentence stays outside the link. Nothing else is a link. */
export function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(/https:\/\/[^\s<>"'`]+/g)) {
    const tail = /[.,;:!?؟،؛…"'”»)\]]+$/.exec(m[0])?.[0] ?? "";
    const url = tail ? m[0].slice(0, -tail.length) : m[0];
    if (url.length <= "https://".length) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ url });
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A link from a view block: an address inside the app, or an https address. Anything else (javascript:, //host) is not drawn as a link. */
export function safeHref(href: string | undefined): { href: string; external: boolean } | null {
  if (!href) return null;
  if (/^\/(?![/\\])/.test(href)) return { href, external: false };
  if (/^https:\/\/[^\s]+$/.test(href)) return { href, external: true };
  return null;
}
