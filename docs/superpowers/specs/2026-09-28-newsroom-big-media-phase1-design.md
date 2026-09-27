# Newsroom for large outlets — Phase 1 design

Date: 2026-09-28 · Branch: `newsroom-big-media`

## Why

The first newsroom (spec `2026-09-26-news-desk-design.md`) finds other outlets'
stories and rewrites them. Large TV channels and news sites don't need that:
they report their own news. Their pain is **distribution** — every story has to
be turned by hand into a card, a caption per platform and a post on several
pages, by a team, fast. Phase 1 makes the newsroom fit that team.

## Owner decisions (2026-09-28)

1. **Own content first.** The channel's own website/RSS is the main feed. Other
   outlets' news moves to a secondary tab, **Monitor** (چاودێری).
2. **Video is only logo + frame template** on the channel's own clips (Phase 3).
   No generated motion video, no automatic subtitles, no clip cutting.

## Roadmap (each phase gets its own design → plan → build)

| Phase | Scope |
|---|---|
| **1 Foundation** (this doc) | sign-in polish, new shell, guide, team + roles + invites, several desks per user, own-content feed, review + scheduling + calendar |
| 2 Graphics studio | per-channel templates (frame + zones), 10+ kinds (breaking, live, sport, weather, stat…), all sizes (1:1, 4:5, 9:16, 16:9), carousel, one-click breaking to all pages |
| 3 Video | channel uploads a clip → logo + frame template burned in, sized per platform (FFmpeg worker) |
| 4 Language + Telegram | auto-translation between desks, Telegram channel publishing |
| 5 Intelligence | cross-page analytics, AI comment moderation (Kurdish/Arabic), trend + competitor watch |
| 6 Sales package | pilot, onboarding, support, monthly "time saved" report (kept in the private folder) |

Phase 1 is four plans, built in this order, each on its own branch off
`newsroom-big-media`:

---

## 1A — Sign-in polish, shell, guide

**Sign-in.** `/login`, `/signup`, `/forgot` with `next=/newsroom…`:
- hide the GitHub button (`src/app/login/merchant-login.tsx`) when
  `product === "newsroom"`; the shop keeps it for the owner;
- `generateMetadata` on `/login` by product — today the tab still says
  "gituas — the night shift for indie software";
- verify end to end in production: email sign-up with code, Google, forgot
  password, and a new user landing in `/newsroom/news`.

**Shell.** The newsroom gets its own layout instead of reusing the shop tabs:
- right-hand sidebar (RTL): هەواڵەکانمان (own feed) · چاودێری (monitor) ·
  پێداچوونەوە (review, with a count badge) · خشتە (calendar) · بڵاوکراوەکان
  (published) · تیم (team) · ڕێکخستن (settings) · ڕێنمایی (guide);
- top bar: desk switcher (1B), the user's role, sign-out;
- phone: bottom bar with the four main sections; works at 375 px with no
  horizontal scroll;
- its own visual identity, distinct from the shop (a "control room" look),
  designed with the frontend-design skill; light and dark.

**Guide** `/newsroom/guide`, in Sorani, one page with anchored sections:
connecting pages, adding your website, inviting the team, roles, the approval
flow, making a card, scheduling, the monitor tab, FAQ. Plus a **first-run
checklist** card on the feed computed from real state (a page connected, own
site added, a teammate invited, first card made, first post published), and
"?" links from each screen to its guide section.

**Landing page** `/newsroom`: rewrite around own content, team and approval.

## 1B — Team, roles, several desks

**Workspace lookup.** `src/app/app/data.ts` finds the workspace with
`tenant.findFirst({ ownerId })`, so an invited member sees nothing. Change it to
membership: the active desk comes from a cookie (`gm_ws`, validated against the
user's memberships on every request), defaulting to the user's first
membership. This touches both `/app` and `/newsroom` — cover it with tests.

**Roles** reuse `MembershipRole` (no enum change):

| Can | OWNER خاوەن | ADMIN سەرنووسەر | MEMBER نووسەر |
|---|---|---|---|
| Read feed, monitor, calendar | ✓ | ✓ | ✓ |
| Make / edit drafts, submit for review | ✓ | ✓ | ✓ |
| Approve, request changes, publish, schedule | ✓ | ✓ | — |
| Sources, templates, connected pages, settings | ✓ | ✓ | — |
| Team, roles, billing, delete desk | ✓ | — | — |

Every server action checks the role; hiding a button is never the check.

**Invites.** New model:

```prisma
model Invite {
  id          String         @id @default(cuid())
  tenantId    String
  email       String
  role        MembershipRole
  tokenHash   String         @unique   // SHA-256 of a 32-byte random token
  invitedById String
  expiresAt   DateTime                  // 7 days
  acceptedAt  DateTime?
  createdAt   DateTime       @default(now())
  @@index([tenantId])
}
```

- the owner enters email + role → email through `src/lib/mailer.ts` with the link
  `/newsroom/join/<token>`;
- accepting requires being signed in **with that email** (new users sign up
  first, the link carries through `next`); creates the Membership once;
- joining must not create or claim an empty tenant for the invitee;
- the owner can resend, revoke, change a role, or remove a member; the last
  owner can't be removed; 20 invites/day per desk;
- seats per plan in `NEWS_LIMITS` (starting values: MANUAL 2, AUTO 5,
  ENTERPRISE unlimited);
- audit log: `member.invited`, `member.joined`, `member.role_changed`,
  `member.removed`.

**Several desks.** A user can own or belong to several newsroom desks (e.g. a
Sorani desk and an Arabic desk). Each desk has its own sources, keywords,
templates, connected pages and team. "New desk" in the switcher; desks per plan
in `NEWS_LIMITS`.

## 1C — Own content first

- `NewsSource.own Boolean @default(false)`.
- Settings/onboarding ask for **your website**. Discovery fetches the homepage
  through the existing SSRF-safe fetcher, reads
  `<link rel="alternate" type="application/rss+xml|atom+xml">`, falls back to
  `/rss`, `/feed`, `/rss.xml`, `/feed.xml`, and lets the user pick one or more
  feeds (e.g. per section). Saved with `own: true`.
- **Own feed** (هەواڵەکانمان): own items, newest first, no clustering, with
  search and filters (section, status).
- **Monitor** (چاودێری): the current clustered desk, from non-own sources,
  unchanged.
- **Drafting own items:** the prompt adapts rather than rewrites: a short card
  headline, card text, and a caption per platform (FB longer, IG with hashtags,
  TT short). The COPY rule and the auto-rewrite loop do **not** apply, because
  it is the channel's own text. `publishAction` skips the COPY check only when the
  draft's item comes from an own source.
- **Own images:** for own items only, the article image (RSS
  `enclosure`/`media:content`, else `og:image`) is fetched through the SSRF-safe
  fetcher (image/* only, ≤ 8 MB) into Blob and used as the card photo. Items from
  other outlets keep the rule "never fetch source media".
- **Freshness:** own sources use a 2-minute ingest throttle (others stay at 5);
  while the feed is open the client refreshes every 60 s. Background ingest
  with no page open comes with the cron in 1D.

## 1D — Review, scheduling, calendar

**Status** on `NewsDraft`:

```prisma
enum NewsDraftStatus { DRAFT IN_REVIEW CHANGES_REQUESTED APPROVED SCHEDULED PUBLISHING PUBLISHED FAILED }
// + status, reviewNote, submittedById, approvedById, scheduledFor, scheduleTargets Json
```

- A writer edits and submits. An editor or owner approves, sends it back with a
  note, publishes, or schedules. The server enforces each transition.
- Desk setting **"approval required"**, on by default once the desk has more
  than one member. A one-person desk skips review.
- **Review** page with a queue and a count badge. Each draft shows its history
  (who submitted, approved, published), taken from the audit log.

**Scheduling: Facebook and Instagram only.** TikTok posts stay live through the
audited publish screen (privacy choice and consent at post time), so the
audited flow is untouched.
- Scheduling stores the targets (account ids), the caption per platform, and the
  card path.
- `/api/cron/publish-due` (header `CRON_SECRET`) claims due drafts atomically
  (`updateMany … status=SCHEDULED, scheduledFor<=now → PUBLISHING`), publishes
  through the existing publishers, records results, then sets PUBLISHED or FAILED.
  On failure it emails the scheduler. The same run ingests own sources.
- **Trigger:** Vercel Cron only runs daily on Hobby. Until the account is on
  Pro, a free external pinger calls the route every 1–5 min. The owner picks
  one at build time. Hobby is non-commercial anyway, so move to Pro with the
  first paying channel.
- Scheduled posts count against the same `Usage` quota as live ones.

**Calendar** (خشتە): a week view per connected page of scheduled and published
posts. Click to open, reschedule, or cancel.

---

## Not in phase 1

Translation, Telegram, analytics, moderation, the graphics studio, video.

## Risks

- The membership lookup change touches every page of both products.
- Scheduled posts run with nobody watching: token expiry and API errors must
  surface (FAILED + email + a banner on the feed).
- Hobby plan: no sub-daily cron, non-commercial.

## Testing

- vitest: the role matrix, the invite token lifecycle (expiry, reuse, wrong
  email), feed discovery parsing, status transitions, and cron claim idempotency
  (two runs never double-post).
- Production: the test account as owner plus a second invited test account as
  writer. Walk invite → draft → review → schedule → auto-publish to a test
  page.
