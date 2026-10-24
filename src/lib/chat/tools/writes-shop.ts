// The eleven write tools the classic assistant already had, with the same names and arguments (their schemas are
// SCHEMAS of src/lib/assistant/tools.ts). The card says what will happen and refuses what cannot work; the run goes
// through runShopTool, so every check of the old confirm path (connected accounts, several Pages refused unless the person chose one
// in the chat, JPEG for Instagram, product matching, plan limits, the image and video switches) is the one and only copy.

import { postProblem, storyAttachmentsNotUsed, type PostProblem } from "@/app/app/assistant/run-shop-tool";
import { videoChoice } from "@/app/app/video/choice";
import { hasPlanArgs, ideaLength, mergeDailyPlan, PLAN_IDEA_MAX, type DailyArgs } from "@/app/app/video/daily-plan";
import { storyTooShort, wantsWide } from "@/app/app/video/story-form";
import type { Connections } from "@/app/app/data";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { storyFictionAsked } from "@/lib/advideo/lang";
import { parseVideoAutoPlan, type VideoAutoPlan } from "@/lib/advideo/plan";
import { imageEnabled } from "@/lib/ai/image";
import { addedWords } from "@/lib/assistant/added-words";
import { plainName } from "@/lib/assistant/ask";
import { proposalLines, SCHEMAS, STORY_VIDEO_ARGS, type ToolName } from "@/lib/assistant/tools";
import { defineWrite, type Card, type CardLine, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";
import { captionProblems, type Target } from "@/lib/merchant/caption";
import { normalizePhone } from "@/lib/merchant/phone";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";
import { scopedAccount } from "@/lib/oauth/account-scope";
import { parsePrice } from "@/lib/shop/forms";
import { instagramPhrase, pagePhrase } from "./reads-accounts";
import { attachmentsOf, clip, latestAttachmentIds, pinOf, platformName, refuse, runShop, shopFor } from "./writes-common";
import { CARD, LABEL, NEW } from "./writes-words";

/** The texts of set_shop_options that an empty string clears. The card has to say so: an empty value would otherwise show no line at all. */
const CLEARABLE = ["defaultDm", "aiBrief", "deliveryTime", "deliveryFee"] as const;

/**
 * The card of one of the shop's tools: the app's own title and labels, the exact values, and the shop it is for. A product the model
 * named loosely (a part of the name, or its id) is shown by the name it resolved to, so the person sees what will really be used,
 * and is pinned to the id it resolved to, so Confirm acts on that same product. A text that is cleared is shown as cleared.
 */
function cardOf(
  ctx: ToolCtx,
  tool: ToolName,
  args: object,
  shop: { shopName: string; productId?: string | null; productName?: string | null; conns?: Connections },
  /**
   * make_video: the language, kind and shape the video will really be made in; `latest`: the ids of the files of the owner's latest message
   * (null: unknown, nothing is claimed about attachments); `wideAuto`: Gituas itself set the shape to wide because the owner's words say YouTube.
   */
  video?: { lang: string; kind: string; format: string; latest?: readonly string[] | null; wideAuto?: boolean },
): Card {
  const t = dict(ctx.lang);
  const files = Object.fromEntries(attachmentsOf(ctx).map((x) => [x.id, plainName(x.name) || x.kind]));
  const shown: Record<string, unknown> = shop.productName ? { ...args, product: shop.productName } : { ...args };
  if (tool === "set_shop_options") for (const k of CLEARABLE) if (shown[k] === "") shown[k] = CARD.cleared[ctx.lang];
  // A video always shows the language it will be made in (the one asked, else the shop's video language, else Sorani), and a story says
  // so, shows its shape (vertical 9:16 unless it was asked wide) and shows no product (a story has none). An ad is always vertical and shows no shape.
  if (video) {
    shown.language = video.lang;
    if (video.kind === "story") {
      shown.kind = "story";
      shown.format = video.format;
      delete shown.product;
    } else {
      delete shown.kind;
      delete shown.format;
    }
  }
  const lines = proposalLines({ tool, args: shown }, t.assistant.fields, { files, shop: shop.shopName });
  if (video?.kind === "story") {
    // Every story is told from a real documented case (the one the idea names, or one Gituas chooses), or, when the idea says fiction, invented
    // and said so (src/lib/advideo/lang.ts storyFictionAsked). The photographs are the free ones from Wikimedia Commons where they are found,
    // unless switched off.
    const fiction = storyFictionAsked((args as { idea?: unknown }).idea as string | undefined);
    const noPhotos = (args as { photos?: unknown }).photos === false;
    const note = fiction ? CARD.videoStoryFiction : noPhotos ? CARD.videoStoryRealNoPhotos : CARD.videoStoryReal;
    lines.push({ label: NEW.field.note[ctx.lang], value: note[ctx.lang] });
    // The length and the YouTube sentence sit here too, BEFORE Confirm: the owner who asked for 30 seconds or for YouTube reads what is really made.
    lines.push({ label: t.assistant.fields.length, value: fiction ? t.assistant.done.videoLengthFiction : t.assistant.done.videoLengthStory });
    lines.push({ label: t.assistant.fields.youtube, value: t.assistant.done.videoNotYouTube });
    if (video.wideAuto) lines.push({ label: NEW.field.note[ctx.lang], value: CARD.videoWideAuto[ctx.lang] });
    // What the owner attached to this message and a story cannot use is said FIRST, on the card, before Confirm: never in silence.
    const unused = storyAttachmentsNotUsed(attachmentsOf(ctx), video.latest ?? null);
    const first: CardLine[] = [];
    if (unused.video) first.push({ label: CARD.notUsedLabel[ctx.lang], value: t.assistant.done.videoNotUsedVideo });
    if (unused.picture) first.push({ label: CARD.notUsedLabel[ctx.lang], value: t.assistant.done.videoNotUsedPicture });
    lines.unshift(...first);
  }
  // A post names the Page / Instagram account it goes to, right after "where" (the first line), when the person chose it in the chat.
  if (tool === "post_now" || tool === "schedule_post") lines.splice(1, 0, ...chosenAccountLine(ctx.lang, (args as { targets?: string[] }).targets ?? [], shop.conns));
  return {
    title: (t.assistant.tools as Record<string, string>)[tool] ?? tool,
    lines,
    ...pinOf(args as { product?: unknown }, { productId: shop.productId ?? null }),
  };
}

/**
 * "To: the Facebook Page «X» + the Instagram account @y": the accounts a post will go to, from the connections as the chat sees them
 * (narrowed to the chosen account). Only a platform the person chose an account for gets a name; with one account there is nothing to
 * tell apart, and a platform with several and no choice never reaches a card (postProblem).
 */
function chosenAccountLine(lang: Lang, targets: readonly string[], conns?: Connections): CardLine[] {
  if (!conns) return [];
  const parts: string[] = [];
  const fb = scopedAccount("META_FACEBOOK");
  if (fb && targets.includes("FB") && conns.META_FACEBOOK.connected) parts.push(pagePhrase(lang, clip(conns.META_FACEBOOK.name ?? fb, 60)));
  const ig = scopedAccount("META_INSTAGRAM");
  if (ig && targets.includes("IG") && conns.META_INSTAGRAM.connected) parts.push(instagramPhrase(lang, clip(conns.META_INSTAGRAM.name ?? ig, 60)));
  return parts.length ? [{ label: NEW.field.to[lang], value: parts.join(" + ") }] : [];
}

/** Every id must be a file attached in this chat (and a picture where a picture is needed). The model must never invent one. */
function needFiles(ctx: ToolCtx, ids: readonly string[], what: string, kind: "image" | "any" = "any") {
  const have = attachmentsOf(ctx);
  for (const id of ids) {
    const f = have.find((x) => x.id === id);
    if (!f) return refuse(`"${id}" is not one of the files attached in this chat. Use an id from the attachment list; never invent one.`);
    if (kind === "image" && f.kind !== "image") return refuse(`"${id}" is a video, but ${what} needs a picture.`);
  }
}

const POST_PROBLEM = (p: PostProblem): string => {
  switch (p.why) {
    case "notConnected":
      return `${p.platform} is not connected. The person connects it with the Connect button that show_accounts puts in the chat; you cannot do that for them.`;
    case "severalAccounts":
      return "There are several Facebook Pages or Instagram accounts connected, and the person has not chosen which one the chat posts as, so it would have to guess. Call show_accounts: it puts the Choose button in the chat. Say that a choice takes effect from their next message, then post once they have chosen.";
    case "badAction":
      return "The media id is not one of the files attached in this chat. Use an id from the attachment list.";
    case "needJpeg":
      return "Instagram takes only JPEG pictures and the attached picture is not a JPEG. Ask the person for a JPEG file.";
  }
};

/** What post_now and schedule_post share: the post must be whole, fit the platforms, and be possible with the connected accounts. */
async function checkPost(ctx: ToolCtx, args: { caption: string; targets: ("FB" | "IG")[]; media?: string; product?: string; when?: string }) {
  const targets = [...new Set(args.targets)];
  if (!args.caption && !args.media) refuse("A post needs a caption or an attached picture or video.");
  if (targets.includes("IG") && !args.media) refuse("Instagram posts need an attached picture or video.");
  needFiles(ctx, args.media ? [args.media] : [], "the post");
  const tooLong = captionProblems(args.caption, targets as Target[])[0];
  if (tooLong) refuse(tooLong.problem === "hashtags" ? "Instagram allows at most 30 hashtags in one caption." : `The caption is too long for ${platformName(tooLong.target as "FB" | "IG")}.`);
  if (args.when !== undefined) {
    const problem = scheduleProblem(targets, baghdadLocalToUtc(args.when), new Date(), dict("en").actions.publish);
    if (problem) refuse(`${problem} (The time is Baghdad time, between 10 minutes and 60 days from now.)`);
  }
  const shop = await shopFor(ctx, args.product);
  const problem = await postProblem(ctx.tenantId, args, attachmentsOf(ctx), shop.conns);
  if (problem) refuse(POST_PROBLEM(problem));
  return shop;
}

/**
 * The owner's own recent messages in this thread, oldest first (null when they cannot be read: then nothing can be judged and nothing is refused).
 * The last eight: an owner may name the topic a few messages before saying "yes, make it".
 */
async function ownerMessages(ctx: ToolCtx): Promise<string[] | null> {
  try {
    const { loadMessages } = await import("@/lib/chat/store");
    const rows = await loadMessages(ctx.threadId, { last: 40 });
    const own = rows.filter((r) => r.role === "user").slice(-8).map((r) => r.content);
    return own.length ? own : null;
  } catch {
    return null;
  }
}

/** How many of the owner's latest messages decide whether a story is wide: what they just said, not what they said a long time ago. */
const WIDE_LOOKBACK = 3;

const MODES = "mode is OFF, DRAFT (prepares it for the owner to review) or PUBLISH (does it by itself, publicly).";

/** The plan the shop's daily video already has, and the mode it is in (nothing known when the shop cannot be read). */
async function savedDaily(storeId: string): Promise<{ plan: VideoAutoPlan | null; mode: string | null }> {
  try {
    const row = await db.store.findUnique({ where: { id: storeId }, select: { videoAutoMode: true, videoAutoPlan: true } });
    return { plan: parseVideoAutoPlan(row?.videoAutoPlan), mode: typeof row?.videoAutoMode === "string" ? row.videoAutoMode : null };
  } catch {
    return { plan: null, mode: null };
  }
}

const DAILY_IDEA_TOO_LONG = `The daily video's idea can be at most ${PLAN_IDEA_MAX} characters. Tell the owner and ask them to shorten it; never cut or rewrite their words yourself.`;
const DAILY_NEEDS_YOUTUBE =
  "YouTube needs two answers that only the owner can give: who may watch the videos (youtubePrivacy: public, unlisted or private) and whether they are made for kids (youtubeMadeForKids: true or false). The owner has not said them. Ask ONE short question for both, in plain words, then propose again with their answers. Never choose them yourself.";
const DAILY_NEEDS_TARGETS =
  "A daily video that posts by itself needs publishTo: the platforms the owner named (FB, IG, YT). When they named none, use every Facebook Page and Instagram account that is connected (YT only when the owner has said who may watch and whether the videos are made for kids). Do not ask the owner which ones.";

/**
 * The card of set_daily_video. With no plan in the call it is the mode, the hour and the language as before. With a plan (the owner's idea, kind,
 * shape, review, photographs, platforms and YouTube answers) the card shows the WHOLE plan that Confirm will save (what the call carries on top of the
 * plan already saved) and says the plain facts before Confirm: what the daily video will do with the words, which case, what waits as a draft, and
 * that YouTube keeps uploads Private. It refuses what cannot work: an idea too long to keep whole, words the owner never said, a platform that is not
 * connected, a daily video that posts by itself with nowhere to post to, and YouTube without the owner's own two answers.
 */
async function dailyCard(ctx: ToolCtx, args: DailyArgs & { mode?: "OFF" | "DRAFT" | "PUBLISH"; hour?: number; language?: string }): Promise<Card> {
  const t = dict(ctx.lang);
  const shop = await shopFor(ctx);
  const { plan: saved, mode: savedMode } = await savedDaily(shop.store.id);
  if (!hasPlanArgs(args)) {
    // The plan the daily video already has is not changed, but switching it to PUBLISH needs somewhere to post to.
    if (args.mode === "PUBLISH" && saved && saved.targets.length === 0) refuse(DAILY_NEEDS_TARGETS);
    return cardOf(ctx, "set_daily_video", args, shop);
  }
  if (typeof args.idea === "string" && ideaLength(args.idea) > PLAN_IDEA_MAX) refuse(DAILY_IDEA_TOO_LONG);
  const fallbackKind = (await videoChoice(shop.store.id, shop.store.videoLang, { kind: args.kind, hasProduct: false })).kind;
  const kind = args.kind ?? saved?.kind ?? fallbackKind;
  const owner = await ownerMessages(ctx);
  // The idea is the owner's own words: a country, a people, an era or a year the owner never said is the model's addition (as in make_video).
  if (kind === "story" && typeof args.idea === "string" && args.idea.trim() && owner) {
    const added = addedWords(args.idea, owner.join("\n"));
    if (added.length) {
      refuse(`The idea has words the owner did not say: ${added.join(", ")}. The daily video's idea is the owner's own words, exactly as they said them: never add a country, a people, an era, a year, a genre or a name. Remove them and propose again with the owner's words only. Do not ask the owner anything.`);
    }
  }
  // The owner who says YouTube, 16:9, wide or landscape gets a wide story whatever the model remembered; Gituas sets it itself and the card says so.
  let given = args;
  let wideAuto = false;
  const alreadyWide = args.format === undefined && saved?.format === "wide";
  if (kind === "story" && args.format !== "wide" && !alreadyWide && owner && wantsWide(owner.slice(-WIDE_LOOKBACK).join("\n"))) {
    given = { ...args, format: "wide" };
    wideAuto = true;
  }
  const merged = mergeDailyPlan(given, saved, fallbackKind);
  if (merged.needs === "youtube") refuse(DAILY_NEEDS_YOUTUBE);
  const plan = parseVideoAutoPlan(merged.raw);
  if (!plan) refuse("The daily plan could not be read. Propose it again with the owner's own words.");
  if ((args.mode ?? savedMode) === "PUBLISH" && plan.targets.length === 0) refuse(DAILY_NEEDS_TARGETS);
  // Every platform named must be there: this shop's Facebook Page and Instagram account, and the workspace's YouTube channel.
  if (plan.targets.includes("FB") && !shop.store.fbPageId) refuse("This shop has no Facebook Page, so the daily video cannot post there. Do not ask the owner anything: leave FB out and say so in one line.");
  if (plan.targets.includes("IG") && !shop.store.igUserId) refuse("This shop has no Instagram account, so the daily video cannot post there. Do not ask the owner anything: leave IG out and say so in one line.");
  if (plan.targets.includes("YT") && !shop.conns.YOUTUBE.connected) {
    refuse("YouTube is not connected. The person connects it with the Connect button that show_accounts puts in the chat; you cannot do that for them. Tell them so; do not leave YT out without saying it.");
  }
  const story = plan.kind === "story";
  const shown: Record<string, unknown> = {
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
    ...(args.hour !== undefined ? { hour: args.hour } : {}),
    ...(args.language ? { language: args.language } : {}),
    idea: plan.brief,
    kind: plan.kind,
    ...(story ? { format: plan.format === "wide" ? "wide" : "vertical", photos: plan.photos } : {}),
    review: plan.review,
    publishTo: plan.targets,
    ...(plan.youtube ? { youtubePrivacy: plan.youtube.privacy, youtubeMadeForKids: plan.youtube.madeForKids } : {}),
  };
  const card = cardOf(ctx, "set_daily_video", shown, shop);
  const note = NEW.field.note[ctx.lang];
  const lines: CardLine[] = [...card.lines];
  if (wideAuto) lines.push({ label: note, value: CARD.videoWideAuto[ctx.lang] });
  if (story) {
    lines.push({ label: t.assistant.fields.length, value: storyFictionAsked(plan.brief) ? t.assistant.done.videoLengthFiction : t.assistant.done.videoLengthStory });
    lines.push({ label: note, value: t.assistant.done.dailyCase });
    if ((args.mode ?? savedMode) === "PUBLISH") lines.push({ label: note, value: t.assistant.done.dailyWaits });
  }
  if (plan.targets.includes("YT")) lines.push({ label: t.assistant.fields.youtube, value: t.publish.ytPrivate });
  // What Confirm saves is what the card shows, even if the saved plan changes meanwhile: the whole plan is stored with the run.
  const pin: Record<string, unknown> = {
    idea: plan.brief,
    kind: plan.kind,
    review: plan.review,
    photos: plan.photos,
    publishTo: plan.targets,
    ...(story ? { format: plan.format === "wide" ? "wide" : "vertical" } : {}),
    ...(plan.youtube ? { youtubePrivacy: plan.youtube.privacy, youtubeMadeForKids: plan.youtube.madeForKids } : {}),
  };
  return { ...card, lines, pin };
}

export const SHOP_WRITE_TOOLS: WriteTool[] = [
  defineWrite({
    name: "make_picture",
    description:
      "Make an AI picture for a post or an ad. idea: what the picture should show, in the owner's words. shape: \"square\" (default) or \"portrait\" (4:5). " +
      "references: ids of attached pictures to follow, for example [\"a1\"] (only ids from the attachment list). product: the exact name, or the id from list_products, of the product it shows, if any. " +
      "It uses one of the shop's AI pictures and takes up to a minute; the finished picture is added to the chat's attachments so it can be posted next.",
    schema: SCHEMAS.make_picture,
    kinds: ["shop"],
    permission: "publish",
    risk: "money",
    long: true,
    textFields: ["idea"],
    label: (lang) => LABEL.make_picture[lang],
    async card(ctx, args) {
      if (!imageEnabled()) refuse("Making AI pictures is switched off on this server right now.");
      needFiles(ctx, args.references, "a reference", "image");
      const shop = await shopFor(ctx, args.product);
      return cardOf(ctx, "make_picture", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "make_picture", args),
  }),
  defineWrite({
    name: "make_video",
    description:
      "Start a short AI video for the shop: an ad of about 35 seconds or a story of about 60 to 70 seconds (a story aims for about 30 seconds when its idea asks for a short video, with no promise). idea: what the video is about, in the owner's own words (up to 1200 characters; an ad's idea is cut to 300). " +
      "The video language is the owner's choice: language is \"ckb\" (Sorani Kurdish), \"ar\" (Arabic) or \"en\" (English), and the whole video follows it (script, on-screen text, voice, layout, post text). " +
      "Pass language only when the owner explicitly names the video language (for example \"in English\"); the language of their chat message or of their idea says nothing about it, so otherwise leave it out and the shop's own video language is used (get_settings, area video, dailyVideo.videoLanguage; Sorani when none is saved). Never write the language into the idea (no \"only in Kurdish\" or \"in English\"). " +
      "kind: \"ad\" promotes the brand or a product (product: the exact name, or the id from list_products, of the product it features, if any); \"story\" is a story or content video (for example a mystery or a history story for a story channel): it needs no product, price, delivery line or phone number. " +
      `${STORY_VIDEO_ARGS} ` +
      "Leave kind out and a video of a product you name (product) is an ad; with no product it follows what the page is for (a page that grows or earns from its content gets a story, the others an ad). There is still no multi-minute documentary, and a video made now is not uploaded to YouTube from here (the owner downloads it and adds it in Publish or YouTube Studio; only the daily video can post to YouTube). Act first: a generic idea (a genre, a wish, a style) is enough for a story, so propose the video at once and never ask the owner to name a case, a country or an era. " +
      "It is made in the background and takes a few minutes; this tool does not post it. The card shows the language and shape it will really use, and what the owner attached that is not used; the result lists the shape, the language and the photographs as they really are: report exactly that.",
    schema: SCHEMAS.make_video,
    kinds: ["shop"],
    permission: "publish",
    risk: "money",
    textFields: ["idea"],
    label: (lang) => LABEL.make_video[lang],
    async card(ctx, args) {
      if (!adVideoEnabled()) refuse("Making AI videos is switched off on this server right now.");
      const shop = await shopFor(ctx, args.product);
      // The same rule as the action that runs it: an explicit kind, else an ad when a product was named, else what the page is for.
      const choice = await videoChoice(shop.store.id, shop.store.videoLang, { lang: args.language, kind: args.kind, hasProduct: !!shop.productId });
      if (choice.kind === "story" && storyTooShort(args.idea)) refuse("A story needs the owner's idea in a few plain words (the kind of story, or a case or event): use what the owner said. Do not ask them to name a case: Gituas chooses a real one when none is named.");
      // Only a story can be wide (16:9 for YouTube); an ad is always vertical. Say so plainly rather than make something else.
      if (choice.kind !== "story" && args.format === "wide") refuse("An ad is always vertical (9:16); only a story can be wide (16:9, for YouTube). Tell the owner that plainly, and offer a vertical ad or a wide story: never swap one for the other without saying so.");
      let wide = choice.kind === "story" && args.format === "wide";
      let wideAuto = false;
      if (choice.kind === "story") {
        const owner = await ownerMessages(ctx);
        // The idea is the owner's own words: a country, a people, an era or a year that the owner never said (here, in this thread) is the model's addition.
        const added = owner ? addedWords(args.idea, owner.join("\n")) : [];
        if (added.length) {
          refuse(`The idea has words the owner did not say: ${added.join(", ")}. A story's idea is the owner's own words, exactly as they said them: never add a country, a people, an era, a year, a genre or a name. Remove them and propose again with the owner's words only. Do not ask the owner anything.`);
        }
        // The owner who says YouTube, 16:9, wide or landscape gets a wide story whatever the model remembered: Gituas sets it itself and the card says so.
        if (!wide && owner && wantsWide(owner.slice(-WIDE_LOOKBACK).join("\n"))) {
          wide = true;
          wideAuto = true;
        }
      }
      const card = cardOf(ctx, "make_video", args, shop, {
        lang: choice.lang,
        kind: choice.kind,
        format: wide ? "wide" : "vertical",
        latest: choice.kind === "story" ? await latestAttachmentIds(ctx) : null,
        wideAuto,
      });
      // What Confirm runs is what the card shows: the shape Gituas set is stored with the run.
      return wideAuto ? { ...card, pin: { ...card.pin, format: "wide" } } : card;
    },
    execute: (ctx, args) => runShop(ctx, "make_video", args),
  }),
  defineWrite({
    name: "post_now",
    description:
      "Publish a post right now to Facebook and/or Instagram. caption: the post text (it may be empty only when a file is attached). targets: [\"FB\"], [\"IG\"] or both; Instagram needs a picture (JPEG) or a video. " +
      "media: the id of one attached file, for example \"a1\". product: the exact name, or the id from list_products, of the product the post is about. " +
      "Refused when a platform is not connected, or when there are several Pages or Instagram accounts and the person has not chosen one in the chat (show_accounts lets them choose). It posts as the account they chose, and the card names it.",
    schema: SCHEMAS.post_now,
    kinds: ["shop"],
    permission: "publish",
    risk: "public",
    textFields: ["caption"],
    label: (lang) => LABEL.post_now[lang],
    async card(ctx, args) {
      return cardOf(ctx, "post_now", args, await checkPost(ctx, args));
    },
    execute: (ctx, args) => runShop(ctx, "post_now", args),
  }),
  defineWrite({
    name: "schedule_post",
    description:
      "Publish a post to Facebook and/or Instagram at a later time. Same arguments as post_now, plus when: Baghdad wall-clock time as YYYY-MM-DDTHH:mm, from 10 minutes to 60 days from now. " +
      "Work out the date from the current Baghdad time in the account snapshot; never guess it.",
    schema: SCHEMAS.schedule_post,
    kinds: ["shop"],
    permission: "publish",
    risk: "public",
    textFields: ["caption"],
    label: (lang) => LABEL.schedule_post[lang],
    async card(ctx, args) {
      return cardOf(ctx, "schedule_post", args, await checkPost(ctx, args));
    },
    execute: (ctx, args) => runShop(ctx, "schedule_post", args),
  }),
  defineWrite({
    name: "set_auto_replies",
    description: "Switch the shop's automatic replies to comments and messages on (on: true) or off (on: false).",
    schema: SCHEMAS.set_auto_replies,
    kinds: ["shop"],
    permission: "configure",
    // Switching them on makes the shop answer buyers by itself from then on, unwatched.
    risk: "standing",
    riskFor: (args) => (args.on ? "standing" : "low"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_auto_replies", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_auto_replies", args),
  }),
  defineWrite({
    name: "set_autopilot",
    description: `Set the automatic posts. ${MODES} perDay: 1 to 3 posts a day (optional).`,
    schema: SCHEMAS.set_autopilot,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    riskFor: (args) => (args.mode === "PUBLISH" ? "standing" : "low"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_autopilot", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_autopilot", args),
  }),
  defineWrite({
    name: "set_daily_video",
    description:
      `Set the daily AI video. ${MODES} Leave mode out to keep the daily video exactly as it is now (on in its mode, or off) when the owner only changes the language or the hour. hour: 0 to 23, Baghdad time, after which the day's video is made; leave it out to keep the hour already chosen. ` +
      "language: \"ckb\" (Sorani Kurdish), \"ar\" (Arabic) or \"en\" (English), the shop's video language: the daily video, the Video screen's form and make_video use it when they are given no other. Pass it only when the owner explicitly names the video language; the language of their chat message says nothing about it. Leave it out to keep the one already saved. " +
      "With no plan of its own, a page that grows or earns from its content and has described its channel gets a story each day, kept as a draft for the owner to read first; every other page gets an ad. " +
      "THE OWNER'S OWN DAILY PLAN: when the owner says \"every day make me a video like this (and post it)\", save it in one call. idea: the owner's own words, VERBATIM, at most 600 characters (the same words are used every day: a general idea such as a genre or a wish gets a different real case each day; an empty string means no idea of their own). " +
      "kind: \"story\" or \"ad\" (left out: what the page is for). format: \"vertical\" (default) or \"wide\" (16:9; a story only). review: true only when the owner asks Gituas to improve the idea first; left out or false, their words go straight to the video maker exactly as written. photos: false switches the Wikimedia Commons photographs off. " +
      "publishTo: where each day's video is posted by itself, a list of \"FB\", \"IG\", \"YT\" (the platforms the owner names; with none named and mode PUBLISH, every connected Facebook Page and Instagram account); mode PUBLISH needs it, DRAFT only makes the video and keeps it for the owner to read. " +
      "YouTube (YT) needs two answers that only the owner can give: youtubePrivacy (\"public\", \"unlisted\" or \"private\") and youtubeMadeForKids (true or false). When YT is wanted and the owner has not said them, ask ONE short question for both; never choose them. Everything else is act-first: decide it yourself and say it in one line. " +
      "A story told from memory (its Wikipedia article could not be read) or about a very recent case is never posted by itself: it waits as a draft. YouTube keeps every upload Private until Google finishes reviewing Gituas.",
    schema: SCHEMAS.set_daily_video,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    textFields: ["idea"],
    // DRAFT does not publish, but it makes (and pays for) a video every day without anyone watching: only OFF is small and safe. With no
    // mode the daily video stays as it is (only its hour changes): nothing new starts, so it is small as well.
    // Changing the language or the plan changes what a running daily video makes and posts publicly: it is a card, like switching the video on.
    riskFor: (args) => (args.mode === "OFF" || (args.mode === undefined && !args.language && !hasPlanArgs(args)) ? "low" : "standing"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      if (!adVideoEnabled()) refuse("AI videos are switched off on this server right now.");
      return dailyCard(ctx, args);
    },
    execute: (ctx, args) => runShop(ctx, "set_daily_video", args),
  }),
  defineWrite({
    name: "set_shop_options",
    description:
      "Change the shop's own switches and texts; only the fields you give change. likeComments, autoHideSpam, aiReplies: true or false (aiReplies lets the AI write the replies to buyers). " +
      "expiryDays: 1 to 365, how many days a post keeps getting automatic replies. defaultDm: the default private message sent to a commenter. deliveryFee: IQD, digits only. " +
      "deliveryTime: free text such as \"1-2 days\". aiBrief: what the AI should know about the shop and how to talk to buyers. " +
      "An empty string (\"\") clears that text or fee, and the card shows it as cleared; send it only when the owner asked to remove it, and leave a field out to keep it as it is.",
    schema: SCHEMAS.set_shop_options,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    textFields: ["defaultDm", "aiBrief", "deliveryTime"],
    riskFor: (args) => {
      // Switching on what answers, hides or likes by itself acts later, unwatched: it always needs a card.
      if (args.aiReplies === true || args.autoHideSpam === true || args.likeComments === true) return "standing";
      // The texts and the delivery terms are what buyers read, whether they are set or cleared.
      if (args.defaultDm !== undefined || args.aiBrief !== undefined || args.deliveryFee !== undefined || args.deliveryTime !== undefined) return "public";
      return "low";
    },
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_shop_options", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_shop_options", args),
  }),
  defineWrite({
    name: "add_product",
    description:
      "Add a new product with one price. name (up to 80 characters), description (optional), price: IQD, digits only, inStock (default true), photos: ids of attached pictures, for example [\"a1\"]. " +
      "To change a product that already exists use update_product instead.",
    schema: SCHEMAS.add_product,
    kinds: ["shop"],
    permission: "configure",
    risk: "public",
    textFields: ["name", "description"],
    label: (lang) => LABEL.product[lang],
    async card(ctx, args) {
      needFiles(ctx, args.photos, "a product photo", "image");
      if (parsePrice(args.price, "IQD") === null) refuse("The price must be a positive whole number of IQD, digits only.");
      const shop = await shopFor(ctx);
      return cardOf(ctx, "add_product", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "add_product", args),
  }),
  defineWrite({
    name: "archive_product",
    description:
      "Remove a product from the shop. It leaves the Products screen and the owner cannot bring it back from the app; it can only be added again as a new product, with its price and photos. " +
      "product: the exact product name, or its id from list_products.",
    schema: SCHEMAS.archive_product,
    kinds: ["shop"],
    permission: "configure",
    // Nothing in the app restores it, and the Products screen itself asks "Delete this product?": the chat always asks too.
    risk: "destructive",
    label: (lang) => LABEL.product[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx, args.product);
      const card = cardOf(ctx, "archive_product", args, shop);
      return { ...card, lines: [...card.lines, { label: NEW.field.note[ctx.lang], value: CARD.archiveNote[ctx.lang] }] };
    },
    execute: (ctx, args) => runShop(ctx, "archive_product", args),
  }),
  defineWrite({
    name: "set_whatsapp_number",
    description: "Save the shop's WhatsApp number, used in the order links, for example \"07701234567\" or \"+9647701234567\".",
    schema: SCHEMAS.set_whatsapp_number,
    kinds: ["shop"],
    permission: "configure",
    // Buyers are sent to this number: a wrong one sends them to a stranger.
    risk: "standing",
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      if (!normalizePhone(args.number).ok) refuse("That is not a valid phone number. An Iraqi mobile such as 0770 123 4567, or an international number starting with + or 00.");
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_whatsapp_number", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_whatsapp_number", args),
  }),
];
