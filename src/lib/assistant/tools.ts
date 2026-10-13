// What the chat may DO. A short whitelist: each tool is one existing, already-validated server action of the app,
// and each runs only after the owner presses "Confirm" on a card that shows the exact values.
//
// What is deliberately NOT here, and cannot be added by a model's output: plans and payments (Wayl), connecting or
// disconnecting accounts, tokens and API keys, files other than the owner's own uploads, deleting anything.
// The model only ever proposes; the arguments are parsed here, strictly, and checked again when they run.

import { z } from "zod";

export const TOOL_NAMES = ["make_picture", "make_video", "post_now", "schedule_post", "set_auto_replies", "set_autopilot", "set_daily_video"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** A file the owner attached in this chat: referred to by a short id ("a1"), never by address. */
const attId = z.string().regex(/^a\d{1,2}$/);
const product = z.string().trim().max(120).optional();
const targets = z.array(z.enum(["FB", "IG"])).min(1).max(2);
const caption = z.string().trim().max(2000).default("");

export const SCHEMAS = {
  make_picture: z.object({
    idea: z.string().trim().min(3).max(400),
    shape: z.enum(["square", "portrait"]).default("square"),
    references: z.array(attId).max(3).default([]),
    product,
  }),
  make_video: z.object({ idea: z.string().trim().min(3).max(300), product }),
  post_now: z.object({ caption, targets, media: attId.optional(), product }),
  schedule_post: z.object({
    caption,
    targets,
    media: attId.optional(),
    product,
    /** Baghdad wall-clock time, YYYY-MM-DDTHH:mm. */
    when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  }),
  set_auto_replies: z.object({ on: z.boolean() }),
  set_autopilot: z.object({ mode: z.enum(["OFF", "DRAFT", "PUBLISH"]), perDay: z.number().int().min(1).max(3).optional() }),
  set_daily_video: z.object({ mode: z.enum(["OFF", "DRAFT", "PUBLISH"]), hour: z.number().int().min(0).max(23).optional() }),
} as const;

export type ToolArgs<T extends ToolName> = z.infer<(typeof SCHEMAS)[T]>;

export interface Proposal {
  tool: ToolName;
  args: Record<string, unknown>;
}

/** What the model is told about the tools. */
export const TOOL_HELP = `Tools (you may propose ONE per answer, in "action": {"tool": "...", "args": {...}}; the owner must confirm it):
- make_picture {idea, shape: "square"|"portrait", references?: ["a1"], product?: "<product name>"}: make an AI picture.
- make_video {idea, product?}: make an AI video ad (takes a few minutes).
- post_now {caption, targets: ["FB","IG"], media?: "a1", product?}: publish a post right now. Instagram needs a picture or video.
- schedule_post {caption, targets, media?, product?, when: "YYYY-MM-DDTHH:mm"}: the same, at that Baghdad time (10 minutes to 60 days ahead; Facebook and Instagram only).
- set_auto_replies {on: true|false}: switch the automatic replies on or off.
- set_autopilot {mode: "OFF"|"DRAFT"|"PUBLISH", perDay?: 1-3}: the automatic posts (DRAFT = prepare only).
- set_daily_video {mode: "OFF"|"DRAFT"|"PUBLISH", hour?: 0-23}: a video made every day.
"a1", "a2"... are the files the owner attached (see "attachments"). Use only those ids; never invent one.`;

/**
 * The proposal a model wrote, or null when it is not one of the tools, has arguments that do not fit, or names a file
 * that was not attached. Unknown extra keys are dropped.
 */
export function parseProposal(raw: unknown, attachmentIds: ReadonlySet<string>): Proposal | null {
  const o = raw as { tool?: unknown; args?: unknown } | null;
  if (!o || typeof o.tool !== "string" || !(TOOL_NAMES as readonly string[]).includes(o.tool)) return null;
  const tool = o.tool as ToolName;
  const parsed = SCHEMAS[tool].safeParse(o.args ?? {});
  if (!parsed.success) return null;
  const args = parsed.data as Record<string, unknown>;
  const refs = [...((args.references as string[] | undefined) ?? []), ...(typeof args.media === "string" ? [args.media] : [])];
  if (refs.some((id) => !attachmentIds.has(id))) return null;
  return { tool, args };
}

/** The values of a proposal as label/value pairs for the confirmation card, in the owner's language. */
export interface FieldLabels {
  idea: string;
  shape: string;
  square: string;
  portrait: string;
  targets: string;
  caption: string;
  media: string;
  references: string;
  product: string;
  shop: string;
  when: string;
  mode: string;
  perDay: string;
  hour: string;
  on: string;
  yes: string;
  no: string;
  modeOff: string;
  modeDraft: string;
  modePublish: string;
  attached: (n: number) => string;
  noMedia: string;
}

export function proposalLines(
  p: Proposal,
  f: FieldLabels,
  /** The names of the attached files by id, and the name of the shop the action is for. */
  ctx: { files?: Record<string, string>; shop?: string } = {},
): { label: string; value: string }[] {
  const fileName = (id: unknown) => (typeof id === "string" ? ctx.files?.[id] ?? id : "");
  const a = p.args as Record<string, unknown>;
  const mode = (m: unknown) => (m === "OFF" ? f.modeOff : m === "DRAFT" ? f.modeDraft : f.modePublish);
  const out: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value) !== "") out.push({ label, value: String(value) });
  };
  switch (p.tool) {
    case "make_picture":
      add(f.idea, a.idea);
      add(f.shape, a.shape === "portrait" ? f.portrait : f.square);
      add(f.product, a.product);
      if (Array.isArray(a.references) && a.references.length) add(f.references, (a.references as string[]).map(fileName).join(", "));
      add(f.shop, ctx.shop);
      break;
    case "make_video":
      add(f.idea, a.idea);
      add(f.product, a.product);
      add(f.shop, ctx.shop);
      break;
    case "post_now":
    case "schedule_post":
      add(f.targets, (a.targets as string[]).map((t) => (t === "FB" ? "Facebook" : "Instagram")).join(" + "));
      add(f.caption, a.caption);
      add(f.media, a.media ? fileName(a.media) : f.noMedia);
      add(f.product, a.product);
      add(f.shop, ctx.shop);
      if (p.tool === "schedule_post") add(f.when, String(a.when).replace("T", " "));
      break;
    case "set_auto_replies":
      add(f.on, a.on ? f.yes : f.no);
      add(f.shop, ctx.shop);
      break;
    case "set_autopilot":
      add(f.mode, mode(a.mode));
      add(f.perDay, a.perDay);
      add(f.shop, ctx.shop);
      break;
    case "set_daily_video":
      add(f.mode, mode(a.mode));
      add(f.hour, a.hour !== undefined ? `${String(a.hour).padStart(2, "0")}:00` : undefined);
      add(f.shop, ctx.shop);
      break;
  }
  return out;
}
