// One model call WITH tools, for the chat. Where completeJson asks for a JSON object, this sends the conversation as messages
// and the tools as native function definitions (the OpenAI format all our providers speak), and reads back the text and the
// tool calls the model made. The providers are tried in the same order as everywhere else (AI_ORDER), each once, with the same
// 90 s cooling for a provider that failed; every call is metered against the workspace's allowance.
//
// Probed on 2026-10-19 (/api/cron/ai-models {tools:true}): native tool calls and a tool-result round trip work on Anthropic's
// compatible endpoint, the gateway's Haiku and its free DeepSeek, GLM and LongCat models, and on DeepSeek's own two models.
// The gateway answers in server-sent events even when stream:false, so both shapes are read.

import { randomUUID } from "node:crypto";

import { altConfigured, altModels } from "./alt";
import { deepseekConfigured, deepseekModel } from "./deepseek";
import { kurdggConfigured, kurdggHeaders, partsText } from "./kurdgg";
import { chooseTier, recordSpend, type Meter } from "./meter";
import { estimateTokens, modelFor } from "./models";
import { AiUnavailable, coolStep, mainOrder, stepCooling } from "./provider";

export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** The arguments exactly as the model wrote them (a JSON text; parsed and checked by the caller). */
  args: string;
}

export interface ChatStepResult {
  text: string;
  toolCalls: ModelToolCall[];
  /** Which provider and model answered, for the log and the message's meta. */
  model: string;
  usage: { in: number; out: number };
  finish: string | null;
}

/** The allowance of the month is used up (chat stops at the optional share of it). */
export class AllowanceExhausted extends Error {
  constructor() {
    super("this month's AI allowance is used up");
    this.name = "AllowanceExhausted";
  }
}

/** A reply that arrived (and was paid for) but had neither text nor a tool call. */
class EmptyChatReply extends Error {
  constructor(readonly usage: { in: number; out: number }) {
    super("empty reply");
    this.name = "EmptyChatReply";
  }
}

/** One try's time limit (before it is cut to what the caller's deadline leaves). */
const STEP_TIMEOUT_MS = 28_000;
/** A try is not started with less time than this. */
const MIN_TRY_MS = 4_000;
/** Thinking models spend part of the cap on thinking; the cap must leave room for the answer and its tool calls. */
const MAX_TOKENS = 3_500;
const DEFAULT_BASE = "https://api.kurd.gg/v1";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

interface Target {
  /** Cooling key. */
  key: string;
  url: string;
  headers: Record<string, string>;
  model: string;
  extra: Record<string, unknown>;
}

function mainTarget(): Target | null {
  if (!kurdggConfigured()) return null;
  const base = (process.env.KURDGG_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  // No temperature for any provider: tool calls do not need it, and Anthropic's own models refuse it.
  return { key: "main", url: `${base}/chat/completions`, headers: kurdggHeaders(), model: modelFor("haiku"), extra: {} };
}

function deepseekTarget(): Target | null {
  if (!deepseekConfigured()) return null;
  return {
    key: "deepseek",
    url: DEEPSEEK_URL,
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY!.trim()}`, "Content-Type": "application/json" },
    model: deepseekModel(false),
    // The fast model answers straight away; thinking would spend the cap and need its reasoning passed back between steps.
    extra: { thinking: { type: "disabled" } },
  };
}

function altTarget(model: string): Target | null {
  if (!altConfigured()) return null;
  const base = process.env.ALT_AI_BASE_URL!.trim().replace(/\/$/, "");
  return { key: `alt:${model}`, url: `${base}/chat/completions`, headers: { Authorization: `Bearer ${process.env.ALT_AI_API_KEY!.trim()}`, "Content-Type": "application/json" }, model, extra: {} };
}

/** The free open models of the gateway ("oc/..."): a free gateway can keep what it is sent, so a buyer's words never go to them. */
export const isFreeModel = (model: string): boolean => model.startsWith("oc/");

/** The providers to try, in the owner's order (AI_ORDER); whatever the order leaves out still follows it. */
export function chatTargets(order: string[] = mainOrder(), allowFree = true): Target[] {
  const out: Target[] = [];
  const add = (t: Target | null) => {
    if (t && (allowFree || !isFreeModel(t.model)) && !out.some((x) => x.key === t.key)) out.push(t);
  };
  for (const step of order) {
    if (step === "main") add(mainTarget());
    else if (step === "deepseek") add(deepseekTarget());
    else if (step === "alt") altModels().forEach((m) => add(altTarget(m)));
    else if (step.startsWith("alt:")) add(altTarget(step.slice(4)));
  }
  add(mainTarget());
  add(deepseekTarget());
  altModels().forEach((m) => add(altTarget(m)));
  return out;
}

interface ReplyChunk {
  model?: string;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  choices?: {
    finish_reason?: unknown;
    message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] };
    delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }[] };
  }[];
}

export interface ParsedReply {
  text: string;
  toolCalls: ModelToolCall[];
  finish: string | null;
  model: string | null;
  usage: { in: number; out: number } | null;
}

const argText = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/**
 * The text and the tool calls of a reply, from a plain JSON body or from server-sent events (where the pieces of a call's
 * arguments arrive in fragments, joined here by the call's index).
 */
export function parseChatReply(raw: string): ParsedReply {
  let text = "";
  let finish: string | null = null;
  let model: string | null = null;
  let usage: ParsedReply["usage"] = null;
  const calls = new Map<number, { id?: string; name?: string; args: string }>();
  const readUsage = (u: ReplyChunk["usage"]) => {
    const a = Number(u?.prompt_tokens);
    const b = Number(u?.completion_tokens);
    if (Number.isFinite(a) && Number.isFinite(b) && a + b > 0) usage = { in: a, out: b };
  };
  const take = (c: ReplyChunk) => {
    model = c.model ?? model;
    readUsage(c.usage);
    const ch = c.choices?.[0];
    if (!ch) return;
    if (typeof ch.finish_reason === "string") finish = ch.finish_reason;
    text += partsText(ch.delta?.content ?? ch.message?.content);
    for (const [i, d] of (ch.delta?.tool_calls ?? []).entries()) {
      const at = typeof d.index === "number" ? d.index : i;
      const cur = calls.get(at) ?? { args: "" };
      if (d.id) cur.id = d.id;
      if (d.function?.name) cur.name = d.function.name;
      cur.args += argText(d.function?.arguments);
      calls.set(at, cur);
    }
    for (const [i, d] of (ch.message?.tool_calls ?? []).entries()) {
      calls.set(1000 + i, { id: d.id, name: d.function?.name, args: argText(d.function?.arguments) });
    }
  };
  if (raw.trimStart().startsWith("data:")) {
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        take(JSON.parse(payload) as ReplyChunk);
      } catch {
        // a keep-alive or comment line
      }
    }
  } else {
    try {
      take(JSON.parse(raw) as ReplyChunk);
    } catch {
      // not JSON: no text, no calls
    }
  }
  const toolCalls = [...calls.entries()]
    .sort((x, y) => x[0] - y[0])
    // A provider that sends no id gets a random one: a position ("call_1") repeats in every step and turn.
    .map(([, c]) => ({ id: c.id || `call_${randomUUID().replace(/-/g, "")}`, name: c.name ?? "", args: c.args }))
    .filter((c) => c.name);
  return { text: text.trim(), toolCalls, finish, model, usage };
}

/**
 * The same conversation with the tool traffic written out as plain text, for a provider that refuses another provider's tool calls
 * in the history (DeepSeek's endpoint does). Nothing is lost for the model; only the protocol shape changes.
 */
export function flattenToolHistory(messages: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      const calls = m.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`).join("; ");
      out.push({ role: "assistant", content: `${m.content ? `${m.content}\n` : ""}[I called: ${calls}]` });
    } else if (m.role === "tool") {
      out.push({ role: "user", content: `[Tool result ${m.tool_call_id}]\n${m.content}` });
    } else {
      out.push(m);
    }
  }
  return out;
}

const hasToolTraffic = (messages: ChatMsg[]) => messages.some((m) => m.role === "tool");

async function request(t: Target, messages: ChatMsg[], tools: ChatToolSpec[], maxTokens: number, timeoutMs: number): Promise<ChatStepResult> {
  const res = await fetch(t.url, {
    method: "POST",
    headers: t.headers,
    body: JSON.stringify({ model: t.model, stream: false, max_tokens: maxTokens, ...(tools.length ? { tools, tool_choice: "auto" } : {}), messages, ...t.extra }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Never echo the provider's free text: it can quote the request back.
    let code = "unknown";
    try {
      const b = JSON.parse(raw);
      code = b?.error?.type ?? b?.error?.code ?? code;
    } catch {
      /* not JSON */
    }
    throw new Error(`HTTP ${res.status} ${typeof code === "string" ? code.slice(0, 40) : "unknown"}`);
  }
  const r = parseChatReply(raw);
  const usage = r.usage ?? { in: estimateTokens(JSON.stringify(messages) + JSON.stringify(tools)), out: estimateTokens(r.text + r.toolCalls.map((c) => c.args).join("")) };
  if (!r.text && !r.toolCalls.length) throw new EmptyChatReply(usage);
  return { text: r.text, toolCalls: r.toolCalls, model: `${t.key}/${r.model ?? t.model}`, usage, finish: r.finish };
}

export interface ChatStepOptions {
  messages: ChatMsg[];
  tools: ChatToolSpec[];
  /** The workspace the call is counted against. Without it nothing is counted (system use). */
  meter?: Meter;
  /** Epoch ms by which the call must be over. */
  deadlineAt: number;
  maxTokens?: number;
  /** False once customers' words are in the conversation: the free open models of the gateway are then left out. Default true. */
  allowFree?: boolean;
  /** For tests. */
  order?: string[];
  now?: () => number;
}

/**
 * One model call. The allowance is checked first (chat stops at the optional share of it, keeping the rest for buyers' messages);
 * each provider gets one try; a provider that refuses the history with tool calls in it gets one more try with the history written
 * out as text. Throws AllowanceExhausted or AiUnavailable.
 */
export async function chatStep(opts: ChatStepOptions): Promise<ChatStepResult> {
  const now = opts.now ?? Date.now;
  const targets = chatTargets(opts.order, opts.allowFree ?? true);
  if (!targets.length) throw new AiUnavailable("no AI provider is configured");
  if (opts.meter) {
    const allowed = await chooseTier(opts.meter, "haiku", { essential: false }).catch((): "haiku" => "haiku");
    if (!allowed) throw new AllowanceExhausted();
  }
  const spend = async (usage: { in: number; out: number }) => {
    if (!opts.meter) return;
    try {
      await recordSpend(opts.meter, "haiku", usage.in, usage.out);
    } catch {
      /* the answer is kept; the month's count is one call short */
    }
  };
  const errors: string[] = [];
  for (const t of targets) {
    if (stepCooling(t.key, now())) continue;
    for (const flat of hasToolTraffic(opts.messages) ? [false, true] : [false]) {
      const timeout = Math.min(STEP_TIMEOUT_MS, opts.deadlineAt - now() - 500);
      if (timeout < MIN_TRY_MS) break;
      // A try cut short by the turn's own deadline says nothing about the provider: it is not left alone afterwards.
      const cutByDeadline = timeout < STEP_TIMEOUT_MS;
      try {
        const r = await request(t, flat ? flattenToolHistory(opts.messages) : opts.messages, opts.tools, opts.maxTokens ?? MAX_TOKENS, timeout);
        await spend(r.usage);
        return r;
      } catch (e) {
        if (e instanceof EmptyChatReply) {
          await spend(e.usage); // paid for all the same
          errors.push(`${t.key}: empty reply`);
          break;
        }
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          // A call that timed out may still have been generated and billed: a cautious guess is counted.
          await spend({ in: estimateTokens(JSON.stringify(opts.messages)), out: 800 });
          errors.push(`${t.key}: timeout`);
          if (!cutByDeadline) coolStep(t.key, now());
          break;
        }
        const status = /^HTTP (\d{3})/.exec(e instanceof Error ? e.message : "")?.[1];
        errors.push(`${t.key}: ${status ? `HTTP ${status}` : "failed"}`);
        // The provider may refuse another provider's tool calls in the history: try once more with them written out as text.
        if (status === "400" && !flat && hasToolTraffic(opts.messages)) continue;
        if (status !== "400") coolStep(t.key, now());
        break;
      }
    }
  }
  console.error("[chat] no provider answered:", errors.join(" | ") || "none tried");
  throw new AiUnavailable(errors.join("; ") || "the AI did not answer");
}
