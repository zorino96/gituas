// The chat-first assistant: the shapes every part of it shares (tools, cards, what the screen receives).
// Read docs/chat-first/DESIGN.md first. Nothing in this file touches the database or the network.

import type { z } from "zod";

import type { Lang } from "@/lib/i18n/lang";
import type { Permission, Role } from "@/lib/newsroom/roles";

export type ChatKind = "shop" | "news";

/**
 * What a tool can do to the world.
 *   read      looks only
 *   low       a small, reversible change to the workspace's own settings or data
 *   money     spends the workspace's AI pictures or videos
 *   public    shows something to the public or to buyers (a post, a price, a product)
 *   outbound  writes to a named person (a reply to a comment, a message): never runs without a card
 *   standing  acts later without anyone watching (autopilot that publishes, replies that switch on): never runs without a card
 *   destructive  removes something that cannot be brought back (a product): never runs without a card
 */
export type Risk = "read" | "low" | "money" | "public" | "outbound" | "standing" | "destructive";

/** How far the chat may act without a card (Tenant.chatAutonomy). See decide() in guard.ts for the exact rules. */
export const AUTONOMY_LEVELS = ["ASK", "LOW", "ALL"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];
export const isAutonomy = (v: unknown): v is Autonomy => typeof v === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(v);

/** A file the person attached in the chat: referred to by a short id ("a1"), never by address. Checked again on every use. */
export interface ChatAttachment {
  id: string;
  url: string;
  pathname: string;
  kind: "image" | "video";
  name: string;
}

/** What a tool is given. Everything in it comes from the session, never from the model. */
export interface ToolCtx {
  tenantId: string;
  userId: string;
  role: Role;
  kind: ChatKind;
  lang: Lang;
  threadId: string;
  /** The files attached to this thread so far (validated: the workspace's own uploads only). */
  attachments: ChatAttachment[];
  /** "Let Gituas review my idea first" (default true). */
  review: boolean;
  /** Epoch ms: the tool must be finished by then (the request has a 60 s limit). */
  deadline: number;
}

/** What the person sees of a tool's result. Every string is already in the person's language. */
export type ViewBlock =
  | { kind: "stats"; title?: string; items: { label: string; value: string }[]; href?: string }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][]; more?: number; href?: string }
  | { kind: "list"; title?: string; items: { title: string; sub?: string; badge?: string; href?: string }[]; more?: number; href?: string }
  | { kind: "note"; text: string; tone?: "info" | "warn" }
  /** The person's connected accounts, drawn by the screen as live controls: choose which one the chat uses, and connect another. No data inside: the screen asks the server. */
  | { kind: "accounts" };

export interface CardLine {
  label: string;
  value: string;
}
/** The confirmation card of a change: the exact values, in the person's language. */
export interface Card {
  title: string;
  lines: CardLine[];
  /**
   * Arguments to put over the model's before the run is stored and hashed: a loose name the card resolved is pinned to the exact id
   * it resolved to (a product), so Confirm acts on what the card showed even if names change meanwhile. Must still fit the schema.
   */
  pin?: Record<string, unknown>;
}

export interface ReadResult {
  /** What the model reads: compact JSON (the loop cuts it to a size limit; put the most useful fields first). */
  data: unknown;
  /** What the person sees. */
  view?: ViewBlock[];
}

export interface WriteResult {
  ok: boolean;
  /** One plain sentence for the person (and the model): what happened, or why it did not. */
  text: string;
  /** A picture made: the screen keeps it as an attachment, ready for "post it". */
  media?: { url: string; pathname: string; kind: "image" | "video"; name: string };
  /** A video being made. */
  jobId?: string;
  /** Small data the model may use next. */
  data?: unknown;
}

/**
 * What reading a change back from the live data found, after the change was made. Only a real read-back produces a report: a tool
 * with no verifier has none, and nothing ever says "checked" without one.
 */
export interface VerifyReport {
  /** ok: the live state matches what was asked. problem: something does not (see `problems`). */
  status: "ok" | "problem";
  /** What was compared and found right, in the person's language, one short plain line each. */
  checked: string[];
  /** What does not match, in the person's language, one plain sentence each. */
  problems: string[];
  /** For the model, English: what to propose to put it right (a tool and its arguments in words). Only with a problem. */
  fix?: string;
}

/**
 * Reads the change back. Read-only, quick (it has about six seconds), and it looks at the stored state, never at the tool's own
 * answer alone. Returns null when there is nothing to compare. Words for the person are in `ctx.lang`.
 */
export type VerifyFn = (ctx: ToolCtx, args: unknown, done: { text: string; data?: unknown; runId: string }) => Promise<VerifyReport | null>;

/**
 * A tool refuses (bad target, nothing to change, a feature that is off). The message goes back to the model as the tool's result, so
 * the model can ask the person or try something else. Write it for the model, in English, without any secret.
 */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRefusal";
  }
}

interface ToolCommon<S extends z.ZodTypeAny> {
  /** snake_case, unique. */
  name: string;
  /** For the model, English: what it does, when to use it, what each argument means. Short. */
  description: string;
  /** Strict. Arguments that do not fit are never run: the model is told why. */
  schema: S;
  kinds: readonly ChatKind[];
  /** Checked against the person's role before the tool is offered AND before it runs. */
  permission: Permission;
  /** What the person is told while it works ("Looking at the orders…"), in their language. */
  label: (lang: Lang) => string;
}

export interface ReadToolDef<S extends z.ZodTypeAny> extends ToolCommon<S> {
  risk: "read";
  /** The result carries text written by customers or other third parties: it is wrapped as data and the turn is held to Confirm. */
  untrusted?: boolean | ((ctx: ToolCtx) => boolean);
  run(ctx: ToolCtx, args: z.output<S>): Promise<ReadResult>;
}

export interface WriteToolDef<S extends z.ZodTypeAny> extends ToolCommon<S> {
  risk: Exclude<Risk, "read">;
  /** Takes more than about 20 s (a picture): it runs only from its own card's request, never inside a chat turn. */
  long?: boolean;
  /** A public post: it counts against the day's posts (a day's number of posts is a fence). */
  countsAsPost?: boolean;
  /**
   * The argument names that carry free text the public or a buyer will read (a caption, a reply, a product description). The loop
   * strips from them every link, phone number, @handle and domain that the person did not type themselves in this thread.
   */
  textFields?: readonly string[];
  /** The risk of THESE arguments when it depends on them (switching replies off is "low", on is "standing"). Else `risk` is used. */
  riskFor?(args: z.output<S>): Exclude<Risk, "read">;
  /** Looks at the live state, refuses what cannot work (ToolRefusal), and makes the card the person will see. Changes nothing. */
  card(ctx: ToolCtx, args: z.output<S>): Promise<Card>;
  /** Does it, through the same server action the app's own screens use. Runs after the card was confirmed (or the autonomy allowed it). */
  execute(ctx: ToolCtx, args: z.output<S>): Promise<WriteResult>;
}

export interface ReadTool extends Omit<ReadToolDef<z.ZodTypeAny>, "run"> {
  run(ctx: ToolCtx, args: unknown): Promise<ReadResult>;
}
export interface WriteTool extends Omit<WriteToolDef<z.ZodTypeAny>, "card" | "execute" | "riskFor"> {
  riskFor?(args: unknown): Exclude<Risk, "read">;
  card(ctx: ToolCtx, args: unknown): Promise<Card>;
  execute(ctx: ToolCtx, args: unknown): Promise<WriteResult>;
}
export type ChatTool = ReadTool | WriteTool;
export const isWriteTool = (t: ChatTool): t is WriteTool => t.risk !== "read";

/** Define a tool with its arguments typed from the schema. */
export function defineRead<S extends z.ZodTypeAny>(def: ReadToolDef<S>): ReadTool {
  return def as unknown as ReadTool;
}
export function defineWrite<S extends z.ZodTypeAny>(def: WriteToolDef<S>): WriteTool {
  return def as unknown as WriteTool;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the screen receives.

export type RunStatus = "PROPOSED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "EXPIRED";

export interface RunDto {
  id: string;
  tool: string;
  risk: Risk;
  title: string;
  lines: CardLine[];
  status: RunStatus;
  /** CONFIRMED = the person pressed Confirm; AUTO = the autonomy setting let it run. */
  decidedBy: "CONFIRMED" | "AUTO" | null;
  /** The turn read customer-written text: it can only be confirmed by the person. */
  tainted: boolean;
  /** ISO time after which an unconfirmed card is dead. */
  expiresAt: string;
  /** What happened (the tool's sentence), or why it failed. */
  resultText?: string;
  error?: string;
  media?: { url: string; pathname: string; kind: "image" | "video"; name: string };
  jobId?: string;
  /** A card that takes long (a picture) is run from its own request; the screen shows a longer wait. */
  long: boolean;
  /** The change was read back from the live data after it was made (only for tools that have a check). */
  verify?: VerifyReport;
}

export interface MessageDto {
  id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  blocks: ViewBlock[];
  runs: RunDto[];
  followups: string[];
  /** Files the person attached to this message (user) or a picture a tool made (assistant). */
  attachments: ChatAttachment[];
  createdAt: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: string;
}

export type ChatErrorCode =
  | "signin" // not signed in
  | "forbidden" // the role may not use the chat
  | "workspace" // the screen was opened for another workspace
  | "badrequest"
  | "limit_day" // the day's chat turns are used
  | "limit_month"
  | "allowance" // the AI allowance of the month is used up
  | "busy" // another turn of this thread is still running
  | "unavailable" // no AI provider answered
  | "not_found"
  | "expired" // a card is too old
  | "frozen" // a news desk whose trial and plan have ended may only read
  | "internal";

/** One line of the answer to POST /api/chat (newline-delimited JSON). */
export type ChatEvent =
  /** First: the thread this turn belongs to (new when `isNew`). */
  | { t: "thread"; id: string; title: string; isNew: boolean }
  /** What is happening now ("Looking at the orders…"). */
  | { t: "status"; text: string }
  /** A message was saved: the person's own, or one of the assistant's (a turn can make several). */
  | { t: "message"; message: MessageDto }
  /** A card changed state (an automatic run finished). */
  | { t: "run"; run: RunDto }
  /** Last. `remaining` is what is left of the plan's chat turns. */
  | { t: "done"; remaining: { day: number; month: number }; ms: number }
  | { t: "error"; code: ChatErrorCode; message: string; /** Offer the support number. */ contact?: boolean };

/** The body of POST /api/chat. */
export interface ChatRequest {
  /** Omitted = a new thread. */
  threadId?: string;
  text: string;
  /** Files attached to this message. */
  attachments?: ChatAttachment[];
  review?: boolean;
  /** A shortcut that needs no AI: the chat runs the read tools itself and costs nothing (the buttons of a shop or of a desk). */
  quick?: AnyQuickId;
  /** The workspace the screen was opened for (a tab left behind is refused). */
  workspaceId: string;
}

/** The shop's shortcut buttons. */
export const QUICK_IDS = ["today", "orders", "comments", "messages", "scheduled", "check", "coach"] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const isQuickId = (v: unknown): v is QuickId => typeof v === "string" && (QUICK_IDS as readonly string[]).includes(v);
/** The news desk's shortcut buttons. */
export const NEWS_QUICK_IDS = ["today", "stories", "ready", "comments", "messages", "scheduled", "check"] as const;
export type NewsQuickId = (typeof NEWS_QUICK_IDS)[number];
/** A shortcut of either kind of workspace. */
export type AnyQuickId = QuickId | NewsQuickId;
export const quickIdsOf = (kind: ChatKind): readonly string[] => (kind === "news" ? NEWS_QUICK_IDS : QUICK_IDS);
export const isQuickIdFor = (kind: ChatKind, v: unknown): v is AnyQuickId => typeof v === "string" && quickIdsOf(kind).includes(v);

/** The body of POST /api/chat/runs/[id] and its answer. */
export interface RunDecisionRequest {
  action: "confirm" | "cancel";
  workspaceId: string;
  /** The "let Gituas review my idea first" switch as it is now (default true); only pictures and videos use it. */
  review?: boolean;
}
export type RunDecisionResponse = { ok: true; run: RunDto; message?: MessageDto } | { ok: false; code: ChatErrorCode; message: string; run?: RunDto };
