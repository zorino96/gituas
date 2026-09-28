# News sources catalog, categories and filters · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A news desk can switch on sources from a curated catalog of about 28 checked outlet feeds, in four groups: world, Middle East, Kurdistan and official.
- Every story is classified automatically: a category, an optional subcategory, and a region.
- The desk chooses which categories to bring in, and filters the news page by category, region, language and source.

**Owner decisions (2026-09-28):**
- Website RSS first. Facebook Pages as a source comes later: Meta's Page Public Content Access needs a review.
- Outlet feeds bring everything; categories decide what is kept. The keyword filter for RSS becomes an opt-in switch.

**Architecture:**
- **Catalog.** `src/lib/news/catalog.ts` becomes the full list: two keyword APIs plus the outlet feeds, each with a group and a language. Switching an entry on still creates a `NewsSource` row with `catalogId`.
- **Taxonomy.** A fixed taxonomy lives in `src/lib/news/taxonomy.ts`.
- **Classification.** New stories are classified in batches of 20 headlines per DeepSeek call (`strength: "fast"`) at the end of `ingest()`. The result is stored on `NewsItem.category`, `.subcategory` and `.region`.
- **Filtering.** The desk's choice (`NewsSettings.categories`) and the page's filter chips become Prisma `where` clauses. Unclassified stories are never hidden.

**Facts checked on 2026-09-28 (live):**
- The feeds listed in Task 1 answered with items (BBC, Al Jazeera, France 24, DW, Sky News Arabia, Euronews, The Guardian, Anadolu ×3, Asharq Al-Awsat, Independent Arabia, Shafaq ×3, Alsumaria, Al-Mada, Kurdistan24 ×3, Esta, UN News ×2).
- Rudaw, NRT, Kurdsat, Speda, Kanal 8, AVA, BasNews, Waar and Al Arabiya have no public RSS; the KRG site and INA return 403. GDELT has no articles for rudaw.net.

**Tech Stack:** Next.js 16, Prisma 7 (`db push`), vitest, DeepSeek via `completeJson` in `src/lib/ai/provider.ts`.

**Branch:** `news-sources-catalog`, cut from `master`.

## Conventions

These are the same as in the newsroom plans:
- UI text is Sorani and RTL.
- Tests go in `tests/**`. Run them with `npx vitest run`; type-check with `npx tsc --noEmit`.
- Commits are plain sentences and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print `.env*`.
- The shell is Git Bash; quote paths that contain parentheses.
- Every server action checks the role: `configure` for settings.

---

### Task 1: The catalog

**Files:** Modify `src/lib/news/catalog.ts` (full replacement) and `tests/news/catalog.test.ts` (full replacement).

- [ ] **Step 1: Replace `tests/news/catalog.test.ts`:**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG, catalogAvailable, catalogEntry, GROUPS } from "@/lib/news/catalog";

afterEach(() => vi.unstubAllEnvs());

describe("catalog", () => {
  it("has unique ids and known groups", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    const groups = GROUPS.map((g) => g.id);
    for (const c of CATALOG) expect(groups).toContain(c.group);
  });
  it("gives every outlet feed an https RSS address and a language", () => {
    for (const c of CATALOG.filter((x) => x.group !== "api")) {
      expect(c.rss).toMatch(/^https:\/\//);
      expect(c.lang).not.toBeNull();
    }
  });
  it("keeps GDELT's required citation", () => {
    expect(catalogEntry("gdelt")?.attribution?.url).toBe("https://www.gdeltproject.org/");
  });
  it("offers NewsData only when its key is set", () => {
    vi.stubEnv("NEWSDATA_API_KEY", "");
    expect(catalogAvailable().some((c) => c.id === "newsdata")).toBe(false);
    vi.stubEnv("NEWSDATA_API_KEY", "k");
    expect(catalogAvailable().some((c) => c.id === "newsdata")).toBe(true);
  });
  it("offers every outlet feed without any key", () => {
    vi.stubEnv("NEWSDATA_API_KEY", "");
    expect(catalogAvailable().filter((c) => c.group !== "api").length).toBe(CATALOG.filter((c) => c.group !== "api").length);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/news/catalog.test.ts`. It should FAIL because `catalogEntry` and `GROUPS` are missing.

- [ ] **Step 3: Replace `src/lib/news/catalog.ts`:**

```ts
// The sources Gituas offers every news page.
// - The two APIs search by the page's keywords. GDELT is free, and its terms
//   ask for a citation wherever its data is shown.
// - The outlet feeds bring everything they publish, and the page's category
//   choice decides what it keeps. Each one was checked working on 2026-09-28.
//   Kurdish outlets with no public RSS (Rudaw, NRT, Kurdsat, …) aren't here.
// A page can still add any other feed itself, and is responsible for it (/terms).

export type SourceGroup = "api" | "world" | "region" | "kurdistan" | "official";
export type SourceLang = "ar" | "en" | "tr" | "ckb";

export interface CatalogSource {
  id: string;
  name: string;
  group: SourceGroup;
  /** The language an outlet publishes in; the APIs cover many. */
  lang: SourceLang | null;
  /** APIs only: one line of Kurdish about what it does. */
  description?: string;
  /** Outlet feeds only. */
  rss?: string;
  /** Environment variable the source needs, if any. */
  needsEnv?: string;
  /** Citation the source's terms require wherever its data is shown. */
  attribution?: { label: string; url: string };
}

export const GROUPS: readonly { id: SourceGroup; label: string }[] = [
  { id: "api", label: "گەڕان بە وشە سەرەکییەکان" },
  { id: "world", label: "جیهانی" },
  { id: "region", label: "ڕۆژهەڵاتی ناوەڕاست" },
  { id: "kurdistan", label: "کوردستان" },
  { id: "official", label: "فەرمی" },
];

export const LANG_LABEL: Record<SourceLang, string> = { ar: "عەرەبی", en: "ئینگلیزی", tr: "تورکی", ckb: "کوردی" };

const feed = (id: string, name: string, group: SourceGroup, lang: SourceLang, rss: string): CatalogSource => ({ id, name, group, lang, rss });

export const CATALOG: CatalogSource[] = [
  {
    id: "gdelt",
    name: "GDELT",
    group: "api",
    lang: null,
    description: "هەواڵی جیهان بە +٦٥ زمان، بەپێی وشە سەرەکییەکانت. بەخۆڕایی.",
    attribution: { label: "GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "newsdata",
    name: "NewsData.io",
    group: "api",
    lang: null,
    description: "هەواڵی عەرەبی و ئینگلیزی بەپێی وشە سەرەکییەکانت. ١٢ کاتژمێر دواکەوتوو.",
    needsEnv: "NEWSDATA_API_KEY",
    attribution: { label: "NewsData.io", url: "https://newsdata.io/" },
  },
  feed("bbc-ar", "BBC عربي", "world", "ar", "https://feeds.bbci.co.uk/arabic/rss.xml"),
  feed("bbc-en", "BBC News — Middle East", "world", "en", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
  feed("aljazeera-ar", "الجزيرة نت", "world", "ar", "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9"),
  feed("aljazeera-en", "Al Jazeera English", "world", "en", "https://www.aljazeera.com/xml/rss/all.xml"),
  feed("france24-ar", "فرانس 24", "world", "ar", "https://www.france24.com/ar/rss"),
  feed("france24-en", "France 24 — Middle East", "world", "en", "https://www.france24.com/en/middle-east/rss"),
  feed("dw-ar", "DW عربية", "world", "ar", "https://rss.dw.com/xml/rss-ar-all"),
  feed("dw-en", "DW", "world", "en", "https://rss.dw.com/xml/rss-en-all"),
  feed("skynews-ar", "سكاي نيوز عربية", "world", "ar", "https://www.skynewsarabia.com/rss"),
  feed("euronews-ar", "يورونيوز", "world", "ar", "https://arabic.euronews.com/rss"),
  feed("euronews-en", "Euronews", "world", "en", "https://www.euronews.com/rss"),
  feed("guardian-world", "The Guardian — World", "world", "en", "https://www.theguardian.com/world/rss"),
  feed("aa-ar", "الأناضول", "region", "ar", "https://www.aa.com.tr/ar/rss/default?cat=guncel"),
  feed("aa-en", "Anadolu Agency", "region", "en", "https://www.aa.com.tr/en/rss/default?cat=guncel"),
  feed("aa-tr", "Anadolu Ajansı", "region", "tr", "https://www.aa.com.tr/tr/rss/default?cat=guncel"),
  feed("aawsat", "الشرق الأوسط", "region", "ar", "https://aawsat.com/feed"),
  feed("independent-ar", "اندبندنت عربية", "region", "ar", "https://www.independentarabia.com/rss.xml"),
  feed("shafaq-ar", "شفق نيوز", "region", "ar", "https://shafaq.com/rss/ar"),
  feed("shafaq-en", "Shafaq News", "region", "en", "https://shafaq.com/rss/en"),
  feed("alsumaria", "السومرية نيوز", "region", "ar", "https://www.alsumaria.tv/Rss/iraq-latest-news/ar"),
  feed("almada", "المدى", "region", "ar", "https://almadapaper.net/feed/"),
  feed("k24-ckb", "کوردستان٢٤", "kurdistan", "ckb", "https://www.kurdistan24.net/ckb/rss.xml"),
  feed("k24-ar", "كوردستان 24", "kurdistan", "ar", "https://www.kurdistan24.net/ar/rss.xml"),
  feed("k24-en", "Kurdistan24", "kurdistan", "en", "https://www.kurdistan24.net/en/rss.xml"),
  feed("shafaq-ku", "شەفەق نیوز", "kurdistan", "ckb", "https://shafaq.com/rss/ku"),
  feed("esta", "ئێستا", "kurdistan", "ckb", "https://esta.krd/feed/"),
  feed("un-ar", "أخبار الأمم المتحدة", "official", "ar", "https://news.un.org/feed/subscribe/ar/news/all/rss.xml"),
  feed("un-en", "UN News — Middle East", "official", "en", "https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml"),
];

export function catalogAvailable(): CatalogSource[] {
  return CATALOG.filter((c) => !c.needsEnv || !!process.env[c.needsEnv]);
}

export function catalogEntry(id: string): CatalogSource | undefined {
  return catalogAvailable().find((c) => c.id === id);
}
```

- [ ] **Step 4: Fix the callers** until `npx tsc --noEmit` is clean. `CatalogId` no longer exists; use `string`.
  - `src/app/app/settings/news-settings.tsx`: remove the `CatalogId` import and type `id` as `string`.
  - `src/app/newsroom/(desk)/news/actions.ts`:
    - `toggleCatalogSourceAction(catalogId: string, …)` uses `catalogEntry(catalogId)` instead of `catalogAvailable().find(…)`.
    - Fix the import.
  - `src/app/newsroom/(desk)/news/page.tsx`: the attribution list must only use entries that have one:

```tsx
  const attributions = CATALOG.filter((c) => c.attribution && catalogSources.some((s) => s.catalogId === c.id));
```

  In its JSX, use `a.attribution!.url` and `a.attribution!.label`.
- [ ] **Step 5:** Run the tests, which should pass, and `npx tsc --noEmit`, which should be clean.
- [ ] **Step 6: Commit** with the message "Offer a catalog of checked outlet feeds in four groups".

---

### Task 2: Taxonomy and the category filter

**Files:** Create `src/lib/news/taxonomy.ts`. Test: `tests/news/taxonomy.test.ts`.

- [ ] **Step 1: Failing test** `tests/news/taxonomy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryLabel, categoryWhere, normalizeChoice, parseClassification, REGIONS, TAXONOMY } from "@/lib/news/taxonomy";

describe("taxonomy", () => {
  it("has unique category ids and unique sub ids inside each", () => {
    expect(new Set(TAXONOMY.map((c) => c.id)).size).toBe(TAXONOMY.length);
    for (const c of TAXONOMY) expect(new Set(c.subs.map((s) => s.id)).size).toBe(c.subs.length);
    expect(REGIONS.map((r) => r.id)).toEqual(["kurdistan", "iraq", "region", "world"]);
  });
});

describe("parseClassification", () => {
  it("accepts a known category, sub and region", () => {
    expect(parseClassification({ category: "economy", subcategory: "energy", region: "kurdistan" })).toEqual({
      category: "economy",
      subcategory: "energy",
      region: "kurdistan",
    });
  });
  it("drops a sub that doesn't belong to the category", () => {
    expect(parseClassification({ category: "sports", subcategory: "energy", region: "world" })?.subcategory).toBeNull();
  });
  it("falls back to 'other' and 'world' for unknown codes", () => {
    expect(parseClassification({ category: "weather", region: "mars" })).toEqual({ category: "other", subcategory: null, region: "world" });
  });
  it("rejects anything that isn't an object", () => {
    expect(parseClassification(null)).toBeNull();
    expect(parseClassification("economy")).toBeNull();
  });
});

describe("normalizeChoice", () => {
  it("keeps known entries, drops unknown ones and subs of a whole-chosen category", () => {
    expect(normalizeChoice(["economy", "economy/energy", "sports/football", "nope", "sports/nope"])).toEqual(["economy", "sports/football"]);
  });
});

describe("categoryWhere", () => {
  it("is empty when nothing is chosen (everything passes)", () => {
    expect(categoryWhere([])).toEqual({});
  });
  it("keeps unclassified stories and matches whole categories and subs", () => {
    expect(categoryWhere(["economy", "sports/football"])).toEqual({
      OR: [{ category: null }, { category: { in: ["economy"] } }, { category: "sports", subcategory: "football" }],
    });
  });
});

describe("categoryLabel", () => {
  it("names a category and its sub in Kurdish", () => {
    expect(categoryLabel("economy", "energy")).toBe("ئابووری · نەوت و وزە");
    expect(categoryLabel("health", null)).toBe("تەندروستی");
    expect(categoryLabel(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/news/taxonomy.test.ts`. It should FAIL.

- [ ] **Step 3: Implement** `src/lib/news/taxonomy.ts`:

```ts
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

export function categoryLabel(category: string | null, subcategory: string | null): string | null {
  const c = category ? byId.get(category) : undefined;
  if (!c) return null;
  const s = subcategory ? c.subs.find((x) => x.id === subcategory) : undefined;
  return s ? `${c.label} · ${s.label}` : c.label;
}

export function regionLabel(region: string | null): string | null {
  return REGIONS.find((r) => r.id === region)?.label ?? null;
}
```

- [ ] **Step 4:** Run the test, which should PASS with 8 tests. Then run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** with the message "Add the story taxonomy and the category filter".

---

### Task 3: The classifier

**Files:** Create `src/lib/news/classify.ts`. Test: `tests/news/classify.test.ts`.

- [ ] **Step 1: Failing test** `tests/news/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyPrompt, parseBatch } from "@/lib/news/classify";

describe("classifyPrompt", () => {
  it("numbers every headline and lists the taxonomy", () => {
    const p = classifyPrompt([{ title: "Oil exports resume", snippet: "Erbil and Baghdad agree" }, { title: "هەولێر یاری دەباتەوە", snippet: "" }]);
    expect(p.user).toContain("0. Oil exports resume — Erbil and Baghdad agree");
    expect(p.user).toContain("1. هەولێر یاری دەباتەوە");
    expect(p.system).toContain("economy (energy, salaries, markets, trade)");
    expect(p.system).toContain("kurdistan");
  });
});

describe("parseBatch", () => {
  it("maps answers back by index and marks missing ones 'other'", () => {
    const out = parseBatch({ items: [{ i: 1, category: "sports", subcategory: "football", region: "world" }] }, 2);
    expect(out).toEqual([
      { category: "other", subcategory: null, region: "world" },
      { category: "sports", subcategory: "football", region: "world" },
    ]);
  });
  it("ignores out-of-range indexes", () => {
    const out = parseBatch({ items: [{ i: 5, category: "sports", region: "world" }, { i: 0, category: "health", region: "iraq" }] }, 1);
    expect(out).toEqual([{ category: "health", subcategory: null, region: "iraq" }]);
  });
  it("rejects a reply with no usable entry, so the call is retried", () => {
    expect(parseBatch({ items: [] }, 2)).toBeNull();
    expect(parseBatch({ nope: 1 }, 2)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/news/classify.test.ts`. It should FAIL.

- [ ] **Step 3: Implement** `src/lib/news/classify.ts`:

```ts
import { db } from "@/lib/db";
import { completeJson } from "@/lib/ai/provider";
import { parseClassification, REGIONS, TAXONOMY, type Classification } from "./taxonomy";

const BATCH = 20;
/** Per ingest run; the rest wait for the next run, newest first. */
const PER_RUN = 60;

export function classifyPrompt(items: { title: string; snippet: string }[]): { system: string; user: string } {
  const cats = TAXONOMY.map((c) => `- ${c.id}${c.subs.length ? ` (${c.subs.map((s) => s.id).join(", ")})` : ""}`).join("\n");
  return {
    system: `You sort news headlines for a newsroom in the Kurdistan Region of Iraq.
For each numbered item give its category, a subcategory if one fits, and its region.
Categories, with subcategories in brackets:
${cats}
Regions: ${REGIONS.map((r) => r.id).join(", ")}.
- kurdistan: the Kurdistan Region of Iraq and Kurdish affairs anywhere.
- iraq: the rest of Iraq.
- region: other Middle East countries.
- world: everything else.
Reply with JSON only, one entry per item, the same "i":
{"items":[{"i":0,"category":"economy","subcategory":"energy","region":"kurdistan"}]}
Use null for subcategory when none fits.`,
    user: items.map((it, i) => `${i}. ${it.title}${it.snippet ? ` — ${it.snippet.slice(0, 160)}` : ""}`).join("\n"),
  };
}

/** The AI's reply → one classification per input; entries it skipped become "other". Null if nothing usable. */
export function parseBatch(data: unknown, n: number): Classification[] | null {
  const arr = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(arr)) return null;
  const out: (Classification | null)[] = Array.from({ length: n }, () => null);
  for (const e of arr) {
    const i = (e as { i?: unknown } | null)?.i;
    if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n) out[i] = parseClassification(e);
  }
  if (!out.some(Boolean)) return null;
  return out.map((c) => c ?? { category: "other", subcategory: null, region: "world" });
}

/** Classify a desk's newest unclassified stories, a few batches per run. Never throws. */
export async function classifyPending(tenantId: string): Promise<number> {
  const items = await db.newsItem.findMany({
    where: { tenantId, category: null },
    orderBy: { publishedAt: "desc" },
    take: PER_RUN,
    select: { id: true, title: true, snippet: true },
  });
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const counts = await Promise.all(
    batches.map(async (b) => {
      try {
        const { system, user } = classifyPrompt(b);
        const { data } = await completeJson({ system, user, strength: "fast" }, (d) => parseBatch(d, b.length));
        await Promise.all(data.map((c, i) => db.newsItem.updateMany({ where: { id: b[i].id }, data: c })));
        return b.length;
      } catch (e) {
        console.error("[news] classify failed:", e instanceof Error ? e.message : "unknown error");
        return 0;
      }
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}
```

- [ ] **Step 4:** Run the test, which should PASS with 4 tests. Run `npx tsc --noEmit`; it fails only on the `category` field until Task 4 lands. If so, that's expected. Don't commit until Task 4 makes it clean; the controller runs Task 4 next.
- [ ] **Step 5: Commit**, after Task 4, with the message "Classify new stories in batches of twenty headlines".

---

### Task 4: Schema (controller)

- [ ] **Step 1:** Change `prisma/schema.prisma`.
  - In `model NewsItem`, add:

```prisma
  /// Set by the classifier (src/lib/news/taxonomy.ts codes); null until classified.
  category    String?
  subcategory String?
  region      String?
```

    and `@@index([tenantId, category])`.
  - In `model NewsSettings`, add:

```prisma
  /// "category" or "category/sub" codes to keep; empty keeps everything.
  categories    String[] @default([])
  /// When on, RSS stories must match the keywords too (the APIs always search by them).
  keywordFilter Boolean  @default(false)
```

- [ ] **Step 2:** Run `npx prisma format`, then `npx prisma db push` (additive), then `npx prisma generate`. Run `npx tsc --noEmit`, which should be clean now.
- [ ] **Step 3: Commit** the schema with the message "Store each story's category and each desk's choice", then commit Task 3.

---

### Task 5: Ingest uses the catalog, the keyword switch and the classifier

**Files:** Modify `src/lib/news/ingest.ts` and `tests/news/ingest.test.ts`.

- [ ] **Step 1: Imports.** In `ingest.ts`, add:

```ts
import { catalogEntry } from "./catalog";
import { classifyPending } from "./classify";
```

  Add the constant `const PER_SOURCE = 40;` next to `MAX_NEW_PER_FETCH`, with the comment `/** Newest stories taken from one source per run, so one busy feed can't crowd out the rest. */`.

- [ ] **Step 2: The per-source fetch.** Inside `sources.map(async (s) => { … })`:
  - Keep the `gdelt` and `newsdata` branches exactly as they are.
  - Replace the `else if (s.rssUrl) { … }` branch with:

```ts
        } else {
          // An outlet feed from the catalog, or a feed the page added itself.
          const entry = s.catalogId ? catalogEntry(s.catalogId) : undefined;
          const url = entry?.rss ?? s.rssUrl;
          if (url) {
            const r = await cached(`rss:${url}`, TTL.rss, () => fetchFeed(url, s.name));
            items = r.items
              .filter((i) => !settings.keywordFilter || matchesKeywords(`${i.title} ${i.snippet}`, keywords))
              .map((i) => ({ ...i, sourceName: s.name }));
            error = r.error;
          }
        }
```

  - Right before the `if (error)` line, add:

```ts
        items = [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, PER_SOURCE);
```

- [ ] **Step 3: Classify at the end.** Just before the final `return { added, … }`, add:

```ts
  // Sort what came in (and anything left from earlier runs) into categories.
  await classifyPending(tenantId);
```

- [ ] **Step 4: Tests.** In `tests/news/ingest.test.ts`, next to the existing `vi.mock("@/lib/db", …)`, add:

```ts
vi.mock("@/lib/news/classify", () => ({ classifyPending: vi.fn().mockResolvedValue(0) }));
```

  - If the existing mocked `newsSettings.upsert` returns an object without `keywordFilter`, that's fine. An `undefined` `keywordFilter` means "off", so RSS stories are no longer keyword-filtered.
  - If a test asserted that RSS stories are filtered by keywords, update it: set `keywordFilter: true` in that test's settings mock. Keep the assertion, and add a second case showing that with `keywordFilter` off the non-matching story is kept.

- [ ] **Step 5:** Run `npx vitest run` and `npx tsc --noEmit`, both clean.
- [ ] **Step 6: Commit** with the message "Fetch catalog feeds, make the keyword filter a switch, classify after each run".

---

### Task 6: Settings: grouped catalog, categories, keyword switch

**Files:**
- Modify `src/app/newsroom/(desk)/news/actions.ts` (two new actions).
- Modify `src/app/app/settings/page.tsx` (props) and `src/app/app/settings/news-settings.tsx` (UI).

- [ ] **Step 1: Actions.** Append to `src/app/newsroom/(desk)/news/actions.ts`. Import `normalizeChoice` from `@/lib/news/taxonomy`; the other names are already imported there.

```ts
/** Which categories the desk keeps. An empty list keeps everything. */
export async function saveCategoriesAction(list: string[]): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  const categories = normalizeChoice(Array.isArray(list) ? list.slice(0, 60).map(String) : []);
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [], categories }, update: { categories } });
  return { ok: true };
}

/** RSS stories must also match the keywords (off: categories alone decide). */
export async function setKeywordFilterAction(on: boolean): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], keywordFilter: !!on },
    update: { keywordFilter: !!on },
  });
  return { ok: true };
}
```

  Match the file's existing `Result` type: return `{ ok: true }` in the form the file's other actions use. If `Result` is generic, use `Result<null>` or whatever the existing `saveKeywordsAction` returns.

- [ ] **Step 2: Props.** In `src/app/app/settings/page.tsx`, inside the `news = { … }` object:
  - Replace the `catalog:` mapping with:

```ts
      catalog: catalogAvailable().map((c) => {
        const s = sources.find((x) => x.catalogId === c.id);
        return {
          id: c.id,
          name: c.name,
          group: c.group,
          lang: c.lang,
          description: c.description ?? null,
          enabled: !!s?.enabled,
          lastError: s?.lastError ?? null,
        };
      }),
      categories: settings?.categories ?? [],
      keywordFilter: settings?.keywordFilter ?? false,
```

  - Change the `feeds:` filter to only the page's own feeds (catalog rows also have no `rssUrl`, so it stays the same): `sources.filter((s) => s.rssUrl && !s.catalogId)`.

- [ ] **Step 3: UI.** In `src/app/app/settings/news-settings.tsx`:
  1. Update `NewsSettingsProps`:

```ts
  catalog: Array<{ id: string; name: string; group: SourceGroup; lang: SourceLang | null; description: string | null; enabled: boolean; lastError: string | null }>;
  categories: string[];
  keywordFilter: boolean;
```

     Import `GROUPS`, `LANG_LABEL`, `type SourceGroup` and `type SourceLang` from `@/lib/news/catalog`. Import `TAXONOMY` from `@/lib/news/taxonomy`. Import `saveCategoriesAction` and `setKeywordFilterAction` from the actions module the file already imports from.

  2. In the keywords card, after the existing save button, add the switch:

```tsx
        <div className="gm-between" style={{ marginTop: 4 }}>
          <small className="gm-sub" style={{ margin: 0 }}>تەنها ئەو هەواڵانەی RSS کە یەکێک لە وشە سەرەکییەکانیان تێدایە</small>
          <button
            type="button"
            role="switch"
            aria-checked={p.keywordFilter}
            aria-label="فلتەری وشە سەرەکی بۆ RSS"
            className="gm-knob"
            disabled={pending}
            onClick={() => run(() => setKeywordFilterAction(!p.keywordFilter), "گۆڕدرا.")}
          >
            <i />
          </button>
        </div>
```

  3. Replace the `{p.catalog.map((c) => ( … ))}` block with a grouped list:

```tsx
        {GROUPS.map((g) => {
          const entries = p.catalog.filter((c) => c.group === g.id);
          if (!entries.length) return null;
          return (
            <div key={g.id}>
              <p className="gm-hint" style={{ fontWeight: 700, margin: "10px 0 2px" }}>{g.label}</p>
              {entries.map((c) => (
                <div key={c.id} className="gm-target">
                  <div>
                    <p>
                      {c.name} {c.lang && <span className="gm-badge ghost">{LANG_LABEL[c.lang]}</span>}
                    </p>
                    <small>{c.lastError ? `هەڵە: ${c.lastError}` : c.description ?? ""}</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={c.enabled}
                    aria-label={c.name}
                    className="gm-knob"
                    disabled={pending}
                    onClick={() => run(() => toggleCatalogSourceAction(c.id, !c.enabled), "گۆڕدرا.")}
                  >
                    <i />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
```

  4. After the sources cards (before the `براند` section), add the categories section. Add this state at the top of the component: `const [cats, setCats] = useState<string[]>(p.categories);`.

```tsx
      <p className="gm-sec">بابەتەکان</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>
          کام بابەتانە بهێنرێن؟ ئەگەر هیچ هەڵنەبژێریت، هەموو بابەتەکان دێن. هەواڵەکان بە زیرەکیی دەستکرد پۆلێن دەکرێن.
        </p>
        {TAXONOMY.map((c) => {
          const whole = cats.includes(c.id);
          return (
            <div key={c.id} className="gm-stack" style={{ gap: 6 }}>
              <div className="gm-chips">
                <button
                  type="button"
                  className="gm-chip"
                  aria-pressed={whole}
                  onClick={() => setCats((x) => (whole ? x.filter((v) => v !== c.id) : [...x.filter((v) => !v.startsWith(`${c.id}/`)), c.id]))}
                >
                  {c.label}
                </button>
                {!whole &&
                  c.subs.map((s) => {
                    const code = `${c.id}/${s.id}`;
                    const on = cats.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        className="gm-chip"
                        style={{ fontSize: 12 }}
                        aria-pressed={on}
                        onClick={() => setCats((x) => (on ? x.filter((v) => v !== code) : [...x, code]))}
                      >
                        {s.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveCategoriesAction(cats), "پاشەکەوت کرا.")}>
          پاشەکەوتی بابەتەکان
        </button>
      </div>
```

  `run` is the existing helper in this component. Keep its signature.
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npx vitest run`, both clean.
- [ ] **Step 5: Commit** with the message "Group the catalog in settings and let a desk choose its categories".

---

### Task 7: Filters on the news page

**Files:** Create `src/app/newsroom/(desk)/news/filters.tsx`. Modify `src/app/newsroom/(desk)/news/page.tsx`.

- [ ] **Step 1: Filter bar** `src/app/newsroom/(desk)/news/filters.tsx`. This is a server component; every chip is a link that keeps the other filters:

```tsx
import Link from "next/link";

import { num } from "@/app/app/format";
import { REGIONS, TAXONOMY } from "@/lib/news/taxonomy";

export type NewsQuery = { tab: string; cat?: string; region?: string; lang?: string; src?: string };

const LANGS: Record<string, string> = { ckb: "کوردی", ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی", tr: "تورکی" };

export function newsHref(q: NewsQuery, change: Partial<NewsQuery>): string {
  const next = { ...q, ...change };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
  return `/newsroom/news?${sp.toString()}`;
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="gm-chip" aria-pressed={on} scroll={false}>
      {children}
    </Link>
  );
}

export function NewsFilters(props: {
  q: NewsQuery;
  categoryCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  langs: string[];
  sources: string[];
}) {
  const { q, categoryCounts, regionCounts, langs, sources } = props;
  const cats = TAXONOMY.filter((c) => categoryCounts[c.id]);
  return (
    <div className="gm-stack" style={{ gap: 8 }}>
      {cats.length > 0 && (
        <div className="gm-chips" aria-label="بابەت">
          <Chip href={newsHref(q, { cat: undefined })} on={!q.cat}>هەموو بابەتەکان</Chip>
          {cats.map((c) => (
            <Chip key={c.id} href={newsHref(q, { cat: q.cat === c.id ? undefined : c.id })} on={q.cat === c.id}>
              {c.label} · {num(categoryCounts[c.id])}
            </Chip>
          ))}
        </div>
      )}
      <div className="gm-chips" aria-label="ناوچە">
        <Chip href={newsHref(q, { region: undefined })} on={!q.region}>هەموو ناوچەکان</Chip>
        {REGIONS.filter((r) => regionCounts[r.id]).map((r) => (
          <Chip key={r.id} href={newsHref(q, { region: q.region === r.id ? undefined : r.id })} on={q.region === r.id}>
            {r.label}
          </Chip>
        ))}
        {langs.length > 1 &&
          langs.map((l) => (
            <Chip key={l} href={newsHref(q, { lang: q.lang === l ? undefined : l })} on={q.lang === l}>
              {LANGS[l] ?? l}
            </Chip>
          ))}
      </div>
      {sources.length > 1 && (
        <div className="gm-chips" aria-label="سەرچاوە">
          <Chip href={newsHref(q, { src: undefined })} on={!q.src}>هەموو سەرچاوەکان</Chip>
          {sources.map((s) => (
            <Chip key={s} href={newsHref(q, { src: q.src === s ? undefined : s })} on={q.src === s}>
              {s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the page.** In `src/app/newsroom/(desk)/news/page.tsx`:
  1. **Search params.** The page receives `searchParams: Promise<{ tab?: string; cat?: string; region?: string; lang?: string; src?: string }>`.
  2. **Load the settings first.** Load `settings` (the existing `newsSettings.findUnique`) before the item query, then build:

```ts
  const q: NewsQuery = { tab: tab.key, cat: sp.cat, region: sp.region, lang: sp.lang, src: sp.src };
  const base: Prisma.NewsItemWhereInput = {
    tenantId: ws.id,
    status: { in: [...tab.statuses] },
    AND: [categoryWhere(settings?.categories ?? []) as Prisma.NewsItemWhereInput],
  };
  const where: Prisma.NewsItemWhereInput = {
    ...base,
    ...(q.cat ? { category: q.cat } : {}),
    ...(q.region ? { region: q.region } : {}),
    ...(q.lang ? { lang: q.lang } : {}),
    ...(q.src ? { sourceName: q.src } : {}),
  };
```

     Move `newsSettings.findUnique` out of the `Promise.all`, awaited before it. Keep the variable name `settings`.
  3. **The item query.** It becomes `db.newsItem.findMany({ where, orderBy: { publishedAt: "desc" }, take: 150 })`. Add these to the `Promise.all`:

```ts
    db.newsItem.groupBy({ by: ["category"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["region"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["lang"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["sourceName"], where: base, _count: { _all: true }, orderBy: { _count: { sourceName: "desc" } }, take: 12 }),
```

     Turn the results into `categoryCounts` and `regionCounts` (`Record<string, number>` from `_count._all`), `langs` (non-null `lang` values) and `sources` (`sourceName` values).
  4. **The checklist's sources step.** It should count catalog feeds too. Change the `rssFeeds` count query to:

```ts
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true, OR: [{ rssUrl: { not: null } }, { catalogId: { notIn: ["gdelt", "newsdata"] } }] } }),
```

  5. **The filter bar.** Directly after the tab chips (`<div className="gm-chips" role="tablist">…</div>`), render `<NewsFilters q={q} categoryCounts={…} regionCounts={…} langs={…} sources={…} />`. Also make the tab chips keep the filters: `href={newsHref(q, { tab: t.key })}`.
  6. **The story card.** In each story card's `<small className="gm-sub">`, append the category and region when known: `{categoryLabel(lead.category, lead.subcategory) ? ` · ${categoryLabel(lead.category, lead.subcategory)}` : ""}` and the same for `regionLabel(lead.region)`.
  7. **Imports.** Add `import type { Prisma } from "@/generated/prisma/client";`, `categoryLabel`, `categoryWhere` and `regionLabel` from `@/lib/news/taxonomy`, and `NewsFilters`, `newsHref`, `type NewsQuery` from `./filters`.
- [ ] **Step 3:** Run `npx tsc --noEmit`, `npx vitest run` and `npx next build`, all clean. If the build changes `package-lock.json`, revert it with `git checkout package-lock.json`.
- [ ] **Step 4: Commit** with the message "Filter the news page by category, region, language and source".

---

### Task 8: Guide

**Files:** Modify `src/lib/newsroom/guide.ts`.

- [ ] **Step 1:** Replace the `sources` section's `intro` and `steps` with:

```ts
    intro: "هەواڵ لەو سەرچاوانەوە دێت کە چالاکیان دەکەیت: سەرچاوە جیهانی، ناوچەیی، کوردی و فەرمییەکان، و گەڕان بە وشە سەرەکییەکان.",
    steps: [
      "لە «ڕێکخستن» ← «سەرچاوەکان»، ئەو سەرچاوانە چالاک بکە کە دەتەوێت. هەر سەرچاوەیەک زمانەکەی لە تەنیشتیەتی.",
      "بۆ GDELT، وشە سەرەکییەکان بنووسە، بە چەند زمانێک: هەولێر، Erbil، أربيل.",
      "لە «بابەتەکان» دیاری بکە کام بابەت بهێنرێت، بۆ نموونە تەنها سیاسەت و ئابووری. هیچ هەڵنەبژێریت = هەمووی.",
      "ئەگەر دەتەوێت تەنها هەواڵی پەیوەست بە وشەکانت بێت، فلتەری وشە سەرەکی بۆ RSS چالاک بکە.",
      "دەتوانیت RSSی سەرچاوەیەکی تریش زیاد بکەیت. تەنها ئەوانە زیاد بکە کە مافی بەکارهێنانیانت هەیە.",
    ],
```

- [ ] **Step 2:** Update the `stories` section's first sentence (its `intro`) to:

```ts
    intro: "لە «هەواڵەکان»، هەواڵەکان لە سێ بەشدان: «نوێ»، «ئامادە» و «بڵاوکراوە». بە بابەت، ناوچە، زمان و سەرچاوە فلتەریان بکە.",
```

- [ ] **Step 3:** Run `npx vitest run`, which should pass. **Commit** with the message "Explain sources, categories and filters in the guide".

---

### Task 9: Verify, ship, re-shoot the tutorial (controller)

- [ ] Run `npx vitest run`, `npx tsc --noEmit` and `npm run build`.
- [ ] **Local test on the test desk:**
  - switch on BBC عربي, الأناضول, شفق نيوز and ئێستا;
  - refresh the news and wait for classification;
  - check that the chips show counts, that filters narrow the list, and that choosing «ئابووری» in settings hides other categories while unclassified stories stay.
- [ ] Update `TODOS.md`:
  - list the Kurdish outlets that have no RSS;
  - Facebook Pages as a source needs Meta PPCA;
  - the RSS keyword filter is now opt-in, which is a behaviour change for existing desks.
- [ ] Merge to `master` and push, then check production.
- [ ] **Re-shoot and re-render the tutorial** (`Desktop/gituas-tutorial/README.md`). Outlet names stay masked by `scripts/shots.mjs`; extend its mask list with any Kurdish outlet names that now show in the catalog screenshots.
