// What the chat may DO. A short whitelist: each tool is one existing, already-validated server action of the app,
// and each runs only after the owner presses "Confirm" on a card that shows the exact values.
//
// What is deliberately NOT here, and cannot be added by a model's output: plans and payments (Wayl), connecting or
// disconnecting accounts, tokens and API keys, files other than the owner's own uploads, deleting anything.
// The model only ever proposes; the arguments are parsed here, strictly, and checked again when they run.

import { z } from "zod";

import { FRAME_SECTIONS } from "@/lib/news/frames-shared";

export const TOOL_NAMES = [
  "make_picture",
  "make_video",
  "post_now",
  "schedule_post",
  "set_auto_replies",
  "set_autopilot",
  "set_daily_video",
  "set_shop_options",
  "add_product",
  "archive_product",
  "set_whatsapp_number",
  // The newsroom's own: frames by section and how the desk's graphics look.
  "design_section_frame",
  "set_design_prompt",
  "set_frame_text",
  "remove_section_frame",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Which tools a kind of workspace may be offered: a shop never gets the newsroom's, and a desk never the shop's. */
export const NEWS_TOOLS = ["design_section_frame", "set_design_prompt", "set_frame_text", "remove_section_frame"] as const satisfies readonly ToolName[];
export const SHOP_TOOLS = TOOL_NAMES.filter((n) => !(NEWS_TOOLS as readonly string[]).includes(n)) as readonly ToolName[];
export type WorkspaceKind = "shop" | "news";
export const toolsOf = (kind: WorkspaceKind): readonly ToolName[] => (kind === "news" ? NEWS_TOOLS : SHOP_TOOLS);

/** A file the owner attached in this chat: referred to by a short id ("a1"), never by address. */
const attId = z.string().regex(/^a\d{1,2}$/);
const product = z.string().trim().max(120).optional();
const targets = z.array(z.enum(["FB", "IG"])).min(1).max(2);
const caption = z.string().trim().max(2000).default("");
/** A section of the news: "breaking" or an id of the source filter (checked again by the action that runs it). */
const section = z.enum(FRAME_SECTIONS as unknown as [string, ...string[]]);
const framePosition = z.enum(["top", "middle", "bottom"]);
/** The language a video is made in and what kind it is (src/lib/advideo/lang.ts has the same two lists; left out, the store's own choice applies). */
const videoLang = z.enum(["ckb", "ar", "en"]);
const videoKind = z.enum(["ad", "story"]);

export const SCHEMAS = {
  make_picture: z.object({
    idea: z.string().trim().min(3).max(400),
    shape: z.enum(["square", "portrait"]).default("square"),
    references: z.array(attId).max(3).default([]),
    product,
  }),
  // A story's idea may be long; an ad's idea is still cut to 300 characters downstream.
  make_video: z.object({ idea: z.string().trim().min(3).max(1200), product, language: videoLang.optional(), kind: videoKind.optional() }),
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
  // Every field is optional, but not all of them: a change of the language or of the hour alone keeps the daily video on or off as it was.
  set_daily_video: z
    .object({ mode: z.enum(["OFF", "DRAFT", "PUBLISH"]).optional(), hour: z.number().int().min(0).max(23).optional(), language: videoLang.optional() })
    .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "nothing to change" }),
  /** The shop's own switches and texts: only the ones present change. */
  set_shop_options: z
    .object({
      likeComments: z.boolean().optional(),
      autoHideSpam: z.boolean().optional(),
      aiReplies: z.boolean().optional(),
      expiryDays: z.number().int().min(1).max(365).optional(),
      defaultDm: z.string().trim().max(1000).optional(),
      deliveryFee: z.string().trim().max(12).regex(/^[0-9٠-٩۰-۹,. ]*$/).optional(),
      deliveryTime: z.string().trim().max(60).optional(),
      aiBrief: z.string().trim().max(1500).optional(),
    })
    .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "nothing to change" }),
  add_product: z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(""),
    /** IQD, digits. */
    price: z.string().trim().min(1).max(12).regex(/^[0-9٠-٩۰-۹,. ]+$/),
    inStock: z.boolean().default(true),
    photos: z.array(attId).max(5).default([]),
  }),
  archive_product: z.object({ product: z.string().trim().min(1).max(120) }),
  set_whatsapp_number: z.object({ number: z.string().trim().min(6).max(20).regex(/^[0-9+٠-٩۰-۹ ()-]+$/) }),
  design_section_frame: z.object({
    section,
    note: z.string().trim().max(400).default(""),
    /** A graphic the desk attached in the chat, to follow. */
    reference: attId.optional(),
    position: framePosition.optional(),
  }),
  set_design_prompt: z.object({ text: z.string().trim().max(1200) }),
  set_frame_text: z.object({ section, position: framePosition }),
  remove_section_frame: z.object({ section }),
} as const;

export type ToolArgs<T extends ToolName> = z.infer<(typeof SCHEMAS)[T]>;

export interface Proposal {
  tool: ToolName;
  args: Record<string, unknown>;
}

/** What the model is told about the tools. */
export const TOOL_HELP = `Tools (you may propose ONE per answer, in "action": {"tool": "...", "args": {...}}; the owner must confirm it):
- make_picture {idea, shape: "square"|"portrait", references?: ["a1"], product?: "<product name>"}: make an AI picture.
- make_video {idea, product?, language?: "ckb"|"ar"|"en", kind?: "ad"|"story"}: make a short AI video (takes a few minutes). The video language is the owner's choice (ckb = Sorani Kurdish, ar = Arabic, en = English); pass language only when the owner explicitly names the video language (the language they write their message or idea in says nothing about it), else the shop's video language is used. kind "story" is a story/content video of about a minute that needs no product; left out, a video of a product you name is an ad, and with no product the page's purpose decides. An ad idea is cut to 300 characters, a story's may be up to 1200.
- post_now {caption, targets: ["FB","IG"], media?: "a1", product?}: publish a post right now. Instagram needs a picture or video.
- schedule_post {caption, targets, media?, product?, when: "YYYY-MM-DDTHH:mm"}: the same, at that Baghdad time (10 minutes to 60 days ahead; Facebook and Instagram only).
- set_auto_replies {on: true|false}: switch the automatic replies on or off.
- set_autopilot {mode: "OFF"|"DRAFT"|"PUBLISH", perDay?: 1-3}: the automatic posts (DRAFT = prepare only).
- set_daily_video {mode?: "OFF"|"DRAFT"|"PUBLISH", hour?: 0-23, language?: "ckb"|"ar"|"en"}: a video made every day, in the shop's video language. Give at least one field; mode left out keeps the daily video as it is (on or off), so a change of only the language or the hour does not switch it. language saves the shop's video language: pass it only when the owner explicitly names it (the language of their message says nothing about it).
- set_shop_options {likeComments?, autoHideSpam?, aiReplies?, expiryDays?: 1-365, defaultDm?, deliveryFee?: "IQD digits", deliveryTime?, aiBrief?}: change the shop's own switches and texts (only those given). aiBrief = what the AI should know about the shop.
- add_product {name, description?, price: "IQD digits", inStock?, photos?: ["a1"]}: add a product with one price.
- archive_product {product: "<exact name>"}: hide a product (it can be added again).
- set_whatsapp_number {number}: the shop's WhatsApp number used in order links.
"a1", "a2"... are the files the owner attached (see "attachments"). Use only those ids; never invent one.`;

/** What the model is told about the newsroom's tools. */
export const NEWS_TOOL_HELP = `Tools (you may propose ONE per answer, in "action": {"tool": "...", "args": {...}}; the desk must confirm it):
- design_section_frame {section, note?, reference?: "a1", position?: "top"|"middle"|"bottom"}: the AI designs that section's card frame from the desk's main frame, the reference graphic the desk attached and the desk's own words about its graphics. section is "breaking" or one of: politics, economy, security, sports, health, tech, society, culture, other. Takes about a minute and uses one of the day's AI frames. Only the desk's own picture files may be a reference.
- set_design_prompt {text}: save, in the desk's own words, how its graphics look (colours, shapes, mood); the AI follows it for every frame. Empty text clears it.
- set_frame_text {section, position: "top"|"middle"|"bottom"}: where the headline goes on that section's own frame (the section must already have its own frame).
- remove_section_frame {section}: that section goes back to the main frame (the frame file stays in storage but is no longer used).
"a1", "a2"... are the files the owner attached (see "attachments"). Use only those ids; never invent one.`;

/**
 * The proposal a model wrote, or null when it is not one of the tools, has arguments that do not fit, or names a file
 * that was not attached. Unknown extra keys are dropped.
 */
export function parseProposal(raw: unknown, attachmentIds: ReadonlySet<string>, kind: WorkspaceKind = "shop"): Proposal | null {
  const o = raw as { tool?: unknown; args?: unknown } | null;
  if (!o || typeof o.tool !== "string" || !(toolsOf(kind) as readonly string[]).includes(o.tool)) return null;
  const tool = o.tool as ToolName;
  const parsed = SCHEMAS[tool].safeParse(o.args ?? {});
  if (!parsed.success) return null;
  const args = parsed.data as Record<string, unknown>;
  const refs = [
    ...((args.references as string[] | undefined) ?? []),
    ...((args.photos as string[] | undefined) ?? []),
    ...(typeof args.media === "string" ? [args.media] : []),
    ...(typeof args.reference === "string" ? [args.reference] : []),
  ];
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
  name: string;
  description: string;
  price: string;
  inStock: string;
  number: string;
  photos: string;
  opts: Record<string, string>;
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
  // The video's own rows: its language and kind (the shop's screens carry them; older callers may not).
  language?: string;
  kind?: string;
  kindAd?: string;
  kindStory?: string;
  /** The names of the video languages by code, in the person's language. */
  languages?: Record<string, string>;
  // The newsroom's tools (the shop's screens do not carry them).
  section?: string;
  note?: string;
  reference?: string;
  designPrompt?: string;
  position?: string;
  top?: string;
  middle?: string;
  bottom?: string;
  breaking?: string;
}

export function proposalLines(
  p: Proposal,
  f: FieldLabels,
  /** The names of the attached files by id, and the name of the shop the action is for. */
  ctx: {
    files?: Record<string, string>;
    shop?: string;
    /** The names of the news sections by id. */
    sections?: Record<string, string>;
    /**
     * make_video: the language and kind the video will really be made in (the caller resolved them with videoChoice, src/app/app/video/choice.ts).
     * Given, the card always shows that language (the model usually leaves it out, so the saved one applies) and a story shows no product.
     */
    video?: { lang: string; kind: string };
  } = {},
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
    case "make_video": {
      const story = ctx.video ? ctx.video.kind === "story" : a.kind === "story";
      add(f.idea, a.idea);
      // A story has no product.
      if (!(ctx.video && story)) add(f.product, a.product);
      // The rows of a screen that has labels for them. The language the video will really use when the caller knows it, else only when the
      // argument is given.
      const language = ctx.video?.lang ?? a.language;
      if (f.language && typeof language === "string") add(f.language, f.languages?.[language] ?? language);
      if (ctx.video) {
        if (f.kind && story) add(f.kind, f.kindStory ?? "story");
      } else if (f.kind && (a.kind === "story" || a.kind === "ad")) add(f.kind, a.kind === "story" ? f.kindStory ?? a.kind : f.kindAd ?? a.kind);
      add(f.shop, ctx.shop);
      break;
    }
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
    case "set_shop_options":
      for (const [k, v] of Object.entries(a)) add(f.opts[k] ?? k, typeof v === "boolean" ? (v ? f.yes : f.no) : v);
      add(f.shop, ctx.shop);
      break;
    case "add_product":
      add(f.name, a.name);
      add(f.description, a.description);
      add(f.price, a.price);
      add(f.inStock, a.inStock === false ? f.no : f.yes);
      if (Array.isArray(a.photos) && a.photos.length) add(f.photos, (a.photos as string[]).map(fileName).join(", "));
      add(f.shop, ctx.shop);
      break;
    case "archive_product":
      add(f.product, a.product);
      add(f.shop, ctx.shop);
      break;
    case "set_whatsapp_number":
      add(f.number, a.number);
      break;
    case "set_daily_video":
      // No mode on the card when it is not changed (the daily video stays as it is).
      if (a.mode !== undefined) add(f.mode, mode(a.mode));
      add(f.hour, a.hour !== undefined ? `${String(a.hour).padStart(2, "0")}:00` : undefined);
      if (f.language && typeof a.language === "string") add(f.language, f.languages?.[a.language] ?? a.language);
      add(f.shop, ctx.shop);
      break;
    case "design_section_frame":
    case "set_frame_text":
    case "remove_section_frame": {
      const where = (id: unknown) => (typeof id === "string" ? ctx.sections?.[id] ?? (id === "breaking" ? f.breaking ?? id : id) : "");
      const pos = (v: unknown) => (v === "top" ? f.top : v === "middle" ? f.middle : v === "bottom" ? f.bottom : "") ?? "";
      add(f.section ?? "", where(a.section));
      if (p.tool === "design_section_frame") {
        add(f.reference ?? "", a.reference ? fileName(a.reference) : undefined);
        add(f.note ?? "", a.note);
      }
      if (p.tool !== "remove_section_frame") add(f.position ?? "", pos(a.position));
      break;
    }
    case "set_design_prompt":
      add(f.designPrompt ?? "", a.text || "—");
      break;
  }
  return out;
}
