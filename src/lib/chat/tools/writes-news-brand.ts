// The news desk's video, voice, brand and library tools, and its four frame tools. Same rules as the other news write tools: the
// card reads the live record and shows the real result, the run reads it again and writes the whole record back, so a call that sets
// one field never blanks another (the video settings and the brand kit REPLACE a whole record).
//
// Not here, and never to be added by a model's output: recording or deleting the desk's own voice (it needs the speaker's consent),
// deleting library photos or clips, designing the main frame (sections only), and anything about plans, payments, team or accounts.

import { z } from "zod";

import { addNewsPhotoAction, saveBrandKitAction, saveVideoSettingsAction, saveVoiceNoteAction } from "@/app/newsroom/(desk)/news/actions";
import { frameDesignOf, runDeskTool } from "@/app/newsroom/run-desk-tool";
import { imageEnabled } from "@/lib/ai/image";
import { slotsUsed } from "@/lib/ai/slots";
import { SCHEMAS, type ToolName } from "@/lib/assistant/tools";
import { videoQuotaFor } from "@/lib/billing/plans";
import { isFrameText, isLogoCorner } from "@/lib/cards/brand";
import type { CardLine, ToolCtx, WriteTool } from "@/lib/chat/types";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { FRAME_AI_CAPS, FRAME_AI_SLOTS } from "@/lib/news/ai-budget";
import { CLIP_LABEL_MAX, cleanClipLabel } from "@/lib/news/clips";
import { cleanFocusPrompt, FOCUS_PROMPT_MAX } from "@/lib/news/focus-shared";
import { PHOTO_LIBRARY_MAX, isOwnPhoto } from "@/lib/news/photos";
import { normalizeChoice } from "@/lib/news/taxonomy";
import { cleanDailyMax, isVideoMode, VIDEO_DAILY_MAX, VIDEO_STYLES } from "@/lib/news/video";
import { cleanVoiceNote, VOICE_NOTE_MAX } from "@/lib/news/voice";
import { loadVoiceClone } from "@/lib/voice/clone";
import { CUSTOM_VOICE, deskVoice, cleanSpeed, PAWAN_VOICES, SPEECH_SPEED, VOICE_NAMES } from "@/lib/voice/voices";
import { planOf } from "./news-common";
import { attachmentsOf, clip, refuse } from "./writes-common";
import { attId, defineNews, quotaOf, yesNo } from "./writes-news-common";
import { CATEGORY_CODES } from "./writes-news-settings";
import { NW } from "./writes-news-words";
import { NEW } from "./writes-words";

const line = (label: string, value: string): CardLine => ({ label, value });
const some = (o: object) => Object.values(o).some((v) => v !== undefined);
const shown = (ctx: ToolCtx, now: string, was: string, changed: boolean): string => (changed ? NEW.was[ctx.lang](now || NW.empty[ctx.lang], was || NW.empty[ctx.lang]) : now || NW.empty[ctx.lang]);
const settingsOf = (tenantId: string) => db.newsSettings.findUnique({ where: { tenantId } });

// ---------------------------------------------------------------------------------------------------------------------
// Automatic video

const VOICES = [...PAWAN_VOICES, CUSTOM_VOICE] as [string, ...string[]];
const topic = z.enum(CATEGORY_CODES);

const VIDEO = z
  .object({
    mode: z.enum(["OFF", "AUTO"]).optional().describe("AUTO = the stories the autopilot posts also become videos"),
    style: z.enum(["TEMPLATE", "HIGHLIGHT"]).optional().describe("TEMPLATE = the desk's design video; HIGHLIGHT = built from the desk's own footage library when it has some"),
    topics: z.array(topic).max(CATEGORY_CODES.length).optional().describe("Which topics become videos, for example [\"politics\", \"sports/football\"]; an empty list = every story the autopilot posts"),
    dailyMax: z.number().int().min(VIDEO_DAILY_MAX.min).max(VIDEO_DAILY_MAX.max).optional().describe("Most videos per day"),
    voice: z.enum(VOICES).optional().describe("A narrator voice (male, female, aram, rebin, ...) or \"custom\" (the desk's own recorded voice, Enterprise only)"),
    speed: z.number().min(SPEECH_SPEED.min).max(SPEECH_SPEED.max).optional().describe("Reading speed, 0.8 to 1.3"),
    prompt: z.string().trim().max(FOCUS_PROMPT_MAX).optional().describe("Enterprise only: which stories become videos, in the desk's words; an empty string clears it"),
  })
  .refine(some, { message: "nothing to change" });

async function planVideo(ctx: ToolCtx, args: z.output<typeof VIDEO>) {
  const [s, plan] = await Promise.all([settingsOf(ctx.tenantId), planOf(ctx.tenantId)]);
  if (videoQuotaFor(plan) < 1) return refuse(`Automatic video is part of the Pro and Enterprise plans; this desk is on ${plan}.`);
  const savedStyle = s?.videoStyle ?? "";
  const was = {
    mode: isVideoMode(s?.videoMode) ? s.videoMode : ("OFF" as const),
    style: ((VIDEO_STYLES as readonly string[]).includes(savedStyle) ? savedStyle : "TEMPLATE") as (typeof VIDEO_STYLES)[number],
    topics: normalizeChoice(s?.videoTopics ?? []),
    dailyMax: cleanDailyMax(s?.videoDailyMax),
    voice: deskVoice(s?.videoVoice, plan),
    speed: cleanSpeed(s?.videoSpeed),
    prompt: plan === "ENTERPRISE" ? (s?.videoPrompt ?? "") : "",
  };
  if (args.prompt !== undefined && plan !== "ENTERPRISE") return refuse(`The video prompt is part of the Enterprise plan; this desk is on ${plan}.`);
  const after = {
    mode: args.mode ?? was.mode,
    style: args.style ?? was.style,
    topics: args.topics ? normalizeChoice(args.topics) : was.topics,
    dailyMax: args.dailyMax ?? was.dailyMax,
    voice: args.voice ?? was.voice,
    speed: args.speed !== undefined ? cleanSpeed(args.speed) : was.speed,
    prompt: args.prompt !== undefined ? (cleanFocusPrompt(args.prompt) ?? "") : was.prompt,
  };
  // The desk's own voice only once its recording is saved (Enterprise); the action would quietly fall back to a stock voice otherwise.
  if (after.voice === CUSTOM_VOICE) {
    if (plan !== "ENTERPRISE") return refuse(`The desk's own voice is part of the Enterprise plan; this desk is on ${plan}.`);
    if (!(await loadVoiceClone(ctx.tenantId))) return refuse("The desk has not saved a recording of its own voice yet. The person records it in Brand & photos; you cannot do that for them.");
  }
  const changed = {
    mode: after.mode !== was.mode,
    style: after.style !== was.style,
    topics: JSON.stringify([...after.topics].sort()) !== JSON.stringify([...was.topics].sort()),
    dailyMax: after.dailyMax !== was.dailyMax,
    voice: after.voice !== was.voice,
    speed: after.speed !== was.speed,
    prompt: after.prompt !== was.prompt,
  };
  if (!Object.values(changed).some(Boolean)) return refuse("Nothing would change: the video settings already have these values.");
  return { was, after, changed, plan };
}

const setNewsVideoSettings = defineNews({
  name: "set_news_video_settings",
  description:
    "Change the desk's automatic video settings (only on plans with a video quota). Only the fields you give change; the rest stay exactly as they are. mode: OFF or AUTO (the stories the autopilot posts also become 9:16 videos). " +
    "style: TEMPLATE or HIGHLIGHT. topics: which topics become videos (empty = all). dailyMax, voice (a narrator name, or \"custom\" for Enterprise desks with a saved recording), speed (0.8 to 1.3), prompt (Enterprise). " +
    "Each automatic video uses one of the plan's monthly videos.",
  schema: VIDEO,
  permission: "configure",
  risk: "standing",
  // A video made for every story the autopilot posts costs the plan's videos every day, unwatched; only switching it off is small.
  riskFor: (args) => (args.mode === "OFF" ? "low" : "standing"),
  label: (lang) => NW.label.setting[lang],
  async card(ctx, args) {
    const { was, after, changed } = await planVideo(ctx, args);
    const t = dict(ctx.lang);
    const n = t.settings.news;
    const topicNames = (xs: string[]) => xs.map((c) => (c.includes("/") ? c.split("/").join(" · ") : ((t.nr.news.topics as Record<string, string>)[c] ?? c))).join(t.fmt.listSep) || NW.allStories[ctx.lang];
    const voiceName = (v: string) => (v === CUSTOM_VOICE ? n.cloneVoiceName : (VOICE_NAMES as Record<string, { ku: string; en: string }>)[v]?.[ctx.lang === "en" ? "en" : "ku"] ?? v);
    const quota = await quotaOf(ctx.tenantId, "video");
    const lines = [
      line(n.videoSec, shown(ctx, n.videoMode[after.mode], n.videoMode[was.mode], changed.mode)),
      line(NW.f.style[ctx.lang], shown(ctx, n.videoStyle[after.style], n.videoStyle[was.style], changed.style)),
      line(NW.f.topics[ctx.lang], shown(ctx, topicNames(after.topics), topicNames(was.topics), changed.topics)),
      line(n.videoDailyMax, shown(ctx, String(after.dailyMax), String(was.dailyMax), changed.dailyMax)),
      line(n.videoVoice, shown(ctx, voiceName(after.voice), voiceName(was.voice), changed.voice)),
      line(NW.f.speed[ctx.lang], shown(ctx, `${after.speed}×`, `${was.speed}×`, changed.speed)),
    ];
    if (after.prompt || changed.prompt) lines.push(line(n.videoPrompt, shown(ctx, after.prompt, was.prompt, changed.prompt)));
    lines.push(line(NW.f.videosLeft[ctx.lang], `${Math.max(0, quota.limit - quota.used)} / ${quota.limit}`));
    return { title: NW.title.videoSettings[ctx.lang], lines };
  },
  async execute(ctx, args) {
    const { after } = await planVideo(ctx, args);
    const r = await saveVideoSettingsAction({ mode: after.mode, style: after.style, topics: after.topics, dailyMax: after.dailyMax, voice: after.voice, speed: after.speed, prompt: after.prompt });
    return r.ok ? { ok: true, text: NW.done.videoSettings[ctx.lang] } : { ok: false, text: r.error };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// The writing style

const setVoiceNote = defineNews({
  name: "set_voice_note",
  description:
    `Set the desk's own writing-style note, added to the instructions of EVERY draft the AI writes from now on (at most ${VOICE_NOTE_MAX} characters, one line; for example "short sentences, no foreign words, strong headlines"). ` +
    "An empty text clears it. It never overrides the facts-only rules. It changes every later draft, so it waits for the person's Confirm.",
  schema: z.object({ text: z.string().trim().max(VOICE_NOTE_MAX) }),
  permission: "configure",
  risk: "public",
  label: (lang) => NW.label.setting[lang],
  async card(ctx, args) {
    const { was, after } = await planVoiceNote(ctx, args.text);
    return { title: NW.title.voiceNote[ctx.lang], lines: [line(dict(ctx.lang).settings.news.voiceSec, shown(ctx, after, was, true))] };
  },
  async execute(ctx, args) {
    const { after } = await planVoiceNote(ctx, args.text);
    const r = await saveVoiceNoteAction(args.text);
    return r.ok ? { ok: true, text: (after ? NW.done.voiceNote : NW.done.voiceNoteCleared)[ctx.lang] } : { ok: false, text: r.error };
  },
});

async function planVoiceNote(ctx: ToolCtx, text: string) {
  const s = await settingsOf(ctx.tenantId);
  const was = cleanVoiceNote(s?.voiceNote) ?? "";
  const after = cleanVoiceNote(text) ?? "";
  if (was === after) return refuse("Nothing would change: the writing-style note already says this.");
  return { was, after };
}

// ---------------------------------------------------------------------------------------------------------------------
// The card look

const HEX = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "a colour such as #0B2545");

const BRAND = z
  .object({
    primary: HEX.optional().describe("Background colour of the cards and the video"),
    accent: HEX.optional().describe("Lines and small labels"),
    text: HEX.optional().describe("Colour of the headline text"),
    headingFont: z.enum(["kufi", "sans"]).optional(),
    frameText: z.enum(["top", "middle", "bottom"]).optional().describe("Where the headline goes on the main frame"),
    logoCorner: z.enum(["off", "right", "left"]).optional().describe("Draw the desk's logo in a corner of framed cards; the logo must already be uploaded"),
  })
  .refine(some, { message: "nothing to change" });

type BrandKey = "primary" | "accent" | "text" | "headingFont" | "frameText" | "logoCorner";
const BRAND_KEYS: BrandKey[] = ["primary", "accent", "text", "headingFont", "frameText", "logoCorner"];

/** The brand kit as it is now merged with what was asked: the logo and the frame (files) are passed back exactly as they are. */
async function planBrand(ctx: ToolCtx, args: z.output<typeof BRAND>) {
  const kit = await db.brandKit.findUnique({ where: { tenantId: ctx.tenantId } });
  const was: Record<BrandKey, string> = {
    primary: kit?.primary ?? "#0B2545",
    accent: kit?.accent ?? "#E0A526",
    text: kit?.text ?? "#FFFFFF",
    headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
    frameText: isFrameText(kit?.frameText) ? kit.frameText : "bottom",
    logoCorner: isLogoCorner(kit?.logoCorner) ? kit.logoCorner : "off",
  };
  const after: Record<BrandKey, string> = { ...was };
  for (const k of BRAND_KEYS) if (args[k] !== undefined) after[k] = args[k]!;
  const changed = BRAND_KEYS.filter((k) => after[k].toLowerCase() !== was[k].toLowerCase());
  if (!changed.length) return refuse("Nothing would change: the card look already has these values.");
  if (after.logoCorner !== "off" && !kit?.logoPath) return refuse("The desk has no logo uploaded yet, so it cannot be drawn in a corner. The person uploads it in Brand & photos.");
  return { kit, was, after, changed };
}

const setBrandLook = defineNews({
  name: "set_brand_look",
  description:
    "Change how the desk's news cards and videos look: primary (background colour), accent, text (headline colour), each as #RRGGBB; headingFont: kufi or sans; frameText: top, middle or bottom (where the headline goes on the main frame); " +
    "logoCorner: off, right or left. Only the fields you give change; the logo and the frame files stay exactly as they are. It changes every later card, also the autopilot's, so it waits for the person's Confirm.",
  schema: BRAND,
  permission: "configure",
  risk: "public",
  label: (lang) => NW.label.setting[lang],
  async card(ctx, args) {
    const { was, after, changed } = await planBrand(ctx, args);
    const n = dict(ctx.lang).settings.news;
    const label: Record<BrandKey, string> = {
      primary: NW.f.primaryColour[ctx.lang],
      accent: NW.f.accentColour[ctx.lang],
      text: NW.f.textColour[ctx.lang],
      headingFont: n.bdFont,
      frameText: n.frameTextLabel,
      logoCorner: n.bdFrameLogo,
    };
    const value = (k: BrandKey, v: string): string =>
      k === "headingFont" ? (v === "sans" ? n.fontSans : n.fontKufi) : k === "frameText" ? ((n.frameText as Record<string, string>)[v] ?? v) : k === "logoCorner" ? (v === "right" ? n.bdLogoRight : v === "left" ? n.bdLogoLeft : n.bdLogoOff) : v.toUpperCase();
    return { title: NW.title.brand[ctx.lang], lines: changed.map((k) => line(label[k], shown(ctx, value(k, after[k]), value(k, was[k]), true))) };
  },
  async execute(ctx, args) {
    const { kit, after } = await planBrand(ctx, args);
    const r = await saveBrandKitAction({
      logoPath: kit?.logoPath ?? null,
      primary: after.primary,
      accent: after.accent,
      text: after.text,
      headingFont: after.headingFont as "kufi" | "sans",
      framePath: kit?.framePath ?? null,
      frameText: after.frameText,
      logoCorner: after.logoCorner,
    });
    return r.ok ? { ok: true, text: NW.done.brand[ctx.lang] } : { ok: false, text: r.error };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// The photo library

const addLibraryPhoto = defineNews({
  name: "add_library_photo",
  description:
    "Add a picture the person attached to the desk's photo library, which the AI uses as card backgrounds. attachment: the id of an attached picture (JPG, PNG or WebP), for example \"a1\". " +
    `label: what the photo shows, in the person's words (at most ${CLIP_LABEL_MAX} characters). general: true for a photo that fits any story (a studio, a skyline). Only the person's own photos belong here.`,
  schema: z.object({ attachment: attId, label: z.string().trim().min(1).max(CLIP_LABEL_MAX), general: z.boolean().default(false) }),
  permission: "configure",
  risk: "low",
  label: (lang) => NW.label.photo[lang],
  async card(ctx, args) {
    const plan = await photoPlan(ctx, args);
    return {
      title: NW.title.photo[ctx.lang],
      lines: [line(NW.f.file[ctx.lang], plan.name), line(NW.f.label[ctx.lang], plan.label), line(NW.f.general[ctx.lang], yesNo(ctx, args.general)), line(NW.f.photos[ctx.lang], `${plan.count + 1} / ${PHOTO_LIBRARY_MAX}`)],
    };
  },
  async execute(ctx, args) {
    const plan = await photoPlan(ctx, args);
    const r = await addNewsPhotoAction({ pathname: plan.file.pathname, url: plan.file.url, label: plan.label, general: args.general });
    return r.ok ? { ok: true, text: NW.done.photo[ctx.lang] } : { ok: false, text: r.error };
  },
});

async function photoPlan(ctx: ToolCtx, args: { attachment: string; label: string }) {
  const file = attachmentsOf(ctx).find((f) => f.id === args.attachment);
  if (!file) return refuse(`"${args.attachment}" is not one of the files attached in this chat. Use an id from the attachment list; never invent one.`);
  if (file.kind !== "image" || !isOwnPhoto(ctx.tenantId, file.pathname)) return refuse(`"${args.attachment}" is not a JPG, PNG or WebP picture the desk uploaded here.`);
  const label = cleanClipLabel(args.label);
  if (!label) return refuse(`Say what the photo shows, in at most ${CLIP_LABEL_MAX} characters.`);
  const count = await db.newsPhoto.count({ where: { tenantId: ctx.tenantId } });
  if (count >= PHOTO_LIBRARY_MAX) return refuse(`The photo library is full (${PHOTO_LIBRARY_MAX} photos at most). The person removes old ones in Brand & photos.`);
  return { file, label, count, name: clip(file.name || file.id, 60) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Frames by section. Same names and arguments as the classic assistant's (SCHEMAS of src/lib/assistant/tools.ts), run through the
// same function (src/app/newsroom/run-desk-tool.ts). The main frame is not designed from the chat: sections only.

/** A section's name for a card: the news topic, or "Breaking news". */
const sectionName = (ctx: ToolCtx, id: string): string => {
  const t = dict(ctx.lang);
  return id === "breaking" ? t.assistant.news.fields.breaking : ((t.nr.news.topics as Record<string, string>)[id] ?? id);
};
const frameTitle = (ctx: ToolCtx, tool: ToolName): string => (dict(ctx.lang).assistant.news.tools as Record<string, string>)[tool] ?? tool;
const positionName = (ctx: ToolCtx, p: string): string => (dict(ctx.lang).assistant.news.fields as Record<string, string>)[p] ?? p;

async function runFrame(ctx: ToolCtx, tool: ToolName, args: object) {
  const r = await runDeskTool(ctx.tenantId, tool, args as Record<string, unknown>, attachmentsOf(ctx), dict(ctx.lang));
  return r.ok ? { ok: true as const, text: r.text } : { ok: false as const, text: r.error };
}

const designSectionFrame = defineNews({
  name: "design_section_frame",
  description:
    "Have the AI design the card frame of one news section (or of breaking news) from the desk's main frame, a reference graphic the person attached and the desk's own words about its graphics. " +
    "section: breaking, politics, economy, security, sports, health, tech, society, culture or other. note: a hint (optional). reference: the id of an attached picture to follow, for example \"a1\". position: top, middle or bottom, where the headline goes. " +
    "What you leave out is kept from the section's earlier design. It uses one of the desk's few AI frames a day and takes about a minute: run it on its own, never together with another tool. The main frame is not designed from the chat.",
  schema: SCHEMAS.design_section_frame,
  permission: "configure",
  risk: "money",
  long: true,
  label: (lang) => NW.label.frame[lang],
  async card(ctx, args) {
    if (!imageEnabled()) return refuse("Designing frames with the AI is not available on this server right now.");
    const design = await frameDesignOf(ctx.tenantId, args, attachmentsOf(ctx), dict(ctx.lang));
    if (!design.ok) return refuse(design.error);
    const used = await slotsUsed(ctx.tenantId, FRAME_AI_SLOTS);
    if (used.day >= FRAME_AI_CAPS.day) return refuse(`The desk has designed ${FRAME_AI_CAPS.day} frames today already (the most a day). Try again tomorrow.`);
    if (used.month >= FRAME_AI_CAPS.month) return refuse(`The desk has designed ${FRAME_AI_CAPS.month} frames this month already (the most a month).`);
    const f = dict(ctx.lang).assistant.news.fields;
    const files = Object.fromEntries(attachmentsOf(ctx).map((x) => [x.id, clip(x.name, 40) || x.kind]));
    const reference = typeof args.reference === "string" ? (files[args.reference] ?? args.reference) : design.referencePath ? NW.keptReference[ctx.lang] : "";
    const lines = [line(f.section, sectionName(ctx, design.section))];
    if (reference) lines.push(line(f.reference, reference));
    if (design.note) lines.push(line(f.note, design.noteKept ? NW.kept[ctx.lang](design.note) : design.note));
    lines.push(line(f.position, positionName(ctx, design.frameText)));
    lines.push(line(NW.f.framesLeft[ctx.lang], `${FRAME_AI_CAPS.day - used.day} / ${FRAME_AI_CAPS.day}`));
    return { title: frameTitle(ctx, "design_section_frame"), lines };
  },
  execute: (ctx, args) => runFrame(ctx, "design_section_frame", args),
});

const setDesignPrompt = defineNews({
  name: "set_design_prompt",
  description:
    "Save, in the desk's own words, how its graphics look (colours, shapes, mood); the AI follows it for every frame it designs from now on. An empty text clears it. At most 1200 characters. " +
    "It REPLACES the whole text. To add to it or change a part, first call get_desk_settings with area brand: designPromptParts is the complete current text in parts (join them with a space; the DESK NOW snapshot shows only its first 300 characters), then send the complete new text. " +
    "The card shows the whole earlier text next to the new one.",
  schema: SCHEMAS.set_design_prompt,
  permission: "configure",
  risk: "low",
  label: (lang) => NW.label.frame[lang],
  async card(ctx, args) {
    const s = await settingsOf(ctx.tenantId);
    const was = (s?.designPrompt ?? "").trim();
    if (was === args.text.trim()) return refuse("Nothing would change: the desk's words about its graphics already say this.");
    return { title: frameTitle(ctx, "set_design_prompt"), lines: [line(dict(ctx.lang).assistant.news.fields.designPrompt, shown(ctx, args.text.trim(), was, true))] };
  },
  execute: (ctx, args) => runFrame(ctx, "set_design_prompt", args),
});

/** The section's own frame row, or a refusal: there is nothing to move or remove without one. */
async function ownFrame(ctx: ToolCtx, section: string) {
  const row = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId: ctx.tenantId, section } }, select: { frameText: true } });
  if (!row) return refuse(`The "${section}" section has no frame of its own yet (it uses the main frame). Use design_section_frame to make one.`);
  return row;
}

const setFrameText = defineNews({
  name: "set_frame_text",
  description: "Move where the headline goes on a section's OWN frame: position top, middle or bottom. The section must already have its own frame; it does not redraw the frame.",
  schema: SCHEMAS.set_frame_text,
  permission: "configure",
  risk: "low",
  label: (lang) => NW.label.frame[lang],
  async card(ctx, args) {
    const row = await ownFrame(ctx, args.section);
    if (row.frameText === args.position) return refuse(`The headline is already at the ${args.position} of that frame.`);
    const f = dict(ctx.lang).assistant.news.fields;
    return {
      title: frameTitle(ctx, "set_frame_text"),
      lines: [line(f.section, sectionName(ctx, args.section)), line(f.position, shown(ctx, positionName(ctx, args.position), positionName(ctx, row.frameText), true))],
    };
  },
  execute: (ctx, args) => runFrame(ctx, "set_frame_text", args),
});

const removeSectionFrame = defineNews({
  name: "remove_section_frame",
  description: "Take a section's own frame away: its cards use the desk's main frame again. The frame file stays in storage but is no longer used. It cannot be brought back from the chat, so it waits for the person's Confirm.",
  schema: SCHEMAS.remove_section_frame,
  permission: "configure",
  risk: "destructive",
  label: (lang) => NW.label.frame[lang],
  async card(ctx, args) {
    await ownFrame(ctx, args.section);
    const f = dict(ctx.lang).assistant.news.fields;
    return { title: frameTitle(ctx, "remove_section_frame"), lines: [line(f.section, sectionName(ctx, args.section)), line(NW.f.note[ctx.lang], NW.removeFrameNote[ctx.lang])] };
  },
  execute: (ctx, args) => runFrame(ctx, "remove_section_frame", args),
});

export const BRAND_TOOLS: WriteTool[] = [setNewsVideoSettings, setVoiceNote, setBrandLook, addLibraryPhoto, designSectionFrame, setDesignPrompt, setFrameText, removeSectionFrame];
