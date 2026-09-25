# News desk for Kurdish news pages — design

Date: 2026-09-26 · Status: approved in brainstorming, pending spec review

## Goal

Let a Kurdish news page run its Facebook, Instagram and TikTok from Gituas:
news arrives from free, legal sources, Gituas drafts an original Sorani
summary, renders a card in the page's own design, and publishes to all three
platforms after an editor approves it. Later phases add the page's own video
with logo and Kurdish subtitles, and motion-graphic news videos.

Everything is built on access Gituas already holds. No new Meta or TikTok
permission is requested for any phase in this spec.

## Decisions

| Topic | Decision |
|---|---|
| Where it lives | The existing Gituas app. At sign-up a tenant is a shop or a news page (`Tenant.kind`), changeable in Settings. Shops see no change. |
| Sources | Curated catalog plus the page's own RSS feeds, filtered by the page's keywords. |
| AI | DeepSeek behind a provider interface; Gemini as fallback. |
| Graphics | Rendered from code templates, never AI-generated images. Kurdish text is always set by a real font engine. |
| Templates | Four built-in kinds, restyled by each page's brand kit; each page can also have its own template made of an uploaded frame plus text zones; a paid "custom design" service builds coded motion templates. A drag-and-drop editor is deferred. |
| Hosting | Phases 1–2 run on the current free Vercel plan. Phases 3–4 add a Railway worker. Vercel moves to Pro the day the first client pays (Hobby forbids commercial use). Storage moves to R2 later behind a storage interface. The domain stays `gituas.vercel.app`: moving it forces a TikTok `Create Revision` review. |
| Packages | Every costly action counts against a monthly quota per plan; the action is refused at the limit, so our cost can never exceed the price. Numbers are set later. |

## Phases

| Phase | Contents | Runs on | Our cost |
|---|---|---|---|
| 1 — News desk | Sources and keywords, ingest, clustering, Sorani drafts, editor approval, publishing to FB/IG/TikTok, brand kit, the four built-in card templates, usage limits | Vercel (free) | DeepSeek tokens only |
| 2 — Page templates | Uploaded frame + zones (position, font, size, colour per zone) | Vercel (free) | none |
| 3 — Page video | The page's own footage with frame/logo and Kurdish subtitles | Railway worker | ~$5/month base |
| 4 — Motion video | Breaking-news and card templates as short motion videos; the paid custom-design service | Railway worker | per render |

Each phase gets its own implementation plan. This spec covers all four so the
early phases leave the right seams; phase 1 is specified in full, later phases
at the level needed to keep those seams honest.

Not in phase 1: scheduled publishing, several editors per page (the
`Membership` model already exists for later), Badini, a template editor.

## Editor flow (phase 1)

1. The editor opens **هەواڵ**. If the page's sources were last fetched more
   than five minutes ago, they are fetched now; a refresh button forces it.
   Items from several sources about the same story are grouped ("٣ سەرچاوە").
   Items keep their original language.
2. Opening an item asks the AI for a Sorani draft: headline, body, category and
   a suggested card kind (with the number or the quote and its speaker when
   the kind needs one).
3. The editor edits the text and picks a template: one of the four built-in
   kinds or the page's own. The card renders in the browser as they type.
4. "پەسەند و بڵاوکردنەوە" with per-platform toggles publishes. Nothing is ever
   published without this click.
5. Attribution is appended automatically:
   - Facebook: card, text, source name and link.
   - Instagram: card, text, "سەرچاوە: …" (links in captions are not clickable).
   - TikTok: the card as a photo post if the Content Posting API allows it
     under `video.publish`; otherwise TikTok waits for phase 4 video.

The tab bar for a news page is هەواڵ · کۆمێنت · نامە · ئامار · ڕێکخستن. Manual
publishing moves inside هەواڵ. Comment moderation stays: news pages attract the
most comments that need hiding.

## Architecture

```
sources ──► ingest ──► cluster ──► NewsItem (new)
                                      │ open
                                      ▼
            AI provider ◄── draft ◄───┘
                               │
                   rules ◄─────┤
                               ▼
     template + brand kit ──► card rendered in browser ──► storage
                                                             │ approve
                                                             ▼
                                existing publishers ──► FB / IG / TikTok
```

Units, each testable alone:

| Unit | Responsibility | Interface |
|---|---|---|
| `lib/news/sources/{gdelt,rss,newsdata}.ts` | Fetch one source and map it to a common shape | `fetchSource(src, { keywords, since }) → RawItem[]` where `RawItem = { url, title, snippet, publishedAt, lang, sourceName }` |
| `lib/news/catalog.ts` | The curated source list, each entry recording which terms were checked | `CATALOG: CatalogSource[]` |
| `lib/news/ingest.ts` | Fetch all of a tenant's sources in parallel (8 s timeout each), store new items, skip if fetched < 5 min ago | `ingest(tenantId, { force }) → { added, failedSources }` |
| `lib/news/cluster.ts` | Group items: same URL, or same language and title-token Jaccard ≥ 0.6 within 48 h | `clusterKey(item, recent) → string` |
| `lib/ai/provider.ts`, `lib/ai/deepseek.ts`, `lib/ai/gemini.ts` | One call shape for JSON completions; DeepSeek via its OpenAI-compatible API, Gemini fallback | `completeJson<T>({ system, user, schema }) → T` |
| `lib/news/draft.ts` | Build the prompt from title and snippet only; validate the JSON | `draftFor(item) → Draft = { headline, body, category, cardKind, stat?, quote?, speaker? }` |
| `lib/news/rules.ts` | Enforce the legal rules below | `checkDraft(draft, source) → Problem[]`, `withAttribution(text, source, platform) → string` |
| `lib/cards/` | Templates as data; one React renderer for built-in and page templates; text fitting | `<CardRenderer template brand draft photo />`, `renderToPng(node) → Blob` |
| `lib/storage.ts` | Put and read files; Vercel Blob now, R2 later | `putFile(path, body, type) → url` |
| `lib/billing/limits.ts` | Monthly quotas per plan, checked before and counted after each costly action | `assertWithin(tenantId, metric)`, `count(tenantId, metric)` |

Cards render in the editor's browser (DOM → PNG), so Kurdish shaping is the
browser's and the server does no image work in phases 1–2. The renderer is a
plain React component, so the phase 3–4 worker renders the same templates in
headless Chromium; FFmpeg handles overlays and encoding there.

Publishing reuses `publishToFacebookPage`, `publishToInstagram` and the TikTok
publisher, with media served through the existing `/m/` proxy.

## Data model

A sketch; field types and indexes are settled in the phase 1 plan.

```prisma
enum TenantKind { MERCHANT NEWS }
// Tenant gains: kind TenantKind @default(MERCHANT)

model NewsSettings { tenantId String @id; keywords String[]; languages String[]; lastFetchedAt DateTime? }
model NewsSource   { id; tenantId; catalogId String?; rssUrl String?; name; enabled Boolean @default(true); lastError String? }
model NewsItem     { id; tenantId; sourceId; url; title; snippet; lang; publishedAt; clusterKey; status NEW|DRAFTED|PUBLISHED|DISMISSED
                     @@unique([tenantId, url]) }
model NewsDraft    { id; itemId @unique; headline; body; category; cardKind; fields Json; templateId; photoUrl?; cardUrl?;
                     approvedAt?; results Json? }
model BrandKit     { tenantId @id; logoUrl?; colors Json; headingFont; bodyFont }
model CardTemplate { id; tenantId String?  // null = built-in
                     kind STANDARD|BREAKING|STAT|QUOTE|FRAME; serves CardKind[]; frameUrl?; zones Json; width Int; height Int }
model Usage        { tenantId; month String; metric String; count Int  @@id([tenantId, month, metric]) }
```

`zones` is a list of `{ field: headline|body|photo|source|time|stat|quote|speaker|logo,
x, y, w, h, font, size, minSize, colour, align }` in template pixels. A built-in
template serves its own card kind; a page's FRAME template lists the kinds it
serves in `serves`, and the editor offers it for drafts of those kinds. A zone
whose field the draft lacks (no photo, no stat) is left empty.

## Sources

- **GDELT DOC 2.0** — free, keyless, 65+ languages including Arabic; queried
  with the page's keywords. Returns title, URL, domain and language.
- **NewsData.io free tier** — commercial use allowed, snippets only, 12-hour
  delay; useful for background stories, not breaking news. Needs
  `NEWSDATA_API_KEY` from a free account the owner creates; without it the
  source is simply unavailable.
- **RSS** — catalog feeds (Kurdish, Arabic and international outlets, official
  bodies) and any feed the page adds. Only title, snippet and link are used.
- **Official bodies** (KRG, Iraqi ministries, UN agencies) — through their RSS
  or press pages where a feed exists.

NewsAPI.org and GNews free tiers are excluded: both forbid production use.

## Legal rules, enforced in code

1. The AI receives only the source's title and snippet, never full article
   text, and writes a summary within fixed length limits.
2. A draft whose body overlaps the source text heavily (same language, long
   shared word sequences) is blocked from publishing until edited.
3. Source name and link are appended on every platform and printed on the
   card; the UI has no control to remove them.
4. No image or video is ever fetched from a source. Photos come only from the
   page's uploads.
5. Nothing publishes without an editor's approval.
6. `/terms` is updated: the page is responsible for what it publishes and for
   any media licence it needs.

## Limits and packages

Metrics counted per tenant per calendar month: drafts (AI calls), publishes,
sources, custom templates, videos. `assertWithin` runs before the action and
refuses with a Kurdish message naming the limit; `count` runs after success.
Plan numbers live in one config object and are set before launch. The custom
design service is billed separately.

## Error handling

| Situation | Behaviour |
|---|---|
| A source times out or errors | Skipped for this fetch; its name appears in a small warning; `NewsSource.lastError` records it |
| DeepSeek fails | Retry once, then Gemini; if both fail the editor writes the text by hand |
| Quota reached | Action refused with the limit named; nothing is spent |
| One platform fails to publish | Per-platform results as today, with retry for the failed one only |
| Headline too long for its zone | Font shrinks to the zone's `minSize`; below that a warning asks for a shorter headline |

## Testing

- Unit tests with saved real responses: RSS (Arabic and Kurdish feeds), GDELT
  JSON, NewsData JSON; clustering; rules (attribution per platform, overlap
  check); limits.
- A script against the database covering ingest → draft → approve → publish
  bookkeeping, cleaning up after itself, as done for sign-up codes.
- Before building drafts: a Sorani quality check of DeepSeek on ten real items
  (Arabic, English, Kurdish sources). If quality is poor, stop and decide.
- Cards checked in the browser at phone and desktop widths.

## DeepSeek Sorani check (2026-09-26)

Ten live items (4 BBC Arabic, 3 BBC English, 3 Kurdistan24 Sorani), title and
snippet only, same prompt, both models:

| | `deepseek-flash` | `deepseek-v4-pro` |
|---|---|---|
| Time per item | ~2 s | ~8 s (reasoning model) |
| Tokens per item (in/out) | 472 / 214 | 548 / 1,922 |
| Cost per 1,000 items (peak price) | ≈ $0.40 | ≈ $8 |
| Sorani | fluent, standard orthography, Eastern Arabic digits | same, slightly more idiomatic |
| Errors seen | one idiom mistranslated (ورقة مساومة → «پارچەی چاوەڕوانی»); one fact added that was not in the input (a job title) | neither of those |
| Card kind | sensible (STAT for $2.45bn, QUOTE for named statements) | same |

Both models return a Kurdish-source item almost verbatim when its snippet is a
single line. Consequences for the design:

- Drafts use `deepseek-flash` by default (fast, cheap). The editor has an
  "improve" action that re-drafts with `deepseek-v4-pro`; it counts as its own
  metric in the quotas. Model names are explicit: `deepseek-chat` is no longer
  listed.
- The editor always shows the source title and snippet beside the draft, so
  meaning errors are caught before approval.
- The overlap rule matters most for Kurdish sources; a near-copy is blocked
  with a message asking the editor to restate it.
- GDELT answered 429 to a first request from this machine: its API allows one
  request every few seconds, so GDELT queries are spaced and cached across
  tenants rather than made per page view.

## To verify while planning phase 1

- Whether TikTok's Content Posting API accepts photo posts under
  `video.publish` alone.
- GDELT's terms for commercial use, and each catalog feed's terms.
- Where DeepSeek stores request data; state it in the privacy policy.
