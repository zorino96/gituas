// What the chat may DO. A short whitelist: each tool is one existing, already-validated server action of the app,
// and each runs only after the owner presses "Confirm" on a card that shows the exact values.
//
// What is deliberately NOT here, and cannot be added by a model's output: plans and payments (Wayl), connecting or
// disconnecting accounts, tokens and API keys, files other than the owner's own uploads, deleting anything.
// The model only ever proposes; the arguments are parsed here, strictly, and checked again when they run.

import { z } from "zod";

import { storyFictionAsked } from "@/lib/advideo/lang";
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
/** The shape of a video: vertical 9:16 (the default, for Reels) or wide 16:9 (for YouTube; only a story can be wide, an ad is always vertical). */
const videoFormat = z.enum(["vertical", "wide"]);
/** Where the daily video is posted (YouTube needs the owner's two declarations below), and who may watch a YouTube upload. */
const dailyTarget = z.enum(["FB", "IG", "YT"]);
const youtubePrivacy = z.enum(["public", "unlisted", "private"]);

export const SCHEMAS = {
  make_picture: z.object({
    idea: z.string().trim().min(3).max(400),
    shape: z.enum(["square", "portrait"]).default("square"),
    references: z.array(attId).max(3).default([]),
    product,
  }),
  // A story's idea may be long; an ad's idea is still cut to 300 characters downstream. photos: false switches the Wikimedia Commons
  // photographs of a true story off (left out, they are on). review: true asks Gituas to read the page and rewrite a story's idea first
  // (left out, the owner's words go through exactly as typed). Only a true or false is accepted, never a word. format: "wide" makes a story
  // 16:9 for YouTube (left out = vertical 9:16; an ad is always vertical).
  make_video: z.object({
    idea: z.string().trim().min(3).max(1200),
    product,
    language: videoLang.optional(),
    kind: videoKind.optional(),
    photos: z.boolean().optional(),
    review: z.boolean().optional(),
    format: videoFormat.optional(),
  }),
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
  // The daily plan: idea = the owner's own words, VERBATIM (an empty string = no idea of their own, the page's usual choice; at most 600 characters,
  // checked by the card so that nothing is cut in silence), kind/format/review/photos as in make_video (review false = the words go straight to the
  // writer), publishTo = what the daily video is posted to (PUBLISH needs at least one), and the owner's two YouTube declarations, which are never guessed.
  set_daily_video: z
    .object({
      mode: z.enum(["OFF", "DRAFT", "PUBLISH"]).optional(),
      hour: z.number().int().min(0).max(23).optional(),
      language: videoLang.optional(),
      idea: z.string().trim().max(1200).optional(),
      kind: videoKind.optional(),
      format: videoFormat.optional(),
      review: z.boolean().optional(),
      photos: z.boolean().optional(),
      publishTo: z.array(dailyTarget).max(3).optional(),
      youtubePrivacy: youtubePrivacy.optional(),
      youtubeMadeForKids: z.boolean().optional(),
    })
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

/**
 * What every prompt that can propose a video says about a STORY, once per prompt (the classic assistant and the chat each carry it a single
 * time; it names no tool and no argument, so it can sit in the text the model reads about the owner): a story is told from ONE real documented
 * case that Gituas finds or chooses, so the owner is never asked for one. The promises are the ones the pipeline keeps: the article is read
 * when it can be read (else the video card says "told from memory"), the photographs are the free ones that are found, and a case is chosen
 * only when the owner names none.
 */
export const STORY_VIDEO_RULES =
  'A story video (any video language) is told from ONE real, well-documented case: the one the owner names, or, when the owner names none (only a genre, an era or a wish such as "a historical crime mystery"), one that Gituas chooses itself and shows on the video card. NEVER ask the owner to name a case: propose the video right away. The case is retold from its Wikipedia article when that article can be read (when it cannot, the video card says the story was told from memory and the owner must check the facts), with free-licence photographs from Wikimedia Commons where free ones are found, credited in the post and on the last scene (not every part of a story gets a photograph: never promise that). Gituas chooses a case only when the owner names none. The idea is the owner\'s own words, exactly as they said them: never add a country, an era, a year, a genre, a name or any fact they did not say, and keep their wishes about the look. A theme, a topic or a "what happens after / what if" question (for example the world after oil) is a real documentary too: Gituas finds the article on that theme and answers it from the facts, so make it right away; never tell the owner it cannot be done or that it is not a real case, and never offer fiction instead. Fiction only when the owner\'s own words ask for an invented story: then the idea must contain the word fiction; never add that word yourself. A one-off real story is never posted by itself: the owner reads it first. Only the owner\'s daily plan can post a story by itself, and only when the story was told from a read article (a story told from memory, or about a very recent case, waits as a draft).';

/**
 * The arguments of the video tool that a story uses (the tool's own description and the classic assistant's tool list carry them; they are
 * never said to the owner): the review switch, the photographs switch and the shape.
 */
export const STORY_VIDEO_ARGS =
  'review: true only when the owner asks Gituas to improve or rewrite the idea first (it then reads the page and its earlier videos); false when the owner says to use their words as they are; left out, the owner\'s own "review my idea" switch in the chat decides (switched off: the words go straight to the video maker exactly as written). photos: false removes the photographs. format: "vertical" (the default, 9:16, for Reels) or "wide" (16:9, for YouTube): pass "wide" whenever the owner mentions YouTube, 16:9, wide, landscape, horizontal, a documentary or a TV channel such as National Geographic; only a story can be wide, an ad is always vertical. Length: a story is about 60 to 70 seconds; if the idea asks for a short video Gituas aims for about 30 seconds but cannot promise it.';

/**
 * The one rule about what the model says after a video request (the classic assistant and the chat carry it once each). Born from a real chat:
 * the owner asked for a 16:9 video for YouTube like one he attached, and was told "this time 16:9" while a vertical video with an added country
 * was made, with the attachment ignored in silence. The tool's result is the only truth about what was made.
 */
export const VIDEO_HONESTY_RULE =
  'AFTER A VIDEO REQUEST SAY ONLY WHAT THE TOOL RESULT SAYS. Never claim a shape, a length, a language, a platform or the use of an attachment that the result did not confirm. Whatever the owner asked that Gituas cannot do (learn from a video they attached, a video of several minutes, an exact length, a shape other than vertical or wide) you say in your FIRST lines, in plain words, before or instead of anything else; never pretend. Length: an ad is about 35 seconds and a story about 60 to 70 seconds; when the idea of a story asks for a short video Gituas aims for about 30 seconds but cannot promise it. A story can be made wide (16:9, for YouTube); an ad is always vertical: when the owner wants an ad for YouTube, say so first and offer a vertical ad or a wide story, and never swap one for the other without telling them. YouTube: one AI video made now is not uploaded to YouTube from here (the owner downloads it and adds it in Publish or in YouTube Studio); the DAILY video can post to YouTube by itself once the owner has said who may watch and whether the videos are made for kids (never choose those two for them: ask one short question for both); YouTube keeps every upload Private until Google finishes reviewing Gituas, whatever the owner chooses. Never add a word to the owner\'s idea (a country, an era, a genre, a name): use exactly their words. Never write a tool name or an option name to the owner.';

/**
 * What the model does when the owner asks for a video to be made every day ("every day make me a video in this style and publish it"): one standing
 * plan of the owner's own, saved in one call, act-first, with the single question YouTube needs. The classic assistant and the chat carry it once each.
 */
export const DAILY_VIDEO_RULE =
  'THE OWNER\'S DAILY VIDEO PLAN: when the owner says something like "every day make me a video in this style (and publish it)", that is a standing plan of their own: call set_daily_video ONCE with idea = their prompt copied word for word (never rewritten, shortened or extended), kind (story when their idea is a story for a content channel), publishTo = the platforms they named (Facebook, Instagram, YouTube; when they want it posted and named none: every connected Facebook Page and Instagram account), and mode PUBLISH when they want it posted by itself or DRAFT when they only want it made. Decide everything else yourself and say it in one short line: no questions. The one question you may ask is for YouTube, when it is wanted and the owner has not yet said who may watch (everyone, only people with the link, or only them) and whether the videos are made for kids: ask both in ONE short question and never answer them for the owner. A general idea (a genre or a wish, no case named) gets a different real case every day; a story told from memory or about a very recent case is never posted by itself, it waits as a draft; YouTube keeps every upload Private until Google finishes reviewing Gituas. After the owner confirms, say plainly what runs every day and where it goes.';

/** What the model is told about the tools. */
export const TOOL_HELP = `Tools (you may propose ONE per answer, in "action": {"tool": "...", "args": {...}}; the owner must confirm it):
- make_picture {idea, shape: "square"|"portrait", references?: ["a1"], product?: "<product name>"}: make an AI picture.
- make_video {idea, product?, language?: "ckb"|"ar"|"en", kind?: "ad"|"story", photos?: boolean, review?: boolean, format?: "vertical"|"wide"}: make a short AI video (takes a few minutes). The video language is the owner's choice (ckb = Sorani Kurdish, ar = Arabic, en = English); pass language only when the owner explicitly names the video language (the language they write their message or idea in says nothing about it), else the shop's video language is used. kind "story" is a story/content video of about a minute that needs no product; left out, a video of a product you name is an ad, and with no product the page's purpose decides. An ad idea is cut to 300 characters, a story's may be up to 1200. ${STORY_VIDEO_ARGS}
- post_now {caption, targets: ["FB","IG"], media?: "a1", product?}: publish a post right now. Instagram needs a picture or video.
- schedule_post {caption, targets, media?, product?, when: "YYYY-MM-DDTHH:mm"}: the same, at that Baghdad time (10 minutes to 60 days ahead; Facebook and Instagram only).
- set_auto_replies {on: true|false}: switch the automatic replies on or off.
- set_autopilot {mode: "OFF"|"DRAFT"|"PUBLISH", perDay?: 1-3}: the automatic posts (DRAFT = prepare only).
- set_daily_video {mode?: "OFF"|"DRAFT"|"PUBLISH", hour?: 0-23, language?: "ckb"|"ar"|"en", idea?: "<the owner's words, verbatim>", kind?: "ad"|"story", format?: "vertical"|"wide", review?: boolean, photos?: boolean, publishTo?: ["FB"|"IG"|"YT"], youtubePrivacy?: "public"|"unlisted"|"private", youtubeMadeForKids?: boolean}: a video made every day, in the shop's video language, from the owner's own plan. Give at least one field; mode left out keeps the daily video as it is (on or off), so a change of only the language or the hour does not switch it. language saves the shop's video language: pass it only when the owner explicitly names it (the language of their message says nothing about it). idea is the owner's own prompt, copied word for word (at most 600 characters), made again every day: with no case named in it, a different real case is chosen each day. PUBLISH posts every day's video to publishTo by itself (the platforms the owner named; with none named, every connected Facebook Page and Instagram account); DRAFT only makes it and keeps it for the owner to read. YouTube (YT) needs youtubePrivacy and youtubeMadeForKids, which are the owner's own declarations: when YT is wanted and the owner has not said them, ask ONE short question for both; everything else is decided without asking.
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
    // add_product's photos are attached files; make_video's photos is a true or false (the Wikimedia Commons switch), not a list of files.
    ...(Array.isArray(args.photos) ? (args.photos as string[]) : []),
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
  /** A true story's card: the line that says its photographs come from Wikimedia Commons (or that it has none), and that Gituas reviews the idea first. */
  storyPhotos?: string;
  storyNoPhotos?: string;
  /** Where a story's photographs come from, as the person's language writes it ("Wikimedia Commons"; Sorani letters in Sorani). */
  storyPhotosFrom?: string;
  review?: string;
  /** A story's shape: the row's label and its two values (vertical 9:16 for Reels, wide 16:9 for YouTube). */
  format?: string;
  formatVertical?: string;
  formatWide?: string;
  /** The make_video story card's length row, and the YouTube row. */
  length?: string;
  youtube?: string;
  /** The daily video's plan: whether the owner's words go through exactly or Gituas reads the page first, where it is posted, the idea when it is empty, and the two YouTube declarations. */
  words?: string;
  wordsExact?: string;
  wordsReviewed?: string;
  postTo?: string;
  postToNone?: string;
  ideaUsual?: string;
  ytWho?: string;
  ytWhoOptions?: Record<string, string>;
  ytKids?: string;
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
     * make_video: the language, kind and shape the video will really be made in (the caller resolved them with videoChoice, src/app/app/video/choice.ts).
     * Given, the card always shows that language (the model usually leaves it out, so the saved one applies) and a story shows no product and its
     * shape ("wide" only for a story; anything else is vertical).
     */
    video?: { lang: string; kind: string; format?: string };
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
      // The rows of a screen that has labels for them. The language the video will really use when the caller knows it, else only when the
      // argument is given.
      const language = ctx.video?.lang ?? a.language;
      // A story, in any language, is told from a real documented case (or invented when the idea says fiction).
      const realStory = story && !storyFictionAsked(typeof a.idea === "string" ? a.idea : "");
      add(f.idea, a.idea);
      // A story has no product.
      if (!(ctx.video && story)) add(f.product, a.product);
      if (f.language && typeof language === "string") add(f.language, f.languages?.[language] ?? language);
      if (ctx.video) {
        if (f.kind && story) add(f.kind, f.kindStory ?? "story");
      } else if (f.kind && (a.kind === "story" || a.kind === "ad")) add(f.kind, a.kind === "story" ? f.kindStory ?? a.kind : f.kindAd ?? a.kind);
      // A story states its shape (an ad is always vertical and says nothing): wide 16:9 for YouTube only when it was asked, else vertical 9:16.
      if (story && f.format) add(f.format, (ctx.video ? ctx.video.format : a.format) === "wide" ? f.formatWide : f.formatVertical);
      // A true story's photographs come from Wikimedia Commons, unless the owner switched them off (then the card says so).
      if (realStory && f.storyPhotos) add(f.storyPhotos, a.photos === false ? f.storyNoPhotos ?? f.no : f.storyPhotosFrom ?? "Wikimedia Commons");
      // Gituas rewrites a story's idea first only when the owner asked for it; otherwise the words go through as typed.
      if (story && a.review === true && f.review) add(f.review, f.yes);
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
    case "set_daily_video": {
      // No mode on the card when it is not changed (the daily video stays as it is).
      if (a.mode !== undefined) add(f.mode, mode(a.mode));
      add(f.hour, a.hour !== undefined ? `${String(a.hour).padStart(2, "0")}:00` : undefined);
      if (f.language && typeof a.language === "string") add(f.language, f.languages?.[a.language] ?? a.language);
      // The daily plan, in the owner's own words: the idea exactly as they said it (an empty one says there is none), what kind of video, its shape
      // (a story only), whether the words go through exactly or Gituas reads the page first, the photographs, where it is posted, and the
      // two YouTube declarations. Only what the call carries (the card of the chat completes it with what the plan already holds).
      if (typeof a.idea === "string") add(f.idea, a.idea.trim() ? a.idea : f.ideaUsual);
      const story = a.kind === "story";
      if (f.kind && (a.kind === "story" || a.kind === "ad")) add(f.kind, story ? f.kindStory ?? "story" : f.kindAd ?? "ad");
      if (story && f.format && (a.format === "wide" || a.format === "vertical")) add(f.format, a.format === "wide" ? f.formatWide : f.formatVertical);
      if (f.words && typeof a.review === "boolean") add(f.words, a.review ? f.wordsReviewed : f.wordsExact);
      if (story && f.storyPhotos && typeof a.photos === "boolean") add(f.storyPhotos, a.photos ? f.storyPhotosFrom ?? "Wikimedia Commons" : f.storyNoPhotos ?? f.no);
      const wheres = Array.isArray(a.publishTo) ? (a.publishTo as unknown[]).filter((t): t is "FB" | "IG" | "YT" => t === "FB" || t === "IG" || t === "YT") : null;
      if (wheres && f.postTo) add(f.postTo, wheres.length ? wheres.map((t) => (t === "FB" ? "Facebook" : t === "IG" ? "Instagram" : "YouTube")).join(" + ") : f.postToNone);
      if (wheres?.includes("YT")) {
        if (f.ytWho && typeof a.youtubePrivacy === "string") add(f.ytWho, f.ytWhoOptions?.[a.youtubePrivacy] ?? a.youtubePrivacy);
        if (f.ytKids && typeof a.youtubeMadeForKids === "boolean") add(f.ytKids, a.youtubeMadeForKids ? f.yes : f.no);
      }
      add(f.shop, ctx.shop);
      break;
    }
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
