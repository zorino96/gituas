// What the news desk's write tools share: the two checks every one of them makes first (the desk the session is on is the desk the
// run belongs to, and a frozen desk may only read), the story lookup, the connected Pages, the plan's monthly numbers and the
// address a card is rendered from. Nothing here changes anything.

import { z } from "zod";

import { loadAccountLists } from "@/app/app/data";
import { usageOf } from "@/lib/billing/limits";
import { NEWS_LIMITS, type Metric, type NewsLimits } from "@/lib/billing/plans";
import { defineWrite, ToolRefusal, type ToolCtx, type WriteResult, type WriteTool, type WriteToolDef } from "@/lib/chat/types";
import { db } from "@/lib/db";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { deskFor, frozenRefusal, planOf } from "./news-common";
import { refuse } from "./writes-common";
import { NW } from "./writes-news-words";

export type Platform = "FB" | "IG";

/** A story is the desk's NewsItem; the id is the one list_stories and get_story give. */
export const storyId = z.string().trim().min(1).max(60).describe("The story's id exactly as list_stories or get_story gives it");
/** A file attached in this chat ("a1"). */
export const attId = z.string().regex(/^a\d{1,2}$/);
/** A connected Page or Instagram account: its id as get_desk_settings (accounts) lists it, with or without the prefix "FB:" / "IG:" (a bare id works when exactly one account has it). */
export const accountRef = z
  .string()
  .trim()
  .regex(/^((FB|IG):)?[0-9]{3,40}$/, "an account reference such as FB:1234567890");
export const platforms = z.array(z.enum(["FB", "IG"])).min(1).max(2);

// ---------------------------------------------------------------------------------------------------------------------
// The two checks every desk tool makes.

/** Stops a run (not a card) that is for another desk than the session's, or for a desk that is frozen. The sentence is for the person. */
export async function newsRunGuard(ctx: ToolCtx): Promise<WriteResult | null> {
  try {
    await deskFor(ctx);
  } catch (e) {
    if (e instanceof ToolRefusal) return { ok: false, text: NW.wrongDesk[ctx.lang] };
    throw e;
  }
  try {
    await frozenRefusal(ctx);
  } catch (e) {
    if (e instanceof ToolRefusal) return { ok: false, text: NW.frozen[ctx.lang] };
    throw e;
  }
  return null;
}

/** The same two checks for a card; a refusal goes to the model, which tells the person. */
export async function newsCardGuard(ctx: ToolCtx): Promise<void> {
  await deskFor(ctx);
  await frozenRefusal(ctx);
}

type NewsDef<S extends z.ZodTypeAny> = Omit<WriteToolDef<S>, "kinds">;

/**
 * A write tool of the news desk. The desk check and the frozen check come first in BOTH card() and execute(), so no tool can forget
 * them; a run that finds things changed since its card (a refusal inside execute) says so in the person's language instead of failing
 * loudly.
 */
export function defineNews<S extends z.ZodTypeAny>(def: NewsDef<S>): WriteTool {
  return defineWrite<S>({
    ...def,
    kinds: ["news"],
    async card(ctx, args) {
      await newsCardGuard(ctx);
      return def.card(ctx, args);
    },
    async execute(ctx, args) {
      const stopped = await newsRunGuard(ctx);
      if (stopped) return stopped;
      try {
        return await def.execute(ctx, args);
      } catch (e) {
        if (e instanceof ToolRefusal) return { ok: false, text: NW.stale[ctx.lang] };
        throw e;
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Stories.

/** The desk's story with its draft, or a refusal that tells the model which id to use. */
export async function storyOf(ctx: ToolCtx, id: string) {
  const item = await db.newsItem.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { draft: true } });
  if (!item) return refuse(`There is no story with id "${id}" on this desk. Use an id from list_stories or get_story.`);
  return item;
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan's numbers.

export function limitsOfPlan(plan: string): NewsLimits {
  return (NEWS_LIMITS as Record<string, NewsLimits>)[plan] ?? NEWS_LIMITS.MANUAL;
}

/** How much of a month's count the desk has used and what its plan allows. */
export async function quotaOf(tenantId: string, metric: Metric): Promise<{ used: number; limit: number; plan: string }> {
  const [plan, used] = await Promise.all([planOf(tenantId), usageOf(tenantId, metric)]);
  return { used, limit: limitsOfPlan(plan)[metric], plan };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connected Pages and Instagram accounts.

export interface PageRef {
  id: string;
  name: string;
}
export type Pages = Record<Platform, PageRef[]>;

/** The desk's usable Pages and Instagram accounts, from its connections (a desk has no store). */
export async function pagesOf(tenantId: string): Promise<Pages> {
  const lists = await loadAccountLists(tenantId);
  const pick = (l: { id: string; name: string }[]): PageRef[] => l.map((a) => ({ id: a.id, name: a.name }));
  return { FB: pick(lists.META_FACEBOOK), IG: pick(lists.META_INSTAGRAM) };
}

export const platformLabel = (p: Platform): string => (p === "FB" ? "Facebook" : "Instagram");
export const refOf = (p: Platform, id: string): string => `${p}:${id}`;

/** The accounts of a platform as the model reads them in a refusal: "FB:123 (Page name), FB:456 (Other)". */
export function optionsOf(pages: Pages, p: Platform): string {
  return pages[p].map((a) => `${refOf(p, a.id)} (${a.name})`).join(", ");
}

export const NOT_CONNECTED = (p: Platform) => `${platformLabel(p)} is not connected on this desk. The person has to connect it in Settings; you cannot do that for them.`;

/**
 * Account references as clean "FB:<id>" strings, each one really a connected account of a platform the action is for. A bare id is
 * accepted when exactly one connected account has it. Anything else is refused with the choices, so the model never guesses.
 */
export function resolveRefs(pages: Pages, refs: readonly string[], targets: readonly Platform[], max: number): string[] {
  const out: string[] = [];
  for (const raw of refs) {
    const m = /^(?:(FB|IG):)?([0-9]{3,40})$/.exec(raw.trim());
    if (!m) return refuse(`"${raw}" is not an account reference. Use FB:<id> or IG:<id> from get_desk_settings.`);
    let platform = m[1] as Platform | undefined;
    if (!platform) {
      const hits = (["FB", "IG"] as const).filter((p) => pages[p].some((a) => a.id === m[2]));
      if (hits.length !== 1) return refuse(`The account "${raw}" is not one connected account of this desk (or it is ambiguous). Use FB:<id> or IG:<id> from get_desk_settings.`);
      platform = hits[0];
    }
    if (!pages[platform].some((a) => a.id === m[2])) {
      return refuse(`${refOf(platform, m[2])} is not a connected ${platformLabel(platform)} account of this desk. ${pages[platform].length ? `Choose from: ${optionsOf(pages, platform)}.` : NOT_CONNECTED(platform)}`);
    }
    if (!targets.includes(platform)) return refuse(`${refOf(platform, m[2])} is a ${platformLabel(platform)} account, but ${platformLabel(platform)} is not among the platforms chosen.`);
    const ref = refOf(platform, m[2]);
    if (!out.includes(ref)) out.push(ref);
  }
  for (const p of ["FB", "IG"] as const) {
    if (out.filter((r) => r.startsWith(`${p}:`)).length > max) return refuse(`At most ${max} ${platformLabel(p)} accounts can be chosen.`);
  }
  return out;
}

/** "FB:1,FB:2,IG:3" as the per-platform lists a post takes. */
export function byPlatform(refs: readonly string[]): Partial<Record<Platform, string[]>> {
  const out: Partial<Record<Platform, string[]>> = {};
  for (const r of refs) {
    const [p, id] = r.split(":") as [Platform, string];
    (out[p] ??= []).push(id);
  }
  return out;
}

/** The name of an account for a card line. */
export function nameOf(pages: Pages, ref: string): string {
  const [p, id] = ref.split(":") as [Platform, string];
  return pages[p]?.find((a) => a.id === id)?.name ?? ref;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering a card.

/**
 * Where the card's render page is opened. In production it is always the newsroom's own domain; the app URL from the environment, or
 * localhost, is used only outside production. (A copy of renderOrigin in src/lib/news/autopilot.ts: that file is big and imports the
 * whole autopilot, which a route should not pull in for one string.)
 */
export function renderOrigin(): string {
  if (process.env.NODE_ENV === "production") return NEWSROOM_ORIGIN;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "http://localhost:3001";
}

/** One line of the person's sentence for a yes/no. */
export const yesNo = (ctx: ToolCtx, on: boolean): string => (on ? NW.on[ctx.lang] : NW.off[ctx.lang]);
