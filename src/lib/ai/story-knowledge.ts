// What the story reviewer (review-idea.ts, kind "story") reads about a page, loaded by the store's id: what the owner told Gituas about
// the page (the business profile: what it is about, the goal, the audience), the page's name and the names of its connected accounts, and
// the hooks and subjects of the page's earlier story videos (so a case is not told twice). It is DATA for the reviewer, never instructions,
// and every read is tolerant: a table that cannot be read is no knowledge, never an error.

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { langAndKindOf } from "@/lib/advideo/lang";
import { accountsPhraseOf, brandNameOf } from "@/lib/shop/brand-name";
import { loadProfile } from "@/lib/shop/profile";

/** What the owner's profile says about the page, in the profile's own words and ids. Keys that hold nothing are left out. */
export interface PageAbout {
  /** sell | monetize | other (and the older grow, leads). */
  goal?: string;
  goal_in_owner_words?: string;
  what_the_page_offers_or_is_about?: string;
  category?: string;
  audience?: string[];
  tone?: string;
}

export interface EarlierStory {
  /** The first line of the video (its hook), as it was shown. */
  hook: string | null;
  /** The real case or invented story it was about. */
  subject: string | null;
}

export interface StoryKnowledge {
  brand: string | null;
  /** The connected accounts by the names they carry now ("The Secret File + @thesecretfile26"); null when it adds nothing to the brand. */
  accounts: string | null;
  about: PageAbout | null;
  earlier: EarlierStory[];
}

/** How many of the page's earlier stories are read. */
const EARLIER_MAX = 10;

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? Array.from(t).slice(0, max).join("") : null;
};

/**
 * Whether Gituas knows nothing about the page: no profile content and no earlier story. The page's name alone is not knowledge
 * (a page always has one), so a review has nothing to go on and the owner's words stand.
 */
export function storyKnowledgeEmpty(k: StoryKnowledge | null | undefined): boolean {
  return !k || (!k.about && k.earlier.length === 0);
}

/** The earlier stories of a page from its stored specs (a tolerant reader: a spec of any other shape is skipped). */
export function earlierStoriesOf(specs: unknown[]): EarlierStory[] {
  const out: EarlierStory[] = [];
  for (const spec of specs) {
    if (!spec || typeof spec !== "object") continue;
    if (langAndKindOf(spec).kind !== "story") continue;
    const s = spec as { scenes?: unknown; subject?: unknown };
    const scenes = Array.isArray(s.scenes) ? (s.scenes as { type?: unknown; text?: unknown }[]) : [];
    const hook = clip(scenes.find((x) => x && x.type === "hook")?.text, 120);
    const subject = clip((s.subject as { name?: unknown } | null | undefined)?.name, 100);
    if (!hook && !subject) continue;
    out.push({ hook, subject });
    if (out.length >= EARLIER_MAX) break;
  }
  return out;
}

export async function loadStoryKnowledge(storeId: string): Promise<StoryKnowledge> {
  const store = await Promise.resolve()
    .then(() => db.store.findUnique({ where: { id: storeId }, select: { tenantId: true, name: true, igUsername: true, fbPageId: true, igUserId: true } }))
    .catch(() => null);
  let brand: string | null = null;
  let accounts: string | null = null;
  if (store) {
    brand = clip(await brandNameOf(store).catch(() => store.name), 80);
    const phrase = clip(await accountsPhraseOf(store).catch(() => ""), 140);
    accounts = phrase && phrase !== brand ? phrase : null;
  }

  const profile = await loadProfile(storeId).catch(() => null);
  const about: PageAbout = {};
  if (profile) {
    if (profile.goal) about.goal = profile.goal;
    const goalText = clip(profile.goalText, 200);
    if (goalText) about.goal_in_owner_words = goalText;
    const offer = clip(profile.offerLine, 140);
    if (offer) about.what_the_page_offers_or_is_about = offer;
    if (profile.category && profile.category !== "other") about.category = profile.category;
    if (profile.customer.length) about.audience = profile.customer.slice(0, 7);
    if (profile.tone) about.tone = profile.tone;
  }

  const rows = await Promise.resolve()
    .then(() => db.adVideo.findMany({ where: { storeId, spec: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, take: 30, select: { spec: true } }))
    .catch(() => [] as { spec: unknown }[]);
  const earlier = earlierStoriesOf(rows.map((r) => r.spec));

  return { brand, accounts, about: Object.keys(about).length ? about : null, earlier };
}
