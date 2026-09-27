# Newsroom 1A — Sign-in polish, shell, guide · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the newsroom (`/newsroom`) its own identity and frame, made for a channel's team on a desktop and on a phone. That means clean newsroom sign-in, a public Kurdish guide, a first-run checklist, and a refreshed landing page.

**Architecture:** The newsroom reuses the shop's `.gm` design system (`src/app/app/app.css`). A second class, `.nr`, re-tokens the palette into a "control room" look and adds the frame: a sidebar on desktop and a bottom bar with a "more" sheet on phones. Nav, guide and checklist are plain data and functions in `src/lib/newsroom/`, tested with vitest. Later parts (1B–1D) add entries to these instead of rewriting components.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, lucide-react, next-auth 5, Prisma 7, vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-newsroom-big-media-phase1-design.md`, section 1A.

**Branch:** `newsroom-1a`, cut from `newsroom-big-media`.

**Deviation from spec:** the landing page describes only what exists today. Copy about the team, own content and approval is added by parts 1B–1D, when those features ship, so a channel signing up now isn't promised features it can't use yet.

---

## Conventions for every task

- UI text is Sorani Kurdish, RTL. Wrappers carry `dir="rtl" lang="ckb"`.
- Kurdish digits come from `num()` in `src/app/app/format.ts`.
- Tests live in `tests/**/*.test.ts`. They run with `npx vitest run <file>` and use the `@/` alias for `src/`.
- Type check: `npx tsc --noEmit`, which should print nothing. There is no lint script, because `next lint` was removed in Next 16.
- Commit messages are plain sentences with no `feat:` prefix, and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print `.env` values.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/app/login/product.ts` | create | which product a `next` path belongs to; sign-in page title |
| `src/app/login/page.tsx` | modify | `generateMetadata`; `.nr` class for the newsroom |
| `src/app/login/merchant-login.tsx` | modify | hide GitHub in the newsroom |
| `src/app/signup/page.tsx`, `src/app/forgot/page.tsx` | modify | `.nr` class for the newsroom |
| `src/lib/newsroom/guide.ts` | create | guide sections (data) |
| `src/lib/newsroom/nav.ts` | create | nav items, groups, active-item matching |
| `src/lib/newsroom/checklist.ts` | create | first-run steps from desk state |
| `src/app/newsroom/newsroom.css` | create | `.nr` palette, frame, sheet, guide, checklist, landing |
| `src/app/newsroom/desk-shell.tsx` | create | `NewsroomRoot`, `DeskShell` (server) |
| `src/app/newsroom/desk-nav.tsx` | create | `SideNav`, `BottomNav`, `HelpLink` (client) |
| `src/app/app/nav.tsx` | modify | export `Pending` |
| `src/app/newsroom/(desk)/layout.tsx` | modify | use `DeskShell` / `NewsroomRoot` |
| `src/app/newsroom/guide/page.tsx`, `guide-article.tsx` | create | public guide; inside the shell when signed in |
| `src/app/newsroom/(desk)/news/checklist.tsx` | create | checklist card |
| `src/app/newsroom/(desk)/news/page.tsx` | modify | load state, show checklist |
| `src/app/newsroom/page.tsx` | modify | new landing page |
| `tests/newsroom/*.test.ts` | create | product, guide, nav, checklist tests |

---

### Task 1: Newsroom sign-in — title and no GitHub

**Files:**
- Create: `src/app/login/product.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/merchant-login.tsx`
- Test: `tests/newsroom/login-product.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/newsroom/login-product.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loginTitle, productFor } from "@/app/login/product";

describe("productFor", () => {
  it("maps newsroom paths to the newsroom", () => {
    expect(productFor("/newsroom")).toBe("newsroom");
    expect(productFor("/newsroom/news?tab=ready")).toBe("newsroom");
  });
  it("maps app paths to the shop", () => {
    expect(productFor("/app")).toBe("shop");
    expect(productFor("/app/publish")).toBe("shop");
  });
  it("maps anything else to the operator dashboard", () => {
    expect(productFor("/dashboard")).toBe("operator");
    expect(productFor("/")).toBe("operator");
  });
});

describe("loginTitle", () => {
  it("names the newsroom and the shop in Kurdish", () => {
    expect(loginTitle("newsroom")).toBe("چوونەژوورەوە — گیتواس نیوزڕووم");
    expect(loginTitle("shop")).toBe("چوونەژوورەوە — گیتواس");
  });
  it("leaves the operator title to the root layout", () => {
    expect(loginTitle("operator")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/newsroom/login-product.test.ts`
Expected: FAIL. The import doesn't resolve (`product.ts` does not exist).

- [ ] **Step 3: Implement**

`src/app/login/product.ts`:

```ts
/** Which product a post-login destination belongs to. Matches the prefixes the sign-in pages already use. */
export type Product = "newsroom" | "shop" | "operator";

export function productFor(next: string): Product {
  if (next.startsWith("/newsroom")) return "newsroom";
  if (next.startsWith("/app")) return "shop";
  return "operator";
}

/** The tab title for /login; undefined keeps the root layout's title (the operator's GitHub card). */
export function loginTitle(product: Product): string | undefined {
  if (product === "newsroom") return "چوونەژوورەوە — گیتواس نیوزڕووم";
  if (product === "shop") return "چوونەژوورەوە — گیتواس";
  return undefined;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/newsroom/login-product.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add `generateMetadata` to the login page and use `productFor`**

In `src/app/login/page.tsx`:

1. Add `import type { Metadata } from "next";` at the top.
2. Add `import { loginTitle, productFor } from "./product";` next to the other local imports.
3. Add this function above `export default async function LoginPage`:

```tsx
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; callbackUrl?: string | string[]; error?: string }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const callbackUrlPath = typeof sp.callbackUrl === "string" ? new URL(sp.callbackUrl, "https://x").pathname : undefined;
  const title = loginTitle(productFor(safeNext(sp.next ?? callbackUrlPath, sp.error ? "/app" : "/dashboard")));
  return title ? { title } : {};
}
```

4. In `LoginPage`, replace this block:

```tsx
  if (next.startsWith("/app") || next.startsWith("/newsroom")) {
```

with:

```tsx
  const product = productFor(next);
  if (product !== "operator") {
```

and replace the prop line

```tsx
          product={next.startsWith("/newsroom") ? "newsroom" : "shop"}
```

with

```tsx
          product={product}
```

- [ ] **Step 6: Hide GitHub in the newsroom**

In `src/app/login/merchant-login.tsx`:

1. Change the doc comment on `MerchantLogin` to:

```tsx
/** Sign-in for the merchant app or the newsroom: email and password, Google when configured; GitHub (the owner's own sign-in) only on the shop's page. */
```

2. Wrap the last `<p>` (the GitHub button) so it only renders for the shop:

```tsx
      {product !== "newsroom" && (
        <p style={{ textAlign: "center", marginTop: 4 }}>
          <button type="button" className="gm-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 500 }} onClick={() => signIn("github", { callbackUrl: next })}>
            بە GitHub بچۆ ژوورەوە
          </button>
        </p>
      )}
```

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/app/login/product.ts src/app/login/page.tsx src/app/login/merchant-login.tsx tests/newsroom/login-product.test.ts
git commit -m "Give the newsroom sign-in its own title and drop GitHub from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Guide content

**Files:**
- Create: `src/lib/newsroom/guide.ts`
- Test: `tests/newsroom/guide.test.ts`

The text describes only screens that exist today. The labels in quotes are the real button and section names in the app. Don't change them without checking the screen.

- [ ] **Step 1: Write the failing test**

`tests/newsroom/guide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GUIDE, GUIDE_IDS } from "@/lib/newsroom/guide";

describe("GUIDE", () => {
  it("has unique ids that match GUIDE_IDS in order", () => {
    expect(GUIDE.map((s) => s.id)).toEqual([...GUIDE_IDS]);
    expect(new Set(GUIDE_IDS).size).toBe(GUIDE_IDS.length);
  });
  it("gives every section a title, an intro, and steps or questions", () => {
    for (const s of GUIDE) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.intro.length).toBeGreaterThan(0);
      expect((s.steps?.length ?? 0) + (s.qa?.length ?? 0)).toBeGreaterThan(0);
    }
  });
  it("links only to same-site paths", () => {
    for (const s of GUIDE) if (s.link) expect(s.link.href.startsWith("/")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/newsroom/guide.test.ts`
Expected: FAIL. The import doesn't resolve.

- [ ] **Step 3: Implement**

`src/lib/newsroom/guide.ts`:

```ts
// The newsroom guide, in Sorani. Plain data so the guide page, the "?" links in
// the frame and later parts (team, own site, review, calendar) share one list.
// Quoted labels are the real names on screen — check the screen before editing.

export const GUIDE_IDS = ["start", "connect", "brand", "sources", "stories", "publish", "comments", "insights", "faq"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideSection {
  id: GuideId;
  title: string;
  intro: string;
  steps?: readonly string[];
  qa?: readonly { q: string; a: string }[];
  link?: { href: string; label: string };
}

export const GUIDE: readonly GuideSection[] = [
  {
    id: "start",
    title: "نیوزڕووم چییە؟",
    intro:
      "نیوزڕووم ژووری هەواڵی کەناڵەکەتە لەسەر سۆشیال میدیا: هەواڵ دەبینیت، بە زیرەکیی دەستکرد کورتەی کوردیی لێ ئامادە دەکرێت، دەیکەیت بە کارتی براندی خۆت و لە یەک شوێنەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک بڵاوی دەکەیتەوە.",
    steps: [
      "پەیجەکانت ببەستەوە.",
      "لۆگۆ و ڕەنگی کەناڵەکەت دابنێ.",
      "سەرچاوە و وشە سەرەکییەکان دیاری بکە.",
      "هەواڵێک بکەرەوە، کارتەکەی دروست بکە و بڵاوی بکەرەوە.",
    ],
  },
  {
    id: "connect",
    title: "پەیجەکانت ببەستەوە",
    intro: "بۆ بڵاوکردنەوە، کۆمێنت و ئامار، پەیجەکانی کەناڵەکەت بە گیتواسەوە ببەستەوە.",
    steps: [
      "بچۆ «ڕێکخستن» ← «ئەکاونتەکان».",
      "لە تەنیشت فەیسبووک، ئینستاگرام یان تیکتۆک «پەیوەست بکە» دابگرە.",
      "لە پەنجەرەی پلاتفۆرمەکەدا پەیجی کەناڵەکەت هەڵبژێرە و ڕێگە بدە.",
      "ئەگەر ئینستاگرام پەیوەست نەبوو، دڵنیابە ئەکاونتەکەت پرۆفیشناڵە (بزنس یان کرێیتەر).",
    ],
    link: { href: "/newsroom/settings", label: "بچۆ ڕێکخستن" },
  },
  {
    id: "brand",
    title: "براندی کەناڵەکەت",
    intro: "هەموو کارتێک بە لۆگۆ، ڕەنگ و فۆنتی کەناڵەکەت دروست دەبێت.",
    steps: [
      "لە «ڕێکخستن» ← «براند»، «لۆگۆ» بار بکە (PNG، JPG یان WEBP).",
      "«ڕەنگی سەرەکی»، «ڕەنگی دووەم» و «ڕەنگی نووسین» هەڵبژێرە.",
      "فۆنتی سەردێڕ هەڵبژێرە: «کوفی» یان «ئاسایی».",
      "«پاشەکەوتی براند» دابگرە. نموونەی کارتەکە هەر لەوێ دەبینیت.",
    ],
    link: { href: "/newsroom/settings", label: "براندەکەت دابنێ" },
  },
  {
    id: "sources",
    title: "سەرچاوە و وشە سەرەکییەکان",
    intro: "نیوزڕووم هەواڵ لەو سەرچاوانە دەهێنێت کە تۆ چالاکیان دەکەیت، بەپێی ئەو وشانەی دایان دەنێیت.",
    steps: [
      "لە «ڕێکخستن» ← «وشە سەرەکییەکان»، وشەکان بە کۆما جیا بکەرەوە، بە چەند زمانێک: هەولێر، Erbil، أربيل.",
      "«پاشەکەوت» دابگرە.",
      "لە «سەرچاوەکان» سەرچاوە ئامادەکان چالاک بکە.",
      "بۆ RSS، ناوی سەرچاوە و بەستەرەکەی بنووسە. تەنها ئەو RSSـانە زیاد بکە کە مافی بەکارهێنانیانت هەیە.",
    ],
    link: { href: "/newsroom/settings", label: "سەرچاوەکان ڕێک بخە" },
  },
  {
    id: "stories",
    title: "لە هەواڵەوە بۆ کارت",
    intro: "لە «هەواڵەکان»، هەواڵەکان لە سێ بەشدان: «نوێ»، «ئامادە» و «بڵاوکراوە».",
    steps: [
      "هەواڵێک بکەرەوە. کورتەی کوردی بە خۆکاری ئامادە دەکرێت (تا ٢٠ چرکە).",
      "«سەردێڕ» و «دەق» دەستکاری بکە.",
      "«جۆری کارت» هەڵبژێرە: «ئاسایی»، «بەپەلە»، «ژمارە» یان «وتە».",
      "بە «وێنەی خۆت» وێنەیەکی کەناڵەکەت دابنێ. هیچ وێنەیەک لە سەرچاوەکان وەرناگیرێت.",
      "ئەگەر دەقەکەت بەدڵ نەبوو، «باشترکردن» دابگرە. بۆ لابردنی هەواڵەکە «لابردن» دابگرە.",
      "«ئامادەکردن بۆ بڵاوکردنەوە» دابگرە.",
    ],
    link: { href: "/newsroom/news", label: "بچۆ هەواڵەکان" },
  },
  {
    id: "publish",
    title: "بڵاوکردنەوە",
    intro: "پەڕەی بڵاوکردنەوە بە کارت و دەقەکەوە دەکرێتەوە. هیچ شتێک بێ کلیکی تۆ بڵاو نابێتەوە.",
    steps: [
      "ئەو پەیج و ئەکاونتانە هەڵبژێرە کە دەتەوێت لەسەریان بڵاو بێتەوە.",
      "دەقی پۆستەکە بخوێنەرەوە و ئەگەر پێویست بوو دەستکاری بکە.",
      "بۆ تیکتۆک دیاری بکە کێ دەتوانێت ببینێت، و ڕازیبوونەکە پەسەند بکە.",
      "بڵاوکردنەوە دابگرە. ئەنجامی هەر پلاتفۆرمێک جیا پیشان دەدرێت.",
    ],
    link: { href: "/newsroom/publish", label: "بچۆ بڵاوکردنەوە" },
  },
  {
    id: "comments",
    title: "کۆمێنت و نامە",
    intro: "کۆمێنتەکانی پۆستەکانت و نامەکانی بینەران لە فەیسبووک و ئینستاگرام لە یەک شوێندا دەبینیت و وەڵامیان دەدەیتەوە.",
    steps: [
      "«کۆمێنت» بکەرەوە بۆ کۆمێنتی پۆستەکان.",
      "«نامە» بکەرەوە بۆ نامەی تایبەت.",
      "وەڵامەکەت بنووسە و بینێرە. ڕاستەوخۆ لەسەر پلاتفۆرمەکە دەردەکەوێت.",
    ],
    link: { href: "/newsroom/comments", label: "بچۆ کۆمێنت" },
  },
  {
    id: "insights",
    title: "ئامار",
    intro: "بینین و کارلێکی پۆستەکانت ببینە بۆ ئەوەی بزانیت کام جۆرە هەواڵ باشتر کار دەکات.",
    steps: ["«ئامار» بکەرەوە.", "پۆستەکان بەراورد بکە و ئەو جۆرانەی زیاتر بینراون دووبارە بکەرەوە."],
    link: { href: "/newsroom/insights", label: "بچۆ ئامار" },
  },
  {
    id: "faq",
    title: "پرسیارە باوەکان",
    intro: "وەڵامی ئەو پرسیارانەی کەناڵەکان زۆرتر دەیکەن.",
    qa: [
      {
        q: "ئایا شتێک بێ ئاگاداریی من بڵاو دەبێتەوە؟",
        a: "نەخێر. هەموو پۆستێک پێویستی بە کلیکی تۆیە لە پەڕەی بڵاوکردنەوە.",
      },
      {
        q: "بۆچی هەندێک جار دەقەکە دووبارە دەنووسرێتەوە؟",
        a: "ئەگەر کورتەکە زۆر لە دەقی سەرچاوەکە بچێت، بە خۆکاری دووبارە دەنووسرێتەوە، بۆ ئەوەی قسەی کەناڵێکی تر بە ناوی خۆت بڵاو نەکەیتەوە.",
      },
      {
        q: "وێنەی سەرچاوەکان بەکاردێت؟",
        a: "نەخێر. تەنها ئەو وێنانە بەکاردێن کە خۆت بار دەکەیت.",
      },
      {
        q: "مانگانە چەند هەواڵ دەتوانم ئامادە بکەم؟",
        a: "بەپێی پلانەکەت. ژمارەی ئەم مانگە لە خوارەوەی پەڕەی «هەواڵەکان» نووسراوە.",
      },
      {
        q: "چۆن هەژمارەکەم و زانیارییەکانم بسڕمەوە؟",
        a: "پەڕەی سڕینەوەی زانیاری بخوێنەرەوە. تێیدا ڕێگاکە ڕوون کراوەتەوە.",
      },
    ],
    link: { href: "/data-deletion", label: "سڕینەوەی زانیاری" },
  },
];
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/newsroom/guide.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsroom/guide.ts tests/newsroom/guide.test.ts
git commit -m "Write the newsroom guide in Kurdish

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Nav model

**Files:**
- Create: `src/lib/newsroom/nav.ts`
- Test: `tests/newsroom/nav.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/newsroom/nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeItem, NAV, NAV_GROUPS } from "@/lib/newsroom/nav";
import { GUIDE_IDS } from "@/lib/newsroom/guide";

describe("NAV", () => {
  it("has unique keys and hrefs under /newsroom", () => {
    expect(new Set(NAV.map((i) => i.key)).size).toBe(NAV.length);
    for (const i of NAV) expect(i.href.startsWith("/newsroom/")).toBe(true);
  });
  it("puts every item in a known group", () => {
    const groups = NAV_GROUPS.map((g) => g.key);
    for (const i of NAV) expect(groups).toContain(i.group);
  });
  it("points every item at a guide section", () => {
    for (const i of NAV) expect(GUIDE_IDS).toContain(i.guide);
  });
  it("shows exactly four items in the phone bar (the fifth slot is 'more')", () => {
    expect(NAV.filter((i) => i.mobile)).toHaveLength(4);
  });
});

describe("activeItem", () => {
  it("matches a section and its sub-pages", () => {
    expect(activeItem("/newsroom/news")?.key).toBe("news");
    expect(activeItem("/newsroom/news/abc123")?.key).toBe("news");
    expect(activeItem("/newsroom/settings")?.key).toBe("settings");
  });
  it("does not match a longer sibling name", () => {
    expect(activeItem("/newsroom/newsletter")).toBeUndefined();
  });
  it("returns undefined off the desk", () => {
    expect(activeItem("/newsroom")).toBeUndefined();
    expect(activeItem("/app/news")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/newsroom/nav.test.ts`
Expected: FAIL. The import doesn't resolve.

- [ ] **Step 3: Implement**

`src/lib/newsroom/nav.ts`:

```ts
// The newsroom's sections, in one list for the sidebar, the phone bar and the
// "?" help link. Later parts add entries here (team, monitor, review, calendar).

import type { GuideId } from "./guide";

export type NavKey = "news" | "publish" | "comments" | "messages" | "insights" | "settings" | "guide";
export type NavGroup = "desk" | "audience" | "account";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  group: NavGroup;
  /** Shown in the phone bar; the rest live in the "more" sheet. */
  mobile: boolean;
  /** The guide section the "?" link opens on this screen. */
  guide: GuideId;
}

export const NAV_GROUPS: readonly { key: NavGroup; label: string }[] = [
  { key: "desk", label: "مێزی هەواڵ" },
  { key: "audience", label: "بینەران" },
  { key: "account", label: "کەناڵ" },
];

export const NAV: readonly NavItem[] = [
  { key: "news", href: "/newsroom/news", label: "هەواڵەکان", group: "desk", mobile: true, guide: "stories" },
  { key: "publish", href: "/newsroom/publish", label: "بڵاوکردنەوە", group: "desk", mobile: true, guide: "publish" },
  { key: "comments", href: "/newsroom/comments", label: "کۆمێنت", group: "audience", mobile: true, guide: "comments" },
  { key: "messages", href: "/newsroom/messages", label: "نامە", group: "audience", mobile: false, guide: "comments" },
  { key: "insights", href: "/newsroom/insights", label: "ئامار", group: "audience", mobile: true, guide: "insights" },
  { key: "settings", href: "/newsroom/settings", label: "ڕێکخستن", group: "account", mobile: false, guide: "connect" },
  { key: "guide", href: "/newsroom/guide", label: "ڕێنمایی", group: "account", mobile: false, guide: "start" },
];

/** The section a path belongs to: its own href or anything below it. */
export function activeItem(path: string): NavItem | undefined {
  return NAV.find((i) => path === i.href || path.startsWith(`${i.href}/`));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/newsroom/nav.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsroom/nav.ts tests/newsroom/nav.test.ts
git commit -m "List the newsroom's sections in one place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: First-run checklist logic

**Files:**
- Create: `src/lib/newsroom/checklist.ts`
- Test: `tests/newsroom/checklist.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/newsroom/checklist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checklist, checklistDone, type ChecklistState } from "@/lib/newsroom/checklist";

const empty: ChecklistState = { pagesConnected: 0, logoSet: false, keywords: 0, rssFeeds: 0, cardsMade: 0, postsPublished: 0 };

describe("checklist", () => {
  it("lists five steps in order, none done for a new desk", () => {
    const steps = checklist(empty);
    expect(steps.map((s) => s.key)).toEqual(["connect", "brand", "sources", "card", "publish"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(checklistDone(steps)).toBe(false);
  });
  it("counts sources as set by keywords or by an RSS feed", () => {
    expect(checklist({ ...empty, keywords: 3 }).find((s) => s.key === "sources")?.done).toBe(true);
    expect(checklist({ ...empty, rssFeeds: 1 }).find((s) => s.key === "sources")?.done).toBe(true);
  });
  it("links every step to a newsroom page", () => {
    for (const s of checklist(empty)) expect(s.href.startsWith("/newsroom/")).toBe(true);
  });
  it("is done when every step is", () => {
    const all: ChecklistState = { pagesConnected: 2, logoSet: true, keywords: 1, rssFeeds: 0, cardsMade: 4, postsPublished: 1 };
    expect(checklistDone(checklist(all))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/newsroom/checklist.test.ts`
Expected: FAIL. The import doesn't resolve.

- [ ] **Step 3: Implement**

`src/lib/newsroom/checklist.ts`:

```ts
// First-run steps for a new desk, computed from what the desk really has — so
// the card disappears on its own once the channel is set up.

export interface ChecklistState {
  pagesConnected: number;
  logoSet: boolean;
  keywords: number;
  rssFeeds: number;
  cardsMade: number;
  postsPublished: number;
}

export type ChecklistKey = "connect" | "brand" | "sources" | "card" | "publish";

export interface ChecklistStep {
  key: ChecklistKey;
  label: string;
  href: string;
  done: boolean;
}

export function checklist(s: ChecklistState): ChecklistStep[] {
  return [
    { key: "connect", label: "پەیجێکی فەیسبووک، ئینستاگرام یان تیکتۆک ببەستەوە", href: "/newsroom/settings", done: s.pagesConnected > 0 },
    { key: "brand", label: "لۆگۆی کەناڵەکەت دابنێ", href: "/newsroom/settings", done: s.logoSet },
    { key: "sources", label: "وشە سەرەکییەکان یان RSSێک دابنێ", href: "/newsroom/settings", done: s.keywords > 0 || s.rssFeeds > 0 },
    { key: "card", label: "یەکەم کارتت دروست بکە", href: "/newsroom/news", done: s.cardsMade > 0 },
    { key: "publish", label: "یەکەم هەواڵت بڵاو بکەرەوە", href: "/newsroom/news?tab=ready", done: s.postsPublished > 0 },
  ];
}

export function checklistDone(steps: readonly ChecklistStep[]): boolean {
  return steps.every((s) => s.done);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/newsroom/checklist.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsroom/checklist.ts tests/newsroom/checklist.test.ts
git commit -m "Work out a new desk's first steps from what it has

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The newsroom frame

**Files:**
- Create: `src/app/newsroom/newsroom.css`
- Create: `src/app/newsroom/desk-shell.tsx`
- Create: `src/app/newsroom/desk-nav.tsx`
- Modify: `src/app/app/nav.tsx` (export `Pending`)
- Modify: `src/app/newsroom/(desk)/layout.tsx`
- Modify: `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/forgot/page.tsx` (add the `.nr` class for the newsroom)

There's no unit test here, since this is layout. Task 9 checks it in the browser.

- [ ] **Step 1: Create `src/app/newsroom/newsroom.css`**

```css
/* Newsroom — a control-room identity on top of the merchant app's .gm system.
   Everything is scoped under .gm.nr / .nr-*, so the shop never changes. */

.gm.nr {
  --ground: #eef0f4; --surface: #ffffff; --raised: #f5f6f9;
  --ink: #0c1322; --muted: #5a6478; --faint: #8b94a6;
  --accent: #1f4fd6; --accent-soft: #e3e9fc; --accent-line: #b4c5f3;
  --alert: #c4262e; --alert-soft: #fbe5e6; --alert-line: #efb4b7;
  --line: #d5dae4; --line-soft: #e3e7ee;
  --live: #e0262f;
}
@media (prefers-color-scheme: dark) {
  .gm.nr {
    --ground: #0a0e16; --surface: #111827; --raised: #172033;
    --ink: #e7ecf5; --muted: #98a3b8; --faint: #6b7589;
    --accent: #7aa2ff; --accent-soft: #16244a; --accent-line: #2c417a;
    --alert: #ff7a7f; --alert-soft: #3a1518; --alert-line: #6b2a2f;
    --line: #243049; --line-soft: #1a2438;
    --live: #ff4d55;
  }
}

/* brand mark */
.nr-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; margin: 0; padding: 4px 10px;
  color: var(--ink); text-decoration: none; }
.nr-live { width: 8px; height: 8px; border-radius: 50%; background: var(--live); flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 22%, transparent); }

/* frame: one column on phones, sidebar + content from 960px */
.nr-frame { min-height: 100%; }
.nr-side { display: none; }
.nr-body { min-width: 0; min-height: 100%; display: flex; flex-direction: column; }
.nr-top {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px; background: var(--ground);
  border-bottom: 1px solid var(--line-soft);
}
.nr-desk { display: flex; align-items: center; gap: 8px; min-width: 0; }
.nr-desk h1 { margin: 0; font-size: 17px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nr-help { width: 32px; height: 32px; flex: none; display: inline-grid; place-items: center; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-decoration: none; font: inherit; }
.nr-help:hover { color: var(--accent); border-color: var(--accent-line); }
.nr-main { flex: 1; width: 100%; max-width: 880px; margin: 0 auto; padding: 16px 16px calc(env(safe-area-inset-bottom, 0px) + 92px); }

/* nav links (sidebar and sheet) */
.nr-group { display: flex; flex-direction: column; gap: 2px; }
.nr-group-label { font-size: 11px; font-weight: 600; color: var(--faint); margin: 0; padding: 0 10px 4px; }
.nr-link { position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px;
  color: var(--muted); text-decoration: none; font-size: 13.5px; }
button.nr-link { font: inherit; font-size: 13.5px; background: none; border: 0; cursor: pointer; width: 100%; text-align: start; }
.nr-link svg { width: 18px; height: 18px; flex: none; }
.nr-link:hover { background: var(--raised); color: var(--ink); }
.nr-link[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.nr-link .gm-pending { top: auto; bottom: 2px; left: 10px; right: 10px; }
.nr-link:focus-visible, .nr-help:focus-visible, .nr-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.nr-foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; border-top: 1px solid var(--line-soft); padding-top: 10px; }

/* phone bar "more" button and sheet */
.nr-more { font: inherit; background: none; border: 0; cursor: pointer; width: 100%; }
.nr-backdrop { position: fixed; inset: 0; z-index: 20; background: rgb(5 8 15 / 0.45); }
.nr-sheet { position: fixed; inset-inline: 0; bottom: 0; z-index: 21; max-height: 80dvh; overflow-y: auto; background: var(--surface);
  border-radius: 18px 18px 0 0; border-top: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 14px;
  padding: 14px 12px calc(env(safe-area-inset-bottom, 0px) + 16px); }
.nr-sheet-head { display: flex; align-items: center; justify-content: space-between; }

@media (min-width: 960px) {
  .nr-frame { display: grid; grid-template-columns: 248px minmax(0, 1fr); }
  .nr-side { display: flex; flex-direction: column; gap: 18px; position: sticky; top: 0; height: 100vh; height: 100dvh; overflow-y: auto;
    padding: calc(env(safe-area-inset-top, 0px) + 16px) 12px 16px; background: var(--surface); border-inline-end: 1px solid var(--line-soft); }
  .nr-main { padding: 24px 28px 40px; }
  .nr .gm-tabs, .nr-backdrop, .nr-sheet { display: none; }
}

/* guide */
.nr-guide { display: grid; gap: 14px; }
.nr-guide .gm-card + .gm-card { margin-top: 0; }
.nr-guide .gm-chip { text-decoration: none; }
.nr-guide section { scroll-margin-top: 72px; }
.nr-guide h2 { font-size: 17px; margin: 0 0 6px; }
.nr-guide p { margin: 0; }
.nr-steps { margin: 10px 0 0; padding-inline-start: 22px; display: grid; gap: 6px; }
.nr-qa { margin: 6px 0 0; }
.nr-qa dt { font-weight: 600; margin-top: 10px; }
.nr-qa dd { margin: 2px 0 0; color: var(--muted); }
.nr-more-link { display: inline-block; margin-top: 10px; }

/* first-run checklist */
.nr-check { display: grid; gap: 10px; }
.nr-check ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.nr-check li a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; text-decoration: none;
  color: inherit; background: var(--raised); }
.nr-check .tick { width: 20px; height: 20px; flex: none; border-radius: 50%; border: 1.5px solid var(--line);
  display: inline-grid; place-items: center; }
.nr-check li.done .tick { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.nr-check li.done .label { color: var(--muted); text-decoration: line-through; }
.nr-check .state { margin-inline-start: auto; font-size: 11.5px; color: var(--muted); }
.nr-meter { height: 4px; border-radius: 999px; background: var(--line-soft); overflow: hidden; }
.nr-meter span { display: block; height: 100%; background: var(--accent); }

/* landing and public pages */
.nr-land { max-width: 760px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 28px) 16px 48px; }
.nr-hero h1 { font-size: 27px; line-height: 1.55; margin: 18px 0 8px; }
.nr-hero p { color: var(--muted); font-size: 15px; margin: 0; }
.nr-features { display: grid; gap: 10px; margin-top: 24px; }
.nr-feature { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 14px; padding: 16px; }
.nr-feature svg { color: var(--accent); width: 22px; height: 22px; }
.nr-feature h3 { font-size: 15px; margin: 8px 0 4px; }
.nr-feature p { margin: 0; color: var(--muted); font-size: 13px; }
.nr-cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.nr-promise { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 13px; color: var(--muted); }
.nr-promise svg { width: 16px; height: 16px; color: var(--accent); flex: none; }
@media (min-width: 720px) {
  .nr-features { grid-template-columns: 1fr 1fr; }
  .nr-hero h1 { font-size: 34px; }
}
```

- [ ] **Step 2: Export `Pending` from the shop nav**

In `src/app/app/nav.tsx`, change `function Pending() {` to `export function Pending() {`. Change nothing else.

- [ ] **Step 3: Create `src/app/newsroom/desk-nav.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  BookOpen,
  CircleHelp,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Settings,
  SquarePlus,
  X,
  type LucideIcon,
} from "lucide-react";

import { Pending } from "@/app/app/nav";
import { activeItem, NAV, NAV_GROUPS, type NavKey } from "@/lib/newsroom/nav";

const ICONS: Record<NavKey, LucideIcon> = {
  news: Newspaper,
  publish: SquarePlus,
  comments: MessagesSquare,
  messages: MessageCircle,
  insights: BarChart3,
  settings: Settings,
  guide: BookOpen,
};

function signOutOfNewsroom() {
  void signOut({ callbackUrl: "/login?next=/newsroom/news" });
}

function Brand() {
  return (
    <p className="nr-brand kufi">
      <span className="nr-live" aria-hidden="true" />
      گیتواس نیوزڕووم
    </p>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const current = activeItem(usePathname());
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <div key={g.key} className="nr-group">
          <p className="nr-group-label">{g.label}</p>
          {NAV.filter((i) => i.group === g.key).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="nr-link" aria-current={on ? "page" : undefined} onClick={onNavigate}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {i.label}
                <Pending />
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SignOutButton() {
  return (
    <button type="button" className="nr-link" onClick={signOutOfNewsroom}>
      <LogOut aria-hidden="true" strokeWidth={1.8} />
      چوونەدەرەوە
    </button>
  );
}

/** Desktop sidebar (hidden under 960px by CSS). */
export function SideNav() {
  return (
    <aside className="nr-side">
      <Brand />
      <nav aria-label="بەشەکانی نیوزڕووم" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <NavLinks />
      </nav>
      <div className="nr-foot">
        <SignOutButton />
      </div>
    </aside>
  );
}

/** Phone bar: four sections plus "more", which opens every section in a sheet (hidden from 960px by CSS). */
export function BottomNav() {
  const current = activeItem(usePathname());
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="gm-tabs">
        <nav aria-label="بەشەکان">
          {NAV.filter((i) => i.mobile).map((i) => {
            const Icon = ICONS[i.key];
            const on = current?.key === i.key;
            return (
              <Link key={i.key} href={i.href} className="gm-tab" aria-current={on ? "page" : undefined}>
                <Icon aria-hidden="true" strokeWidth={on ? 2.2 : 1.8} />
                {i.label}
                <Pending />
              </Link>
            );
          })}
          <button type="button" className="gm-tab nr-more" aria-expanded={open} aria-controls="nr-sheet" onClick={() => setOpen(true)}>
            <Menu aria-hidden="true" strokeWidth={1.8} />
            زیاتر
          </button>
        </nav>
      </div>
      {open && (
        <>
          <div className="nr-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <div id="nr-sheet" className="nr-sheet" role="dialog" aria-modal="true" aria-label="هەموو بەشەکان">
            <div className="nr-sheet-head">
              <Brand />
              <button ref={closeRef} type="button" className="nr-help" aria-label="داخستن" onClick={() => setOpen(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="هەموو بەشەکان" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
            <div className="nr-foot">
              <SignOutButton />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** "?" in the top bar: opens the guide at the section for the current screen. */
export function HelpLink() {
  const item = activeItem(usePathname());
  return (
    <Link href={`/newsroom/guide#${item?.guide ?? "start"}`} className="nr-help" aria-label="ڕێنمایی ئەم بەشە" title="ڕێنمایی">
      <CircleHelp size={17} aria-hidden="true" />
    </Link>
  );
}
```

- [ ] **Step 4: Create `src/app/newsroom/desk-shell.tsx`**

```tsx
import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import type { Workspace } from "@/app/app/data";
import { BottomNav, HelpLink, SideNav } from "./desk-nav";

/** The newsroom's root element: the shop's design system, re-tokened by .nr. */
export function NewsroomRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang="ckb">
      {children}
    </div>
  );
}

/** A signed-in channel's frame: sidebar on desktop, top bar with the "?" guide link, phone bar. */
export function DeskShell({ ws, children }: { ws: Workspace; children: React.ReactNode }) {
  return (
    <NewsroomRoot>
      <div className="nr-frame">
        <SideNav />
        <div className="nr-body">
          <header className="nr-top">
            <div className="nr-desk">
              <h1 className="kufi">{ws.name}</h1>
              <span className="gm-badge ghost">نیوزڕووم</span>
            </div>
            <HelpLink />
          </header>
          <main className="nr-main">{children}</main>
        </div>
      </div>
      <BottomNav />
    </NewsroomRoot>
  );
}
```

- [ ] **Step 5: Replace `src/app/newsroom/(desk)/layout.tsx` with the complete file below**

```tsx
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { claimKind, currentWorkspace } from "@/app/app/data";
import { DeskShell, NewsroomRoot } from "../desk-shell";
import { ShopNotice } from "../shop-notice";

export const metadata: Metadata = { title: "گیتواس نیوزڕووم", description: "هەواڵ، کارت و بڵاوکردنەوە بۆ کەناڵەکەت" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function NewsroomDeskLayout({ children }: { children: React.ReactNode }) {
  let ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/newsroom/news");
  if (!ws.kindChosen) ws = await claimKind(ws, "NEWS");

  if (!ws.kindChosen) {
    return (
      <NewsroomRoot>
        <div className="gm-auth">
          <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>هەژمارەکەت ئامادە نەکرا. پەڕەکە نوێ بکەرەوە.</p>
          </div>
          <Link href="/newsroom/news" className="gm-btn block" style={{ marginTop: 12 }}>
            دووبارە هەوڵ بدەرەوە
          </Link>
        </div>
      </NewsroomRoot>
    );
  }

  if (ws.kind !== "NEWS") {
    return (
      <NewsroomRoot>
        <ShopNotice />
      </NewsroomRoot>
    );
  }

  return <DeskShell ws={ws}>{children}</DeskShell>;
}
```

- [ ] **Step 6: Give the newsroom's sign-in pages the newsroom look**

In each of `src/app/login/page.tsx`, `src/app/signup/page.tsx` and `src/app/forgot/page.tsx`:

1. Add `import "@/app/newsroom/newsroom.css";` right after `import "@/app/app/app.css";`.
2. On the wrapper `<div>` that renders the Kurdish form, change `className={`gm ${gmFontVars}`}` to add `nr` for the newsroom:
   - in `login/page.tsx` (inside the `if (product !== "operator")` block): `className={`gm ${product === "newsroom" ? "nr " : ""}${gmFontVars}`}`
   - in `signup/page.tsx` and `forgot/page.tsx`: `className={`gm ${next.startsWith("/newsroom") ? "nr " : ""}${gmFontVars}`}`

The operator's `LoginCard` return in `login/page.tsx` stays unchanged.

- [ ] **Step 7: Type check and run all tests**

Run: `npx tsc --noEmit`, which should print nothing.
Then run `npx vitest run`, where every test should pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/newsroom/newsroom.css src/app/newsroom/desk-shell.tsx src/app/newsroom/desk-nav.tsx src/app/app/nav.tsx "src/app/newsroom/(desk)/layout.tsx" src/app/login/page.tsx src/app/signup/page.tsx src/app/forgot/page.tsx
git commit -m "Give the newsroom its own frame: sidebar, phone bar, guide link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Guide page

**Files:**
- Create: `src/app/newsroom/guide/guide-article.tsx`
- Create: `src/app/newsroom/guide/page.tsx`

`/newsroom/guide` sits outside the `(desk)` group so that channels can read it before signing up. A signed-in channel sees it inside its frame.

- [ ] **Step 1: Create `src/app/newsroom/guide/guide-article.tsx`**

```tsx
import Link from "next/link";

import { num } from "@/app/app/format";
import { GUIDE } from "@/lib/newsroom/guide";

export function GuideArticle() {
  return (
    <article className="nr-guide">
      <header className="gm-stack" style={{ gap: 8 }}>
        <h1 className="gm-title kufi">ڕێنمایی نیوزڕووم</h1>
        <p className="gm-sub" style={{ margin: 0 }}>
          هەموو ئەوەی پێویستە بۆ ئەوەی کەناڵەکەت لە یەک ڕۆژدا دەست بە کار بکات.
        </p>
        <nav aria-label="ناوەڕۆک" className="gm-chips">
          {GUIDE.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="gm-chip">
              {s.title}
            </a>
          ))}
        </nav>
      </header>

      {GUIDE.map((s, i) => (
        <section key={s.id} id={s.id} className="gm-card" aria-labelledby={`${s.id}-title`}>
          <h2 id={`${s.id}-title`} className="kufi">
            {num(i + 1)}. {s.title}
          </h2>
          <p>{s.intro}</p>
          {s.steps && (
            <ol className="nr-steps">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {s.qa && (
            <dl className="nr-qa">
              {s.qa.map(({ q, a }) => (
                <div key={q}>
                  <dt>{q}</dt>
                  <dd>{a}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.link && (
            <Link href={s.link.href} className="gm-link nr-more-link">
              {s.link.label} ←
            </Link>
          )}
        </section>
      ))}
    </article>
  );
}
```

- [ ] **Step 2: Create `src/app/newsroom/guide/page.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { currentWorkspace } from "@/app/app/data";
import { DeskShell, NewsroomRoot } from "../desk-shell";
import { GuideArticle } from "./guide-article";

export const metadata: Metadata = {
  title: "ڕێنمایی — گیتواس نیوزڕووم",
  description: "چۆن کەناڵەکەت لە نیوزڕووم دەست پێ بکات: پەیج بەستنەوە، براند، سەرچاوە، کارت و بڵاوکردنەوە.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const ws = await currentWorkspace();
  if (ws?.kindChosen && ws.kind === "NEWS") {
    return (
      <DeskShell ws={ws}>
        <GuideArticle />
      </DeskShell>
    );
  }
  return (
    <NewsroomRoot>
      <div className="nr-land">
        <div className="gm-between" style={{ marginBottom: 18 }}>
          <Link href="/newsroom" className="nr-brand kufi" style={{ padding: 0 }}>
            <span className="nr-live" aria-hidden="true" />
            گیتواس نیوزڕووم
          </Link>
          <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
            چوونەژوورەوە
          </Link>
        </div>
        <GuideArticle />
      </div>
    </NewsroomRoot>
  );
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/newsroom/guide
git commit -m "Add the newsroom guide page, public and inside the desk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Checklist on the news page

**Files:**
- Create: `src/app/newsroom/(desk)/news/checklist.tsx`
- Modify: `src/app/newsroom/(desk)/news/page.tsx`

- [ ] **Step 1: Create `src/app/newsroom/(desk)/news/checklist.tsx`**

```tsx
import Link from "next/link";
import { Check } from "lucide-react";

import { num } from "@/app/app/format";
import type { ChecklistStep } from "@/lib/newsroom/checklist";

/** A new desk's first steps. The page hides it once every step is done. */
export function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="gm-card nr-check" aria-labelledby="nr-check-title">
      <div className="gm-between">
        <h3 id="nr-check-title" className="kufi" style={{ margin: 0, fontSize: 15 }}>
          هەنگاوەکانی یەکەم
        </h3>
        <small className="gm-sub" style={{ margin: 0 }}>
          {num(done)} / {num(steps.length)}
        </small>
      </div>
      <div className="nr-meter" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "done" : undefined}>
            <Link href={s.href}>
              <span className="tick" aria-hidden="true">
                {s.done && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="label">{s.label}</span>
              {s.done && <span className="state">تەواو</span>}
            </Link>
          </li>
        ))}
      </ol>
      <Link href="/newsroom/guide" className="gm-link" style={{ fontSize: 12.5 }}>
        ڕێنمایی تەواو بخوێنەوە
      </Link>
    </section>
  );
}
```

- [ ] **Step 2: Load the checklist state in the news page**

In `src/app/newsroom/(desk)/news/page.tsx`:

1. Add imports:

```tsx
import { checklist, checklistDone } from "@/lib/newsroom/checklist";
import { Checklist } from "./checklist";
```

2. Replace the `Promise.all` destructuring line and array. It currently starts `const [items, sources, settings, tenant, drafts, catalogSources] = await Promise.all([` and ends with the `catalogSources` query. The new version keeps all six queries unchanged and appends five more:

```tsx
  const [items, sources, settings, tenant, drafts, catalogSources, pagesConnected, rssFeeds, kit, cardsMade, postsPublished] = await Promise.all([
    db.newsItem.findMany({
      where: { tenantId: ws.id, status: { in: [...tab.statuses] } },
      orderBy: { publishedAt: "desc" },
      take: 150,
    }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true } }),
    db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    usageOf(ws.id, "draft"),
    db.newsSource.findMany({ where: { tenantId: ws.id, enabled: true, catalogId: { not: null } }, select: { catalogId: true } }),
    db.oAuthCredential.count({ where: { tenantId: ws.id, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK"] } } }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true, rssUrl: { not: null } } }),
    db.brandKit.findUnique({ where: { tenantId: ws.id }, select: { logoPath: true } }),
    db.newsDraft.count({ where: { tenantId: ws.id, cardPath: { not: null } } }),
    db.newsDraft.count({ where: { tenantId: ws.id, publishedAt: { not: null } } }),
  ]);
```

3. Right after the existing `const attributions = …` line, add:

```tsx
  const steps = checklist({
    pagesConnected,
    logoSet: !!kit?.logoPath,
    keywords: settings?.keywords.length ?? 0,
    rssFeeds,
    cardsMade,
    postsPublished,
  });
```

4. In the JSX, directly after the closing `</div>` of the first `gm-between` block (the heading and `RefreshButton`), add:

```tsx
      {!checklistDone(steps) && <Checklist steps={steps} />}
```

- [ ] **Step 3: Type check and run all tests**

Run: `npx tsc --noEmit`, which should print nothing.
Then run `npx vitest run`, where every test should pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/newsroom/(desk)/news/checklist.tsx" "src/app/newsroom/(desk)/news/page.tsx"
git commit -m "Show a new desk its first steps on the news page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Landing page

**Files:**
- Modify: `src/app/newsroom/page.tsx` (full replacement)

- [ ] **Step 1: Replace `src/app/newsroom/page.tsx` with the complete file below**

```tsx
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, LayoutTemplate, ShieldCheck, Sparkles, Send } from "lucide-react";

import { currentWorkspace } from "@/app/app/data";
import { NewsroomRoot } from "./desk-shell";
import { ShopNotice } from "./shop-notice";

export const metadata: Metadata = {
  title: "گیتواس نیوزڕووم",
  description: "ژووری هەواڵی کەناڵەکەت لەسەر سۆشیال میدیا: کارتی براندی خۆت و بڵاوکردنەوە بۆ هەموو پلاتفۆرمەکان لە یەک شوێنەوە.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    Icon: LayoutTemplate,
    title: "کارتی براندی کەناڵەکەت",
    body: "لۆگۆ، ڕەنگ و فۆنتی خۆت لەسەر هەموو کارتێک، بە چوار جۆر: ئاسایی، بەپەلە، ژمارە و وتە.",
  },
  {
    Icon: Sparkles,
    title: "کورتەی کوردی بە زیرەکیی دەستکرد",
    body: "هەواڵ لە چەند چرکەیەکدا دەبێتە سەردێڕ و دەقی کوردیی ئامادە بۆ پۆست. تۆ دەستکاری و پەسەندی دەکەیت.",
  },
  {
    Icon: Send,
    title: "یەک شوێن بۆ هەموو پلاتفۆرمەکان",
    body: "لە یەک پەڕەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک بڵاو بکەرەوە.",
  },
  {
    Icon: BarChart3,
    title: "کۆمێنت، نامە و ئامار",
    body: "وەڵامی بینەران بدەرەوە و بزانە کام هەواڵ زیاتر بینراوە، بێ ئەوەی لە ئەپێکەوە بچیتە ئەپێکی تر.",
  },
] as const;

export default async function NewsroomLandingPage() {
  const ws = await currentWorkspace();
  if (ws) {
    if (!ws.kindChosen || ws.kind === "NEWS") redirect("/newsroom/news");
    return (
      <NewsroomRoot>
        <ShopNotice />
      </NewsroomRoot>
    );
  }

  return (
    <NewsroomRoot>
      <div className="nr-land">
        <div className="gm-between">
          <p className="nr-brand kufi" style={{ padding: 0 }}>
            <span className="nr-live" aria-hidden="true" />
            گیتواس نیوزڕووم
          </p>
          <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
            چوونەژوورەوە
          </Link>
        </div>

        <section className="nr-hero">
          <h1 className="kufi">ژووری هەواڵی کەناڵەکەت، لەسەر هەموو پلاتفۆرمەکان</h1>
          <p>هەواڵ بکە بە کارتی براندی خۆت و لە یەک شوێنەوە بۆ فەیسبووک، ئینستاگرام و تیکتۆک بڵاوی بکەرەوە.</p>
        </section>

        <div className="nr-cta">
          <Link href="/signup?next=/newsroom/news" className="gm-btn">
            دەست پێ بکە
          </Link>
          <Link href="/newsroom/guide" className="gm-btn quiet">
            چۆن کار دەکات؟
          </Link>
        </div>
        <p className="nr-promise">
          <ShieldCheck aria-hidden="true" />
          هیچ شتێک بێ پەسەندی تۆ بڵاو نابێتەوە.
        </p>

        <div className="nr-features">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="nr-feature">
              <Icon aria-hidden="true" />
              <h3 className="kufi">{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </NewsroomRoot>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/newsroom/page.tsx
git commit -m "Refresh the newsroom landing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify, record, ship (controller)

The controller does this task, not a subagent. It needs a browser and a sign-in on localhost.

- [ ] **Step 1: Full checks**

- `npx vitest run`: all tests pass.
- `npx tsc --noEmit`: no output.
- `npm run build`: it succeeds.

- [ ] **Step 2: Browser check on localhost**

Start the preview with `gituas-dev` (port 3001). Check these pages:
- `/newsroom` and `/newsroom/guide` while signed out:
  - the landing and public guide render;
  - on the guide, the chips jump to their sections.
- `/login?next=/newsroom/news`:
  - the tab title reads "چوونەژوورەوە — گیتواس نیوزڕووم";
  - there's no GitHub button;
  - the newsroom palette is applied.
- `/login?next=/app`: the GitHub button is still there.
- Sign in on localhost with the newsroom test account, then check:
  - `/newsroom/news` at desktop width: the sidebar is on the right, the checklist shows, and "?" opens `/newsroom/guide#stories`;
  - at 375 px: the bottom bar shows four items plus "زیاتر", the sheet opens and closes (Escape, the backdrop, a link), and nothing scrolls sideways;
  - in dark mode: the palette is readable;
  - `/newsroom/publish`, `/newsroom/settings` and `/newsroom/guide` all render inside the frame.
- Check the console for errors.

- [ ] **Step 3: Record**

Add a dated line to `TODOS.md`: "Newsroom 1A shipped (shell, guide, checklist, sign-in polish)", with parts 1B–1D next.

- [ ] **Step 4: Merge and push**

```bash
git checkout master
git merge --ff-only newsroom-1a
git push origin master
```

Vercel deploys on push. Then check `https://gituas.vercel.app/newsroom`, `/newsroom/guide` and `/login?next=/newsroom/news` in production, signed out.
