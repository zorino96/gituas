// How stories are sorted: a category, an optional subcategory, and a region.
// Codes are stored on NewsItem; labels are Sorani. A desk's choice is a list of
// "category" or "category/sub" codes; an empty list means everything.

export const TAXONOMY = [
  {
    id: "politics",
    label: "سیاسەت",
    subs: [
      { id: "government", label: "حکومەت و پەرلەمان" },
      { id: "elections", label: "هەڵبژاردن" },
      { id: "diplomacy", label: "پەیوەندیی نێودەوڵەتی" },
      { id: "parties", label: "پارتە سیاسییەکان" },
    ],
  },
  {
    id: "economy",
    label: "ئابووری",
    subs: [
      { id: "energy", label: "نەوت و وزە" },
      { id: "salaries", label: "مووچە و بودجە" },
      { id: "markets", label: "بازاڕ و دراو" },
      { id: "trade", label: "بازرگانی و وەبەرهێنان" },
    ],
  },
  {
    id: "security",
    label: "ئاسایش",
    subs: [
      { id: "conflict", label: "جەنگ و ململانێ" },
      { id: "terrorism", label: "تیرۆر" },
      { id: "crime", label: "تاوان و پۆلیس" },
      { id: "accidents", label: "ڕووداو و کارەسات" },
    ],
  },
  {
    id: "sports",
    label: "وەرزش",
    subs: [
      { id: "football", label: "تۆپی پێ" },
      { id: "local", label: "وەرزشی کوردستان و عێراق" },
      { id: "other", label: "وەرزشەکانی تر" },
    ],
  },
  { id: "health", label: "تەندروستی", subs: [] },
  { id: "tech", label: "زانست و تەکنەلۆژیا", subs: [] },
  {
    id: "society",
    label: "کۆمەڵگە",
    subs: [
      { id: "education", label: "پەروەردە و خوێندن" },
      { id: "environment", label: "ژینگە و کەشوهەوا" },
      { id: "services", label: "کارەبا، ئاو و خزمەتگوزاری" },
      { id: "humanitarian", label: "کۆچ و بارودۆخی مرۆیی" },
    ],
  },
  { id: "culture", label: "کلتوور و هونەر", subs: [] },
  { id: "other", label: "ئەوانی تر", subs: [] },
] as const;

export const REGIONS = [
  { id: "kurdistan", label: "کوردستان" },
  { id: "iraq", label: "عێراق" },
  { id: "region", label: "ناوچەکە" },
  { id: "world", label: "جیهان" },
] as const;

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

export function categoryLabel(category: string | null, subcategory: string | null): string | null {
  const c = category ? byId.get(category) : undefined;
  if (!c) return null;
  const s = subcategory ? c.subs.find((x) => x.id === subcategory) : undefined;
  return s ? `${c.label} · ${s.label}` : c.label;
}

export function regionLabel(region: string | null): string | null {
  return REGIONS.find((r) => r.id === region)?.label ?? null;
}
