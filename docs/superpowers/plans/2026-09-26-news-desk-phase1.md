# News Desk (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Kurdish news page can pull stories from free, legal sources, get an original Sorani draft, turn it into a card in its own brand, and publish it to Facebook, Instagram and TikTok through Gituas.

**Architecture:** Pure, unit-tested modules under `src/lib/news`, `src/lib/ai`, `src/lib/cards` and `src/lib/billing` do the work; server actions in `src/app/app/news/actions.ts` wire them to the database; the editor renders the card in the browser (DOM → PNG with `html-to-image`) and hands the card and caption to the existing `/app/publish` screen, which already carries TikTok's audited post controls. Everything runs on the free Vercel plan: sources are fetched when the editor opens the desk, throttled, and cached across tenants.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Prisma 7 (`db push` to the shared Neon database), vitest, `fast-xml-parser`, `html-to-image`, DeepSeek HTTP API (`deepseek-flash`, `deepseek-v4-pro`), `@google/genai` fallback, `@vercel/blob` client uploads.

**Spec:** `docs/superpowers/specs/2026-09-26-news-desk-design.md`

---

## Deviations from the spec, decided while planning

1. **Publishing goes through `/app/publish`.** The editor saves the card and opens the existing publish screen prefilled (`?draft=<id>`). TikTok's audited post controls stay the only place a post leaves from. News pages therefore keep the بڵاوکردنەوە tab: their tab bar is هەواڵ · کۆمێنت · نامە · بڵاوکردنەوە · ئامار (Settings stays in the header).
2. **One caption for every platform**, ending `سەرچاوە: <name>` and the link. Instagram shows the link as plain text.
3. **Built-in templates live in code.** The `CardTemplate` table arrives with phase 2 (page frames). `BrandKit` stores explicit colours and a heading-font choice between the two fonts the app already ships; font upload is phase 2.
4. **Curated catalog = GDELT, plus NewsData when `NEWSDATA_API_KEY` is set.** GDELT's terms allow commercial use with a citation and link, which the desk shows. Outlet RSS feeds are added by the page itself until each outlet's terms are checked (BBC's terms page could not be read while planning); a TODOS entry tracks it.
5. **Shop or news page is chosen once after sign-in** on `/app`, not on the sign-up form, so Google sign-ups and existing accounts get the same choice.
6. **TikTok photo posts** are added to the publish screen (Content Posting API `media_type: PHOTO`, same `video.publish` scope), so cards can go to TikTok in phase 1.

## Conventions for every task

- Tests: `npx vitest run <file>`; all tests: `npx vitest run`.
- Schema: `npx prisma db push` then `npx prisma generate`. The database is shared with production: changes here are additive only.
- Build: `npx next build`. If the build rewrote `package-lock.json` (it adds a Windows SWC entry), run `git checkout -- package-lock.json` before committing — except in Task 1, where the install changes it on purpose.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- UI text is Sorani; code and comments are English. Never print, log or commit an API key.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `TenantKind`, `Tenant.kind/kindChosen`, `NewsSettings`, `NewsSource`, `NewsItem`, `NewsDraft`, `BrandKit`, `Usage`, `SourceCache` |
| `src/lib/news/types.ts` | `RawItem`, `CardKind`, `Draft`, `CATEGORIES` |
| `src/lib/news/text.ts` | HTML stripping, matching normalisation, language guess, keyword match, n-grams |
| `src/lib/news/sources/rss.ts` | Parse and fetch RSS/Atom |
| `src/lib/news/sources/gdelt.ts` | Build, fetch and parse GDELT DOC 2.0 queries |
| `src/lib/news/sources/newsdata.ts` | Build, fetch and parse NewsData.io queries |
| `src/lib/news/catalog.ts` | The curated source list |
| `src/lib/news/cluster.ts` | Cluster keys and grouping |
| `src/lib/ai/provider.ts`, `deepseek.ts`, `gemini-json.ts` | JSON completions: DeepSeek, one retry, Gemini fallback |
| `src/lib/news/draft.ts` | Prompt, draft validation, `draftFor` |
| `src/lib/news/rules.ts` | Legal rules and the caption with attribution |
| `src/lib/billing/plans.ts`, `limits.ts` | Monthly quotas per plan |
| `src/lib/news/ingest.ts` | Fetch a tenant's sources (throttled, cached), store and cluster items |
| `src/lib/news/publish-record.ts` | Record a news publish on its draft |
| `src/lib/cards/brand.ts`, `templates.tsx`, `render.ts` | Brand, the four card templates, DOM → PNG |
| `src/app/app/news/actions.ts` | Server actions for the desk and its settings |
| `src/app/app/news/page.tsx`, `refresh-button.tsx` | Story list |
| `src/app/app/news/[id]/page.tsx`, `editor.tsx` | Draft editor with the source beside it |
| `src/app/app/kind-chooser.tsx`, `page.tsx`, `nav.tsx`, `layout.tsx`, `data.ts`, `actions.ts` | Shop/news choice, tab bar, workspace kind |
| `src/app/app/settings/news-settings.tsx`, `page.tsx`, `settings-client.tsx` | Keywords, sources, brand kit, kind switch |
| `src/app/app/publish/page.tsx`, `publish-client.tsx`, `src/lib/publishers/tiktok.ts` | Prefill from a draft; TikTok photo posts |
| `src/app/(legal)/terms/page.tsx`, `privacy/page.tsx` | News responsibilities; DeepSeek as a processor |

---

### Task 1: Dependencies and environment names

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install the two libraries**

Run: `npm install fast-xml-parser html-to-image`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Check they load**

Run: `node -e "require('fast-xml-parser'); require.resolve('html-to-image'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Document the two keys in `.env.example`**

Append:

```
# News desk: Sorani drafts (https://platform.deepseek.com)
DEEPSEEK_API_KEY=
# Optional news source; the free tier allows commercial use (https://newsdata.io)
NEWSDATA_API_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "Add the RSS parser and DOM-to-image libraries for the news desk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the tenant kind**

In `model Tenant`, directly after the line `  whatsappNumber        String?`, add:

```prisma
  /// A shop (comments, messages) or a news page (news desk). Asked once after sign-in.
  kind                  TenantKind        @default(MERCHANT)
  kindChosen            Boolean           @default(false)
```

- [ ] **Step 2: Add the enum and the news models**

Append to the end of `prisma/schema.prisma`:

```prisma
enum TenantKind {
  MERCHANT
  NEWS
}

/// A news page's desk settings.
model NewsSettings {
  tenantId      String    @id
  /// Words a story must contain to be shown (any of them); empty = everything.
  keywords      String[]
  lastFetchedAt DateTime?
  updatedAt     DateTime  @updatedAt
}

/// One source a news page reads: a catalog entry or the page's own RSS feed.
model NewsSource {
  id        String   @id @default(cuid())
  tenantId  String
  catalogId String?
  rssUrl    String?
  name      String
  enabled   Boolean  @default(true)
  lastError String?
  createdAt DateTime @default(now())

  @@unique([tenantId, catalogId])
  @@unique([tenantId, rssUrl])
  @@index([tenantId])
}

/// A story fetched for a news page: headline and snippet only, never article text.
model NewsItem {
  id          String     @id @default(cuid())
  tenantId    String
  sourceName  String
  url         String
  title       String
  snippet     String
  lang        String?
  publishedAt DateTime
  clusterKey  String
  /// NEW | DRAFTED | PUBLISHED | DISMISSED
  status      String     @default("NEW")
  createdAt   DateTime   @default(now())
  draft       NewsDraft?

  @@unique([tenantId, url])
  @@index([tenantId, status, publishedAt])
}

/// The Sorani post written from one item, and where it went.
model NewsDraft {
  id          String    @id @default(cuid())
  itemId      String    @unique
  item        NewsItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)
  tenantId    String
  headline    String
  body        String
  category    String
  /// STANDARD | BREAKING | STAT | QUOTE
  cardKind    String
  stat        String?
  quote       String?
  speaker     String?
  model       String
  photoPath   String?
  cardUrl     String?
  cardPath    String?
  results     Json?
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([tenantId])
}

/// A news page's look: logo, three colours, heading font.
model BrandKit {
  tenantId    String   @id
  logoPath    String?
  primary     String   @default("#0B2545")
  accent      String   @default("#E0A526")
  text        String   @default("#FFFFFF")
  /// kufi | sans — the two fonts the app ships
  headingFont String   @default("kufi")
  updatedAt   DateTime @updatedAt
}

/// Monthly counter per tenant and metric, checked against the plan's quota.
model Usage {
  tenantId String
  /// YYYY-MM (UTC)
  month    String
  metric   String
  count    Int    @default(0)

  @@id([tenantId, month, metric])
}

/// A source's last result, shared across tenants so each feed or query is
/// fetched at most once per window whatever the number of pages reading it.
model SourceCache {
  /// rss:<url> | gdelt:<keywords> | newsdata:<keywords>
  key       String   @id
  items     Json
  fetchedAt DateTime
}
```

- [ ] **Step 3: Push and generate**

Run: `npx prisma db push` then `npx prisma generate`
Expected: `Your database is now in sync with your Prisma schema.` and a generated client with `newsItem`, `newsDraft`, `newsSettings`, `newsSource`, `brandKit`, `usage`, `sourceCache`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Add the news desk tables and the shop/news tenant kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared types and text helpers

**Files:**
- Create: `src/lib/news/types.ts`
- Create: `src/lib/news/text.ts`
- Test: `tests/news/text.test.ts`

- [ ] **Step 1: Write `src/lib/news/types.ts`**

```ts
/** One story as a source returns it: headline and a short snippet, never article text. */
export interface RawItem {
  url: string;
  title: string;
  snippet: string;
  publishedAt: Date;
  lang: string | null;
  sourceName: string;
}

export type CardKind = "STANDARD" | "BREAKING" | "STAT" | "QUOTE";
export const CARD_KINDS: readonly CardKind[] = ["STANDARD", "BREAKING", "STAT", "QUOTE"];

/** The last entry is the fallback when the AI names something else. */
export const CATEGORIES = [
  "سیاسەت",
  "ئابووری",
  "ئاسایش",
  "وەرزش",
  "تەندروستی",
  "کۆمەڵایەتی",
  "جیهان",
  "تەکنەلۆژیا",
  "گشتی",
] as const;

export interface Draft {
  headline: string;
  body: string;
  category: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
}
```

- [ ] **Step 2: Write the failing test `tests/news/text.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { guessLang, jaccard, matchesKeywords, normalizeForMatch, shingles, stripHtml, words } from "@/lib/news/text";

describe("stripHtml", () => {
  it("removes tags, decodes entities and collapses space", () => {
    expect(stripHtml('<p>عاجل: &quot;خبر&quot; &amp; تفاصيل</p>\n<img src="x">')).toBe('عاجل: "خبر" & تفاصيل');
  });
  it("decodes numeric entities", () => {
    expect(stripHtml("A&#39;s &#x41;")).toBe("A's A");
  });
});

describe("normalizeForMatch", () => {
  it("makes Arabic and Kurdish letter variants meet", () => {
    expect(normalizeForMatch("علي")).toBe(normalizeForMatch("علی"));
    expect(normalizeForMatch("ڕووداو")).toBe(normalizeForMatch("رووداو"));
  });
  it("turns Eastern Arabic digits into ASCII and drops punctuation", () => {
    expect(normalizeForMatch("٢٠٢٦، هەولێر!")).toBe(normalizeForMatch("2026 هەولێر"));
  });
});

describe("guessLang", () => {
  it("tells Kurdish, Arabic and English apart", () => {
    expect(guessLang("هەواڵی هەولێر")).toBe("ku");
    expect(guessLang("أخبار العراق")).toBe("ar");
    expect(guessLang("Iraq news")).toBe("en");
  });
});

describe("jaccard and shingles", () => {
  it("measures word overlap", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
    expect(jaccard([], [])).toBe(0);
  });
  it("builds n-grams", () => {
    expect([...shingles(["a", "b", "c", "d"], 3)]).toEqual(["a b c", "b c d"]);
    expect(words("  Hello, World ")).toEqual(["hello", "world"]);
  });
});

describe("matchesKeywords", () => {
  it("matches any keyword, including inside Kurdish suffixed words", () => {
    expect(matchesKeywords("نرخی ئاڵتوون لە هەولێری پایتەخت", ["هەولێر"])).toBe(true);
    expect(matchesKeywords("نرخی ئاڵتوون", ["دهۆک"])).toBe(false);
    expect(matchesKeywords("anything", [])).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/news/text.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/text`.

- [ ] **Step 4: Write `src/lib/news/text.ts`**

```ts
// Text helpers shared by sources, clustering and the legal rules. Pure
// functions only: the editor imports the rules in the browser too.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(name: string): string | null {
  if (name[0] === "#") {
    const hex = name[1] === "x" || name[1] === "X";
    const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : null;
  }
  return NAMED[name.toLowerCase()] ?? null;
}

/** Tags removed, entities decoded, whitespace collapsed. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name: string) => decodeEntity(name) ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// Harakat, superscript alef, tatweel.
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
// One spelling per letter, so Kurdish and Arabic spellings of a name meet.
const LETTERS: Record<string, string> = {
  "\u064A": "\u06CC", // ي → ی
  "\u0649": "\u06CC", // ى → ی
  "\u0643": "\u06A9", // ك → ک
  "\u0629": "\u0647", // ة → ه
  "\u06D5": "\u0647", // ە → ه
  "\u06BE": "\u0647", // ھ → ه
  "\u0623": "\u0627", // أ → ا
  "\u0625": "\u0627", // إ → ا
  "\u0622": "\u0627", // آ → ا
  "\u0695": "\u0631", // ڕ → ر (outlets differ on the heavy r)
  "\u06B5": "\u0644", // ڵ → ل
};
const LETTER_RE = new RegExp(`[${Object.keys(LETTERS).join("")}]`, "g");

/** For matching only: lower case, no diacritics, one spelling per letter, ASCII digits, no punctuation. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(LETTER_RE, (c) => LETTERS[c])
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function words(s: string): string[] {
  const n = normalizeForMatch(s);
  return n ? n.split(" ") : [];
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export function shingles(ws: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

const KURDISH_ONLY = /[\u0695\u06B5\u06CE\u06C6\u06D5\u06A4]/; // ڕ ڵ ێ ۆ ە ڤ
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Good enough for grouping and filtering: Kurdish letters → ku, other Arabic script → ar, else en. */
export function guessLang(s: string): string {
  if (KURDISH_ONLY.test(s)) return "ku";
  if (ARABIC_SCRIPT.test(s)) return "ar";
  return "en";
}

/** True when the text contains any keyword; no keywords lets everything through. */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const ks = keywords.map(normalizeForMatch).filter(Boolean);
  if (!ks.length) return true;
  const t = normalizeForMatch(text);
  return ks.some((k) => t.includes(k));
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run tests/news/text.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/news/types.ts src/lib/news/text.ts tests/news/text.test.ts
git commit -m "Add news types and the text helpers for matching Kurdish and Arabic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: RSS and Atom source

**Files:**
- Create: `src/lib/news/sources/rss.ts`
- Test: `tests/news/rss.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseFeed } from "@/lib/news/sources/rss";

const NOW = new Date("2026-09-26T12:00:00Z");

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>K24</title>
<item><title><![CDATA[بەغدا و کوەیت لاپەڕەیەکی نوێ]]></title><link>https://www.kurdistan24.net/ckb/story/1</link>
<description><![CDATA[<p>عێراق و کوەیت &amp; لیژنەیەک</p>]]></description><pubDate>Fri, 26 Sep 2026 08:00:00 GMT</pubDate></item>
<item><title>No link here</title><description>x</description></item>
<item><title>From the future</title><link>https://example.com/f</link><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const SINGLE = `<rss><channel><item><title>Only one</title><link>https://example.com/1</link></item></channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">UN &amp;amp; Iraq</title>
<link rel="alternate" href="https://example.com/a"/><summary>Short</summary><updated>2026-09-25T10:00:00Z</updated></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS items, stripping HTML and skipping items without a link", () => {
    const items = parseFeed(RSS, "Kurdistan24", NOW);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      url: "https://www.kurdistan24.net/ckb/story/1",
      title: "بەغدا و کوەیت لاپەڕەیەکی نوێ",
      snippet: "عێراق و کوەیت & لیژنەیەک",
      publishedAt: new Date("2026-09-26T08:00:00Z"),
      lang: "ku",
      sourceName: "Kurdistan24",
    });
  });
  it("dates a future item as now", () => {
    expect(parseFeed(RSS, "K", NOW)[1].publishedAt).toEqual(NOW);
  });
  it("handles a feed with a single item", () => {
    expect(parseFeed(SINGLE, "X", NOW).map((i) => i.title)).toEqual(["Only one"]);
  });
  it("reads Atom entries", () => {
    const [e] = parseFeed(ATOM, "A", NOW);
    expect(e.url).toBe("https://example.com/a");
    expect(e.title).toBe("UN & Iraq");
    expect(e.lang).toBe("en");
  });
  it("returns nothing for something that is not a feed", () => {
    expect(parseFeed("<html><body>hi</body></html>", "X", NOW)).toEqual([]);
    expect(parseFeed("not xml <<<", "X", NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/rss.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/sources/rss`.

- [ ] **Step 3: Write `src/lib/news/sources/rss.ts`**

```ts
import { XMLParser } from "fast-xml-parser";

import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

const SNIPPET_MAX = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["#text"]);
  return "";
}

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function parseDate(s: string, now: Date): Date {
  const t = Date.parse(s);
  // A missing or future date sorts as "now" instead of jumping the queue.
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t) : now;
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom. Anything else, or broken XML, gives no items. */
export function parseFeed(xml: string, sourceName: string, now = new Date()): RawItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const out: RawItem[] = [];
  const push = (url: string, title: string, snippet: string, date: string) => {
    const u = url.trim();
    const t = stripHtml(title);
    if (!/^https?:\/\//i.test(u) || !t) return;
    const s = stripHtml(snippet).slice(0, SNIPPET_MAX);
    out.push({ url: u, title: t, snippet: s, publishedAt: parseDate(date, now), lang: guessLang(`${t} ${s}`), sourceName });
  };

  for (const it of doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? []) {
    push(text(first(it.link)) || text(it.guid), text(it.title), text(it.description), text(it.pubDate) || text(it["dc:date"]));
  }
  for (const e of doc?.feed?.entry ?? []) {
    const links: Record<string, unknown>[] = Array.isArray(e.link) ? e.link : [];
    const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
    push(text(alt?.["@href"]), text(e.title), text(e.summary) || text(e.content), text(e.published) || text(e.updated));
  }
  return out;
}

/** Fetch and parse one feed. Throws when the URL does not answer with a feed. */
export async function fetchFeed(url: string, sourceName: string): Promise<RawItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "GituasNewsDesk/1.0 (+https://gituas.vercel.app)",
      Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) throw new Error("not an RSS or Atom feed");
  return parseFeed(body, sourceName);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/rss.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/sources/rss.ts tests/news/rss.test.ts
git commit -m "Read RSS and Atom feeds for the news desk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GDELT source

**Files:**
- Create: `src/lib/news/sources/gdelt.ts`
- Test: `tests/news/gdelt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { gdeltUrl, parseGdelt } from "@/lib/news/sources/gdelt";

describe("gdeltUrl", () => {
  it("ORs the keywords and quotes phrases", () => {
    const u = new URL(gdeltUrl(["هەولێر", "oil price"]));
    expect(u.origin + u.pathname).toBe("https://api.gdeltproject.org/api/v2/doc/doc");
    expect(u.searchParams.get("query")).toBe('(هەولێر OR "oil price")');
    expect(u.searchParams.get("mode")).toBe("artlist");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("timespan")).toBe("24h");
  });
  it("uses a single keyword bare", () => {
    expect(new URL(gdeltUrl(["Kurdistan"])).searchParams.get("query")).toBe("Kurdistan");
  });
});

describe("parseGdelt", () => {
  it("maps articles and skips ones without a URL", () => {
    const items = parseGdelt({
      articles: [
        { url: "https://www.rudaw.net/sorani/x", title: "Title &amp; more", seendate: "20260926T101500Z", domain: "rudaw.net", language: "Kurdish" },
        { url: "", title: "bad" },
      ],
    });
    expect(items).toEqual([
      {
        url: "https://www.rudaw.net/sorani/x",
        title: "Title & more",
        snippet: "",
        publishedAt: new Date("2026-09-26T10:15:00Z"),
        lang: "ku",
        sourceName: "rudaw.net",
      },
    ]);
  });
  it("returns nothing for an empty answer", () => {
    expect(parseGdelt({})).toEqual([]);
    expect(parseGdelt(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/gdelt.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/sources/gdelt`.

- [ ] **Step 3: Write `src/lib/news/sources/gdelt.ts`**

```ts
// GDELT DOC 2.0: free, keyless, commercial use allowed with a citation and a
// link to gdeltproject.org (shown on the news desk). It answers bursts with
// HTTP 429, so callers go through the shared cache in ingest.ts.
import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export class RateLimited extends Error {}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

const LANG: Record<string, string> = { arabic: "ar", english: "en", kurdish: "ku", persian: "fa", turkish: "tr" };

export function gdeltUrl(keywords: string[], opts: { timespan?: string; max?: number } = {}): string {
  const terms = keywords
    .map((k) => k.trim().replace(/"/g, ""))
    .filter(Boolean)
    .map((k) => (/\s/.test(k) ? `"${k}"` : k));
  const query = terms.length > 1 ? `(${terms.join(" OR ")})` : (terms[0] ?? "");
  const p = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(opts.max ?? 50),
    timespan: opts.timespan ?? "24h",
    sort: "datedesc",
  });
  return `${BASE}?${p}`;
}

function parseSeen(s?: string): Date {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date();
}

export function parseGdelt(json: unknown): RawItem[] {
  const articles = ((json as { articles?: GdeltArticle[] } | null)?.articles ?? []).filter((a) => a.url && a.title);
  return articles.map((a) => {
    const title = stripHtml(a.title!);
    return {
      url: a.url!,
      title,
      snippet: "",
      publishedAt: parseSeen(a.seendate),
      lang: LANG[(a.language ?? "").toLowerCase()] ?? guessLang(title),
      sourceName: a.domain || new URL(a.url!).hostname,
    };
  });
}

export async function fetchGdelt(keywords: string[]): Promise<RawItem[]> {
  if (!keywords.some((k) => k.trim())) return [];
  const res = await fetch(gdeltUrl(keywords), { signal: AbortSignal.timeout(8000) });
  if (res.status === 429) throw new RateLimited("GDELT asked us to slow down");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  // A bad query comes back as a plain-text sentence, not JSON.
  try {
    return parseGdelt(JSON.parse(body));
  } catch {
    throw new Error(body.slice(0, 160) || "empty answer");
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/gdelt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/sources/gdelt.ts tests/news/gdelt.test.ts
git commit -m "Query GDELT for keyword news

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: NewsData source

**Files:**
- Create: `src/lib/news/sources/newsdata.ts`
- Test: `tests/news/newsdata.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { newsdataUrl, parseNewsdata } from "@/lib/news/sources/newsdata";

describe("newsdataUrl", () => {
  it("builds the latest-news query and caps q at 100 characters", () => {
    const u = new URL(newsdataUrl("KEY", ["Erbil", "x".repeat(200)]));
    expect(u.origin + u.pathname).toBe("https://newsdata.io/api/1/latest");
    expect(u.searchParams.get("apikey")).toBe("KEY");
    expect(u.searchParams.get("q")!.length).toBeLessThanOrEqual(100);
    expect(u.searchParams.get("q")!.startsWith("Erbil OR ")).toBe(true);
    expect(u.searchParams.get("language")).toBe("ar,en");
  });
});

describe("parseNewsdata", () => {
  it("maps results", () => {
    const items = parseNewsdata({
      status: "success",
      results: [
        {
          title: "Gold rises in Erbil",
          link: "https://example.com/g",
          description: "<b>Prices</b> up",
          pubDate: "2026-09-26 10:15:00",
          language: "english",
          source_name: "Example News",
        },
        { title: "", link: "https://example.com/x" },
      ],
    });
    expect(items).toEqual([
      {
        url: "https://example.com/g",
        title: "Gold rises in Erbil",
        snippet: "Prices up",
        publishedAt: new Date("2026-09-26T10:15:00Z"),
        lang: "en",
        sourceName: "Example News",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/newsdata.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/sources/newsdata`.

- [ ] **Step 3: Write `src/lib/news/sources/newsdata.ts`**

```ts
// NewsData.io free tier: commercial use allowed, snippets only, 12-hour delay.
// Unavailable (returns nothing) until NEWSDATA_API_KEY is set.
import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

interface NdResult {
  title?: string;
  link?: string;
  description?: string | null;
  pubDate?: string;
  language?: string;
  source_name?: string;
  source_id?: string;
}

const LANG: Record<string, string> = { arabic: "ar", english: "en", kurdish: "ku", ar: "ar", en: "en", ku: "ku" };

export function newsdataConfigured(): boolean {
  return !!process.env.NEWSDATA_API_KEY;
}

export function newsdataUrl(key: string, keywords: string[]): string {
  const q = keywords.map((k) => k.trim()).filter(Boolean).join(" OR ").slice(0, 100);
  return `https://newsdata.io/api/1/latest?${new URLSearchParams({ apikey: key, q, language: "ar,en" })}`;
}

export function parseNewsdata(json: unknown): RawItem[] {
  const results = ((json as { results?: NdResult[] } | null)?.results ?? []).filter((r) => r.title && r.link);
  return results.map((r) => {
    const title = stripHtml(r.title!);
    const snippet = stripHtml(r.description ?? "").slice(0, 500);
    const t = Date.parse(`${(r.pubDate ?? "").replace(" ", "T")}Z`);
    return {
      url: r.link!,
      title,
      snippet,
      publishedAt: Number.isFinite(t) ? new Date(t) : new Date(),
      lang: LANG[(r.language ?? "").toLowerCase()] ?? guessLang(title),
      sourceName: r.source_name || r.source_id || new URL(r.link!).hostname,
    };
  });
}

export async function fetchNewsdata(keywords: string[]): Promise<RawItem[]> {
  const key = process.env.NEWSDATA_API_KEY;
  if (!key || !keywords.some((k) => k.trim())) return [];
  const res = await fetch(newsdataUrl(key, keywords), { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status === "error") {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(body?.results ?? body ?? "").slice(0, 160)}`);
  }
  return parseNewsdata(body);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/newsdata.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/sources/newsdata.ts tests/news/newsdata.test.ts
git commit -m "Query NewsData.io when a key is configured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Source catalog

**Files:**
- Create: `src/lib/news/catalog.ts`
- Test: `tests/news/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, it, expect } from "vitest";
import { catalogAvailable, CATALOG } from "@/lib/news/catalog";

const saved = process.env.NEWSDATA_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.NEWSDATA_API_KEY;
  else process.env.NEWSDATA_API_KEY = saved;
});

describe("catalog", () => {
  it("always offers GDELT, with its required citation", () => {
    const g = CATALOG.find((c) => c.id === "gdelt")!;
    expect(g.attribution.url).toBe("https://www.gdeltproject.org/");
  });
  it("offers NewsData only when its key is set", () => {
    delete process.env.NEWSDATA_API_KEY;
    expect(catalogAvailable().map((c) => c.id)).toEqual(["gdelt"]);
    process.env.NEWSDATA_API_KEY = "k";
    expect(catalogAvailable().map((c) => c.id)).toEqual(["gdelt", "newsdata"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/catalog.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/catalog`.

- [ ] **Step 3: Write `src/lib/news/catalog.ts`**

```ts
// The curated sources Gituas offers every news page. An outlet's RSS feed is
// added here only after its terms are read and allow this use; until then a
// page adds feeds itself and is responsible for them (see /terms).
export type CatalogId = "gdelt" | "newsdata";

export interface CatalogSource {
  id: CatalogId;
  name: string;
  description: string;
  /** Environment variable the source needs, if any. */
  needsEnv?: string;
  /** Citation the source's terms require wherever its data is shown. */
  attribution: { label: string; url: string };
}

export const CATALOG: CatalogSource[] = [
  {
    id: "gdelt",
    name: "GDELT",
    description: "هەواڵی جیهان بە +٦٥ زمان، بەپێی وشە سەرەکییەکانت. بەخۆڕایی.",
    attribution: { label: "GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "newsdata",
    name: "NewsData.io",
    description: "هەواڵی عەرەبی و ئینگلیزی بەپێی وشە سەرەکییەکانت. ١٢ کاتژمێر دواکەوتوو.",
    needsEnv: "NEWSDATA_API_KEY",
    attribution: { label: "NewsData.io", url: "https://newsdata.io/" },
  },
];

export function catalogAvailable(): CatalogSource[] {
  return CATALOG.filter((c) => !c.needsEnv || !!process.env[c.needsEnv]);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/catalog.ts tests/news/catalog.test.ts
git commit -m "Add the curated news source catalog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Clustering

**Files:**
- Create: `src/lib/news/cluster.ts`
- Test: `tests/news/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { clusterKeyFor, groupByCluster } from "@/lib/news/cluster";

const t0 = new Date("2026-09-26T10:00:00Z");

describe("clusterKeyFor", () => {
  const recent = [{ title: "Earthquake of 4.2 hits Duhok border area", lang: "en", publishedAt: t0, clusterKey: "cA" }];

  it("joins the same story told with nearly the same words", () => {
    const item = { url: "https://b.example/x", title: "Earthquake of 4.2 hits Duhok border", lang: "en", publishedAt: new Date(t0.getTime() + 3600_000) };
    expect(clusterKeyFor(item, recent)).toBe("cA");
  });
  it("keeps other languages apart", () => {
    const item = { url: "https://b.example/y", title: "Earthquake of 4.2 hits Duhok border area", lang: "ar", publishedAt: t0 };
    expect(clusterKeyFor(item, recent)).not.toBe("cA");
  });
  it("keeps stories two days apart apart", () => {
    const item = { url: "https://b.example/z", title: "Earthquake of 4.2 hits Duhok border area", lang: "en", publishedAt: new Date(t0.getTime() + 49 * 3600_000) };
    expect(clusterKeyFor(item, recent)).not.toBe("cA");
  });
  it("gives a new story a stable key from its URL", () => {
    const item = { url: "https://c.example/new", title: "Something else entirely", lang: "en", publishedAt: t0 };
    expect(clusterKeyFor(item, recent)).toBe(clusterKeyFor(item, []));
  });
});

describe("groupByCluster", () => {
  it("keeps the first item of each cluster as its lead and counts the rest", () => {
    const g = groupByCluster([
      { id: 1, clusterKey: "a" },
      { id: 2, clusterKey: "b" },
      { id: 3, clusterKey: "a" },
    ]);
    expect(g).toEqual([
      { lead: { id: 1, clusterKey: "a" }, count: 2 },
      { lead: { id: 2, clusterKey: "b" }, count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/cluster.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/cluster`.

- [ ] **Step 3: Write `src/lib/news/cluster.ts`**

```ts
import { jaccard, words } from "./text";

const WINDOW_MS = 48 * 60 * 60 * 1000;
const THRESHOLD = 0.6;

interface Titled {
  title: string;
  lang: string | null;
  publishedAt: Date;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function titleWords(title: string): string[] {
  return words(title).filter((w) => w.length > 1);
}

/**
 * The cluster an item belongs to: the key of a recent item in the same
 * language, within 48 hours, whose title shares at least 60% of its words;
 * otherwise a new key from the item's URL. Cross-language duplicates stay
 * separate in phase 1.
 */
export function clusterKeyFor(item: Titled & { url: string }, recent: Array<Titled & { clusterKey: string }>): string {
  const mine = titleWords(item.title);
  for (const r of recent) {
    if (r.lang !== item.lang) continue;
    if (Math.abs(r.publishedAt.getTime() - item.publishedAt.getTime()) > WINDOW_MS) continue;
    if (jaccard(mine, titleWords(r.title)) >= THRESHOLD) return r.clusterKey;
  }
  return `c${fnv1a(item.url)}`;
}

/** One row per story, in input order: the first item seen is the lead. */
export function groupByCluster<T extends { clusterKey: string }>(items: T[]): Array<{ lead: T; count: number }> {
  const groups = new Map<string, { lead: T; count: number }>();
  for (const it of items) {
    const g = groups.get(it.clusterKey);
    if (g) g.count++;
    else groups.set(it.clusterKey, { lead: it, count: 1 });
  }
  return [...groups.values()];
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/cluster.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/cluster.ts tests/news/cluster.test.ts
git commit -m "Group the same story from several sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: AI provider (DeepSeek with Gemini fallback)

**Files:**
- Create: `src/lib/ai/provider.ts`, `src/lib/ai/deepseek.ts`, `src/lib/ai/gemini-json.ts`
- Test: `tests/news/ai-provider.test.ts`, `tests/news/deepseek.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/news/ai-provider.test.ts`:

```ts
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/deepseek", () => ({ deepseekConfigured: vi.fn(), deepseekJson: vi.fn() }));
vi.mock("@/lib/ai/gemini-json", () => ({ geminiJson: vi.fn() }));
vi.mock("@/lib/gemini", () => ({ isGeminiConfigured: vi.fn() }));

import { AiUnavailable, completeJson } from "@/lib/ai/provider";
import * as ds from "@/lib/ai/deepseek";
import * as gj from "@/lib/ai/gemini-json";
import * as g from "@/lib/gemini";

const call = { system: "s", user: "u", strength: "fast" as const };

beforeEach(() => vi.resetAllMocks());

describe("completeJson", () => {
  it("uses DeepSeek when it answers", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    vi.mocked(ds.deepseekJson).mockResolvedValue({ data: { a: 1 }, model: "deepseek-flash" });
    expect(await completeJson(call)).toEqual({ data: { a: 1 }, model: "deepseek-flash" });
    expect(gj.geminiJson).not.toHaveBeenCalled();
  });

  it("retries DeepSeek once, then falls back to Gemini", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(true);
    vi.mocked(ds.deepseekJson).mockRejectedValue(new Error("down"));
    vi.mocked(g.isGeminiConfigured).mockReturnValue(true);
    vi.mocked(gj.geminiJson).mockResolvedValue({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(await completeJson(call)).toEqual({ data: { b: 2 }, model: "gemini-2.5-flash" });
    expect(ds.deepseekJson).toHaveBeenCalledTimes(2);
  });

  it("throws AiUnavailable when nothing answers", async () => {
    vi.mocked(ds.deepseekConfigured).mockReturnValue(false);
    vi.mocked(g.isGeminiConfigured).mockReturnValue(false);
    await expect(completeJson(call)).rejects.toBeInstanceOf(AiUnavailable);
  });
});
```

`tests/news/deepseek.test.ts`:

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { DEEPSEEK_MODELS, deepseekJson } from "@/lib/ai/deepseek";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("deepseekJson", () => {
  it("sends the model for the strength and parses the JSON reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: '{"headline":"x"}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await deepseekJson({ system: "s", user: "u", strength: "fast" });
    expect(r).toEqual({ data: { headline: "x" }, model: "deepseek-flash" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe(DEEPSEEK_MODELS.fast);
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("throws on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 })));
    await expect(deepseekJson({ system: "s", user: "u", strength: "strong" })).rejects.toThrow("HTTP 401");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/news/ai-provider.test.ts tests/news/deepseek.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/provider` and `@/lib/ai/deepseek`.

- [ ] **Step 3: Write `src/lib/ai/provider.ts`**

```ts
// One call shape for JSON completions. DeepSeek first (one retry), Gemini as
// the fallback, so a DeepSeek outage never stops the desk.
import { isGeminiConfigured } from "@/lib/gemini";
import { deepseekConfigured, deepseekJson } from "./deepseek";
import { geminiJson } from "./gemini-json";

/** fast = deepseek-flash (default); strong = deepseek-v4-pro (the editor's "improve"). */
export type Strength = "fast" | "strong";

export interface JsonCall {
  system: string;
  user: string;
  strength: Strength;
}

export interface JsonResult {
  data: unknown;
  model: string;
}

export class AiUnavailable extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function completeJson(call: JsonCall): Promise<JsonResult> {
  const errors: string[] = [];
  if (deepseekConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await deepseekJson(call);
      } catch (e) {
        errors.push(`deepseek: ${message(e)}`);
      }
    }
  }
  if (isGeminiConfigured()) {
    try {
      return await geminiJson(call);
    } catch (e) {
      errors.push(`gemini: ${message(e)}`);
    }
  }
  throw new AiUnavailable(errors.join("; ") || "no AI provider is configured");
}
```

- [ ] **Step 4: Write `src/lib/ai/deepseek.ts`**

```ts
import type { JsonCall, JsonResult } from "./provider";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

// Explicit names: "deepseek-chat" is no longer listed in DeepSeek's docs.
export const DEEPSEEK_MODELS = { fast: "deepseek-flash", strong: "deepseek-v4-pro" } as const;

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export async function deepseekJson({ system, user, strength }: JsonCall): Promise<JsonResult> {
  const model = DEEPSEEK_MODELS[strength];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    // The strong model reasons first (~8 s); both stay inside Vercel's 60 s.
    signal: AbortSignal.timeout(strength === "strong" ? 50_000 : 25_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body?.error ?? body ?? "").slice(0, 200)}`);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("empty reply");
  return { data: JSON.parse(content), model: body.model ?? model };
}
```

- [ ] **Step 5: Write `src/lib/ai/gemini-json.ts`**

```ts
import { getGemini } from "@/lib/gemini";
import type { JsonCall, JsonResult } from "./provider";

const MODEL = "gemini-2.5-flash";

export async function geminiJson({ system, user }: JsonCall): Promise<JsonResult> {
  const res = await getGemini().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: { systemInstruction: system, responseMimeType: "application/json", maxOutputTokens: 1024 },
  });
  const text = res.text?.trim();
  if (!text) throw new Error("empty reply");
  return { data: JSON.parse(text), model: MODEL };
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/news/ai-provider.test.ts tests/news/deepseek.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai tests/news/ai-provider.test.ts tests/news/deepseek.test.ts
git commit -m "Add a JSON completion provider: DeepSeek with a Gemini fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Drafting

**Files:**
- Create: `src/lib/news/draft.ts`
- Test: `tests/news/draft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildUserPrompt, validateDraft } from "@/lib/news/draft";

describe("validateDraft", () => {
  const base = { headline: " سەردێڕ ", body: "دەق.", category: "ئابووری", cardKind: "STANDARD", stat: null, quote: null, speaker: null };

  it("accepts a good draft and trims it", () => {
    expect(validateDraft(base)).toEqual({ ...base, headline: "سەردێڕ", cardKind: "STANDARD" });
  });
  it("rejects a draft without a headline or body", () => {
    expect(validateDraft({ ...base, headline: "" })).toBeNull();
    expect(validateDraft({ ...base, body: 3 })).toBeNull();
    expect(validateDraft("nope")).toBeNull();
  });
  it("falls back to گشتی for an unknown category and STANDARD for an unknown kind", () => {
    const d = validateDraft({ ...base, category: "Sports", cardKind: "HERO" })!;
    expect(d.category).toBe("گشتی");
    expect(d.cardKind).toBe("STANDARD");
  });
  it("downgrades STAT without a number and QUOTE without a speaker", () => {
    expect(validateDraft({ ...base, cardKind: "STAT" })!.cardKind).toBe("STANDARD");
    expect(validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە" })!.cardKind).toBe("STANDARD");
    const q = validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت" })!;
    expect(q).toMatchObject({ cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت", stat: null });
  });
});

describe("buildUserPrompt", () => {
  it("says when there is no snippet", () => {
    expect(buildUserPrompt({ sourceName: "GDELT", title: "T", snippet: "" })).toBe("Source: GDELT\nHeadline: T\nSnippet: (none)");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/draft.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/draft`.

- [ ] **Step 3: Write `src/lib/news/draft.ts`**

```ts
import { completeJson, type Strength } from "@/lib/ai/provider";
import { CARD_KINDS, CATEGORIES, type CardKind, type Draft } from "./types";

export const DRAFT_SYSTEM = `You are the news editor of a Kurdish news page. You write Central Kurdish (Sorani) in Arabic script with standard modern orthography (ە ێ ۆ ڕ ڵ ی), the way Kurdish news outlets write.
You receive a source headline and, when available, a short snippet, in any language. Write an ORIGINAL short news post:
- Facts only, neutral tone, no opinion. Never add a fact, number, name, title or place that is not in the input.
- Restate the facts in your own words. Do not translate sentence by sentence, and never copy the source's wording when it is already Kurdish.
- If there is no snippet, the body is one sentence that restates the headline and adds nothing.
- headline: at most 90 characters. body: 1 to 3 sentences, at most 400 characters.
- Use Eastern Arabic digits (٠١٢٣٤٥٦٧٨٩). Spell foreign names the way Kurdish media spell them.
- category: one of ${CATEGORIES.slice(0, -1).join("، ")}.
- cardKind: BREAKING only for an urgent event that has just happened (an attack, a disaster, a death, a sudden decision); STAT when one number is the heart of the story (give "stat": the number with its unit); QUOTE when a named person's statement is the heart (give "quote": a short faithful paraphrase, and "speaker": the name exactly as given in the input); otherwise STANDARD.
Return only JSON: {"headline":"","body":"","category":"","cardKind":"","stat":null,"quote":null,"speaker":null}`;

export function buildUserPrompt(item: { sourceName: string; title: string; snippet: string }): string {
  return `Source: ${item.sourceName}\nHeadline: ${item.title}\nSnippet: ${item.snippet || "(none)"}`;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? [...t].slice(0, max).join("") : null;
}

/** The AI's JSON as a Draft, or null when it is unusable. Lengths are clamped; the rules flag long text. */
export function validateDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = str(r.headline, 160);
  const body = str(r.body, 800);
  if (!headline || !body) return null;
  const category = (CATEGORIES as readonly string[]).includes(String(r.category)) ? String(r.category) : "گشتی";
  let cardKind: CardKind = CARD_KINDS.includes(r.cardKind as CardKind) ? (r.cardKind as CardKind) : "STANDARD";
  const stat = str(r.stat, 30);
  const quote = str(r.quote, 200);
  const speaker = str(r.speaker, 60);
  if (cardKind === "STAT" && !stat) cardKind = "STANDARD";
  if (cardKind === "QUOTE" && (!quote || !speaker)) cardKind = "STANDARD";
  return {
    headline,
    body,
    category,
    cardKind,
    stat: cardKind === "STAT" ? stat : null,
    quote: cardKind === "QUOTE" ? quote : null,
    speaker: cardKind === "QUOTE" ? speaker : null,
  };
}

export async function draftFor(
  item: { sourceName: string; title: string; snippet: string },
  strength: Strength,
): Promise<{ draft: Draft; model: string }> {
  const { data, model } = await completeJson({ system: DRAFT_SYSTEM, user: buildUserPrompt(item), strength });
  const draft = validateDraft(data);
  if (!draft) throw new Error("The AI returned an unusable draft");
  return { draft, model };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/draft.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/draft.ts tests/news/draft.test.ts
git commit -m "Draft Sorani news posts from a headline and snippet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Legal rules and the caption

**Files:**
- Create: `src/lib/news/rules.ts`
- Test: `tests/news/rules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { captionFor, checkDraft, overlapRatio } from "@/lib/news/rules";

const SRC = {
  title: "بەغدا و کوەیت لاپەڕەیەکی نوێ",
  snippet: "عێراق و کوەیت لەسەر پێکهێنانی لیژنەیەکی هاوبەش بۆ یەکلاکردنەوەی دۆسیە هەڵپەسێردراوەکان رێککەوتن",
};

describe("overlapRatio", () => {
  it("is 1 for a copy and 0 for unrelated text", () => {
    expect(overlapRatio(SRC.snippet, SRC.snippet)).toBe(1);
    expect(overlapRatio("Gold prices rose in Erbil markets this week", SRC.snippet)).toBe(0);
  });
});

describe("checkDraft", () => {
  it("blocks a Kurdish draft that copies the source", () => {
    const d = { headline: "عێراق و کوەیت لەسەر پێکهێنانی", body: SRC.snippet };
    expect(checkDraft(d, SRC).map((p) => p.code)).toContain("COPY");
  });
  it("passes a restated draft of a foreign-language source", () => {
    const src = { title: "مجلس الأمن يدين هجمات الحوثيين على الرياض", snippet: "دان مجلس الأمن تصاعد هجمات جماعة أنصار الله" };
    const d = { headline: "ئەنجومەنی ئاسایش هێرشەکانی حوسییەکانی ئیدانە کرد", body: "ئەنجومەنی ئاسایشی نەتەوە یەکگرتووەکان هێرشەکانی بۆ سەر ڕیاز ئیدانە کرد." };
    expect(checkDraft(d, src)).toEqual([]);
  });
  it("flags empty and too-long text", () => {
    expect(checkDraft({ headline: "", body: "x" }, SRC).map((p) => p.code)).toContain("EMPTY");
    expect(checkDraft({ headline: "ا".repeat(121), body: "x" }, SRC).map((p) => p.code)).toContain("HEADLINE_LONG");
    expect(checkDraft({ headline: "x", body: "ب".repeat(601) }, SRC).map((p) => p.code)).toContain("BODY_LONG");
  });
});

describe("captionFor", () => {
  it("ends every caption with the source and its link", () => {
    expect(captionFor({ headline: " سەردێڕ ", body: "دەق " }, { name: "ڕووداو", url: "https://example.com/a" })).toBe(
      "سەردێڕ\n\nدەق\n\nسەرچاوە: ڕووداو\nhttps://example.com/a",
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/rules.test.ts`
Expected: FAIL — cannot resolve `@/lib/news/rules`.

- [ ] **Step 3: Write `src/lib/news/rules.ts`**

```ts
// The legal rules of the news desk, enforced in code (spec: "Legal rules").
// Pure: the editor runs checkDraft live in the browser, and the server runs it
// again before a card is accepted.
import { normalizeForMatch, shingles, words } from "./text";

export const LIMITS = { headline: 120, body: 600 } as const;

const N = 4;
const COPY_RATIO = 0.5;

export type ProblemCode = "EMPTY" | "HEADLINE_LONG" | "BODY_LONG" | "COPY";

export interface Problem {
  code: ProblemCode;
  message: string;
}

const ku = (n: number) => new Intl.NumberFormat("ar-IQ").format(n);

/** Share of the text's word 4-grams that also appear in the source. Short texts are compared whole. */
export function overlapRatio(text: string, source: string): number {
  const tw = words(text);
  const sw = words(source);
  if (!tw.length || !sw.length) return 0;
  if (tw.length < N) return normalizeForMatch(source).includes(tw.join(" ")) ? 1 : 0;
  const a = shingles(tw, N);
  const b = shingles(sw, N);
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}

/** Every problem blocks publishing until the editor fixes it. */
export function checkDraft(d: { headline: string; body: string }, src: { title: string; snippet: string }): Problem[] {
  const out: Problem[] = [];
  const headline = d.headline.trim();
  const body = d.body.trim();
  if (!headline || !body) out.push({ code: "EMPTY", message: "سەردێڕ و دەق هەردووکیان پێویستن." });
  if ([...headline].length > LIMITS.headline) out.push({ code: "HEADLINE_LONG", message: `سەردێڕ لە ${ku(LIMITS.headline)} پیت درێژترە.` });
  if ([...body].length > LIMITS.body) out.push({ code: "BODY_LONG", message: `دەق لە ${ku(LIMITS.body)} پیت درێژترە.` });
  if (overlapRatio(`${headline} ${body}`, `${src.title} ${src.snippet}`) >= COPY_RATIO) {
    out.push({ code: "COPY", message: "ئەم دەقە زۆر لە دەقی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە." });
  }
  return out;
}

/** The post text for every platform: headline, body, then the source and its link. */
export function captionFor(d: { headline: string; body: string }, source: { name: string; url: string }): string {
  return `${d.headline.trim()}\n\n${d.body.trim()}\n\nسەرچاوە: ${source.name}\n${source.url}`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run tests/news/rules.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/rules.ts tests/news/rules.test.ts
git commit -m "Enforce the news desk's legal rules: no copying, source always cited

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Plans and usage limits

**Files:**
- Create: `src/lib/billing/plans.ts`, `src/lib/billing/limits.ts`
- Test: `tests/news/limits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { LimitReached, limitMessage, monthKey } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";

describe("monthKey", () => {
  it("is the UTC year and month", () => {
    expect(monthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09");
    expect(monthKey(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });
});

describe("limits", () => {
  it("names the limit in Kurdish", () => {
    expect(limitMessage(new LimitReached("draft", 300))).toContain("٣٠٠");
  });
  it("gives every plan a number for every metric", () => {
    for (const plan of Object.values(NEWS_LIMITS)) {
      for (const m of ["draft", "improve", "publish", "sources"] as const) expect(plan[m]).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/news/limits.test.ts`
Expected: FAIL — cannot resolve `@/lib/billing/limits`.

- [ ] **Step 3: Write `src/lib/billing/plans.ts`**

```ts
// Monthly quotas per plan for the news desk. These are the launch defaults;
// change them here when packages are priced. Each costly action is refused at
// its quota, so what a page can spend is bounded by what its plan allows.
export type Metric = "draft" | "improve" | "publish";
type Plan = "MANUAL" | "AUTO" | "ENTERPRISE";

export const NEWS_LIMITS: Record<Plan, Record<Metric, number> & { sources: number }> = {
  MANUAL: { draft: 300, improve: 30, publish: 300, sources: 10 },
  AUTO: { draft: 3000, improve: 300, publish: 3000, sources: 30 },
  ENTERPRISE: { draft: 20000, improve: 2000, publish: 20000, sources: 100 },
};
```

- [ ] **Step 4: Write `src/lib/billing/limits.ts`**

```ts
import { db } from "@/lib/db";
import { NEWS_LIMITS, type Metric } from "./plans";

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export class LimitReached extends Error {
  constructor(
    readonly metric: Metric,
    readonly limit: number,
  ) {
    super(`${metric} limit of ${limit} reached`);
  }
}

const LABEL: Record<Metric, string> = { draft: "ئامادەکردنی هەواڵ", improve: "باشترکردن", publish: "بڵاوکردنەوە" };

export function limitMessage(e: LimitReached): string {
  return `سنووری ${LABEL[e.metric]}ی ئەم مانگە (${new Intl.NumberFormat("ar-IQ").format(e.limit)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`;
}

/** Throws LimitReached when this month's count has reached the plan's quota. */
export async function assertWithin(tenantId: string, metric: Metric): Promise<void> {
  const [tenant, row] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
    db.usage.findUnique({ where: { tenantId_month_metric: { tenantId, month: monthKey(), metric } }, select: { count: true } }),
  ]);
  const limit = NEWS_LIMITS[tenant?.plan ?? "MANUAL"][metric];
  if ((row?.count ?? 0) >= limit) throw new LimitReached(metric, limit);
}

/** Counted after the action succeeds. Two parallel actions can pass one over the quota; that is accepted. */
export async function countUsage(tenantId: string, metric: Metric): Promise<void> {
  const month = monthKey();
  await db.usage.upsert({
    where: { tenantId_month_metric: { tenantId, month, metric } },
    create: { tenantId, month, metric, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export async function usageOf(tenantId: string, metric: Metric): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId, month: monthKey(), metric } }, select: { count: true } });
  return row?.count ?? 0;
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run tests/news/limits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/billing tests/news/limits.test.ts
git commit -m "Add monthly usage quotas for the news desk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ingest (throttled, cached, clustered)

**Files:**
- Create: `src/lib/news/ingest.ts`

The database paths are checked end to end in Task 22.

- [ ] **Step 1: Write `src/lib/news/ingest.ts`**

```ts
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { clusterKeyFor } from "./cluster";
import { fetchGdelt } from "./sources/gdelt";
import { fetchNewsdata } from "./sources/newsdata";
import { fetchFeed } from "./sources/rss";
import { matchesKeywords } from "./text";
import type { RawItem } from "./types";

const THROTTLE_MS = 5 * 60 * 1000;
const TTL = { rss: 5 * 60 * 1000, gdelt: 10 * 60 * 1000, newsdata: 15 * 60 * 1000 };
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_NEW_PER_FETCH = 100;

type Stored = Omit<RawItem, "publishedAt"> & { publishedAt: string };

const toJson = (items: RawItem[]): Prisma.InputJsonValue =>
  items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() })) as unknown as Prisma.InputJsonValue;
const fromJson = (v: unknown): RawItem[] => ((v as Stored[]) ?? []).map((i) => ({ ...i, publishedAt: new Date(i.publishedAt) }));

/**
 * A source's items, shared across tenants: fetched at most once per TTL.
 * When a fetch fails, the last good result is served rather than nothing.
 */
async function cached(key: string, ttl: number, load: () => Promise<RawItem[]>): Promise<RawItem[]> {
  const hit = await db.sourceCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttl) return fromJson(hit.items);
  try {
    const items = await load();
    const data = { items: toJson(items), fetchedAt: new Date() };
    await db.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    return items;
  } catch (e) {
    if (hit) return fromJson(hit.items);
    throw e;
  }
}

export interface IngestResult {
  added: number;
  failed: string[];
  skipped: boolean;
}

/** Fetch every enabled source of a news page and store the new stories. */
export async function ingest(tenantId: string, { force = false } = {}): Promise<IngestResult> {
  const settings = await db.newsSettings.upsert({ where: { tenantId }, create: { tenantId, keywords: [] }, update: {} });
  if (!force && settings.lastFetchedAt && Date.now() - settings.lastFetchedAt.getTime() < THROTTLE_MS) {
    return { added: 0, failed: [], skipped: true };
  }
  // Claim the fetch first, so two tabs opening the desk don't both fetch.
  await db.newsSettings.update({ where: { tenantId }, data: { lastFetchedAt: new Date() } });

  const keywords = settings.keywords;
  const kwKey = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).sort().join("|");
  const sources = await db.newsSource.findMany({ where: { tenantId, enabled: true } });

  const fetched = await Promise.all(
    sources.map(async (s) => {
      try {
        let items: RawItem[] = [];
        if (s.catalogId === "gdelt") items = await cached(`gdelt:${kwKey}`, TTL.gdelt, () => fetchGdelt(keywords));
        else if (s.catalogId === "newsdata") items = await cached(`newsdata:${kwKey}`, TTL.newsdata, () => fetchNewsdata(keywords));
        else if (s.rssUrl) {
          const all = await cached(`rss:${s.rssUrl}`, TTL.rss, () => fetchFeed(s.rssUrl!, s.name));
          items = all.filter((i) => matchesKeywords(`${i.title} ${i.snippet}`, keywords)).map((i) => ({ ...i, sourceName: s.name }));
        }
        if (s.lastError) await db.newsSource.update({ where: { id: s.id }, data: { lastError: null } });
        return { items, failed: null as string | null };
      } catch (e) {
        await db.newsSource.update({ where: { id: s.id }, data: { lastError: (e instanceof Error ? e.message : String(e)).slice(0, 200) } });
        return { items: [] as RawItem[], failed: s.name };
      }
    }),
  );

  const now = Date.now();
  const fresh = fetched
    .flatMap((f) => f.items)
    .filter((i) => now - i.publishedAt.getTime() < MAX_AGE_MS)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, MAX_NEW_PER_FETCH);

  const recent = await db.newsItem.findMany({
    where: { tenantId, publishedAt: { gte: new Date(now - CLUSTER_WINDOW_MS) } },
    select: { title: true, lang: true, publishedAt: true, clusterKey: true },
  });

  let added = 0;
  for (const it of fresh) {
    const clusterKey = clusterKeyFor(it, recent);
    const r = await db.newsItem.createMany({
      data: [
        {
          tenantId,
          sourceName: it.sourceName.slice(0, 120),
          url: it.url,
          title: it.title.slice(0, 500),
          snippet: it.snippet,
          lang: it.lang,
          publishedAt: it.publishedAt,
          clusterKey,
        },
      ],
      skipDuplicates: true,
    });
    if (r.count) {
      added++;
      recent.push({ title: it.title, lang: it.lang, publishedAt: it.publishedAt, clusterKey });
    }
  }
  return { added, failed: fetched.flatMap((f) => (f.failed ? [f.failed] : [])), skipped: false };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `src/lib/news/ingest.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/news/ingest.ts
git commit -m "Fetch a news page's sources: throttled, shared cache, clustered

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Workspace kind, the one-time choice, and the tab bar

**Files:**
- Modify: `src/app/app/data.ts` (interface `Workspace` and `currentWorkspace`)
- Modify: `src/app/app/actions.ts` (add `setTenantKindAction`)
- Create: `src/app/app/kind-chooser.tsx`
- Modify: `src/app/app/page.tsx` (top of `TodayPage`)
- Modify: `src/app/app/nav.tsx`, `src/app/app/layout.tsx`

- [ ] **Step 1: Carry the kind on the workspace**

In `src/app/app/data.ts`, replace the `Workspace` interface with:

```ts
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  whatsappNumber: string | null;
  kind: "MERCHANT" | "NEWS";
  kindChosen: boolean;
}
```

and in `currentWorkspace` replace the `select` line with:

```ts
  const select = { id: true, slug: true, name: true, whatsappNumber: true, kind: true, kindChosen: true } as const;
```

- [ ] **Step 2: Add `setTenantKindAction` to `src/app/app/actions.ts`**

Append:

```ts
/**
 * Shop or news page. Becoming a news page also gives it desk settings and
 * GDELT as a first source, so the desk is never empty on the first visit.
 */
export async function setTenantKindAction(kind: "MERCHANT" | "NEWS"): Promise<Result> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (kind !== "MERCHANT" && kind !== "NEWS") return { ok: false, error: "هەڵبژاردنەکە دروست نییە." };
  await db.tenant.update({ where: { id: ws.id }, data: { kind, kindChosen: true } });
  if (kind === "NEWS") {
    await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [] }, update: {} });
    await db.newsSource.upsert({
      where: { tenantId_catalogId: { tenantId: ws.id, catalogId: "gdelt" } },
      create: { tenantId: ws.id, catalogId: "gdelt", name: "GDELT" },
      update: {},
    });
  }
  await audit(ws.id, "app.kind_set", `Set the workspace kind to ${kind}.`, { kind });
  revalidatePath("/app", "layout");
  return { ok: true };
}
```

- [ ] **Step 3: Write `src/app/app/kind-chooser.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Newspaper, Store } from "lucide-react";

import { setTenantKindAction } from "./actions";

/** Asked once after sign-in; changeable later in Settings. */
export function KindChooser() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(kind: "MERCHANT" | "NEWS") {
    setError(null);
    start(async () => {
      const r = await setTenantKindAction(kind);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace(kind === "NEWS" ? "/app/news" : "/app");
      router.refresh();
    });
  }

  return (
    <div className="gm-stack">
      <h2 className="gm-title kufi">بەخێربێیت</h2>
      <p className="gm-sub">گیتواس بۆ چی بەکار دەهێنیت؟ دواتر لە ڕێکخستن دەتوانیت بیگۆڕیت.</p>
      <button type="button" className="gm-card gm-row" style={{ textAlign: "start", cursor: "pointer" }} disabled={pending} onClick={() => choose("MERCHANT")}>
        <Store aria-hidden="true" />
        <span>
          <b>دووکان</b>
          <br />
          <small className="gm-sub">وەڵامی کۆمێنت و نامەی کڕیاران، بڵاوکردنەوە و ئامار.</small>
        </span>
      </button>
      <button type="button" className="gm-card gm-row" style={{ textAlign: "start", cursor: "pointer" }} disabled={pending} onClick={() => choose("NEWS")}>
        <Newspaper aria-hidden="true" />
        <span>
          <b>پەیجی هەواڵ</b>
          <br />
          <small className="gm-sub">هەواڵ لە سەرچاوەکانەوە، کورتەی کوردی، کارتی براندی خۆت، بڵاوکردنەوە.</small>
        </span>
      </button>
      {error && <p className="gm-err">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Route by kind on `/app`**

In `src/app/app/page.tsx`, add the imports:

```ts
import { redirect } from "next/navigation";
import { KindChooser } from "./kind-chooser";
```

and replace the first line of `TodayPage`'s body, `const ws = (await currentWorkspace())!;`, with:

```ts
  const ws = (await currentWorkspace())!;
  if (!ws.kindChosen) return <KindChooser />;
  if (ws.kind === "NEWS") redirect("/app/news");
```

- [ ] **Step 5: Give news pages their tab bar**

In `src/app/app/nav.tsx`, replace the import line from `lucide-react` and the `TABS` constant with:

```ts
import { BarChart3, Home, MessageCircle, MessagesSquare, Newspaper, SquarePlus } from "lucide-react";

const SHARED = [
  { href: "/app/comments", label: "کۆمێنت", Icon: MessagesSquare },
  { href: "/app/messages", label: "نامە", Icon: MessageCircle },
  { href: "/app/publish", label: "بڵاوکردنەوە", Icon: SquarePlus },
  { href: "/app/insights", label: "ئامار", Icon: BarChart3 },
] as const;

const TABS = {
  MERCHANT: [{ href: "/app", label: "ئەمڕۆ", Icon: Home }, ...SHARED],
  NEWS: [{ href: "/app/news", label: "هەواڵ", Icon: Newspaper }, ...SHARED],
} as const;
```

then change `export function Tabs() {` to `export function Tabs({ kind }: { kind: "MERCHANT" | "NEWS" }) {` and `{TABS.map(({ href, label, Icon }) => {` to `{TABS[kind].map(({ href, label, Icon }) => {`.

In `src/app/app/layout.tsx`, change `<Tabs />` to `<Tabs kind={ws.kind} />`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/app/data.ts src/app/app/actions.ts src/app/app/kind-chooser.tsx src/app/app/page.tsx src/app/app/nav.tsx src/app/app/layout.tsx
git commit -m "Ask once whether a workspace is a shop or a news page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: News server actions

**Files:**
- Create: `src/app/app/news/actions.ts`

- [ ] **Step 1: Write `src/app/app/news/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { assertWithin, countUsage, LimitReached, limitMessage } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { AiUnavailable, type Strength } from "@/lib/ai/provider";
import { catalogAvailable, type CatalogId } from "@/lib/news/catalog";
import { draftFor } from "@/lib/news/draft";
import { ingest } from "@/lib/news/ingest";
import { checkDraft, LIMITS } from "@/lib/news/rules";
import { fetchFeed } from "@/lib/news/sources/rss";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { currentWorkspace, type Workspace } from "../data";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DraftView {
  draftId: string;
  headline: string;
  body: string;
  category: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
  model: string;
}

async function newsWorkspace(): Promise<Workspace | null> {
  const ws = await currentWorkspace();
  return ws && ws.kind === "NEWS" ? ws : null;
}

const NOT_NEWS = { ok: false as const, error: "ئەم بەشە تەنها بۆ پەیجی هەواڵە." };

function view(d: {
  id: string;
  headline: string;
  body: string;
  category: string;
  cardKind: string;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
  model: string;
}): DraftView {
  return {
    draftId: d.id,
    headline: d.headline,
    body: d.body,
    category: d.category,
    cardKind: (CARD_KINDS.includes(d.cardKind as CardKind) ? d.cardKind : "STANDARD") as CardKind,
    stat: d.stat,
    quote: d.quote,
    speaker: d.speaker,
    photoPath: d.photoPath,
    model: d.model,
  };
}

export async function refreshNewsAction(): Promise<Result<{ added: number; failed: string[] }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const r = await ingest(ws.id, { force: true });
  revalidatePath("/app/news");
  return { ok: true, added: r.added, failed: r.failed };
}

/** Write (or rewrite) the draft for an item. `strong` is the editor's "improve". */
export async function draftNewsAction(itemId: string, strength: Strength): Promise<Result<{ draft: DraftView }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: "هەواڵەکە نەدۆزرایەوە." };
  const metric = strength === "strong" ? "improve" : "draft";
  try {
    await assertWithin(ws.id, metric);
    const { draft, model } = await draftFor(item, strength);
    const data = { ...draft, model, tenantId: ws.id };
    const saved = await db.newsDraft.upsert({ where: { itemId }, create: { itemId, ...data }, update: data });
    await countUsage(ws.id, metric);
    if (item.status === "NEW") await db.newsItem.update({ where: { id: itemId }, data: { status: "DRAFTED" } });
    return { ok: true, draft: view(saved) };
  } catch (e) {
    if (e instanceof LimitReached) return { ok: false, error: limitMessage(e) };
    if (e instanceof AiUnavailable) return { ok: false, error: "نووسینی خۆکار ئێستا بەردەست نییە. دەتوانیت خۆت بینووسیت." };
    return { ok: false, error: "ئامادەکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە." };
  }
}

export interface DraftFields {
  headline: string;
  body: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
}

/** Save the editor's text. Creates the draft when the editor wrote it by hand. */
export async function saveNewsDraftAction(itemId: string, f: DraftFields): Promise<Result<{ draftId: string }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: "هەواڵەکە نەدۆزرایەوە." };
  if (!CARD_KINDS.includes(f.cardKind)) return { ok: false, error: "جۆری کارت دروست نییە." };
  if (f.photoPath && !f.photoPath.startsWith(`merchant/${ws.id}/`)) return { ok: false, error: "وێنەکە ناناسرێتەوە." };
  const clip = (s: string | null, max: number) => (s ? [...s.trim()].slice(0, max).join("") || null : null);
  const data = {
    headline: [...f.headline.trim()].slice(0, LIMITS.headline + 40).join(""),
    body: [...f.body.trim()].slice(0, LIMITS.body + 200).join(""),
    cardKind: f.cardKind,
    stat: clip(f.stat, 30),
    quote: clip(f.quote, 200),
    speaker: clip(f.speaker, 60),
    photoPath: f.photoPath,
  };
  const saved = await db.newsDraft.upsert({
    where: { itemId },
    create: { itemId, tenantId: ws.id, category: "گشتی", model: "manual", ...data },
    update: data,
  });
  if (item.status === "NEW") await db.newsItem.update({ where: { id: itemId }, data: { status: "DRAFTED" } });
  return { ok: true, draftId: saved.id };
}

/** Accept the rendered card, after checking the rules again on the server. */
export async function attachCardAction(itemId: string, card: { url: string; pathname: string }): Promise<Result<{ draftId: string }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const draft = await db.newsDraft.findFirst({ where: { itemId, tenantId: ws.id }, include: { item: true } });
  if (!draft) return { ok: false, error: "سەرەتا دەقەکە پاشەکەوت بکە." };
  const problems = checkDraft(draft, draft.item);
  if (problems.length) return { ok: false, error: problems[0].message };
  if (!card.pathname.startsWith(`merchant/${ws.id}/`) || !/^https:\/\//.test(card.url)) return { ok: false, error: "کارتەکە ناناسرێتەوە." };
  await db.newsDraft.update({ where: { id: draft.id }, data: { cardUrl: card.url, cardPath: card.pathname } });
  return { ok: true, draftId: draft.id };
}

export async function dismissNewsAction(itemId: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  await db.newsItem.updateMany({ where: { id: itemId, tenantId: ws.id }, data: { status: "DISMISSED" } });
  revalidatePath("/app/news");
  return { ok: true };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveKeywordsAction(raw: string): Promise<Result<{ keywords: string[] }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const keywords = [...new Set(raw.split(/[,،\n]/).map((k) => k.trim()).filter((k) => k.length >= 2))].slice(0, 20);
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords }, update: { keywords, lastFetchedAt: null } });
  return { ok: true, keywords };
}

async function underSourceLimit(tenantId: string): Promise<boolean> {
  const [tenant, count] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
    db.newsSource.count({ where: { tenantId } }),
  ]);
  return count < NEWS_LIMITS[tenant?.plan ?? "MANUAL"].sources;
}

export async function toggleCatalogSourceAction(catalogId: CatalogId, enabled: boolean): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const entry = catalogAvailable().find((c) => c.id === catalogId);
  if (!entry) return { ok: false, error: "ئەم سەرچاوەیە بەردەست نییە." };
  const existing = await db.newsSource.findUnique({ where: { tenantId_catalogId: { tenantId: ws.id, catalogId } } });
  if (!existing && enabled && !(await underSourceLimit(ws.id))) return { ok: false, error: "سنووری ژمارەی سەرچاوەکانی پاکێجەکەت پڕ بووە." };
  await db.newsSource.upsert({
    where: { tenantId_catalogId: { tenantId: ws.id, catalogId } },
    create: { tenantId: ws.id, catalogId, name: entry.name, enabled },
    update: { enabled },
  });
  return { ok: true };
}

/** Add the page's own feed; it must answer with at least one story. */
export async function addRssSourceAction(url: string, name: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  const u = url.trim();
  const n = name.trim().slice(0, 60);
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, error: "لینکەکە دروست نییە." };
  if (!n) return { ok: false, error: "ناوی سەرچاوەکە بنووسە." };
  if (!(await underSourceLimit(ws.id))) return { ok: false, error: "سنووری ژمارەی سەرچاوەکانی پاکێجەکەت پڕ بووە." };
  try {
    const items = await fetchFeed(u, n);
    if (!items.length) return { ok: false, error: "ئەم لینکە هیچ هەواڵێکی تێدا نییە." };
  } catch {
    return { ok: false, error: "ئەم لینکە RSS نییە یان وەڵام ناداتەوە." };
  }
  try {
    await db.newsSource.create({ data: { tenantId: ws.id, rssUrl: u, name: n } });
  } catch {
    return { ok: false, error: "ئەم سەرچاوەیە پێشتر زیاد کراوە." };
  }
  return { ok: true };
}

export async function removeSourceAction(id: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  await db.newsSource.deleteMany({ where: { id, tenantId: ws.id, rssUrl: { not: null } } });
  return { ok: true };
}

const HEX = /^#[0-9a-f]{6}$/i;

export async function saveBrandKitAction(kit: {
  logoPath: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
}): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (![kit.primary, kit.accent, kit.text].every((c) => HEX.test(c))) return { ok: false, error: "ڕەنگەکان دروست نین." };
  if (kit.headingFont !== "kufi" && kit.headingFont !== "sans") return { ok: false, error: "فۆنتەکە دروست نییە." };
  if (kit.logoPath && !kit.logoPath.startsWith(`merchant/${ws.id}/`)) return { ok: false, error: "لۆگۆکە ناناسرێتەوە." };
  const data = { logoPath: kit.logoPath, primary: kit.primary, accent: kit.accent, text: kit.text, headingFont: kit.headingFont };
  await db.brandKit.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, ...data }, update: data });
  return { ok: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/app/news/actions.ts
git commit -m "Add the news desk server actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Card templates and rendering

**Files:**
- Create: `src/lib/cards/brand.ts`, `src/lib/cards/templates.tsx`, `src/lib/cards/render.ts`

- [ ] **Step 1: Write `src/lib/cards/brand.ts`**

```ts
export interface Brand {
  pageName: string;
  logoSrc: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
}

export const HEADING_FONT = {
  kufi: "var(--gm-kufi), var(--gm-sans), sans-serif",
  sans: "var(--gm-sans), sans-serif",
} as const;
export const BODY_FONT = "var(--gm-sans), sans-serif";

/**
 * Uploaded files are shown through our own /m/ proxy: same origin, so the
 * browser can paint them into the PNG without cross-origin taint.
 */
export function mediaSrc(pathname: string | null | undefined): string | null {
  return pathname ? `/m/${pathname}` : null;
}

export function brandFrom(
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: string } | null,
  pageName: string,
): Brand {
  return {
    pageName,
    logoSrc: mediaSrc(kit?.logoPath),
    primary: kit?.primary ?? "#0B2545",
    accent: kit?.accent ?? "#E0A526",
    text: kit?.text ?? "#FFFFFF",
    headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
  };
}
```

- [ ] **Step 2: Write `src/lib/cards/templates.tsx`**

```tsx
"use client";

import { forwardRef, useLayoutEffect, useRef, type CSSProperties } from "react";

import type { CardKind } from "@/lib/news/types";
import { BODY_FONT, HEADING_FONT, type Brand } from "./brand";

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardContent {
  headline: string;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  sourceName: string;
  stamp: string;
  photoSrc: string | null;
}

/**
 * Shrinks the element's font from `max` px until its text fits its box, down
 * to `min`. Marks `data-overflow="1"` when even `min` does not fit, so the
 * editor can ask for a shorter headline.
 */
function useFit(text: string, max: number, min: number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = max;
    el.style.fontSize = `${size}px`;
    while (size > min && el.scrollHeight > el.clientHeight) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
    el.dataset.overflow = el.scrollHeight > el.clientHeight ? "1" : "0";
  }, [text, max, min]);
  return ref;
}

const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });

function Header({ brand, dark }: { brand: Brand; dark: boolean }) {
  const color = dark ? brand.primary : brand.text;
  return (
    <div style={abs({ top: 48, right: 56, left: 56, display: "flex", alignItems: "center", gap: 18, color })}>
      {brand.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt="" style={{ height: 72, width: "auto", maxWidth: 260, objectFit: "contain" }} />
      ) : (
        <span style={{ width: 64, height: 64, borderRadius: 32, background: dark ? brand.primary : brand.accent, color: dark ? brand.accent : brand.primary, display: "grid", placeItems: "center", font: `700 34px ${HEADING_FONT[brand.headingFont]}` }}>
          {[...brand.pageName][0] ?? "ه"}
        </span>
      )}
      <span style={{ font: `700 34px ${HEADING_FONT[brand.headingFont]}` }}>{brand.pageName}</span>
    </div>
  );
}

function Footer({ brand, content, dark }: { brand: Brand; content: CardContent; dark: boolean }) {
  return (
    <div style={abs({ bottom: 44, right: 56, left: 56, display: "flex", justifyContent: "space-between", font: `500 26px ${BODY_FONT}`, color: dark ? brand.primary : brand.text, opacity: 0.85 })}>
      <span>سەرچاوە: {content.sourceName}</span>
      <span>{content.stamp}</span>
    </div>
  );
}

function Standard({ brand, content }: { brand: Brand; content: CardContent }) {
  const head = useFit(content.headline, 64, 36);
  return (
    <>
      <div style={abs({ top: 0, right: 0, left: 0, height: 780, background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})` })}>
        {content.photoSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.photoSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={abs({ top: 0, right: 0, left: 0, height: 180, background: "linear-gradient(rgba(0,0,0,.55), transparent)" })} />
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 780, right: 0, left: 0, bottom: 0, background: brand.primary, borderTop: `12px solid ${brand.accent}` })} />
      <div ref={head} style={abs({ top: 840, right: 56, left: 56, height: 360, overflow: "hidden", color: brand.text, font: `700 64px/1.55 ${HEADING_FONT[brand.headingFont]}` })}>
        {content.headline}
      </div>
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

function Breaking({ brand, content }: { brand: Brand; content: CardContent }) {
  const head = useFit(content.headline, 84, 44);
  return (
    <>
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 220, right: 0, background: "#C8102E", color: "#fff", padding: "18px 56px", font: `700 56px ${HEADING_FONT[brand.headingFont]}` })}>بەپەلە</div>
      <div ref={head} style={abs({ top: 400, right: 56, left: 56, height: 620, overflow: "hidden", color: brand.text, font: `700 84px/1.55 ${HEADING_FONT[brand.headingFont]}` })}>
        {content.headline}
      </div>
      <div style={abs({ top: 1060, right: 56, width: 180, height: 12, background: brand.accent })} />
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

function Stat({ brand, content }: { brand: Brand; content: CardContent }) {
  const head = useFit(content.headline, 60, 34);
  return (
    <>
      <div style={abs({ inset: 0, background: brand.accent })} />
      <Header brand={brand} dark />
      <div style={abs({ top: 250, right: 56, left: 56, color: brand.primary, font: `700 220px/1.1 ${HEADING_FONT[brand.headingFont]}`, whiteSpace: "nowrap", overflow: "hidden" })}>
        {content.stat}
      </div>
      <div ref={head} style={abs({ top: 600, right: 56, left: 56, height: 520, overflow: "hidden", color: brand.primary, font: `700 60px/1.6 ${HEADING_FONT[brand.headingFont]}` })}>
        {content.headline}
      </div>
      <Footer brand={brand} content={content} dark />
    </>
  );
}

function Quote({ brand, content }: { brand: Brand; content: CardContent }) {
  const text = content.quote ?? content.headline;
  const q = useFit(text, 64, 36);
  return (
    <>
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 200, right: 48, color: brand.accent, font: `700 260px/1 ${HEADING_FONT[brand.headingFont]}` })}>«</div>
      <div ref={q} style={abs({ top: 470, right: 64, left: 64, height: 540, overflow: "hidden", color: brand.text, font: `700 64px/1.6 ${HEADING_FONT[brand.headingFont]}` })}>
        {text}
      </div>
      <div style={abs({ top: 1060, right: 64, left: 64, color: brand.accent, font: `600 40px ${BODY_FONT}` })}>— {content.speaker}</div>
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

/** A 1080×1350 card. Render it unscaled; scale its parent for previews. */
export const NewsCard = forwardRef<HTMLDivElement, { kind: CardKind; brand: Brand; content: CardContent }>(function NewsCard(
  { kind, brand, content },
  ref,
) {
  return (
    <div
      ref={ref}
      dir="rtl"
      style={{ position: "relative", width: CARD_W, height: CARD_H, overflow: "hidden", background: brand.primary, fontFamily: BODY_FONT }}
    >
      {kind === "BREAKING" ? (
        <Breaking brand={brand} content={content} />
      ) : kind === "STAT" ? (
        <Stat brand={brand} content={content} />
      ) : kind === "QUOTE" ? (
        <Quote brand={brand} content={content} />
      ) : (
        <Standard brand={brand} content={content} />
      )}
    </div>
  );
});
```

- [ ] **Step 3: Write `src/lib/cards/render.ts`**

```ts
import { toPng } from "html-to-image";

import { CARD_H, CARD_W } from "./templates";

/**
 * Paint a card node into a PNG in the browser. The browser shapes the
 * Kurdish text, so it comes out exactly as it looks on screen.
 */
export async function renderCardPng(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const dataUrl = await toPng(node, { width: CARD_W, height: CARD_H, pixelRatio: 1, cacheBust: true });
  return await (await fetch(dataUrl)).blob();
}
```

- [ ] **Step 4: Add a development-only preview at `/dev/cards`**

The desk itself needs a signed-in news page; this page lets the templates and
the PNG output be checked in the browser preview without one. It is a 404 in
production.

`src/app/dev/cards/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import { CardsPreview } from "./preview";

export default function DevCardsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={gmFontVars} style={{ padding: 16, background: "#f6f5f2", minHeight: "100vh" }}>
      <CardsPreview />
    </div>
  );
}
```

`src/app/dev/cards/preview.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom } from "@/lib/cards/brand";
import { renderCardPng } from "@/lib/cards/render";
import type { CardKind } from "@/lib/news/types";

const W = 260;
const brand = brandFrom(null, "هەواڵی هەولێر");
const SAMPLES: Array<{ kind: CardKind; headline: string; stat?: string; quote?: string; speaker?: string }> = [
  { kind: "STANDARD", headline: "حکومەتی هەرێم پڕۆژەی بودجەی ساڵی داهاتووی پەسەند کرد" },
  { kind: "BREAKING", headline: "بوومەلەرزەیەکی ٤.٢ پلەیی سنووری دهۆکی هەژاند" },
  { kind: "STAT", headline: "بەرزبوونەوەی نرخی ئاڵتوون لە بازاڕەکانی هەولێر لە مانگێکدا", stat: "٪١٢" },
  { kind: "QUOTE", headline: "کارەبا", quote: "کارەبای نیشتمانی لە مانگی داهاتووەوە ٢٠ کاتژمێر دەبێت", speaker: "وەزارەتی کارەبا" },
];

export function CardsPreview() {
  const first = useRef<HTMLDivElement>(null);
  const [png, setPng] = useState<string | null>(null);
  return (
    <div dir="rtl">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {SAMPLES.map((s, i) => (
          <div key={s.kind} dir="ltr" style={{ width: W, height: (CARD_H * W) / CARD_W, overflow: "hidden", borderRadius: 10 }}>
            <div style={{ transform: `scale(${W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
              <NewsCard
                ref={i === 1 ? first : undefined}
                kind={s.kind}
                brand={brand}
                content={{ headline: s.headline, stat: s.stat ?? null, quote: s.quote ?? null, speaker: s.speaker ?? null, sourceName: "ڕاگەیەندراوی فەرمی", stamp: "٢٦/٩ ١٠:٤٢", photoSrc: null }}
              />
            </div>
          </div>
        ))}
      </div>
      <button type="button" style={{ marginTop: 12 }} onClick={async () => setPng(URL.createObjectURL(await renderCardPng(first.current!)))}>
        PNG of the breaking card
      </button>
      {png && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={png} alt="rendered card" style={{ display: "block", width: W, marginTop: 12 }} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Look at the cards**

Start the dev server (`.claude/launch.json` config `gituas-dev`, port 3001), open `http://localhost:3001/dev/cards`, check that the four cards show joined Kurdish letters, the logo circle, the source and the stamp, then press the button and check that the PNG looks identical to the breaking card. Take one screenshot for the record.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cards src/app/dev
git commit -m "Add the four built-in news card templates and DOM-to-PNG rendering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The story list (`/app/news`)

**Files:**
- Create: `src/app/app/news/page.tsx`, `src/app/app/news/refresh-button.tsx`

- [ ] **Step 1: Write `src/app/app/news/refresh-button.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { refreshNewsAction } from "./actions";

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="gm-btn quiet small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshNewsAction();
            if (!r.ok) setNote(r.error);
            else setNote(r.failed.length ? `وەڵامی نەدایەوە: ${r.failed.join("، ")}` : null);
            router.refresh();
          })
        }
      >
        <RefreshCw size={14} aria-hidden="true" />
        {pending ? "نوێ دەکرێتەوە…" : "نوێکردنەوە"}
      </button>
      {note && <small className="gm-hint">{note}</small>}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/app/news/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { usageOf } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { groupByCluster } from "@/lib/news/cluster";
import { ingest } from "@/lib/news/ingest";
import { currentWorkspace } from "../data";
import { ago, num } from "../format";
import { RefreshButton } from "./refresh-button";

export const maxDuration = 60;

const TABS = [
  { key: "new", label: "نوێ", statuses: ["NEW"] },
  { key: "ready", label: "ئامادە", statuses: ["DRAFTED"] },
  { key: "done", label: "بڵاوکراوە", statuses: ["PUBLISHED"] },
] as const;

const LANG_LABEL: Record<string, string> = { ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (ws.kind !== "NEWS") redirect("/app");
  const { tab: tabKey } = await searchParams;
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];

  // Fetching is throttled to once per five minutes, so opening the desk is cheap.
  const ingestResult = await ingest(ws.id).catch(() => null);
  const [items, sources, settings, tenant, drafts] = await Promise.all([
    db.newsItem.findMany({
      where: { tenantId: ws.id, status: { in: [...tab.statuses] } },
      orderBy: { publishedAt: "desc" },
      take: 150,
    }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true } }),
    db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    usageOf(ws.id, "draft"),
  ]);
  const groups = groupByCluster(items);
  const limit = NEWS_LIMITS[tenant?.plan ?? "MANUAL"].draft;

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">هەواڵ</h2>
        <RefreshButton />
      </div>

      <div className="gm-chips" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/news?tab=${t.key}`} className="gm-chip" aria-pressed={t.key === tab.key}>
            {t.label}
          </Link>
        ))}
      </div>

      {!sources && (
        <p className="gm-note">
          هیچ سەرچاوەیەکت چالاک نییە. <Link href="/app/settings" className="gm-link">لە ڕێکخستن سەرچاوە زیاد بکە</Link>.
        </p>
      )}
      {!!sources && !settings?.keywords.length && (
        <p className="gm-note">
          GDELT و NewsData وشەی سەرەکییان دەوێت. <Link href="/app/settings" className="gm-link">وشە سەرەکییەکانت دابنێ</Link>.
        </p>
      )}
      {ingestResult?.failed.length ? <p className="gm-hint">وەڵامی نەدایەوە: {ingestResult.failed.join("، ")}</p> : null}

      {groups.length === 0 ? (
        <p className="gm-empty">هیچ هەواڵێک لێرە نییە.</p>
      ) : (
        <div className="gm-stack" style={{ gap: 8 }}>
          {groups.map(({ lead, count }) => (
            <Link key={lead.id} href={`/app/news/${lead.id}`} className="gm-card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
              <b dir="auto" style={{ display: "block", lineHeight: 1.7 }}>{lead.title}</b>
              <small className="gm-sub">
                {lead.sourceName}
                {count > 1 ? ` · ${num(count)} سەرچاوە` : ""} · {ago(lead.publishedAt.toISOString())}
                {lead.lang && LANG_LABEL[lead.lang] ? ` · ${LANG_LABEL[lead.lang]}` : ""}
              </small>
            </Link>
          ))}
        </div>
      )}

      <p className="gm-hint">
        ئامادەکراوی ئەم مانگە: {num(drafts)} / {num(limit)} · هەندێک هەواڵ لە ڕێگەی{" "}
        <a href="https://www.gdeltproject.org/" className="gm-link" target="_blank" rel="noreferrer">GDELT Project</a>ەوە دێن.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/news/page.tsx src/app/app/news/refresh-button.tsx
git commit -m "Add the news desk story list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The draft editor (`/app/news/[id]`)

**Files:**
- Create: `src/app/app/news/[id]/page.tsx`, `src/app/app/news/[id]/editor.tsx`

- [ ] **Step 1: Write `src/app/app/news/[id]/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { brandFrom } from "@/lib/cards/brand";
import { currentWorkspace } from "../../data";
import { NewsEditor } from "./editor";
import type { DraftView } from "../actions";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";

export const maxDuration = 60;

export default async function NewsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = (await currentWorkspace())!;
  if (ws.kind !== "NEWS") redirect("/app");
  const { id } = await params;
  const [item, kit] = await Promise.all([
    db.newsItem.findFirst({ where: { id, tenantId: ws.id }, include: { draft: true } }),
    db.brandKit.findUnique({ where: { tenantId: ws.id } }),
  ]);
  if (!item) notFound();
  const d = item.draft;
  const initial: DraftView | null = d
    ? {
        draftId: d.id,
        headline: d.headline,
        body: d.body,
        category: d.category,
        cardKind: (CARD_KINDS.includes(d.cardKind as CardKind) ? d.cardKind : "STANDARD") as CardKind,
        stat: d.stat,
        quote: d.quote,
        speaker: d.speaker,
        photoPath: d.photoPath,
        model: d.model,
      }
    : null;
  return (
    <NewsEditor
      workspaceId={ws.id}
      source={{
        itemId: item.id,
        sourceName: item.sourceName,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        publishedAt: item.publishedAt.toISOString(),
      }}
      initial={initial}
      brand={brandFrom(kit, ws.name)}
    />
  );
}
```

- [ ] **Step 2: Write `src/app/app/news/[id]/editor.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { ExternalLink, ImagePlus, Sparkles, Trash2 } from "lucide-react";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { renderCardPng } from "@/lib/cards/render";
import { mediaSrc, type Brand } from "@/lib/cards/brand";
import { checkDraft } from "@/lib/news/rules";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { attachCardAction, dismissNewsAction, draftNewsAction, saveNewsDraftAction, type DraftView } from "../actions";
import { ago } from "../../format";

const KIND_LABEL: Record<CardKind, string> = { STANDARD: "ئاسایی", BREAKING: "بەپەلە", STAT: "ژمارە", QUOTE: "وتە" };
const PREVIEW_W = 320;
const SCALE = PREVIEW_W / CARD_W;

interface Source {
  itemId: string;
  sourceName: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
}

const stampOf = (iso: string) =>
  new Intl.DateTimeFormat("ar-IQ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(iso));

const blank = (): DraftView => ({
  draftId: "",
  headline: "",
  body: "",
  category: "گشتی",
  cardKind: "STANDARD",
  stat: null,
  quote: null,
  speaker: null,
  photoPath: null,
  model: "manual",
});

export function NewsEditor({ workspaceId, source, initial, brand }: { workspaceId: string; source: Source; initial: DraftView | null; brand: Brand }) {
  const router = useRouter();
  const [d, setD] = useState<DraftView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [overflow, setOverflow] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function redraft(strength: "fast" | "strong") {
    setError(null);
    start(async () => {
      setStage(strength === "strong" ? "باشتر دەنووسرێتەوە… (تا ١٠ چرکە)" : "ئامادە دەکرێت…");
      const r = await draftNewsAction(source.itemId, strength);
      setStage(null);
      if (r.ok) setD(r.draft);
      else {
        setError(r.error);
        setD((cur) => cur ?? blank());
      }
    });
  }

  // First visit: draft straight away.
  useEffect(() => {
    if (!initial) redraft("fast");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problems = useMemo(() => (d ? checkDraft(d, source) : []), [d, source]);

  useEffect(() => {
    const t = setTimeout(() => setOverflow(!!cardRef.current?.querySelector('[data-overflow="1"]')), 60);
    return () => clearTimeout(t);
  }, [d]);

  const patch = (p: Partial<DraftView>) => setD((cur) => ({ ...(cur ?? blank()), ...p }));

  async function pickPhoto(file: File) {
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("تەنها وێنەی JPG/PNG/WEBP.");
      return;
    }
    setPhotoProgress(0);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const blob = await upload(`merchant/${workspaceId}/news-photo-${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setPhotoProgress(Math.round(percentage)),
      });
      patch({ photoPath: blob.pathname });
    } catch (e) {
      setError(`بارکردن سەرکەوتوو نەبوو: ${e instanceof Error ? e.message : "هەڵە"}`);
    } finally {
      setPhotoProgress(null);
    }
  }

  function prepare() {
    if (!d || problems.length || overflow) return;
    setError(null);
    start(async () => {
      try {
        setStage("پاشەکەوت دەکرێت…");
        const saved = await saveNewsDraftAction(source.itemId, {
          headline: d.headline,
          body: d.body,
          cardKind: d.cardKind,
          stat: d.stat,
          quote: d.quote,
          speaker: d.speaker,
          photoPath: d.photoPath,
        });
        if (!saved.ok) throw new Error(saved.error);
        setStage("کارت دروست دەکرێت…");
        const png = await renderCardPng(cardRef.current!);
        setStage("کارت بار دەکرێت…");
        const blob = await upload(`merchant/${workspaceId}/news-card-${Date.now()}.png`, png, {
          access: "public",
          handleUploadUrl: "/api/app/upload",
          contentType: "image/png",
        });
        const r = await attachCardAction(source.itemId, { url: blob.url, pathname: blob.pathname });
        if (!r.ok) throw new Error(r.error);
        router.push(`/app/publish?draft=${r.draftId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "هەڵە");
        setStage(null);
      }
    });
  }

  function dismiss() {
    start(async () => {
      await dismissNewsAction(source.itemId);
      router.push("/app/news");
    });
  }

  return (
    <div className="gm-stack">
      <p className="gm-sec">سەرچاوە</p>
      <div className="gm-card">
        <b dir="auto" style={{ display: "block", lineHeight: 1.7 }}>{source.title}</b>
        {source.snippet && <p dir="auto" className="gm-sub" style={{ margin: "6px 0 0" }}>{source.snippet}</p>}
        <small className="gm-sub">
          {source.sourceName} · {ago(source.publishedAt)} ·{" "}
          <a href={source.url} target="_blank" rel="noreferrer" className="gm-link">
            کردنەوە <ExternalLink size={12} aria-hidden="true" />
          </a>
        </small>
      </div>

      <div className="gm-between">
        <p className="gm-sec" style={{ margin: 0 }}>کورتەی کوردی</p>
        <div className="gm-row" style={{ gap: 6 }}>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => redraft("strong")}>
            <Sparkles size={14} aria-hidden="true" /> باشترکردن
          </button>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={dismiss}>
            <Trash2 size={14} aria-hidden="true" /> لابردن
          </button>
        </div>
      </div>

      {!d ? (
        <p className="gm-hint">{stage ?? "ئامادە دەکرێت…"}</p>
      ) : (
        <>
          <div className="gm-card gm-stack">
            <div className="gm-field">
              <label htmlFor="nd-head">سەردێڕ</label>
              <input id="nd-head" className="gm-input" value={d.headline} onChange={(e) => patch({ headline: e.target.value })} />
            </div>
            <div className="gm-field">
              <label htmlFor="nd-body">دەق</label>
              <textarea id="nd-body" className="gm-textarea" value={d.body} onChange={(e) => patch({ body: e.target.value })} />
            </div>
            <div className="gm-chips" role="group" aria-label="جۆری کارت">
              {CARD_KINDS.map((k) => (
                <button key={k} type="button" className="gm-chip" aria-pressed={d.cardKind === k} onClick={() => patch({ cardKind: k })}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {d.cardKind === "STAT" && (
              <div className="gm-field">
                <label htmlFor="nd-stat">ژمارە</label>
                <input id="nd-stat" className="gm-input" value={d.stat ?? ""} onChange={(e) => patch({ stat: e.target.value })} />
              </div>
            )}
            {d.cardKind === "QUOTE" && (
              <>
                <div className="gm-field">
                  <label htmlFor="nd-quote">وتە</label>
                  <textarea id="nd-quote" className="gm-textarea" value={d.quote ?? ""} onChange={(e) => patch({ quote: e.target.value })} />
                </div>
                <div className="gm-field">
                  <label htmlFor="nd-speaker">خاوەنی وتە</label>
                  <input id="nd-speaker" className="gm-input" value={d.speaker ?? ""} onChange={(e) => patch({ speaker: e.target.value })} />
                </div>
              </>
            )}
            {d.cardKind === "STANDARD" && (
              <div className="gm-row">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} />
                <button type="button" className="gm-btn quiet small" onClick={() => fileInput.current?.click()} disabled={busy || photoProgress !== null}>
                  <ImagePlus size={14} aria-hidden="true" /> {d.photoPath ? "گۆڕینی وێنە" : "وێنەی خۆت"}
                </button>
                {photoProgress !== null && <small className="gm-hint">{photoProgress}٪</small>}
                <small className="gm-hint">تەنها وێنەی خۆتان — هیچ وێنەیەک لە سەرچاوەکان وەرناگیرێت.</small>
              </div>
            )}
          </div>

          {problems.map((p) => (
            <p key={p.code} className="gm-err" role="alert" style={{ margin: 0 }}>{p.message}</p>
          ))}
          {overflow && <p className="gm-err" style={{ margin: 0 }}>دەقەکە بۆ کارتەکە درێژە. کورتی بکەرەوە.</p>}

          <p className="gm-sec">کارت</p>
          <div dir="ltr" style={{ width: PREVIEW_W, height: CARD_H * SCALE, overflow: "hidden", borderRadius: 12, margin: "0 auto" }}>
            <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
              <NewsCard
                ref={cardRef}
                kind={d.cardKind}
                brand={brand}
                content={{
                  headline: d.headline,
                  stat: d.stat,
                  quote: d.quote,
                  speaker: d.speaker,
                  sourceName: source.sourceName,
                  stamp: stampOf(source.publishedAt),
                  photoSrc: mediaSrc(d.photoPath),
                }}
              />
            </div>
          </div>

          {error && <p className="gm-err" role="alert">{error}</p>}
          <button type="button" className="gm-btn block" disabled={busy || !!problems.length || overflow} onClick={prepare}>
            {stage ?? "ئامادەکردن بۆ بڵاوکردنەوە"}
          </button>
          <p className="gm-hint">دوای ئەمە پەڕەی بڵاوکردنەوە دەکرێتەوە: شوێنەکان هەڵدەبژێریت و پەسەندی دەکەیت. هیچ شتێک بێ کلیکی تۆ بڵاو نابێتەوە.</p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/app/news/[id]"
git commit -m "Add the news draft editor with the source beside the draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: News settings (keywords, sources, brand kit, kind)

**Files:**
- Create: `src/app/app/settings/news-settings.tsx`
- Modify: `src/app/app/settings/page.tsx`, `src/app/app/settings/settings-client.tsx`

- [ ] **Step 1: Write `src/app/app/settings/news-settings.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom } from "@/lib/cards/brand";
import type { CatalogId } from "@/lib/news/catalog";
import {
  addRssSourceAction,
  removeSourceAction,
  saveBrandKitAction,
  saveKeywordsAction,
  toggleCatalogSourceAction,
} from "../news/actions";

export interface NewsSettingsProps {
  workspaceId: string;
  pageName: string;
  keywords: string[];
  catalog: Array<{ id: CatalogId; name: string; description: string; enabled: boolean; lastError: string | null }>;
  feeds: Array<{ id: string; name: string; url: string; lastError: string | null }>;
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: "kufi" | "sans" };
}

const PREVIEW_W = 180;

export function NewsSettings(p: NewsSettingsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywords, setKeywords] = useState(p.keywords.join("، "));
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const [kit, setKit] = useState(p.kit);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "هەڵە" });
      if (r.ok) router.refresh();
    });

  async function pickLogo(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setMsg({ ok: false, text: "تەنها PNG/JPG/WEBP." });
    const blob = await upload(`merchant/${p.workspaceId}/logo-${Date.now()}.${file.type.split("/")[1]}`, file, {
      access: "public",
      handleUploadUrl: "/api/app/upload",
      contentType: file.type,
    });
    setKit((k) => ({ ...k, logoPath: blob.pathname }));
  }

  return (
    <>
      <p className="gm-sec">وشە سەرەکییەکان</p>
      <div className="gm-card gm-stack">
        <textarea className="gm-textarea" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="هەولێر، Erbil، أربيل، ئابووری" />
        <p className="gm-hint" style={{ margin: 0 }}>بە کۆما جیایان بکەرەوە. بە چەند زمانێک بنووسە تا هەواڵی زیاتر بدۆزرێتەوە.</p>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveKeywordsAction(keywords), "پاشەکەوت کرا.")}>پاشەکەوت</button>
      </div>

      <p className="gm-sec">سەرچاوەکان</p>
      <div className="gm-card">
        {p.catalog.map((c) => (
          <div key={c.id} className="gm-target">
            <div>
              <p>{c.name}</p>
              <small>{c.lastError ? `هەڵە: ${c.lastError}` : c.description}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={c.enabled}
              className="gm-knob"
              disabled={pending}
              onClick={() => run(() => toggleCatalogSourceAction(c.id, !c.enabled), "گۆڕدرا.")}
            />
          </div>
        ))}
        {p.feeds.map((f) => (
          <div key={f.id} className="gm-target">
            <div>
              <p>{f.name}</p>
              <small className="gm-ltr" dir="ltr">{f.lastError ? `error: ${f.lastError}` : f.url}</small>
            </div>
            <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => removeSourceAction(f.id), "لابرا.")}>لابردن</button>
          </div>
        ))}
      </div>
      <div className="gm-card gm-stack">
        <input className="gm-input" value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="ناوی سەرچاوە" />
        <input className="gm-input gm-ltr" dir="ltr" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://…/rss.xml" />
        <p className="gm-hint" style={{ margin: 0 }}>تەنها ئەو RSSـانە زیاد بکە کە مافی بەکارهێنانیانت هەیە. گیتواس هەرگیز دەق یان وێنەی سەرچاوەکە بڵاو ناکاتەوە.</p>
        <button
          type="button"
          className="gm-btn quiet"
          disabled={pending || !feedUrl.trim() || !feedName.trim()}
          onClick={() => run(async () => {
            const r = await addRssSourceAction(feedUrl, feedName);
            if (r.ok) { setFeedUrl(""); setFeedName(""); }
            return r;
          }, "زیاد کرا.")}
        >
          زیادکردنی RSS
        </button>
      </div>

      <p className="gm-sec">براند</p>
      <div className="gm-card gm-stack">
        <div className="gm-row" style={{ gap: 12, flexWrap: "wrap" }}>
          {(["primary", "accent", "text"] as const).map((key) => (
            <label key={key} className="gm-row" style={{ gap: 6 }}>
              <input type="color" value={kit[key]} onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value }))} />
              <small>{key === "primary" ? "ڕەنگی سەرەکی" : key === "accent" ? "ڕەنگی دووەم" : "ڕەنگی نووسین"}</small>
            </label>
          ))}
        </div>
        <div className="gm-chips">
          {(["kufi", "sans"] as const).map((f) => (
            <button key={f} type="button" className="gm-chip" aria-pressed={kit.headingFont === f} onClick={() => setKit((k) => ({ ...k, headingFont: f }))}>
              {f === "kufi" ? "کوفی" : "ئاسایی"}
            </button>
          ))}
        </div>
        <label className="gm-btn quiet small" style={{ alignSelf: "flex-start" }}>
          {kit.logoPath ? "گۆڕینی لۆگۆ" : "لۆگۆ"}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])} />
        </label>
        <div dir="ltr" style={{ width: PREVIEW_W, height: (CARD_H * PREVIEW_W) / CARD_W, overflow: "hidden", borderRadius: 10 }}>
          <div style={{ transform: `scale(${PREVIEW_W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
            <NewsCard
              kind="BREAKING"
              brand={brandFrom(kit, p.pageName)}
              content={{ headline: "نموونەی سەردێڕێکی هەواڵ لەسەر کارتەکەت", stat: null, quote: null, speaker: null, sourceName: "سەرچاوە", stamp: "١٠:٤٢", photoSrc: null }}
            />
          </div>
        </div>
        <button type="button" className="gm-btn" disabled={pending} onClick={() => run(() => saveBrandKitAction(kit), "براند پاشەکەوت کرا.")}>پاشەکەوتی براند</button>
      </div>
      {msg && <p className={msg.ok ? "gm-ok" : "gm-err"}>{msg.text}</p>}
    </>
  );
}
```

- [ ] **Step 2: Load the news settings in `src/app/app/settings/page.tsx`**

Add imports:

```ts
import { catalogAvailable } from "@/lib/news/catalog";
import type { NewsSettingsProps } from "./news-settings";
```

After the `Promise.all` that loads `conns` and `me`, add:

```ts
  let news: NewsSettingsProps | null = null;
  if (ws.kind === "NEWS") {
    const [settings, sources, kit] = await Promise.all([
      db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
      db.newsSource.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" } }),
      db.brandKit.findUnique({ where: { tenantId: ws.id } }),
    ]);
    news = {
      workspaceId: ws.id,
      pageName: ws.name,
      keywords: settings?.keywords ?? [],
      catalog: catalogAvailable().map((c) => {
        const s = sources.find((x) => x.catalogId === c.id);
        return { id: c.id, name: c.name, description: c.description, enabled: !!s?.enabled, lastError: s?.lastError ?? null };
      }),
      feeds: sources.filter((s) => s.rssUrl).map((s) => ({ id: s.id, name: s.name, url: s.rssUrl!, lastError: s.lastError })),
      kit: {
        logoPath: kit?.logoPath ?? null,
        primary: kit?.primary ?? "#0B2545",
        accent: kit?.accent ?? "#E0A526",
        text: kit?.text ?? "#FFFFFF",
        headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
      },
    };
  }
```

and pass two new props to `<SettingsClient ...>`: `kind={ws.kind}` and `news={news}`.

- [ ] **Step 3: Render them in `src/app/app/settings/settings-client.tsx`**

Add imports:

```ts
import { NewsSettings, type NewsSettingsProps } from "./news-settings";
import { setTenantKindAction } from "../actions";
```

Add to the props destructuring `kind, news,` and to the props type:

```ts
  kind: "MERCHANT" | "NEWS";
  news: NewsSettingsProps | null;
```

Directly before `<p className="gm-sec">ئەکاونتەکان</p>`, insert:

```tsx
      {news && <NewsSettings {...news} />}
```

Directly before `<p className="gm-sec">هەژمار</p>`, insert:

```tsx
      <p className="gm-sec">جۆری هەژمار</p>
      <div className="gm-card gm-row" style={{ justifyContent: "space-between" }}>
        <span>{kind === "NEWS" ? "پەیجی هەواڵ" : "دووکان"}</span>
        <button
          type="button"
          className="gm-btn quiet small"
          onClick={async () => {
            const r = await setTenantKindAction(kind === "NEWS" ? "MERCHANT" : "NEWS");
            if (r.ok) window.location.href = kind === "NEWS" ? "/app" : "/app/news";
          }}
        >
          {kind === "NEWS" ? "بیکە بە دووکان" : "بیکە بە پەیجی هەواڵ"}
        </button>
      </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/settings
git commit -m "Add keywords, sources, brand kit and the kind switch to Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Publish from a draft, and TikTok photo posts

**Files:**
- Create: `src/lib/news/publish-record.ts`
- Modify: `src/lib/publishers/tiktok.ts` (add `publishPhotoToTikTok`)
- Modify: `src/app/app/actions.ts` (`PublishInput`, `publishAction`)
- Modify: `src/app/app/publish/page.tsx`, `src/app/app/publish/publish-client.tsx`

- [ ] **Step 1: Write `src/lib/news/publish-record.ts`**

```ts
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { countUsage } from "@/lib/billing/limits";

/** Store each platform's result on the draft; the first success marks the story published. */
export async function recordNewsPublish(
  tenantId: string,
  draftId: string,
  results: Array<{ target: string; ok: boolean; url?: string; publishId?: string; error?: string }>,
): Promise<void> {
  const draft = await db.newsDraft.findFirst({ where: { id: draftId, tenantId }, select: { id: true, itemId: true, publishedAt: true } });
  if (!draft) return;
  const anyOk = results.some((r) => r.ok);
  await db.newsDraft.update({
    where: { id: draft.id },
    data: { results: results as unknown as Prisma.InputJsonValue, ...(anyOk && !draft.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  if (anyOk) {
    await db.newsItem.update({ where: { id: draft.itemId }, data: { status: "PUBLISHED" } });
    await countUsage(tenantId, "publish");
  }
}
```

- [ ] **Step 2: Add `publishPhotoToTikTok` to `src/lib/publishers/tiktok.ts`**

Append after `publishToTikTok`:

```ts
/**
 * Direct Post of one photo, pulled from our verified domain. Same scope
 * (video.publish) and the same creator_info checks as a video; duet and
 * stitch do not exist for photos. The caption's first line is the title
 * (TikTok allows 90 characters); the whole caption is the description.
 */
export async function publishPhotoToTikTok(
  tenantId: string,
  content: { caption: string; imageUrl: string },
  options: Pick<TikTokPostOptions, "privacyLevel" | "disableComment" | "brandOrganicToggle" | "brandContentToggle">,
): Promise<PublishResult> {
  const token = await tiktokToken(tenantId);
  if (!token) return { ok: false, error: "TikTok not connected (or token expired)" };
  if (!/^https:\/\//i.test(content.imageUrl)) {
    return { ok: false, error: "TikTok needs an https image URL hosted on a verified domain" };
  }
  const info = await queryCreatorInfo(token);
  if ("error" in info) return { ok: false, error: info.error };
  if (!info.privacy_level_options?.includes(options.privacyLevel)) {
    return { ok: false, error: `"${options.privacyLevel}" is not a privacy level this account may use right now — reopen the post screen.` };
  }
  if (info.comment_disabled && !options.disableComment) {
    return { ok: false, error: "This creator has comments turned off in TikTok." };
  }
  if (options.brandContentToggle && options.privacyLevel === "SELF_ONLY") {
    return { ok: false, error: "Branded content cannot be posted with visibility set to Only me." };
  }
  const caption = content.caption.trim();
  if (!caption) return { ok: false, error: "Add a caption before posting." };

  const r = await fetch(`${BASE}/post/publish/content/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: [...caption.split("\n")[0]].slice(0, 90).join(""),
        description: caption.slice(0, 4000),
        privacy_level: options.privacyLevel,
        disable_comment: options.disableComment,
        brand_content_toggle: options.brandContentToggle,
        brand_organic_toggle: options.brandOrganicToggle,
      },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [content.imageUrl] },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    }),
  });
  const j = await r.json();
  if (!r.ok || j?.error?.code !== "ok") return { ok: false, error: explainInitError(r.status, j?.error) };
  return { ok: true, externalId: j?.data?.publish_id };
}
```

- [ ] **Step 3: Teach `publishAction` about drafts and photos**

In `src/app/app/actions.ts`:

(a) Add imports:

```ts
import { fetchTikTokPostStatus, getTikTokPostContext, publishPhotoToTikTok, publishToTikTok } from "@/lib/publishers/tiktok";
import { assertWithin, LimitReached, limitMessage } from "@/lib/billing/limits";
import { recordNewsPublish } from "@/lib/news/publish-record";
```

(replace the existing `import { fetchTikTokPostStatus, getTikTokPostContext, publishToTikTok } from "@/lib/publishers/tiktok";` line with the first one).

(b) In `interface PublishInput`, add after `media?: …;`:

```ts
  /** Set when the post comes from the news desk; its result is recorded on the draft. */
  newsDraftId?: string;
```

(c) Delete this line from `publishAction`:

```ts
  if (targets.includes("TT") && input.media?.type !== "VIDEO") return { ok: false, error: "تیکتۆک تەنیا ڤیدیۆ وەردەگرێت." };
```

(d) Directly after `if (!targets.length) return { ok: false, error: "لانیکەم یەک شوێن هەڵبژێرە." };`, add:

```ts
  if (input.newsDraftId) {
    try {
      await assertWithin(ws.id, "publish");
    } catch (e) {
      if (e instanceof LimitReached) return { ok: false, error: limitMessage(e) };
      throw e;
    }
  }
```

(e) Replace the TikTok call that starts with `    const r = await publishToTikTok(` and ends with its closing `    );` by:

```ts
    const mediaUrl = `${APP_ORIGIN}/m/${input.media!.pathname}`;
    if (input.media!.type === "IMAGE") {
      const r = await publishPhotoToTikTok(
        ws.id,
        { caption, imageUrl: mediaUrl },
        {
          privacyLevel: tt.privacy!,
          disableComment: !tt.allowComment,
          brandOrganicToggle: tt.commercial && tt.yourBrand,
          brandContentToggle: tt.commercial && tt.branded,
        },
      );
      return { target, ok: r.ok, publishId: r.externalId, error: r.error };
    }
    const r = await publishToTikTok(
      ws.id,
      { title: caption, videoUrl: mediaUrl, durationSec: input.media!.durationSec },
      {
        privacyLevel: tt.privacy!,
        disableComment: !tt.allowComment,
        disableDuet: !tt.allowDuet,
        disableStitch: !tt.allowStitch,
        brandOrganicToggle: tt.commercial && tt.yourBrand,
        brandContentToggle: tt.commercial && tt.branded,
      },
    );
```

(f) Directly before the final `return { ok: true, results };` of `publishAction`, add:

```ts
  if (input.newsDraftId) await recordNewsPublish(ws.id, input.newsDraftId, results);
```

- [ ] **Step 4: Prefill the publish screen from a draft**

Replace `src/app/app/publish/page.tsx` with:

```tsx
import { db } from "@/lib/db";
import { captionFor } from "@/lib/news/rules";
import { currentWorkspace, loadConnections } from "../data";
import { PublishClient } from "./publish-client";

// Instagram video containers are polled for up to ~45 s before publishing.
export const maxDuration = 60;

export default async function PublishPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const ws = (await currentWorkspace())!;
  const { draft: draftId } = await searchParams;
  const [conns, draft] = await Promise.all([
    loadConnections(ws.id),
    draftId ? db.newsDraft.findFirst({ where: { id: draftId, tenantId: ws.id }, include: { item: true } }) : null,
  ]);
  const initial =
    draft?.cardUrl && draft.cardPath
      ? {
          newsDraftId: draft.id,
          caption: captionFor(draft, { name: draft.item.sourceName, url: draft.item.url }),
          media: { url: draft.cardUrl, pathname: draft.cardPath, type: "IMAGE" as const },
        }
      : undefined;
  return (
    <PublishClient
      workspaceId={ws.id}
      initial={initial}
      accounts={{
        FB: conns.META_FACEBOOK.connected ? (conns.META_FACEBOOK.name ?? "پەیجی فەیسبووک") : null,
        IG: conns.META_INSTAGRAM.connected ? (conns.META_INSTAGRAM.name ?? "ئینستاگرام") : null,
        TT: conns.TIKTOK.connected ? (conns.TIKTOK.name ?? "تیکتۆک") : null,
      }}
    />
  );
}
```

In `src/app/app/publish/publish-client.tsx`:

(a) Change the component signature to:

```tsx
export function PublishClient({
  workspaceId,
  accounts,
  initial,
}: {
  workspaceId: string;
  accounts: Record<Target, string | null>;
  initial?: { newsDraftId: string; caption: string; media: Media };
}) {
```

(b) Replace the three state lines

```tsx
  const [preview, setPreview] = useState<{ src: string; type: "IMAGE" | "VIDEO" } | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
```

with

```tsx
  const [preview, setPreview] = useState<{ src: string; type: "IMAGE" | "VIDEO" } | null>(
    initial ? { src: initial.media.url, type: "IMAGE" } : null,
  );
  const [media, setMedia] = useState<Media | null>(initial?.media ?? null);
```

and `const [caption, setCaption] = useState("");` with `const [caption, setCaption] = useState(initial?.caption ?? "");`, and `const [on, setOn] = useState<Record<Target, boolean>>({ FB: !!accounts.FB, IG: false, TT: false });` with `const [on, setOn] = useState<Record<Target, boolean>>({ FB: !!accounts.FB, IG: !!initial && !!accounts.IG, TT: false });`.

(c) TikTok now takes photos. Replace

```tsx
    setOn((o) => ({ ...o, IG: o.IG && !!media, TT: o.TT && !!media && isVideo }));
```

with

```tsx
    setOn((o) => ({ ...o, IG: o.IG && !!media, TT: o.TT && !!media }));
```

replace `setOn((o) => ({ ...o, IG: !!accounts.IG, TT: type === "VIDEO" && !!accounts.TT }));` with `setOn((o) => ({ ...o, IG: !!accounts.IG, TT: !!accounts.TT }));`, delete the line `const needsVideo = t === "TT" && !!media && !isVideo;`, change `const disabled = !account || needsMedia || needsVideo;` to `const disabled = !account || needsMedia;`, and replace

```tsx
                  ) : needsVideo ? (
                    "تیکتۆک تەنیا ڤیدیۆ وەردەگرێت"
                  ) : (
```

with

```tsx
                  ) : (
```

(d) Duet and Stitch only for video. Replace

```tsx
                ] as const
              ).map(
```

with

```tsx
                ] as const
              )
                // Duet and Stitch exist only for videos; a photo post offers comments alone.
                .filter(([label]) => isVideo || label === "کۆمێنت")
                .map(
```

(e) Pass the draft id when publishing. Directly after the line
`        tiktok: on.TT ? { privacy, allowComment, allowDuet, allowStitch, commercial, yourBrand, branded } : undefined,`
add
`        newsDraftId: initial?.newsDraftId,`

- [ ] **Step 5: Type-check and run all tests**

Run: `npx tsc --noEmit -p tsconfig.json` then `npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/news/publish-record.ts src/lib/publishers/tiktok.ts src/app/app/actions.ts src/app/app/publish
git commit -m "Publish news cards through the publish screen, and post photos to TikTok

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Terms and privacy

**Files:**
- Modify: `src/app/(legal)/terms/page.tsx`, `src/app/(legal)/privacy/page.tsx`

- [ ] **Step 1: Terms — add the news responsibilities to section 6**

In `src/app/(legal)/terms/page.tsx`, replace `<Updated date="June 8, 2026" />` with `<Updated date="September 26, 2026" />`, and directly after the closing `</P>` of section `6. AI-generated output`, add:

```tsx
      <P>
        <Strong>News pages.</Strong> For news pages, Gituas reads headlines and short summaries from
        news sources, drafts an original summary in Kurdish, and always credits the source with a
        link. Gituas never publishes a source&rsquo;s article text, photos, or video. You are
        responsible for everything your page publishes, for any feed you add yourself and your
        right to use it, for any media licence your page needs, and for reviewing every draft
        before approving it. Nothing is published without your approval. Some headlines are
        provided by the <ExtLink href="https://www.gdeltproject.org/">GDELT Project</ExtLink>.
      </P>
```

- [ ] **Step 2: Privacy — name DeepSeek as an AI processor**

In `src/app/(legal)/privacy/page.tsx`, replace

```tsx
        <LI><Strong>AI processing</Strong> — Google (Gemini) to generate marketing content.</LI>
```

with

```tsx
        <LI>
          <Strong>AI processing</Strong> — Google (Gemini) and DeepSeek to generate and summarise
          content. What we send them is the content being drafted; for news pages, that is a public
          headline and summary of a news story.
        </LI>
```

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: `✓ Compiled successfully` and the routes `/app/news` and `/app/news/[id]` in the route list. Then `git checkout -- package-lock.json` if it changed.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(legal)/terms/page.tsx" "src/app/(legal)/privacy/page.tsx"
git commit -m "State the news page responsibilities and DeepSeek in the legal pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: End-to-end check against the database, deploy, record

**Files:**
- Create (outside the repo, in your scratchpad directory): `news-e2e.mts`
- Modify: `TODOS.md`

- [ ] **Step 1: Write `news-e2e.mts` in the scratchpad directory**

```ts
// Ingest → draft → rules → usage against the real database, with a throwaway
// news tenant. Cleans up everything it creates.
const R = "file:///C:/Users/Zorin/Desktop/gituas/src";
const { db } = await import(`${R}/lib/db.ts`);
const { ingest } = await import(`${R}/lib/news/ingest.ts`);
const { draftFor } = await import(`${R}/lib/news/draft.ts`);
const { checkDraft, captionFor } = await import(`${R}/lib/news/rules.ts`);
const { assertWithin, countUsage, usageOf } = await import(`${R}/lib/billing/limits.ts`);

const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => results.push([n, ok, d]);
const tenant = await db.tenant.create({
  data: { name: "e2e news", slug: `e2e-news-${Date.now()}`, ownerId: "e2e-owner", kind: "NEWS", kindChosen: true },
});

try {
  await db.newsSettings.create({ data: { tenantId: tenant.id, keywords: [] } });
  await db.newsSource.create({ data: { tenantId: tenant.id, rssUrl: "https://feeds.bbci.co.uk/arabic/rss.xml", name: "BBC عربي" } });

  const first = await ingest(tenant.id);
  check("ingest stores items", first.added > 0 && !first.skipped, JSON.stringify(first));
  const again = await ingest(tenant.id);
  check("a second ingest inside five minutes is skipped", again.skipped);

  const item = await db.newsItem.findFirst({ where: { tenantId: tenant.id }, orderBy: { publishedAt: "desc" } });
  check("items keep a cluster key and a language", !!item?.clusterKey && item.lang === "ar", JSON.stringify(item));

  const { draft, model } = await draftFor(item!, "fast");
  check("DeepSeek drafts in Sorani", /[ەێۆڕڵ]/.test(draft.headline + draft.body), `${model}: ${draft.headline}`);
  check("the draft of an Arabic story passes the rules", checkDraft(draft, item!).length === 0, JSON.stringify(checkDraft(draft, item!)));
  check("the caption ends with the source link", captionFor(draft, { name: item!.sourceName, url: item!.url }).endsWith(item!.url));

  await assertWithin(tenant.id, "draft");
  await countUsage(tenant.id, "draft");
  await countUsage(tenant.id, "draft");
  check("usage counts per month", (await usageOf(tenant.id, "draft")) === 2);
} finally {
  await db.newsDraft.deleteMany({ where: { tenantId: tenant.id } });
  await db.newsItem.deleteMany({ where: { tenantId: tenant.id } });
  await db.newsSource.deleteMany({ where: { tenantId: tenant.id } });
  await db.newsSettings.deleteMany({ where: { tenantId: tenant.id } });
  await db.usage.deleteMany({ where: { tenantId: tenant.id } });
  await db.tenant.delete({ where: { id: tenant.id } });
  for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  " + d}`);
  await db.$disconnect();
}
```

(The `SourceCache` row for the BBC feed is shared and harmless; it expires after five minutes.)

- [ ] **Step 2: Run it**

Run (from the repo root): `npx tsx --env-file=.env --env-file=.env.local --tsconfig tsconfig.json <scratchpad>/news-e2e.mts`
Expected: every line `PASS`.

- [ ] **Step 3: Full tests and build**

Run: `npx vitest run` then `npx next build`
Expected: all tests pass; build succeeds. `git checkout -- package-lock.json` if the build rewrote it.

- [ ] **Step 4: Record in `TODOS.md`**

Under `## In flight — check, don't redo`, add:

```markdown
- **News desk phase 1 — built 2026-09-XX** (plan `docs/superpowers/plans/2026-09-26-news-desk-phase1.md`).
  Pages choose shop or news once on `/app`; news pages get `/app/news` (list, editor), keywords,
  sources (GDELT, NewsData when `NEWSDATA_API_KEY` is set, their own RSS) and a brand kit in
  Settings. Cards render in the browser and go out through `/app/publish?draft=<id>`; TikTok now
  takes photo posts there too. `DEEPSEEK_API_KEY` must be set in Vercel for drafts (Gemini is the
  fallback). Open: outlet RSS feeds join the catalog only after each outlet's terms are read
  (BBC's terms page could not be fetched while planning); the COPY rule's 0.5 threshold needs
  tuning on real Kurdish-source drafts; the first TikTok photo post should be tried by the owner
  as "Only me". Phases 2–4 (page frames, page video, motion video) follow the same spec.
```

(Replace `2026-09-XX` with the day this task runs.)

- [ ] **Step 5: Commit and push**

```bash
git add TODOS.md
git commit -m "Record that news desk phase 1 is built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

- [ ] **Step 6: Production checks after the deploy**

1. The owner adds `DEEPSEEK_API_KEY` in Vercel (Production) and redeploys — Claude never types the key.
2. `curl -s -o /dev/null -w '%{http_code}' https://gituas.vercel.app/app/news` → `307` (redirect to sign-in), proving the route exists.
3. The owner, signed in, chooses "پەیجی هەواڵ" on a test workspace, adds keywords, opens a story, prepares a card, and publishes to Facebook only; then tries TikTok with "Only me".
```
