// group_accounts: put a Facebook Page and an Instagram account into ONE group, so the features that work per group (the daily video, the
// automatic posts and the replies) cover both. A group is what the app stores as a shop (a Store row) and holds at most one Page and
// one Instagram account; the app had no screen to move an account from one group to another, so the owner whose Page sat in one group
// and whose Instagram account sat in another could never post one video to both.
//
// "standing": what the two accounts do from then on follows the destination group's switches, so it is always a card. The card says in
// the person's language which account moves from which group to which group, what the new group's switches are (the account starts
// following them: automatic replies, automatic posts, the daily video, paused), what stays where, and that nothing is deleted. Confirm acts
// on the accounts and the direction the card showed (they are pinned into the stored arguments); if the groups changed meanwhile the run
// is refused instead of doing something else.

import { z } from "zod";

import { loadAccountLists, type AccountLists, type AccountRef } from "@/app/app/data";
import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/lang";
import { defineWrite, ToolRefusal, type Card, type CardLine, type ToolCtx, type WriteResult, type WriteTool } from "../types";
import { groupLabel, groupPhrase, instagramPhrase, loadGroups, pagePhrase, planRank, type GroupRow } from "./reads-accounts";
import { modelText } from "./reads-shared";
import { clip, refuse, say, words } from "./writes-common";
import { NEW } from "./writes-words";

// ---------------------------------------------------------------------------------------------------------------------
// The person's words (Sorani, Arabic, English). Arabic does not use Kurdish-only letters.

const LABEL = words("پەیج و ئینستاگرام پێکەوە دادەنێم…", "أجمع الصفحة وحساب إنستغرام…", "Putting the two accounts together…");
const TITLE = words("یەکخستنی پەیج و ئینستاگرام", "جمع الصفحة وحساب إنستغرام", "Put a Page and an Instagram account together");

const FIELD = {
  together: words("پێکەوە", "معاً", "Together"),
  moves: words("دەگوازرێتەوە", "ما سيُنقل", "Moves"),
  from: words("لە", "من", "From"),
  stays: words("دەمێنێتەوە", "ما يبقى", "Stays"),
  warning: words("ئاگاداری", "تنبيه", "Heads up"),
  switches: words("کارە خۆکارەکانی گرووپی نوێ", "إعدادات المجموعة الجديدة", "Switches of the new group"),
};
const EMPTY = words("هیچ هەژمارێکی تێدا نامێنێت", "لن يبقى فيها أي حساب", "no accounts left in it");

// The destination group's switches, the way the app words them: what the moved account starts following (see switchesOf).
const SWITCH = {
  replies: words("وەڵامدانەوەی خۆکار", "الردود التلقائية", "Automatic replies"),
  posts: words("پۆستی خۆکار", "المنشورات التلقائية", "Automatic posts"),
  video: words("ڤیدیۆی ڕۆژانە", "الفيديو اليومي", "Daily video"),
  on: words("چالاک", "مفعّلة", "on"),
  off: words("کوژاوە", "متوقفة", "off"),
  paused: words("وەستێنراو", "موقوفة مؤقتاً", "paused"),
  prepare: words("تەنها ئامادەکردن", "التحضير فقط", "prepare only"),
  publish: words("بڵاوکردنەوەی خۆکار", "نشر تلقائي", "posts by itself"),
};

/** An English sentence starts with a capital; the other two languages have none. */
const up = (lang: Lang, s: string): string => (lang === "en" ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TEXT = {
  together: say(
    (page: string, insta: string) => `${page} و ${insta} دەبنە یەک گرووپ. ڤیدیۆی ڕۆژانە و پۆستی خۆکار و وەڵامدانەوەکان بۆ هەردووکیان پێکەوە کار دەکەن.`,
    (page: string, insta: string) => `${page} و${insta} سيصبحان في مجموعة واحدة. الفيديو اليومي والنشر التلقائي والردود ستشملهما معاً.`,
    (page: string, insta: string) => `${up("en", page)} and ${insta} will be in one group. The daily video, automatic posts and replies will then cover both.`,
  ),
  noteFrom: say(
    (moved: string, to: string, from: string) =>
      `${moved} لەمەودوا بەپێی ڕێکخستنەکانی ${to} کار دەکات. نامە و بەرهەم و ڕێکخستنە کۆنەکان لەگەڵ ${from} دەمێننەوە، هەروەها کارە خۆکارەکانی ئەو پۆستانەی پێشتر بڵاو کراونەتەوە (وەک کارتی بەرهەم). هیچ ناسڕدرێتەوە.`,
    (moved: string, to: string, from: string) =>
      `من الآن تُطبَّق إعدادات ${to} على ${moved}. تبقى الرسائل والمنتجات والإعدادات القديمة مع ${from}، وكذلك الأتمتة على المنشورات المنشورة سابقاً (مثل بطاقات المنتجات). ولا يُحذف أي شيء.`,
    (moved: string, to: string, from: string) =>
      `${up("en", moved)} will follow the settings of ${to} from now on. Old messages, products and settings stay with ${from}, and so does the automation on posts already published (such as product cards); nothing is deleted.`,
  ),
  noteNew: say(
    (moved: string, to: string) => `${moved} لەمەودوا بەپێی ڕێکخستنەکانی ${to} کار دەکات. هیچ ناسڕدرێتەوە.`,
    (moved: string, to: string) => `من الآن تُطبَّق إعدادات ${to} على ${moved}. لا يُحذف أي شيء.`,
    (moved: string, to: string) => `${up("en", moved)} will follow the settings of ${to} from now on. Nothing is deleted.`,
  ),
  lowerPlan: say(
    (to: string, from: string) => `${to} لەسەر پلانێکی نزمترە لە ${from}: سنووری ئەو پلانە نزمە بۆ ئەو هەژمارە جێبەجێ دەبێت.`,
    (to: string, from: string) => `${to} على باقة أدنى من ${from}: تسري حدود الباقة الأدنى على الحساب المنقول.`,
    (to: string, from: string) => `${up("en", to)} is on a lower plan than ${from}: the limits of the lower plan apply to the moved account.`,
  ),
  done: say(
    (page: string, insta: string, group: string) => `ئەنجام درا: ${page} و ${insta} ئێستا پێکەوەن لە ${group}.`,
    (page: string, insta: string, group: string) => `تم: ${page} و${insta} معاً الآن في ${group}.`,
    (page: string, insta: string, group: string) => `Done: ${page} and ${insta} are now together in ${group}.`,
  ),
  already: say(
    (page: string, insta: string, group: string) => `${page} و ${insta} پێشتر لە یەک گرووپدا بوون (${group}). هیچ نەگۆڕا.`,
    (page: string, insta: string, group: string) => `${page} و${insta} كانا أصلاً في مجموعة واحدة (${group}). لم يتغيّر شيء.`,
    (page: string, insta: string, group: string) => `${up("en", page)} and ${insta} were already in one group (${group}). Nothing changed.`,
  ),
};

// ---------------------------------------------------------------------------------------------------------------------
// Which account the person means (among the accounts this workspace has connected, nothing else)

type Slot = "facebook" | "instagram";
/** Whose group the two end up in: "facebook" = the Page's group, "instagram" = the Instagram account's group. */
export type Into = Slot;

const KIND: Record<Slot, string> = { facebook: "Facebook Page", instagram: "Instagram account" };
const listOf = (lists: AccountLists, slot: Slot): AccountRef[] => (slot === "facebook" ? lists.META_FACEBOOK : lists.META_INSTAGRAM);
const slotOf = (g: GroupRow, slot: Slot): string | null => (slot === "facebook" ? g.fbPageId : g.igUserId);
const fold = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/^@/, "").toLowerCase();
const shown = (a: AccountRef): string => modelText(a.name, 60) || "(no name)";

/** "Name" (in the group "X"): how the model is shown a candidate, so two accounts with similar names can be told apart. */
function describe(a: AccountRef, slot: Slot, groups: readonly GroupRow[]): string {
  const g = groups.find((x) => slotOf(x, slot) === a.id);
  return `"${shown(a)}" (${g ? `in the group "${modelText(groupLabel(g, groups), 60)}"` : "not in any group"})`;
}
const candidates = (list: readonly AccountRef[], slot: Slot, groups: readonly GroupRow[]): string => list.slice(0, 8).map((a) => describe(a, slot, groups)).join("; ");

/**
 * The one account of this kind a hint names: its id first, then its exact name (an Instagram account also by the handle its group
 * stores), then a name that only one account contains. More than one at a step, or none, is a refusal that lists the candidates.
 * The model only ever saw a name in the form `shown` gives (phone numbers and addresses taken out, cut at 60 characters with a "…"
 * at the end), so that form matches too, with the "…" and without it.
 */
function pick(list: readonly AccountRef[], groups: readonly GroupRow[], slot: Slot, hint: string): AccountRef {
  if (!list.length) {
    return refuse(`No ${KIND[slot]} is connected. The owner can connect one with the Connect button that show_accounts puts in the chat; you cannot do that for them.`);
  }
  const given = hint.trim();
  const byId = list.filter((a) => a.id === given);
  if (byId.length === 1) return byId[0];
  // A name that really ends in three dots matches as typed; the form the model saw (cut, with an ellipsis) matches too.
  const wants = new Set([fold(given), fold(given).replace(/\.{3}$/, "…")].filter(Boolean));
  const want = fold(given);
  const keys = (a: AccountRef): string[] => {
    const handle = slot === "instagram" ? groups.find((g) => g.igUserId === a.id)?.igUsername : null;
    const names = [fold(a.name), fold(shown(a)), ...(handle ? [fold(handle), fold(modelText(handle, 60))] : [])].filter(Boolean);
    const uncut = names.filter((k) => k.endsWith("…")).map((k) => k.slice(0, -1).trim());
    return [...new Set([...names, ...uncut])].filter(Boolean);
  };
  const exact = wants.size ? list.filter((a) => keys(a).some((k) => wants.has(k))) : [];
  const loose = !exact.length && want.length >= 2 ? list.filter((a) => keys(a).some((k) => [...wants].some((w) => w.length >= 2 && k.includes(w)))) : [];
  const found = exact.length ? exact : loose;
  if (found.length === 1) return found[0];
  const said = `"${modelText(given, 60)}"`;
  if (found.length > 1) return refuse(`More than one ${KIND[slot]} matches ${said}: ${candidates(found, slot, groups)}. Ask the owner which one, using the full name.`);
  return refuse(`No connected ${KIND[slot]} matches ${said}. The connected ones are: ${candidates(list, slot, groups)}. Ask the owner which one.`);
}

interface Situation {
  lists: AccountLists;
  groups: GroupRow[];
  fb: AccountRef;
  ig: AccountRef;
}

/** Both accounts, from the live data. A kind that was not named is taken only when the workspace has exactly one account of it. */
async function resolveBoth(tenantId: string, args: { facebook?: string; instagram?: string }): Promise<Situation> {
  const [lists, groups] = await Promise.all([loadAccountLists(tenantId), loadGroups(db, tenantId)]);
  const hints: Record<Slot, string | undefined> = { facebook: args.facebook?.trim() || undefined, instagram: args.instagram?.trim() || undefined };
  if (!hints.facebook && !hints.instagram) {
    return refuse("Name the Facebook Page and the Instagram account to put together (ask the owner; show_accounts lists their names).");
  }
  const one = (slot: Slot): AccountRef => {
    const hint = hints[slot];
    if (hint) return pick(listOf(lists, slot), groups, slot, hint);
    const list = listOf(lists, slot);
    if (list.length === 1) return list[0];
    if (!list.length) return refuse(`No ${KIND[slot]} is connected, so there is nothing to put together. The owner can connect one with the Connect button that show_accounts puts in the chat.`);
    return refuse(`Which ${KIND[slot]} should it be put together with? The connected ones are: ${candidates(list, slot, groups)}. Ask the owner and pass its name.`);
  };
  return { lists, groups, fb: one("facebook"), ig: one("instagram") };
}

// ---------------------------------------------------------------------------------------------------------------------
// What to move (pure)

export interface Move {
  /** The account that changes group. */
  account: Slot;
  accountId: string;
  /** The group it leaves (null: it was not in any group). */
  from: GroupRow | null;
  /** The group it joins: the other account is already in it. */
  to: GroupRow;
  into: Into;
}

export type Plan =
  | { ok: true; move: Move }
  | { ok: false; why: "together"; group: GroupRow }
  | { ok: false; why: "blocked"; fbGroup: GroupRow | null; igGroup: GroupRow | null; into?: Into };

/**
 * The move that puts the Page and the Instagram account into one group. One of the two joins the group of the other, and only when
 * that group has the slot for it free (a group holds one Page and one Instagram account). So the Instagram account can join the
 * Page's group when that group has no Instagram account, and the Page can join the Instagram account's group when that group has no
 * Page. When both ways work (each account alone in its own group) `into` says which; without it the group on the bigger plan, then the
 * older one, keeps its place and takes the other account in. An account that is in no group yet can join but cannot be joined.
 */
export function planRegroup(groups: readonly GroupRow[], fbId: string, igId: string, into?: Into, now = Date.now()): Plan {
  const fbGroup = groups.find((g) => g.fbPageId === fbId) ?? null;
  const igGroup = groups.find((g) => g.igUserId === igId) ?? null;
  if (fbGroup && igGroup && fbGroup.id === igGroup.id) return { ok: false, why: "together", group: fbGroup };
  const toPageGroup: Move | null = fbGroup && !fbGroup.igUserId ? { account: "instagram", accountId: igId, from: igGroup, to: fbGroup, into: "facebook" } : null;
  const toInstagramGroup: Move | null = igGroup && !igGroup.fbPageId ? { account: "facebook", accountId: fbId, from: fbGroup, to: igGroup, into: "instagram" } : null;
  const options = into === "facebook" ? [toPageGroup] : into === "instagram" ? [toInstagramGroup] : [toPageGroup, toInstagramGroup];
  const viable = options.filter((m): m is Move => !!m);
  if (!viable.length) return { ok: false, why: "blocked", fbGroup, igGroup, ...(into ? { into } : {}) };
  if (viable.length === 1) return { ok: true, move: viable[0] };
  const [a, b] = viable;
  const ra = planRank(a.to, now);
  const rb = planRank(b.to, now);
  const at = a.to.createdAt.getTime();
  const bt = b.to.createdAt.getTime();
  const aFirst = ra !== rb ? ra > rb : at !== bt ? at < bt : a.to.id < b.to.id;
  return { ok: true, move: aFirst ? a : b };
}

/** Why a plan is blocked, for the model: which group holds which account and why nothing can move. */
function blockedText(p: Extract<Plan, { ok: false; why: "blocked" }>, s: Situation): string {
  const fbName = shown(s.fb);
  const igName = shown(s.ig);
  const group = (g: GroupRow) => `"${modelText(groupLabel(g, s.groups), 60)}"`;
  const igHolder = (g: GroupRow) => {
    const named = s.lists.META_INSTAGRAM.find((a) => a.id === g.igUserId);
    return named ? `"${shown(named)}"` : g.igUsername ? `"@${modelText(g.igUsername, 60)}"` : "another Instagram account";
  };
  const fbHolder = (g: GroupRow) => {
    const named = s.lists.META_FACEBOOK.find((a) => a.id === g.fbPageId);
    return named ? `"${shown(named)}"` : "another Facebook Page";
  };
  const joinPage = p.fbGroup ? `the group ${group(p.fbGroup)} already holds the Instagram account ${igHolder(p.fbGroup)}` : `the Facebook Page "${fbName}" is not in any group`;
  const joinInsta = p.igGroup ? `the group ${group(p.igGroup)} already holds the Facebook Page ${fbHolder(p.igGroup)}` : `the Instagram account "${igName}" is not in any group`;
  const parts = !p.into
    ? `To move the Instagram account "${igName}" into the Page's group: ${joinPage}. To move the Page "${fbName}" into the Instagram account's group: ${joinInsta}.`
    : p.into === "facebook"
      ? `To move the Instagram account "${igName}" into the Page's group: ${joinPage}.`
      : `To move the Page "${fbName}" into the Instagram account's group: ${joinInsta}.`;
  const tail = p.fbGroup || p.igGroup
    ? " A group holds at most one Facebook Page and one Instagram account, and no tool takes an account out of a group. Say this plainly to the owner (name which group holds which account); only Gituas support can untangle it."
    : " Neither account belongs to a group yet. Say this plainly to the owner; Gituas support can fix it.";
  return `These two accounts cannot be put together. ${parts}${tail}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The card

const line = (label: string, value: string): CardLine => ({ label, value });
/** The name of an account for a sentence: cut to a length a card can show. */
const nameOf = (a: AccountRef): string => clip(a.name, 60) || a.id;

function remainingPhrase(lang: Lang, mv: Move, s: Situation): string {
  const from = mv.from;
  if (!from) return EMPTY[lang];
  // What the group the account leaves still holds: the other kind of account.
  if (mv.account === "facebook") {
    if (!from.igUserId) return EMPTY[lang];
    const named = s.lists.META_INSTAGRAM.find((a) => a.id === from.igUserId);
    return instagramPhrase(lang, named ? nameOf(named) : from.igUsername);
  }
  if (!from.fbPageId) return EMPTY[lang];
  const named = s.lists.META_FACEBOOK.find((a) => a.id === from.fbPageId);
  return pagePhrase(lang, named ? nameOf(named) : null);
}

/**
 * What the destination group's switches say, in the person's words: from the move on the account answers, posts and makes its video
 * by these (a group that was set to answer by itself makes the Page answer by itself). "paused" when Meta refused the group's access.
 */
function switchesOf(lang: Lang, g: GroupRow): string {
  const paused = !!g.pausedReason;
  const active = (on: boolean, word: string): string => (!on ? SWITCH.off[lang] : paused ? SWITCH.paused[lang] : word);
  const mode = (m: string): string => (m === "PUBLISH" ? SWITCH.publish[lang] : SWITCH.prepare[lang]);
  const posts = g.autoMode === "DRAFT" || g.autoMode === "PUBLISH";
  const video = g.videoAutoMode === "DRAFT" || g.videoAutoMode === "PUBLISH";
  return [
    `${SWITCH.replies[lang]}: ${active(!!g.automationEnabled, SWITCH.on[lang])}`,
    `${SWITCH.posts[lang]}: ${active(posts, mode(g.autoMode))}`,
    `${SWITCH.video[lang]}: ${active(video, mode(g.videoAutoMode))}`,
  ].join(" · ");
}

function cardOf(lang: Lang, s: Situation, mv: Move): Card {
  const page = pagePhrase(lang, nameOf(s.fb));
  const insta = instagramPhrase(lang, nameOf(s.ig));
  const moved = mv.account === "facebook" ? page : insta;
  const toLabel = groupLabel(mv.to, s.groups);
  const to = groupPhrase(lang, clip(toLabel, 60));
  const from = mv.from ? groupPhrase(lang, clip(groupLabel(mv.from, s.groups), 60)) : null;
  const lower = !!mv.from && planRank(mv.to) < planRank(mv.from);
  const lines: CardLine[] = [
    line(FIELD.together[lang], TEXT.together[lang](page, insta)),
    line(FIELD.moves[lang], moved),
    ...(from ? [line(FIELD.from[lang], from)] : []),
    line(NEW.field.to[lang], to),
    line(FIELD.switches[lang], switchesOf(lang, mv.to)),
    ...(from ? [line(FIELD.stays[lang], `${from}: ${remainingPhrase(lang, mv, s)}`)] : []),
    ...(lower && from ? [line(FIELD.warning[lang], TEXT.lowerPlan[lang](to, from))] : []),
    line(NEW.field.note[lang], from ? TEXT.noteFrom[lang](moved, to, from) : TEXT.noteNew[lang](moved, to)),
  ];
  // Confirm acts on these two accounts and this direction, whatever the model wrote.
  return { title: TITLE[lang], lines, pin: { facebook: s.fb.id, instagram: s.ig.id, into: mv.into } };
}

// ---------------------------------------------------------------------------------------------------------------------
// The tool

const schema = z
  .object({
    facebook: z.string().trim().min(1).max(120).optional().describe("The NAME (as show_accounts gives it) or id of the connected Facebook Page. Name both accounts; only when the workspace has exactly one account of a kind may it be left out."),
    instagram: z.string().trim().min(1).max(120).optional().describe("The NAME (as show_accounts gives it, with or without @) or id of the connected Instagram account."),
    into: z
      .enum(["facebook", "instagram"])
      .optional()
      .describe("Only matters when each account sits alone in its own group and either could join the other: 'facebook' = both end up in the Page's group, 'instagram' = in the Instagram account's group. Leave it out unless the owner cares; the card fills it in."),
  })
  .strict();

/** The change refused after the card (the groups changed meanwhile) is told to the person in their language. */
async function guarded(ctx: ToolCtx, run: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await run();
  } catch (e) {
    // P2002: the database refused a second group for the same account (another workspace's group holds it).
    if (e instanceof ToolRefusal || (e as { code?: unknown } | null)?.code === "P2002") return { ok: false, text: NEW.stale[ctx.lang] };
    throw e;
  }
}

const group_accounts = defineWrite({
  name: "group_accounts",
  description:
    "Put a connected Facebook Page and a connected Instagram account into ONE group, so the features that work per group (the daily video, automatic posts and replies) cover both. " +
    "A group holds at most one Page and one Instagram account: this moves one of the two into the group of the other, and from then on it follows that group's switches, shown on the card (old messages, products, settings and the automation on posts already published stay with the old group; nothing is deleted). " +
    "facebook and instagram: the NAME (as show_accounts gives it) or id of the Page and of the Instagram account; name both. " +
    "It refuses, with the reason, when the two are already together or when neither group has room; then tell the owner plainly which group holds which account. " +
    "The owner always confirms on a card first. Use it whenever the owner wants one daily video, automatic posts or replies to cover a Page and an Instagram account that sit in different groups.",
  schema,
  kinds: ["shop"],
  permission: "configure",
  // From then on the accounts follow another group's automation, unwatched: always a card.
  risk: "standing",
  label: (lang) => LABEL[lang],
  async card(ctx, args): Promise<Card> {
    const s = await resolveBoth(ctx.tenantId, args);
    const plan = planRegroup(s.groups, s.fb.id, s.ig.id, args.into);
    if (!plan.ok) {
      if (plan.why === "together") {
        return refuse(`The Facebook Page "${shown(s.fb)}" and the Instagram account "${shown(s.ig)}" are already in the same group, "${modelText(groupLabel(plan.group, s.groups), 60)}". Nothing to do; tell the owner.`);
      }
      return refuse(blockedText(plan, s));
    }
    return cardOf(ctx.lang, s, plan.move);
  },
  async execute(ctx, args): Promise<WriteResult> {
    return guarded(ctx, async () => {
      // The accounts the card showed (their ids are pinned); an account that was disconnected meanwhile is not replaced by another.
      const s = await resolveBoth(ctx.tenantId, args);
      const lang = ctx.lang;
      const page = pagePhrase(lang, nameOf(s.fb));
      const insta = instagramPhrase(lang, nameOf(s.ig));
      const out = await db.$transaction(async (tx) => {
        // Read again inside the transaction: the groups may have changed since the card.
        const groups = await loadGroups(tx, ctx.tenantId);
        const plan = planRegroup(groups, s.fb.id, s.ig.id, args.into);
        if (!plan.ok && plan.why === "together") return { already: plan.group, groups, move: null };
        if (!plan.ok) return refuse("The groups changed after the card was made.");
        const { move } = plan;
        // Each step changes the row only while it still looks as it did a moment ago, so a change made meanwhile is never overwritten.
        if (move.from) {
          const left = await tx.store.updateMany({
            where: move.account === "facebook" ? { id: move.from.id, tenantId: ctx.tenantId, fbPageId: move.accountId } : { id: move.from.id, tenantId: ctx.tenantId, igUserId: move.accountId },
            data: move.account === "facebook" ? { fbPageId: null } : { igUserId: null, igUsername: null },
          });
          if (left.count !== 1) refuse("The group no longer holds that account.");
        }
        // An Instagram account keeps its handle with it: the old group's, else the connected account's name (never a bare id).
        const handle = (move.from?.igUsername ?? (s.ig.name !== s.ig.id ? s.ig.name : "")).replace(/^@/, "").trim() || null;
        const joined = await tx.store.updateMany({
          where: move.account === "facebook" ? { id: move.to.id, tenantId: ctx.tenantId, fbPageId: null } : { id: move.to.id, tenantId: ctx.tenantId, igUserId: null },
          data: move.account === "facebook" ? { fbPageId: move.accountId } : { igUserId: move.accountId, igUsername: handle },
        });
        if (joined.count !== 1) refuse("The group has no room for that account any more.");
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actor: "USER",
            action: move.account === "facebook" ? "store.page_moved" : "store.instagram_moved",
            reasoning: `Put the Facebook Page ${nameOf(s.fb)} and the Instagram account ${nameOf(s.ig)} in one group (from the chat).`,
            metadata: { accountId: move.accountId, fromStoreId: move.from?.id ?? null, storeId: move.to.id, via: "chat", userId: ctx.userId },
          },
        });
        return { already: null, groups, move };
      });
      const toGroup = out.move ? out.move.to : out.already;
      const label = toGroup ? clip(groupLabel(toGroup, out.groups), 60) : "";
      const where = groupPhrase(lang, label);
      // The names are the real ones, cut like the card's: the read-back (verify/accounts.ts) prints them to the person, who must see
      // the same spelling as on the card. This data never goes to the model (group_accounts is always a card; Confirm drops it).
      const base = {
        facebook: s.fb.id,
        instagram: s.ig.id,
        facebookName: nameOf(s.fb),
        instagramName: nameOf(s.ig),
        toGroup: toGroup?.id ?? null,
        toName: label,
      };
      if (!out.move) return { ok: true, text: TEXT.already[lang](page, insta, where), data: { ...base, fromGroup: null, moved: null, nothingChanged: true } };
      return {
        ok: true,
        text: TEXT.done[lang](page, insta, where),
        data: { ...base, fromGroup: out.move.from?.id ?? null, moved: out.move.account },
      };
    });
  },
});

export const ACCOUNT_WRITE_TOOLS: WriteTool[] = [group_accounts];
