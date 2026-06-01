# Gituas — Checkpoint · v0.9.4

**Date:** 28 May 2026
**State:** Full web build working locally. All 4 surfaces from the design package present
(marketing site, dashboard, iOS preview, Android preview). Pipeline verified end-to-end on Gemini.

> give it to us and sleep — a multi-tenant autonomous SaaS orchestrator for indie devs.

---

## How to run

```bash
npm install --legacy-peer-deps
npx prisma generate
npm run dev          # http://localhost:3001
```

Surfaces:
- Marketing site    `/`
- Login (GitHub)    `/login`
- Dashboard (Fleet) `/dashboard`
- Integrations admin `/dashboard/integrations`
- Mobile preview    `/mobile`

---

## Verified at this checkpoint

- TypeScript: **0 errors** (strict)
- Routes `/ /login /mobile` → **HTTP 200**
- Security: every server action auth-guarded · no hardcoded secrets · tenant-scoped queries · AES-256-GCM vault · cron Bearer auth
- 16 pages · 5 API routes · 19 components · 22 lib files · 9 agents · 24 Prisma models · 20 enums · ~7,700 LOC

### Works end-to-end (tested)
- GitHub OAuth sign-in → tenant auto-create
- Gemini Project Personality generation (vidsave)
- Gemini 30-day Marketing Plan generation
- Cron `/api/cron/run-agents` → 9 agents (content/seo/intel produced real rows)
- Approval workflow (approve → publish dispatch)
- Sharp 1-image → 4 aspect-ratio variants
- Integrations admin (manual API keys + OAuth start/callback for X/LinkedIn/Reddit)

---

## Stack

Next.js 16 (Turbopack) · TypeScript · Prisma 7 + Neon Postgres · Auth.js v5 (GitHub) ·
Tailwind v4 · @google/genai (Gemini 2.5 pro + flash) · Sharp · Octokit · AES-256-GCM vault.

Brand: deep green-black `#0a0e0b` + money-lime `#aef85b` · Space Grotesk + JetBrains Mono · lowercase.

---

## The 9 agents (cron-driven)

| Agent | Role |
|---|---|
| content-agent | next plan item → Gemini post → ContentPost + approval |
| seo-agent | weekly long-form SEO post |
| market-intelligence | competitor insights → MemoryItem |
| plan-refresher | regenerate plan when exhausted/stale |
| personality-refresher | re-analyze repo after 45d |
| ad-campaign-agent | stage ads from plan |
| reply-agent | draft replies to inbound messages |
| reddit-inbox-agent | poll reddit inbox → ConversationMessage |
| hibernation-agent | park idle (0-traffic) projects |

---

## Blocked on platform access (not code)

- X / LinkedIn / Reddit publishing → set OAuth client id/secret, then connect in Integrations
- TikTok / YouTube / Meta → business verification / API audit first
- Stripe wallet + payout → STRIPE_SECRET_KEY + Connect onboarding
- Higgsfield/Sora video → model API access

## Remaining for production (code)

1. Test suite (vitest + e2e) — none yet
2. Prisma migrations (currently `db push` only)
3. Observability (Sentry + structured logs)
4. Cron idempotency (avoid duplicate ContentPosts on double-run)
5. Rate-limiting on GitHub/Gemini calls
6. Image storage → @vercel/blob (currently data: URLs in DB)
7. Native mobile apps (only web preview exists)
8. Production `next build` verification

---

## Notes

- Dev server runs on **3001** (port 3000 was occupied by an unrelated local app).
- `.env` holds live secrets and is gitignored — see `.env.example` to reconstruct.
- DB lives in Neon; project rows (vidsave + personality + plan) persist across rebuilds.
