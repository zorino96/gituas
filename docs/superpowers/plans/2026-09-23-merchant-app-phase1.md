# Merchant App — Phase 1 Implementation Plan

> **For agentic workers:** executed inline by the same agent that wrote it
> (the UI must stay coherent with the approved prototype, which one hand does
> better than a relay). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Kurdish, right-to-left, mobile-first merchant app at `/app` on
production that the owner can use on their real Facebook, Instagram and TikTok
accounts today: read and answer comments, hide and delete them, answer DMs,
publish one post to all three platforms, see insights, and set a WhatsApp number.

**Architecture:** Additive. A new route tree `src/app/app/` with its own layout,
fonts and stylesheet, sitting on the Graph/TikTok client functions that already
exist in `src/lib/publishers/`. Pure logic lives in `src/lib/merchant/` and is
unit-tested. Nothing under `/dashboard` changes, and the audited TikTok screen at
`/dashboard/post/tiktok/[id]` is not touched.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 7 (`db push`,
no migrations folder), Vercel Blob (client uploads), Vitest.

**Out of this phase (Phase 2 plan, written when Phase 1 ships):** the automatic
reply machine — catalog, post tagging, outbox, classifier, templates, private
replies, counted handoff links with product and price. Phase 3: Facebook login
for other merchants, Store migration off Project, removal of software-era code.

---

## Facts this plan depends on (verified 2026-09-23)

- Engage functions exist: IG `fetchMedia, fetchComments, replyToComment,
  setCommentHidden, fetchConversations, sendInstagramDM, fetchUserInsights,
  fetchMediaInsights`; FB `fetchPagePosts, fetchPageComments, replyToPageComment,
  hidePageComment, fetchPageConversations, sendMessengerMessage,
  fetchPageInsights, fetchPageProfile`. No delete function exists on either.
- `IgComment` and `FbComment` carry only id/text/username/timestamp — no replies,
  no hidden flag. Both must be extended to know "answered" and "hidden".
- Publishers: `publishToFacebookPage(tenantId, {message, mediaUrl?, mediaType?})`,
  `publishToInstagram(tenantId, {caption, mediaUrl, mediaType})` (requires
  `https://`), `publishToTikTok(tenantId, {title, videoUrl, durationSec?}, options)`
  using `PULL_FROM_URL` — the URL must sit under the domain/prefix verified in the
  TikTok portal.
- Media today is stored as `data:` URLs — unusable for publishing.
  `BLOB_READ_WRITE_TOKEN` exists. Vercel functions cap request bodies at 4.5 MB,
  so uploads must go browser → Blob directly (client upload).
- Prod DB currently holds `META_INSTAGRAM`, `TIKTOK`, `YOUTUBE` credentials and
  **no `META_FACEBOOK`** — the owner connects their Page before testing FB.
- OAuth start URL: `/api/oauth/<provider-lowercase>/start`.
- `origin/master` is at `396f1ce`; pushing to master deploys production.
  Preview URLs cannot run GitHub login or Meta/TikTok OAuth (redirect URIs are
  registered for `gituas.vercel.app`), so Phase 1 ships to production at the
  additive path `/app`.

## File structure

```
src/lib/merchant/
  types.ts         MPost, MComment, CommentState, Platform
  normalize.ts     fromIg(), fromFb()  — engage payloads → MPost[]
  state.ts         commentState(), countStates(), rankPosts()
  phone.ts         normalizePhone(), waLink()
  caption.ts       CAPTION_LIMITS, captionProblems(), mergeHashtags(), CITY_TAGS
  tiktok-rules.ts  tiktokProblems()
src/lib/publishers/
  instagram-engage.ts   + hidden, replies on fetchComments; + deleteIgComment()
  facebook-engage.ts    + is_hidden, replies on fetchPageComments; + deletePageComment()
src/app/app/
  layout.tsx       fonts, RTL root, auth guard, tab bar
  app.css          tokens + classes, ported from the approved prototype
  nav.tsx          client tab bar
  actions.ts       server actions (tenant-scoped)
  data.ts          server loaders
  page.tsx                          ئەمڕۆ
  comments/page.tsx, comments-client.tsx
  messages/page.tsx, messages-client.tsx
  publish/page.tsx, publish-client.tsx
  insights/page.tsx
  settings/page.tsx, settings-client.tsx
src/app/api/app/upload/route.ts    Blob client-upload token
src/app/m/[...key]/route.ts         media proxy on the verified domain (TikTok)
src/app/w/[slug]/route.ts           WhatsApp redirect + tap log
tests/merchant/*.test.ts
prisma/schema.prisma               + Tenant.whatsappNumber String?
```

---

### Task 0: Tooling

**Files:** `package.json`, `vitest.config.ts`

- [ ] `npm i -D vitest` and `npm i @vercel/blob`
- [ ] Add script `"test": "vitest run"`
- [ ] `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] `npm test` → "No test files found" (exit 0 or 1 is fine at this point)
- [ ] Commit: `Add Vitest and Vercel Blob for the merchant app`

### Task 1: Phone normalisation and WhatsApp links

**Files:** `src/lib/merchant/phone.ts`, `tests/merchant/phone.test.ts`

- [ ] Write the failing test:

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone, waLink } from "@/lib/merchant/phone";

describe("normalizePhone", () => {
  it("turns a local Iraqi mobile into international digits", () => {
    expect(normalizePhone("0750 123 4567")).toEqual({ ok: true, digits: "9647501234567" });
  });
  it("accepts Arabic-Indic and Persian digits", () => {
    expect(normalizePhone("٠٧٥٠١٢٣٤٥٦٧")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("۰۷۷۰۱۲۳۴۵۶۷")).toEqual({ ok: true, digits: "9647701234567" });
  });
  it("accepts +964, 00964 and bare 7xx forms", () => {
    expect(normalizePhone("+964 750 123 4567")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("00964-750-123-4567")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("7501234567")).toEqual({ ok: true, digits: "9647501234567" });
  });
  it("accepts a foreign number in international form", () => {
    expect(normalizePhone("+44 7700 900123")).toEqual({ ok: true, digits: "447700900123" });
  });
  it("rejects empty, letters and wrong lengths", () => {
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("0750abc4567").ok).toBe(false);
    expect(normalizePhone("0750 123").ok).toBe(false);
    expect(normalizePhone("07501234567890").ok).toBe(false);
  });
});

describe("waLink", () => {
  it("builds a wa.me link with encoded text", () => {
    expect(waLink("9647501234567", "سڵاو 1")).toBe(
      "https://wa.me/9647501234567?text=" + encodeURIComponent("سڵاو 1"),
    );
  });
  it("omits text when none is given", () => {
    expect(waLink("9647501234567")).toBe("https://wa.me/9647501234567");
  });
});
```

- [ ] `npm test` → FAIL (module not found)
- [ ] Implement:

```ts
export type PhoneResult = { ok: true; digits: string } | { ok: false; error: string };

const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Normalise what a merchant types into the digits wa.me expects. Iraqi
 *  mobiles are the common case; any other country must be written with + or 00. */
export function normalizePhone(raw: string): PhoneResult {
  const ascii = raw.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d).trim();
  if (!ascii) return { ok: false, error: "empty" };
  if (/[^\d\s\-+().]/.test(ascii)) return { ok: false, error: "invalid characters" };
  const international = ascii.startsWith("+") || ascii.startsWith("00");
  let d = ascii.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (!international) {
    if (d.startsWith("0")) d = "964" + d.slice(1);
    else if (d.length === 10 && d.startsWith("7")) d = "964" + d;
  }
  if (d.startsWith("964")) {
    return /^9647\d{9}$/.test(d) ? { ok: true, digits: d } : { ok: false, error: "not an Iraqi mobile" };
  }
  if (!international) return { ok: false, error: "not an Iraqi mobile" };
  return d.length >= 8 && d.length <= 15 ? { ok: true, digits: d } : { ok: false, error: "wrong length" };
}

export function waLink(digits: string, text?: string): string {
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
```

- [ ] `npm test` → PASS
- [ ] Commit: `Normalise merchant phone numbers for WhatsApp links`

### Task 2: Captions and hashtags

**Files:** `src/lib/merchant/caption.ts`, `tests/merchant/caption.test.ts`

- [ ] Failing test:

```ts
import { describe, it, expect } from "vitest";
import { captionProblems, mergeHashtags, CITY_TAGS } from "@/lib/merchant/caption";

describe("captionProblems", () => {
  it("passes a normal caption everywhere", () => {
    expect(captionProblems("جلی نوێ", ["FB", "IG", "TT"])).toEqual([]);
  });
  it("flags Instagram and TikTok over 2200 characters but not Facebook", () => {
    const long = "ا".repeat(2201);
    expect(captionProblems(long, ["FB", "IG", "TT"]).map((p) => p.target)).toEqual(["IG", "TT"]);
  });
  it("flags more than 30 hashtags on Instagram", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(captionProblems(tags, ["IG"])).toEqual([{ target: "IG", problem: "hashtags" }]);
  });
});

describe("mergeHashtags", () => {
  it("appends tags that are missing, once", () => {
    expect(mergeHashtags("جلی نوێ #جلی_کوردی", ["#جلی_کوردی", "#hawler"])).toBe("جلی نوێ #جلی_کوردی\n\n#hawler");
  });
  it("leaves the caption alone when every tag is present", () => {
    expect(mergeHashtags("x #a #b", ["#a", "#b"])).toBe("x #a #b");
  });
  it("ships the dual-script multi-city tags", () => {
    expect(CITY_TAGS).toContain("#کوردستان_هەولێر_سلێمانی");
    expect(CITY_TAGS).toContain("#hawler_slemani_dhok_karkuk_hallabja");
  });
});
```

- [ ] `npm test` → FAIL
- [ ] Implement:

```ts
export const CAPTION_LIMITS = { FB: 63206, IG: 2200, TT: 2200 } as const;
export type Target = keyof typeof CAPTION_LIMITS;

/** The composite city tags Kurdish sellers use for region-wide discovery. */
export const CITY_TAGS = ["#کوردستان_هەولێر_سلێمانی", "#hawler_slemani_dhok_karkuk_hallabja"] as const;

const HASHTAG = /#[\p{L}\p{N}_]+/gu;

export function captionProblems(caption: string, targets: Target[]): { target: Target; problem: string }[] {
  const out: { target: Target; problem: string }[] = [];
  const length = [...caption].length;
  const tags = caption.match(HASHTAG)?.length ?? 0;
  for (const t of targets) {
    if (length > CAPTION_LIMITS[t]) out.push({ target: t, problem: "length" });
    else if (t === "IG" && tags > 30) out.push({ target: t, problem: "hashtags" });
  }
  return out;
}

export function mergeHashtags(caption: string, tags: readonly string[]): string {
  const present = new Set(caption.match(HASHTAG) ?? []);
  const missing = tags.filter((t) => !present.has(t));
  return missing.length ? `${caption.trimEnd()}\n\n${missing.join(" ")}` : caption;
}
```

- [ ] `npm test` → PASS
- [ ] Commit: `Validate captions per platform and merge region hashtags`

### Task 3: TikTok posting rules

**Files:** `src/lib/merchant/tiktok-rules.ts`, `tests/merchant/tiktok-rules.test.ts`

These are the same rules the audited screen enforces; the composer must not be
looser than the screen TikTok approved.

- [ ] Failing test:

```ts
import { describe, it, expect } from "vitest";
import { tiktokProblems, type TikTokChoice } from "@/lib/merchant/tiktok-rules";

const info = { privacyOptions: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"], maxDurationSec: 600 };
const ok: TikTokChoice = { privacy: "PUBLIC_TO_EVERYONE", commercial: false, yourBrand: false, branded: false, durationSec: 30 };

describe("tiktokProblems", () => {
  it("accepts a complete choice", () => expect(tiktokProblems(ok, info)).toEqual([]));
  it("requires a privacy choice — there is no default", () =>
    expect(tiktokProblems({ ...ok, privacy: null }, info)).toContain("privacy"));
  it("rejects a privacy value TikTok did not offer", () =>
    expect(tiktokProblems({ ...ok, privacy: "MUTUAL_FOLLOW_FRIENDS" }, info)).toContain("privacy"));
  it("requires a type once commercial content is on", () =>
    expect(tiktokProblems({ ...ok, commercial: true }, info)).toContain("commercial"));
  it("forbids branded content set to Only me", () =>
    expect(tiktokProblems({ ...ok, commercial: true, branded: true, privacy: "SELF_ONLY" }, info)).toContain("branded-private"));
  it("rejects a video longer than the creator's limit", () =>
    expect(tiktokProblems({ ...ok, durationSec: 601 }, info)).toContain("duration"));
});
```

- [ ] `npm test` → FAIL
- [ ] Implement:

```ts
export interface TikTokChoice {
  privacy: string | null;
  commercial: boolean;
  yourBrand: boolean;
  branded: boolean;
  durationSec?: number;
}
export interface TikTokCreatorLimits { privacyOptions: string[]; maxDurationSec?: number }

export function tiktokProblems(c: TikTokChoice, info: TikTokCreatorLimits): string[] {
  const p: string[] = [];
  if (!c.privacy || !info.privacyOptions.includes(c.privacy)) p.push("privacy");
  if (c.commercial && !c.yourBrand && !c.branded) p.push("commercial");
  if (c.commercial && c.branded && c.privacy === "SELF_ONLY") p.push("branded-private");
  if (c.durationSec !== undefined && info.maxDurationSec !== undefined && c.durationSec > info.maxDurationSec) p.push("duration");
  return p;
}
```

- [ ] `npm test` → PASS
- [ ] Commit: `Encode TikTok's posting rules for the composer`

### Task 4: Comment model, normalisation and state

**Files:** `src/lib/merchant/types.ts`, `normalize.ts`, `state.ts`, `tests/merchant/normalize.test.ts`

- [ ] `types.ts`:

```ts
export type Platform = "FB" | "IG";
export type CommentState = "unanswered" | "answered" | "hidden";
export interface MReply { id: string; author: string; text: string; createdAt?: string; fromUs: boolean }
export interface MComment {
  platform: Platform; id: string; postId: string; author: string; text: string;
  createdAt?: string; hidden: boolean; replies: MReply[];
}
export interface MPost {
  platform: Platform; id: string; caption: string; thumbUrl?: string; permalink?: string;
  createdAt?: string; commentCount: number; comments: MComment[];
}
```

- [ ] Failing test covering: IG media + comments → MPost with `fromUs` true when
  a reply's username equals the account's own username; FB post + comments →
  MPost with `fromUs` true when a reply's author id equals the Page id; hidden
  flags carried through; `commentState` returns hidden > answered > unanswered;
  `countStates` sums them; `rankPosts` orders by commentCount desc, then newer
  first, and caps at n.

```ts
import { describe, it, expect } from "vitest";
import { fromIg, fromFb } from "@/lib/merchant/normalize";
import { commentState, countStates, rankPosts } from "@/lib/merchant/state";

const ig = fromIg(
  [{ id: "m1", caption: "جل", media_type: "IMAGE", media_url: "https://x/1.jpg", comments_count: 2, timestamp: "2026-09-20T10:00:00Z" }],
  { m1: [
    { id: "c1", text: "چەندە؟", username: "hawkar", timestamp: "2026-09-20T11:00:00Z", hidden: false,
      replies: [{ id: "r1", text: "٣٥٬٠٠٠", username: "zarashop", timestamp: "2026-09-20T11:01:00Z" }] },
    { id: "c2", text: "spam", username: "bot", hidden: true, replies: [] },
  ] },
  "zarashop",
);
const fb = fromFb(
  [{ id: "p1", message: "پۆست", comments_count: 1, created_time: "2026-09-21T09:00:00Z" }],
  { p1: [{ id: "c3", message: "گەیاندن هەیە؟", username: "Rania", timestamp: "2026-09-21T09:30:00Z", hidden: false,
           replies: [{ id: "r2", message: "بەڵێ", authorId: "999", authorName: "Other", created_time: "2026-09-21T09:40:00Z" }] }] },
  "PAGE1",
);

describe("normalize", () => {
  it("maps Instagram media and marks our own replies", () => {
    expect(ig[0].platform).toBe("IG");
    expect(ig[0].thumbUrl).toBe("https://x/1.jpg");
    expect(ig[0].comments[0].replies[0].fromUs).toBe(true);
    expect(ig[0].comments[1].hidden).toBe(true);
  });
  it("maps Facebook posts and only trusts the Page id", () => {
    expect(fb[0].platform).toBe("FB");
    expect(fb[0].comments[0].replies[0].fromUs).toBe(false);
  });
});

describe("state", () => {
  it("orders hidden before answered before unanswered", () => {
    expect(commentState(ig[0].comments[0])).toBe("answered");
    expect(commentState(ig[0].comments[1])).toBe("hidden");
    expect(commentState(fb[0].comments[0])).toBe("unanswered");
  });
  it("counts states across posts", () => {
    expect(countStates([...ig, ...fb])).toEqual({ unanswered: 1, answered: 1, hidden: 1 });
  });
  it("ranks posts by comments, then recency", () => {
    expect(rankPosts([...fb, ...ig], 2).map((p) => p.id)).toEqual(["m1", "p1"]);
  });
});
```

- [ ] Implement `normalize.ts` against the extended engage types (Task 5 adds
  `hidden` and `replies`; normalize accepts them as optional so it compiles
  before Task 5 lands):

```ts
import type { MPost } from "./types";

interface IgMediaIn { id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; comments_count?: number }
interface IgCommentIn { id: string; text?: string; username?: string; timestamp?: string; hidden?: boolean; replies?: { id: string; text?: string; username?: string; timestamp?: string }[] }
interface FbPostIn { id: string; message?: string; permalink_url?: string; created_time?: string; comments_count?: number; full_picture?: string }
interface FbCommentIn { id: string; message?: string; username?: string; timestamp?: string; hidden?: boolean; replies?: { id: string; message?: string; authorId?: string; authorName?: string; created_time?: string }[] }

export function fromIg(media: IgMediaIn[], comments: Record<string, IgCommentIn[]>, selfUsername?: string): MPost[] {
  return media.map((m) => ({
    platform: "IG",
    id: m.id,
    caption: m.caption ?? "",
    thumbUrl: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
    permalink: m.permalink,
    createdAt: m.timestamp,
    commentCount: m.comments_count ?? 0,
    comments: (comments[m.id] ?? []).map((c) => ({
      platform: "IG", id: c.id, postId: m.id, author: c.username ?? "", text: c.text ?? "",
      createdAt: c.timestamp, hidden: !!c.hidden,
      replies: (c.replies ?? []).map((r) => ({
        id: r.id, author: r.username ?? "", text: r.text ?? "", createdAt: r.timestamp,
        fromUs: !!selfUsername && r.username === selfUsername,
      })),
    })),
  }));
}

export function fromFb(posts: FbPostIn[], comments: Record<string, FbCommentIn[]>, pageId?: string): MPost[] {
  return posts.map((p) => ({
    platform: "FB",
    id: p.id,
    caption: p.message ?? "",
    thumbUrl: p.full_picture,
    permalink: p.permalink_url,
    createdAt: p.created_time,
    commentCount: p.comments_count ?? 0,
    comments: (comments[p.id] ?? []).map((c) => ({
      platform: "FB", id: c.id, postId: p.id, author: c.username ?? "", text: c.message ?? "",
      createdAt: c.timestamp, hidden: !!c.hidden,
      replies: (c.replies ?? []).map((r) => ({
        id: r.id, author: r.authorName ?? "", text: r.message ?? "", createdAt: r.created_time,
        fromUs: !!pageId && r.authorId === pageId,
      })),
    })),
  }));
}
```

- [ ] Implement `state.ts`:

```ts
import type { CommentState, MComment, MPost } from "./types";

export function commentState(c: MComment): CommentState {
  if (c.hidden) return "hidden";
  return c.replies.some((r) => r.fromUs) ? "answered" : "unanswered";
}

export function countStates(posts: MPost[]): Record<CommentState, number> {
  const n = { unanswered: 0, answered: 0, hidden: 0 };
  for (const p of posts) for (const c of p.comments) n[commentState(c)]++;
  return n;
}

export function rankPosts(posts: MPost[], n = 5): MPost[] {
  return [...posts]
    .sort((a, b) => b.commentCount - a.commentCount || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, n);
}
```

- [ ] `npm test` → PASS
- [ ] Commit: `Model comments across Facebook and Instagram`

### Task 5: Extend the engage clients

**Files:** `src/lib/publishers/instagram-engage.ts`, `src/lib/publishers/facebook-engage.ts`

- [ ] IG `fetchComments`: request fields
  `id,text,username,timestamp,hidden,replies{id,text,username,timestamp}` and map
  `hidden` and `replies.data` onto `IgComment` (new optional fields
  `hidden?: boolean; replies?: {id,text?,username?,timestamp?}[]`).
- [ ] IG: add `deleteIgComment(tenantId, commentId)` → `DELETE /{comment-id}`
  on graph.instagram.com with the stored token, same `withCred`/`fail` pattern.
- [ ] FB `fetchPageComments`: request
  `id,message,from,created_time,is_hidden,comments{id,message,from,created_time}`
  and map `is_hidden` → `hidden`, `comments.data` → `replies` with
  `authorId = from.id`, `authorName = from.name`. Keep `username` as today.
- [ ] FB `fetchPagePosts`: add `full_picture` to the requested fields and to `FbPost`.
- [ ] FB: add `deletePageComment(tenantId, commentId)` → `DELETE /{comment-id}`.
- [ ] `npx tsc --noEmit` → clean. The existing `/dashboard/engagement` page keeps
  compiling because every new field is optional.
- [ ] Commit: `Read reply and hidden state, and delete comments, on both platforms`

### Task 6: Data loaders and server actions

**Files:** `src/app/app/data.ts`, `src/app/app/actions.ts`

- [ ] `data.ts` (server only, every function takes `tenantId`):
  - `currentTenant()` → `{ id, slug, whatsappNumber } | null` from the session.
  - `loadConnections(tenantId)` → per provider `{ connected, name?, avatarUrl? }`
    for `META_FACEBOOK`, `META_INSTAGRAM`, `TIKTOK`.
  - `loadPosts(tenantId)` → `{ posts: MPost[]; errors: string[] }`: IG media (8)
    and FB posts (8), comments fetched **in parallel** with `Promise.all` for any
    post with `commentCount > 0`, normalised with the IG username and FB page id
    from the stored credentials, sorted newest first.
  - `loadConversations(tenantId)` → IG and Messenger conversations mapped to one
    `MConversation { platform, id, participantId, participantName, messages[{text, fromUs, createdAt}], withinWindow, updatedAt }`.
  - `loadInsights(tenantId)` → `{ fb: {profile, metrics}, ig: {metrics}, topPosts: MPost[], waTaps7d: number }`,
    the last counted from `AuditLog` rows with `action = "wa.tap"` in 7 days.
- [ ] `actions.ts` ("use server"), each resolving the tenant from the session and
  returning `{ ok: boolean; error?: string }`, each writing an `AuditLog` row on
  success:
  `replyToCommentAction(platform, commentId, text)`,
  `setCommentHiddenAction(platform, commentId, hidden)`,
  `deleteCommentAction(platform, commentId)`,
  `sendMessageAction(platform, recipientId, text)`,
  `draftReplyAction(incoming, kind)` — prompt: reply in the same language and
  script as the customer (Sorani, Badini, Arabic or Latin Kurdish), short, warm,
  **never state a price or a number that is not in the message**, no hashtags,
  `saveWhatsAppAction(raw)` — `normalizePhone`, store digits on the tenant,
  `suggestCaptionAction(notes)` — Sorani caption, no invented prices,
  `publishAction(input)` (Task 9).
- [ ] Text inputs are trimmed and rejected when empty or longer than the target
  platform allows (IG comment reply 2200, DM 1000).
- [ ] `npx tsc --noEmit` → clean
- [ ] Commit: `Server loaders and actions for the merchant app`

### Task 7: Schema — WhatsApp number

- [ ] Add `whatsappNumber String?` to `Tenant` in `prisma/schema.prisma`.
- [ ] `npx prisma db push` (additive, nullable — no data touched) and
  `npx prisma generate`.
- [ ] Commit: `Store a WhatsApp number per workspace`

### Task 8: Media upload and the TikTok-visible proxy

**Files:** `src/app/api/app/upload/route.ts`, `src/app/m/[...key]/route.ts`

- [ ] Upload token route using `handleUpload` from `@vercel/blob/client`:
  authenticated tenant only; `pathname` must start with `merchant/<tenantId>/`;
  allowed content types `image/jpeg, image/png, image/webp, video/mp4, video/quicktime`;
  `maximumSizeInBytes` 250 MB; `addRandomSuffix: true`.
- [ ] Check the TikTok portal's verified URL prefix (App → URL properties). The
  proxy path must sit under it. If `https://gituas.vercel.app/` is verified, use
  `/m/<blob-path>`.
- [ ] Proxy route: accepts only keys under `merchant/`, fetches the Blob URL and
  streams the body back with the original `content-type`, `content-length` and
  `accept-ranges`, forwarding a `Range` request header when present. 404 for
  anything else.
- [ ] Manual check after deploy: `curl -I https://gituas.vercel.app/m/<key>` →
  200 with `content-type: video/mp4`.
- [ ] Commit: `Upload media to Blob and serve it from the verified domain`

### Task 9: Publish everywhere

**Files:** `src/app/app/actions.ts` (`publishAction`)

- [ ] Input: `{ mediaUrl?: string; mediaType?: "IMAGE"|"VIDEO"; caption: string; targets: ("FB"|"IG"|"TT")[]; tiktok?: TikTokChoice & { allowComment, allowDuet, allowStitch } }`.
- [ ] Guards: IG and TT require media; TT requires `VIDEO`;
  `captionProblems(caption, targets)` empty; for TT, `tiktokProblems` against a
  **fresh** `getTikTokCreator` call made inside the action (never trust the
  client's copy).
- [ ] Publish targets in parallel with `Promise.allSettled`; return
  `{ results: { target, ok, url?, error?, publishId? }[] }`. One platform failing
  never hides the others' success.
- [ ] TT uses the proxy URL from Task 8, not the raw Blob URL.
- [ ] Audit log per target.
- [ ] Commit: `Publish one post to Facebook, Instagram and TikTok`

### Task 10: WhatsApp redirect

**Files:** `src/app/w/[slug]/route.ts`

- [ ] `GET /w/<tenant-slug>?t=<text>`: look up the tenant by slug; 404 if missing
  or no number; write `AuditLog { action: "wa.tap" }`; 302 to
  `waLink(number, t?.slice(0, 500))`. Redirects only ever go to wa.me.
- [ ] Commit: `Count WhatsApp handoffs through our own redirect`

### Task 11: App shell

**Files:** `src/app/app/layout.tsx`, `app.css`, `nav.tsx`

- [ ] Fonts via `next/font/google`: `IBM_Plex_Sans_Arabic` (400/500/600/700,
  subsets `arabic`) and `Noto_Kufi_Arabic` (500/700).
- [ ] `app.css`: the token set and component classes from the approved
  prototype (`gituas-merchant-ui.html`), light and dark, scoped under `.gm`.
  The root `.gm` paints its own background over the whole viewport so the
  NOCTURNE body never shows through.
- [ ] Layout: `dir="rtl" lang="ckb"`, redirect to `/login` when signed out,
  header with shop name and a settings link, bottom tab bar with five tabs:
  ئەمڕۆ `/app`, کۆمێنت `/app/comments`, نامە `/app/messages`,
  بڵاوکردنەوە `/app/publish`, ئامار `/app/insights`.
- [ ] Commit: `Merchant app shell in Kurdish, right to left`

### Task 12: Comments screen — the section the owner asked for by name

**Files:** `src/app/app/comments/page.tsx`, `comments-client.tsx`

- [ ] Server page loads `loadPosts`, renders the client with posts and errors.
- [ ] Filter chips: هەموو · وەڵام نەدراوە · شاردراوە, with counts from `countStates`.
  Default: وەڵام نەدراوە when there is at least one, otherwise هەموو.
- [ ] Grouped by post: thumbnail, platform badge (فەیسبووک / ئینستاگرام), caption
  excerpt, link to the post.
- [ ] Comment card: author, text, time, state badge; replies shown beneath, ours
  marked «وەڵامی تۆ».
- [ ] Actions: **وەڵام** opens an inline composer (textarea, «پێشنیاری AI»
  button, «لینکی وەتسئەپ» chip that inserts `https://gituas.vercel.app/w/<slug>`
  and is disabled with a hint when no number is set, send button);
  **بیشارەوە / دەریبخەرەوە**; **بیسڕەوە** behind a confirm step in the card itself
  (no `window.confirm`).
- [ ] Optimistic update on success, rollback plus a Kurdish error line on failure.
  Pending state disables the buttons.
- [ ] Empty state: «هێشتا هیچ کۆمێنتێک نییە» with a link to publish.
- [ ] Not-connected state per platform with a connect link.
- [ ] Commit: `Comments: read, reply, hide and delete across both platforms`

### Task 13: Messages screen

**Files:** `src/app/app/messages/page.tsx`, `messages-client.tsx`

- [ ] Conversation list (both platforms, newest first) → thread view in place.
- [ ] Composer with «پێشنیاری AI» and the WhatsApp chip; disabled with the
  explanation «مێتا تەنیا ٢٤ کاتژمێر دوای دوایین نامەی کڕیار ڕێگە بە وەڵام دەدات»
  when `withinWindow` is false.
- [ ] Commit: `Messages: Instagram and Messenger in one inbox`

### Task 14: Publish screen

**Files:** `src/app/app/publish/page.tsx`, `publish-client.tsx`

- [ ] Media picker → `upload()` from `@vercel/blob/client` with a progress bar;
  preview; video duration read from a `<video>` element's metadata.
- [ ] Caption textarea with live character count, «دەقێکم بۆ بنووسە» (AI), and
  the city-tag chips (`mergeHashtags`).
- [ ] Target switches for فەیسبووک · ئینستاگرام · تیکتۆک, each showing the connected
  account or a connect link; IG and TT disabled without media; TT disabled for
  images.
- [ ] TikTok block when TT is on — the audited elements, all of them: creator
  nickname and avatar from `creator_info`; privacy radios built from
  `privacy_level_options` with **no default**; Comment/Duet/Stitch switches, off
  by default and disabled when creator_info disables them; commercial content
  toggle with «Your brand» / «Branded content» and their labels; the line
  «بە بڵاوکردنەوە، ڕازیت بە Music Usage Confirmation ـی تیکتۆک» (plus Branded
  Content Policy when branded is on) with the real TikTok links; duration check.
- [ ] Publish button disabled until `captionProblems` and `tiktokProblems` are
  empty; results list per platform with links; TikTok status polled with
  `fetchTikTokPostStatus` until it leaves PROCESSING.
- [ ] Commit: `Publish: one composer, three platforms, TikTok's rules intact`

### Task 15: Insights and Today

**Files:** `src/app/app/insights/page.tsx`, `src/app/app/page.tsx`

- [ ] Insights: follower and reach figures from FB profile/metrics and IG user
  insights; «کام پۆست زۆرترین کۆمێنتی هێنا» from `rankPosts`; WhatsApp taps in 7
  days. Each block shows a quiet note instead of breaking when its source fails.
- [ ] Today: four-cell strip (کۆمێنتی وەڵام نەدراوە · نامەی چاوەڕوان · پۆستی ئەم
  هەفتەیە · کلیکی وەتسئەپ) and a list of the newest unanswered comments and open
  conversations linking into their screens.
- [ ] Commit: `Insights and the Today summary`

### Task 16: Settings

**Files:** `src/app/app/settings/page.tsx`, `settings-client.tsx`

- [ ] Connections: Facebook, Instagram, TikTok — account name, and a
  «پەیوەست بکە» / «دووبارە پەیوەست بکەوە» link to `/api/oauth/<provider>/start`.
- [ ] WhatsApp number: input, live normalised preview (`wa.me/…`), save, «نامەیەک
  بۆ خۆت بنێرە» opening the real link.
- [ ] Sign out.
- [ ] Commit: `Settings: connections and the WhatsApp number`

### Task 17: Verify and ship

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` — all clean.
- [ ] Push to `master` (deploys production). `/dashboard` untouched.
- [ ] On production with the owner's accounts: connect the Facebook Page;
  reply to a real comment on each platform and see it on facebook.com /
  instagram.com; hide and unhide one; delete a test comment; answer a DM;
  publish one test post to all three; open insights; save the WhatsApp number
  and follow the link.
- [ ] Record results in TODOS.md; commit.

## Self-review

- Spec coverage for Phase 1: comments (read/reply/hide/delete) T5/T12; DMs T13;
  publish ×3 T8/T9/T14; insights T15; comment moderation T5/T12; WhatsApp link
  and number T1/T7/T10/T16. Deferred by design to Phase 2: catalog, post
  tagging, automatic replies, private replies, outbox, alerts.
- Types: `MPost`/`MComment` defined in T4 and used in T6, T12, T15.
  `TikTokChoice` defined in T3 and used in T9, T14. `normalizePhone`/`waLink` in
  T1, used in T6, T10, T16.
- Risk: the TikTok verified prefix (T8) is unknown until checked; the proxy path
  is chosen from it.
