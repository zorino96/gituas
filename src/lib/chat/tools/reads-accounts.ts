// show_accounts: the person's connected Facebook Pages, Instagram accounts, TikTok and YouTube channels in one look, which one the chat
// works on now, and which group each Page and Instagram account sits in. The person also gets live controls under the answer (the
// "accounts" block: Connect another, Choose which one the chat uses), so nobody has to leave the chat for Settings.
//
// A group is what the app stores as a shop (a Store row): at most one Facebook Page and one Instagram account that the daily video, the
// automatic posts and the replies run for together. The model reads the accounts by NAME only (no ids), names cut to 60 characters.
//
// This file also holds what the account tools share: how a group is read, named and ranked.

import { z } from "zod";

import { loadAccountLists, loadConnections, type AccountLists, type AccountRef } from "@/app/app/data";
import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/lang";
import { can, type Role } from "@/lib/newsroom/roles";
import { defineRead, type ReadResult, type ReadTool, type ViewBlock } from "../types";
import { isolateLtr, MODEL_ITEMS_MAX, modelText } from "./reads-shared";
import { quoted } from "./rules-words";
import { words } from "./writes-common";

// ---------------------------------------------------------------------------------------------------------------------
// Groups (the shop rows), read the same way by every account tool

/** A group as the account tools read it. */
export interface GroupRow {
  id: string;
  name: string;
  igUsername: string | null;
  fbPageId: string | null;
  igUserId: string | null;
  plan: string;
  planPaidUntil: Date | null;
  createdAt: Date;
  /** The group's switches (what the Page or Instagram account follows once it is in the group): replies on/off, automatic posts, daily video, paused. */
  automationEnabled: boolean;
  autoMode: string;
  videoAutoMode: string;
  pausedReason: string | null;
}

export const GROUP_SELECT = {
  id: true,
  name: true,
  igUsername: true,
  fbPageId: true,
  igUserId: true,
  plan: true,
  planPaidUntil: true,
  createdAt: true,
  automationEnabled: true,
  autoMode: true,
  videoAutoMode: true,
  pausedReason: true,
} as const;
/** A workspace has at most this many groups (the same cap the rest of the app reads with). */
export const MAX_GROUPS = 15;

/** The workspace's groups, oldest first. Always inside one workspace. `client` is the database, or a transaction of it. */
export function loadGroups(client: Pick<typeof db, "store">, tenantId: string): Promise<GroupRow[]> {
  return client.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: MAX_GROUPS, select: GROUP_SELECT });
}

/** The name of a group the way the app names it: its own name, else the Instagram handle, else its place in the list. */
export function groupLabel(g: Pick<GroupRow, "name" | "igUsername" | "id">, all: readonly Pick<GroupRow, "id">[]): string {
  const own = g.name.replace(/\s+/g, " ").trim();
  if (own) return own;
  if (g.igUsername) return `@${g.igUsername}`;
  const at = all.findIndex((x) => x.id === g.id);
  return `#${at < 0 ? 1 : at + 1}`;
}

const PLAN_RANK: Record<string, number> = { FREE: 0, MERCHANT: 1, PRO: 2, MAX: 3, UNLIMITED: 4 };
/** How big a group's plan is right now: a paid plan whose days ran out counts as Free, as it does everywhere else. */
export function planRank(g: Pick<GroupRow, "plan" | "planPaidUntil">, now = Date.now()): number {
  const lapsed = g.plan !== "FREE" && !!g.planPaidUntil && g.planPaidUntil.getTime() < now;
  return lapsed ? 0 : (PLAN_RANK[g.plan] ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// The accounts as words (the person's three languages)

/** "the Facebook Page «X»", with or without the name. */
export function pagePhrase(lang: Lang, name?: string | null): string {
  const n = name ? quoted(name, lang) : "";
  if (lang === "ckb") return n ? `پەیجی فەیسبووک ${n}` : "پەیجی فەیسبووک";
  if (lang === "ar") return n ? `صفحة فيسبوك ${n}` : "صفحة فيسبوك";
  return n ? `the Facebook Page ${n}` : "the Facebook Page";
}

/** "@handle" with the right edge in right-to-left text: the @ must stay in front of the Latin letters. */
const handleOf = (name: string, lang: Lang): string => {
  const h = `@${name.replace(/^@/, "")}`;
  return lang === "en" ? h : isolateLtr(h);
};

/** "the Instagram account @x", with or without the name. */
export function instagramPhrase(lang: Lang, name?: string | null): string {
  const h = name ? handleOf(name, lang) : "";
  if (lang === "ckb") return h ? `ئەکاونتی ئینستاگرام ${h}` : "ئەکاونتی ئینستاگرام";
  if (lang === "ar") return h ? `حساب إنستغرام ${h}` : "حساب إنستغرام";
  return h ? `the Instagram account ${h}` : "the Instagram account";
}

/** "the group «X»". */
export function groupPhrase(lang: Lang, label: string): string {
  const n = quoted(label, lang);
  if (lang === "ckb") return `گرووپی ${n}`;
  if (lang === "ar") return `المجموعة ${n}`;
  return `the group ${n}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// show_accounts

const W = {
  working: words("هەژمارە بەستراوەکانت دەخوێنمەوە…", "أقرأ حساباتك المربوطة…", "Reading your connected accounts…"),
  readOnly: words(
    "ئەم ڕۆڵەی تۆ تەنها دەتوانێت ببینێت. بۆ بەستنی هەژمارێکی نوێ یان گۆڕینی هەژمار، داوا لە خاوەنەکە یان بەڕێوەبەرەکە بکە.",
    "دورك الحالي للعرض فقط. لربط حساب جديد أو تبديل الحساب اطلب من المالك أو المسؤول.",
    "Your role can only look. To connect a new account or switch to another one, ask the owner or an admin.",
  ),
};

/** What the person may do with the accounts: connect, switch and regroup need the right to change settings. */
const mayChange = (role: Role): boolean => can(role, "configure");

const clipName = (name: string | null | undefined): string => modelText(name, 60) || "(no name)";

type Slot = "facebook" | "instagram";
const nameById = (list: readonly AccountRef[], id: string | null): string | null => {
  if (!id) return null;
  const hit = list.find((a) => a.id === id);
  return hit ? clipName(hit.name) : null;
};

/** The shape the model reads. English keys; no ids; names cut. */
export function accountsForModel(i: {
  lists: AccountLists;
  /** The account each platform's tools act as right now (ids, from the person's choice or the newest connection). */
  active: { facebook?: string; instagram?: string; tiktok?: string; youtube?: string };
  groups: readonly GroupRow[];
  mayChange: boolean;
}): Record<string, unknown> {
  const groupOf = (slot: Slot, id: string): string | null => {
    const g = i.groups.find((x) => (slot === "facebook" ? x.fbPageId : x.igUserId) === id);
    return g ? clipName(groupLabel(g, i.groups)) : null;
  };
  const plain = (list: readonly AccountRef[], active: string | undefined) =>
    list.slice(0, MODEL_ITEMS_MAX).map((a) => ({ name: clipName(a.name), usedByChat: a.id === active }));
  const grouped = (list: readonly AccountRef[], slot: Slot, active: string | undefined) =>
    list.slice(0, MODEL_ITEMS_MAX).map((a) => ({ name: clipName(a.name), usedByChat: a.id === active, group: groupOf(slot, a.id) }));
  // A slot that holds an account which is no longer connected (an expired token) says so instead of looking empty.
  const held = (list: readonly AccountRef[], id: string | null, igUsername: string | null): string | null =>
    id ? (nameById(list, id) ?? (igUsername ? clipName(`@${igUsername}`) : "(not connected now)")) : null;
  return {
    platforms: {
      facebook: grouped(i.lists.META_FACEBOOK, "facebook", i.active.facebook),
      instagram: grouped(i.lists.META_INSTAGRAM, "instagram", i.active.instagram),
      tiktok: plain(i.lists.TIKTOK, i.active.tiktok),
      youtube: plain(i.lists.YOUTUBE, i.active.youtube),
    },
    groups: i.groups.map((g) => ({
      name: clipName(groupLabel(g, i.groups)),
      facebook: held(i.lists.META_FACEBOOK, g.fbPageId, null),
      instagram: held(i.lists.META_INSTAGRAM, g.igUserId, g.igUsername),
    })),
    youMayChange: i.mayChange,
    notes: [
      i.mayChange
        ? "The person now has live buttons under your answer: Connect (another Facebook Page, Instagram account, TikTok or YouTube channel) and Choose (which Facebook Page or Instagram account the chat works on; TikTok and YouTube can only be connected). Tell them in one sentence to use the buttons; never send them to Settings for this. A choice takes effect from their next message."
        : "This person's role can only look: they get no buttons, and group_accounts is not available to them. Say plainly that the owner or an admin connects, switches and regroups accounts.",
      "usedByChat marks the account every tool of this chat acts as right now, per platform. When a platform has several accounts, say which one that is.",
      "A group is one Facebook Page plus one Instagram account that the daily video, automatic posts and replies run for together. group: null means the account is not in any group yet. Never call it a shop; name the accounts themselves and use the group's name only to tell two groups apart.",
      "To put a Page and an Instagram account that sit in different groups together, call group_accounts (it shows a card).",
    ],
  };
}

const show_accounts = defineRead({
  name: "show_accounts",
  description:
    "The person's connected accounts in one look: Facebook Pages, Instagram accounts, TikTok and YouTube channels, which one the chat works on now (usedByChat), and which group each Page and Instagram account sits in (a group is one Page plus one Instagram account that run together). " +
    "The person also gets live buttons in the chat to connect another account and to choose which one the chat uses. Call it whenever the owner wants to connect, add, switch or choose an account, asks which accounts are connected, or asks which Page or Instagram account you are working on; never send them to Settings for that. " +
    "After they choose, their next message acts as the chosen account. It takes no arguments.",
  schema: z.object({}).strict(),
  kinds: ["shop"] as const,
  permission: "read",
  risk: "read",
  label: (lang) => W.working[lang],
  async run(ctx): Promise<ReadResult> {
    // loadConnections is narrowed to the person's choice (the whole chat turn runs as the chosen accounts); the lists are not.
    const [lists, conns, groups] = await Promise.all([loadAccountLists(ctx.tenantId), loadConnections(ctx.tenantId), loadGroups(db, ctx.tenantId)]);
    const change = mayChange(ctx.role);
    const view: ViewBlock[] = change ? [{ kind: "accounts" }] : [{ kind: "note", text: W.readOnly[ctx.lang], tone: "info" }];
    return {
      data: accountsForModel({
        lists,
        active: {
          facebook: conns.META_FACEBOOK.accountId,
          instagram: conns.META_INSTAGRAM.accountId,
          tiktok: conns.TIKTOK.accountId,
          youtube: conns.YOUTUBE.accountId,
        },
        groups,
        mayChange: change,
      }),
      view,
    };
  },
});

export const ACCOUNT_READ_TOOLS: ReadTool[] = [show_accounts];
