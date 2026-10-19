// One turn of the chat: the person says something, the model looks and acts through tools, and the person gets an answer.
// The model never changes anything by itself (see docs/chat-first/DESIGN.md): reads run, writes become held proposals that run
// only when the person confirms or when the autonomy setting and the guard rules allow it.

import { AllowanceExhausted, type ChatMsg, type ChatStepResult, type ModelToolCall, chatStep as realChatStep } from "@/lib/ai/chat";
import type { Meter } from "@/lib/ai/meter";
import { microUsd } from "@/lib/ai/models";
import type { KnowledgeFeatures } from "@/lib/assistant/knowledge";
import { dict } from "@/lib/i18n";
import { LIMITS } from "./budget";
import { executeClaimedRun, toolCtx, type Actor } from "./confirm";
import { cleanAnswer, cleanOutbound, decide, ownerCorpus, titleFrom } from "./guard";
import { buildHistory } from "./history";
import { indexTools, riskOf, toolSpecs } from "./registry";
import {
  appendMessage,
  attachmentsOf,
  claimRun,
  createRun,
  loadMessages,
  messageToDto,
  runToDto,
  runsOfThread,
  setTaintedSeq,
  updateMessage,
  type ChatRun,
  type ChatThread,
} from "./store";
import { guardAdviceDetailed } from "./numbers";
import { hasProfileState, systemPrompt } from "./system";
import { systemPromptNews } from "./system-news";
import { NEWS_QUICK, say } from "./text";
import { isWriteTool, ToolRefusal, type Autonomy, type Card, type ChatAttachment, type ChatErrorCode, type ChatEvent, type ChatTool, type AnyQuickId, type ChatKind, type ViewBlock } from "./types";
import { withTimeout } from "./util";
import { verifyForModel } from "./verify";
import { noteOf, wrapForModel } from "./wrap";

export interface Snapshot {
  state: unknown;
  uiNames: Record<string, string>;
  features: KnowledgeFeatures;
}

export interface TurnDeps {
  step: typeof realChatStep;
  /** Already limited to this kind of workspace and this role. */
  tools: ChatTool[];
  snapshot: () => Promise<Snapshot>;
  meter?: Meter;
  now: () => number;
}

export interface TurnInput {
  actor: Actor;
  thread: ChatThread;
  text: string;
  /** Files attached to THIS message (already checked, ids assigned). */
  attachments: ChatAttachment[];
  review: boolean;
  autonomy: Autonomy;
  /** Facts about the person's own shop (its WhatsApp number, its handles): they count as typed by the person. */
  ownerFacts: string[];
  emit: (e: ChatEvent) => void;
}

export interface TurnOutcome {
  /** The person got a usable answer (or cards to confirm). */
  answered: boolean;
  error?: ChatErrorCode;
  costMicro: number;
  steps: number;
  tainted: boolean;
}

const asBaghdad = (now: number) => new Date(now + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const err = (message: string) => ({ content: JSON.stringify({ error: message }), note: `error: ${message.slice(0, 60)}`, blocks: [] as ViewBlock[], runId: undefined as string | undefined });

/** One path ("caption", "reply.texts.default", "actions.*.text"): "*" stands for every element of a list or every key of an object. */
function cleanPath(node: unknown, segs: string[], corpus: string, keepAmounts: boolean): unknown {
  if (segs.length === 0) return typeof node === "string" ? cleanOutbound(node, corpus, { keepAmounts }) : node;
  const [head, ...rest] = segs;
  if (Array.isArray(node)) return head === "*" ? node.map((x) => cleanPath(x, rest, corpus, keepAmounts)) : node;
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (head === "*") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cleanPath(v, rest, corpus, keepAmounts)]));
    if (head in o) return { ...o, [head]: cleanPath(o[head], rest, corpus, keepAmounts) };
  }
  return node;
}

/** The model's arguments with every free-text field cleaned (links, numbers and handles the person never typed are removed). */
function cleanTextFields(tool: { textFields?: readonly string[] }, args: unknown, corpus: string, keepAmounts = false): unknown {
  if (!tool.textFields?.length || !args || typeof args !== "object") return args;
  let out: unknown = args;
  for (const path of tool.textFields) out = cleanPath(out, path.split("."), corpus, keepAmounts);
  return out;
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnOutcome> {
  const { actor, thread, emit } = input;
  const started = deps.now();
  const deadline = started + LIMITS.deadlineMs;
  const toolMap = indexTools(deps.tools);
  const specs = toolSpecs(deps.tools);

  const [priorRows, priorRuns] = await Promise.all([loadMessages(thread.id, { last: LIMITS.historyMessages * 3 }), runsOfThread(thread.id)]);
  const lastAssistant = [...priorRows].reverse().find((r) => r.role === "assistant");
  // The turn after one that read customer text is held to Confirm as well (the model may be carrying a stranger's words).
  let tainted = !!lastAssistant && thread.taintedSeq > 0 && lastAssistant.seq === thread.taintedSeq;
  // Only a turn that itself read customer text passes the hold on to the next one (a carried hold lasts one turn, not for ever).
  let readUntrusted = false;

  const userRow = await appendMessage(thread.id, { role: "user", content: input.text, meta: input.attachments.length ? { attachments: input.attachments } : undefined });
  emit({ t: "message", message: messageToDto(userRow, new Map())! });

  const runMap = new Map(priorRuns.map((r) => [r.id, r]));
  const everyAttachment = attachmentsOf([...priorRows, userRow], priorRuns, actor.tenantId);
  const corpus = ownerCorpus([...priorRows.filter((r) => r.role === "user").map((r) => r.content), input.text], input.ownerFacts);
  const snap = await deps.snapshot();
  const advisorOn = actor.kind === "shop" && hasProfileState(snap.state);
  const snapshotText = JSON.stringify(snap.state);
  const fileNote = input.attachments.length ? `\n[attached: ${input.attachments.map((a) => `${a.id} (${a.kind})`).join(", ")}]` : "";
  const messages: ChatMsg[] = [
    { role: "system", content: (actor.kind === "news" ? systemPromptNews : systemPrompt)({ lang: actor.lang, uiNames: snap.uiNames, state: snap.state, features: snap.features, attachments: everyAttachment, advisor: advisorOn, buttons: { confirm: dict(actor.lang).chat.runs.confirm, cancel: dict(actor.lang).chat.runs.cancel }, nowBaghdad: asBaghdad(started) }) },
    ...buildHistory(priorRows, runMap),
    { role: "user", content: input.text + fileNote },
  ];
  const ctx = toolCtx(actor, { threadId: thread.id, attachments: everyAttachment, review: input.review, deadline });

  /** What an advice answer may take its numbers from: this turn's tool results, the account snapshot and what the owner wrote. */
  const allowedAdviceText = () => [...messages.filter((m) => m.role === "tool").map((m) => (typeof m.content === "string" ? m.content : "")), snapshotText, corpus].join("\n");

  const proposed: ChatRun[] = [];
  let costMicro = 0;
  let steps = 0;
  let finalText = "";
  let model = "";
  let stop: "done" | "cut" | "error" | "allowance" = "done";
  let finished = false;
  let didWork = false;

  /** One tool call: returns what goes back to the model and what the person sees. */
  const handleCall = async (c: ModelToolCall): Promise<{ content: string; note: string; blocks: ViewBlock[]; runId?: string }> => {
    const tool = toolMap.get(c.name);
    if (!tool) return err(`unknown tool "${c.name}"`);
    let raw: unknown;
    try {
      raw = c.args.trim() ? JSON.parse(c.args) : {};
    } catch {
      return err("the arguments were not valid JSON");
    }
    const parsed = tool.schema.safeParse(raw);
    if (!parsed.success) return err(`invalid arguments: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    emit({ t: "status", text: tool.label(actor.lang) });

    if (!isWriteTool(tool)) {
      try {
        const left = Math.min(LIMITS.readTimeoutMs, deadline - deps.now() - 1_500);
        const res = await withTimeout(tool.run({ ...ctx, deadline: deps.now() + left }, parsed.data), left);
        const untrusted = typeof tool.untrusted === "function" ? tool.untrusted(ctx) : !!tool.untrusted;
        if (untrusted) tainted = readUntrusted = true;
        didWork = true;
        return { content: wrapForModel(res.data, { untrusted }), note: noteOf(res.data), blocks: res.view ?? [] };
      } catch (e) {
        if (e instanceof ToolRefusal) return err(e.message);
        if (e instanceof Error && e.name === "TimeoutError") return err("the lookup took too long; try a narrower request");
        console.error("[chat] read tool failed:", tool.name, e instanceof Error ? e.name : "unknown");
        return err("the lookup failed");
      }
    }

    // A change. The free-text fields are cleaned first, and the cleaned arguments must still fit the tool's schema.
    const cleaned = tool.schema.safeParse(cleanTextFields(tool, parsed.data, corpus, actor.kind === "news"));
    if (!cleaned.success) return err("after removing links, phone numbers and handles that the owner did not write, a text field became empty or too short; ask the owner for the missing value");
    const args = cleaned.data as Record<string, unknown>;
    // Something the owner did not write (a link, a number, a handle) was taken out of the text: the model must say so.
    const textEdited = JSON.stringify(args) !== JSON.stringify(parsed.data);
    const risk = riskOf(tool, args);
    let card: Card;
    try {
      card = await withTimeout(tool.card(ctx, args), 10_000);
    } catch (e) {
      if (e instanceof ToolRefusal) return err(e.message);
      console.error("[chat] card failed:", tool.name, e instanceof Error ? e.name : "unknown");
      return err("this change could not be prepared");
    }
    // Confirm must act on what the card showed: a name the card resolved is stored as the exact id it resolved to.
    let stored: Record<string, unknown> = args;
    if (card.pin) {
      const pinned = tool.schema.safeParse({ ...args, ...card.pin });
      if (!pinned.success) return err("this change could not be prepared");
      stored = pinned.data as Record<string, unknown>;
    }
    let run = await createRun({
      threadId: thread.id,
      tenantId: actor.tenantId,
      userId: actor.userId,
      toolCallId: c.id,
      tool: tool.name,
      args: stored,
      risk,
      autonomy: input.autonomy,
      tainted,
      card: { ...card, long: !!tool.long },
      now: deps.now(),
    });
    didWork = true;
    if (run.status !== "PROPOSED") {
      // A retried step: the run exists already; the model is told how it stands.
      return { content: JSON.stringify({ status: run.status.toLowerCase(), run: run.id }), note: `${tool.name} → ${run.status.toLowerCase()}`, blocks: [], runId: run.id };
    }
    const roomToRun = deadline - deps.now() >= LIMITS.autoRunMinMs;
    if (roomToRun && decide({ risk, autonomy: input.autonomy, tainted, long: tool.long }) === "run" && (await claimRun(run.id, "AUTO", deps.now()))) {
      const done = await executeClaimedRun({ run, tool, actor, attachments: everyAttachment, review: input.review, deadline, how: "AUTO" });
      run = done.run;
      emit({ t: "run", run: runToDto(run, deps.now()) });
      proposed.push(run);
      const status = done.ok ? "done" : done.unknown ? "outcome_unknown" : "failed";
      const note = done.unknown ? "It may still have gone through. Do NOT repeat it; tell the owner to check before trying again." : undefined;
      return {
        content: JSON.stringify({
          status,
          text: done.text,
          ...(note ? { note } : {}),
          ...(done.data !== undefined ? { data: done.data } : {}),
          ...(done.verify ? { verify: verifyForModel(done.verify) } : {}),
        }),
        note: "",
        blocks: [],
        runId: run.id,
      };
    }
    proposed.push(run);
    return {
      content: JSON.stringify({
        status: "awaiting_confirmation",
        run: run.id,
        note: "The person sees a card with these values and must press Confirm. Do not say it is done.",
        ...(textEdited ? { edited: "Links, numbers or handles that the owner did not write were removed from the text. Tell the owner, and ask for the exact wording if it was needed." } : {}),
      }),
      note: "",
      blocks: [],
      runId: run.id,
    };
  };

  for (let step = 0; step < LIMITS.maxSteps; step++) {
    if (deadline - deps.now() < LIMITS.minStepMs || costMicro > LIMITS.turnCostCapMicro) {
      stop = "cut";
      break;
    }
    emit({ t: "status", text: say(step === 0 ? "thinking" : "working", actor.lang) });
    let r: ChatStepResult;
    try {
      r = await deps.step({ messages, tools: specs, meter: deps.meter, deadlineAt: deadline, allowFree: !tainted, now: deps.now });
    } catch (e) {
      stop = e instanceof AllowanceExhausted ? "allowance" : "error";
      break;
    }
    steps++;
    const calls = r.toolCalls.map((c, i) => ({ ...c, id: `t${userRow.seq}s${step}c${i}` }));
    model = r.model;
    costMicro += microUsd("haiku", r.usage.in, r.usage.out);
    if (!calls.length) {
      finalText = r.text;
      finished = true;
      break;
    }
    // Every call the model made must get a result back, but only a few are honoured in one step.
    messages.push({ role: "assistant", content: r.text || null, tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })) });
    const spoken = advisorOn && r.text ? guardAdviceDetailed(r.text, allowedAdviceText(), say("adviceNumbers", actor.lang)).text : r.text;
    const asst = await appendMessage(thread.id, { role: "assistant", content: cleanAnswer(spoken), toolCalls: calls, meta: { model: r.model } });
    const blocks: ViewBlock[] = [];
    const runIds: string[] = [];
    for (const [i, c] of calls.entries()) {
      const out =
        i < LIMITS.maxToolCallsPerStep
          ? await handleCall(c)
          : err("skipped: too many tool calls in one step; call it again in the next step if it is still needed");
      messages.push({ role: "tool", tool_call_id: c.id, content: out.content });
      await appendMessage(thread.id, { role: "tool", content: out.content, toolCallId: c.id, meta: out.runId ? { runId: out.runId } : { note: out.note } });
      blocks.push(...out.blocks);
      if (out.runId) runIds.push(out.runId);
    }
    const saved = await updateMessage(asst.id, { meta: { model: r.model, ...(blocks.length ? { blocks } : {}), ...(runIds.length ? { runIds } : {}) } });
    const runMapNow = new Map([...runMap, ...proposed.map((p) => [p.id, p] as const)]);
    if (saved.content || blocks.length || runIds.length) emit({ t: "message", message: messageToDto(saved, runMapNow, deps.now())! });
  }

  // The model was still asking for tools when the steps or the time ran out.
  if (!finished && stop === "done") stop = "cut";

  // The closing message.
  if ((stop === "error" || stop === "allowance") && !didWork) {
    return { answered: false, error: stop === "allowance" ? "allowance" : "unavailable", costMicro, steps, tainted };
  }
  // Advice must not name a number that is not in this turn's data, the account data or the owner's own words.
  let guardCut = false;
  if (advisorOn && finalText) {
    const g = guardAdviceDetailed(finalText, allowedAdviceText(), say("adviceNumbers", actor.lang));
    finalText = g.text;
    guardCut = g.cut;
  }
  let text = finalText;
  if (stop === "cut") text = [finalText, say("turnCut", actor.lang)].filter(Boolean).join("\n\n");
  else if (stop === "error" || stop === "allowance") text = say("aiStopped", actor.lang);
  else if (!text) text = say(proposed.some((p) => p.status === "PROPOSED") ? "cardsWaiting" : "noAnswer", actor.lang);
  const closing = await appendMessage(thread.id, { role: "assistant", content: cleanAnswer(text), tainted: readUntrusted, meta: { model, costMicro, ...(guardCut ? { guardCut: true } : {}) } });
  await setTaintedSeq(thread.id, readUntrusted ? closing.seq : 0);
  emit({ t: "message", message: messageToDto(closing, new Map(), deps.now())! });
  if (stop === "error" || stop === "allowance") return { answered: true, error: stop === "allowance" ? "allowance" : "unavailable", costMicro, steps, tainted };
  return { answered: true, costMicro, steps, tainted };
}

/**
 * A shortcut button: the read tools run by themselves and the answer is their tables, with a fixed sentence. No model is called, so
 * no chat turn is taken and nothing is spent.
 */
export async function runQuick(
  input: Omit<TurnInput, "text" | "review" | "autonomy" | "ownerFacts" | "attachments">,
  id: AnyQuickId,
  plan: { tool: string; args: Record<string, unknown> }[],
  deps: Pick<TurnDeps, "tools" | "now">,
): Promise<TurnOutcome> {
  const { actor, thread, emit } = input;
  const q = quickCopy(actor.kind, actor.lang, id);
  const toolMap = indexTools(deps.tools);
  const before = await loadMessages(thread.id, { last: 6 });
  const lastAssistant = [...before].reverse().find((r) => r.role === "assistant");
  let hold = !!lastAssistant && thread.taintedSeq > 0 && lastAssistant.seq === thread.taintedSeq;
  const userRow = await appendMessage(thread.id, { role: "user", content: q.label });
  emit({ t: "message", message: messageToDto(userRow, new Map())! });
  const deadline = deps.now() + LIMITS.deadlineMs;
  const ctx = toolCtx(actor, { threadId: thread.id, attachments: [], review: false, deadline });
  const blocks: ViewBlock[] = [];
  for (const p of plan) {
    const tool = toolMap.get(p.tool);
    if (!tool || isWriteTool(tool)) continue;
    const parsed = tool.schema.safeParse(p.args);
    if (!parsed.success) continue;
    emit({ t: "status", text: tool.label(actor.lang) });
    try {
      const res = await withTimeout(tool.run({ ...ctx, deadline: Math.min(deadline, deps.now() + LIMITS.readTimeoutMs) }, parsed.data), LIMITS.readTimeoutMs);
      if (typeof tool.untrusted === "function" ? tool.untrusted(ctx) : tool.untrusted) hold = true;
      blocks.push(...(res.view ?? []));
    } catch {
      // a lookup that fails leaves its block out; the others still show
    }
  }
  const row = await appendMessage(thread.id, { role: "assistant", content: q.lead, tainted: hold, meta: blocks.length ? { blocks } : undefined });
  // What the shortcut showed (customers' words) or a hold already in force carries to the next turn.
  if (hold) await setTaintedSeq(thread.id, row.seq);
  emit({ t: "message", message: messageToDto(row, new Map(), deps.now())! });
  return { answered: true, costMicro: 0, steps: 0, tainted: false };
}

/** The first line of a thread's title when the person starts with a shortcut. */
export const quickTitle = (kind: ChatKind, lang: Parameters<typeof dict>[0], id: AnyQuickId): string => titleFrom(quickCopy(kind, lang, id).label);

/** The name of a shortcut button and the sentence above its answer: the shop's from the chat dictionary, the desk's from text.ts. */
export function quickCopy(kind: ChatKind, lang: Parameters<typeof dict>[0], id: AnyQuickId): { label: string; lead: string } {
  if (kind === "news") {
    const c = NEWS_QUICK[id];
    return { label: c.label[lang], lead: c.lead[lang] };
  }
  return (dict(lang).chat as unknown as { quick: Record<string, { label: string; lead: string }> }).quick[id];
}

/** For tests. */
export const cleanTextFieldsForTest = cleanTextFields;
