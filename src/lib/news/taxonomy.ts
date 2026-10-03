// How stories are sorted: a category, an optional subcategory, and a region.
// Codes are stored on NewsItem; labels are Sorani. A desk's choice is a list of
// "category" or "category/sub" codes; an empty list means everything.

import { nrNewsCkb, type NrNewsText } from "@/lib/i18n/nr/news.ckb";

// The labels are in the dictionaries: t.nr.news.topics, .subtopics and .regions, keyed by these ids.
export const TAXONOMY = [
  { id: "politics", subs: [{ id: "government" }, { id: "elections" }, { id: "diplomacy" }, { id: "parties" }] },
  { id: "economy", subs: [{ id: "energy" }, { id: "salaries" }, { id: "markets" }, { id: "trade" }] },
  { id: "security", subs: [{ id: "conflict" }, { id: "terrorism" }, { id: "crime" }, { id: "accidents" }] },
  { id: "sports", subs: [{ id: "football" }, { id: "local" }, { id: "other" }] },
  { id: "health", subs: [] },
  { id: "tech", subs: [] },
  { id: "society", subs: [{ id: "education" }, { id: "environment" }, { id: "services" }, { id: "humanitarian" }] },
  { id: "culture", subs: [] },
  { id: "other", subs: [] },
] as const;

export const REGIONS = [{ id: "kurdistan" }, { id: "iraq" }, { id: "region" }, { id: "world" }] as const;

export type CategoryId = (typeof TAXONOMY)[number]["id"];
export type RegionId = (typeof REGIONS)[number]["id"];
export interface Classification {
  category: CategoryId;
  subcategory: string | null;
  region: RegionId;
}

const byId = new Map<string, (typeof TAXONOMY)[number]>(TAXONOMY.map((c) => [c.id, c]));
const regionIds = new Set<string>(REGIONS.map((r) => r.id));

/** One AI answer → a clean classification; unknown codes fall back to "other" / "world". */
export function parseClassification(raw: unknown): Classification | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { category?: unknown; subcategory?: unknown; region?: unknown };
  const cat = typeof r.category === "string" && byId.has(r.category) ? byId.get(r.category)! : byId.get("other")!;
  const sub = typeof r.subcategory === "string" && cat.subs.some((s) => s.id === r.subcategory) ? r.subcategory : null;
  const region = typeof r.region === "string" && regionIds.has(r.region) ? (r.region as RegionId) : "world";
  return { category: cat.id, subcategory: sub, region };
}

/** Only known codes; a whole category makes its subs redundant. */
export function normalizeChoice(list: readonly string[]): string[] {
  const whole = new Set(list.filter((c) => !c.includes("/") && byId.has(c)));
  const out = [...whole];
  for (const c of list) {
    if (!c.includes("/")) continue;
    const [cat, sub] = c.split("/");
    if (whole.has(cat) || !byId.get(cat)?.subs.some((s) => s.id === sub)) continue;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The Prisma `where` for a desk's choice. Unclassified stories always pass. */
export function categoryWhere(chosen: readonly string[]): { OR?: Array<Record<string, unknown>> } {
  if (!chosen.length) return {};
  const whole = chosen.filter((c) => !c.includes("/"));
  const subs = chosen.filter((c) => c.includes("/")).map((c) => c.split("/"));
  return {
    OR: [
      { category: null },
      ...(whole.length ? [{ category: { in: whole } }] : []),
      ...subs.map(([category, subcategory]) => ({ category, subcategory })),
    ],
  };
}

/**
 * categoryWhere's rule for one story, in memory, without its "unclassified passes" branch:
 * a story with no category never matches. The autopilot uses it, because it must only act
 * on a story it can place.
 */
export function matchesChoice(category: string | null, subcategory: string | null, chosen: readonly string[]): boolean {
  if (!category) return false;
  if (!chosen.length) return true;
  return chosen.some((c) => {
    if (!c.includes("/")) return c === category;
    const [cat, sub] = c.split("/");
    return cat === category && sub === subcategory;
  });
}

type TopicText = Pick<NrNewsText, "topics" | "subtopics">;

/** A subcategory's own label; null when the pair is unknown. */
export function subcategoryLabel(category: string, subcategory: string, t: TopicText = nrNewsCkb): string | null {
  const subs: Record<string, Record<string, string> | undefined> = t.subtopics;
  return subs[category]?.[subcategory] ?? null;
}

export function categoryLabel(category: string | null, subcategory: string | null, t: TopicText = nrNewsCkb): string | null {
  const c = category ? byId.get(category) : undefined;
  if (!c) return null;
  const s = subcategory ? c.subs.find((x) => x.id === subcategory) : undefined;
  return s ? `${t.topics[c.id]} · ${subcategoryLabel(c.id, s.id, t)}` : t.topics[c.id];
}

export function regionLabel(region: string | null, t: Pick<NrNewsText, "regions"> = nrNewsCkb): string | null {
  const r = REGIONS.find((x) => x.id === region);
  return r ? t.regions[r.id] : null;
}
